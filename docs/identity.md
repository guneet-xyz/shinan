# Identity, agents and permissions

Status: **approved by the owner on 2026-11-16** ([issue #7](https://github.com/guneet-xyz/shinan/issues/7); integrated in [#26](https://github.com/guneet-xyz/shinan/issues/26)).
Updated with the owner's answers in
[issue #25](https://github.com/guneet-xyz/shinan/issues/25) and the
integration review in [issue #26](https://github.com/guneet-xyz/shinan/issues/26).

This document owns how people sign in, who can have an account, how
workspaces, members and invitations work, how agents act for people, which
tokens exist, how Shinan decides who did what (attribution), who may see and do
what (access rules), and the protections a Shinan installation on the public
internet needs. It stays conceptual: it says what must be true and why. The
[architecture and operations](architecture.md) document chooses the technology
that makes it true (D-020).

It uses the terms of the [domain model and glossary](domain-model.md) exactly.

## How to read this document

Every statement is marked:

- **Decided**: follows from an accepted plan decision (D-nnn), or from an
  owner answer in [issue #25](https://github.com/guneet-xyz/shinan/issues/25),
  cited as "owner, O-n" or, for the follow-up answers in batches 12 and 13, "owner,
  N-n", or from an owner answer on the integration review in
  [issue #26](https://github.com/guneet-xyz/shinan/issues/26), cited as "owner,
  NO-n". The [decision log](decisions/README.md) maps these to decision
  records.
- **Proposed**: suggested here, with a reason. The owner confirms or changes it.
- **Open**: not settled. Listed under [open questions](#open-questions) or
  [decisions needed from the owner](#decisions-needed-from-the-owner).

Where a section starts with a status, it applies to the whole section unless a
statement says otherwise.

## Summary

1. **Two sign-in methods: an email magic link or GitHub** (owner, O-41,
   N-7). No passwords, no Forgejo sign-in, no passkeys. Forgejo accounts on
   any instance are only connected, never used to sign in. Shinan sends email
   from the first version ([section 3](#3-sign-in-for-people)).
2. **An email allowlist decides who can have an account; an invitation decides
   who joins a workspace** (owner, O-42, O-48)
   ([section 3.2](#32-who-can-have-an-account), [5.2](#52-invitations)).
3. **Two roles: workspace owner and contributor** (owner, N-11). **Everyone in
   a workspace sees everything in it**, including work from private
   repositories. There is no restricted level. Secrets never go in the catalog
   (owner, O-2, O-43) ([section 5.1](#51-roles-and-permissions),
   [9.2](#92-visibility-inside-a-workspace)).
4. **One agent per person, coding tool and machine**, for example "Guneet's
   OpenCode on Daedalus" (owner, O-40) ([section 6.1](#61-what-one-agent-is)).
5. **Agent tokens are long-lived and valid until revoked** (owner, O-44).
   An agent gets its one token through a browser approval started from the
   plugin or CLI, or a token made by hand; it works at every agent endpoint
   (owner, NO-1). Revocation works at once, and every token's use is visible
   ([section 6.2](#62-registering-an-agent), [7](#7-tokens)).
6. **Shinan writes to git hosts only on GitHub, and only as its app.**
   Forgejo connections are read-only. Shinan stores no per-person git host
   tokens except the Forgejo token a person gives it to read their repositories
   (owner, O-1, O-53, O-54, N-4) ([section 9.3](#93-git-host-connections)).
7. **An agent can never do more than its member, and some actions are for
   people only** ([section 6.3](#63-what-an-agent-may-do)).
8. **Honest attribution.** Every credit carries a confidence; markers are
   checked against Shinan's records; Shinan's own GitHub writes are recognised
   by the GitHub App's own account and the item IDs it stored
   ([section 8](#8-acting-for-and-attribution)).
9. **The security log is kept forever and cannot be purged** (owner, O-47,
   N-8, N-13); only workspace owners purge other workspace content (owner, O-50)
   ([section 11](#11-audit)).
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
(no passkeys or second factor, sign-in by magic link or GitHub only,
long-lived agent tokens, no restricted level, any Forgejo token, any Forgejo
address). The table below states, for each threat, what Shinan still does and
what risk remains. It does not reopen those decisions. **Proposed** list;
reason: each rule below should trace to a threat, and the owner should see the
remaining risk in one place.

| #   | Threat                                                                             | What Shinan does                                                                                                                                                                                                                                                                                                                | Residual risk                                                                                                                                                                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | A person's email account is taken over, or a magic link is read from their mailbox | Single-use links that expire after 15 minutes; re-authentication for sensitive actions; email alerts on sign-in from a new browser and on new agent tokens; the security log ([3](#3-sign-in-for-people), [10](#10-protections-for-a-public-installation))                                                                      | Email is the root of every account (O-41, N-7). Whoever controls a person's mailbox can sign in, read the whole workspace and, after re-authenticating the same way, change it. The alerts go to that same mailbox, so an attacker who controls it can delete them.                                |
| T2  | A person's GitHub account is taken over                                            | Identity keyed by GitHub's stable account number; Shinan keeps no GitHub token from sign-in ([3.1](#31-sign-in-methods))                                                                                                                                                                                                        | GitHub sign-in is a sign-in method (N-7), so a taken-over GitHub account is a taken-over Shinan account, protected only by whatever GitHub requires (for example its own two-factor settings).                                                                                                     |
| T3  | An agent token is stolen                                                           | Narrow scopes, one agent per machine, instant revocation, last-use display, the security log ([6](#6-agents), [7](#7-tokens))                                                                                                                                                                                                   | A token works until someone revokes it (O-44). A token copied from a machine, or printed by a misled agent, keeps working from anywhere, possibly for a long time, and reads everything in the workspace.                                                                                          |
| T4  | An invitation link leaks                                                           | Bound to one email address; the invitee must sign in as an allowlisted person with that verified email; single use; expires ([5.2](#52-invitations))                                                                                                                                                                            | Whoever controls the invitee's email can accept it.                                                                                                                                                                                                                                                |
| T5  | A member sees what they cannot see on the git host                                 | None inside a workspace, by decision (O-43); links to private repositories stay protected by the git host                                                                                                                                                                                                                       | Titles, summaries and events Shinan stores from private repositories are visible to every member and every member's agent. Separation needs separate workspaces ([9.2](#92-visibility-inside-a-workspace)).                                                                                        |
| T6  | Wrong credit                                                                       | Confidence levels; marker checks; Shinan's own GitHub writes recognised by stored IDs ([8](#8-acting-for-and-attribution))                                                                                                                                                                                                      | Attribution is not proof against the account holder (D-017).                                                                                                                                                                                                                                       |
| T7  | A Forgejo address entered by a person points somewhere harmful                     | Shinan reaches out only to the address entered, over HTTPS, refuses private, loopback and link-local addresses by default (N-12; an operator may allow specific hosts), and checks again on every request; a Forgejo identity is scoped to its instance ([3.5](#35-linking-git-host-accounts), [9.3](#93-git-host-connections)) | Anyone signed in can enter any address (N-7). Without the address checks, Shinan's server could be used to probe services that are only reachable from Musashi or the tailnet. A malicious instance can also claim any account on itself, which affects only credit for events from that instance. |
| T8  | The public address is abused                                                       | Throttling of sign-in emails and failed token use; uniform errors ([10](#10-protections-for-a-public-installation))                                                                                                                                                                                                             | Sign-in emails can still be requested for allowlisted addresses up to the throttle, which is mostly a nuisance.                                                                                                                                                                                    |
| T9  | A member's agent is steered by someone else                                        | Nudges from other members are queued by default and framed as requests ([6.5](#65-nudges-from-other-people))                                                                                                                                                                                                                    | An agent may still act on a well-phrased request from another member.                                                                                                                                                                                                                              |
| T10 | Shinan's Forgejo token is stolen                                                   | Stored encrypted; never shown again, logged or given to agents; used only to read (N-4) ([9.3](#93-git-host-connections))                                                                                                                                                                                                       | Shinan accepts any Forgejo token (O-54). Shinan only reads, but the token's power is set on Forgejo: if a site administrator connects with a broad token, anyone who steals it can act as any user on that instance.                                                                               |
| T11 | An insider or the operator misuses access                                          | Security log kept forever and not purgeable; operators cannot purge (O-47, O-50, N-8, N-13) ([11](#11-audit), [12](#12-self-hosted-installations))                                                                                                                                                                              | An operator with database access can still read or change anything.                                                                                                                                                                                                                                |
| T12 | Data is lost                                                                       | None in Shinan: no built-in backups for now (owner, O-62 to O-64)                                                                                                                                                                                                                                                               | The security log and everything else depend on host-level backups, which are paused on Musashi. "Forever" retention holds only as long as the disk does.                                                                                                                                           |

### Principles

**Proposed**, each with its reason:

1. **Closed by default.** Nothing is readable without sign-in, apart from
   the exceptions listed in [§10](#10-protections-for-a-public-installation),
   and every request is refused unless a rule allows it. Reason: D-015 puts the app on
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

| Identity (glossary term)                                   | Proves itself with                                                                                    | Section                               |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------- |
| [Person](domain-model.md#person)                           | An email magic link or GitHub, giving a sign-in session                                               | [3](#3-sign-in-for-people)            |
| [Member](domain-model.md#member-and-role)                  | A person plus a membership record with a role                                                         | [5](#5-members-roles-and-invitations) |
| [Agent](domain-model.md#agent)                             | An agent token, approved by its member                                                                | [6](#6-agents), [7](#7-tokens)        |
| [Agent session](domain-model.md#agent-session)             | Its agent's token, plus a conversation identifier the coding tool reports                             | [6.4](#64-agent-sessions)             |
| [Git host account](domain-model.md#git-host-account)       | GitHub: signing in with it. Forgejo: a token the person enters ([3.5](#35-linking-git-host-accounts)) | [3.5](#35-linking-git-host-accounts)  |
| [Git host connection](domain-model.md#git-host-connection) | Credentials Shinan holds for the git host                                                             | [9.3](#93-git-host-connections)       |
| Shinan itself ([actor](domain-model.md#actor))             | Its own server; on git hosts, the writes it recorded making                                           | [8](#8-acting-for-and-attribution)    |
| Outside actor                                              | Nothing: a git host account not linked to a member of this workspace                                  | [8.2](#82-evidence-and-confidence)    |
| Installation operator                                      | Access to the server; named in the installation's configuration                                       | [12](#12-self-hosted-installations)   |

## 3. Sign-in for people

### 3.1 Sign-in methods

**Decided (owner, O-41, N-7, [#25](https://github.com/guneet-xyz/shinan/issues/25)):**
people sign in to Shinan with an **email magic link** or with **GitHub**.
There is no password sign-in, no Forgejo sign-in and no passkeys. Forgejo is
used only to connect accounts and repositories ([3.5](#35-linking-git-host-accounts)).
Shinan sends email from the first version.

How each method works, **proposed** unless marked:

- **Email magic link.** Shinan emails a link that works once, expires after
  15 minutes, and is sent at most a few times per hour per address. Reason:
  short life and single use limit a link read from a mailbox or a log. Whoever
  controls the email account can sign in (T1); NIST SP 800-63B-4 does not
  accept email as an authentication channel, which is the residual risk the
  owner accepted. **Proposed (M1-4):** the emailed link opens a page that
  signs in only when the person clicks, with the token in the link's
  fragment. Reason: mail scanners that fetch links would otherwise use the
  link up (or sign in themselves), and the token stays out of server and
  proxy logs. Opening links is limited per network address like asking for
  them (5 a minute); only the first refusal in each minute is recorded, so a
  flood does not fill the security log. The reply to a request for a link is
  sent before Shinan
  decides whether the address may have one, so it takes the same time either
  way (§10); the deciding work still uses the database, which a determined
  observer of the server's load might notice.
- **GitHub.** Sign-in uses the same GitHub App that git host connections use
  ([git host integrations](git-hosts.md)). The person is identified by GitHub's
  stable account number, never by username or email. Shinan uses the
  authorization only to learn who signed in and keeps no GitHub token
  (owner, O-1). Reason: one app registration, and no stored per-person
  credential. A taken-over GitHub account is a taken-over Shinan account (T2).
- A person can use both methods. GitHub is added as a method only while the
  person is signed in; Shinan never attaches a method to a person because an
  email address matches. Reason: matching emails is a known way to take over
  accounts.
- Generic OpenID Connect providers may come later for self-hosted
  installations (D-012).

### 3.2 Who can have an account

**Decided (owner, O-42, O-48, [#25](https://github.com/guneet-xyz/shinan/issues/25)):**
an **email allowlist** decides who can have an account on an installation. Joining a workspace still needs an invitation
([5.2](#52-invitations)).

**Proposed:**

- The allowlist is kept by the installation's operators, who change it in
  the installation's settings. Every change is recorded in the
  installation-level security log. Reason: only someone responsible for the
  installation should decide who can use it. **Proposed (M1-4):** changing it
  needs re-authentication, like other changes to who can do what; operators'
  own addresses come from the configuration and are changed there.
- **First start** (the one rule for a fresh installation): the installation's
  configuration names the operators' email addresses, and those addresses seed
  the allowlist. The first operator account is claimed through a one-time
  setup link that the installation prints to its own log, confirmed by an
  email magic link sent to one of the configured operator addresses. After
  that, every account, including other operators', is created as below.
  Reason: claiming a fresh installation needs both access to the server and
  control of an operator's mailbox, so nobody can race the operator to it. The
  mechanism is for the [architecture](architecture.md) document.
- An account is created the first time an allowlisted person opens an email
  magic link sent to the allowlisted address. A person who starts with GitHub
  is asked for their email and sent such a link before the account exists.
  Reason: the allowlist is about email addresses, so Shinan checks the address
  itself rather than trusting the address GitHub reports.
  - **Proposed (M1-4):** the GitHub account is linked only when that link is
    opened in the same browser that signed in with GitHub, within 15 minutes,
    for the address entered on that step. Reason: otherwise someone could
    start with their own GitHub account, enter another person's address, and
    get their GitHub account linked when that person opens the link. Any
    other sign-in in that browser drops the waiting GitHub sign-in.
    Residual risk: someone who deliberately uses the email step in another
    person's unattended browser within those 15 minutes can link that
    person's GitHub account to their own account, which lets them sign in as
    themselves with it; it gives them nothing of the other person's.
  - **Proposed (M1-4):** the new account's handle is made from the address's
    local part (lowercase letters, digits and hyphens, with a number added if
    it is taken), and its name starts as the handle. Reason: the account is
    created as the link is opened, with nothing else to ask; the person can
    change their name, and handles never change (8.7).
- Removing an address from the allowlist ends that person's sign-in sessions,
  stops both sign-in methods, and revokes all their agent tokens in every
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
- **Re-authentication** asks the person to sign in again, with an email magic link or
  GitHub (offered only where the installation has GitHub sign-in, as on the
  sign-in page), even inside a sign-in session, before a sensitive action, unless they
  did so in the last few minutes. **Proposed (M1-4):** the last 10 minutes,
  counted from the start of the sign-in session; signing in again starts a
  new one and ends the old. Reason: long enough for a few sensitive actions
  in a row, short enough that a session left open or stolen rarely falls
  inside it (open question 1). Sensitive actions: approving an agent token
  or making one by hand, giving a deployment approval, inviting, changing
  roles, removing members, adding or changing git host connections, changing
  workspace settings, adding or removing a sign-in method, asking to change
  one's email address (3.4), purging, exporting,
  importing and deleting a workspace. Reason: a sign-in
  session left open or stolen from a browser should not be enough for actions
  that change who can do what or approve a live change. It does not stop someone who controls the
  person's mailbox or GitHub account (T1, T2).
- A person can see their active sign-in sessions and end any or all of them
  ("sign out everywhere").
- Shinan emails the person when they sign in from a browser it has not seen
  before, when GitHub is added or removed as a sign-in method, when an
  agent token is approved, and when a change of their email address is
  asked for (to the old address) or made (to both, 3.4). **Proposed (M1-4):** a browser is recognised by a
  long-lived cookie of its own, of which Shinan keeps only a hash per person;
  the sign-in that creates an account sends no alert. Reason: a quick alert is the main way a person
  learns that someone else is using their account. The alert goes to the same
  mailbox an attacker in T1 controls, so it helps most against T2 and stolen
  sign-in sessions.

### 3.4 Recovery

**Proposed:** a person who loses access to GitHub signs in with an email magic link.
A person who loses their email account cannot sign in by email; if they also
use GitHub they can sign in that way and change their email address, which
needs a link sent to the new address and an operator adding it to the
allowlist. Otherwise the installation operator can end the person's sign-in
sessions and change their email address with a server command, which is
recorded. Reason: email is the root of every account (O-41, N-7), and the
operator command saves a sole owner whose email account is lost.

**Proposed (M1-4):** the operator's command also, in the same step, removes
the old address from the email allowlist and withdraws the invitations still
pending for it; it adds the new address to the allowlist. The command refuses
an address the configuration still names as an operator's: operator rights
come from the address, so the operator first replaces it in the
configuration and restarts, then runs the command. Withdrawn invitations are not moved
to the new address; a workspace owner invites it again. Reason: the lost
mailbox may be in someone else's hands, and otherwise they could open a link
to the old address, get a new account with it, and accept the person's
invitations.

**Decided (owner, 2026-11-19, M2-Q17; [#66](https://github.com/guneet-xyz/shinan/issues/66),
built in [#137](https://github.com/guneet-xyz/shinan/pull/137)):** the
self-service change, from Your account, for anyone signed in (usually by
GitHub, when the old mailbox is lost):

- **Asking** needs a recent sign-in (3.3), like changing a sign-in method,
  since the address is how the person signs in. The new address must be on
  the email allowlist (an operator adds it, as above) and belong to no other
  account; an operator's address, old or new, is changed in the
  configuration and with the command above instead, since operator rights
  come from the address. Shinan emails a link to the new address and a
  security alert to the old one. Asking again replaces the earlier request
  and its link; a person may ask 5 times an hour. Reason: each request
  emails both addresses, and a session left open should not be able to
  flood either.
- **Confirming** needs the link, which works once, for an hour, and **only
  for the person who asked, signed in**. Reason: proof of the new mailbox
  alone is not enough. Otherwise someone could ask for another person's
  allowlisted address and get it confirmed by that person opening the link,
  then receive their invitations; the link's email says to ignore it if the
  reader did not ask. An hour, not a sign-in link's 15 minutes, because the
  person may have to reach a mailbox they do not use every day; the window
  gives no one else anything.
- **Then**, in one step and as the operator's command does: the address
  changes; the old one leaves the allowlist and its pending invitations are
  withdrawn (not moved); a GitHub sign-in waiting for it is dropped, and
  so is any change the person asked for themselves (the operator's command
  thus cancels a waiting self-service change). Other people's waiting
  requests for the new address are left to fail as "address taken" if
  confirmed, also when two people confirm it at once. Every other sign-in
  session of the person ends; the one they confirmed from stays. Agent
  tokens stay, because the person and their agents are the same; the alert
  says to revoke any they do not recognise. Both addresses get a security
  alert, which names both addresses in full. Each step is recorded in the security log (by `self`).
- A waiting change can be cancelled; its link then stops working. Links
  that expire unopened are deleted by the hourly sign-in clean-up.

### 3.5 Linking git host accounts

A person links their [git host accounts](domain-model.md#git-host-account) so
that activity on git hosts can be credited at all (D-017).

**Proposed** unless marked:

- **GitHub:** linked by signing in with GitHub, either as the person's first
  sign-in or later while signed in.
- **Forgejo** (**Decided**, owner, N-7: Forgejo is only connected, and anyone
  can enter any Forgejo address): the person enters the instance's address
  and a Forgejo access token. Shinan reads which account the token belongs to
  (`/api/v1/user`, which needs the `read:user` scope) and records the instance
  address and the account's number. A token limited to specific repositories
  cannot carry `read:user`, according to Forgejo's token-scope documentation,
  so a person who connects with such a token links their account with a
  second, short-lived token that has only `read:user`. If the person is only
  linking, Shinan then discards the token; if they are also connecting
  repositories, the connection keeps its token ([9.3](#93-git-host-connections)).
  Reason: with no Forgejo sign-in, a token is the only proof of the account,
  and it works on any instance without registering Shinan there.
  - **Decided (owner, N-12, [#25](https://github.com/guneet-xyz/shinan/issues/25)):**
    Shinan contacts only the address entered, over HTTPS, and by default
    refuses addresses that resolve to private, loopback or link-local ranges,
    checking again on every request. An installation operator may allow
    specific hosts. Reason: an address anyone can type must not turn Shinan's
    server into a way to reach services that are only visible from Musashi or
    the tailnet (T7).
  - A Forgejo identity is the instance address plus the account number. A
    malicious instance can claim any account on itself, but that only affects
    credit for events from that same instance.
- A link records the git host's address and stable account number, as well as
  the current username. Never by typing a username alone. Reason: usernames can
  be renamed or claimed by someone else; the number, proven by sign-in or by a
  token, cannot.
- One git host account can be linked to only one person per installation.
  Shared team accounts are an [open question](#open-questions).
- A commit's author or committer email is never treated as an account
  ([8.2](#82-evidence-and-confidence)). Reason: commit emails are free text.
- Unlinking an account stops future credit to the person (and, for GitHub,
  removes it as a sign-in method). Past events keep their credit.

## 4. Workspaces

**Decided (D-019):** workspaces exist, hold a team's catalog, tasks, git host
connections and members, and people are invited to them.

**Proposed:**

- Any person on an installation can create a workspace and becomes its
  workspace owner. Reason: the allowlist already decides who is a person;
  operators can restrict this. **Proposed (M1-4):** at most 10 a day per
  person, with names of at most 100 characters. Reason: workspace names go
  into events and the security log, which is kept forever.
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

**Decided (owner, N-11, [#25](https://github.com/guneet-xyz/shinan/issues/25)):**
there is no viewer role. A workspace has two roles: **workspace owner** and
**contributor**. **Proposed** here: the table below. Reason: each row is an
action another document defines; this table is the one place that says who may
take it.

Key: ✓ allowed; ✗ not allowed; "own" means only for themselves or their own
agents. The agent column is the most an agent can do; it also never exceeds its
member's role ([6.3](#63-what-an-agent-may-do)).

| Action                                                                                                       | Workspace owner | Contributor                                                                                        | Agent                                                                     |
| ------------------------------------------------------------------------------------------------------------ | --------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Read everything in the workspace: catalog (wiki, agent index), tasks, timelines, presence                    | ✓               | ✓                                                                                                  | ✓                                                                         |
| Create, claim, update tasks and subtasks; add work links; record verification                                | ✓               | ✓                                                                                                  | ✓                                                                         |
| Add or remove dependencies; move a subtask under another parent or make it top-level                         | ✓               | ✓                                                                                                  | ✓                                                                         |
| Rank `to do` tasks                                                                                           | ✓               | ✓                                                                                                  | ✗ (agents read the order)                                                 |
| Confirm or dismiss an unconfirmed link made by an outside actor's marker                                     | ✓               | ✓                                                                                                  | ✗                                                                         |
| Confirm or dismiss an unconfirmed link from a member's closing reference                                     | ✓               | ✓                                                                                                  | ✓                                                                         |
| Comment on tasks                                                                                             | ✓               | ✓                                                                                                  | ✗ (agents post progress updates)                                          |
| Post progress updates on its task                                                                            | –               | –                                                                                                  | ✓                                                                         |
| Send nudges                                                                                                  | ✓               | ✓                                                                                                  | ✗ (nudges come from people)                                               |
| Withdraw a nudge before it is delivered                                                                      | own             | own                                                                                                | ✗                                                                         |
| Release an agent session from a task (the session is told by a nudge)                                        | ✓               | ✓                                                                                                  | Only its own session (Release task)                                       |
| Request a git host action on a task (reaches the requester's own agent sessions, N-3)                        | ✓               | ✓                                                                                                  | ✗                                                                         |
| Accept or cancel tasks in `triage`; set `cancelled` or `on hold`                                             | ✓               | ✓                                                                                                  | ✗                                                                         |
| Set or clear `needs a person`, with a summary                                                                | ✓               | ✓                                                                                                  | ✓ (O-7)                                                                   |
| Set `awaiting deployment approval` (ask for approval)                                                        | ✓               | ✓                                                                                                  | ✓                                                                         |
| Give a deployment approval in Shinan (with re-authentication)                                                | ✓               | ✓ only if the workspace setting "contributors may give deployment approval" is on (off by default) | Only to record one its own member gave in the agent's conversation (O-20) |
| Make catalog proposals                                                                                       | ✓               | ✓                                                                                                  | ✓                                                                         |
| Comment on catalog proposals                                                                                 | ✓               | ✓                                                                                                  | ✓ (with `catalog:propose`)                                                |
| Approve gated catalog proposals                                                                              | ✓               | ✓                                                                                                  | ✗                                                                         |
| Register agents; approve, view and revoke their tokens                                                       | own             | own                                                                                                | ✗                                                                         |
| Disable any agent, revoke any token in the workspace                                                         | ✓               | ✗                                                                                                  | ✗                                                                         |
| Invite people; withdraw invitations                                                                          | ✓               | ✗                                                                                                  | ✗                                                                         |
| Change roles; remove members                                                                                 | ✓               | ✗                                                                                                  | ✗                                                                         |
| Add, change or remove git host connections                                                                   | ✓               | ✗                                                                                                  | ✗                                                                         |
| Change workspace settings, including the workspace's task flags                                              | ✓               | ✗                                                                                                  | ✗                                                                         |
| Read the workspace security log                                                                              | ✓               | own entries                                                                                        | ✗                                                                         |
| Correct the credit on an event from their own git host account                                               | own             | own                                                                                                | ✗                                                                         |
| Purge, export or delete the workspace; import an export into an empty workspace (all with re-authentication) | ✓               | ✗                                                                                                  | ✗                                                                         |
| Repair a catalog document by replacing its whole text (with re-authentication, catalog §8.3)                 | ✓               | ✗                                                                                                  | ✗                                                                         |

Notes:

- The task rows follow [Tasks and work](tasks.md) and the owner's answers:
  agents may set and clear `needs a person` (owner, O-7); deployment approval
  is given in Shinan, or in the conversation as recorded by the agent, never by
  comment or nudge (owner, O-20); task flags are managed per workspace (owner,
  O-8), so managing them is a workspace setting; a task is done when its
  subtasks, at any depth, are done and its delivering pull requests are merged
  (owner, O-21, N-1).
- Only gated, high-risk catalog changes need approval (owner, O-3), and only
  people approve them. **Decided (owner, O-46):** a person may approve a
  proposal made by their own agent while one person uses Shinan; the approval
  is recorded as the person's action, separate from the proposal.
- **Deployment approval in Shinan** is given by workspace owners, and by
  contributors only when the workspace setting "contributors may give
  deployment approval" is on. The setting is off by default and defined by
  [Tasks and work](tasks.md); [human experience](human-experience.md) shows it.
  Giving an approval always needs re-authentication
  ([3.3](#33-sign-in-sessions-and-re-authentication)). **Proposed**; reason:
  it is the one approval gate for live deployments (D-016 for
  `shinan.guneet.dev`), so a team chooses who may allow it, and a stolen
  sign-in session must not be enough.
- **Decided (owner, NO-4, [#26](https://github.com/guneet-xyz/shinan/issues/26)):**
  deployment approval requests and answers are always recorded as task
  events, whether or not the workspace keeps the `awaiting deployment
approval` flag.
- An agent recording a deployment approval may record only one given by its
  own member, in its own conversation. The record says "approved by Guneet in
  conversation, recorded by OpenCode on Daedalus". **Proposed**; reason: O-20
  allows conversation approvals, and showing who recorded it keeps the
  evidence honest, because Shinan did not see the approval itself.
- **Only workspace owners invite** in the first version. **Proposed**; reason:
  every member sees everything (O-43), so letting someone in stays with the
  people accountable for the workspace.
- Any member may give an agent a **read-only token** (only the `read` scopes,
  [7.2](#72-scopes)) when approving it. It is a choice of scopes, not a role.
  Reason: it limits what a leaked token can change.
- **Decided (owner, 2026-11-19, M2-Q17; M2-5, [#83](https://github.com/guneet-xyz/shinan/issues/83)):**
  "own" agents are those of the member's current membership. A member
  registers agents only for themselves; seeing, renaming, enabling and making
  tokens stay with the agent's own member. A workspace owner sees every
  agent in the workspace with its token's use, and may disable any agent and
  revoke any token, but not rename, enable or make tokens for another
  member's agent. Only making a token needs re-authentication; disabling,
  revoking and renaming do not. Reason: making a token is the one action
  that gives access; the others only take it away or change a label, and
  revoking must be quick when a token leaks.
- Every contributor can read and change the whole workspace, including
  infrastructure details and private-repository work (O-2, O-43, N-11). The
  invitation screen says so ([human experience](human-experience.md)).

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
  is also controlled (T4).
- Links are single-use, expire after 7 days and can be withdrawn before
  acceptance. **Proposed (M1-4):** sending an invitation again gives it a new
  link and another 7 days, and the old link stops working; accepting or
  declining needs no re-authentication, because it changes only the
  invitee's own access and needs the invited address's sign-in anyway.
- Before the invitee signs in, the acceptance page shows only the
  installation's name.
- Creating, withdrawing, accepting and declining are recorded in the security
  log.
- **Proposed ([#67](https://github.com/guneet-xyz/shinan/issues/67)):** expiry
  is recorded too. An hourly worker job (`invitation-expiry`) marks every
  pending invitation past its expiry as `expired`, as of its expiry time, and
  records an `invitation.expired` event and security-log entry credited to
  Shinan, as Shinan's own action with no network address or client;
  inviting the same address again before the job has run records it the
  same way. Until then, reads already show such an invitation as expired
  and it cannot be accepted. Sending an expired invitation again, recorded
  or not, reopens it as pending with a new link, unless a newer invitation
  to the same address is pending; that one is sent again instead. Sending
  one past its expiry that the job has not reached yet records the expiry
  first. The job works one workspace at a time, locking the workspace first
  as inviting, resending and withdrawing do; it leaves a busy workspace,
  and any invitation another request holds (accepting it), for its next
  run, and one workspace's failure does not stop the others. Reason: the
  workspace's history and security log then show when each invitation
  stopped working (section 11), not only that it did.

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
  machine works anywhere (T3).
- **Decided (owner, NO-1, [#26](https://github.com/guneet-xyz/shinan/issues/26)):**
  each agent has **one token**. The clients on its machine (the plugin, the
  MCP client and the CLI) all use it, and all their actions are credited to
  that agent.
- Losing or retiring a machine (as Takezo was in November 2026) means
  disabling the agents on it, which revokes all their tokens and nothing else.
- **Decided (owner, 2026-11-19, M2-Q17; M2-5):** an agent belongs to the **membership** it was created
  with, not only to its person. If a member leaves or is removed and later
  rejoins, their old agents stay disabled and they register new ones. Reason:
  an agent must not outlive the membership it acted through
  ([5.3](#53-leaving-removal-and-role-changes)), and checking the agent's own
  membership row on every request makes that hold even if a token were
  somehow still live.
- Every subagent is its own agent session of the same agent (owner, O-37).

### 6.2 Registering an agent

**Decided (owner, NO-1, [#26](https://github.com/guneet-xyz/shinan/issues/26)):**
an agent gets its long-lived token through a **browser approval started from
the plugin or the CLI**, with a short code for machines without a browser, and
a **token made by hand** in the web app as the fallback. There is one token
per agent, accepted at every agent endpoint: the MCP endpoint, the REST API
and the plugin stream. There is no MCP-specific OAuth sign-in in the first
version; it may come later, only if a coding tool needs it.

The flow, with the details **proposed** here:

```mermaid
sequenceDiagram
  participant T as Plugin or CLI on a machine
  participant B as Person's browser (any device)
  participant S as Shinan
  T->>S: Ask to register: coding tool, suggested machine name
  S-->>T: Approval link and short code
  T->>B: Open the link, or the person types the code on another device
  B->>S: Person signs in and re-authenticates
  S->>B: Show workspace, coding tool, scopes; ask which machine
  B->>S: Choose or create the agent for this tool and machine; reduce scopes; approve
  S-->>T: The agent's long-lived token
  S->>S: Record in security log; email the person
```

- The steps follow the shape of the OAuth device authorization grant
  (RFC 8628: show a link and a short code, the person approves in a browser,
  the tool receives the token). How it is built is for the
  [architecture](architecture.md) document.
- The person, not the tool, chooses or confirms the machine on the approval
  page. Reason: the tool only suggests a name; the person knows which machine
  it is.
- The plugin or CLI stores the token for the coding tool and configures the
  tool's MCP connection to send it as an `Authorization` header, read from the
  machine's credential store or an environment variable, never written into a
  project file. Reason: one approval covers the plugin, MCP and the CLI on a
  machine, as [agent integrations](agent-integrations.md) requires, and
  headless runs (such as `claude -p`) need no browser at run time.
- **Token made by hand (fallback):** the person creates a token for an agent
  in the web app, with re-authentication, chooses its machine and scopes, sees
  it once, and places it on the machine. Reason: for tools or machines where
  neither the plugin nor the CLI can run the approval. **Decided (owner, 2026-11-19, M2-Q17; M2-5):**
  the person picks the workspace, the coding tool and the machine; if they
  already have an agent with that handle, it gets the new token (and its old
  one is revoked), otherwise the agent is created. A disabled agent gets no
  token until it is enabled again ([7.5](#75-revocation)). The person can also
  replace the token of an agent from its row, with the same access.
- The token goes straight to the tool or to the person, never through a chat,
  issue or file in a repository. The `workspace` repository's policy already
  forbids pasting credentials into conversations.
- Reasons for this flow over the coding tools' own MCP OAuth sign-in (as
  recorded with NO-1): one approval serves every component on a machine;
  headless runs work; with long-lived tokens (O-44) there is nothing to
  refresh; and Shinan does not have to act as a full OAuth authorization server
  on a public address (D-015). Cost: a tool that supports only MCP OAuth and no
  custom header would need the CLI as a bridge.

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
- send nudges, withdraw them, or request git host actions;
- comment on tasks (agents post progress updates instead; they may comment on
  catalog proposals);
- rank `to do` tasks, or confirm links made by outside actors' markers;
- release another agent session from a task (an agent may release only its
  own session);
- give a deployment approval (an agent may only record one its own member gave
  in the agent's conversation, O-20);
- purge, export, import or delete a workspace;
- accept a task out of `triage`, set `cancelled` or `on hold`, and anything else
  [Tasks and work](tasks.md) or [Catalog](catalog.md) reserves for people.

Reason: these actions either change who can do what, or are themselves the
human check. A stolen or misled agent (T3) must not be able to widen its access
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
  Every nudge is recorded. Reason: the plan's Nudges
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

| Credential                                     | Held by                                                    | Lets the holder                                                                                                             | Lifetime                                                                              |
| ---------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Sign-in session                                | A person's browser                                         | Act as the person in the web app                                                                                            | 24 hours, 1 hour idle ([3.3](#33-sign-in-sessions-and-re-authentication))             |
| Email magic link                               | The person's mailbox                                       | Start one sign-in session                                                                                                   | 15 minutes, once                                                                      |
| Agent token (one per agent, NO-1)              | The plugin, MCP client and CLI of one agent on one machine | Act as that agent in one workspace, within its scopes, at the installation's agent endpoints (MCP, REST API, plugin stream) | Until revoked (owner, O-44)                                                           |
| Invitation link                                | The invitee's mailbox                                      | Accept one invitation, once signed in with the invited address                                                              | 7 days, once                                                                          |
| GitHub App private key and installation tokens | The Shinan server                                          | Read from GitHub and make Shinan's own writes (its only git host writes), as the app                                        | Key until rotated; installation tokens 1 hour ([git host integrations](git-hosts.md)) |
| Forgejo connection token                       | The Shinan server, encrypted                               | Read from Forgejo, as the connecting person; Shinan never writes with it (N-4) ([9.3](#93-git-host-connections))            | Set by the person on Forgejo                                                          |
| Forgejo linking token                          | Briefly, the Shinan server                                 | Show which Forgejo account it belongs to (`read:user`)                                                                      | Used once and discarded ([3.5](#35-linking-git-host-accounts))                        |
| Webhook secrets                                | The Shinan server and a git host                           | Prove a webhook came from that host                                                                                         | Owned by [git host integrations](git-hosts.md)                                        |
| Launcher token (phase 3)                       | One machine                                                | Receive start requests for that person's agents on that machine                                                             | Until revoked ([6.6](#66-launchers-phase-3))                                          |

**Decided (owner, O-1, N-4):** Shinan stores no per-person GitHub tokens; the
token received during GitHub sign-in is used once to learn who signed in and
then discarded. The only per-person git host credential Shinan keeps is a
Forgejo connection token, used only to read.

**Proposed:** no personal API tokens for people. The CLI uses an agent token.
Reason: a person's token on a machine where agents run would let any agent
there act as the person, defeating both attribution and the reserved-for-people
rule.

### 7.2 Scopes

**Proposed** starting scopes:

| Scope             | Allows                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `catalog:read`    | Read the catalog and the agent index                                                                                                  |
| `catalog:propose` | Make and withdraw catalog proposals; comment on catalog proposals                                                                     |
| `tasks:read`      | Read tasks, work links and timelines                                                                                                  |
| `tasks:write`     | Create, claim and update tasks and subtasks; add work links; record verification; post progress updates; set the flags agents may set |
| `presence`        | Report agent sessions and presence; receive nudges                                                                                    |

A normal agent gets all five. A **read-only token** has only the two `read`
scopes; it is a choice of scopes offered when approving a token, not a role
(N-11 removed only the viewer role). Reason: splitting reading from writing is the line that matters most when a
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
- Issuing a new token for an agent, by approval or by hand, revokes its
  previous one. Reason: one token per agent (NO-1). **Decided (owner, 2026-11-19, M2-Q17; M2-5):** the
  database allows at most one token per agent that is not revoked. Revoked
  tokens are kept, with when and why they were revoked and their use summary,
  so the agent page and the security log can still explain them.
- **Decided (owner, 2026-11-19, M2-Q17; M2-5):** each token records its first and last use, the network
  address of the last request, and how many requests it has made. Only
  requests the token's rate limit lets through count as uses. "Unused for 30
  days" counts from the last use, or from when the token was made if it was
  never used.

### 7.4 Handling

**Proposed:**

- A token is shown once, if at all, and Shinan stores only a one-way hash of
  it. Reason: a copy of Shinan's database must not contain usable tokens.
- Tokens start with a recognisable prefix. Reason: leak scanners, and later
  Shinan itself, can then spot them in text. **Decided (owner, 2026-11-19, M2-Q17; M2-5,
  [#83](https://github.com/guneet-xyz/shinan/issues/83)):** an agent token is
  exactly 56 characters: the prefix `shinan_agent_` followed by 43 random
  letters and digits (`A`–`Z`, `a`–`z`, `0`–`9`, chosen uniformly, about 256
  bits). Scanners can match it with `shinan_agent_[A-Za-z0-9]{43}`. Reason:
  the product name makes the prefix unmistakable, `agent` leaves room for the
  launcher token's own prefix later, and with only letters, digits and
  underscores the whole token is one word, so double-click selection and
  word-boundary matching take it whole. A short checksum at the end, as
  GitHub's tokens have, could be added later so scanners can reject
  look-alikes without asking Shinan; it is not part of the format now.
- Tokens are sent in an `Authorization` header, never in a web address.
  Reason: web addresses end up in logs; the MCP specification also forbids
  tokens in query strings.
- **Decided (owner, NO-1):** an agent token is accepted at every agent
  endpoint of the installation that issued it (the MCP endpoint, the REST API
  and the plugin stream) and nowhere else. **Proposed:** the token records the
  installation's address, and other installations reject it. Which endpoints
  exist is for the [architecture](architecture.md) document. **Decided
  (owner, 2026-11-19, M2-Q17; M2-5):** the address recorded is the origin of `SHINAN_URL` when the token
  was made, and a token is refused whenever it differs from the current one,
  or when the installation's address is not set at all. So a copy of the
  database restored under another address accepts none of its tokens, and an
  operator who changes the installation's address must have every agent's
  token made again; the [operator guide](operator-guide.md) says so.
- **Decided (owner, 2026-11-19, M2-Q17; M2-5):** an agent endpoint refuses a request that carries a
  sign-in cookie as well as a token, and a request whose address carries a
  token (a parameter such as `access_token`, or Shinan's prefix anywhere in
  it). Agent endpoints, and only they, are outside the web app's same-origin
  check: they take no cookie, so a forged browser request has no credential
  to use there. A token sent to any other route changes nothing.
- **Decided (owner, 2026-11-19, M2-Q17; M2-5):** on every use Shinan also checks that the agent's
  person is still on the email allowlist ([3.2](#32-who-can-have-an-account)),
  as it checks the agent's membership. Reason: removal from the allowlist
  revokes tokens at that moment, and the check covers a token that escaped
  it, for example one made by a request that raced the removal.
- Shinan's own token prefixes are refused in catalog proposals from the first
  version, as the [catalog](catalog.md) requires. Refusing them in other text
  (comments, progress updates) and revoking the exposed token automatically
  come later ([13](#13-first-version-scope)).
- How a coding tool stores the token on the machine is owned by
  [agent integrations](agent-integrations.md); the machine's own credential
  store is preferred over a plain file.

### 7.5 Revocation

**Proposed:**

| Action                                          | Who can do it                                       | Effect                                                                                        |
| ----------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Revoke an agent's token                         | Its member; a workspace owner                       | The token stops working; the agent needs a new approval or a token made by hand               |
| Disable an agent (that is, one machine's agent) | Its member; a workspace owner                       | Its token stops working and no new one can be issued until it is enabled again                |
| Disable a machine                               | The person, for their own agents and launcher on it | All their agents and the launcher on that machine stop working                                |
| Remove a member or lower a role                 | A workspace owner                                   | See [5.3](#53-leaving-removal-and-role-changes)                                               |
| Sign out everywhere                             | The person                                          | Ends all their sign-in sessions; optionally revokes all their agent tokens in every workspace |
| Remove from the allowlist                       | An installation operator                            | See [3.2](#32-who-can-have-an-account)                                                        |

- Revocation takes effect on the next request: Shinan checks on every request
  that the token is still valid. Reason: long-lived tokens (O-44) make instant
  revocation the main control.
- **Decided (owner, 2026-11-19, M2-Q17; M2-5):** what each automatic trigger does. Removing a member
  and a member leaving **disable** the membership's agents (and so revoke
  their tokens). Removal from the allowlist and "sign out everywhere" with
  its option chosen **revoke** the person's tokens in every workspace but
  leave the agents enabled, so the person can make new tokens once they are
  back. "Sign out everywhere" offers the option unticked. Every revocation
  records why: `revoked` (by hand), `replaced`, `agent-disabled`,
  `member-removed`, `member-left`, `allowlist-removed` or
  `signed-out-everywhere`.
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
- Items Shinan wrote itself (only on GitHub, N-4) are recognised by their
  author being the GitHub App's own account, which no person or agent can
  use, and by the item IDs Shinan stored ([9.3](#93-git-host-connections)).

**Levels:**

| Confidence      | When                                                                                                                                                                                                                                                       | Credited to                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `recorded`      | The action came through Shinan with a valid sign-in session or agent token.                                                                                                                                                                                | The person; or the agent session, if it belongs to that agent, otherwise the agent. |
| `recorded`      | The item was written on GitHub by the GitHub App's own account.                                                                                                                                                                                            | Shinan.                                                                             |
| `marked`        | A git host item carries a marker naming an agent session that passes the checks in [8.3](#83-checking-markers); or (later) a commit is signed with a key registered to one agent ([8.4](#84-stronger-evidence-agent-signing-keys)).                        | That agent session (or agent).                                                      |
| `inferred`      | No confirmed marker, but Shinan's records point one way: one of the person's agent sessions was active, attached to a task linked to this item and reporting this repository at the time; or **none** of the person's connected agent sessions was active. | "Probably" that agent session; or the person, labelled "no connected agent active". |
| `unknown`       | The account is linked to a member but nothing points either way.                                                                                                                                                                                           | "The person or one of their agents".                                                |
| (outside actor) | The account is not linked to any member of this workspace.                                                                                                                                                                                                 | The git host account itself.                                                        |

Reasons:

- Only actions through Shinan were seen by Shinan, so only they are
  `recorded`. Shinan's own GitHub writes are recognised by the app's own
  account, which only Shinan can use, as [git host integrations](git-hosts.md)
  proposes; the stored IDs let Shinan edit its backlinks. Shinan makes no
  writes on Forgejo (N-4), so everything from a Forgejo account, including the
  connecting person's, is credited by the rules here.
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

### 8.7 How an actor is written in text

Some records name an actor in plain text, such as the `by` field of a
[fact check](catalog.md) (`by: guneet via opencode-daedalus`). **Proposed**
written forms:

| Actor                                                                       | Written form                         | Example                        |
| --------------------------------------------------------------------------- | ------------------------------------ | ------------------------------ |
| A person                                                                    | The person's **handle**              | `guneet`                       |
| An agent session acting for a person, or the agent when no session is known | `<person handle> via <agent handle>` | `guneet via opencode-daedalus` |
| Shinan itself                                                               | `shinan`                             | `shinan`                       |
| An imported record whose actor is not known                                 | `unknown`                            | `unknown`                      |

- A person's handle is chosen when their account is created: lowercase
  letters, digits and hyphens, unique in the installation, and not changeable
  in the first version. **Proposed (M1-4):** never `shinan` or `unknown`,
  the written forms of other actors below. Reason: a person writing as
  `shinan` could not be told apart from Shinan itself.
- An agent's handle is `<coding tool>-<machine>`, set when the agent is
  created on the approval page ([6.2](#62-registering-an-agent)), unique among
  the person's agents in the workspace, and not changeable. **Decided
  (owner, 2026-11-19, M2-Q17; M2-5):** the coding tool and the machine are each lowercase letters,
  digits and single hyphens, at most 32 characters; what a person types is
  lowered, and spaces, dots and underscores become hyphens ("MacBook Air"
  becomes `macbook-air`). The handle is unique among the agents of one
  membership ([6.1](#61-what-one-agent-is)). Because both parts may hold
  hyphens, two pairs can make one handle (`gemini-cli` on `daedalus` and
  `gemini` on `cli-daedalus`); Shinan refuses the second and asks for another
  machine name, rather than treating it as the first agent. An agent also
  has a **name** for
  people, such as "OpenCode on Daedalus", which its member can rename;
  renaming never changes the handle or any record.
- The written form names the agent, not the agent session. The exact agent
  session is on the event that recorded the change, with attribution
  `recorded`. Reason: the text stays short and readable, and full detail lives
  in events.
- Shinan writes the form itself from the actor of the request; nobody types it.
  So a written actor always matches a `recorded` attribution, except `unknown`
  on imports. Reason: a typed name could credit someone else.
- Written forms of former members and disabled agents stay as they are.
  Reason: past records are not rewritten.

## 9. Access rules

### 9.1 How every request is checked

**Proposed:** every request, from any path (web app, MCP server, CLI, plugin,
agent index, search, export), goes through the same checks:

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
  connections, with re-authentication. Because a Forgejo connection reads with
  the connecting person's own token (O-53), a Forgejo repository that only a
  contributor can read cannot be connected. That is fine while the owner is the
  only member; it is revisited before a second member joins.
- **Decided (owner, O-1, O-51, N-4):** on GitHub, Shinan connects through a
  GitHub App and uses only its installation token. Shinan's own writes (such as
  backlinks) appear as the app, and these are the only writes Shinan makes on
  any git host. It recognises them by the item IDs it stored when writing.
- **Decided (owner, O-53, N-4, N-7):** on Forgejo, a connection uses the
  connecting person's own account and is **read-only**: no backlinks or other
  writes. The person enters any Forgejo address and a token
  ([3.5](#35-linking-git-host-accounts)). Activity from that account is
  credited by the normal rules ([8.2](#82-evidence-and-confidence)).
- **Decided (owner, O-54):** Shinan accepts any Forgejo token and stores it
  encrypted. Residual risk: Shinan only reads, but a token's power is set on
  Forgejo. If the connecting person is a site administrator and gives a broad
  token, anyone who steals it (for example from a database copy plus the
  encryption key) can act as any user on that instance (T10). **Proposed:** the
  connection screen says that a read-only token is enough, the token is never
  shown again, logged or given to agents, and Shinan uses it only for the read
  calls git host integrations lists. Reason: these are the controls left once
  any token is accepted.
- **Proposed:** outbound requests to a Forgejo address follow the address
  checks in [3.5](#35-linking-git-host-accounts) (T7).

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
  acceptance page, a minimal health check and the skill's files at
  `/skills/` (decided, owner, [D-056](decisions/D-056-public-skill-path.md):
  OpenCode loads HTTP skill catalogs without credentials, and the skill holds
  only product conventions, never workspace content; how it is served:
  [architecture §10.2](architecture.md#102-web-hardening)). The wiki and agent
  index are behind sign-in too. The public health check is `/api/status`, a constant
  answer that touches no database; the liveness and readiness checks are served only inside the
  container network ([architecture §13](architecture.md#13-observability)).
- **No passwords to guess** (N-7): sign-in is by magic link or GitHub.
- **Throttling** of sign-in and invitation emails (per address and per network
  address, so Shinan cannot be used to flood a mailbox) and of failed token
  use. Failures are recorded. **Decided (owner, 2026-11-19, M2-Q17; M2-5):** after 10 failed agent token
  attempts in a minute from one network address, further failing attempts
  from that address are refused (429) until the minute ends. Each failure up
  to the limit is recorded with its reason, and then only the first refusal.
  A working token is always looked up first and is never refused because of
  other requests from its address: guessing a token is infeasible, so the
  limit only keeps the log and the load bounded, and a shared address (a
  machine, a home network, or every visitor if the trusted proxy is set
  wrong) must not let one client stop the others' agents. Each token is
  limited to 600 requests a minute from anywhere (**decided**, owner,
  2026-11-19, M2-Q16, with 300 a minute per address on `/mcp` and `/api`). Every refused token gets
  the same answer (401 `invalid-token`).
- **Uniform answers** that do not reveal whether an email address is
  allowlisted or whether a person, workspace, task or repository exists.
  Reason: probing for names leaks information.
- **Address checks on outbound requests** to Forgejo addresses people enter
  ([3.5](#35-linking-git-host-accounts)).
- **Security emails** on new-browser sign-ins, sign-in method changes and new
  agent tokens ([3.3](#33-sign-in-sessions-and-re-authentication)).
- **Narrow, hashed tokens checked on every request** ([7](#7-tokens)).
- **Outside text is data, not instructions.** The
  [agent integrations](agent-integrations.md) document makes MCP answers carry
  a trust label on each text field: who wrote it (member, agent, outside actor
  or Shinan) and whether it may be treated as an instruction, as the
  [architecture](architecture.md) document proposes. Reason: the `workspace` repository's policy already
  treats commands found in issues and logs as data.

The residual risks of the owner's choices are listed with the
[threats](#threats-and-residual-risks).

## 11. Audit

The **security log** records, as [events](domain-model.md#event) of security
kinds (**proposed**):

| Area                 | Recorded                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in              | Sign-ins and failures by method, magic links sent and used, re-authentications, GitHub added or removed as a sign-in method, sign-in sessions ended |
| Accounts             | Allowlist additions and removals; accounts created; email address changes                                                                           |
| Membership           | Invitations created, withdrawn, accepted, declined, expired; role changes; removals; leaving                                                        |
| Agents and tokens    | Agents created, renamed, disabled; tokens approved and revoked (and why); each token's first and last use, network address and number of requests   |
| Git hosts            | Git host accounts linked and unlinked; connections added, changed, removed; Forgejo addresses refused by the address checks                         |
| Workspace            | Settings changed; exports; purges; deletion                                                                                                         |
| Approvals and credit | Catalog approvals; deployment approvals, including who recorded them; attribution corrections                                                       |
| Refusals             | Requests refused by the checks in [9.1](#91-how-every-request-is-checked), especially agents attempting reserved actions                            |
| Operator             | Account resets and installation setting changes                                                                                                     |

- Each entry records the actor and confidence, time, network address, the
  client described by the request, what changed, and the outcome.
- Workspace owners see their workspace's log; each person sees their own
  entries; operators see installation-level entries. Reason: the log holds
  network addresses, which are personal data.
- Reads are recorded as per-token summaries and as bulk reads (agent index
  downloads, exports), not page by page. **Decided (owner, 2026-11-19, M2-Q17; M2-5):** a token's first
  use is recorded once (`agent-token.first-used`, with its network address);
  every hour, each token used since the last summary gets one
  `agent-token.used` entry with the number of requests, first and last use
  and the last network address; and its revocation entry carries the same
  summary. In both, `requests` counts the requests since the previous
  summary, so no request is in two entries, and `totalRequests` those since
  the token was made. Agent and token entries are `agent.created`, `agent.renamed`,
  `agent.disabled`, `agent.enabled`, `agent-token.issued`,
  `agent-token.revoked` and `agent-token.failed`. **Decided (owner, 2026-11-19, M2-Q17; M2-6):** an agent's read of a
  workspace-wide catalog list (`catalog_lists` over MCP) is one
  `catalog.bulk-read` entry per call, with the list, the page offset, the
  number of items and the catalog revision; so is each page after the first
  of a listing of every entity (`search_catalog` with no words, list
  `entities`). **Decided (owner, 2026-11-19, M2-Q17; #133):** a workspace owner's repair of a catalog
  document is recorded as their approval, `catalog-proposal.approved` with
  `repair: true`, like any approval; the text is never in the entry.
  **Decided (owner, 2026-11-19, M2-Q17; M2-10):** a catalog purge is one `catalog.purged`
  entry with the purge's ID and number, the revision it stored and how
  many revision texts, documents, proposals and events it changed, never
  the purged text or the reason (which is free text, kept on the timeline).
  A purge, and seeing where a text is before purging it, need a workspace
  owner who signed in again recently; agents are refused.
- **Decided (owner, O-47, N-8, N-13, [#25](https://github.com/guneet-xyz/shinan/issues/25)):**
  the security log is kept forever, and no security-log entry can ever be
  purged, by anyone: neither installation-level entries nor a workspace's
  entries. A purge of other content is itself recorded there. Reason: it keeps
  "forever" meaningful and stops an owner account taken over through T1 or T2
  from erasing its own traces.
- **Decided (owner, O-50, N-13):** only workspace owners can purge workspace
  content, including operational records about their workspace (raw webhook
  deliveries, job records, logs), but not the security log; installation
  operators cannot purge.
- Residual risks: an operator with database access can still change entries;
  network addresses are kept forever; and with no built-in backups (O-62 to
  O-64) the log is only as durable as the host's disk.

## 12. Self-hosted installations

**Decided (D-012):** Shinan is self-hostable by design.

**Proposed:**

- The **installation operator** can read and change everything in the
  installation's storage. Shinan cannot protect a workspace from its own
  operator, and documentation says so.
- In the app, operators are the people whose email addresses the
  installation's configuration names ([3.2](#32-who-can-have-an-account)).
  They keep the allowlist and change installation settings,
  including any exceptions to the Forgejo address checks. They are not members
  of any workspace by being operators and cannot purge (O-50).
- On `shinan.guneet.dev`, the owner is both operator and sole workspace owner.

## 13. First version scope

**Decided (owner, O-49, [#25](https://github.com/guneet-xyz/shinan/issues/25)):**
D-019 is read as "design now, build before the second member", in three
stages. The contents below follow the owner's other answers (O-1, O-2, O-41,
O-43, O-44, O-47, O-48, O-50, N-4, N-7, N-8, N-11, N-12, N-13) and NO-1. The viewer test account is
dropped from the first version (owner, N-11).

| Built in version 1                                                                                                                                                                                                            | Designed now, built before a second member joins                                                                                        | Later                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Person, member, role and workspace recorded on every record; the owner is the only workspace owner                                                                                                                            | The invitation flow by email ([5.2](#52-invitations))                                                                                   | Workspace deletion grace period and restore                          |
| The single check path ([9.1](#91-how-every-request-is-checked))                                                                                                                                                               | The contributor role enforced in screens and checks ([5.1](#51-roles-and-permissions))                                                  | Generic OpenID Connect sign-in                                       |
| Sign-in by magic link and GitHub; email sending                                                                                                                                                                               | Removal and role-change effects ([5.3](#53-leaving-removal-and-role-changes))                                                           | Agent signing keys ([8.4](#84-stronger-evidence-agent-signing-keys)) |
| The email allowlist; sign-in session limits; re-authentication; security emails                                                                                                                                               | Nudges from other members: framing and the per-agent opt-out ([6.5](#65-nudges-from-other-people))                                      | The launcher token (phase 3, [6.6](#66-launchers-phase-3))           |
| Linking GitHub through sign-in and Forgejo through a token, with the address checks                                                                                                                                           | Security log views for members other than the workspace owner                                                                           | Refusing text that contains Shinan tokens ([7.4](#74-handling))      |
| Agent registration through a browser approval started from the plugin or CLI (with a short code), and tokens made by hand; one token per agent at every agent endpoint (NO-1); scopes, including read-only tokens; revocation | GitHub sign-in for people other than the GitHub App's owner, if the private app does not allow it ([open question 10](#open-questions)) | Full read logging, if ever needed                                    |
| Hashed tokens with a recognisable prefix, refused in catalog proposals; throttling; uniform errors                                                                                                                            |                                                                                                                                         | MCP-specific OAuth sign-in, only if a coding tool needs it (NO-1)    |
| The security log, kept forever and not purgeable, readable by the workspace owner; purge of other content limited to workspace owners wherever purge is built                                                                 |                                                                                                                                         |                                                                      |
| Attribution: which account counts, confidence levels, marker checks, corrections, Shinan's GitHub writes recognised by the app's account, written actor forms ([8.7](#87-how-an-actor-is-written-in-text))                    |                                                                                                                                         |                                                                      |

## Glossary terms

The [domain model and glossary](domain-model.md) now carries the terms this
document introduced, including handle, read-only token, re-authentication,
launcher token, email allowlist and email magic link.

## Dependencies on other documents

Current needs only.

| Document                                       | What this document needs from it                                                                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Domain model and glossary](domain-model.md)   | The terms used here.                                                                                                                                                    |
| [Tasks and work](tasks.md)                     | Claims released on removal or revocation, manual release, the deployment approval setting, and approval records as task events, as it defines them.                     |
| [Git host integrations](git-hosts.md)          | Whether people other than the app's owner can authorize the private GitHub App for sign-in ([open question 10](#open-questions)).                                       |
| [Agent integrations](agent-integrations.md)    | Trust labels whose `author` uses the written forms of [8.7](#87-how-an-actor-is-written-in-text); framing of nudges from other members; the launcher setup guide (O-1). |
| [Human experience](human-experience.md)        | The "contributors may give deployment approval" setting on a screen, and Approve shown only to people allowed to give it ([5.1](#51-roles-and-permissions)).            |
| [Architecture and operations](architecture.md) | The first-start rule of [3.2](#32-who-can-have-an-account), including the one-time setup link printed to the installation's log.                                        |
| [Roadmap and migration](roadmap.md)            | The [first version scope](#13-first-version-scope); measuring attribution in the proof of concept.                                                                      |

## Sources checked

All checked on 2026-11-16.

- NIST, [SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)
  (August 2025): AAL2 reauthentication guidance (24 hours, 1 hour idle); email
  not accepted for out-of-band authentication.
- Model Context Protocol, [Authorization](https://modelcontextprotocol.io/specification/latest/basic/authorization)
  (2026-07-28 revision): tokens only in the Authorization header, never in the
  query string. Its OAuth sign-in is not used in the first version (NO-1).
- IETF, [RFC 8628: OAuth 2.0 Device Authorization Grant](https://datatracker.ietf.org/doc/html/rfc8628)
  (the shape of the browser approval with a short code).
- GitHub Docs, [Webhook events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads)
  (`sender`, `ghost`); [About commit signature verification](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification)
  and [Adding a new SSH key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/adding-a-new-ssh-key-to-your-github-account)
  (signing key type).
- Forgejo Docs v17.0, [Access token scope](https://forgejo.org/docs/latest/user/authentication/token-scope/)
  (`read:user` covers `/user` routes; "specific repositories" tokens may carry
  only repository and issue scopes; site administrators' tokens can act as
  other users with `sudo`).
- Forgejo source at `v16.0.5`,
  [`ssh_key_object_verification.go`](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/models/asymkey/ssh_key_object_verification.go)
  and [`ssh_key.go`](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/models/asymkey/ssh_key.go);
  [Gitea pull request 17743](https://github.com/go-gitea/gitea/pull/17743).
- The owner's answers, [issue #25](https://github.com/guneet-xyz/shinan/issues/25),
  including batches 12 and 13, and the integration review with the owner's
  answers, [issue #26](https://github.com/guneet-xyz/shinan/issues/26).
- The `workspace` repository (read-only background): `docs/access-and-safety.md`,
  `docs/collaboration.md`, `catalog/services/forgejo.md`.

## Open questions

1. **Re-authentication window.** How many minutes count as "recent" for
   sensitive actions? **Proposed (M1-4):** 10 minutes
   ([3.3](#33-sign-in-sessions-and-re-authentication)).
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
10. **GitHub sign-in for a second member.** It was not checked whether people
    other than `guneet-xyz` can authorize the private GitHub App. If they
    cannot, GitHub sign-in for a second member needs a public app or a
    separate sign-in-only app; magic links work regardless. To settle before a
    second member joins ([git host integrations](git-hosts.md)).

## Decisions needed from the owner

None. The owner answered every decision this document raised (O-1 to O-98
and N-1 to N-13 in [issue #25](https://github.com/guneet-xyz/shinan/issues/25),
and NO-1 and NO-4 in [issue #26](https://github.com/guneet-xyz/shinan/issues/26)).
