# Git host integrations

Status: **draft for review** ([issue #8](https://github.com/guneet-xyz/shinan/issues/8)).

This document says how Shinan connects to GitHub and Forgejo: how a git host
connection is made, which webhooks Shinan listens for, how it reads the hosts'
APIs, where it looks for task markers, how it catches up when webhooks are
missed (reconciliation), how it stays inside rate limits, and what it writes
back to the hosts and under which identity.

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
   host account of the person they work for (D-017). That decision is about
   agents; it says nothing about Shinan itself. When Shinan writes to a git host
   (for example a backlink), its writes should be distinguishable from the
   person and their agents wherever the host allows it: on GitHub through the
   app's own identity, on Forgejo through a separate account (see
   [section 4](#which-forgejo-account-shinan-uses)). **Proposed**; reasons:
   people reading a PR should know a comment came from Shinan, and any feature
   that reacts to a person's comments on the host must not mistake Shinan's for
   theirs. If the owner chooses the person's account on Forgejo, that is a
   stated exception to this principle, with the costs listed in section 4.
5. **The connector supplies evidence; it does not decide who acted.** For each
   git host event the connector records the git host account that the host
   reports, any markers found and where the event came from (webhook or
   reconciliation). [Identity, agents and permissions](identity.md) decides the
   actor and the attribution confidence from that evidence, and owns plan
   question 2 (how reliable attribution can be). **Proposed**; reason: D-017
   says the git host account cannot tell a person from their agents, so the
   connector must not pretend it can.
6. **Least privilege.** Shinan asks for read access by default, and for write
   access only for the write-backs a workspace turns on. It stores nothing from
   repositories a connection does not cover. **Proposed**; reason: a workspace
   holds infrastructure details and Shinan is on the public internet (D-015),
   so a leaked Shinan credential or database must do as little harm as possible.

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
| Method and account | GitHub App installation; or the Forgejo account and token Shinan uses (sections 3 and 4). |
| Covered repositories | The repositories Shinan reads through this connection, by the host's stable repository ID. |
| Write-back settings | Which write-backs are on, per repository ([section 9](#9-what-shinan-writes-back)). |
| Counting branches | Per repository, the branches whose merges count as "merged" for [Tasks and work](tasks.md#62-markers); the default branch unless set. |
| Automated accounts | Per repository, git host accounts such as dependency update tools whose issues and PRs skip triage or are ignored. Tasks and work defines what the setting does ([Tasks §5.1](tasks.md#51-which-issues-become-tasks)); it lives here because it names git host accounts per repository. |
| Set up by | The member who made the connection, and whose credential it depends on, if any. |
| Webhook state | Last delivery received, signature failures, failed deliveries seen. |
| Reconciliation state | Per repository: last successful run of each layer, the watermark, last error. |
| Health | `working`, `degraded` or `failing`, defined below. |

**Health** (**proposed**):

| State | Detected when |
|---|---|
| `working` | Webhooks arrive and reconciliation finds nothing they missed. |
| `degraded` | GitHub: the deliveries API shows failed deliveries since the last sweep, or signatures fail. Forgejo: reconciliation finds changes newer than the last delivery that no webhook reported, or no delivery has arrived for 24 hours while reconciliation sees changes. Reading still works. |
| `failing` | Shinan cannot read the host: the token is rejected or revoked, the app is uninstalled or suspended, or every covered repository returns an error. |

When a connection depends on one member's credential (a Forgejo token created
by a person) and that member leaves the workspace or the token is revoked, the
connection becomes `failing`, and its page names the member and says that
someone must reconnect. **Proposed**; reason: a silent stop would leave task
status quietly stale.

Who may create or remove a connection, and how its credentials are stored, is
owned by [Identity, agents and permissions](identity.md) and
[Architecture and operations](architecture.md).

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
connected to more than one workspace (its open question 2). **Proposed:** in
the first version, a repository can be covered by the git host connections of
only one workspace in a Shinan installation; a second workspace asking for it
is refused with a clear message. The data keeps repositories and work items
outside workspaces, so this can be relaxed later. Reasons:

- Two workspaces on one repository would each post their own backlinks and run
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

### Proposal: one GitHub App, installation token only

**Proposed:** Shinan connects to GitHub through a GitHub App and, in the first
version, uses only its **installation token**: for reading, webhooks and every
write-back. Reasons: own rate-limit budget, one webhook for all repositories,
short-lived tokens, fine-grained permissions, and writes that show as the app,
not as the person (principle 4).

**Writes a person asks for** (for example creating a repository issue for a
task, D-004) also use the installation token, and say "requested by <person>"
in the body, as on Forgejo. **Proposed** for the first version. Reasons:

- The alternative, a user access token, needs a refresh token stored per
  member, valid for 6 months, that can write issues and PRs in every repository
  the person and the installation share. That is a new standing credential for
  little gain.
- A middle option is to ask the person to authorise at the moment of the
  request and not keep the refresh token. It credits the issue to the person
  on the host, at the cost of a GitHub consent step each time.

This is an [owner decision](#decisions-needed-from-the-owner), shared with
[Identity, agents and permissions](identity.md), which also decides whether the
same app provides "sign in with GitHub".

OAuth apps and personal tokens are **not** offered for GitHub in the first
version. **Proposed**; reason: per-repository webhooks, shared rate limits and
broad or long-lived credentials, with nothing gained in return.

**Permissions requested** (**proposed**; read unless stated):

| Permission | Why |
|---|---|
| Metadata | Required by GitHub for every app; repository list and `repository` events. |
| Contents | `push`, `create`, `delete` and `release` events; commit messages for markers. Read only: Shinan never pushes code. |
| Pull requests: read and write | PR events and reviews; write only to post or edit backlinks. |
| Issues: read and write | Issue and comment events; write for backlinks, issues a person asks for (D-004), and outcome comments if the owner chooses them ([section 9](#9-what-shinan-writes-back)). |
| Checks | CI check results (`check_suite`, `check_run`). |
| Commit statuses | CI results reported as commit statuses (`status`). |

Not requested: Administration. So Shinan does not set up GitHub custom
autolinks for task IDs, which [Tasks and work](tasks.md#62-markers) asks about.
Configuring autolinks needs repository administration permission (checked
2026-11-16), against principle 6, and the task address written next to the ID
already works on every host. **Proposed**.

Write access is only used when a workspace turns the matching write-back on.
GitHub permissions are set per app, not per installation, so a workspace that
wants read-only access can only get it from an app registered read-only.
**Open** whether to register a read-only variant (see
[open questions](#open-questions)).

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
  [open questions](#open-questions).

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
- Access tokens can be listed, created and deleted through the API, but not
  edited: `/users/{username}/tokens` supports only GET and POST, and
  `/users/{username}/tokens/{token}` only DELETE. Tokens have no expiry field.
  Whether the web interface can change a token's repository list was not
  checked.
- The `guneet` account is the owner and a **site administrator**, and agents on
  Daedalus use it (the `workspace` repository's Forgejo service entry, checked
  there 2026-11-08). A separate `daedalus-agent` account existed and was
  disabled on 2026-11-08 so that agent work matches the owner's identity on
  GitHub.
- The organization list visible without signing in was empty, so it is not
  known from here which organizations hold the repositories Shinan will cover.

### Options compared

Facts checked 2026-11-16 against Forgejo's documentation and the v16.0.5
source and API schema (see [sources](#sources)).

| | Scoped access token, "All" repositories | Scoped access token, "Specific repositories" | OAuth2 application | Authorized Integration (signed token from Shinan) |
|---|---|---|---|---|
| Scope | Chosen read/write scopes, plus all the owner's admin powers. From a site admin this includes `write:repository` on every repository and acting as any user with `?sudo=` | Only repository and issue scopes, only the chosen repositories; admin powers removed | **No scopes: full rights of the user**, including admin for a site admin | Same scopes and repository choice as tokens |
| Life | No expiry in the v16 API | No expiry; cannot be edited through the API, so adding a repository means a new token | Access token 1 hour, refresh 730 hours (defaults) | Short-lived tokens Shinan signs; no stored secret |
| Can create webhooks | With the matching scope and admin rights on the owner (not tested) | **No**: user and organization webhooks need scopes it cannot have, and repository webhooks are an admin operation it is barred from | Yes | Depends on scopes |
| Setup | The account creates a token in Settings | Same, picking repositories | An app registered on the instance, then a consent page | The account configures an integration naming Shinan as issuer |

Forgejo has no equivalent of a GitHub App: there is no installation with its
own identity and its own webhook. Everything acts as some user.

### Which Forgejo account Shinan uses

Shinan needs a Forgejo account for its token. There are two options, with
different costs (**open**; [owner decision](#decisions-needed-from-the-owner)):

| | A separate, non-admin `shinan` account on each Forgejo server | The connecting person's own account |
|---|---|---|
| How writes appear on the host | As `shinan`; clearly not the person or their agents | As the person; identical to the person's and their agents' comments |
| Webhook events for Shinan's own edits | Arrive from `shinan`, easy to ignore | Arrive from the person (for example every backlink edit sends an `issue_comment` from `guneet`) |
| Effect on features that react to a person's host comments | None | Shinan's comments would look like the person's, for example if host comments ever create nudges ([Tasks §11.1](tasks.md#111-when-a-nudge-is-created) leaves that open) |
| Admin powers behind the token | None at all, whatever the token type | The owner's account is a site admin; safety depends on using a "Specific repositories" token, checked at connection time (below) |
| Depends on one member | No; survives a member leaving | Yes; the connection fails if that member leaves or revokes the token |
| Setup | Once per Forgejo server: an admin (or open registration) creates the account. Then access per repository: as a collaborator on user-owned repositories, or through an organization team. Collaborator access on a user-owned repository is repository-wide (write would include code), so the token's scopes are what keep it narrow. | Only creating a token |
| Fit with D-017 | D-017 avoids asking *every user* to create extra accounts for *agents*. This is one account per server for Shinan itself, comparable to registering the GitHub App once per installation. | No extra account |

**Recommended:** the separate `shinan` account, for reading and writing.
Reasons: it is the only way to keep principle 4 on Forgejo, it removes site-admin
powers from Shinan's credential entirely, and the connection does not depend on
one member. The person's account is acceptable for a read-only connection
(no write-back on), where the main cost, writes looking like the person's, does
not arise.

Whether a non-admin account with read access can comment on issues and PRs in
v16, and which access closing issues needs, must be verified on the instance
before relying on it. **Open**.

### Token and connection check

**Proposed** for either account:

- The token is a **"Specific repositories"** token with `read:repository`,
  `read:issue`, and `write:issue` only if a write-back is on. Reasons: it is
  the narrowest credential Forgejo offers and it strips admin powers. OAuth2
  tokens are rejected because they carry the user's full rights.
- **At connection time Shinan tests the token and refuses it** unless the
  server rejects it on `GET /api/v1/user`, on `GET /api/v1/admin/users`, and,
  where the person names one, on a private repository outside the chosen list,
  while accepting it on a chosen repository. Reason: a pasted "All" token from a site admin could act
  as any user; this catches the mistake before Shinan stores it. Shinan
  repeats the test daily.
- **Adding a repository** means creating a new token with the longer list and
  replacing the old one, then deleting the old token on the host. Reason: v16
  tokens cannot be edited through the API.
- **Rotation:** v16 tokens never expire, so Shinan shows each token's age and
  asks for a new one after 6 months, and at once when the member who created
  it leaves. **Proposed**; the policy itself belongs to
  [Identity, agents and permissions](identity.md).
- Authorized Integrations would avoid storing a long-lived token, but Shinan
  would have to publish signing keys as an issuer. **Open**, for a later
  version.

### Webhooks

Two ways (**open**; [owner decision](#decisions-needed-from-the-owner)):

- **Owner-level webhook**, one per Forgejo user or organization whose
  repositories are covered. In v16.0.5 a webhook on a user or organization
  fires for **every** repository that owner holds, including private ones the
  connection does not cover. Shinan drops those deliveries before storing
  anything ([section 5](#handling-a-delivery)), but their content still
  travels to Shinan. New repositories are covered without extra steps.
- **Per-repository webhooks**, one on each covered repository. Only covered
  repositories send events, at the cost of one manual step per repository
  (the token cannot create webhooks, see above).

**Recommended:** owner-level webhooks for the owner's own accounts, where the
uncovered repositories belong to the same person who runs Shinan;
per-repository webhooks for owners whose other repositories must not reach
Shinan. Either way, the person adds the webhook in Forgejo's settings, using
the address and secret Shinan shows.

- **Webhook type:** "Forgejo", content type JSON, with a secret. Forgejo signs
  the body with HMAC-SHA256 in `X-Forgejo-Signature`. **Proposed**.
- **Network:** Forgejo only delivers to public addresses unless its
  `ALLOWED_HOST_LIST` setting says otherwise. `shinan.guneet.dev` is planned on
  Musashi, the same machine as Forgejo (D-016). Whether delivery from Forgejo
  to Shinan on the same machine works through the public address is **open**
  and must be tested at deployment (Architecture and operations owns
  deployment).

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
| Review submitted or dismissed | `pull_request_review`: `submitted`, `dismissed` | `pull_request_review_approved`, `pull_request_review_rejected`, `pull_request_review_comment` | Timeline. |
| Review requested | `pull_request`: `review_requested` | `pull_request_review_request` | Timeline. |
| Issue opened, edited, closed, reopened, transferred, deleted | `issues`: those actions | `issues` | Outside issues become tasks (D-003); state of linked issues; markers. |
| Comment on an issue or PR | `issue_comment`: `created`, `edited`, `deleted` | `issue_comment`, `pull_request_comment` | Timeline (linked, not copied); markers. |
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
`pull_request` payloads anyway), wiki, forks, packages and deployments. The
domain model proposes that deployments are catalog facts or events; no git host
deployment events are read in the first version, because no first-version
feature uses them.

GitHub's `sub_issues` and issue dependency events are not used to build task
relationships. **Proposed**; reason: task relationships live in Shinan (D-001),
and importing another tracker's structure would make two sources of truth.

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
   by default, and neither retries on its own.
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
[Tasks and work §6.2](tasks.md#62-markers) defines the task part: the syntax
for branch names, PR descriptions and commit trailers, which place gives which
link role, mentions in titles, issues and comments, branches naming several
IDs, and unknown IDs. [Agent integrations](agent-integrations.md) defines the
agent session part. This document does not restate those rules. It says where
the text comes from, when it is read again, and three connector rules.

### Where Shinan looks

| Text | Read from (webhook) | Read again by |
|---|---|---|
| Branch names | `create`, `push`; the head branch of each PR | Reconciliation layer 3 (branches) |
| PR titles and descriptions | `pull_request` (`opened`, `edited`) | Layer 2 |
| Issue bodies | `issues` (`opened`, `edited`) | Layer 2 |
| Comments on issues and PRs | `issue_comment`, `pull_request_comment` (`created`, `edited`, `deleted`) | Layer 2 |
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
stop following edits. **Proposed**; reason: Tasks and work removes a
marker-made link when the marker is edited out of active work, which only
works if edits are re-read.

### Connector rules

All **proposed**:

1. **Resolve within the workspace that owns the connection.** The domain model
   and [Tasks §3](tasks.md#3-task-ids) propose a task ID prefix per workspace
   (an owner decision there). With it, a marker names its workspace. If the
   owner keeps a fixed `T-` prefix instead, this document relies on the
   [one-workspace-per-repository rule](#one-workspace-per-repository-at-first).
2. **Markers from outside actors do not count yet.** On public repositories
   anyone can open a PR from a fork naming `T-123`. The connector marks every
   marker with whether its author is a git host account linked to a member, so
   that [Tasks §6.4](tasks.md#64-unconfirmed-links) can make an outsider's
   marker an unconfirmed link that does not affect status. Reason: otherwise an
   outsider could move a task to `in review` or `done`. Listed as an
   [owner decision](#decisions-needed-from-the-owner), as in Tasks and work.
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

Visibility is read hourly for every repository because it changes who may see
what (plan question 3, [section 10](#10-security-notes)).

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

| Write-back | First version | Default | Status |
|---|---|---|---|
| One **backlink** on each PR linked to a task, edited in place as links change | Yes | Only when the PR description does not already contain the task's address; off in public repositories | **Proposed** |
| Backlink on an **outside issue** when it becomes a task | Yes | Off | **Proposed** |
| **Outcome on origin issues and requested issues** when the task finishes | Options below | Recommended: nothing in the first version (option a) | **Open**: [owner decision](#decisions-needed-from-the-owner) |
| **Create an issue** when a person asks for one on a task | Yes | Only on request | Decided that issues are created only when people need them (D-004); method **proposed** |
| Commit status or check run naming the task | No | — | **Open** |
| Labels, assignees, milestones, reopening issues, editing PR or issue text, merging, reviewing | Never | — | **Proposed** |
| Project boards | Never | — | **Proposed**; also impossible on Forgejo v16 (no API) |

Identity for all of these: the GitHub App on GitHub; the Forgejo account chosen
in [section 4](#which-forgejo-account-shinan-uses) on Forgejo.

### Backlinks

- Backlinks let someone looking at a PR on the host find the task, which is
  what the plan means by "post links back where appropriate". One comment
  edited in place avoids a stream of noise. It carries the task ID and its
  Shinan address only, not the task's title or text. Reason: link, don't copy
  (D-001), and titles can reveal internal details. **Proposed**.
- **Skipped when the PR already links the task.** [Tasks §6.2](tasks.md#62-markers)
  asks PR descriptions to carry the task ID with its address, so most agent PRs
  already link to the task. A backlink then adds only a write and a
  notification to everyone watching the PR. **Proposed**.
- **Off in public repositories.** A task address leads to a sign-in page that
  outsiders cannot open (D-015), and it reveals that a private tracker exists.
  A workspace owner can turn it on per repository. **Proposed**.
- **Off on outside issues.** The reporter cannot follow the link; what they
  need is the outcome, covered below. **Proposed**.

### Outcome on origin issues and requested issues

[Tasks and work](tasks.md#53-after-triage) proposes that a reporter hears the
outcome on the host where they reported. Same-repository origin issues are
closed by the host's own `Closes #42` at merge. A closing keyword cannot reach
across repositories or hosts, so origin issues elsewhere, and
[issues created for people](tasks.md#66-repository-issues-for-people), need
someone to close or comment on them. Options for what Shinan writes:

| Option | On `done` | On `cancelled` |
|---|---|---|
| (a) Nothing | The agent or person finishing the task closes or comments with their own git host tools; the task shows origin issues still open as a reminder (the current Tasks and work draft) | Same |
| (b) Comment and close on done | Comment linking the delivering PRs, then close if still open | Comment that the team decided not to do it; a person closes |
| (c) Comment and close always | As (b) | Comment and close |

Trade-offs:

- (a) keeps Shinan's writes to backlinks and requested issues, needs no extra
  access, and lets the reporter hear the outcome in a team member's words. It
  relies on someone acting on the reminder.
- (b) means the reporter always hears about finished work, and closing a done
  issue is a plain fact about merged work. It needs issue write access, and on
  Forgejo the access a separate account needs to close issues is not yet
  verified ([open question 3](#open-questions)).
- (c) also has Shinan close issues as "won't do", which is a judgement a person
  should communicate in their own words.

**Recommended: (a) for the first version**, moving to (b) if the reminders
prove to be missed during the trial. Reason: the trial is small (D-018), (a)
matches the Tasks and work draft, and it adds no write access before it is
shown to be needed. In (b) and (c) the comment never contains Shinan addresses
in public repositories, only links to the public PRs.

### Why the rest is never written

- **No commit statuses or check runs yet.** A status set by Shinan could be
  made a required check by branch protection, which would let Shinan block
  merges. Its meaning ("task linked"? "acceptance criteria met"?) is not yet
  defined. Only GitHub Apps can create check runs, so Forgejo could only get a
  commit status. **Open** for a later version.
- **No labels, reopening, editing or merging.** These would either copy task
  status onto the host (D-005 says status is calculated, and the `workspace`
  repository already avoids status labels for the same reason) or take actions
  that belong to people and their agents on the host.

### Recognising its own writes

**Proposed**. A comment counts as Shinan's only when Shinan can prove it wrote
it:

1. Before posting, Shinan records a **pending write**: the item, the kind of
   write, and a random, single-use nonce placed in a hidden marker in the body
   (an HTML comment such as `<!-- shinan:7f3a… -->`).
2. When the host answers, Shinan stores the comment's ID and clears the
   pending write.
3. An incoming comment is Shinan's if its ID is stored, or if it matches an
   open pending write on the same item, with the same nonce, from the account
   Shinan writes as. That covers a webhook that arrives before the API answer.
4. Any other comment carrying a Shinan-style marker is an ordinary comment by
   its author, recorded as such, and flagged on the connection's health page.

Reasons: anyone can paste a marker, including outside actors on public
repositories and agents, so the marker alone proves nothing; and the webhook
for Shinan's own comment can arrive before Shinan knows the comment's ID. On
GitHub the app's identity is a further check; on Forgejo the separate account
is, if the owner chooses it.

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

- **Webhook secrets:** one per GitHub App (GitHub has one secret per app, not
  per installation), and one per Forgejo webhook. Random, stored as secrets,
  never placed in the URL.
- **Signature checks** as in [section 5](#handling-a-delivery). GitHub also
  publishes the IP ranges it sends from, which can be used as an extra filter.
- **Credentials:** the GitHub App private key and Forgejo tokens are the most
  sensitive things Shinan holds for git hosts. They are never shown again
  after setup, never logged, and never given to agents. Forgejo tokens pass
  the [connection-time test](#token-and-connection-check) before they are
  stored.
- **Nothing from uncovered repositories is stored**
  ([section 5](#handling-a-delivery), step 2).
- **Visibility:** each connection's page shows its granted permissions and
  covered repositories. Visibility changes are applied as soon as they are
  seen (at once from webhooks, within an hour from reconciliation), because
  they change what may be shown to whom (plan question 3).

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
| [Domain model and glossary](domain-model.md) | Terms used throughout; the [git host](domain-model.md#git-host) and [git host connection](domain-model.md#git-host-connection) attributes, extended in [section 2](#2-git-hosts-connections-and-repositories); the proposal that releases are repository events (followed here); the "backlink" term proposed here; its open question 2 (shared repositories), answered here with a proposal. |
| [Tasks and work](tasks.md) (PR #20) | Marker syntax and every rule about which text makes which link, including comments, several IDs, trailers and when marker-made links stop following edits ([§6](tasks.md#6-linking-work)), followed here, not restated; unconfirmed links and who confirms them ([§6.4](tasks.md#64-unconfirmed-links)); task status from linked work; the meaning of the automated-accounts and counting-branches settings, which live on the connection here; how origin issues are closed (option a in [section 9](#outcome-on-origin-issues-and-requested-issues) matches its current draft). This document answers its questions on detection, telling direct pushes from PR commits, reconciliation and freshness, shared repositories, write-back to origin issues, where automated accounts and counting branches are set, reverts (open) and autolinks (no). |
| [Identity, agents and permissions](identity.md) | Who may create, change and remove git host connections; how credentials are held and rotated; linking git host accounts to people; turning connector evidence into an actor and attribution confidence (plan question 2); access rules for tasks that link private repositories (plan question 3); whether "sign in with GitHub" uses the same app; the choice about person-requested writes on GitHub. |
| [Agent integrations](agent-integrations.md) | Agent session marker syntax; confirmation that agents write to git hosts with their own tools, not through Shinan. |
| [Human experience](human-experience.md) | How work item and connection freshness, connection health, flagged markers and unconfirmed links are shown; the connection setup screens. |
| [Architecture and operations](architecture.md) | Webhook endpoint, queueing and storage of deliveries; secret storage; whether Forgejo on Musashi can deliver to Shinan on Musashi; any reverse-proxy rate limits; task address shape. |
| [Roadmap and migration](roadmap.md) | Which repositories the trial covers (D-018), which decides the GitHub accounts and Forgejo owners to connect. |
| [Decision log](decisions/) | Records for the decisions below once the owner makes them. |

## Proposed in this document

1. A connector per host type behind one model, for later GitLab support
   ([section 1](#1-principles)).
2. Shinan's own writes are distinguishable from the person and their agents
   where the host allows it ([principle 4](#1-principles)).
3. The connector supplies attribution evidence and does not decide the actor;
   plan question 2 stays with Identity ([principle 5](#1-principles)).
4. Connection attributes, health states and their detection, the automated
   accounts setting, and repository records keyed by the host's stable ID
   ([section 2](#2-git-hosts-connections-and-repositories)).
5. One workspace per repository in the first version.
6. A private GitHub App owned by `guneet-xyz`, using only its installation
   token, with read-mostly permissions and no Administration (so no autolinks)
   ([section 3](#3-connecting-to-github)).
7. Per-installation GitHub Apps for self-hosting, using the manifest flow.
8. Forgejo: a separate non-admin `shinan` account; "Specific repositories"
   tokens tested at connection time and rotated; owner-level or per-repository
   webhooks ([section 4](#4-connecting-to-forgejo)).
9. The event map, routing on `X-Forgejo-Event-Type`, delivery handling with
   repository filtering before storage, and event identity keys
   ([section 5](#5-events-shinan-listens-for)).
10. Where marker text is read and re-read, and the outside-actor rule
    ([section 6](#6-detecting-task-markers)).
11. Six reconciliation layers, the watermark rule, longest staleness and a
    30-minute freshness threshold ([section 7](#7-reconciliation)).
12. Rate-limit practice for GitHub and a self-imposed ceiling for Forgejo, with
    budgets for both ([section 8](#8-rate-limits-and-load)).
13. Write-backs: backlinks only where useful, issues only on request, options
    for outcome comments on origin issues, no statuses, labels or boards; own writes
    recognised by stored IDs and pending writes ([section 9](#9-what-shinan-writes-back)).
14. Agents do not write to git hosts through Shinan.
15. Releases are recorded as repository events; deployments are not read from
    git hosts in the first version.
16. The term "backlink".

## Open questions

1. **Read-only GitHub App.** Should Shinan offer a second, read-only app
   registration for workspaces that want no write-back at all, given that
   GitHub sets permissions per app?
2. **GitHub organizations.** Will the trial need repositories outside
   `guneet-xyz` (for example in an organization)? If so, the app must be public
   or registered by that organization.
3. **Forgejo account rights.** On v16, can a non-admin account with read access
   comment on issues and PRs, and what access does closing an issue need?
   Can the web interface change a token's repository list? (Verify on
   `git.guneet.dev`.)
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
9. **Commit statuses.** Is there a useful, safe meaning for a Shinan status on
   a commit, for a later version?
10. **Reconciliation intervals.** Fixed, or a per-connection setting?

## Decisions needed from the owner

| # | Decision | Recommended option | Reason |
|---|---|---|---|
| 1 | How Shinan connects to GitHub | A GitHub App, installation token only | Own rate limit, one webhook for all repositories, short-lived tokens, writes that cannot be mistaken for the person's agents. |
| 2 | Who owns the GitHub App | Private, owned by `guneet-xyz`, for now | Covers the owner's repositories and nobody else can install it. |
| 3 | Writes a person asks for on GitHub (with Identity) | Installation token with "requested by" in the body | No stored per-member refresh token that can write issues and PRs for 6 months. |
| 4 | Forgejo account Shinan uses | A separate non-admin `shinan` account (person's account acceptable for read-only connections) | Keeps Shinan's writes distinct, holds no admin powers, survives a member leaving; costs one account per server and per-repository access. |
| 5 | Forgejo token | "Specific repositories" token, refused at connection time unless admin and user routes fail | Narrowest option, and it catches a pasted "All" token that could act as any user. |
| 6 | Forgejo webhooks | Owner-level for the owner's own accounts; per-repository elsewhere | Owner-level also sends events from uncovered private repositories (dropped unstored); per-repository costs a step per repository. |
| 7 | Default backlinks on PRs | Only when the PR description lacks the task address; off in public repositories | Most agent PRs already link the task; public readers cannot open the link. |
| 8 | Outcome on origin and requested issues: (a) nothing, finisher acts on a reminder; (b) comment and close on `done`; (c) comment and close always | (a) for the first version, (b) if reminders are missed | Matches Tasks and work, adds no write access until needed; "won't do" stays a person's message. |
| 9 | Commit statuses or check runs in the first version | No | Meaning undefined, and a required status would let Shinan block merges. |
| 10 | Markers from accounts not linked to a member | Link, but do not affect task status until a member confirms | Stops outsiders' fork PRs and comments from changing task status. |
| 11 | One repository in several workspaces (glossary open question 2) | Not in the first version | Avoids duplicate backlinks, double API use and ambiguous markers; can be relaxed later. |

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
- [REST API endpoints for GitHub App webhooks](https://docs.github.com/en/rest/apps/webhooks), [Timeline events](https://docs.github.com/en/rest/issues/timeline), [Issue comments](https://docs.github.com/en/rest/issues/comments) (`since` on repository comments) and [Autolinks](https://docs.github.com/en/rest/repos/autolinks) (repository administration permission)
- GitHub API read of the `guneet-xyz` account type (personal account).

Forgejo documentation, source and instance:

- [Webhooks](https://forgejo.org/docs/latest/user/repository/webhooks/), [API usage](https://forgejo.org/docs/latest/user/api/usage/), [Access token scope](https://forgejo.org/docs/latest/user/authentication/token-scope/) (specific-repository tokens; site admin `sudo`), [OAuth2 provider](https://forgejo.org/docs/latest/user/authentication/oauth2-provider/) ("OAuth2 scopes are not yet implemented") and [Authorized Integrations](https://forgejo.org/docs/latest/user/api/authorized-integrations/) (v17.0.1 pages).
- [Configuration cheat sheet, v16.0](https://forgejo.org/docs/v16.0/admin/config-cheat-sheet/): `[webhook]` (`DELIVER_TIMEOUT` 5, `ALLOWED_HOST_LIST` external, `PAYLOAD_COMMIT_LIMIT` 15), `[api]`, `[oauth2]`, `cron.cleanup_hook_task_table` (168 hours), `[authorized_integration]`; no API rate-limit setting found.
- Forgejo source at tag `v16.0.5`: [`modules/webhook/type.go`](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/modules/webhook/type.go) (event types and their `X-Forgejo-Event` names), [`services/webhook/webhook.go`](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/services/webhook/webhook.go) (owner-level webhooks apply to all of an owner's repositories), [`services/webhook/deliver.go`](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/services/webhook/deliver.go) (single delivery attempt), [`services/webhook/shared/payloader.go`](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/services/webhook/shared/payloader.go) (`X-Forgejo-Signature`, `X-Forgejo-Event-Type`), [`models/webhook/hooktask.go`](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/models/webhook/hooktask.go) (a replay gets a new delivery ID).
- `https://git.guneet.dev`: `/api/v1/version`, `/api/v1/settings/api`, `/swagger.v1.json` (including the token endpoints) and the public organization list.
- The `workspace` repository's Forgejo setup notes and Forgejo and Musashi catalog entries (read-only background; their own check dates are cited where used).
