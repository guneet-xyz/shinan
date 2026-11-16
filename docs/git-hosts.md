# Git host integrations

Status: **approved by the owner on 2026-11-16** ([issue #8](https://github.com/guneet-xyz/shinan/issues/8); integrated in [#26](https://github.com/guneet-xyz/shinan/issues/26)).
Updated with the owner's answers in [issue #25][o] (O-1 to O-98, and the
follow-up answers N-1 to N-13) and the answers to the integration review in
[#26](https://github.com/guneet-xyz/shinan/issues/26) (NO-1 to NO-4).

This document says how Shinan connects to GitHub and Forgejo: how a git host
connection is made, including to any Forgejo instance, which webhooks Shinan
listens for, how it reads the hosts' APIs, where it
looks for task markers, how it catches up when webhooks are missed
(reconciliation), how it stays inside rate limits, and what it writes back to
the hosts and under which identity.

It does not decide what linked work means for a task (task status, link roles,
marker syntax), how actions are credited to people and agents, how people sign
in, or how connections and credentials are stored. Those belong
to the documents listed in [dependencies](#dependencies-on-other-documents).

Terms follow the [domain model and glossary](domain-model.md). Two notes on
words:

- In this document **token** always means a git host credential (a GitHub
  installation token or a Forgejo access token). It never means the agent
  tokens the glossary defines.
- A **backlink** is a single comment that Shinan posts on a GitHub PR to link
  to a task. It is a git host comment, not a
  [comment](domain-model.md#comment-and-progress-update) on a task in Shinan.
  **Proposed** term; reason: "comment" alone means a message on a task.

Each statement is marked:

- **Decided**: follows from an accepted plan decision (D-nnn, in the
  [plan](plan.md#6-decisions-so-far)) or from the owner's answers in
  [issue #25][o] (written "owner, O-n" or "owner, N-n") or in [#26](https://github.com/guneet-xyz/shinan/issues/26)
  (written "owner, NO-n"). The [decision log](decisions/README.md) records
  them as D-021 onwards.
- **Proposed**: suggested here, with a reason. Needs review and owner approval.
- **Open**: not settled. Listed under [open questions](#open-questions) or
  [decisions needed](#decisions-needed-from-the-owner).

External facts were checked against primary sources on **2026-11-16**; see
[sources](#sources). Host products change, so these facts carry that date.

## Contents

1. [Principles](#1-principles)
2. [Git hosts, connections and repositories](#2-git-hosts-connections-and-repositories)
3. [Connecting to GitHub](#3-connecting-to-github)
4. [Connecting to Forgejo](#4-connecting-to-forgejo)
5. [Events Shinan listens for](#5-events-shinan-listens-for)
6. [Detecting task markers](#6-detecting-task-markers)
7. [Reconciliation](#7-reconciliation)
8. [Rate limits and load](#8-rate-limits-and-load)
9. [What Shinan writes back](#9-what-shinan-writes-back)
10. [Security notes](#10-security-notes)
11. [Later hosts](#11-later-hosts)

## 1. Principles

1. **The git host owns the work.** Branches, PRs, reviews, CI checks, merges
   and repository issues stay on the git host. Shinan reads them, links them to
   tasks and links back to the original instead of copying it. **Decided**
   (D-001: neither host can manage the other, and copies create two sources of
   truth).
2. **GitHub and Forgejo first.** **Decided** (D-009). Everything host-specific
   sits behind one connector per host type, so GitLab can be added later
   without changing tasks or events. **Proposed**; reason: the plan names GitLab
   as a later host.
3. **Webhooks first, reconciliation as the safety net.** Webhooks make the
   timeline feel live; periodic re-reading catches what webhooks miss.
   **Decided** that both exist (plan, Integration points). The method is
   [section 7](#7-reconciliation) (**proposed**).
4. **Shinan never acts on a git host for a person, and writes only on
   GitHub.** Shinan stores no GitHub token of any person; on Forgejo it holds
   only each connection's read token, from the connecting member (O-53). On
   GitHub it writes
   only as its app, with the installation token. On Forgejo it makes no writes
   at all: Forgejo connections are read-only. Anything a person wants done on a
   git host (opening an issue, commenting, closing) is done by an agent running
   on that person's own hardware, already signed in to the git host; the
   request reaches the person's own agent sessions as a queued nudge and waits
   if none is running. **Decided** (owner, O-1, N-4 and N-3, [#25][o]).
5. **The connector supplies evidence; it does not decide who acted.** For each
   git host event the connector records the git host account that the host
   reports, any markers found and where the event came from (webhook or
   reconciliation). [Identity, agents and permissions](identity.md) decides the
   actor and the attribution confidence from that evidence, and owns plan
   question 2 (how reliable attribution can be). **Proposed**; reason: D-017
   says the git host account cannot tell a person from their agents, so the
   connector must not pretend it can.
6. **Least privilege, where the owner has not chosen otherwise.** Shinan asks
   for read access, plus write access on GitHub only for backlinks, and it
   stores nothing from repositories a connection
   does not cover. **Proposed**; reason: Shinan is on the public internet
   (D-015), so a leaked credential or database should do as little harm as
   possible. The owner accepted a broader Forgejo token where people choose
   one (owner, O-54, [#25][o]); the risk is stated in
   [section 4](#the-connection-token).

## 2. Git hosts, connections and repositories

### Git host

A git host is identified by its address, such as `github.com` or
`git.guneet.dev`; its host type is GitHub or Forgejo. **Proposed** in the
[domain model](domain-model.md#git-host). This document keeps that rule because
two Forgejo servers have separate accounts, tokens and webhooks.

### Git host connection

A git host connection is one workspace's authorised link to one git host. It
holds (**proposed**, extending the domain model's attributes):

| Attribute | Purpose |
|---|---|
| Git host and host type | Which connector handles it. |
| Method and account | GitHub App installation; or, on Forgejo, the connecting member's account and token (section 4). |
| Covered repositories | The repositories Shinan reads through this connection, by the host's stable repository ID. |
| Backlink setting | GitHub only: whether backlinks are on, per repository ([section 9](#9-what-shinan-writes-back)). Forgejo connections have none. |
| Counting branches | Per repository, the branches whose merges count as "merged" for [Tasks and work](tasks.md#62-markers); the default branch unless set. |
| Automated accounts | Per repository, git host accounts such as dependency update tools whose issues and PRs skip triage or are ignored. Tasks and work defines what the setting does ([Tasks §5.1](tasks.md#51-which-issues-become-tasks)); it lives here because it names git host accounts per repository. |
| Turn new issues into tasks | Per repository, on by default; turned off for shared repositories where most issues are unrelated (for the trial: `infra/musashi`, `infra/anzen`, `guneet/terraform` and the `workspace` repository, [Roadmap §4.4](roadmap.md#44-tasks-during-the-trial)). **Decided** (owner, NO-2, [#26](https://github.com/guneet-xyz/shinan/issues/26); [D-051](decisions/D-051-new-issues-setting.md), amending D-003). This document holds the setting; [Tasks and work](tasks.md#51-which-issues-become-tasks) defines what it does. Markers and members' mentions in such repositories are still read. |
| Set up by | The member who made the connection, and whose credential it depends on (Forgejo). |
| Webhook state | Last delivery received, signature failures, failed deliveries seen. |
| Reconciliation state | Per repository: last successful run of each layer, the watermark, last error. |
| Health | `working`, `degraded` or `failing`, defined below. |

**Health** (**proposed**):

| State | Detected when |
|---|---|
| `working` | Webhooks arrive and reconciliation finds nothing they missed. |
| `degraded` | GitHub: the deliveries API shows failed deliveries since the last sweep, or signatures fail. Forgejo: reconciliation finds changes newer than the last delivery that no webhook reported, or no delivery has arrived for 24 hours while reconciliation sees changes. Reading still works. |
| `failing` | Shinan cannot read the host: the token is rejected or revoked, the app is uninstalled or suspended, or every covered repository returns an error. |

A Forgejo connection depends on one member's account (O-53). When that member
leaves the workspace or revokes the token, the connection becomes `failing`,
and its page names the member and says that someone must reconnect.
**Proposed**; reason: a silent stop would leave task status quietly stale.

Only workspace owners add Forgejo connections
([Identity §9.3](identity.md#93-git-host-connections)), and the connection
reads with that owner's own account. So a Forgejo repository that only a
contributor can read cannot be connected. This is a known limitation, accepted
for the first version, where the owner is the only member.

Who may create or remove a connection
([Identity §9.3](identity.md#93-git-host-connections)), and how its
credentials are stored, is owned by [Identity, agents and permissions](identity.md) and
[Architecture and operations](architecture.md). Credentials are stored
encrypted (owner, O-54, [#25][o]).

A workspace may have several connections to the same git host, for example one
per GitHub account that has installed the app. **Proposed**; reason: a GitHub
App is installed per account (see [section 3](#3-connecting-to-github)).

### Repository

Shinan keeps a small record per covered repository: git host, the host's stable
numeric repository ID, owner and name, URL, visibility (public or private) and
default branch. **Proposed**. Reasons:

- The stable ID survives renames and transfers. Shinan follows the host's
  `repository` events and updates owner and name instead of treating a rename
  as a new repository.
- On GitHub, visibility decides where backlinks may be posted: never in
  public repositories (owner, O-56, [#25][o]).

Visibility does **not** decide what members see in Shinan. Every workspace
member sees everything in the workspace, including titles and one-line
summaries of work in private repositories; the links themselves stay protected
by the git host's own access control. **Decided** (owner, O-43, [#25][o]).

Shinan does not copy repository content, issue text or PR descriptions beyond
what it needs to find markers and show a one-line summary with a link.
**Proposed**; reason: D-001 and the plan's "copy no facts another system owns".

Linking a repository to a `project` catalog entity is the [Catalog](catalog.md)
document's concern.

### One workspace per repository, at first

In the first version, a repository can be covered by the git host connections
of only one workspace in a Shinan installation; a second workspace asking for
it is refused with a clear message. **Decided** (owner, O-59, [#25][o]). The
data keeps repositories and work items outside workspaces, as the domain model
describes, so this can be relaxed later. Reasons: two workspaces on one
repository would each run reconciliation and, on GitHub, post backlinks, doubling noise and
API use, and access rules for a work item seen from two workspaces are not
designed.

## 3. Connecting to GitHub

### Options compared

Facts checked 2026-11-16 against GitHub's documentation (see [sources](#sources)).

| | GitHub App (installation token) | GitHub App (user access token) | OAuth app | Fine-grained personal access token | Classic personal access token |
|---|---|---|---|---|---|
| Acts as | The app itself | A person, shown with the app's badge | A person, with no sign of the app | A person | A person |
| Repository choice | The installer picks all or selected repositories | Repositories both the person and the installation can reach | Every repository the person can reach | Selected repositories of one user or organization | Broad scopes |
| Permissions | Fine-grained, per area, read or write | Same, limited further by the person's own rights | Broad scopes (for example `repo` gives full repository write) | Fine-grained | Broad scopes |
| Webhooks | One built-in webhook for every repository in the installation | (same app) | Must be created on each repository or organization | Must be created on each repository | Must be created on each repository |
| Token life | 1 hour, minted from the app's private key | 8 hours, refresh token 6 months (when expiry is on, the default) | Until revoked | Set by the person; can be unlimited | Set by the person |
| Rate limit (REST, not Enterprise Cloud) | Own budget: 5,000 per hour, plus 50 per repository above 20, up to 12,500 | Shares the person's 5,000 per hour | Shares the person's 5,000 per hour | Shares the person's 5,000 per hour | Shares the person's 5,000 per hour |
| Can create check runs | Yes (the check runs API is only available to GitHub Apps) | Not checked | No | No | No |
| Survives the person leaving | Yes, when installed on an organization | No | No | No | No |

Two facts decided the choice:

- **Personal accounts have no account-wide webhook.** Without an app, Shinan
  would need a webhook on every repository. A GitHub App gets events for every
  repository in its installation.
- **A person's rate limit is shared.** Personal tokens, OAuth apps and app user
  tokens all draw from the same 5,000 requests per hour as the person's own
  tools, and under D-017 the person's agents use that same account.

### One GitHub App, installation token only

Shinan connects to GitHub through a GitHub App and uses only its
**installation token**, for reading, webhooks and every write-back. **Decided**
(owner, O-51 and O-1, [#25][o]). Reasons: own rate-limit budget, one webhook
for all repositories, short-lived tokens, fine-grained permissions, and writes
that show as the app, never as a person.

There are no "writes a person asks for" on GitHub: Shinan does not create
issues or comments for people. A person who wants an issue for a task asks an
agent, which opens it with its own tools on the person's hardware (O-1). The
agent links it to the task as usual ([Tasks §6.6](tasks.md#66-repository-issues-for-people)).

**Sign-in with GitHub**, one of the two ways to sign in to Shinan (owner, N-7,
[#25][o]), can use the same app's
user authorisation: GitHub lets a person authorise an app without the app being
installed on their account. Shinan uses the resulting user token only to read
who the person is, then discards it and keeps no refresh token, so it never
holds a per-person GitHub token (O-1). **Proposed**; how sign-in works as a
whole belongs to [Identity, agents and permissions](identity.md). Whether
people other than the owning account can authorise a **private** app was not
checked; if they cannot, sign-in for other people needs a public app or a
separate sign-in-only app. **Open**.

**Permissions requested** (**proposed**; read unless stated):

| Permission | Why |
|---|---|
| Metadata | Required by GitHub for every app; repository list and `repository` events. |
| Contents | `push`, `create`, `delete` and `release` events; commit messages for markers. Read only: Shinan never pushes code. |
| Pull requests: read and write | PR events and reviews; write only to post or edit backlinks. |
| Issues | Issue and comment events. Read only: no first-version write-back touches issues ([section 9](#9-what-shinan-writes-back)). |
| Checks | CI check results (`check_suite`, `check_run`). |
| Commit statuses | CI results reported as commit statuses (`status`). |

Not requested: Administration. So Shinan does not set up GitHub custom
autolinks for task IDs. Configuring autolinks needs repository administration
permission (checked 2026-11-16), against principle 6, and the task address
written next to the ID already works on every host. **Proposed**.

GitHub sets permissions per app, not per installation, so a workspace that
wants no write access at all can only get it from an app registered read-only.
**Open** whether to offer such a variant ([open questions](#open-questions)).

### Who owns the app

The app is **private and owned by `guneet-xyz`** for now. **Decided** (owner,
O-52, [#25][o]). GitHub only lets a private app be installed on the account
that owns it; `guneet-xyz` is a personal account (checked 2026-11-16). If
repositories in GitHub organizations need covering later, the app must become
public or be registered by that organization, and a public app must refuse
installations no workspace member started. **Open**.

### Self-hosted Shinan installations

Each Shinan installation registers its own GitHub App. GitHub's app manifest
flow lets a Shinan installation pre-fill the name, permissions, events and
webhook address, so the operator only follows a link and names the app; GitHub
returns the app ID, private key and webhook secret. **Proposed**; reason: the
app's webhook address and private key belong to one installation (D-012:
self-hostable), and a shared app would send every self-hoster's events to us.

## 4. Connecting to Forgejo

### The owner's Forgejo, as observed

Facts about `https://git.guneet.dev`, checked 2026-11-16 unless stated:

- Version **16.0.5** (`/api/v1/version`). Forgejo's own documentation site
  labels the v16 docs "no longer supported" (current: v17.0.1; LTS: v15).
  Upgrading is an operational matter for the owner, not for Shinan; it is
  noted here because API details below are read from v16.
- API pages hold at most **50** items (`/api/v1/settings/api`).
- The v16.0.5 API has endpoints for issues, PRs, PR reviews, commits, commit
  statuses, issue timelines and repository, user, organization and system
  webhooks. It has **no Project-board endpoints** (also recorded in the
  `workspace` repository's Forgejo setup notes, 2026-11-06). Shinan does not
  need them: task status is calculated by Shinan (D-005), and Shinan does not
  mirror it into boards (**proposed**; reason: a mirrored board is copied
  status that goes stale).
- Access tokens can be listed, created and deleted through the API, but not
  edited, and have no expiry field.
- The `guneet` account is the owner and a **site administrator**, and agents on
  Daedalus use it (the `workspace` repository's Forgejo service entry, checked
  there 2026-11-08).

### Forgejo credentials compared

Facts checked 2026-11-16 against Forgejo's documentation and the v16.0.5
source and API schema (see [sources](#sources)).

| | Scoped access token, "All" repositories | Scoped access token, "Specific repositories" | OAuth2 token |
|---|---|---|---|
| Scope | Chosen read/write scopes, plus all the owner's admin powers. From a site admin this includes `write:repository` on every repository and acting as any user with `?sudo=` | Only repository and issue scopes, only the chosen repositories; admin powers removed | **No scopes: full rights of the user**, including admin for a site admin |
| Life | No expiry | No expiry; cannot be edited through the API, so adding a repository means a new token | Access token 1 hour, refresh 730 hours (defaults) |
| Can create webhooks | With the matching scope and admin rights on the owner (not tested) | No: user and organization webhooks need scopes it cannot have, and repository webhooks are an admin operation it is barred from | Yes |

Forgejo has no equivalent of a GitHub App: there is no installation with its
own identity and its own webhook. Everything acts as some user.

### The connection's account

Forgejo connections are **read-only**: Shinan posts no backlinks and makes no
other writes on Forgejo. **Decided** (owner, N-4, [#25][o]). Shinan reads
through the **connecting member's own Forgejo account**; no separate Shinan
account is created. **Decided** (owner, O-53, now about reading only, N-4).
Consequences:

- Nothing Shinan does appears on Forgejo, so every Forgejo comment is someone
  else's, and there is no own-write detection on Forgejo.
- The token needs only read scopes: `read:repository` and `read:issue`.
- The connection depends on that member ([section 2](#git-host-connection)).

### The connection token

Shinan **accepts any Forgejo access token** the member chooses, and stores it
encrypted. It does not require a "Specific repositories" token and does not
refuse broad ones. **Decided** (owner, O-54, [#25][o]).

**Residual risk.** A broad token from a site administrator, such as the
owner's on `git.guneet.dev`, can act as **any user** on that server (`?sudo=`)
and write to every repository, even though Shinan itself only reads. Anyone
who obtains it from Shinan, for example
through a database leak or a compromise of the Shinan server, holds that power
until the token is deleted on Forgejo, because v16 tokens never expire. A
read-only "Specific repositories" token (`read:repository` and `read:issue`)
limits the damage to reading the chosen repositories, at the cost of a new
token whenever a repository is added.

**Proposed**, within that decision:

- The connection page **recommends** a read-only "Specific repositories" token and
  shows, after a test call, what the stored token can reach: whether admin
  routes (`GET /api/v1/admin/users`) and user routes (`GET /api/v1/user`)
  accept it. A broad token is accepted with a visible warning, not refused.
  Reason: the owner chose to allow any token; showing the breadth keeps the
  risk visible.
- Shinan shows the token's age and asks for a new token when the member who
  created it leaves. **Proposed**; the policy belongs to Identity.
- OAuth2 tokens are not used for connections. Reason: they cannot be limited
  at all, and expire within an hour, so Shinan would have to store a refresh
  token that grants full rights.
- Authorized Integrations (Forgejo trusting short-lived tokens that Shinan
  signs) would avoid storing a long-lived token. **Open**, for a later version.

### Webhooks

Owner-level webhooks for the owner's own accounts; per-repository webhooks
elsewhere. **Decided** (owner, O-55, [#25][o]).

- An **owner-level webhook**, set on a Forgejo user or organization, fires for
  **every** repository that owner holds, including private ones the
  connection does not cover (v16.0.5 source). Shinan drops those deliveries
  before storing anything ([section 5](#handling-a-delivery)), but their
  content still travels to Shinan.
- A **per-repository webhook** sends only that repository's events, at the
  cost of one manual step per repository.
- Either way, the member adds the webhook in Forgejo's settings, using the
  address and secret Shinan shows (a "Specific repositories" token cannot
  create webhooks). Type "Forgejo", content type JSON, with a secret; Forgejo
  signs the body with HMAC-SHA256 in `X-Forgejo-Signature`. **Proposed**.
- **Network:** Forgejo only delivers to public addresses unless its
  `ALLOWED_HOST_LIST` setting says otherwise. `shinan.guneet.dev` is planned on
  Musashi, the same machine as Forgejo (D-016). Whether delivery from Forgejo
  to Shinan on the same machine works through the public address is **open**
  and must be tested at deployment.

### Connecting any Forgejo instance

There is no Forgejo sign-in to Shinan; people sign in with an email magic link
or GitHub. Forgejo is used only to connect accounts and repositories, and
anyone can enter any Forgejo address to connect. **Decided** (owner, N-7,
[#25][o]). For a connection, Shinan needs from each instance only:

| Need | Detail |
|---|---|
| The instance's address | Entered by the member; Shinan checks `/api/v1/version` to confirm it is Forgejo and which version, since API details differ between versions. |
| A token | From the member's account on that instance ([the connection token](#the-connection-token)). No OAuth2 application has to be registered on the instance. |
| A webhook | Added by the member ([webhooks](#webhooks)). |
| Network reach both ways | Shinan's server must reach the instance's API, and the instance must be allowed to deliver to Shinan (its `ALLOWED_HOST_LIST`). |

**Proposed** unless marked:

- **Accounts are keyed by instance and user number.** A Forgejo account, for a
  connection or for linking to a member, is identified by the instance address
  and the account's numeric ID there, as [Identity §3.5](identity.md#35-linking-git-host-accounts)
  states. A username on one instance never matches the same username on
  another. Reason: anyone can run a Forgejo instance and create any username
  on it.
- **Private addresses are refused.** Shinan refuses Forgejo addresses that
  resolve to private, loopback or link-local networks by default; an
  installation operator may allow specific hosts. **Decided** (owner, N-12,
  [#25][o]; D-048). The rule is stated in
  [Identity §3.5](identity.md#35-linking-git-host-accounts), and the mechanism
  (checking redirects and DNS again on every request, operator exceptions as
  an installation setting) in [Architecture](architecture.md). It applies to
  every request a Forgejo connection makes. `git.guneet.dev` is reached by its
  public address, or allowed by the operator if Shinan reaches it internally.

## 5. Events Shinan listens for

### Event map

Each row is something Shinan records as an [event](domain-model.md#event) about
a [work item](domain-model.md#work-item), or uses to keep repositories and
connections right. **Proposed** list. Reason: these are what the plan's first
version reads ("PRs, issues, comments, checks and merges"), plus what is needed
to find markers and keep repository records correct.

On Forgejo, Shinan routes on the **`X-Forgejo-Event-Type`** header, whose
values are listed below. The `X-Forgejo-Event` header merges several of them
(for example `pull_request_sync` and `pull_request_review_request` arrive as
`pull_request`, `pull_request_comment` as `issue_comment`, and
`pull_request_review_approved` as `pull_request_approved`), so it is not
precise enough (v16.0.5 source, checked 2026-11-16).

| What happened | GitHub event: actions | Forgejo event type (v16) | Used for |
|---|---|---|---|
| PR opened, edited, closed, merged, reopened | `pull_request`: `opened`, `edited`, `closed` (with `merged`), `reopened` | `pull_request` | Work item state; markers. |
| PR draft state changed | `pull_request`: `converted_to_draft`, `ready_for_review` | `pull_request` (`edited`); a draft is a `WIP:`-style title prefix, exposed as the PR's `draft` field | Task status, owned by [Tasks and work](tasks.md#7-calculated-status). |
| New commits on a PR | `pull_request`: `synchronize` | `pull_request_sync` | Timeline; trigger a CI re-read on Forgejo. |
| Review submitted or dismissed | `pull_request_review`: `submitted`, `dismissed` | `pull_request_review_approved`, `pull_request_review_rejected`, `pull_request_review_comment` | Timeline; mentions in the review's summary text. |
| Review requested | `pull_request`: `review_requested` | `pull_request_review_request` | Timeline. |
| Issue opened, edited, closed, reopened, transferred, deleted | `issues`: those actions | `issues` | Outside issues become tasks (D-003); state of linked issues; markers. |
| Comment on an issue or PR | `issue_comment`: `created`, `edited`, `deleted` | `issue_comment`, `pull_request_comment` | Timeline (linked, not copied); [mentions](#mentions-in-comments). |
| Branch created or deleted | `create`, `delete` (`ref_type` branch) | `create`, `delete` | Markers in branch names; branches without a PR. |
| Commits pushed | `push` | `push` | Markers in commit messages; timeline. |
| CI result | `check_suite`: `completed`; `status` | `action_run_success`, `action_run_failure`, `action_run_recover` (Forgejo Actions only). v16 has **no webhook for commit statuses**, so other CI is read by polling ([section 7](#7-reconciliation)). | CI check events. |
| Repository renamed, transferred, made public or private, deleted | `repository` | `repository` | Repository records and visibility. |
| Release published | `release`: `published` | `release` | An event on the repository, not a work item, as the domain model proposes. Tags without a release are not recorded. |
| Repositories added to or removed from the connection | `installation`, `installation_repositories` (always sent to apps) | None; Shinan sees changes on the next reconciliation | Covered repositories. |

Not subscribed in the first version (**proposed**; reason: volume without a
first-version use): line comments on diffs (`pull_request_review_comment` on
GitHub; the review event already records that a review happened), labels,
assignments and milestones as separate events (they arrive inside `issues` and
`pull_request` payloads anyway), wiki, forks, packages and deployments.

GitHub's `sub_issues` and issue dependency events are not used to build task
relationships or subtasks. **Proposed**; reason: tasks and their subtasks live
in Shinan (D-001, owner O-21), and importing another tracker's structure would
make two sources of truth.

### Handling a delivery

**Proposed** for both hosts, in this order:

1. **Verify the signature before parsing.** Compute HMAC-SHA256 over the raw
   body bytes with the secret, compare it with `X-Hub-Signature-256` (GitHub)
   or `X-Forgejo-Signature` (Forgejo) in constant time, and reject on mismatch.
   Count failures for [health](#git-host-connection). Reason: the endpoint is
   public (D-015).
2. **Filter by repository.** Read only the repository ID, then drop deliveries
   for repositories the connection does not cover, keeping only a count. No
   health warning for these when the webhook is owner-level, where they are
   expected. Reason: principle 6; nothing from uncovered repositories is
   stored.
3. **Store** the delivery and answer `2xx` at once; process it afterwards.
   Reason: GitHub fails a delivery after 10 seconds and Forgejo after 5 seconds
   by default, and neither retries on its own. Stored deliveries belong to the
   connection's workspace, and only its workspace owners can purge them
   (owner, O-50, [#25][o]); how long they are kept is for
   [Architecture and operations](architecture.md).
4. **Check the event type and action** and ignore unknown ones. GitHub adds
   new actions over time.
5. **Deduplicate** (see [below](#event-identity)), so a redelivery, a replay or
   a reconciliation read of the same change does not create a second event.
6. **Recognise Shinan's own writes** ([section 9](#recognising-its-own-writes))
   and record them on the timeline without treating them as triggers. Reason:
   avoids loops.
7. **Do not trust the sender blindly.** GitHub sometimes sends a placeholder
   `ghost` user as the sender. The sender is evidence for
   [attribution](domain-model.md#attribution), not proof.

### Event identity

Every git host event gets a key so that the same change seen twice, from a
webhook, a redelivery or reconciliation, is recorded once. **Proposed**:

- **Things with their own host ID:** git host, repository ID, item (issue or
  PR number, or branch), event kind, and the host's ID for the thing itself:
  comment ID, review ID, timeline event ID, commit SHA, check suite ID or
  commit status ID.
- **State changes without their own ID** (opened, closed, merged, draft
  toggled): item, the new state, and the host's time for the change. Where
  reconciliation reads a timeline entry for the same change, the timeline
  event ID is stored too, so the two match.
- **Delivery IDs** are only a fast first filter. GitHub keeps the same
  `X-GitHub-Delivery` on redelivery; Forgejo gives a replayed delivery a **new**
  `X-Forgejo-Delivery` (v16.0.5 `CreateHookTask` makes a fresh ID), so on
  Forgejo only the keys above catch replays.

Reason: keying by item and time alone would merge different changes made in
the same second, and would miss matches where a timeline gives a different
time than the webhook.

## 6. Detecting task markers

A [marker](domain-model.md#supporting-terms) is text on the git host that names
a task ID and, where possible, the agent session.
[Tasks and work §6](tasks.md#6-linking-work) defines the task part: the syntax
for branch names, PR descriptions and commit trailers, which place gives which
link role, how subtasks are linked (owner, O-21), branches naming several IDs,
and unknown IDs. [Agent integrations](agent-integrations.md) defines the agent
session part. This document does not restate those rules. It says where the
text comes from, when it is read again, and the connector's own rules.

### Where Shinan looks

| Text | Read from (webhook) | Read again by |
|---|---|---|
| Branch names | `create`, `push`; the head branch of each PR | Reconciliation layer 3 (branches) |
| PR titles and descriptions | `pull_request` (`opened`, `edited`) | Layer 2 |
| Issue bodies | `issues` (`opened`, `edited`) | Layer 2 |
| Comments on issues and PRs, and review summaries | `issue_comment`, `pull_request_comment`, `pull_request_review` (`created`, `edited`, `deleted`, `submitted`) | Layer 2, and layer 4 for reviews on linked PRs |
| Host closing references (`Closes #42` and each host's other keywords) in PR descriptions | `pull_request` (`opened`, `edited`) | Layer 2 |
| Commit messages | `push` | Layer 3 (default-branch commits); PR commit lists for agent session markers |

Tasks and work counts commit trailers only on commits that reach a counting
branch by a direct push, not on commits that belong to a PR, including ones a
squash or rebase merge copies onto the default branch. The connector tells the
two apart by asking the host which PRs contain the commit: GitHub's
`commits/{sha}/pulls` and Forgejo's `commits/{sha}/pull` (both in the APIs
checked 2026-11-16). A merge commit created by the host for a PR is also
recognised from the PR's `merge_commit_sha`. **Proposed**; reason: the push
payload alone does not say whether a commit came from a PR.

Every change to that text (an edit, a deleted comment, a renamed or deleted
branch) is passed to Tasks and work's rules again, so those rules always see
the current text on the host, including deciding when a finished PR's links
stop following edits. **Proposed**; reason: a marker-made link is removed when
the marker is edited out of active work, which only works if edits are re-read.

### Mentions in comments

A task ID mentioned in a git host comment by a **workspace member** creates a
`related` link inside Shinan, shown on the task page and never affecting task
status. Mentions by outside accounts are ignored. **Decided** (owner, O-25,
[#25][o]). The ID's written form is Tasks and work's. Detection is
**proposed** as follows:

- **Which text counts as a comment:** conversation comments on issues and PRs,
  and the summary text of a PR review. Line comments on diffs are not read in
  the first version ([section 5](#event-map)). Issue bodies and PR
  descriptions are markers, not comments, and follow Tasks and work.
- **Who counts as a member:** the comment's author, as the host reports it, is
  a git host account linked to a member of the workspace that owns the
  connection, and the link has been verified ([Identity](identity.md)).
  Because agents use their member's account (D-017), mentions written by a
  member's agents count too; that is intended. Accounts listed as automated
  accounts never count.
- **Shinan's own backlinks never count.** They exist only on GitHub, written
  by the app's own account, which is never a member's account.
- **One link per task and work item.** A mention in any comment on an issue or
  PR links that issue or PR (the work item) to the task as `related`; several
  mentions of the same task on one item make one link. Each link records the
  comment IDs that support it.
- **Edits and deletions.** When a comment is edited to drop the mention or is
  deleted, its comment ID is removed from the link; the link goes when no
  supporting comment is left. Removal is an event. Reason: the link should
  match what members can see on the host.
- **Unknown IDs** in comments are ignored, not recorded as unresolved. Reason:
  comments are conversation; a stray ID is not a broken marker.
- **Linked accounts change:** if an author's account is linked to a member
  later, existing comments are not re-read; only new and edited comments
  count. Reason: avoids rescanning history.

### Connector rules

All **proposed** unless marked:

1. **A marker names its workspace.** Each workspace has its own task ID
   prefix (owner, O-6, [#25][o]), and a repository belongs to one workspace
   (O-59), so a marker is resolved only within the workspace that owns the
   connection.
2. **Markers from outside actors do not count yet.** A marker from a git host
   account that is not linked to a member makes a link that does not change
   task status until a member confirms it. **Decided** (owner, O-24,
   [#25][o]). The connector marks every marker with whether its author is a
   linked member account; [Tasks §6.4](tasks.md#64-unconfirmed-links) handles
   confirmation.
3. **Large pushes.** GitHub's `push` payload lists up to 2,048 commits;
   Forgejo's lists only the 15 most recent by default (`PAYLOAD_COMMIT_LIMIT`).
   When a push holds more, Shinan reads the rest through the commits API.

**Reverts without a marker.** A revert PR that carries no task ID is not linked
by any of the above. Detecting reverts from the host's "Revert" title or
commit message pattern is possible but unreliable. **Open**
([Tasks §7.3](tasks.md#73-rules) asks).

## 7. Reconciliation

### Why it is needed

Neither host retries a failed delivery automatically (checked 2026-11-16):

- **GitHub** marks a delivery failed when the receiver is down or takes over 10
  seconds. Deliveries from the last **3 days** can be redelivered, by hand or
  through the API.
- **Forgejo v16** tries once, with a 5-second timeout by default. A delivery
  can be replayed from the web interface, but the API has no endpoint to list
  or replay deliveries. Delivery history is cleaned up after 7 days by default.

Webhooks are also lost when a webhook is misconfigured, a secret is rotated
badly, or a repository is added before its webhook exists. So reconciliation
is part of the design, not an afterthought. **Decided** that it exists (plan,
Integration points); the layers below are **proposed**.

### Layers

An **active repository** is one with a work item linked to a task that is not
`done` or `cancelled`, or with an agent session attached to a task in it.
**Proposed**.

| Layer | GitHub | Forgejo | Interval (proposed) |
|---|---|---|---|
| 1. Redeliver failures | List the app's webhook deliveries since the last run and ask GitHub to redeliver failed ones, with their original delivery IDs. | Not available through the API. | 10 minutes |
| 2. Item changes since the watermark | Per repository: `issues?since=` (GitHub's issue list includes PRs) and `issues/comments?since=`. | Per repository: `issues?type=issues&since=`, `issues?type=pulls&since=` and `issues/comments?since=`. | 15 minutes for active repositories; hourly for the rest |
| 3. Repository refresh | Metadata (name, visibility) for every covered repository; branches, recent default-branch commits and releases for active repositories. | Same. | Metadata hourly; the rest 15 minutes |
| 4. Linked open work | For each open work item linked to a task that is not done: state, head commit, reviews and CI results. | Same, plus **commit statuses** for PR heads, because v16 has no status webhook. | 15 minutes, and on each PR update |
| 5. Full sweep | Repository list, all branches, open PRs and issues; compares with what Shinan holds. | Same. | Daily, and when a connection or its repositories change |
| 6. On demand | A "refresh" action on a task, work item or connection. | Same. | When asked |

Layer 3 exists because branch creation and deletion, direct pushes, releases,
renames and visibility changes do not change any issue's or PR's update time,
so layer 2 never sees them.

### Watermarks

**Proposed**:

- The watermark is the largest host `updated_at` Shinan has seen for that
  repository and list, **minus an overlap of 5 minutes**. It never uses
  Shinan's clock. Reason: host and Shinan clocks differ, and items updated at
  the same moment as the last read must not be skipped. Deduplication absorbs
  the overlap.
- The watermark moves **only when a read returned something new**. Reason: on
  GitHub a conditional request is only free (`304`) when its URL, including
  `since`, is the same as last time; a watermark that moved on every run would
  make every poll a paid request.
- After an outage longer than GitHub's 3-day redelivery window, layer 1 cannot
  help, and layers 2, 3 and 5 rebuild from the watermarks.

### Longest staleness

If a webhook is missed, the change is still recorded within (**proposed**,
from the intervals above):

| Change | GitHub | Forgejo |
|---|---|---|
| PR, issue or comment, in an active repository | 10 minutes (redelivery), else 15 minutes | 15 minutes |
| The same, in other repositories | 10 minutes, else 1 hour | 1 hour |
| CI result on a linked open PR | 10 minutes, else 15 minutes | 15 minutes (always polled for non-Actions CI) |
| Branch, direct push or release, in an active repository | 10 minutes, else 15 minutes | 15 minutes |
| The same, in other repositories | 10 minutes, else 24 hours | 24 hours |
| Rename or visibility change | 10 minutes, else 1 hour | 1 hour |

Issues, PRs, merges and reviews are therefore recorded within an hour even when
every webhook is lost, inside the trial's 24-hour event-capture requirement (R2
in [Roadmap](roadmap.md)); the 5-minute part of R2 depends on webhooks
arriving. Visibility is read hourly for every repository because it decides
where GitHub backlinks may be posted (O-56, [section 9](#backlinks)).

The intervals are starting values to tune against the
[rate limits](#8-rate-limits-and-load) during the trial. **Open** whether they
become per-connection settings.

### What reconciliation records

All **proposed**:

1. **Events are not edited** (domain model). When reconciliation finds a
   change that no webhook reported, it adds an event whose source is
   `reconciliation`.
2. **Use the host's time where the host gives it.** For linked items Shinan
   reads the issue or PR timeline (both hosts have a timeline API) to recover
   what happened and when. Where the host gives no time, the event carries the
   time Shinan observed it, marked as such.
3. **Do not invent missing steps.** If a PR was opened and merged while
   webhooks were down and its timeline does not show something, Shinan records
   only what it can see.
4. **Late webhooks.** If a delayed, redelivered or replayed webhook arrives for
   a change already recorded by reconciliation, the [event identity](#event-identity)
   matches it and it is dropped.

### Freshness

Each work item records when Shinan last read it (domain model attribute), and
each connection records its last webhook and last successful run of each layer.
[Tasks §7.5](tasks.md#75-how-fresh-the-status-is) shows when a task's status
was last confirmed once any active work item is older than a threshold.
**Proposed threshold:** 30 minutes, twice the layer 4 interval, so one missed
run does not trigger it but two do. Display belongs to
[Human experience](human-experience.md). This answers the git-host half of plan
question 4.

## 8. Rate limits and load

### GitHub

Checked 2026-11-16:

- **Installation token:** 5,000 REST requests per hour, plus 50 per repository
  above 20 repositories (and per organization user above 20), up to 12,500.
  This budget is the app's own.
- **User access tokens, personal tokens and OAuth apps:** share the person's
  5,000 per hour. Shinan does not use them (see [section 3](#3-connecting-to-github)).
- **Secondary limits:** at most 100 concurrent requests; about 900 points per
  minute per REST endpoint (a read costs 1, a write 5); and in general at most
  80 content-creating requests per minute and 500 per hour. GitHub says these
  can change without notice.
- **Conditional requests:** a request with a saved `etag` that returns
  `304 Not Modified` does not count against the primary limit.
- **Search** endpoints have stricter limits; GraphQL has a separate budget.

**Proposed** practice: subscribe to webhooks rather than poll; use conditional
requests for every repeated read, with the watermark rule above so URLs stay
stable; make requests one after another rather than in parallel; wait at least
one second between writes; on `403` or `429` obey `retry-after` or
`x-ratelimit-reset`, otherwise wait a minute and back off exponentially; never
use the search API for reconciliation. Reason: GitHub's own guidance, and
GitHub may ban integrations that keep calling while limited.

**Budget** (estimate, **proposed** as a sanity check): the `guneet-xyz` account
has at least 100 repositories (a listing on 2026-11-16 stopped at its limit of
100). Layer 2 is two list requests per repository per run. If all 100 were
covered and polled every 15 minutes, that is 800 requests per hour, most of
them `304` and free while nothing changes, against an installation budget of at
least 9,000 (5,000 + 50 × 80). The trial covers only a few repositories
(D-018), so real use will be far lower.

### Forgejo

Checked 2026-11-16 against the v16 configuration reference and the instance:

- The configuration reference lists **no API rate-limit setting**. A reverse
  proxy in front of Forgejo could still limit requests; whether Musashi's does
  is **unknown**.
- Pages hold at most 50 items on `git.guneet.dev`, so listing costs more
  requests than on GitHub.
- The instance did not return an `etag` on a public repository read, so
  conditional requests are **not** assumed to save anything.
- Musashi is a 2-vCPU, 8 GiB machine that already runs public applications,
  Forgejo and its CI runner (the `workspace` repository's Musashi entry), and
  Shinan is planned there too (D-016).

**Proposed:** because Forgejo does not protect itself, Shinan limits itself:
one request at a time per Forgejo connection, a ceiling of 1,000 requests per
hour to start with, and reconciliation spread over each interval rather than
run all at once. Reason: a burst should not slow the owner's Forgejo or the
applications sharing the machine.

**Budget** (estimate, **proposed**), for a trial with 10 covered Forgejo
repositories, 5 of them active, and 10 linked open work items, assuming each
list fits in one page:

| Layer | Requests per run | Runs per hour | Per hour |
|---|---|---|---|
| 2, active repositories | 3 × 5 | 4 | 60 |
| 2, other repositories | 3 × 5 | 1 | 15 |
| 3, metadata | 10 | 1 | 10 |
| 3, branches and commits, active | 2 × 5 | 4 | 40 |
| 4, linked work (PR and statuses) | 2 × 10 | 4 | 80 |
| 5, daily sweep (about 6 × 10, spread) | — | — | about 3 |
| **Total** | | | **about 210** |

That is about a fifth of the ceiling; each extra page of 50 items adds one
request. **When the ceiling is reached**, Shinan stretches intervals, serving
layer 4 and active repositories first, and the stretched intervals show up as
older "last read" times, so [freshness](#freshness) tells people the status is
less current rather than hiding it. **Proposed**.

## 9. What Shinan writes back

### Summary

| Write-back | First version | Status |
|---|---|---|
| One **backlink** on a GitHub PR linked to a task, edited in place as links change, only when the PR description lacks the task's address, and never in public repositories | Yes, GitHub only | **Decided** (owner, O-56 and N-4, [#25][o]) |
| Any write on Forgejo, including backlinks | Never: Forgejo connections are read-only | **Decided** (owner, N-4, [#25][o]) |
| Outcome on origin issues and issues made for people when the task finishes | No: whoever finishes the task closes or comments with their own tools, prompted by a reminder on the task | **Decided** (owner, O-57, [#25][o]) |
| Anything a person asks for on a git host: creating an issue, commenting, closing | Never by Shinan; the request reaches the person's own agent sessions as a queued nudge, and an agent on the person's hardware does it | **Decided** (owner, O-1 and N-3, [#25][o]) |
| Commit status or check run naming the task | No | **Decided** (owner, O-58, [#25][o]) |
| Backlinks or comments on outside issues | No | **Proposed** |
| Labels, assignees, milestones, closing or reopening issues, editing PR or issue text, merging, reviewing | Never | **Proposed** |
| Project boards | Never | **Proposed**; also impossible on Forgejo v16 (no API) |

Shinan's only write in the first version is therefore the backlink on GitHub,
written as the GitHub App (O-1, O-51, N-4). It needs Pull requests write; a
GitHub workspace with backlinks off would need no write access at all.

### Backlinks

- Backlinks let someone looking at a GitHub PR find the task, which is
  what the plan means by "post links back where appropriate". One comment
  edited in place avoids a stream of noise. It carries the task ID and its
  Shinan address only, not the task's title or text. **Proposed**; reason:
  link, don't copy (D-001), and titles can reveal internal details.
- **Only when the PR description lacks the task's address** (O-56). Most agent
  PRs already carry it ([Tasks §6.2](tasks.md#62-markers)), and a backlink
  would only add a write and a notification to everyone watching the PR.
- **Never in public repositories** (O-56). A task address leads to a sign-in
  page outsiders cannot open, and it reveals that a private tracker exists.
  When a repository becomes public, Shinan stops posting and editing backlinks
  there; it does not delete existing ones. **Proposed**; reason: deleting
  comments on the host is a stronger action than the owner asked for, and the
  person can remove them if needed.

### No outcome comments

Shinan does not comment on or close origin issues or issues made for people
when a task finishes. Same-repository origin issues are closed by the host's
own `Closes #42` at merge. For the rest, the task shows origin issues still
open on the host as a reminder, and whoever finishes the task closes or
comments with their own git host tools. **Decided** (owner, O-57 and O-1,
[#25][o]). If reminders turn out to be missed during the trial, the
recommendation was to move to "comment and close on `done`"; under O-1 and N-4
that would also be done by an agent, not by Shinan.

### Why the rest is never written

- **No commit statuses or check runs** (O-58). A status set by Shinan could be
  made a required check by branch protection, which would let Shinan block
  merges, and its meaning is not defined.
- **No labels, reopening, editing or merging.** These would either copy task
  status onto the host (D-005 says status is calculated, and the `workspace`
  repository already avoids status labels for the same reason) or take actions
  that belong to people and their agents (O-1).
- **No writes for people.** Shinan never acts on a git host on a person's
  behalf (O-1). Shinan's MCP tools therefore do not create branches, PRs,
  issues or comments on git hosts; agents use their own tools, and a person's
  request reaches their agents as a queued nudge (N-3). The MCP tools and
  nudge delivery are owned by [Agent integrations](agent-integrations.md).

### Recognising its own writes

Shinan writes only on GitHub, and only as its app (N-4). So a GitHub comment is
Shinan's when its author is the app's own account, which no person or agent
can use. Shinan also stores the ID of each backlink it posts, to edit it in
place later. **Proposed**; reason: the app identity is enough, so no text
marker, pending-write tracking or held-back comments are needed. Forgejo has
nothing to recognise, because Shinan writes nothing there.

## 10. Security notes

Only what is specific to git hosts; the overall design belongs to
[Architecture and operations](architecture.md) and
[Identity, agents and permissions](identity.md). All **proposed** unless
marked:

- **Webhook secrets:** one per GitHub App (GitHub has one secret per app, not
  per installation), and one per Forgejo webhook. Random, stored as secrets,
  never placed in the URL.
- **Signature checks** as in [section 5](#handling-a-delivery). GitHub also
  publishes the IP ranges it sends from, which can be used as an extra filter.
- **Credentials:** the GitHub App private key and Forgejo connection tokens
  are the most sensitive things Shinan holds for git hosts. They are stored
  encrypted (**decided**, owner, O-54, [#25][o]), never shown again after
  setup, never logged, and never given to agents. A broad Forgejo token from a
  site administrator can act as any user on that server
  ([residual risk](#the-connection-token)).
- **Sign-in tokens** from GitHub are used once to learn who the person is and
  then discarded ([section 3](#one-github-app-installation-token-only)).
- **Forgejo addresses entered by people** are checked before Shinan calls them
  ([section 4](#connecting-any-forgejo-instance)).
- **Nothing from uncovered repositories is stored**
  ([section 5](#handling-a-delivery), step 2).
- **Visibility:** each connection's page shows its granted permissions and
  covered repositories. Inside a workspace every member sees everything,
  including private-repository work (**decided**, owner, O-43, [#25][o]).

## 11. Later hosts

GitLab is named as a later host in the plan. The connector design above
(connection, webhooks with a secret, watermark-based reconciliation, markers in
branch names, merge request descriptions and commit trailers) is meant to carry
over. GitLab calls PRs "merge requests"; Shinan still calls them PRs (domain
model, "words to avoid"). No GitLab facts were checked for this document.
**Open**, for the roadmap.

## Dependencies on other documents

| Document | What this document needs from it |
|---|---|
| [Domain model and glossary](domain-model.md) | Terms used throughout; the [git host](domain-model.md#git-host) and [git host connection](domain-model.md#git-host-connection) attributes, extended in [section 2](#2-git-hosts-connections-and-repositories); the "backlink" term (a comment on a GitHub PR only); "automated account". |
| [Tasks and work](tasks.md) | Marker syntax and every rule about which text makes which link ([§6](tasks.md#6-linking-work)); the written form of task IDs in comments (O-25); unconfirmed links and who confirms them ([§6.4](tasks.md#64-unconfirmed-links)); task status from linked work; the meaning of the automated-accounts, counting-branches and "turn new issues into tasks" settings, which live on the connection here (NO-2); the reminder for open origin issues (O-57). |
| [Identity, agents and permissions](identity.md) | Linking members' GitHub and Forgejo accounts ([§3.5](identity.md#35-linking-git-host-accounts)), needed for mention links and outside-actor markers; the private-address rule (N-12); who may manage connections ([§9.3](identity.md#93-git-host-connections)); turning connector evidence into an actor and attribution confidence (plan question 2); token age and replacement policy. |
| [Agent integrations](agent-integrations.md) | Agent session marker syntax; delivering a person's git host requests to their own agent sessions as queued nudges (O-1, N-3). |
| [Human experience](human-experience.md) | How work item and connection freshness, connection health, broad-token warnings, unconfirmed links, mention links and open origin issues are shown; the connection setup screens. |
| [Architecture and operations](architecture.md) | Webhook endpoint, queueing, storage and retention of deliveries; encrypted credential storage (O-54); the mechanism for refusing private addresses (N-12); whether Forgejo on Musashi can deliver to Shinan on Musashi; any reverse-proxy rate limits; the task address used in backlinks ([§3.6](architecture.md#36-task-address)). |
| [Roadmap and migration](roadmap.md) | Which repositories the trial covers (O-70) and which have "turn new issues into tasks" off (NO-2); the event-capture requirement R2. |
| [Decision log](decisions/README.md) | Records for the owner's answers cited here (D-021 to D-053). |

## Proposed in this document

Owner decisions applied here are listed in [their table](#owner-decisions-applied).
Still proposed:

1. A connector per host type behind one model, for later GitLab support
   ([section 1](#1-principles)).
2. The connector supplies attribution evidence and does not decide the actor;
   plan question 2 stays with Identity ([principle 5](#1-principles)).
3. Connection attributes, health states and their detection, the automated
   accounts and counting branches settings, and repository records keyed by
   the host's stable ID ([section 2](#2-git-hosts-connections-and-repositories)).
4. The GitHub App's permissions (no Administration, so no autolinks), sign-in
   through the same app with the user token discarded, and per-installation
   apps for self-hosting ([section 3](#3-connecting-to-github)).
5. Forgejo: a recommended (not required) read-only "Specific repositories"
   token, a breadth check with a warning, and token age shown
   ([section 4](#the-connection-token)).
6. Connecting any Forgejo instance: a version check, and accounts keyed by
   instance and user number ([section 4](#connecting-any-forgejo-instance)).
7. The event map, routing on `X-Forgejo-Event-Type`, delivery handling with
   repository filtering before storage, and event identity keys
   ([section 5](#5-events-shinan-listens-for)).
8. Where marker text is read and re-read, telling direct pushes from PR
   commits, and how mention links are detected ([section 6](#6-detecting-task-markers)).
9. Six reconciliation layers, the watermark rule, longest staleness and a
   30-minute freshness threshold ([section 7](#7-reconciliation)).
10. Rate-limit practice for GitHub and a self-imposed ceiling for Forgejo, with
    budgets for both ([section 8](#8-rate-limits-and-load)).
11. Backlink wording and behaviour when a repository turns public; no
    comments on outside issues; own writes recognised by the app's identity
    ([section 9](#9-what-shinan-writes-back)).
12. Releases are recorded as repository events; deployments are not read from
    git hosts in the first version.
13. The term "backlink".

### Owner decisions applied

From [issue #25][o] and [#26](https://github.com/guneet-xyz/shinan/issues/26):

| Answer | Effect here |
|---|---|
| O-1, N-3 | No person's GitHub token is stored (Forgejo keeps one read token per connection); Shinan never acts for a person; person-requested host actions reach the person's own agents as queued nudges ([principle 4](#1-principles), [section 9](#9-what-shinan-writes-back)). |
| N-4 | No writes on Forgejo; Forgejo connections are read-only; on GitHub, writes only as the app ([principle 4](#1-principles), [section 4](#the-connections-account), [section 9](#9-what-shinan-writes-back)). |
| O-6 | Per-workspace task ID prefixes; markers name their workspace ([section 6](#connector-rules)). |
| O-21, N-1 | Subtasks (any depth) replace `Completes` / `Part of`; marker rules deferred to Tasks ([section 6](#6-detecting-task-markers)). |
| O-24 | Outside actors' markers make unconfirmed links ([section 6](#connector-rules)). |
| O-25 | Members' mentions in host comments make `related` links ([section 6](#mentions-in-comments)). |
| O-41, N-7 | Sign-in by email magic link or GitHub only; Forgejo only for connecting, at any address ([section 3](#one-github-app-installation-token-only), [section 4](#connecting-any-forgejo-instance)). |
| O-43 | Every member sees everything; visibility only governs GitHub backlinks ([section 2](#repository)). |
| O-50 | Only workspace owners purge stored deliveries ([section 5](#handling-a-delivery)). |
| O-51, O-52 | GitHub App, installation token only, private and owned by `guneet-xyz` ([section 3](#3-connecting-to-github)). |
| O-53 | The connecting member's Forgejo account, for reading only (N-4) ([section 4](#the-connections-account)). |
| O-54 | Any Forgejo token accepted, stored encrypted, residual risk stated ([section 4](#the-connection-token)). |
| O-55 | Owner-level webhooks for the owner's accounts, per-repository elsewhere ([section 4](#webhooks)). |
| O-56 | GitHub backlinks only when the description lacks the address, never in public repositories ([section 9](#backlinks)). |
| O-57 | No outcome comments; reminders instead ([section 9](#no-outcome-comments)). |
| O-58 | No commit statuses or check runs ([section 9](#why-the-rest-is-never-written)). |
| O-59 | One workspace per repository ([section 2](#one-workspace-per-repository-at-first)). |
| N-12 | Forgejo addresses on private, loopback or link-local networks refused by default ([section 4](#connecting-any-forgejo-instance)). |
| NO-2 | Per-repository "turn new issues into tasks" setting, on by default, held here and defined by Tasks ([section 2](#git-host-connection)). |

## Open questions

1. **Read-only GitHub App.** Should Shinan offer a second, read-only app
   registration for workspaces that want no backlinks at all, given that
   GitHub sets permissions per app?
2. **Other GitHub accounts and people.** The trial needs only `guneet-xyz`
   ([Roadmap](roadmap.md)); Walls would need the `cranklabs` organization, and
   sign-in by people other than the owner may need a public app or a separate
   sign-in-only app. Which, and when?
3. **Forgejo token list.** Can the web interface change a token's repository
   list on v16, or must a new token be made when a repository is added?
4. **Same-machine delivery.** Can Forgejo on Musashi deliver webhooks to
   `shinan.guneet.dev` on Musashi with the default `ALLOWED_HOST_LIST`?
   (Architecture and operations, at deployment time.)
5. **Reverse-proxy limits.** Does anything in front of `git.guneet.dev` limit
   API requests?
6. **GraphQL.** Should GitHub reads use GraphQL to batch PR, review and CI data
   in fewer requests? REST is assumed here because conditional requests make
   repeated REST reads free.
7. **Reverts without markers.** Can they be detected reliably enough to link?
   ([section 6](#6-detecting-task-markers))
8. **Authorized Integrations.** Should a later version let Shinan sign
   short-lived tokens for Forgejo instead of storing a token?
9. **Reconciliation intervals.** Fixed, or a per-connection setting?

## Decisions needed from the owner

None.

## Sources

All checked on **2026-11-16**.

GitHub documentation:

- [Deciding when to build a GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/deciding-when-to-build-a-github-app)
- [About creating GitHub Apps](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/about-creating-github-apps) (private apps install only on the owning account)
- [Authenticating as a GitHub App installation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation) (1-hour tokens)
- [Authenticating on behalf of a user](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-with-a-github-app-on-behalf-of-a-user) (user shown with the app's badge; an app need not be installed to be authorised)
- [Refreshing user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens) (8 hours and 6 months)
- [Registering a GitHub App from a manifest](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)
- [Permissions required for GitHub Apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps) (creating a PR comment needs Issues or Pull requests write)
- [Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [Best practices for using the REST API](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)
- [Webhook events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads) (event actions, 2,048-commit push limit, 25 MB cap, `ghost` sender)
- [Best practices for using webhooks](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks) (10-second response, delivery ID kept on redelivery)
- [Handling failed webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries) and [Redelivering webhooks](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks) (no automatic retry, 3-day window)
- [REST API endpoints for GitHub App webhooks](https://docs.github.com/en/rest/apps/webhooks), [Timeline events](https://docs.github.com/en/rest/issues/timeline), [Issue comments](https://docs.github.com/en/rest/issues/comments) (`since` on repository comments) and [Autolinks](https://docs.github.com/en/rest/repos/autolinks) (repository administration permission)
- GitHub API read of the `guneet-xyz` account type (personal account).

Forgejo documentation, source and instance:

- [Webhooks](https://forgejo.org/docs/latest/user/repository/webhooks/), [API usage](https://forgejo.org/docs/latest/user/api/usage/), [Access token scope](https://forgejo.org/docs/latest/user/authentication/token-scope/) (specific-repository tokens; site admin `sudo`), [OAuth2 provider](https://forgejo.org/docs/latest/user/authentication/oauth2-provider/) ("OAuth2 scopes are not yet implemented") and [Authorized Integrations](https://forgejo.org/docs/latest/user/api/authorized-integrations/) (v17.0.1 pages).
- [Configuration cheat sheet, v16.0](https://forgejo.org/docs/v16.0/admin/config-cheat-sheet/): `[webhook]` (`DELIVER_TIMEOUT` 5, `ALLOWED_HOST_LIST` external, `PAYLOAD_COMMIT_LIMIT` 15), `[api]`, `[oauth2]` (`ENABLED` true), `cron.cleanup_hook_task_table` (168 hours), `[authorized_integration]`; no API rate-limit setting found.
- Forgejo source at tag `v16.0.5`: [`modules/webhook/type.go`](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/modules/webhook/type.go) (event types and their `X-Forgejo-Event` names), [`services/webhook/webhook.go`](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/services/webhook/webhook.go) (owner-level webhooks apply to all of an owner's repositories), [`services/webhook/deliver.go`](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/services/webhook/deliver.go) (single delivery attempt), [`services/webhook/shared/payloader.go`](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/services/webhook/shared/payloader.go) (`X-Forgejo-Signature`, `X-Forgejo-Event-Type`), [`models/webhook/hooktask.go`](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/models/webhook/hooktask.go) (a replay gets a new delivery ID).
- `https://git.guneet.dev`: `/api/v1/version`, `/api/v1/settings/api`, `/swagger.v1.json` (including the token endpoints) and the public organization list.
- The `workspace` repository's Forgejo setup notes and Forgejo and Musashi catalog entries (read-only background; their own check dates are cited where used).

[o]: https://github.com/guneet-xyz/shinan/issues/25
