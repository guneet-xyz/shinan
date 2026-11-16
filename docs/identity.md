# Identity, agents and permissions

Status: **draft for review** ([issue #7](https://github.com/guneet-xyz/shinan/issues/7)).
Updated with the owner's answers in
[issue #25](https://github.com/guneet-xyz/shinan/issues/25).

This document owns how people sign in, who can have an account, how
workspaces, members and invitations work, how agents act for people, which
tokens exist, how Shinan decides who did what (attribution), who may see and do
what (access rules), and the protections a Shinan installation on the public
internet needs. It stays conceptual: it says what must be true and why. The
[architecture and operations](architecture.md) document chooses the technology
that makes it true (D-020).

It uses the terms of the [domain model and glossary](domain-model.md) exactly.
That document is still in review
([PR #14](https://github.com/guneet-xyz/shinan/pull/14)); terms this document
needs but the glossary lacks are listed under
[proposed glossary additions](#proposed-glossary-additions).

## How to read this document

Every statement is marked:

- **Decided**: follows from an accepted plan decision (D-nnn), or from an
  owner answer in [issue #25](https://github.com/guneet-xyz/shinan/issues/25),
  cited as "owner, O-n". The decision log maps O-n to decision records.
- **Proposed**: suggested here, with a reason. The owner confirms or changes it.
- **Open**: not settled. Listed under [open questions](#open-questions) or
  [decisions needed from the owner](#decisions-needed-from-the-owner).

Where a section starts with a status, it applies to the whole section unless a
statement says otherwise.

## Summary

1. **Four sign-in methods, no passkeys.** GitHub, Forgejo (any self-hosted
   instance), an email sign-in link, or a password with no second factor
   (owner, O-41). Shinan sends email from the first version
   ([section 3](#3-sign-in-for-people)).
2. **An email allowlist decides who can have an account; an invitation decides
   who joins a workspace** (owner, O-42, O-48)
   ([section 3.2](#32-who-can-have-an-account), [5.2](#52-invitations)).
3. **Everyone in a workspace sees everything in it**, including work from
   private repositories. There is no restricted level. Secrets never go in the
   catalog (owner, O-2, O-43) ([section 9.2](#92-visibility-inside-a-workspace)).
4. **One agent per person, coding tool and machine**, for example "Guneet's
   OpenCode on Daedalus" (owner, O-40) ([section 6.1](#61-what-one-agent-is)).
5. **Agent tokens are long-lived and valid until revoked** (owner, O-44).
   Revocation works at once, and every token's use is visible
   ([section 7](#7-tokens)).
6. **Shinan never acts on a git host as a person** and stores no per-person git
   host tokens. Its own writes use the GitHub App's installation token, or on
   Forgejo the connecting person's token (owner, O-1, O-53, O-54)
   ([section 9.3](#93-git-host-connections)).
7. **An agent can never do more than its member, and some actions are for
   people only** ([section 6.3](#63-what-an-agent-may-do)).
8. **Honest attribution.** Every credit carries a confidence; markers are
   checked against Shinan's records; Shinan's own writes are recognised only by
   stored item IDs ([section 8](#8-acting-for-and-attribution)).
9. **The security log is kept forever** and only workspace owners can purge
   (owner, O-47, O-50) ([section 11](#11-audit)).
10. **A small first version**, in three stages (owner, O-49)
    ([section 13](#13-first-version-scope)).

## 1. What is at stake

**Decided (D-015):** the web app is on the public internet and requires
sign-in. Because a workspace holds infrastructure details, sign-in, access
rules and security get extra attention. **Decided (D-019):** one person uses
Shinan at first, but workspaces and invitations are designed in from the
start.

A workspace's catalog describes machines, addresses, access paths, services,
runbooks and decisions. Its tasks tell the story of changes, including security
fixes, and show titles and summaries from private repositories. That is a map
of the team's estate. **Decided (owner, O-2,
[#25](https://github.com/guneet-xyz/shinan/issues/25)):** secrets never go in
the catalog; a secrets manager (such as Obscuro or Infisical) holds them, and
the catalog records only where each one lives. Even without secrets, the map is
worth protecting.

### Threats and residual risks

The owner's answers in [issue #25](https://github.com/guneet-xyz/shinan/issues/25)
chose convenience over some of the protections this document first proposed
(no passkeys, no second factor, long-lived agent tokens, no restricted level,
any Forgejo token). The table below states, for each threat, what Shinan still
does and what risk remains. It does not reopen those decisions. **Proposed**
list; reason: each rule below should trace to a threat, and the owner should
see the remaining risk in one place.

| # | Threat | What Shinan does | Residual risk |
|---|---|---|---|
| T1 | A person's sign-in is stolen: phished password, reused password, taken-over email account | Password rules and a blocklist of known-breached passwords; throttling; short single-use email links; re-authentication for sensitive actions; email alerts on sign-in from a new browser and on new agent tokens; the security log ([3](#3-sign-in-for-people), [10](#10-protections-for-a-public-installation)) | No sign-in method is phishing-resistant and none needs a second factor. Whoever holds the password, the email account, or the GitHub or Forgejo account can read the whole workspace and, after re-authenticating with the same method, change it. Detection depends on the person noticing an alert. |
| T2 | An agent token is stolen | Narrow scopes, one agent per machine, instant revocation, last-use display, the security log ([6](#6-agents), [7](#7-tokens)) | A token works until someone revokes it (O-44). A token copied from a machine, or printed by a misled agent, keeps working from anywhere, possibly for a long time, and reads everything in the workspace. |
| T3 | An invitation link leaks | Bound to one email address; the invitee must sign in as an allowlisted person with that verified email; single use; expires ([5.2](#52-invitations)) | Whoever controls the invitee's email can accept it. |
| T4 | A member sees what they cannot see on the git host | None inside a workspace, by decision (O-43); links to private repositories stay protected by the git host | Titles, summaries and events Shinan stores from private repositories are visible to every member and every member's agent. Separation needs separate workspaces ([9.2](#92-visibility-inside-a-workspace)). |
| T5 | Wrong credit | Confidence levels; marker checks; Shinan's own writes recognised by stored IDs ([8](#8-acting-for-and-attribution)) | Attribution is not proof against the account holder (D-017). |
| T6 | A GitHub or Forgejo account is taken over | Sign-in identities keyed by the host's stable account number; Shinan keeps no git host token from sign-in ([3.1](#31-sign-in-methods)) | Because git host sign-in is a sign-in method (O-41), a taken-over GitHub or Forgejo account is a taken-over Shinan account. |
| T7 | A Forgejo instance is malicious or compromised | Forgejo instances for sign-in are added by the installation operator; identities are scoped to one instance; the allowlist is matched only on emails Shinan verified itself ([3.1](#31-sign-in-methods), [3.2](#32-who-can-have-an-account)) | An instance can assert any account on itself, so trusting an instance means trusting its administrators with the sign-in of everyone who uses it. |
| T8 | The public address is abused | Throttling, breached-password blocklist, uniform errors, limits on how often sign-in emails are sent ([10](#10-protections-for-a-public-installation)) | Password guessing is possible in principle; throttling slows it but a weak password chosen before a breach becomes known stays weak. |
| T9 | A member's agent is steered by someone else | Nudges from other members are queued by default and framed as requests ([6.5](#65-nudges-from-other-people)) | An agent may still act on a well-phrased request from another member. |
| T10 | Shinan's Forgejo connection token is stolen | Stored encrypted; never shown again, logged or given to agents ([9.3](#93-git-host-connections)) | Shinan accepts any Forgejo token (O-54). If a site administrator connects with a broad token, anyone who gets that token can act as any user on that Forgejo instance. |
| T11 | An insider or the operator misuses access | Security log kept forever; operators cannot purge (O-47, O-50) ([11](#11-audit), [12](#12-self-hosted-installations)) | An operator with database access can still read or change anything. |
| T12 | Data is lost | None in Shinan: no built-in backups for now (owner, O-62 to O-64) | The security log and everything else depend on host-level backups, which are paused on Musashi. "Forever" retention holds only as long as the disk does. |

### Principles

**Proposed**, each with its reason:

1. **Closed by default.** Nothing is readable without sign-in, and every
   request is refused unless a rule allows it. Reason: D-015 puts the app on
   the public internet.
2. **The workspace is the only visibility boundary.** Inside it, everyone sees
   everything (O-2, O-43); between workspaces, nothing crosses except the
   person (their sign-in and linked git host accounts). Reason: with no
   finer levels, the workspace boundary must be absolute.
3. **An agent never has more than its member.** Reason: it already uses that
   member's git host account (D-017), so trusting it with more makes no sense.
4. **Only people change who can do what.** Agents cannot invite, change roles,
   issue tokens or approve catalog proposals. Reason: a stolen or misled agent
   must not be able to widen its own access or approve its own work.
5. **Credentials are narrow and revocable at once.** Reason: tokens are
   long-lived (O-44), so fast, visible revocation is the main control.
6. **Attribution says how sure it is.** Reason: D-017 makes certainty
   impossible in many cases, and false certainty is worse than stated doubt.
7. **Security-relevant actions are recorded.** Reason: with infrastructure
   details at stake and no second factor, "who did this and when" must be
   answerable afterwards.

## 2. Identities and credentials at a glance

**Proposed.** Reason: one table shows how each kind of identity proves itself.

| Identity (glossary term) | Proves itself with | Section |
|---|---|---|
| [Person](domain-model.md#person) | One of four sign-in methods, giving a sign-in session | [3](#3-sign-in-for-people) |
| [Member](domain-model.md#member-and-role) | A person plus a membership record with a role | [5](#5-members-roles-and-invitations) |
| [Agent](domain-model.md#agent) | An agent token, approved by its member | [6](#6-agents), [7](#7-tokens) |
| [Agent session](domain-model.md#agent-session) | Its agent's token, plus a conversation identifier the coding tool reports | [6.4](#64-agent-sessions) |
| [Git host account](domain-model.md#git-host-account) | Proven by signing in to the git host | [3.5](#35-linking-git-host-accounts) |
| [Git host connection](domain-model.md#git-host-connection) | Credentials Shinan holds for the git host | [9.3](#93-git-host-connections) |
| Shinan itself ([actor](domain-model.md#actor)) | Its own server; on git hosts, the writes it recorded making | [8](#8-acting-for-and-attribution) |
| Outside actor | Nothing: a git host account not linked to a member of this workspace | [8.2](#82-evidence-and-confidence) |
| Installation operator | Access to the server; named in the installation's configuration | [12](#12-self-hosted-installations) |

## 3. Sign-in for people

### 3.1 Sign-in methods

**Decided (owner, O-41, [#25](https://github.com/guneet-xyz/shinan/issues/25)):**
in the first version people sign in with GitHub, with Forgejo (including any
self-hosted Forgejo instance), with an email sign-in link, or with a password
that needs no second factor. There are no passkeys. Shinan sends email from the
first version.

How each method works, **proposed** unless marked:

- **GitHub.** Sign-in uses the same GitHub App that git host connections use
  ([git host integrations](git-hosts.md)). The person is identified by GitHub's
  stable account number, never by username or email. Shinan uses the
  authorization only to learn who signed in and keeps no GitHub token
  (owner, O-1). Reason: one app registration, and no stored per-person
  credential.
- **Forgejo.** Each Forgejo instance offered for sign-in is added by the
  installation operator, who registers Shinan as an OAuth2 application on that
  instance. The person is identified by the instance's address plus its stable
  account number. Reason: Forgejo has no way for an unknown application to
  register itself (its OAuth2 provider documents only discovery, authorize,
  token, userinfo and key endpoints), so each instance needs a registration;
  and an instance can assert any account on itself (T7), so adding one is a
  trust decision. Whether a person may instead add an instance by typing its
  address is a [decision for the owner](#decisions-needed-from-the-owner).
  - Forgejo's OAuth2 tokens have no scopes, and its documentation says tokens
    obtained through an instance-wide application carry administrative rights.
    For a site administrator, such as the owner on `git.guneet.dev`, each
    Forgejo sign-in therefore hands Shinan a full-power token for a moment.
    Shinan uses it once to read the account, then discards it and never
    stores or logs it. This is a residual risk of O-41.
- **Email sign-in link.** Shinan emails a link that works once, expires after
  15 minutes, and is sent at most a few times per hour per address. Reason:
  short life and single use limit a link read from a mailbox or a log. Whoever
  controls the email account can sign in (T1); NIST SP 800-63B-4 does not
  accept email as an authentication channel, which is the residual risk the
  owner accepted.
- **Password.** Follows NIST SP 800-63B-4's rules for a password used alone:
  at least 15 characters, a blocklist of common and breached passwords, no
  other composition rules, no forced periodic changes, password managers and
  paste allowed, and storage as a salted hash with a slow password-hashing
  scheme. Failed attempts are throttled per account and per address. Reason:
  with no second factor (O-41), the password's own strength and throttling are
  the only defences against guessing.
- A person can have several methods: for example a password, a GitHub account
  and a Forgejo account. Methods are added only while signed in; Shinan never
  attaches a method to a person because an email address matches. Reason:
  matching emails is a known way to take over accounts.
- Generic OpenID Connect providers may come later for self-hosted
  installations (D-012).

### 3.2 Who can have an account

**Decided (owner, O-42, O-48, [#25](https://github.com/guneet-xyz/shinan/issues/25)):**
an allowlist of email addresses decides who can have an account on an
installation. Joining a workspace still needs an invitation
([5.2](#52-invitations)).

**Proposed:**

- The allowlist is kept by the installation's operators. It starts with the
  addresses given in the installation's configuration, and operators change it
  in the installation's settings. Every change is recorded in the
  installation-level security log. Reason: only someone responsible for the
  installation should decide who can use it.
- An account is created the first time an allowlisted person signs in. Shinan
  then always sends an email link to the allowlisted address and creates the
  account only when it is opened, whatever method the person started with.
  Reason: GitHub and especially self-hosted Forgejo instances can report an
  email address Shinan cannot trust (T7); the allowlist means nothing unless
  Shinan checks the address itself.
- Removing an address from the allowlist ends that person's sign-in sessions,
  stops all sign-in methods, and revokes all their agent tokens in every
  workspace. Their past events keep their credit. Reason: an account that can
  no longer sign in should not keep working through its agents.
- Being on the allowlist grants nothing in any workspace.

### 3.3 Sign-in sessions and re-authentication

A **sign-in session** is a person's signed-in state in a browser. It is
different from an [agent session](domain-model.md#agent-session).

**Proposed:**

- Sign-in sessions end after 24 hours overall and after 1 hour without
  activity, the values NIST SP 800-63B-4 suggests for its middle assurance
  level. The operator can change them. Reason: the data is sensitive, and
  signing in again is quick.
- **Re-authentication** asks the person to sign in again with any of their
  methods, even inside a sign-in session, before a sensitive action, unless
  they did so in the last few minutes. Sensitive actions: approving an agent
  token, inviting, changing roles, removing members, adding or changing git
  host connections, changing workspace settings, adding or removing sign-in
  methods, purging, exporting and deleting a workspace. Reason: a sign-in
  session left open or stolen from a browser should not be enough for actions
  that change who can do what. Without a second factor it does not stop
  someone who holds the password or the email account (T1).
- A person can see their active sign-in sessions and end any or all of them
  ("sign out everywhere").
- Shinan emails the person when they sign in from a browser it has not seen
  before, when a sign-in method is added or removed, and when an agent token
  is approved. Reason: with no second factor, a quick alert is the main way a
  person learns that someone else is using their account.

### 3.4 Recovery

**Proposed:** a person who forgets their password, or loses access to their
GitHub or Forgejo account, signs in with an email link and sets things right.
Reason: email is already a sign-in method (O-41), so it is also the recovery
route. The consequence is that the email account is the root of every
account's security. The installation operator can also end a person's sign-in
sessions and remove their sign-in methods with a server command, which is
recorded. Reason: it saves a sole owner whose email account is lost.

### 3.5 Linking git host accounts

A person links their [git host accounts](domain-model.md#git-host-account) so
that activity on git hosts can be credited at all (D-017).

**Proposed:**

- An account is linked only by signing in to the git host, either as the
  person's sign-in method or, while already signed in, as an added method.
  Never by typing a username. Reason: otherwise anyone could claim someone
  else's account and take its credit.
- A link records the git host's address and stable account number, as well as
  the current username. Reason: usernames can be renamed; the number cannot.
- One git host account can be linked to only one person per installation.
  Shared team accounts are an [open question](#open-questions).
- A commit's author or committer email is never treated as an account
  ([8.2](#82-evidence-and-confidence)). Reason: commit emails are free text.
- Unlinking an account stops future credit to the person and removes it as a
  sign-in method. Past events keep their credit.

## 4. Workspaces

**Decided (D-019):** workspaces exist, hold a team's catalog, tasks, git host
connections and members, and people are invited to them.

**Proposed:**

- Any person on an installation can create a workspace and becomes its
  workspace owner. Reason: the allowlist already decides who is a person;
  operators can restrict this.
- A workspace always has at least one workspace owner. The last workspace
  owner cannot leave or lower their own role.
- The boundary rule from the glossary applies everywhere: agents, tokens,
  git host connections, search, the agent index, nudges and the security log
  belong to one workspace and never show anything from another. A person who
  is a member of two workspaces has separate memberships, agents and tokens in
  each. Reason: principle 2.
- When someone who is not a member of this workspace acts on a git host, the
  event is credited to an outside actor in this workspace, even if they are a
  member elsewhere. Reason: one workspace must not learn about another's
  members.
- **Decided (owner, O-59, [#25](https://github.com/guneet-xyz/shinan/issues/25)):**
  one repository is connected to at most one workspace in the first version.
- Deleting a workspace needs re-authentication, and all its agents' tokens
  stop working at once. A grace period before erasure comes later
  ([13](#13-first-version-scope)).
- Moving tasks or catalog entities between workspaces is not supported in the
  first version.

## 5. Members, roles and invitations

### 5.1 Roles and permissions

**Proposed** in the glossary: three roles, workspace owner, contributor and
viewer, and every role may register agents. **Proposed** here: the table below.
Reason: each row is an action another document defines; this table is the one
place that says who may take it.

Key: ✓ allowed; ✗ not allowed; "own" means only for themselves or their own
agents. The agent column is the most an agent can do; it also never exceeds its
member's role ([6.3](#63-what-an-agent-may-do)).

| Action | Workspace owner | Contributor | Viewer | Agent |
|---|---|---|---|---|
| Read everything in the workspace: catalog (wiki, agent index), tasks, timelines, presence | ✓ | ✓ | ✓ | ✓ |
| Create, claim, update tasks and subtasks; add work links; record verification | ✓ | ✓ | ✗ | ✓ |
| Comment on tasks | ✓ | ✓ | ✗ | ✗ (agents post progress updates) |
| Post progress updates on its task | – | – | – | ✓ |
| Send nudges | ✓ | ✓ | ✗ | ✗ (nudges come from people) |
| Accept or cancel tasks in `triage`; set `cancelled` or `on hold` | ✓ | ✓ | ✗ | ✗ |
| Set or clear `needs a person`, with a summary | ✓ | ✓ | ✗ | ✓ (O-7) |
| Set `awaiting deployment approval` (ask for approval) | ✓ | ✓ | ✗ | ✓ |
| Give a deployment approval | ✓ | ✓ where workspace settings allow | ✗ | Only to record one its own member gave in the agent's conversation (O-20) |
| Make catalog proposals | ✓ | ✓ | ✗ | ✓ |
| Approve gated catalog proposals | ✓ | ✓ | ✗ | ✗ |
| Register agents; approve, view and revoke their tokens | own | own | own, read-only scopes | ✗ |
| Disable any agent, revoke any token in the workspace | ✓ | ✗ | ✗ | ✗ |
| Invite people; withdraw invitations | ✓ | ✗ | ✗ | ✗ |
| Change roles; remove members | ✓ | ✗ | ✗ | ✗ |
| Add, change or remove git host connections | ✓ | ✗ | ✗ | ✗ |
| Change workspace settings, including the workspace's task flags | ✓ | ✗ | ✗ | ✗ |
| Read the workspace security log | ✓ | own entries | own entries | ✗ |
| Correct the credit on an event from their own git host account | own | own | own | ✗ |
| Purge, export or delete the workspace | ✓ | ✗ | ✗ | ✗ |

Notes:

- The task rows follow [Tasks and work](tasks.md) and the owner's answers:
  agents may set and clear `needs a person` (owner, O-7); deployment approval
  is given in Shinan, or in the conversation as recorded by the agent, never by
  comment or nudge (owner, O-20); task flags are managed per workspace (owner,
  O-8), so managing them is a workspace setting; a task is done when its
  subtasks are done and its delivering pull requests are merged (owner, O-21).
- Only gated, high-risk catalog changes need approval (owner, O-3), and only
  people approve them. **Decided (owner, O-46):** a person may approve a
  proposal made by their own agent while one person uses Shinan; the approval
  is recorded as the person's action, separate from the proposal.
- An agent recording a deployment approval may record only one given by its
  own member, in its own conversation. The record says "approved by Guneet in
  conversation, recorded by OpenCode on Daedalus". **Proposed**; reason: O-20
  allows conversation approvals, and showing who recorded it keeps the
  evidence honest, because Shinan did not see the approval itself.
- **Only workspace owners invite** in the first version. **Proposed**; reason:
  every member sees everything (O-43), so letting someone in stays with the
  people accountable for the workspace.
- **Viewers may register read-only agents** (also in the glossary).
- Because every member sees everything (O-2, O-43), a viewer sees the same
  infrastructure details and private-repository work as a workspace owner.
  The invitation screen says so ([human experience](human-experience.md)).

### 5.2 Invitations

**Decided (owner, O-48, [#25](https://github.com/guneet-xyz/shinan/issues/25)):**
joining a workspace needs an invitation, separately from the allowlist. The
states (`pending`, `accepted`, `declined`, `expired`, `withdrawn`) are proposed
in the [glossary](domain-model.md#invitation).

**Proposed:**

- An invitation names a role and an **email address**. Shinan emails the link
  to that address. Reason: Shinan sends email from the first version (O-41),
  and the allowlist is keyed on email.
- An address that is not on the allowlist cannot be invited; the screen asks
  the inviter to have an operator add it first. Reason: the two decisions stay
  separate, as O-48 requires, and inviting does not quietly widen who can have
  an account.
- To accept, the invitee must be signed in as a person whose verified email is
  the invited address. A leaked link alone is useless unless the email account
  is also controlled (T3).
- Links are single-use, expire after 7 days and can be withdrawn before
  acceptance.
- Before the invitee signs in, the acceptance page shows only the
  installation's name.
- Creating, withdrawing, accepting and declining are recorded in the security
  log.

### 5.3 Leaving, removal and role changes

**Proposed:**

- A workspace owner can remove a member; a member can leave. Either takes
  effect on the next request: the person loses access to the workspace, and
  all their agents in it are disabled and their tokens revoked. Reason: an
  agent acts for a member, so it cannot outlive the membership.
- Their past events stay credited to them. Future git host activity from their
  account is credited to an outside actor.
- What happens to their assignments and claims is owned by
  [Tasks and work](tasks.md); the default proposed here is that claims are
  released and assignments stay visible as belonging to a former member.
- Lowering a role takes effect immediately for the person and their agents,
  because an agent's effective permissions are worked out on every request.
- Removal from Shinan does not remove access on git hosts, and the removed
  member has already seen everything in the workspace (O-43). Shinan reminds
  the workspace owner of both. Reason: Shinan cannot change git host access,
  and the owner may need to rotate whatever the catalog pointed to.

### 5.4 Groups of members

**Proposed:** no groups (teams) inside a workspace. Reason: everyone sees
everything (O-43), so groups would only be needed for ownership labels, which
the catalog's entity owner covers.

## 6. Agents

### 6.1 What one agent is

**Decided (owner, O-40, [#25](https://github.com/guneet-xyz/shinan/issues/25)):**
an agent is per person, coding tool and machine, for example "Guneet's OpenCode
on Daedalus". **Decided:** agents connect from outside (D-008) and act for a
person (D-017). **Proposed in the glossary:** an agent belongs to one
workspace, acts for exactly one member, and never does more than that member.

**Proposed:**

- The machine is part of the agent's name and is chosen or confirmed by the
  person when they approve the agent's first token. It can point to a
  `machine` catalog entity. It is still only a label: a token copied off the
  machine works anywhere (T2).
- The clients on one machine (the MCP client, the plugin, the CLI) act as that
  machine's agent. They may share one token or each hold their own; either way
  all their actions are credited to the same agent. Which they do is for
  [agent integrations](agent-integrations.md). Reason: tokens do not rotate
  (O-44), so sharing is safe; the choice is about setup convenience.
- Losing or retiring a machine (as Takezo was in November 2026) means
  disabling the agents on it, which revokes all their tokens and nothing else.
- Every subagent is its own agent session of the same agent (owner, O-37).

### 6.2 Registering an agent

**Proposed** flow, for a coding tool connecting to Shinan's MCP server with its
built-in MCP sign-in:

```mermaid
sequenceDiagram
  participant T as Coding tool on a machine
  participant B as Person's browser
  participant S as Shinan
  T->>S: MCP request without a token
  S-->>T: Sign-in required, with where to sign in
  T->>B: Open Shinan's approval page (authorization code with PKCE)
  B->>S: Person signs in and re-authenticates
  S->>B: Show workspace, coding tool, scopes; ask which machine
  B->>S: Choose or create the agent for this tool and machine; reduce scopes; approve
  S-->>T: Long-lived token for that agent, bound to Shinan's MCP address
  S->>S: Record in security log; email the person
```

- This follows the MCP authorization specification (revision 2026-07-28):
  OAuth 2.1 with the authorization code flow, PKCE, a browser redirect, and
  resource indicators (RFC 8707). Shinan's approval page is its own consent
  screen, so it asks there for the agent and machine, which the protocol does
  not carry. Tokens are accepted only at Shinan's MCP address, as the
  specification requires servers to check.
- Under O-44 Shinan issues a token that is valid until revoked, with no
  refresh step.
- **Headless runs** that cannot open a browser: the person creates a token for
  the agent in the web app (with re-authentication), sees it once, and places
  it on the machine, for example as an environment variable the coding tool
  sends as a header. Reason: some tools cannot run the browser flow; the MCP
  specification has no device flow.
- The token goes straight to the tool or to the person, never through a chat,
  issue or file in a repository. The `workspace` repository's policy already
  forbids pasting credentials into conversations.

Only people register agents and approve tokens. An agent cannot create another
agent or a token, not even for itself (principle 4).

### 6.3 What an agent may do

**Proposed:** an agent's effective permissions on every request are what all
three of these allow:

1. its member's current role ([5.1](#51-roles-and-permissions));
2. its token's scopes ([7.2](#72-scopes));
3. the list of actions reserved for people.

**Reserved for people** (no agent may do these, whatever the role or scopes):

- approve or reject catalog proposals;
- invite people, change roles, remove members;
- register agents, approve or change tokens, or change scopes;
- add or change git host connections or workspace settings;
- read the workspace security log;
- correct attribution;
- send nudges or comments (agents post progress updates instead);
- give a deployment approval (an agent may only record one its own member gave
  in the agent's conversation, O-20);
- purge, export or delete a workspace;
- accept a task out of `triage`, set `cancelled` or `on hold`, and anything else
  [Tasks and work](tasks.md) or [Catalog](catalog.md) reserves for people.

Reason: these actions either change who can do what, or are themselves the
human check. A stolen or misled agent (T2) must not be able to widen its access
or approve its own work. Attempts are refused and recorded ([11](#11-audit)),
because an agent trying them is a warning sign.

Because an agent uses its member's git host account (D-017), it can do on the
git host whatever the member can. Shinan cannot limit that. **Decided (owner,
O-1):** anything a person wants done on a git host is done by an agent on that
person's own machine, authenticated to the git host; Shinan does not do it for
them.

### 6.4 Agent sessions

**Proposed:**

- An agent session exists only through its agent's token. Shinan matches calls
  to an agent session by the conversation ID the coding tool reports, and
  refuses writes when it disagrees with the ID the model passes (owner, O-29).
- The token proves which **agent** acted, which now also says which machine it
  was approved for. Which **agent session** acted is reported by the tool and
  is only as reliable as the tool.
- "Plugin-reported" and "self-reported" presence describe how reliable the
  reports are, not how secure they are.

### 6.5 Nudges from other people

A nudge puts a person's message into a running agent session. That session
holds its own member's git host access. A nudge from another member could steer
it into repositories that member cannot reach (T9).

- **Decided (owner, O-31):** nudges from the agent's own member are delivered
  to act on at once (`steer`); nudges from others wait for a break in the
  agent's work (`queue`), unless the sender overrides.
- **Proposed:** nudges from other members are always visibly framed as coming
  from another member, by name, and the agent's instructions treat them as
  requests within the current task, never as permission to widen scope.
  Each member can turn off nudges from others for each of their agents.
  Viewers cannot nudge. Every nudge is recorded. Reason: the plan's Nudges
  pillar depends on reviewers reaching the working agent; framing and an
  opt-out limit steering without removing that.

### 6.6 Launchers (phase 3)

**Decided (owner, O-1):** agents started from the platform run OpenCode on
hardware the person registers by installing the launcher, with a setup guide
for such devices (a VM, a MacBook and so on).

**Proposed:** installing the launcher runs the same browser approval as
[6.2](#62-registering-an-agent): the person signs in, re-authenticates, names
the machine and approves. The launcher receives its own token, separate from
agent tokens, that only lets it receive start requests for agents of that
person on that machine. Disabling the machine revokes the launcher too. The
setup guide belongs to [agent integrations](agent-integrations.md). Reason:
starting agents is more powerful than any one agent's work in Shinan, so it
gets its own revocable credential.

## 7. Tokens

### 7.1 Kinds of credential

**Proposed.** Reason: listing every credential in one place makes it easier to
see that each one is narrow and can be revoked.

| Credential | Held by | Lets the holder | Lifetime |
|---|---|---|---|
| Sign-in session | A person's browser | Act as the person in the web app | 24 hours, 1 hour idle ([3.3](#33-sign-in-sessions-and-re-authentication)) |
| Password | The person; Shinan keeps a salted hash | Start a sign-in session | Until changed |
| Email sign-in link | The person's mailbox | Start one sign-in session | 15 minutes, once |
| Agent token | The clients of one agent on one machine | Act as that agent in one workspace, within its scopes, at Shinan's MCP address | Until revoked (owner, O-44) |
| Invitation link | The invitee's mailbox | Accept one invitation, once signed in with the invited address | 7 days, once |
| GitHub App private key and installation tokens | The Shinan server | Read from GitHub and make Shinan's own writes, as the app | Key until rotated; installation tokens 1 hour ([git host integrations](git-hosts.md)) |
| Forgejo connection token | The Shinan server, encrypted | Read from Forgejo and make Shinan's writes, as the connecting person ([9.3](#93-git-host-connections)) | Set by the person on Forgejo |
| Webhook secrets | The Shinan server and a git host | Prove a webhook came from that host | Owned by [git host integrations](git-hosts.md) |
| Launcher token (phase 3) | One machine | Receive start requests for that person's agents on that machine | Until revoked ([6.6](#66-launchers-phase-3)) |

**Decided (owner, O-1):** Shinan stores no per-person git host tokens. Tokens
received during GitHub or Forgejo sign-in are used once to learn who signed in
and then discarded.

**Proposed:** no personal API tokens for people. The CLI uses an agent token.
Reason: a person's token on a machine where agents run would let any agent
there act as the person, defeating both attribution and the reserved-for-people
rule.

### 7.2 Scopes

**Proposed** starting scopes:

| Scope | Allows |
|---|---|
| `catalog:read` | Read the catalog and the agent index |
| `catalog:propose` | Make and withdraw catalog proposals |
| `tasks:read` | Read tasks, work links and timelines |
| `tasks:write` | Create, claim and update tasks and subtasks; add work links; record verification; post progress updates; set the flags agents may set |
| `presence` | Report agent sessions and presence; receive nudges |

A normal agent gets all five; a read-only agent gets the two `read` scopes.
Reason: splitting reading from writing is the line that matters most when a
long-lived token leaks. Because there is no restricted level (O-2), a `read`
scope reads everything in the workspace.

### 7.3 Lifetime

**Decided (owner, O-44, [#25](https://github.com/guneet-xyz/shinan/issues/25)):**
agent tokens last until revoked: no short-lived access tokens, no rotation and
no forced re-approval.

**Proposed**, to make revocation easy to use:

- The agent page shows, for each token, when and from what network address it
  was last used, and marks tokens unused for 30 days. Nothing expires; the mark
  only helps the person decide what to revoke.
- Removing a member, disabling an agent, removing someone from the allowlist,
  and deleting a workspace revoke tokens automatically.

### 7.4 Handling

**Proposed:**

- A token is shown once, if at all, and Shinan stores only a one-way hash of
  it. Reason: a copy of Shinan's database must not contain usable tokens.
- Tokens start with a recognisable prefix. Reason: leak scanners, and later
  Shinan itself, can then spot them in text.
- Tokens are sent in a request header, never in a web address, and are
  accepted only at the address they were issued for. Reason: the MCP
  specification requires both.
- Later, Shinan refuses text (comments, catalog proposals, progress updates)
  that contains one of its own tokens, and revokes that token
  ([13](#13-first-version-scope)).
- How a coding tool stores the token on the machine is owned by
  [agent integrations](agent-integrations.md); the machine's own credential
  store is preferred over a plain file.

### 7.5 Revocation

**Proposed:**

| Action | Who can do it | Effect |
|---|---|---|
| Revoke one token | Its member; a workspace owner | That token stops working |
| Disable an agent (that is, one machine's agent) | Its member; a workspace owner | All its tokens stop working |
| Disable a machine | The person, for their own agents and launcher on it | All their agents and the launcher on that machine stop working |
| Remove a member or lower a role | A workspace owner | See [5.3](#53-leaving-removal-and-role-changes) |
| Sign out everywhere | The person | Ends all their sign-in sessions; optionally revokes all their agent tokens in every workspace |
| Remove from the allowlist | An installation operator | See [3.2](#32-who-can-have-an-account) |

- Revocation takes effect on the next request: Shinan checks on every request
  that the token is still valid. Reason: long-lived tokens (O-44) make instant
  revocation the main control.
- When a running agent session loses its token, its next call fails, Shinan
  records an event, and the session is shown as having lost access. Claims are
  handled as [Tasks and work](tasks.md) decides.
- Revoking access to Shinan does **not** revoke the agent's git host access,
  which is its member's own credentials on that machine (D-017). Shinan reminds
  the person of this.

## 8. Acting for and attribution

### 8.1 The problem

**Decided (D-017):** agents use the same git host account as the person they
work for, and Shinan must tell people and agents apart from its own records.
This is a known limitation other adopters will share.

When something happens on a git host, the host reports which **account** did
it (for example GitHub's webhook `sender`, which is sometimes a placeholder
`ghost` user). Nothing says whether the person or one of their agents was at
the keyboard. The owner tried a separate Forgejo account for agent work and
disabled it for consistency with GitHub (the `workspace` repository's Forgejo
service entry), which supports D-017's reason.

### 8.2 Evidence and confidence

The glossary **proposes** four confidence levels. This document **proposes**
which account an item counts as coming from, and the rules that assign the
levels.

**Which account:**

- For pull requests, issues, comments, reviews and merges, the account is the
  one the git host reports as the actor.
- For commits, the account is the one that **pushed** them. Author and
  committer fields are never evidence, and GitHub's own matching of commit
  emails to accounts is ignored. Reason: those fields are free text.
- Items Shinan wrote itself are recognised by their stored item IDs, not by
  the account ([9.3](#93-git-host-connections)).

**Levels:**

| Confidence | When | Credited to |
|---|---|---|
| `recorded` | The action came through Shinan with a valid sign-in session or agent token. | The person; or the agent session, if it belongs to that agent, otherwise the agent. |
| `recorded` | Shinan made the write on a git host itself and its record of writes holds the item ID the host returned. | Shinan. |
| `marked` | A git host item carries a marker naming an agent session that passes the checks in [8.3](#83-checking-markers); or (later) a commit is signed with a key registered to one agent ([8.4](#84-stronger-evidence-agent-signing-keys)). | That agent session (or agent). |
| `inferred` | No confirmed marker, but Shinan's records point one way: one of the person's agent sessions was active, attached to a task linked to this item and reporting this repository at the time; or **none** of the person's connected agent sessions was active. | "Probably" that agent session; or the person, labelled "no connected agent active". |
| `unknown` | The account is linked to a member but nothing points either way. | "The person or one of their agents". |
| (outside actor) | The account is not linked to any member of this workspace. | The git host account itself. |

Reasons:

- Only actions through Shinan were seen by Shinan, so only they are
  `recorded`. Shinan's own git host writes count only when matched by stored
  ID; a hidden marker in a comment never counts, because anyone using the
  account can type it (owner, O-53).
- "No connected agent active" keeps direct human actions on git hosts from all
  showing as `unknown`, while saying what Shinan knows rather than guessing.
  The owner's agents do most routine git host work, and during the trial some
  agents will not be connected, so [8.6](#86-accountability-and-known-limits)
  tests the rule.
- With an agent per machine (O-40), crediting an agent also says which machine
  the work came from.

### 8.3 Checking markers

The marker format is owned by [Tasks and work](tasks.md) and
[agent integrations](agent-integrations.md). A marker is plain text that anyone
using the account can type, and agents copy text between pull requests.

**Proposed:** a marker counts as `marked` only if:

1. the agent session it names exists in this workspace;
2. that session's agent acts for the person whose account made the item (for
   commits, the account that pushed them);
3. the session had started and had not long ended when the item was made;
4. the item's repository is one the session reported working in, or is linked
   to the session's task.

If any check fails, the event notes "marker not confirmed" and the other rules
apply.

### 8.4 Stronger evidence: agent signing keys

**Proposed as a later step:**

- Each agent (one per machine, O-40) gets its own commit-signing key, which
  the person adds to their git host account. Commits signed with that key are
  credited to the agent as `marked`.
- GitHub verifies SSH-signed commits (Git 2.34 or later) and has a separate
  signing-only key type. Forgejo verifies them too (inherited from Gitea pull
  request 17743; checked in the v16.0.5 source: the key must be verified and
  the committer email must be one of the account's activated addresses), but
  has **no signing-only key type**, so on Forgejo a stolen signing key could
  also push as the person.
- Limits: commits only; squash merges made by the host carry the host's
  signature; the key proves "this machine's agent setup", not "no person
  touched it".

### 8.5 Showing and correcting credit

- Every credited event shows its confidence. **Decided (owner, O-91):** when
  attribution is `unknown`, text events are shown at full prominence and
  labelled as unsure; routine events stay compact.
- **Proposed:** a person may correct the credit on events from their own git
  host account, for example "this merge was me, not my agent". The correction
  is a new event; the original is kept. Agents cannot correct credit. Reason:
  the person knows; events are not edited; a misled agent must not rewrite
  history.

### 8.6 Accountability and known limits

**Proposed:** the person is accountable for everything done with their git
host account and by their agents. Known limits (D-017):

- Attribution helps people understand and review work. It is **not** a
  security control against the account holder.
- An agent that never connects to Shinan is invisible to it.
- The git host's records remain the authority on which **account** acted.
- The proof of concept measures the share of events in each confidence level
  and checks "no connected agent active" against people's corrections; if it
  is often wrong, the rule is dropped and those events become `unknown`
  ([roadmap](roadmap.md)).

## 9. Access rules

### 9.1 How every request is checked

**Proposed:** every request, from any path (web app, MCP server, CLI, plugin,
agent index, search, export, the catalog's Git mirror if it is served by
Shinan), goes through the same checks:

1. **Who is acting:** a person through a sign-in session, or an agent through
   its token. Otherwise refuse.
2. **Which workspace:** the person must be a member, or the agent's member
   must be. Otherwise refuse, with the same answer as for a workspace that does
   not exist.
3. **Role:** the member's role must allow the action ([5.1](#51-roles-and-permissions)).
4. **Agent limits:** for agents, the token's scopes and the reserved-for-people
   list ([6.3](#63-what-an-agent-may-do)).
5. **Re-authentication:** sensitive actions need a recent sign-in
   ([3.3](#33-sign-in-sessions-and-re-authentication)).

Reason: when different paths check differently, one of them eventually leaks,
and one place to add rules avoids rework later (D-019).

### 9.2 Visibility inside a workspace

**Decided (owner, O-2, O-43, [#25](https://github.com/guneet-xyz/shinan/issues/25)):**
every member of a workspace sees everything in it, including work from private
repositories. There is no restricted catalog level. Links to private
repositories stay protected by GitHub's or Forgejo's own access control; the
titles and summaries Shinan stores are visible to all members.

Consequences, **proposed** where not decided:

- Every member's agents see the same: a `read` scope reads the whole
  workspace ([7.2](#72-scopes)).
- A team that needs separation uses separate workspaces. Reason: the
  workspace is the only boundary (principle 2).
- Workspace owners should connect only repositories whose titles and
  summaries every member may see; the connection screen says so.
- Plan question 3 (a member who can see a task but not a linked private
  repository) is answered by O-43: the member sees what Shinan stores, and the
  git host decides whether the link opens.

### 9.3 Git host connections

[Git host integrations](git-hosts.md) owns how connections work. This document
owns who may manage them, whose access they carry and how Shinan's own writes
are credited.

- **Proposed:** only workspace owners add, change or remove git host
  connections, with re-authentication.
- **Decided (owner, O-1, O-51):** on GitHub, Shinan connects through a GitHub
  App and uses only its installation token. Shinan's own writes (such as
  backlinks) appear as the app. Shinan never writes as a person.
- **Decided (owner, O-53):** on Forgejo, Shinan uses the connecting person's
  own account, so Shinan's writes appear as that person. Shinan recognises its
  own writes only by the item IDs it stored when writing.
- **Decided (owner, O-54):** Shinan accepts any Forgejo token, stores it
  encrypted, and states the residual risk: if the connecting person is a site
  administrator and gives a broad token, that token can act as any user on
  the instance, so anyone who steals it (for example from a database copy plus
  the encryption key) controls that Forgejo. **Proposed:** the token is never
  shown again, logged or given to agents, and Shinan uses it only for the calls
  git host integrations lists. Reason: these are the only controls left once
  any token is accepted.
- **Proposed:** activity from the connecting person's account is credited by
  the normal rules ([8.2](#82-evidence-and-confidence)), except items in
  Shinan's record of writes, which are credited to Shinan.

## 10. Protections for a public installation

**Decided (D-015):** security for a public sign-in app gets extra attention in
this document and the [architecture](architecture.md) document. This section
lists what Shinan must do; the architecture document decides how, along with
transport security, browser protections and dependency updates.

**Decided (owner, O-45, O-68):** the agent-facing parts of
`shinan.guneet.dev` are public behind tokens, and there is no extra sign-in
layer in front of the pages in the first version. A private-network
restriction stays possible later.

**Proposed:**

- **Nothing without sign-in** except the sign-in pages, the invitation
  acceptance page and a minimal health check. The wiki and agent index are
  behind sign-in too.
- **Throttling** of password attempts (per account and per address), of
  sign-in and invitation emails (so Shinan cannot be used to flood a mailbox),
  and of failed token use. Failures are recorded.
- **Breached-password blocklist** and NIST's password rules
  ([3.1](#31-sign-in-methods)).
- **Uniform answers** that do not reveal whether an email address is
  allowlisted or whether a person, workspace, task or repository exists.
  Reason: probing for names leaks information.
- **Security emails** on new-browser sign-ins, sign-in method changes and new
  agent tokens ([3.3](#33-sign-in-sessions-and-re-authentication)).
- **Narrow, hashed tokens checked on every request** ([7](#7-tokens)).
- **Outside text is data, not instructions.** The
  [agent integrations](agent-integrations.md) document makes MCP answers show
  where text came from. Reason: the `workspace` repository's policy already
  treats commands found in issues and logs as data.

The residual risks of the owner's choices are listed with the
[threats](#threats-and-residual-risks).

## 11. Audit

The **security log** records, as [events](domain-model.md#event) of security
kinds (**proposed**):

| Area | Recorded |
|---|---|
| Sign-in | Sign-ins and failures by method, email links sent and used, password changes, re-authentications, sign-in methods added or removed, sign-in sessions ended |
| Accounts | Allowlist additions and removals; accounts created |
| Membership | Invitations created, withdrawn, accepted, declined, expired; role changes; removals; leaving |
| Agents and tokens | Agents created, renamed, disabled; tokens approved and revoked (and why); each token's first and last use, network address and number of requests |
| Workspace | Git host connections added, changed, removed; settings changed; exports; purges; deletion |
| Approvals and credit | Catalog approvals; deployment approvals, including who recorded them; attribution corrections |
| Refusals | Requests refused by the checks in [9.1](#91-how-every-request-is-checked), especially agents attempting reserved actions |
| Operator | Account resets and installation setting changes |

- Each entry records the actor and confidence, time, network address, the
  client described by the request, what changed, and the outcome.
- Workspace owners see their workspace's log; each person sees their own
  entries; operators see installation-level entries. Reason: the log holds
  network addresses, which are personal data.
- Reads are recorded as per-token summaries and as bulk reads (agent index
  downloads, exports), not page by page.
- **Decided (owner, O-47):** the security log is kept forever.
- **Decided (owner, O-50):** only workspace owners can purge, including
  operational records about their workspace (raw webhook deliveries, job
  records, logs); installation operators cannot. **Proposed:** purging a
  security-log entry replaces its content but leaves the record and a purge
  event naming who purged it, and purge events themselves cannot be purged.
  Reason: a workspace owner's account taken over through T1 must not be able
  to erase its own traces.
- Installation-level entries (sign-in attempts, allowlist changes) belong to no
  workspace, so under O-50 nobody can purge them. See
  [decisions needed](#decisions-needed-from-the-owner).
- Residual risks: an operator with database access can still change entries,
  and with no built-in backups (O-62 to O-64) the log is only as durable as
  the host's disk.

## 12. Self-hosted installations

**Decided (D-012):** Shinan is self-hostable by design.

**Proposed:**

- The **installation operator** can read and change everything in the
  installation's storage. Shinan cannot protect a workspace from its own
  operator, and documentation says so.
- In the app, operators are the people named in the installation's
  configuration. They keep the allowlist, add Forgejo instances for sign-in,
  and change installation settings. They are not members of any workspace by
  being operators and cannot purge (O-50).
- On `shinan.guneet.dev`, the owner is both operator and sole workspace owner.

## 13. First version scope

**Decided (owner, O-49, [#25](https://github.com/guneet-xyz/shinan/issues/25)):**
D-019 is read as "design now, build before the second member", in three
stages. The contents below follow the owner's other answers (O-1, O-2, O-41,
O-43, O-44, O-47, O-48, O-50).

| Built in version 1 | Designed now, built before a second member joins | Later |
|---|---|---|
| Person, member, role and workspace recorded on every record; the owner is the only workspace owner | The invitation flow by email ([5.2](#52-invitations)) | Workspace deletion grace period and restore |
| The single check path ([9.1](#91-how-every-request-is-checked)) | Contributor and viewer roles enforced in screens and checks ([5.1](#51-roles-and-permissions)) | Generic OpenID Connect sign-in |
| Sign-in by GitHub, Forgejo (operator-listed instances), email link and password, with NIST password rules; email sending | Removal and role-change effects ([5.3](#53-leaving-removal-and-role-changes)) | Agent signing keys ([8.4](#84-stronger-evidence-agent-signing-keys)) |
| The email allowlist; sign-in session limits; re-authentication; security emails | Nudges from other members: framing and the per-agent opt-out ([6.5](#65-nudges-from-other-people)) | The launcher token (phase 3, [6.6](#66-launchers-phase-3)) |
| Linking git host accounts through sign-in | Security log views for members other than the workspace owner | Refusing text that contains Shinan tokens ([7.4](#74-handling)) |
| Agent registration through browser approval, per machine; scopes; headless tokens; revocation | | Full read logging, if ever needed |
| Hashed tokens with a recognisable prefix; throttling; uniform errors | | |
| The security log, kept forever, readable by the workspace owner; purge limited to workspace owners wherever purge is built | | |
| Attribution: which account counts, confidence levels, marker checks, corrections, Shinan's writes recognised by stored ID | | |

## Proposed glossary additions

**Proposed** for the [domain model and glossary](domain-model.md), with this
document as owner. Reason: one vocabulary needs one home.

| Term | Definition |
|---|---|
| Sign-in method | A way a person proves who they are: GitHub, Forgejo, an email sign-in link or a password (O-41). |
| Allowlist | The installation's list of email addresses that may have an account (O-48). |
| Re-authentication | Signing in again before a sensitive action, inside a sign-in session. |
| Scope | One kind of action an agent token allows. |
| Revocation | Making a token, agent, sign-in session or membership stop working at once. |
| Security log | The record of security-relevant events in a workspace or installation. |
| Installation operator | Whoever runs the server of a Shinan installation; in the app, the people its configuration names. |
| Launcher token | The credential a launcher uses on one registered machine (phase 3). |

Changes to existing glossary entries:

- **Agent:** one per person, coding tool and machine (O-40).
- **Token:** valid until revoked (O-44); belongs to one agent, and so to one
  machine.
- **Invitation:** "invitee address" is an email address that is on the
  allowlist.

## Dependencies on other documents

Sibling drafts were read on 2026-11-16 at the commits named; they had not yet
applied the owner's answers, so mismatches below may already be fixed.

| Document | What this document needs from it, and remaining mismatches |
|---|---|
| [Domain model and glossary](domain-model.md) (8bb5d65) | The [additions above](#proposed-glossary-additions); agent per machine (O-40); subagents as agent sessions (O-37); subtasks (O-21); purge as the answer to event redaction. |
| [Catalog](catalog.md) (6613b55) | Secrets never in the catalog, with pointers to a secrets manager (O-2). **Mismatch:** its restricted level and token permission for restricted content are dropped by O-2. Who may read the always-on Git mirror (O-11): if the mirror is hosted on a git host, its access is controlled by that host, not by workspace membership. |
| [Tasks and work](tasks.md) (8d8e010) | Marker format; reserved-for-people task actions; how an agent-recorded deployment approval is shown (O-20); task flags per workspace (O-8); claims on revocation or removal. |
| [Git host integrations](git-hosts.md) (87d9cf2) | GitHub App used for sign-in as well as connections; installation token only (O-1, O-51); Forgejo with the connecting person's account and any token (O-53, O-54); stored write IDs; the pusher for commits; Forgejo SSH signing on `git.guneet.dev` before signing keys. **Mismatch:** any remaining per-person user tokens or the separate `shinan` account. Forgejo sign-in on operator-listed instances (O-41). |
| [Agent integrations](agent-integrations.md) (6bea8fb) | Registration flow in each tool; whether one machine's clients share one token (now safe, O-44); headless tokens from the web app; framing of nudges from other members; the launcher setup guide (O-1). **Mismatch:** any text relying on rotating grants or one agent per person and tool. |
| [Human experience](human-experience.md) (2ff4925) | Screens for the four sign-in methods, re-authentication, the allowlist, agent approval with machine, token last-use, the security log, attribution confidence, and the "everyone sees everything" warnings. **Mismatch:** any hidden-item display for private repositories (dropped by O-43). |
| [Architecture and operations](architecture.md) (5ce42de) | Email sending from version 1 (O-41); password hashing; throttling; token hashing and per-request checks; encrypted Forgejo tokens (O-54); security log stored forever (O-47). **Mismatch:** its purge section lets operators purge operational records and its prune job expires security log entries; O-47 and O-50 change both. Its threat table asks for tokens without restricted content, which O-2 removes. |
| [Roadmap and migration](roadmap.md) (6e4f795) | The [first version scope](#13-first-version-scope); measuring attribution in the proof of concept; no backups before migration (O-62). |
| [Decision log](decisions/) (fc8a613) | Records mapping O-1, O-2, O-40 to O-50, O-53, O-54 and O-59 to decision numbers. |

## Sources checked

All checked on 2026-11-16.

- NIST, [SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)
  (August 2025): rules for passwords used alone (15 characters minimum,
  blocklist, no composition rules, salted hashing, throttling); AAL2
  reauthentication guidance (24 hours, 1 hour idle); email not accepted for
  out-of-band authentication.
- Model Context Protocol, [Authorization](https://modelcontextprotocol.io/specification/latest/basic/authorization)
  (2026-07-28 revision): OAuth 2.1 with authorization code, PKCE and resource
  indicators; audience checks; tokens only in the Authorization header; no
  device grant.
- IETF, [RFC 8707: Resource Indicators for OAuth 2.0](https://www.rfc-editor.org/rfc/rfc8707).
- GitHub Docs, [Webhook events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads)
  (`sender`, `ghost`); [About commit signature verification](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification)
  and [Adding a new SSH key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/adding-a-new-ssh-key-to-your-github-account)
  (signing key type).
- Forgejo Docs v17.0, [OAuth2 provider](https://forgejo.org/docs/latest/user/authentication/oauth2-provider/)
  (endpoints; no scopes; administrative rights through instance-wide
  applications) and [Access token scope](https://forgejo.org/docs/latest/user/authentication/token-scope/)
  (site administrators' tokens can act as other users with `sudo`).
- Forgejo source at `v16.0.5`,
  [`ssh_key_object_verification.go`](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/models/asymkey/ssh_key_object_verification.go)
  and [`ssh_key.go`](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/models/asymkey/ssh_key.go);
  [Gitea pull request 17743](https://github.com/go-gitea/gitea/pull/17743).
- The owner's answers, [issue #25](https://github.com/guneet-xyz/shinan/issues/25).
- The `workspace` repository (read-only background): `docs/access-and-safety.md`,
  `docs/collaboration.md`, `catalog/services/forgejo.md`.

## Open questions

1. **Re-authentication window.** How many minutes count as "recent" for
   sensitive actions?
2. **Self-approval in teams.** When a second member joins, should approving
   your own agent's gated catalog proposal need someone else (O-46 covers one
   person only)?
3. **Nudges from other members.** Should they be off by default in workspaces
   with several members?
4. **Scripts and automation.** Do people need tokens for non-agent automation,
   and as what kind of actor?
5. **Repository-limited tokens.** Should an agent token be limitable to some
   repositories or projects?
6. **Shared git host accounts.** How to credit an account several people use.
7. **Workspace deletion grace period** and **moving items between
   workspaces**.
8. **Full read logging.** Is it ever needed beyond per-token summaries and
   bulk reads?
9. **Attribution reliability** (plan question 2), measured in the proof of
   concept ([8.6](#86-accountability-and-known-limits)).

## Decisions needed from the owner

New questions raised by the answers in
[issue #25](https://github.com/guneet-xyz/shinan/issues/25):

| # | Decision | Recommended option | Why, in one line |
|---|---|---|---|
| 1 | Which Forgejo instances can be used for sign-in (O-41 says any self-hosted instance) | Any instance, but added by an installation operator, not typed in by a person | Forgejo needs an app registered per instance, and an instance can assert any account on itself. |
| 2 | Who can purge installation-level security-log entries, which belong to no workspace (O-50 excludes operators) | Nobody, for now; revisit if a deletion request arrives | Keeps the log complete, which matters more without a second factor; the gap is stated. |
