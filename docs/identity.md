# Identity, agents and permissions

Status: **draft for review** ([issue #7](https://github.com/guneet-xyz/shinan/issues/7)).

This document owns how people sign in, how workspaces, members and
invitations work, how agents act for people, which tokens exist, how Shinan
decides who did what (attribution), who may see and do what (access rules), and
the protections a Shinan installation on the public internet needs. It stays
conceptual: it says what must be true and why. The
[architecture and operations](architecture.md) document chooses the technology
that makes it true (D-020).

It uses the terms of the [domain model and glossary](domain-model.md) exactly.
That document is still in review
([PR #14](https://github.com/guneet-xyz/shinan/pull/14)); terms this document
needs but the glossary lacks are listed under
[proposed glossary additions](#proposed-glossary-additions).

## How to read this document

Every statement is marked:

- **Decided**: follows from an accepted decision in the
  [plan](plan.md#6-decisions-so-far), which is cited and gives the reason.
- **Proposed**: suggested here, with a reason. The owner confirms or changes it.
- **Open**: not settled. Listed under [open questions](#open-questions) or
  [decisions needed from the owner](#decisions-needed-from-the-owner).

Where a section starts with a status, it applies to the whole section unless a
statement says otherwise.

## Summary

The main proposals, each explained with its reason in the linked section:

1. **Passkeys first.** People sign in with passkeys, or with their GitHub or
   Forgejo account for convenience. Sensitive actions always need a fresh
   passkey check. No passwords and no email sign-in links
   ([section 3](#3-sign-in-for-people)).
2. **Invite-only installations.** Nobody can create an account on
   `shinan.guneet.dev` without an invitation
   ([section 3.3](#33-who-can-get-an-account)).
3. **Invitations bound to a git host account** in the first version, shared by
   the inviter as a single-use link, because Shinan sends no email yet
   ([section 5.2](#52-invitations)).
4. **One agent per person and coding tool; one token per machine.** Revoking a
   machine revokes only that machine's tokens
   ([section 6.1](#61-what-one-agent-is)).
5. **Agents are approved in the browser.** A coding tool asks, the person
   approves with a passkey, and the token goes straight to the tool. Tokens are
   never pasted into chats ([section 6.2](#62-registering-an-agent)).
6. **An agent can never do more than its member, and some actions are for
   people only**, such as approving catalog proposals or managing members
   ([section 6.3](#63-what-an-agent-may-do)).
7. **Short-lived, narrow tokens that are checked on every request**, so
   revocation works at once ([section 7](#7-tokens)).
8. **Honest attribution.** Every credit carries a confidence. Markers in
   commits and pull requests are checked against Shinan's own records before
   they count. Unconfirmed credit is shown as unconfirmed
   ([section 8](#8-acting-for-and-attribution)).
9. **Workspace-wide repository visibility first, with a per-repository check
   built in from day one**, so per-member visibility can be turned on later
   without rework ([section 9.2](#92-private-repositories)).
10. **A security log** of sign-ins, invitations, role changes, agents, tokens
    and denied actions, visible to workspace owners
    ([section 11](#11-audit)).

## 1. What is at stake

**Decided (D-015):** the web app is on the public internet and requires
sign-in. Because a workspace holds infrastructure details, sign-in, access
rules and security get extra attention. **Decided (D-019):** one person uses
Shinan at first, but workspaces and invitations are designed in from the
start, because adding multi-user support later would mean reworking data,
permissions and sign-in.

A workspace's catalog describes machines, addresses, access paths, services,
runbooks and decisions. Its tasks tell the story of changes, including security
fixes, and link to private repositories. That is a map of the team's estate.
Shinan is **not** a secret store: credential values never belong in a catalog,
task or comment (**proposed**; reason: the `workspace` repository's
[access and safety policy](https://git.guneet.dev/guneet/workspace/src/branch/main/docs/access-and-safety.md)
already forbids it, and a map is far less dangerous than keys; the
[catalog](catalog.md) document owns the rule for catalog content). Even without
secrets, the map is worth protecting.

### Threats this document designs for

**Proposed** list. Reason: naming the threats makes each rule below traceable
to a reason.

| # | Threat | Example | Main defence |
|---|---|---|---|
| T1 | A person's sign-in is stolen | Phishing page, reused password | Phishing-resistant passkeys; step-up checks ([3](#3-sign-in-for-people)) |
| T2 | An agent token is stolen | Read from a config file on a machine; printed by an agent that was tricked by text in an issue | Narrow scopes, short life, one token per machine, instant revocation, never more than its member ([6](#6-agents), [7](#7-tokens)) |
| T3 | An invitation link leaks | Forwarded to the wrong chat | Bound to one identity, single use, expires ([5.2](#52-invitations)) |
| T4 | A member sees what they should not | Titles of pull requests in a private repository they cannot access on the git host | Per-repository check ([9](#9-access-rules)) |
| T5 | Wrong credit | An agent's merge shown as the person's; a copied marker credits the wrong agent session | Confidence levels; marker checks ([8](#8-acting-for-and-attribution)) |
| T6 | A git host account is taken over | Attacker signs in to Shinan with the stolen GitHub account | Git host sign-in never enough for sensitive actions ([3.4](#34-sign-in-sessions-and-step-up-checks)) |
| T7 | The public address is abused | Password guessing, account probing, floods | No passwords, no open sign-up, throttling, uniform errors ([10](#10-protections-for-a-public-installation)) |
| T8 | A member's agent is steered by someone else | Another member's comment, delivered as a nudge, asks the agent to act in a repository only its own member can reach | Who may nudge whom ([6.5](#65-nudges-from-other-people)) |
| T9 | An insider or the operator misuses access | A member exports the catalog; a self-hosting operator reads the database | Security log; operator trust stated plainly ([11](#11-audit), [12](#12-self-hosted-installations)) |

### Principles

**Proposed**, each with its reason:

1. **Closed by default.** Nothing is readable without sign-in, and every
   request is refused unless a rule allows it. Reason: D-015 puts the app on
   the public internet.
2. **The workspace is the hard boundary.** Nothing crosses between workspaces
   except the person (their sign-in and linked git host accounts). Reason:
   proposed in the glossary
   ([workspace](domain-model.md#workspace)); one simple boundary is the easiest
   to keep safe.
3. **An agent never has more than its member.** Reason: it already uses that
   member's git host account (D-017), so trusting it with more makes no sense.
4. **Only people change who can do what.** Agents cannot invite, change roles,
   issue tokens or approve. Reason: a stolen or misled agent must not be able to
   widen its own access or approve its own work.
5. **Credentials are short-lived, narrow and revocable at once.** Reason: agent
   machines run arbitrary commands, so tokens there will sometimes leak.
6. **Attribution says how sure it is.** Reason: D-017 makes certainty
   impossible in many cases, and false certainty is worse than stated doubt.
7. **When unsure, hide.** If Shinan cannot tell whether someone may see
   something, it does not show it. Reason: a wrongly hidden item is an
   annoyance; a wrongly shown one is a leak.
8. **Security-relevant actions are recorded.** Reason: with infrastructure
   details at stake, "who did this and when" must be answerable afterwards.

## 2. Identities and credentials at a glance

**Proposed.** Reason: one table shows how each kind of identity proves itself
and where it is specified.

| Identity (glossary term) | Proves itself with | Section |
|---|---|---|
| [Person](domain-model.md#person) | A sign-in method (passkey, or a git host sign-in), giving a sign-in session | [3](#3-sign-in-for-people) |
| [Member](domain-model.md#member-and-role) | A person plus a membership record with a role | [5](#5-members-roles-and-invitations) |
| [Agent](domain-model.md#agent) | An agent token issued after its member approved it | [6](#6-agents), [7](#7-tokens) |
| [Agent session](domain-model.md#agent-session) | Its agent's token, plus a session identifier the coding tool reports | [6.4](#64-agent-sessions) |
| [Git host account](domain-model.md#git-host-account) | Proven once, when the person links it through the git host's own sign-in | [3.6](#36-linking-git-host-accounts) |
| [Git host connection](domain-model.md#git-host-connection) | Credentials Shinan holds for the git host | [9.4](#94-git-host-connections) |
| Shinan itself ([actor](domain-model.md#actor)) | Its own server; actions it takes automatically | [8](#8-acting-for-and-attribution) |
| Outside actor | Nothing: a git host account not linked to a member of this workspace | [8.2](#82-evidence-and-confidence) |
| Installation operator | Access to the server running the Shinan installation | [12](#12-self-hosted-installations) |

## 3. Sign-in for people

### 3.1 Options

The options below are conceptual; the architecture document picks libraries
and protocols (D-020). Facts about standards and products were checked on
2026-11-16 (see [sources](#sources-checked)).

| Option | Strengths | Weaknesses |
|---|---|---|
| **Passkeys** (the W3C Web Authentication standard, now a Level 3 Recommendation) | Phishing-resistant: the key only works for the real site's domain (NIST SP 800-63B-4 names WebAuthn as its example of verifier name binding). No shared secret on the server. No outside service needed. | Recovery needs planning if all of a person's passkeys are lost. |
| **Sign in with a git host** (GitHub, Forgejo) | Every person already has an account. Linking the git host account (needed for attribution) happens in the same step. | Shinan becomes as safe as that git host account (T6). Forgejo's OAuth2 tokens have no scopes and can do anything the account can, so Shinan must not keep them. Self-hosted Forgejo must register Shinan as an application. |
| **Any OpenID Connect provider** (a company's identity provider) | What self-hosting teams often already run (D-012). | Not needed for the owner now. |
| **Password** (with a second factor) | Familiar. | Not phishing-resistant (NIST); Shinan would have to store password hashes and handle guessing. |
| **Email sign-in links** | No password. | NIST SP 800-63B-4 forbids email for out-of-band authentication; Shinan does not send email in the first version (plan: notifications later). |
| **Private network only** (for example the owner's tailnet) | Smallest attack surface. | Contradicts D-015 ("reach it from anywhere"), and other adopters may have no such network. Possible as an extra layer, see [section 10](#10-protections-for-a-public-installation). |

### 3.2 Proposal

**Proposed:**

- Passkeys are the main sign-in method, and the only method accepted for
  step-up checks ([3.4](#34-sign-in-sessions-and-step-up-checks)). Reason:
  they are the strongest widely available defence against phishing (T1), and
  they need no outside service.
- Sign in with GitHub or Forgejo is offered as a convenience for everyday
  reading and commenting. Reason: low friction, and it proves the git host
  account at the same time. Because of T6, it is never enough on its own for
  sensitive actions.
- From a git host sign-in, Shinan keeps only the account's identity. It
  discards the access token unless a feature needs it, and never keeps a
  Forgejo OAuth2 token. Reason: Forgejo documents that its OAuth2 tokens have
  no scopes and can act as the person in every way.
- Generic OpenID Connect is supported for self-hosted installations later.
  Reason: D-012; not needed for the first user.
- No passwords and no email sign-in links. Reason: see the table above.
- Which methods ship in the first version is a
  [decision for the owner](#decisions-needed-from-the-owner).

### 3.3 Who can get an account

**Proposed:**

- An installation is **invite-only** by default: a person record is created
  only by accepting an invitation ([5.2](#52-invitations)). Reason: there is no
  business goal yet (D-013), and open sign-up only adds attack surface (T7).
- The first person on a new installation is created through a one-time setup
  link that the installation shows to whoever starts it on the server. Reason:
  only someone with server access can claim a fresh installation.
- An installation operator may allow open sign-up on a self-hosted
  installation. Open sign-up only creates a person; it never grants access to
  any workspace.

### 3.4 Sign-in sessions and step-up checks

A **sign-in session** is a person's signed-in state in a browser. It is
different from an [agent session](domain-model.md#agent-session).

**Proposed:**

- Sign-in sessions end after a fixed time and after a period of inactivity.
  Starting defaults: 24 hours overall and 1 hour inactive, the values NIST SP
  800-63B-4 recommends at its middle assurance level (AAL2). The operator can
  change them. Reason: signing in again with a passkey takes seconds, and the
  data is sensitive. The final values are [open](#open-questions).
- A **step-up check** asks for a passkey again, even inside a sign-in session,
  before a sensitive action, unless the person passed one in the last few
  minutes. Sensitive actions: approving an agent or token, inviting, changing
  roles, removing members, adding or changing git host connections, changing
  workspace settings, adding or removing sign-in methods, exporting a
  workspace, and deleting a workspace. Reason: these change who can do what,
  so a stolen sign-in session or git host account (T1, T6) must not be enough.
- As a result, anyone who manages a workspace or registers agents needs at
  least one passkey. A viewer who only reads can use git host sign-in alone.
- A person can see their active sign-in sessions and end any of them, or all
  of them ("sign out everywhere"). Reason: basic incident response.

### 3.5 Recovery

**Proposed:**

- People are encouraged to register more than one passkey.
- At passkey setup, the person gets a set of single-use **recovery codes** to
  keep offline. Using one allows registering a new passkey and is recorded in
  the security log. Reason: NIST lists such look-up secrets as a recovery
  method, and they need no email.
- As a last resort, the installation operator can reset a person's sign-in
  methods with a server command, which is recorded. Reason: the operator
  already controls the server ([12](#12-self-hosted-installations)), so this
  adds no new power, and it saves a locked-out sole owner.
- No recovery by email. Reason: Shinan sends no email in the first version,
  and email is a weaker channel than the passkey it would replace.

### 3.6 Linking git host accounts

A person links their [git host accounts](domain-model.md#git-host-account) so
that activity on git hosts can be credited at all (D-017).

**Proposed:**

- An account is linked only by signing in to the git host through its own
  sign-in page, never by typing a username. Reason: otherwise anyone could
  claim someone else's account and take its credit or its access.
- A link records the git host's stable account number as well as the current
  username. Reason: usernames can be renamed; the number cannot.
- One git host account can be linked to only one person per installation.
  Reason: two people claiming one account would make attribution meaningless.
  Shared team accounts are an [open question](#open-questions).
- Shinan never links accounts automatically by matching email addresses.
  Reason: matching emails is a known way to take over accounts.
- Unlinking an account stops future credit to the person. Past events keep
  their credit (events are not edited).

## 4. Workspaces

**Decided (D-019):** workspaces exist, hold a team's catalog, tasks, git host
connections and members, and people are invited to them.

**Proposed:**

- Any person on an installation can create a workspace and becomes its
  workspace owner. Reason: on an invite-only installation every person was
  already vetted; operators can restrict this.
- A workspace always has at least one workspace owner. The last workspace
  owner cannot leave or lower their own role. Reason: a workspace without an
  owner cannot be managed or recovered.
- The boundary rule from the glossary applies everywhere: agents, tokens,
  git host connections, search, the agent index, nudges and the security log
  belong to one workspace and never show anything from another. A person who
  is a member of two workspaces has separate memberships, agents and tokens in
  each. Reason: principle 2.
- When a person who is not a member of this workspace acts on a git host, the
  event is credited to an outside actor in this workspace, even if the person
  is a member elsewhere. Reason: one workspace must not learn about another's
  members.
- Whether one repository can be connected to more than one workspace is open
  in the glossary, shared by this document and
  [git host integrations](git-hosts.md). From the access point of view it is
  safe, so this document proposes allowing it, on two conditions: each
  workspace has its own git host connection, set up by its own workspace owner
  with access to the repository, and neither workspace learns that the other
  exists. Reason: anyone able to connect the repository can already read it on
  the git host, so nothing leaks. Whether it works technically (for example,
  one webhook feeding two workspaces) is for the git host integrations
  document.
- Deleting a workspace needs a step-up check. All its agents' tokens stop
  working at once. Data is kept for a grace period, so the deletion can be
  undone, then erased. The record that a deletion happened is kept at
  installation level. Reason: deletion of a sensitive store should be quick to
  stop access but slow to become permanent. The grace period is
  [open](#open-questions).
- Moving tasks or catalog entities between workspaces is not supported in the
  first version ([open](#open-questions)).

## 5. Members, roles and invitations

### 5.1 Roles and permissions

**Proposed** in the glossary: three roles, workspace owner, contributor and
viewer, and every role may register agents. Reason given there: they cover one
owner today and small teams later without a full permission system.
**Proposed** here: the table below. Reason: each row is an action another
document defines; this table is the one place that says who may take it.

Key: ✓ allowed; ✗ not allowed; "own" means only for themselves or their own
agents. The agent column is the most an agent can do; it also never exceeds its
member's role ([6.3](#63-what-an-agent-may-do)).

| Action | Workspace owner | Contributor | Viewer | Agent |
|---|---|---|---|---|
| Read the catalog (wiki and agent index), tasks, timelines, presence | ✓ | ✓ | ✓ | ✓ |
| Create, claim, update and complete tasks; add work links | ✓ | ✓ | ✗ | ✓ |
| Comment on tasks | ✓ | ✓ | ✗ | ✗ (agents post progress updates) |
| Post progress updates on its task | – | – | – | ✓ |
| Send nudges | ✓ | ✓ | ✗ | ✗ (nudges come from people) |
| Accept or cancel tasks in `triage`; set `cancelled` or `on hold` | ✓ | ✓ | ✗ | ✗ |
| Set or clear `needs a person` | ✓ | ✓ | ✗ | ✓ if the owner agrees (glossary decision 2) |
| Clear `awaiting deployment approval` (by recording a deployment approval) | ✓ | ✓ where workspace settings allow | ✗ | ✗ |
| Make catalog proposals | ✓ | ✓ | ✗ | ✓ |
| Approve catalog proposals | ✓ | ✓ where workspace settings allow | ✗ | ✗ |
| Register agents; approve, view and revoke their tokens | own | own | own, read-only scopes | ✗ |
| Disable any agent, revoke any token in the workspace | ✓ | ✗ | ✗ | ✗ |
| Invite people; withdraw invitations | ✓ | ✗ | ✗ | ✗ |
| Change roles; remove members | ✓ | ✗ | ✗ | ✗ |
| Add, change or remove git host connections | ✓ | ✗ | ✗ | ✗ |
| Change workspace settings (such as which catalog proposals need approval) | ✓ | ✗ | ✗ | ✗ |
| Read the workspace security log | ✓ | own entries | own entries | ✗ |
| Correct the credit on an event from their own git host account | own | own | own | ✗ |
| Export or delete the workspace | ✓ | ✗ | ✗ | ✗ |

The task rows follow the glossary's proposals for
[manual states](domain-model.md#task-status-task-flags-and-manual-states);
[Tasks and work](tasks.md) owns them, and this table changes with it.

Notes, all **proposed**:

- **Only workspace owners invite** in the first version. Reason: every member
  sees infrastructure details, so the decision to let someone in stays with the
  people accountable for the workspace. A setting to let contributors invite
  can come later.
- **Viewers may register read-only agents** (also in the glossary). Reason:
  reading context is the most common thing agents need, and a viewer may read
  anyway.
- **A person may approve a catalog proposal made by their own agent**, and the
  approval is recorded as the person's action, separate from the proposal.
  Reason: with one person there is nobody else to approve. Whether a team
  workspace can require a different member to approve is
  [open](#open-questions).
- **Only people record deployment approvals**, and by default only workspace
  owners. Reason: deployment approval is the one approval gate in the owner's
  current practice (the `workspace` repository's access and safety policy, and
  D-016 for Shinan's own deployment); an agent clearing it would be approving
  its own deployment.
- Viewers see the same infrastructure details as other members. The member
  management screen should say so when inviting a viewer
  ([human experience](human-experience.md)).

### 5.2 Invitations

**Decided (D-019):** people join workspaces through invitations. The states
(`pending`, `accepted`, `declined`, `expired`, `withdrawn`) are proposed in the
[glossary](domain-model.md#invitation).

**Proposed:**

- An invitation names a role and the identity it is for. In the first version
  that identity is a **git host account** (for example a GitHub username on
  `github.com`). Reason: Shinan sends no email yet, and a git host account can
  be proven through the host's own sign-in. Invitations to an email address
  come with notifications, when Shinan can send email to prove the address.
  The glossary's "invitee address" therefore means a git host account or an
  email address.
- Creating an invitation gives the inviter a single-use link, shown once, which
  they send through their own channel. Reason: no email needed, and the
  inviter knows the invitee.
- To accept, the invitee must prove the named identity by signing in to that
  git host account. A leaked link alone is useless (T3). On an invite-only
  installation, accepting also creates the person if they are new.
- Invitations expire after 7 days by default and can be withdrawn at any time
  before acceptance. Reason: a short life limits the damage of a leaked link.
- Before the identity is proven, the acceptance page shows only the
  installation's name, not the workspace's name or who sent it. Reason: a leaked
  link should reveal as little as possible.
- Creating, withdrawing, accepting and declining are recorded in the security
  log.

### 5.3 Leaving, removal and role changes

**Proposed:**

- A workspace owner can remove a member; a member can leave. Either takes
  effect on the next request: the person loses access to the workspace, and
  all their agents in it are disabled and their tokens revoked. Reason: an
  agent acts for a member ([acting for](domain-model.md#acting-for)), so it
  cannot outlive the membership.
- Their past events stay credited to them, because events are not edited.
  Future git host activity from their account is credited to an outside actor.
- What happens to their assignments and their agent sessions' claims is owned
  by [Tasks and work](tasks.md); the default proposed here is that claims are
  released and assignments stay visible as belonging to a former member.
- Lowering a role takes effect immediately for the person and their agents,
  because an agent's effective permissions are worked out on every request
  ([6.3](#63-what-an-agent-may-do)). Scopes on existing tokens are not deleted;
  they simply stop granting more than the new role allows.
- Removing someone from Shinan does not remove their access on git hosts.
  Shinan shows the workspace owner a reminder to check the git hosts. Reason:
  Shinan cannot change git host access, and assuming it did would be dangerous.

### 5.4 Groups of members

**Proposed:** no groups (teams) inside a workspace in the first version.
Reason: one person uses Shinan now (D-019), and the private repository rule
([9.2](#92-private-repositories)) follows git host access, which needs no
groups in Shinan. The glossary also defers teams while there is one user; this
is revisited when a workspace has several members.

## 6. Agents

### 6.1 What one agent is

**Decided:** agents connect from outside (D-008) and act for a person (D-017).
**Proposed in the glossary:** an agent belongs to one workspace, acts for
exactly one member, and never does more than that member; by default there is
one agent per member and coding tool, and a member may register more; the
machine is recorded per agent session.

This document confirms the default and adds how tokens relate to machines.
**Proposed:**

- **One agent per member and coding tool by default**, for example "Guneet's
  OpenCode". A member may create more agents with a purpose in the name, such
  as a read-only one.
- **One token per machine.** Each token records the machine it was issued to,
  as a label. Revoking a machine's access revokes that machine's tokens and
  nothing else.
- Reason: timelines read well with few, recognisable agents; the machine is
  still known from each token and agent session; and when a machine is lost or
  retired (as Takezo was in November 2026) its access can be cut without
  touching the rest. An agent per machine would multiply identities without
  adding control. This is a [decision for the owner](#decisions-needed-from-the-owner).
- The machine label is reported by the coding tool and is not proof of
  anything. It can point to a `machine` catalog entity. Reason: helpful for
  people, but a stolen token can claim any label.

### 6.2 Registering an agent

**Proposed** flow:

```mermaid
sequenceDiagram
  participant T as Coding tool (plugin or CLI) on a machine
  participant B as Person's browser
  participant S as Shinan
  T->>S: Ask to connect: coding tool, machine label, wanted scopes
  S-->>T: Approval link (and short code for machines without a browser)
  T->>B: Open link, or person types the code on another device
  B->>S: Person signs in and passes a step-up check
  S->>B: Show workspace, coding tool, machine label, scopes
  B->>S: Choose existing agent or create one; reduce scopes; approve
  S-->>T: Agent token for this agent on this machine
  S->>S: Record in security log
```

Reasons:

- The token goes straight from Shinan to the tool, so it is never pasted into a
  chat, issue or file by hand. The `workspace` repository's policy already says
  people must not paste credentials into conversations.
- A person approves every token while present, with a passkey (T2, T6).
- It fits the standards coding tools are adopting. The MCP specification
  bases authorization for HTTP connections on OAuth 2.1, with a browser
  approval step. For machines without a browser, the OAuth device
  authorization grant (RFC 8628) uses exactly the short-code step above.
  Which protocol is used is for the [architecture](architecture.md) and
  [agent integrations](agent-integrations.md) documents.

A fallback for tools that cannot run this flow: the person creates a token in
the web app (with a step-up check), sees it once, and places it in the tool's
configuration on the machine. **Proposed**; reason: some tools will lack the
flow, and a once-shown token is still better than a long-lived shared one.

Only people register agents and approve tokens. An agent cannot create another
agent or a token, not even for itself (principle 4).

### 6.3 What an agent may do

**Proposed:** an agent's effective permissions on every request are what all
three of these allow:

1. its member's current role ([5.1](#51-roles-and-permissions));
2. its token's scopes ([7.2](#72-scopes));
3. the list of actions reserved for people.

**Reserved for people** (no agent may do these, whatever the role or scopes):

- approve or reject catalog proposals (proposed in the
  [glossary](domain-model.md#catalog-proposal-and-approval));
- invite people, change roles, remove members;
- register agents, approve or change tokens, or change scopes;
- add or change git host connections or workspace settings;
- read the workspace security log;
- correct attribution;
- send nudges or comments (agents post progress updates instead);
- record a deployment approval;
- export or delete a workspace;
- any action that [Tasks and work](tasks.md) or [Catalog](catalog.md) reserves
  for people, such as accepting a task out of `triage`, `cancelled` and
  `on hold` (proposed in the glossary).

Reason: these actions either change who can do what, or are themselves the
human check. A stolen or misled agent (T2) must not be able to widen its access
or approve its own work. Attempts are refused and recorded
([11](#11-audit)), because an agent trying them is a warning sign.

Because an agent uses its member's git host account (D-017), it can do on the
git host whatever the member can. Shinan cannot limit that. The rules above
limit only what the agent can do **in Shinan**. **Decided** by D-017; stated
here so nobody mistakes Shinan's rules for git host protection.

### 6.4 Agent sessions

**Proposed:**

- An agent session exists only through its agent's token. The coding tool
  reports a session identifier on each call; Shinan accepts it only if the
  session belongs to that agent.
- The token proves which **agent** acted. Which **agent session** acted is
  reported by the tool and is only as reliable as the tool. Attribution to a
  session is therefore never stronger than attribution to its agent.
- "Plugin-reported" and "self-reported" presence ([glossary](domain-model.md#presence))
  describe how reliable the reports are, not how secure they are: the plugin
  and the MCP server on one machine use the same agent token.

Reason: being clear about what each piece proves prevents the timeline from
claiming more than Shinan knows.

### 6.5 Nudges from other people

A nudge puts a person's message into a running agent session
([glossary](domain-model.md#nudge)). That session holds its own member's git
host access. If any member could nudge any agent, a member could steer another
member's agent into repositories they cannot reach themselves (T8).

**Proposed:**

- A member's own agent sessions accept nudges from that member, as in the
  plan.
- Nudges from other members are delivered labelled with the sender's name, so
  the agent can tell that it is not its own member speaking. The
  [agent integrations](agent-integrations.md) document tells agents to treat
  such messages as requests within the current task, never as permission to
  widen scope.
- Each member can turn off nudges from others for each of their agents.
- Viewers cannot nudge. Every nudge is recorded.
- Reason: the plan's Nudges pillar is built on reviewers' comments reaching the
  working agent, so blocking them would remove the feature. Labelling them and
  letting the agent's own member opt out keeps that benefit while limiting
  steering. Whether nudges from others should be off by default in team
  workspaces is [open](#open-questions).

## 7. Tokens

### 7.1 Kinds of credential

**Proposed.** Reason: listing every credential in one place makes it easier to
see that each one is narrow and can be revoked.

| Credential | Held by | Lets the holder | Lifetime |
|---|---|---|---|
| Sign-in session | A person's browser | Act as the person in the web app | Hours ([3.4](#34-sign-in-sessions-and-step-up-checks)) |
| Agent token: access part | A coding tool on one machine | Act as one agent in one workspace, within its scopes | Short, for example 1 hour |
| Agent token: renewal part | Same | Get new access parts | Ends when unused for a while, and at a fixed maximum age |
| Recovery codes | The person, offline | Register a new passkey | Until used |
| Invitation link | The invitee | Accept one invitation after proving their identity | 7 days |
| Git host connection credentials | The Shinan server | Read from and write to a git host | Owned by [Git host integrations](git-hosts.md) |
| Webhook secrets | The Shinan server and a git host | Prove a webhook came from that host | Owned by [Git host integrations](git-hosts.md) |
| Launcher credential (phase 3) | A machine | Start agent sessions | [Open](#open-questions) |

"Agent token" means the access part and renewal part together.

**Proposed:** no personal API tokens for people in the first version. The CLI
uses an agent token. Reason: a person's token stored on a machine where agents
run would let any agent there act as the person, defeating both attribution
and the reserved-for-people rule. Scripts and automation that are not agents
are an [open question](#open-questions).

### 7.2 Scopes

**Proposed** starting scopes, matching what the plan says agents do (read the
catalog, propose catalog changes, work on tasks, report presence):

| Scope | Allows |
|---|---|
| `catalog:read` | Read the catalog and the agent index |
| `catalog:propose` | Make and withdraw catalog proposals |
| `tasks:read` | Read tasks, work links and timelines |
| `tasks:write` | Create, claim, update and complete tasks; add work links; post progress updates |
| `presence` | Report agent sessions and presence; receive nudges |

Reason: few scopes are easy to understand at approval time; these split
reading from writing, which is the line that matters most if a token leaks.
A normal agent gets all five; a read-only agent gets the two `read` scopes.
Limiting a token to certain repositories or projects is
[open](#open-questions).

### 7.3 Lifetime

**Proposed:**

- The access part lasts at most about an hour and is renewed automatically.
- The renewal part ends after 30 days without use and at most 90 days after the
  person approved it. After that, the person approves again in the browser.
- Reason: a stolen copy is useful only briefly, idle machines lose access on
  their own, and approving again every three months costs a minute. The values
  are a [decision for the owner](#decisions-needed-from-the-owner).

### 7.4 Handling

**Proposed:**

- A token is shown once, if at all, and Shinan stores only a one-way hash of
  it. Reason: a copy of Shinan's database must not contain usable tokens.
- Tokens start with a recognisable prefix. Reason: leak scanners, and Shinan
  itself, can then spot them in text.
- Tokens are sent in a request header, never in a web address. Reason: web
  addresses end up in logs; the MCP specification also forbids tokens in query
  strings.
- Shinan refuses comments, catalog proposals and other text that contain one
  of its own tokens, and revokes that token. Reason: agents sometimes echo
  credentials; once a token is in shared text, it must be treated as exposed.
- Each token's member can see its agent, machine label, scopes, approval date,
  expiry, and when and from what network address it was last used. Reason:
  people can only spot misuse if they can see use.
- How the coding tool stores the token on the machine is owned by
  [agent integrations](agent-integrations.md); the machine's own credential
  store is preferred over a plain file.

### 7.5 Revocation

**Proposed:**

| Action | Who can do it | Effect |
|---|---|---|
| Revoke one token | Its member; a workspace owner | That machine's agent loses access |
| Disable an agent | Its member; a workspace owner | All its tokens stop working; it can be re-enabled only by a person approving new tokens |
| Revoke a machine | A member, for their own agents; a workspace owner, for all agents in the workspace | All tokens with that machine label stop working |
| Remove a member or lower a role | A workspace owner | See [5.3](#53-leaving-removal-and-role-changes) |
| Sign out everywhere | The person | Ends all their sign-in sessions; optionally revokes all their agent tokens in every workspace |
| Emergency revoke | The installation operator | Everything for a person or a workspace; recorded |

- Revocation takes effect on the next request: Shinan checks on every request
  that the token is still valid. Reason: the data is sensitive, so revocation
  must be instant; the number of requests is small, so the check costs little.
  The [architecture](architecture.md) document chooses how.
- A token is revoked automatically when its renewal part expires, its agent is
  disabled, its member is removed, its workspace is deleted, or it is seen in
  text ([7.4](#74-handling)).
- When a running agent session loses its token, its next call fails, Shinan
  records an event, and the session is shown as ended because access was
  revoked. Its claims are handled as [Tasks and work](tasks.md) decides.
  [Agent integrations](agent-integrations.md) owns what the tool does next.
- Revoking access to Shinan does **not** revoke the agent's git host access,
  which is its member's own git host credentials on that machine (D-017).
  Shinan reminds the person of this when they revoke a machine. Reason: a lost
  machine needs both, and the person must not assume Shinan did both.

## 8. Acting for and attribution

### 8.1 The problem

**Decided (D-017):** agents use the same git host account as the person they
work for, and Shinan must tell people and agents apart from its own records,
not from git host accounts. This is a known limitation that other adopters will
share.

When something happens on a git host, the host reports which **account** did
it. GitHub's webhook documentation says the `sender` field identifies the user
who triggered the event, and sometimes is a placeholder `ghost` user. Nothing
says whether the account's person or one of their agents was at the keyboard.
The owner tried the alternative: a separate Forgejo account for agent work on
Daedalus, which was disabled again for consistency with GitHub (recorded in the
`workspace` repository's Forgejo service entry). That experience supports
D-017's reason that separate agent accounts are a barrier.

### 8.2 Evidence and confidence

The glossary **proposes** four confidence levels
([attribution](domain-model.md#attribution)). This document **proposes** the
rules that assign them:

| Confidence | When | Credited to |
|---|---|---|
| `recorded` | The action came through Shinan with a valid sign-in session or agent token. | The person; or the agent session named in the call if it belongs to that agent, otherwise the agent. |
| `marked` | A git host item carries a marker naming an agent session, and the marker passes the checks in [8.3](#83-checking-markers); or a commit is signed with a key registered to one agent ([8.4](#84-stronger-evidence-agent-signing-keys)). | That agent session (or agent). |
| `inferred` | No confirmed marker, but timing and Shinan's records point one way: one of the person's agent sessions was active, attached to a task linked to this work item and reporting this repository at the time; or **none** of the person's agent sessions was active at the time. | "Probably" that agent session; or "probably" the person. |
| `unknown` | The account is linked to a member but nothing points either way, for example several of their agent sessions were active in that repository. | "The person or one of their agents". |
| (outside actor) | The account is not linked to any member of this workspace. | The git host account itself. |

Reasons:

- Actions through Shinan are the only ones Shinan saw happen, so only they are
  `recorded`.
- Crediting the person with `inferred` when no agent of theirs was active
  keeps the many direct actions people take on git hosts (such as merging in
  the web interface) from all showing as `unknown`, while still saying it is a
  guess. An agent that never connects to Shinan would break this guess, which
  is why it is only `inferred`.
- Shinan itself is `recorded` for its own automatic actions, including writes
  to git hosts through a git host connection ([9.4](#94-git-host-connections)).

### 8.3 Checking markers

The marker format is owned by [Tasks and work](tasks.md) and
[agent integrations](agent-integrations.md). A marker is plain text in a commit
message, pull request description or branch name. Anyone using the account can
type any marker, and agents copy text between pull requests.

**Proposed:** a marker counts as `marked` only if all of these hold:

1. the agent session it names exists in this workspace;
2. that session's agent acts for the person whose git host account made the
   item;
3. the session had started and had not long ended when the item was made;
4. the item's repository is one the session reported working in, or is linked
   to the session's task.

If any check fails, the marker is ignored for credit, the event notes "marker
not confirmed", and the rules in [8.2](#82-evidence-and-confidence) apply
without it. Reason: the checks cost little and catch both copied and forged
markers, as far as Shinan's records allow.

### 8.4 Stronger evidence: agent signing keys

**Proposed as an optional later step**, not for the first version:

- Each agent token's machine gets its own commit-signing key, which the person
  adds to their git host account as a signing key. Shinan records which key
  belongs to which agent and machine. Commits signed with that key are
  credited to the agent as `marked`.
- GitHub verifies commits signed with SSH keys (Git 2.34 or later), so this
  works within the person's own account, as D-017 requires. Whether Forgejo
  verifies SSH-signed commits is for the [git host integrations](git-hosts.md)
  document to confirm.
- Limits: it covers commits only, not comments, reviews or merges; commits the
  git host creates itself, such as squash merges, carry the host's signature
  instead; and the key sits on the same machine as the agent, so it proves
  "made by this machine's agent setup", not "no person touched it".
- Reason: it is the strongest evidence available without separate accounts,
  but it adds key management for every person, so it should wait until the
  basic rules have been tried.

### 8.5 Showing and correcting credit

**Proposed:**

- Every credited event shows its confidence. `inferred` and `unknown` credits
  are never shown as plain fact. How they look is owned by
  [human experience](human-experience.md).
- A person may correct the credit on events from their own git host account,
  for example "this merge was me, not my agent". The correction is a new event
  that points to the original; the original is kept. Agents cannot correct
  credit. Reason: the person is the one who knows, events are not edited
  ([glossary](domain-model.md#event)), and letting agents correct credit would
  let a misled agent rewrite history.

### 8.6 Accountability and known limits

**Proposed** (stated in the glossary for [acting for](domain-model.md#acting-for)):
the person is accountable for everything done with their git host account and
by their agents. Reason: the agent uses their account and permissions.

Known limits, stated plainly so other adopters understand them (D-017):

- Attribution helps people understand and review work. It is **not** a security
  control against the account holder, who can produce any marker their account
  can write.
- An agent that never connects to Shinan is invisible to it. Its git host
  actions are credited as `inferred` to the person, or as `unknown`.
- The git host's own records remain the authority on which **account** did
  something.
- How reliable attribution turns out in practice (plan question 2) can only be
  measured during the proof of concept. **Proposed:** the
  [roadmap](roadmap.md) includes measuring the share of git host events in each
  confidence level on the trial projects.

## 9. Access rules

### 9.1 How every request is checked

**Proposed:** every request, from any path (web app, MCP server, CLI, plugin,
agent index download, search, export), goes through the same checks, in this
order:

1. **Who is acting:** a person through a sign-in session, or an agent through
   its token. Otherwise refuse.
2. **Which workspace:** the person must be a member, or the agent's member must
   be. Otherwise refuse, with the same answer as for a workspace that does not
   exist.
3. **Role:** the member's role must allow the action ([5.1](#51-roles-and-permissions)).
4. **Agent limits:** for agents, the token's scopes and the reserved-for-people
   list ([6.3](#63-what-an-agent-may-do)).
5. **Repository visibility:** anything taken from a repository is shown only if
   the member may see that repository ([9.2](#92-private-repositories)).
6. **Step-up:** sensitive actions need a recent passkey check
   ([3.4](#34-sign-in-sessions-and-step-up-checks)).

Reason: when different paths check differently, one of them eventually leaks.
A single set of checks is also the place to add rules later without reworking
every feature (D-019).

### 9.2 Private repositories

Plan question 3: a member can see a task, but a work item linked to it is in a
private repository the member cannot see on the git host. The workspace's git
host connection can read that repository, so Shinan could show its pull request
titles, commit messages and CI checks to someone who should not see them (T4).

Options:

| Option | How it works | For | Against |
|---|---|---|---|
| **A. Workspace-wide** | Every member sees everything the workspace's git host connections can read. Workspace owners connect only repositories every member may see. | Simple. Correct for one person. | Depends on owners connecting carefully; wrong as soon as members' git host access differs. |
| **B. Follow the git host** | For each member, Shinan checks with the git host whether their linked account can see the repository, and hides it if not. | Matches the git host exactly; nothing to maintain in Shinan. | Needs each member's linked account and either their authorization or an admin-level query; adds git host calls; answers must be cached and can go stale. |
| **C. Lists in Shinan** | Workspace owners mark repositories as restricted and choose who may see them. | Works without git host calls. | A second permission list that drifts from the git host's. |

Facts relevant to B, checked on 2026-11-16: a GitHub App user access token can
reach only repositories both the app and the person can, and GitHub provides an
endpoint listing them; GitHub also offers an endpoint giving a named
collaborator's permission on a repository; Forgejo documents that repository
administrators can query other users' permissions on a repository. Which calls
to use, and the access they need, is for the [git host integrations](git-hosts.md)
document.

**Proposed:**

- **First version: option A**, with a warning when a workspace owner connects a
  repository that every member will see it. Reason: there is one person
  (D-019), so every connected repository is theirs, and B's cost buys nothing
  yet.
- **The repository check exists from day one** (step 5 in
  [9.1](#91-how-every-request-is-checked)). Under A it always answers "yes" for
  members. Option B is then a setting on a git host connection, not a redesign.
  Reason: D-019 says multi-user support must not need reworking later.
- **B before any workspace has members whose git host access differs.**
  Reason: from that moment A leaks. C is not proposed, because a second list
  drifts.
- Under B, when Shinan cannot get an answer (the member's link has expired, the
  host is down), it hides the repository's content (principle 7) and shows why.

Because agents share their member's git host account (D-017), a member's agent
cannot reach on the git host what the member cannot. Option B therefore gives an
agent in Shinan exactly what it has on the git host. That is one place where
D-017 helps.

This choice is a [decision for the owner](#decisions-needed-from-the-owner).

### 9.3 What a member sees when access is missing

**Proposed:**

- The task stays visible. Tasks belong to the workspace, and there are no
  per-task permissions in the first version. Reason: a separate workspace is
  the place for work that some members must not see. Private tasks are
  [open](#open-questions).
- Work items in repositories the member cannot see appear only as a count, such
  as "2 linked items you cannot see": no repository name, title, link or state.
  Reason: repository names can themselves reveal private work.
- Their events are left out of timelines, with a count of hidden events.
- Task status is calculated from all `delivers` work links and shown to everyone.
  Reason: a status that differs per viewer would break "one story". The cost is
  that a member may learn that hidden work is, say, in review. Whether that is
  acceptable is [open](#open-questions).
- A `project` entity's link to a repository the member cannot see shows as
  "restricted repository". The catalog's own text is not filtered, so catalog
  authors must not copy private repository content into it
  ([catalog](catalog.md)).
- Search, the agent index and MCP answers are filtered the same way, so a
  member's agents see what the member sees.

### 9.4 Git host connections

[Git host integrations](git-hosts.md) owns how connections work. This document
owns who may manage them and whose access they carry.

**Proposed:**

- Only workspace owners add, change or remove git host connections, with a
  step-up check. Reason: a connection decides what the whole workspace can see.
- Connections should use credentials that belong to Shinan, not to a person:
  a GitHub App installation on GitHub; on Forgejo, an access token limited to
  specific repositories and the repository and issue scopes (Forgejo supports
  such tokens). Never a Forgejo OAuth2 token, which has no scopes. Reason:
  least privilege; and writes made with a person's credentials would look like
  that person's own actions, making the D-017 problem worse.
- Whatever Shinan writes to a git host through a connection is credited to
  Shinan, `recorded`.

### 9.5 Sensitive catalog content

**Proposed:**

- Credential values never go in the catalog, tasks or comments. The
  [catalog](catalog.md) document owns this rule for catalog content, and
  Shinan's token check ([7.4](#74-handling)) catches its own tokens.
- In the first version every member of a workspace, viewers included, can read the
  whole catalog. Reason: the workspace is the boundary; a separate workspace
  holds what some members must not see. Catalog entities restricted to some
  members are [open](#open-questions).

## 10. Protections for a public installation

**Decided (D-015):** security for a public sign-in app gets extra attention in
this document and the [architecture](architecture.md) document. This section
lists what Shinan must do; the architecture document decides how, along with
transport security, browser protections, dependency updates and backups.

**Proposed:**

- **Nothing without sign-in** except the sign-in page, the invitation
  acceptance page ([5.2](#52-invitations)) and a minimal health check that
  reveals nothing. The wiki and agent index are behind sign-in too.
- **No passwords and no open sign-up** ([3](#3-sign-in-for-people)).
- **Phishing-resistant sign-in and step-up checks** for sensitive actions
  ([3.4](#34-sign-in-sessions-and-step-up-checks)).
- **Throttling** of sign-in attempts, invitation acceptance and failed token
  use, with failures recorded. Reason: T7.
- **Uniform answers** that do not reveal whether a person, workspace, task or
  repository exists to someone not allowed to see it. Reason: probing for names
  leaks information; the Web Authentication standard discusses this for
  usernames.
- **Narrow, short-lived, hashed tokens** with leak detection
  ([7](#7-tokens)).
- **Outside text is data, not instructions.** Issue text, comments and catalog
  pages can contain instructions aimed at agents. The
  [agent integrations](agent-integrations.md) document makes MCP answers show
  where text came from, and tells agents to treat it as data. Reason: the
  `workspace` repository's policy already treats commands found in issues and
  logs as data; with many authors, this matters more.
- **Security activity is visible** to each person in the app: new sign-in
  methods, new agent tokens, sign-ins from new devices. Email alerts come with
  notifications. Reason: people notice misuse of their own account fastest.
- **An optional private-network restriction.** An operator may also limit the
  agent-facing parts, or the whole installation, to a private network. Whether
  `shinan.guneet.dev` does this is a
  [decision for the owner](#decisions-needed-from-the-owner).

## 11. Audit

**Proposed:**

The **security log** records, as [events](domain-model.md#event) of security
kinds:

| Area | Recorded |
|---|---|
| Sign-in | Sign-ins (success and failure), step-up checks, recovery code use, sign-in methods added or removed, sign-in sessions ended |
| Membership | Invitations created, withdrawn, accepted, declined, expired; role changes; removals; leaving |
| Agents and tokens | Agents created, renamed, disabled; tokens approved, renewed, revoked (and why); a summary of each token's use (first and last use, network address, number of requests) |
| Workspace | Git host connections added, changed, removed; settings changed; exports; deletion and restore |
| Approvals and credit | Catalog approvals (also normal events); attribution corrections |
| Refusals | Requests refused by the checks in [9.1](#91-how-every-request-is-checked), especially agents attempting reserved actions |
| Operator | Account resets, emergency revocations, sign-up policy changes |

- Each entry records the actor and confidence, time, network address, the
  coding tool or browser described by the client, what changed, and the
  outcome.
- Security log entries are not shown on task timelines. Workspace owners see
  their workspace's log. Each person sees their own entries across workspaces.
  The installation operator sees installation-level entries. Reason: the log
  contains network addresses and patterns of use, which are personal data.
- Reads are recorded as per-token summaries and as bulk reads (agent index
  downloads, exports), not page by page. Reason: logging every read is heavy,
  and bulk reads are where large leaks happen. Whether full read logging is
  needed is [open](#open-questions).
- Entries are not edited in the app. An operator with database access could
  still change them; the [architecture](architecture.md) document may add an
  off-machine copy. Reason: say plainly what the log can and cannot prove.
- Entries are kept for at least one year, then deleted. Reason: long enough to
  investigate an incident discovered late, short enough to limit stored
  personal data. The value is a
  [decision for the owner](#decisions-needed-from-the-owner). Deleting old
  entries depends on the glossary's open question on whether events can be
  redacted; this document's position is that security-log events, which hold
  network addresses, must be deletable after their retention period.

## 12. Self-hosted installations

**Decided (D-012):** Shinan is self-hostable by design.

**Proposed:**

- The **installation operator** (whoever runs the server) can read and change
  everything in the installation's storage. Shinan cannot protect a workspace
  from its own operator, and documentation says so. In-app operator actions are
  recorded ([11](#11-audit)). Reason: honesty about the trust model.
- Being an operator does not make someone a member of any workspace in the app.
  Reason: in-app powers stay explicit and recorded.
- Secure defaults: invite-only, passkeys, short-lived tokens, option A with the
  connection warning. An operator can add sign-in providers (any OpenID Connect
  provider, their own Forgejo) and change limits.
- On `shinan.guneet.dev`, the owner is both operator and sole workspace owner.

## Proposed glossary additions

These terms are used here but are not yet in the
[domain model and glossary](domain-model.md). **Proposed** for addition there,
with this document as owner. Reason: one vocabulary needs one home. They will
be raised on the glossary's pull request. (The glossary already has
"sign-in session" and "token"; this document uses both as defined there.)

| Term | Definition |
|---|---|
| Sign-in method | A way a person proves who they are: a passkey, a git host sign-in, or another identity provider. |
| Step-up check | A fresh passkey check before a sensitive action. |
| Scope | One kind of action a token allows. |
| Machine label | The machine name recorded on a token. Reported by the coding tool; not proof. |
| Revocation | Making a token, agent, sign-in session or membership stop working at once. |
| Security log | The record of security-relevant events in a workspace or installation. |
| Installation operator | Whoever runs the server of a Shinan installation. |
| Recovery code | A single-use code, kept offline, for registering a new passkey. |

Changes to existing glossary entries:

- **Token:** add that a token is issued to one agent on one machine, and has a
  short-lived access part and a renewal part ([7](#7-tokens)). This document
  calls it an "agent token" where the context needs it.
- **Invitation:** "invitee address" should read "a git host account or an
  email address" ([5.2](#52-invitations)).

## Dependencies on other documents

| Document | What this document needs from it |
|---|---|
| [Domain model and glossary](domain-model.md) | The terms used here; the [additions above](#proposed-glossary-additions); its open questions on connecting one repository to two workspaces (position in [4](#4-workspaces)) and on redacting events (position in [11](#11-audit)); its owner decision on who may set `needs a person`, which the role table follows. |
| [Product overview](product-overview.md) | How security and self-hosting are positioned for later adopters. |
| [Catalog](catalog.md) | The rule that credential values never enter the catalog; which catalog proposals need approval (this document says who may approve); how `person` and `agent` entities link to identity records; whether restricted entities are needed. |
| [Tasks and work](tasks.md) | The marker format; which manual states and triage decisions are reserved for people; who may record a deployment approval; what happens to claims and assignments when an agent session is revoked or a member removed; how status treats work items some members cannot see. |
| [Git host integrations](git-hosts.md) | Connection credentials (GitHub App, scoped Forgejo tokens); reading each event's account by its stable number; the calls for per-member repository checks (option B); whether Forgejo verifies SSH-signed commits; whether one repository can technically feed two workspaces. |
| [Agent integrations](agent-integrations.md) | The registration flow inside each coding tool; storing tokens on machines; reporting session identifiers and machine labels; handling revoked tokens; labelling nudges from other members; marking outside text as data in MCP answers; the phase 3 launcher credential. |
| [Human experience](human-experience.md) | Screens for sign-in, step-up, member and agent management, tokens, the security log, attribution confidence, hidden work items, and the viewer warning. |
| [Architecture and operations](architecture.md) | Sign-in technology; token format, hashing and per-request checking; one authorization layer for every path; throttling; security log storage and any off-machine copy; storing git host connection credentials; the private-network option on Musashi. |
| [Roadmap and migration](roadmap.md) | Which parts ship first (proposed: passkeys and git host sign-in, invitations by git host account, option A with the built-in check, security log) and which later (option B, email invitations, OpenID Connect, agent signing keys); measuring attribution confidence in the proof of concept. |
| [Decision log](decisions/) | A decision record for each owner decision below. |

## Sources checked

All checked on 2026-11-16.

- W3C, [Web Authentication Level 3](https://www.w3.org/TR/webauthn-3/), W3C
  Recommendation of 25 August 2026 (passkeys; section 14.6.2 on username
  enumeration).
- NIST, [SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)
  (August 2025): AAL2 reauthentication guidance (24 hours overall, 1 hour
  inactivity); passwords and look-up secrets are not phishing-resistant;
  WebAuthn as an example of phishing resistance through verifier name binding;
  email must not be used for out-of-band authentication.
- Model Context Protocol, [Authorization](https://modelcontextprotocol.io/specification/latest/basic/authorization)
  (latest, 2026-07-28 revision): based on OAuth 2.1 for HTTP transports;
  tokens must be sent in the Authorization header and not in the query string;
  scope challenges.
- IETF, [RFC 8628: OAuth 2.0 Device Authorization Grant](https://datatracker.ietf.org/doc/html/rfc8628).
- GitHub Docs, [Generating a user access token for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app):
  a user access token only reaches what both the app and the person can; web
  and device flows; 8-hour expiry with refresh.
- GitHub Docs, [REST API: GitHub App installations](https://docs.github.com/en/rest/apps/installations)
  (`GET /user/installations/{installation_id}/repositories`) and
  [collaborators](https://docs.github.com/en/rest/collaborators/collaborators)
  (`GET /repos/{owner}/{repo}/collaborators/{username}/permission`).
- GitHub Docs, [Webhook events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads)
  (the `sender` property and the `ghost` user).
- GitHub Docs, [About commit signature verification](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification)
  (SSH signing, Git 2.34 or later).
- Forgejo Docs v17.0, [OAuth2 provider](https://forgejo.org/docs/latest/user/authentication/oauth2-provider/)
  (OAuth2 scopes not implemented; tokens can act as the user in every way) and
  [Access token scope](https://forgejo.org/docs/latest/user/authentication/token-scope/)
  (scoped tokens, "specific repositories" option, repository administrators can
  query other users' permissions).
- The `workspace` repository (read-only background):
  `docs/access-and-safety.md`, `docs/collaboration.md`, and
  `catalog/services/forgejo.md` (the disabled `daedalus-agent` account).

## Open questions

1. **Sign-in session and step-up times.** Are 24 hours overall, 1 hour
   inactive and "a few minutes" for step-up right for daily use? (Proposed in
   [3.4](#34-sign-in-sessions-and-step-up-checks); confirm in the proof of
   concept.)
2. **Self-approval in teams.** Can a team workspace require a different member
   to approve a catalog proposal made by someone's own agent?
3. **Nudges from other members.** Should they be off by default in workspaces
   with several members ([6.5](#65-nudges-from-other-people))?
4. **Status from hidden work.** Is it acceptable that calculated task status
   reveals the state of work items a member cannot see
   ([9.3](#93-what-a-member-sees-when-access-is-missing))?
5. **Private tasks and restricted catalog entities.** Are they needed, or is a
   separate workspace always enough?
6. **Scripts and automation.** Do people need tokens for non-agent automation,
   and as what kind of actor?
7. **Repository-limited tokens.** Should an agent token be limitable to some
   repositories or projects?
8. **Shared git host accounts.** How to credit a git host account several
   people use, such as a team's automation account.
9. **Launcher credential (phase 3).** A launcher starts agents with a person's
   git host access; it needs its own design.
10. **Workspace deletion grace period** and **moving items between
    workspaces**.
11. **Full read logging.** Is it ever needed beyond per-token summaries and
    bulk reads?
12. **Forgejo signed commits.** Does Forgejo verify SSH-signed commits, which
    [8.4](#84-stronger-evidence-agent-signing-keys) would need? (Git host
    integrations)
13. **Attribution reliability** (plan question 2): how many events reach
    `recorded` or `marked` in practice. Measured in the proof of concept.

## Decisions needed from the owner

| # | Decision | Recommended option | Why, in one line |
|---|---|---|---|
| 1 | Sign-in methods in the first version | Passkeys, plus sign in with GitHub and Forgejo; passkey-only step-up; no passwords or email links | Phishing-resistant where it matters, convenient elsewhere, and it links git host accounts for attribution. |
| 2 | Who can get an account on `shinan.guneet.dev` | Invite-only | No business goal yet (D-013), and open sign-up only adds attack surface. |
| 3 | How fine-grained an agent is | One agent per person and coding tool; one token per machine | Readable timelines, and a lost machine can be cut off alone. |
| 4 | Private repository visibility | Option A (workspace-wide) now, with the per-repository check built in; option B before members' access differs | Correct and cheap for one person, without rework later (D-019). |
| 5 | Agent token lifetimes | Access part about 1 hour; renewal part ends after 30 days unused or 90 days in total | Stolen copies expire quickly; re-approval every three months is cheap. |
| 6 | Reachability of the agent-facing parts of `shinan.guneet.dev` | Public behind tokens, with the private-network option kept for later | Other adopters and cloud-run agents need it public, so the token design must be strong anyway. |
| 7 | Approving your own agent's catalog proposals | Allowed while one person uses Shinan | Nobody else can approve; revisit with the first second member. |
| 8 | Security log retention | One year | Long enough for late-found incidents, short enough to limit stored personal data. |
| 9 | Invitations in the first version | Bound to a git host account, shared by hand as a single-use link | Works without email and cannot be used by whoever finds the link. |
