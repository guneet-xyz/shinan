# Git host integrations

Status: **draft for review** ([issue #8](https://github.com/guneet-xyz/shinan/issues/8)).

This document says how Shinan connects to GitHub and Forgejo: how a git host
connection is made, which webhooks Shinan listens for, how it reads the hosts'
APIs, how it finds task markers, how it catches up when webhooks are missed
(reconciliation), how it stays inside rate limits, and what it writes back to
the hosts and under which identity.

It does not decide what linked work means for a task (task status, link roles,
marker syntax), how actions are credited to people and agents, or how
connections and credentials are stored. Those belong to the documents listed in
[dependencies](#dependencies-on-other-documents).

Terms follow the [domain model and glossary](domain-model.md) (in review in
[PR #14](https://github.com/guneet-xyz/shinan/pull/14)). Two notes on words:

- In this document **token** always means a git host credential (a GitHub
  installation token, user access token or personal access token, or a Forgejo
  access token). It never means the agent tokens the glossary defines.
- A **backlink** is a single comment that Shinan posts on a git host issue or
  PR to link to a task. It is a git host comment, not a
  [comment](domain-model.md#comment-and-progress-update) on a task in Shinan.
  **Proposed** term; reason: "comment" alone means a message on a task.

Each statement is marked:

- **Decided**: follows from an accepted decision in the
  [plan](plan.md#6-decisions-so-far), which is cited.
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
4. **Shinan's own identity is not an agent's identity.** Agents use the git
   host account of the person they work for (D-017). That rule is about agents.
   When Shinan itself writes to a git host (for example a backlink), it
   should do so in a way that cannot be mistaken for the person or their agents
   wherever the host allows it. **Proposed**; reason: Shinan has to recognise
   its own writes to avoid loops, and people reading the PR should know the
   comment came from Shinan. See [section 9](#9-what-shinan-writes-back).
5. **The connector supplies evidence; it does not decide who acted.** For each
   git host event the connector records the git host account that the host
   reports, any markers found and where the event came from (webhook or
   reconciliation). Identity, agents and permissions decides the actor and the
   attribution confidence from that evidence. **Proposed**; reason: D-017 says
   the git host account cannot tell a person from their agents, so the
   connector must not pretend it can.
6. **Least privilege.** Shinan asks for read access by default, and for write
   access only for the write-backs a workspace turns on. **Proposed**; reason:
   a workspace holds infrastructure details and Shinan is on the public
   internet (D-015), so a leaked Shinan credential must do as little harm as
   possible.

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
| Method | GitHub App installation, or Forgejo access token (see sections 3 and 4). |
| Covered repositories | The repositories Shinan can read through this connection. |
| Write-back settings | Which write-backs are on, per repository ([section 9](#9-what-shinan-writes-back)). |
| Set up by | The member who made the connection. |
| Webhook state | Last delivery received, last signature failure, failed deliveries seen. |
| Reconciliation state | Last successful run per repository, the "updated since" watermark, last error. |
| Health | `working`, `degraded` (webhooks failing but reconciliation working) or `failing` (cannot read the host). |

Who may create or remove a connection, and how its credentials are stored, is
owned by [Identity, agents and permissions](identity.md) and
[Architecture and operations](architecture.md).

A workspace may have several connections to the same git host, for example one
per GitHub account that has installed the app. **Proposed**; reason: a GitHub
App is installed per account (see [section 3](#3-connecting-to-github)), and a
Forgejo token belongs to one user.

### Repository

Shinan keeps a small record per covered repository: git host, the host's stable
numeric repository ID, owner and name, URL, visibility (public or private) and
default branch. **Proposed**. Reasons:

- The stable ID survives renames and transfers. Shinan follows the host's
  `repository` events and updates owner and name instead of treating a rename
  as a new repository.
- Visibility drives the write-back defaults in [section 9](#9-what-shinan-writes-back)
  and is an input to the access rules for private repositories that
  [Identity, agents and permissions](identity.md) owns (plan question 3).

Shinan does not copy repository content, issue text or PR descriptions beyond
what it needs to find markers and show a one-line summary with a link.
**Proposed**; reason: D-001 and the plan's "copy no facts another system owns".

Linking a repository to a `project` catalog entity is the [Catalog](catalog.md)
document's concern.

### One workspace per repository, at first

The domain model treats git hosts, repositories and work items as existing
outside any one workspace, and leaves open whether one repository can be
connected to more than one workspace. **Proposed:** in the first version, a
repository can be covered by the git host connections of only one workspace in
a Shinan installation; a second workspace asking for it is refused with a
clear message. The data keeps repositories and work items outside workspaces,
so this can be relaxed later. Reasons:

- Two workspaces on one repository would each post their own backlink and run
  their own reconciliation, doubling noise and API use.
- It avoids ambiguous markers whatever task ID format is chosen.
- Access rules for a work item seen from two workspaces are not designed yet
  (plan question 3).

This is an [owner decision](#decisions-needed-from-the-owner), because it
limits a case that agencies (the plan's "later" users) may need.

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

Two facts matter most for Shinan:

- **Personal accounts have no account-wide webhook.** Without an app, Shinan
  would need a webhook on every repository, and someone with admin rights would
  have to create each one. A GitHub App gets events for every repository in its
  installation.
- **A person's rate limit is shared.** Personal tokens, OAuth apps and app user
  tokens all draw from the same 5,000 requests per hour as the person's own
  tools. Under D-017 the person's agents use that same account (for example
  through the `gh` command-line tool), so Shinan reading with a person's token
  would compete with their agents.

### Proposal: one GitHub App

**Proposed:** Shinan connects to GitHub through a GitHub App.

- **Installation token** for all reading, webhooks and automatic write-backs.
  Reason: own rate-limit budget, one webhook for all repositories, short-lived
  tokens, fine-grained read-only permissions, and writes that show as the app,
  not as the person (principle 4).
- **User access token** only when a person asks Shinan to do something on the
  git host in their name, such as creating an issue for a task (D-004). The
  host then shows the person with the app's badge. Reason: the action is
  credited to the person who asked, and it is still visibly different from
  their agents' actions, which come from the agents' own tools. Whether the
  same app also provides "sign in with GitHub" is for
  [Identity, agents and permissions](identity.md).
- OAuth apps and personal tokens are **not** offered for GitHub in the first
  version. Reason: per-repository webhooks, shared rate limits and broad or
  long-lived credentials, with nothing gained in return.

**Permissions requested** (**proposed**; read unless stated):

| Permission | Why |
|---|---|
| Metadata | Required by GitHub for every app; repository list and `repository` events. |
| Contents | `push`, `create`, `delete` and `release` events; commit messages for markers. Read only: Shinan never pushes code. |
| Pull requests: read and write | PR events and reviews; write only to post or edit backlinks. |
| Issues: read and write | Issue and comment events; write to post or edit backlinks and to create issues a person asks for (D-004). |
| Checks | CI check results (`check_suite`, `check_run`). |
| Commit statuses | CI results reported as commit statuses (`status`). |

Write access is only used when a workspace turns the matching write-back on
([section 9](#9-what-shinan-writes-back)). GitHub permissions are set per app,
not per installation, so a workspace that wants read-only access can only get
it from an app registered read-only. **Open** whether to register a read-only
variant (see [open questions](#open-questions)).

### Who owns the app, and which accounts it can be installed on

GitHub only lets a **private** app be installed on the account that owns it; a
**public** app can be installed by other accounts. On 2026-11-16 the owner's
GitHub account `guneet-xyz` is a personal account, and the Shinan repository
lives under it.

- **Proposed** for `shinan.guneet.dev`: a private app owned by `guneet-xyz`.
  Reason: it covers the repositories the trial will use, and nobody else can
  install it.
- If repositories in GitHub organizations need to be covered later, the app
  must either be public or be registered by that organization. A public app
  must refuse installations that no workspace member started. **Open**; see
  [decisions needed](#decisions-needed-from-the-owner).

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
- API pages hold at most **50** items (`/api/v1/settings/api`:
  `max_response_items` 50, default 30).
- The v16.0.5 API has endpoints for issues, PRs, PR reviews, commits, commit
  statuses, issue timelines and repository, user, organization and system
  webhooks. It has **no Project-board endpoints** (also recorded in the
  `workspace` repository's Forgejo setup notes, 2026-11-06). Shinan therefore
  cannot read or move Forgejo Project cards. It does not need to: task status
  is calculated by Shinan (D-005), and Shinan does not mirror it into boards
  (**proposed**; reason: a mirrored board is copied status that goes stale).
- The `guneet` account is the owner and a **site administrator**, and agents on
  Daedalus use it (the `workspace` repository's Forgejo service entry, checked
  there 2026-11-08). A separate `daedalus-agent` account existed and was
  disabled on 2026-11-08 for consistency with GitHub.
- The organization list visible without signing in was empty, so it is not
  known from here which organizations hold the repositories Shinan will cover.

### Options compared

Facts checked 2026-11-16 against Forgejo's documentation and the v16.0.5
source and API schema (see [sources](#sources)).

| | Scoped access token, "All" repositories | Scoped access token, "Specific repositories" | OAuth2 application | Authorized Integration (signed token from Shinan) | Separate Forgejo account for Shinan |
|---|---|---|---|---|---|
| Acts as | Token owner | Token owner | Token owner | The user who created the integration | A dedicated account |
| Scope | Chosen read/write scopes; full admin powers of the owner apply (a site admin's `write:repository` reaches every repository) | Only repository and issue scopes, only the chosen repositories; admin powers removed | **No scopes: full rights of the user**, including admin for a site admin | Same scopes and repository choice as tokens | Whatever the account is given |
| Life | No expiry field in the v16 API | No expiry field | Access token 1 hour, refresh 730 hours (defaults) | Short-lived tokens Shinan signs; no stored secret | Needs its own token anyway |
| Can create webhooks | Probably, with the matching scope and admin rights (not verified) | Probably not, because admin operations are removed (to verify) | Yes | Depends on scopes | If given admin on the repositories |
| Setup | The person creates a token in Settings | Same, picking repositories | An app registered on the instance, then a consent page | The person configures an integration pointing at Shinan as issuer | An admin creates the account and grants access |

Forgejo has no equivalent of a GitHub App: there is no installation with its
own identity and its own webhook. Everything acts as some user.

### Proposal for Forgejo

- **Credential:** a scoped access token created by the connecting person, with
  "Specific repositories", `read:repository`, `read:issue`, and `write:issue`
  only if a write-back is turned on. **Proposed**. Reasons: it is the narrowest
  credential Forgejo offers; it removes admin powers, which matters because the
  owner's account is a site administrator; and OAuth2 tokens are rejected
  because they carry the user's full rights.
  - Trade-off: adding a repository means updating the token. Whether an
    existing token's repository list can be edited, or a new token is needed,
    is **open** (to verify on the instance).
  - Authorized Integrations would avoid storing a long-lived token, but Shinan
    would have to publish signing keys as an issuer. **Open**, for a later
    version.
- **Webhooks:** one **owner-level webhook** per Forgejo user or organization
  whose repositories are covered. In v16.0.5, a webhook set on a user or
  organization fires for every repository that owner holds. The person adds it
  in Forgejo's settings using the address and secret Shinan shows.
  **Proposed**. Reasons: one webhook covers new repositories automatically, and
  Shinan's token does not need the admin rights to create webhooks.
- **Webhook type:** "Forgejo", content type JSON, with a secret. Forgejo signs
  the body with HMAC-SHA256 in `X-Forgejo-Signature`. **Proposed**.
- **Network:** Forgejo only delivers to public addresses unless its
  `ALLOWED_HOST_LIST` setting says otherwise. `shinan.guneet.dev` is planned on
  Musashi, the same machine as Forgejo (D-016). Whether delivery from Forgejo
  to Shinan on the same machine works through the public address is **open**
  and must be tested at deployment (the Architecture and operations document
  owns deployment).

## 5. Events Shinan listens for

### Event map

Each row is something Shinan records as an [event](domain-model.md#event) about
a [work item](domain-model.md#work-item), or uses to keep repositories and
connections right. **Proposed** list. Reason: these are what the plan's first
version reads ("PRs, issues, comments, checks and merges"), plus what is needed
to find markers and keep repository records correct.

| What happened | GitHub webhook (actions) | Forgejo webhook (v16) | Used for |
|---|---|---|---|
| PR opened, edited, closed, merged, reopened | `pull_request`: `opened`, `edited`, `closed` (with `merged`), `reopened` | `pull_request` (event type `pull_request`) | Work item state; markers in title, description and branch name. |
| PR draft state changed | `pull_request`: `converted_to_draft`, `ready_for_review` | `pull_request` `edited`; draft is a `WIP:`-style title prefix, exposed as the PR's `draft` field | Calculated task status (`in progress` versus `in review`), owned by [Tasks and work](tasks.md). |
| New commits on a PR | `pull_request`: `synchronize` | `pull_request_sync` | Timeline; trigger CI re-read on Forgejo. |
| Review submitted or dismissed | `pull_request_review`: `submitted`, `dismissed` | `pull_request_review_approved`, `pull_request_review_rejected`, `pull_request_review_comment` | Timeline. |
| Review requested | `pull_request`: `review_requested` | `pull_request_review_request` | Timeline. |
| Issue opened, edited, closed, reopened, transferred, deleted | `issues`: those actions | `issues` | Outside issues become tasks (D-003); state of linked issues. |
| Comment on an issue or PR | `issue_comment`: `created`, `edited`, `deleted` | `issue_comment`, `pull_request_comment` | Timeline (linked, not copied). |
| Branch created or deleted | `create`, `delete` (`ref_type` branch) | `create`, `delete` | Task markers in branch names; task status for branches without a PR. |
| Commits pushed | `push` | `push` | Markers in commit messages; timeline. |
| CI result | `check_suite`: `completed`; `status` | `action_run_success`, `action_run_failure`, `action_run_recover` (Forgejo Actions only). v16 has **no webhook for commit statuses**, so other CI is read by polling ([section 7](#7-reconciliation)). | CI check events. |
| Repository renamed, transferred, made public or private, deleted | `repository` | `repository` | Repository records and visibility. |
| Release published | `release`: `published` | `release` | An event on the repository, not a work item, as the domain model proposes. Tags without a release are not recorded. |
| Repositories added to or removed from the connection | `installation`, `installation_repositories` (always sent to apps) | None; Shinan sees new repositories on the next reconciliation | Covered repositories. |

Not subscribed in the first version (**proposed**; reason: volume without a
first-version use): line comments on diffs (`pull_request_review_comment` on
GitHub; the review event already records that a review happened), labels,
assignments and milestones as separate events (they arrive inside `issues` and
`pull_request` payloads anyway), wiki, forks, packages and deployments. The
domain model proposes that deployments are catalog facts or events; no git host
deployment events are read in the first version, because no first-version
feature uses them.

GitHub's `sub_issues` and issue dependency events are not used to build task
relationships. **Proposed**; reason: task relationships live in Shinan (D-001),
and importing another tracker's structure would make two sources of truth.

### Handling a delivery

**Proposed** for both hosts:

1. **Verify** the signature (`X-Hub-Signature-256` on GitHub,
   `X-Forgejo-Signature` on Forgejo) with the connection's secret. Reject and
   count failures. Reason: the endpoint is public (D-015).
2. **Store** the raw delivery and answer `2xx` at once; process it afterwards.
   Reason: GitHub fails a delivery after 10 seconds and Forgejo after 5 seconds
   by default, and neither retries on its own.
3. **Deduplicate** by the delivery ID (`X-GitHub-Delivery`, which stays the
   same when a delivery is redelivered; `X-Forgejo-Delivery`) and by the
   item's identity and host update time, so a redelivery or a reconciliation
   read of the same change does not create a second event.
4. **Check the event type and action** and ignore unknown ones. GitHub adds
   new actions over time.
5. **Ignore Shinan's own writes** as triggers (see
   [section 9](#9-what-shinan-writes-back)), while still recording them on the
   timeline. Reason: avoids loops.
6. **Ignore repositories outside the connection**, and record a health warning
   if deliveries arrive for them.
7. **Do not trust the sender blindly.** GitHub sometimes sends a placeholder
   `ghost` user as the sender. The sender is evidence for
   [attribution](domain-model.md#attribution), not proof.

## 6. Detecting task markers

A [marker](domain-model.md#supporting-terms) is text on the git host that names
a task ID and, where possible, the agent session. The **syntax** of task IDs
and markers belongs to [Tasks and work](tasks.md) and
[Agent integrations](agent-integrations.md). This section says **where** Shinan
looks and **how** it treats what it finds.

### Where Shinan looks

| Place | Read from | Creates | Status |
|---|---|---|---|
| Branch name, for example `task/T-123-short-name` | `create` and `push` events; PR head branch | Work link to the branch, and to any PR from it | Decided that branch names carry the task ID (D-002); reading them is **proposed**. |
| PR title and description | `pull_request` `opened` and `edited` | Work link to the PR | Decided that PR descriptions carry it (D-002). |
| A Shinan task address in a PR description, such as `https://shinan.guneet.dev/.../T-123` | Same | Work link to the PR | **Proposed**; reason: an address is unambiguous even if task ID formats change. |
| Commit message, as a Git trailer line at the end (for example `Shinan-Task: T-123`) | `push` events; PR commit lists | Work link to the commit; the commit's PR inherits the link | **Proposed**; reason: trailers are a standard Git format and tools can read them reliably. Syntax owned by Tasks and work. |
| Agent session marker in a commit trailer or PR description | Same | No link; evidence for attribution confidence `marked` | **Decided** that markers feed attribution (D-017); syntax owned by Agent integrations. |
| Host closing references (`Closes #42`) from a PR to an issue that is already a task's `origin` | GitHub: the PR's closing-issue references; Forgejo: issue timeline references | A **suggested** `delivers` link | **Proposed**; reason: people already write closing references, and a suggestion avoids guessing the link role. Meaning owned by Tasks and work. |
| Comments on issues and PRs | — | Nothing | **Proposed**: comments never create work links. Reason: people mention task IDs in passing ("like T-12"), which would create false links. |

### Rules

All **proposed**:

1. **Match only the full task ID form**, never a bare number. Today's practice
   in the `workspace` repository names branches after repository issue numbers
   (for example `task/42-...`); those are not task IDs and must not match.
   Reason: issue numbers only mean something inside one repository (D-002).
2. **Resolve within the workspace that owns the connection.** The domain model
   proposes a task ID prefix per workspace (an owner decision there). With it,
   a marker names its workspace and cannot be confused with another one's. If
   the owner keeps a fixed `T-` prefix instead, a repository connected to two
   workspaces would make `T-123` ambiguous; this document then relies on the
   one-workspace-per-repository rule in
   [section 2](#one-workspace-per-repository-at-first).
3. **Unknown IDs are kept, not dropped.** A marker naming a task that does not
   exist is recorded on the work item as unresolved and shown on the
   connection's health page, so a typo can be fixed.
4. **Several IDs** in one place create one work link per task.
5. **Edits are re-read.** When a PR's title, description or branch changes, the
   markers are read again. A link that was made *only* by a marker that has now
   gone is removed, and the removal is an event. Links made by a person or an
   agent's call are never removed this way.
6. **Markers from outside actors do not count yet.** On public repositories
   anyone can open a PR from a fork whose title names `T-123`. A marker from a
   git host account that is not linked to a member creates a link that does not
   affect task status until a member confirms it. Reason: otherwise an
   outsider could move a task to `in review` or `done`. How links are confirmed
   belongs to Tasks and work.
7. **Large pushes.** GitHub's `push` payload lists up to 2,048 commits;
   Forgejo's lists only the 15 most recent by default (`PAYLOAD_COMMIT_LIMIT`).
   When a push holds more, Shinan reads the rest through the commits API.

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

| Layer | GitHub | Forgejo | Default interval (proposed) |
|---|---|---|---|
| 1. Redeliver failures | List the app's webhook deliveries since the last run and ask GitHub to redeliver failed ones. Recovers the original events with their original delivery IDs. | Not available through the API. | Every 10 minutes |
| 2. Changes since the watermark | Per repository: issues and PRs updated since the last watermark (issues support `since`; PRs are listed newest-updated first until the watermark is reached). | Per repository: `issues?type=issues&since=` and `issues?type=pulls&since=`; comments `issues/comments?since=`. | Every 15 minutes for repositories with active tasks; hourly for the rest |
| 3. Refresh linked open work | For each open work item linked to a task that is not done: state, head commit, reviews and CI results. | Same, and **commit statuses** for PR heads, because v16 has no status webhook. | Every 15 minutes, and on each PR update |
| 4. Full sweep | Repository list, branches, open PRs and issues; compares with what Shinan holds. | Same, which is also how Forgejo repositories new to an owner-level webhook are found. | Daily, and when a connection or its repositories change |
| 5. On demand | A "refresh" action on a task, work item or connection. | Same. | When asked |

After an outage longer than GitHub's 3-day redelivery window, layer 1 cannot
help and layers 2 and 4 rebuild from the watermarks. **Proposed**.

The intervals are starting values to tune against the [rate limits](#8-rate-limits-and-load)
during the trial. **Open** whether they should be per-connection settings.

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
4. **Late webhook after reconciliation.** If a redelivered or delayed webhook
   arrives for a change already recorded by reconciliation, the deduplication
   in [section 5](#handling-a-delivery) drops it.
5. **Freshness.** Each work item records when Shinan last read it (domain
   model attribute), and each connection records its last webhook and last
   successful reconciliation. A task whose linked work has not been read
   recently shows that fact rather than a confident status. How freshness is
   displayed is owned by [Human experience](human-experience.md); this answers
   the git-host half of plan question 4.

## 8. Rate limits and load

### GitHub

Checked 2026-11-16:

- **Installation token:** 5,000 REST requests per hour, plus 50 per repository
  above 20 repositories (and per organization user above 20), up to 12,500.
  This budget is the app's own.
- **User access tokens, personal tokens and OAuth apps:** share the person's
  5,000 per hour. Shinan avoids them for background work (see
  [section 3](#3-connecting-to-github)).
- **Secondary limits:** at most 100 concurrent requests; about 900 points per
  minute per REST endpoint (a read costs 1, a write 5); and in general at most
  80 content-creating requests per minute and 500 per hour. GitHub says these
  can change without notice.
- **Conditional requests:** a request with a saved `etag` that returns
  `304 Not Modified` does not count against the primary limit.
- **Search** endpoints have stricter limits; GraphQL has a separate budget.

**Proposed** practice: subscribe to webhooks rather than poll; use conditional
requests for every repeated read; make requests one after another rather than
in parallel; wait at least one second between writes; on `403` or `429` obey
`retry-after` or `x-ratelimit-reset`, otherwise wait a minute and back off
exponentially; never use the search API for reconciliation. Reason: GitHub's
own guidance, and GitHub may ban integrations that keep calling while limited.

**Budget at the owner's scale** (estimate, **proposed** as a sanity check): the
`guneet-xyz` account has at least 100 repositories (a listing on 2026-11-16
stopped at its limit of 100). Layer 2 is about two list requests per repository
per run. Even if 100 repositories were polled every 15 minutes, that is about
800 requests per hour, most of them `304` and so free, against an installation
budget of at least 9,000 (5,000 + 50 × 80) if all of them were installed. The
trial covers only a few repositories (D-018), so real use will be far lower. The first full sweep of a new
connection is the largest cost and is spread out.

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

**Proposed:** because Forgejo will not protect itself, Shinan limits itself:
one request at a time per Forgejo connection, a configurable ceiling (starting
at 1,000 requests per hour), and reconciliation work spread over the interval
rather than all at once. Reason: a reconciliation burst should not slow the
owner's Forgejo or the applications sharing the machine.

## 9. What Shinan writes back

### Summary

| Write-back | First version | Default | Identity on GitHub | Identity on Forgejo | Status |
|---|---|---|---|---|---|
| One **backlink** on each PR linked to a task, edited in place as links change | Yes | On for private repositories, off for public ones | The app (installation token) | The connection's token owner | **Proposed** |
| Backlink on an **outside issue** that became a task | Yes | Off | The app | The connection's token owner | **Proposed** |
| **Create an issue** when a person asks for one on a task | Yes | Only on request | The person, through the app (user access token) | The connection's token owner, with "requested by" in the body | Decided that issues are created only when people need them (D-004); method **proposed** |
| Commit status or check run naming the task | No | — | — | — | **Open** |
| Labels, assignees, milestones, closing or reopening issues, editing PR or issue text, merging, reviewing | Never | — | — | — | **Proposed** |
| Project boards | Never | — | — | — | **Proposed**; also impossible on Forgejo v16 (no API) |

Reasons:

- **Backlinks** let someone looking at a PR on the host find the task,
  which is what the plan means by "post links back where appropriate". One
  comment edited in place avoids a stream of noise. The comment carries the
  task ID and its Shinan address only, not the task's title or text. Reason:
  link, don't copy (D-001), and titles can reveal internal details.
- **Off on public repositories.** A task address leads to a sign-in page that
  outsiders cannot open (D-015), and it reveals that a private tracker exists.
  The value is low and the exposure is real. A workspace owner can turn it on
  per repository.
- **Off on outside issues.** The reporter cannot follow the link, and a comment
  from Shinan may suggest a promise of action. Turning it on is a workspace
  choice.
- **No commit statuses or check runs yet.** A status set by Shinan could be
  made a required check by branch protection, which would let Shinan block
  merges. Its meaning ("task linked"? "acceptance criteria met"?) is not yet
  defined. Only GitHub Apps can create check runs, so Forgejo could only get a
  commit status. **Open** for a later version.
- **Never labels, closing, editing or merging.** These would either copy task
  status onto the host (D-005 says status is calculated, and the `workspace`
  repository already avoids status labels for the same reason) or take actions
  that belong to people and their agents on the host. Closing an issue when its
  PR merges is done by the host's own closing references.

### Identity for writes

- **GitHub:** automatic writes use the app's installation token, so they appear
  as the app and never as the person (principle 4). Writes a person asks for use
  their user access token, so they appear as that person with the app's badge.
  Both are distinguishable from the person's agents, which write with their own
  tools (D-017). **Proposed**.
- **Forgejo:** there is no app identity, so writes appear as the user who owns
  the connection's token. **Proposed** for the first version, with the
  alternative of a separate Shinan account left to the owner
  ([decisions needed](#decisions-needed-from-the-owner)). Reasons: D-017 avoids
  asking people to create extra accounts, and the owner reversed a separate
  agent account on Forgejo for consistency with GitHub.
- **Recognising its own writes.** On GitHub, Shinan recognises the app as the
  author. On Forgejo, where the author is a person's account, every Shinan
  comment carries a hidden marker (an HTML comment such as
  `<!-- shinan:link T-123 -->`) and Shinan stores the comment's ID when it
  posts. **Proposed**; reason: needed to edit the comment in place, to ignore
  it as a trigger, and to credit it to Shinan rather than to the person in
  [attribution](domain-model.md#attribution).

### Agents do not write through Shinan

Agents keep using their own git host tools with their person's account
(D-017), and Shinan's MCP tools do not create branches, PRs or comments on git
hosts for them. **Proposed**; reason: D-001 keeps code work on the hosts,
agents already have host access, and routing agent writes through Shinan would
mean Shinan holding write credentials for everything agents do. The MCP tool
list is owned by [Agent integrations](agent-integrations.md); this is a
dependency, not a decision for that document.

## 10. Security notes

Only what is specific to git hosts; the overall design belongs to
[Architecture and operations](architecture.md) and
[Identity, agents and permissions](identity.md). All **proposed**:

- One webhook secret per connection (per Forgejo owner-level webhook, and the
  GitHub App's secret), random, stored as a secret, never placed in the URL.
- Reject unsigned or wrongly signed deliveries; GitHub also publishes the IP
  ranges it sends from, which can be used as an extra filter.
- The GitHub App private key and Forgejo tokens are the most sensitive things
  Shinan holds for git hosts. They are never shown again after setup, never
  logged, and never given to agents.
- Show each connection's granted permissions and covered repositories on its
  page, so a member can see what Shinan can reach.
- Visibility changes (`repository` events) are applied at once, because they
  change what may be shown to whom (plan question 3).

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
| [Domain model and glossary](domain-model.md) | Terms used throughout; the [git host](domain-model.md#git-host) and [git host connection](domain-model.md#git-host-connection) attributes, extended in [section 2](#2-git-hosts-connections-and-repositories); the proposal that releases are repository events (followed here); the "backlink" term proposed here; open question 2 (shared repositories), answered here with a proposal. |
| [Tasks and work](tasks.md) | Task ID format and marker syntax for branches, PR descriptions and commit trailers; which link roles markers and closing references create; how a member confirms a link made by an outside actor's marker; how linked work maps to task status (including draft PRs); whether comments on linked PRs should create nudges. |
| [Identity, agents and permissions](identity.md) | Who may create, change and remove git host connections; how credentials are held; linking git host accounts to people; turning connector evidence (sender, markers, source) into an actor and attribution confidence; access rules for tasks that link private repositories; whether "sign in with GitHub" uses the same GitHub App. |
| [Agent integrations](agent-integrations.md) | Agent session marker syntax in commits and PRs; confirmation that agents write to git hosts with their own tools, not through Shinan. |
| [Human experience](human-experience.md) | How work item and connection freshness, connection health, unresolved markers and suggested links are shown; the connection setup screens. |
| [Architecture and operations](architecture.md) | Webhook endpoint, queueing and storage of raw deliveries; secret storage; whether Forgejo on Musashi can deliver to Shinan on Musashi; any reverse-proxy rate limits. |
| [Roadmap and migration](roadmap.md) | Which repositories the trial covers (D-018), which decides the GitHub accounts and Forgejo owners to connect. |
| [Decision log](decisions/) | Records for the decisions below once the owner makes them. |

## Proposed in this document

1. A connector per host type behind one model, for later GitLab support
   ([section 1](#1-principles)).
2. Shinan's own writes are distinguishable from the person and their agents
   where the host allows it ([principle 4](#1-principles), [section 9](#identity-for-writes)).
3. The connector supplies attribution evidence and does not decide the actor
   ([principle 5](#1-principles)).
4. Connection attributes, health states, and repository records keyed by the
   host's stable ID ([section 2](#2-git-hosts-connections-and-repositories)).
5. A private GitHub App owned by `guneet-xyz`, with installation tokens for
   reads and automatic writes, user tokens only for person-requested writes,
   and the listed read-mostly permissions ([section 3](#3-connecting-to-github)).
6. Per-installation GitHub Apps for self-hosting, using the manifest flow.
7. Forgejo: a "Specific repositories" scoped token, owner-level webhooks added
   by the person, signed JSON deliveries ([section 4](#4-connecting-to-forgejo)).
8. The event map and the delivery-handling steps ([section 5](#5-events-shinan-listens-for)).
9. Where markers are read and the seven marker rules, including "outside
   actors' markers do not count until confirmed" ([section 6](#6-detecting-task-markers)).
10. Five reconciliation layers with starting intervals, and how reconciled
    events are recorded ([section 7](#7-reconciliation)).
11. Rate-limit practice for GitHub and self-limiting for Forgejo
    ([section 8](#8-rate-limits-and-load)).
12. Write-backs: one in-place backlink (on for private, off for public
    repositories), issues only on request, no statuses, labels, closing,
    editing or boards ([section 9](#9-what-shinan-writes-back)).
13. Agents do not write to git hosts through Shinan.
14. Releases are recorded as repository events; deployments are not read from
    git hosts in the first version.
15. One workspace per repository in the first version
    ([section 2](#one-workspace-per-repository-at-first)).
16. The term "backlink" for Shinan's comment on a git host item.

## Open questions

1. **Read-only GitHub App.** Should Shinan offer a second, read-only app
   registration for workspaces that want no write-back at all, given that
   GitHub sets permissions per app?
2. **GitHub organizations.** Will the trial need repositories outside
   `guneet-xyz` (for example in an organization)? If so, the app must be public
   or registered by that organization.
3. **Forgejo token maintenance.** Can a "Specific repositories" token's
   repository list be edited after creation on v16, or must a new token be made
   when a repository is added? Can such a token create webhooks? (Verify on
   `git.guneet.dev`.)
4. **Forgejo replay identity.** Does replaying a delivery in Forgejo's web
   interface keep the original delivery ID? This affects deduplication only
   slightly, because items are also deduplicated by update time.
5. **Same-machine delivery.** Can Forgejo on Musashi deliver webhooks to
   `shinan.guneet.dev` on Musashi with the default `ALLOWED_HOST_LIST`?
   (Architecture and operations, at deployment time.)
6. **Reverse-proxy limits.** Does anything in front of `git.guneet.dev` limit
   API requests?
7. **GraphQL.** Should GitHub reads use GraphQL to batch PR, review and CI data
   in fewer requests? REST is assumed here because conditional requests make
   repeated REST reads free.
8. **Comments as nudges.** Should a person's comment on a linked PR or issue on
   the git host reach the agent session working on the task, like a comment in
   Shinan does? (Tasks and work; Agent integrations.)
9. **Authorized Integrations.** Should a later version let Shinan sign
   short-lived tokens for Forgejo instead of storing a token?
10. **Commit statuses.** Is there a useful, safe meaning for a Shinan status on
    a commit, for a later version?
11. **Reconciliation intervals.** Fixed, or a per-connection setting?

## Decisions needed from the owner

| # | Decision | Recommended option | Reason |
|---|---|---|---|
| 1 | How Shinan connects to GitHub | A GitHub App (installation token; user access tokens only for actions a person asks for) | Own rate limit, one webhook for all repositories, short-lived tokens, and writes that cannot be mistaken for the person's agents. |
| 2 | Who owns the GitHub App and who can install it | Private app owned by `guneet-xyz` for now | Covers the owner's repositories and nobody else can install it; revisit if organization repositories join. |
| 3 | Forgejo credential | A "Specific repositories" scoped token from the connecting person | Narrowest option, and it strips the site-admin powers of the owner's account. |
| 4 | Identity Shinan uses for writes on Forgejo | The connecting person's account, with a hidden marker in each comment | Avoids a new account (in line with D-017 and the reversed `daedalus-agent` account); the marker keeps Shinan's writes recognisable. |
| 5 | How Forgejo webhooks are created | The person adds one owner-level webhook per user or organization in Forgejo's settings | One webhook covers new repositories, and Shinan's token needs no admin rights. |
| 6 | Default backlinks on PRs | On for private repositories, off for public ones | People reading private PRs can find the task; public readers could not open the link anyway. |
| 7 | Commit statuses or check runs in the first version | No | Their meaning is undefined and a required status would let Shinan block merges. |
| 8 | Markers from git host accounts not linked to a member | Create links that do not affect task status until a member confirms | Stops outsiders' fork PRs from changing task status. |
| 9 | Can one repository be connected to more than one workspace? | Not in the first version | Avoids duplicate backlinks, double API use and ambiguous markers; the data model allows relaxing it later. |

## Sources

All checked on **2026-11-16**.

GitHub documentation:

- [Deciding when to build a GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/deciding-when-to-build-a-github-app)
- [About creating GitHub Apps](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/about-creating-github-apps) (private apps install only on the owning account)
- [Authenticating as a GitHub App installation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation) (1-hour tokens)
- [Authenticating on behalf of a user](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-with-a-github-app-on-behalf-of-a-user) (user shown with the app's badge)
- [Refreshing user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens) (8 hours and 6 months)
- [Registering a GitHub App from a manifest](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)
- [Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [Best practices for using the REST API](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)
- [Webhook events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads) (event actions, 2,048-commit push limit, 25 MB cap, `ghost` sender)
- [Best practices for using webhooks](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks) (10-second response, delivery ID kept on redelivery)
- [Handling failed webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries) and [Redelivering webhooks](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks) (no automatic retry, 3-day window)
- [REST API endpoints for GitHub App webhooks](https://docs.github.com/en/rest/apps/webhooks) and [Timeline events](https://docs.github.com/en/rest/issues/timeline)
- GitHub API read of the `guneet-xyz` account type (personal account).

Forgejo documentation, source and instance:

- [Webhooks](https://forgejo.org/docs/latest/user/repository/webhooks/), [API usage](https://forgejo.org/docs/latest/user/api/usage/), [Access token scope](https://forgejo.org/docs/latest/user/authentication/token-scope/), [OAuth2 provider](https://forgejo.org/docs/latest/user/authentication/oauth2-provider/) ("OAuth2 scopes are not yet implemented") and [Authorized Integrations](https://forgejo.org/docs/latest/user/api/authorized-integrations/) (v17.0.1 pages).
- [Configuration cheat sheet, v16.0](https://forgejo.org/docs/v16.0/admin/config-cheat-sheet/): `[webhook]` (`DELIVER_TIMEOUT` 5, `ALLOWED_HOST_LIST` external, `PAYLOAD_COMMIT_LIMIT` 15), `[api]`, `[oauth2]`, `cron.cleanup_hook_task_table` (168 hours), `[authorized_integration]`; no API rate-limit setting found.
- Forgejo source at tag `v16.0.5`: [`modules/webhook/type.go`](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/modules/webhook/type.go) (event types), [`services/webhook/webhook.go`](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/services/webhook/webhook.go) (owner-level webhooks apply to all of an owner's repositories), [`services/webhook/deliver.go`](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/services/webhook/deliver.go) (single delivery attempt), [`services/webhook/shared/payloader.go`](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/services/webhook/shared/payloader.go) (`X-Forgejo-Signature`).
- `https://git.guneet.dev`: `/api/v1/version`, `/api/v1/settings/api`, `/swagger.v1.json` and the public organization list.
- The `workspace` repository's Forgejo setup notes and Forgejo and Musashi catalog entries (read-only background; their own check dates are cited where used).
