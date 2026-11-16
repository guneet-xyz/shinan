# Architecture and operations

Status: **draft for review** ([issue #11](https://github.com/guneet-xyz/shinan/issues/11)).
Updated with the owner's answers in [issue #25](https://github.com/guneet-xyz/shinan/issues/25).

This document describes how Shinan is built and run: the technology stack
(D-020), the parts of the system and how they talk, where data lives, how the
catalog's Markdown, its agent index and its Git mirror stay in sync (D-006), how
git host events come in, how agents and plugins reach Shinan, email, security
for a public app with sign-in (D-015), deployment on Musashi at
`shinan.guneet.dev` (D-016), self-hosting (D-012), observability, and the
accepted risk of having no backups.

It does not specify what the other documents own: catalog schema and conflict
rules, task rules, sign-in rules and token rules, git host event lists, MCP
tool lists or screens. It links to them instead (see
[Dependencies](#dependencies-on-other-documents)).

## How to read this document

Every statement is marked:

- **Decided**: follows from an accepted plan decision, or from an owner answer
  in [issue #25](https://github.com/guneet-xyz/shinan/issues/25), written
  "Decided (owner, O-n)". The [decision log](decisions/) maps O-n to decision
  records.
- **Proposed**: suggested here, with a reason.
- **Open**: not settled; listed under [Open questions](#open-questions).

Terms follow the [domain model and glossary](domain-model.md) (in review in
[PR #14](https://github.com/guneet-xyz/shinan/pull/14), read at `8bb5d65`). In
particular, a **Shinan installation** is one running copy of Shinan; a
**workspace** is a team's container inside it. "Sync" is used only for the
catalog Markdown, its index and its mirror; keeping up with git hosts is
**reconciliation**.

Sibling drafts were read at their latest commits on 2026-11-16 (catalog
`6613b55`, tasks `8d8e010`, identity `fcaea3a`, git hosts `87d9cf2`, agent
integrations `6bea8fb`, roadmap `6e4f795`). They were written before the
owner's answers; where they still differ, this document follows the answers and
lists the difference under [Dependencies](#dependencies-on-other-documents).

External facts were checked against primary sources on **2026-11-16**. Facts
about Musashi and its services come from the `workspace` repository's catalog at
revision `86bba32` and the Musashi infrastructure repository (`infra/musashi`) at
`29a8cba`, both read on 2026-11-16. Nothing was deployed, and no DNS or server
action was taken.

## Summary

| Area | Position |
|---|---|
| Stack | **Decided:** TypeScript, with a plain Node.js server and a React single-page app (owner, O-60, O-61). |
| Shape | One codebase and one container image, run as two processes: `web` (pages, API, MCP endpoint, webhook intake, live streams) and `worker` (background jobs). |
| Storage | PostgreSQL for everything, including the job queue. No Redis, no file storage in the first version. |
| Catalog (D-006) | **Decided:** each revision's Markdown text is the source of truth, stored in PostgreSQL, with an always-on, read-only Git mirror updated within seconds (owner, O-11, O-12). Changes are applied as text edits; the index is built only from stored text. |
| Git hosts | Webhooks are verified, stored and acknowledged at once, then processed by the worker. Reconciliation catches anything missed. Shinan's own GitHub writes use only the GitHub App installation token (owner, O-1, O-51). |
| Agents | A remote MCP endpoint at `/mcp`, a REST API for the CLI and plugins, and a server-sent event stream for nudge offers. Long-lived agent tokens sent as a bearer header (owner, O-44). All connections go out from the agent's machine. |
| Email | **Decided** that Shinan sends email from the first version, for magic links and invitations (owner, O-41, O-48). Proposed: generic SMTP; on `shinan.guneet.dev`, AWS SES through SMTP. |
| Security | Threat model and controls for a public app holding infrastructure details, with the owner's accepted risks stated plainly. |
| Musashi | A new `shinan` stack following Musashi's rules; deployed as needed, each deployment with its own approval (owner, O-83). |
| Backups | **Decided:** none built in, no backup target and no recovery objectives for now; an accepted risk (owner, O-62 to O-64). |

## 1. Requirements that shape the architecture

| Requirement | Source | Effect here |
|---|---|---|
| Catalog Markdown is the source of truth; the agent index is generated from it | D-006; owner, O-11 | [Section 5](#5-catalog-markdown-index-and-mirror) |
| Every fact has a state, source and last-checked time | D-007 | Stored in the Markdown; indexed for freshness queries |
| Task status is calculated from linked work and recorded events | D-005; owner, O-4 | Recalculated by the worker; never typed in |
| Agents connect from outside; no model runs in Shinan | D-008 | Shinan is an ordinary web service |
| GitHub and Forgejo first | D-009 | Webhook intake and reconciliation designed for both |
| Self-hostable | D-012 | One image plus PostgreSQL ([section 12](#12-self-hosting)) |
| MCP and skill, plugins, launcher later | D-014 | [Section 8](#8-how-agents-the-mcp-server-and-plugins-reach-shinan) |
| Public internet, sign-in required | D-015 | [Section 10](#10-security) |
| Runs on Musashi; every deployment approved by the owner | D-016; owner, O-83 | [Section 11](#11-deployment-on-musashi) |
| Shinan starts empty; the `workspace` repository's catalog stays the source of truth until migration | D-018 | Data loss before migration is survivable; see [section 14](#14-backups-accepted-risk) |
| Workspaces and invitations from the start | D-019 | Workspace-owned records carry their workspace ([3.4](#34-workspace-isolation)) |

## 2. Technology stack

### 2.1 Decided stack

**Decided (owner, O-60, O-61):** TypeScript; a plain Node.js server and a React
single-page app; no Next.js.

**Proposed** components, chosen with the reasons given:

| Part | Choice | Reason |
|---|---|---|
| HTTP server | A small Node.js framework, for example Fastify or Hono, picked when building | Serves the REST API, MCP endpoint, webhook intake and SSE streams as ordinary code. |
| Pages | React single-page app built with Vite, served as static files by the same server | Pages are behind sign-in, so server rendering adds little. |
| Database access | Drizzle ORM and migrations | Used by the owner's Walls and Dockyard. |
| Jobs | [pg-boss](https://github.com/timgit/pg-boss) (MIT) or [graphile-worker](https://github.com/graphile/worker) (MIT), both PostgreSQL-backed | No separate queue server. pg-boss adds jobs inside an existing transaction and has cron, retries with backoff and dead-letter queues (README, checked 2026-11-16). |
| Sign-in | [Better Auth](https://www.better-auth.com/docs), already used by Walls | Its docs (checked 2026-11-16) cover what the owner chose (O-41): GitHub sign-in, a Generic OAuth plugin for any OAuth 2.0 or OpenID Connect provider (for Forgejo instances), a magic link plugin, and email and password, hashed with scrypt. |
| MCP | Official TypeScript SDK, Tier 1 ([SDK list](https://modelcontextprotocol.io/docs/sdk), checked 2026-11-16) | Most complete SDK support. |
| CLI | TypeScript compiled to a single executable | Shares the API client with the plugin. |
| OpenCode plugin | TypeScript | OpenCode loads `.ts` and `.js` plugins ([docs](https://opencode.ai/docs/plugins/), checked 2026-11-16). |

**Proposed:** keep business logic and authorization in plain modules that do
not import the web framework. Reason: a framework change stays possible, and no
authorization lives only in framework middleware (the class of bug behind
Next.js's [CVE-2025-29927](https://github.com/vercel/next.js/security/advisories/GHSA-f82v-jwr5-mffw)).

**Open:** whether Better Auth's Generic OAuth plugin can add Forgejo instances
at run time, as "any self-hosted Forgejo instance" (O-41) needs, or only from
configuration. To be checked in a prototype.

### 2.2 Shared foundations

These hold regardless of library choices (**Proposed**):

- **PostgreSQL** as the only stateful component. Reason: one thing to monitor
  and upgrade; the owner already runs PostgreSQL for mon, Walls, Drawspace and
  easyshell on Musashi.
- **One container image, two process roles** (`web` and `worker`). Reason: one
  person maintains it, one artifact is easy to self-host, and slow git host
  calls and email sending never delay pages or webhook responses.
- **Server-sent events (SSE)** for live updates to browsers and plugins. Reason:
  one-way push over HTTPS is enough (clients send with normal requests), and
  Caddy flushes `text/event-stream` responses immediately
  ([Caddy `reverse_proxy` docs](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy),
  checked 2026-11-16).
- **Multi-architecture images** (`arm64` and `amd64`). Reason: Musashi is ARM64;
  most self-hosters use `amd64`.

### 2.3 Options considered

Kept as a record; the full comparison is in this PR's history and the decision
log.

| Option | Why not chosen |
|---|---|
| A: TypeScript with Next.js | Streams, MCP, webhooks and workers sit outside Next.js's model; more framework churn to patch. |
| B: Go with server-rendered pages | Two languages (the plugin must be TypeScript); richer UI is harder. |
| C: Elixir with Phoenix LiveView | Three languages; no official MCP SDK. |

## 3. System design

### 3.1 Components

```mermaid
flowchart LR
  subgraph OUT[Outside]
    B[Browser]
    GH[GitHub]
    FJ[Forgejo]
    MIR[(Git mirror repository)]
    SMTP[Email provider]
    subgraph AM[Agent machine]
      CT[Coding tool]
      PL[Plugin]
      CLI[CLI]
    end
  end
  subgraph SI[Shinan installation]
    C[Caddy, TLS]
    subgraph WEB[web process]
      UI[Pages]
      API[REST API]
      MCP[MCP endpoint /mcp]
      AUTH[Sign-in]
      WH[Webhook intake]
      SSE[Live streams]
    end
    WK[worker process]
    DB[(PostgreSQL: data, events, catalog, job queue)]
  end
  B --> C
  CT -->|MCP over HTTPS| C
  PL -->|reports, stream| C
  CLI --> C
  GH -->|webhooks| C
  FJ -->|webhooks| C
  C --> UI & API & MCP & AUTH & WH & SSE
  UI & API & MCP & AUTH & WH & SSE --> DB
  WK --> DB
  WK -->|API calls, reconciliation| GH & FJ
  WK -->|catalog commits| MIR
  WK -->|magic links, invitations| SMTP
```

| Component | Role | Status |
|---|---|---|
| Pages | The wiki, task pages, timeline, board and settings ([human experience](human-experience.md)). | Proposed |
| REST API | JSON over HTTPS for the CLI, plugins and the pages. | Proposed. Reason: one API for every client keeps behavior consistent. |
| MCP endpoint | Agent actions over MCP ([8.1](#81-mcp-server)). | Decided that it exists (D-014); location proposed. |
| Sign-in | GitHub, Forgejo, magic link and password sign-in; agent registration ([identity](identity.md)). | Methods decided (owner, O-41); design owned by identity |
| Webhook intake | Receives git host webhooks ([section 6](#6-git-host-intake-webhooks-and-reconciliation)). | Decided that webhooks are used (plan, Integration points). |
| Live streams | SSE for browsers (timeline updates) and plugins (nudge offers). | Proposed |
| Worker | Background jobs, including email and mirror pushes ([section 7](#7-background-jobs)). | Proposed |
| PostgreSQL | All data ([section 4](#4-storage)). | Proposed |

**Proposed:** pages, REST API and MCP endpoint all call one shared application
layer, which enforces permissions, applies the rules other documents set (for
example which sources may create nudges) and writes events. Reason: an action
must behave and be credited the same through every path, and a rule enforced in
one place cannot be bypassed through another.

### 3.2 Process model

**Proposed:** a "modular monolith". Modules (catalog, tasks, git hosts, agents,
identity, events, email) live in one codebase with clear boundaries, deployed
as one image and run as `web` and `worker`. A one-shot `migrate` command applies
database migrations before new code starts. Reason: separate services add
network calls, deployments and failure modes that one maintainer and a 2-vCPU
host do not need.

One `web` and one `worker` process are enough for the first version
(**Proposed**). Reason: one owner, a handful of agent sessions and webhook
traffic from a few dozen repositories. Both roles can run more copies later:
jobs are claimed safely by the queue, and live streams are fanned out through
PostgreSQL `LISTEN`/`NOTIFY`
([docs](https://www.postgresql.org/docs/current/sql-notify.html)).

### 3.3 Who calls what

| Caller | Endpoint | Credential | Status |
|---|---|---|---|
| Person in a browser | Pages, REST API, live stream | Sign-in session cookie | Methods decided (owner, O-41) |
| Coding tool (MCP) | `/mcp` | Agent token as `Authorization: Bearer` | Long-lived tokens decided (owner, O-44); transport proposed ([8.1](#81-mcp-server)) |
| CLI, plugin | REST API, plugin stream | The same agent token | Proposed |
| GitHub | Webhook intake, one app-level URL | The GitHub App's webhook secret | Proposed ([6.1](#61-webhook-intake)) |
| Forgejo | Webhook intake, one URL per Forgejo webhook | That webhook's secret | Proposed ([6.1](#61-webhook-intake)) |
| Worker, to GitHub | GitHub API | GitHub App installation tokens only | Decided (owner, O-1, O-51) |
| Worker, to Forgejo | Forgejo API | The connecting person's own Forgejo token, any scope | Decided (owner, O-53, O-54) |
| Worker, to the mirror | Git push | A credential for the mirror repository only | Proposed ([5.6](#56-the-git-mirror)) |
| Worker, to email | SMTP | SMTP credentials | Proposed ([section 9](#9-email)) |

Shinan never writes to a git host as a person and stores no per-person GitHub
tokens. Anything a person wants done on a git host is done by an agent on that
person's own machine (**Decided**, owner, O-1). On Forgejo, Shinan's own writes
appear as the person whose token the connection uses (owner, O-53).

### 3.4 Workspace isolation

The glossary lists what belongs to exactly one workspace (members, agents,
tasks, catalog, git host connections, events and more) and what sits outside
(the Shinan installation, person, git host account, git host, repository, work
item and coding tool).

- **Proposed:** repositories and work items are stored once per installation,
  outside workspaces. A workspace reaches them only through the repositories its
  git host connections cover. A repository can be covered by only one workspace
  in the first version (**Decided**, owner, O-59), so this gives the same
  isolation as per-workspace copies. Reason: one model shared with the glossary
  and the git hosts draft.
- **Proposed:** events, including events about work items, belong to the
  workspace whose connection produced them.
- **Proposed:** every workspace-owned table has a `workspace_id` column, and all
  reads and writes go through one data access layer that requires a workspace
  scope; repositories and work items are read only through a workspace's
  connection coverage. Reason: one enforcement point is easier to review and
  test.
- **Proposed:** automated tests that create two workspaces and assert nothing
  crosses between them, for every API and MCP action. Reason: a cross-workspace
  leak is the worst plausible bug here.
- Inside a workspace, every member sees everything, including work from private
  repositories; links to private repositories stay protected by the git host
  (**Decided**, owner, O-43). There is no restricted catalog level (**Decided**,
  owner, O-2).
- **Open:** whether to add PostgreSQL row-level security
  ([docs](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)) as a
  second barrier between workspaces.

### 3.5 Shinan installation

The glossary proposes **Shinan installation** for one running copy of Shinan and
names this document as its owner. **Proposed:** confirm the term, with these
details:

- An installation has one or more **installation operators**: people who run
  it. Being an operator does not make someone a member of any workspace. In the
  app, operators manage installation settings and see installation-level
  health (dead-lettered jobs, email delivery failures, mirror lag, connection
  health without workspace content). Operators **cannot purge** anything
  (**Decided**, owner, O-50).
- Operators with server access can read the database; Shinan cannot protect a
  workspace from its own operator. This is stated plainly.
- **Installation settings:** the email allowlist that decides who can have an
  account (**Decided**, owner, O-48; joining a workspace still needs an
  invitation); sign-in providers, including Forgejo instances; SMTP settings;
  which private network hosts outgoing requests may reach
  ([10.1](#101-threats-and-controls)); and the default mirror target.
- On `shinan.guneet.dev` the owner is the only installation operator and the
  only workspace owner.

## 4. Storage

### 4.1 PostgreSQL holds everything

**Proposed.** Search uses PostgreSQL full-text search
([docs](https://www.postgresql.org/docs/current/textsearch.html)) at first.
Reason: catalog and tasks are small text collections; a search engine would be a
second stateful component.

**Considered and not proposed:** SQLite. The `web` and `worker` processes write
at the same time, which SQLite handles less well, and the owner's practice on
Musashi is PostgreSQL.

**Proposed:** no file or blob storage in the first version. Reason: nothing
needs uploads; catalog pages are text and work items are links. **Open** until
[human experience](human-experience.md) and [catalog](catalog.md) confirm.

### 4.2 Kinds of data

| Data | Rebuildable if lost? | Retention | Status |
|---|---|---|---|
| Catalog revisions (the Markdown text) and catalog proposals | No, except the latest text and history from the Git mirror ([14](#14-backups-accepted-risk)) | Forever, except [purge](#44-purge) | Proposed |
| Agent index and all other catalog-derived data | Yes, from the stored Markdown ([5.2](#52-the-invariant)) | Replaced on each revision | Proposed |
| Tasks, subtasks, comments, progress updates, manual states, task flag definitions | No | Forever | Proposed |
| Workspaces, people, members, invitations, email allowlist, agents, token hashes, password hashes | No | Until deleted | Proposed |
| Events (the timeline) | Partly: git host events can be re-read by reconciliation within what each host's API returns | Forever, except purge | Proposed |
| Security log | No | Forever (**Decided**, owner, O-47); not purgeable | Proposed that it is not purgeable; see [4.4](#44-purge) |
| Repositories and work items (cached state) | Yes, by reconciliation | Kept while covered | Proposed |
| Raw webhook deliveries | Not needed after processing | 14 days, then deleted | Proposed. Reason: long enough to replay after a bug fix; follows "link, don't copy" (D-001). |
| Presence | No, but short-lived by nature | Current state plus presence events | Proposed |
| Job records, including sent email metadata | Not needed | 7 days after completion | Proposed. Reason: enough to debug recent failures. |
| GitHub App private key, webhook secrets, Forgejo tokens, mirror credential | No (must be re-entered) | Until removed | Proposed; encrypted, see [10.3](#103-secrets-and-credentials) |

### 4.3 Events

**Proposed:** one append-only events table. Rows are never updated or deleted
except by workspace deletion or [purge](#44-purge); corrections are new events,
as the glossary proposes. Each event records its origin (Shinan action, webhook,
reconciliation, plugin report, MCP call) and an idempotency key, so the same git
host change arriving by webhook and by reconciliation is stored once.

Derived views, such as task status and agent session presence, are recalculated
by the worker and stored as ordinary rows for fast reads (**Proposed**). Reason:
recalculating on every page view would be slow.

### 4.4 Purge

The glossary asks whether events can be redacted; the [catalog](catalog.md)
draft calls the operation **purge**. This document uses **purge** for all of it.

**Who:** only workspace owners can purge, including operational records about
their workspace (raw webhook deliveries, job records); installation operators
cannot purge (**Decided**, owner, O-50).

**How (Proposed):** one narrow operation for events, catalog revisions,
comments, progress updates, raw webhook deliveries and job records of one
workspace:

- The content is replaced by a marker. The record stays, with its time, kind,
  actor and subjects, so history keeps its shape.
- The purge is itself an event saying who purged what and why, without the
  removed content.
- Derived data (search text, agent index rows) is rebuilt in the same
  transaction, and the Git mirror's history is regenerated without the content
  ([5.6](#56-the-git-mirror)).
- Copies outside Shinan's control are reported, not assumed clean: clones of
  the mirror made earlier, and the host's own backups, if any. The purge screen
  says so.
- **Not purgeable:** the security log, which is kept forever (owner, O-47).
  Reason: a log that its subjects can erase proves little. It holds structured
  entries (actor, time, network address, action), not free text, so leaked
  secrets should not reach it.
- **Application logs** (process output collected by Docker) are outside the
  app's reach. They carry IDs, not workspace content (see
  [section 13](#13-observability)), so there is nothing to purge there.

Reason: "never edited" keeps history trustworthy, but a leaked secret or a
lawful deletion request must still be removable; a visible, attributed purge
keeps both. A secret that reached Shinan must also be rotated at its source.

## 5. Catalog Markdown, index and mirror

The [catalog document](catalog.md) owns the schema, fact format, catalog
proposals and their operations, conflict rules, approval classes (owner, O-3)
and the index format. This section owns how the text, the index and the mirror
are kept in step.

### 5.1 Decided

- Each catalog revision's Markdown text is the source of truth; everything else
  is rebuilt from it. Revisions are stored in **PostgreSQL**, with a
  **read-only Git mirror that is always kept current**: each change appears
  within seconds as a readable commit, for cloning, grep, history and exit
  (**Decided**, owner, O-11).
- Catalog proposals and review happen inside Shinan; the mirror is read-only
  (**Decided**, owner, O-12).
- Custom entity types are allowed in the first version; the eight built-in
  types are defaults (**Decided**, owner, O-17).

### 5.2 The invariant

**Proposed**; reason: this is what O-11 means in a system where changes arrive
as operations.

1. **The stored Markdown text of each revision is the source of truth. Nothing
   else is authoritative.** Every applied catalog revision is a set of Markdown
   documents. The agent index, search text, relation lists, freshness queries,
   the wiki's rendering and the Git mirror are derived from that text.
2. **Operations are applied as text edits.** Applying a catalog proposal's
   operation edits the previous revision's text, changing only the bytes it
   targets and leaving every other byte as it was. Shinan never renders a
   document anew from structured rows. Reason: otherwise the rows would be the
   real source of truth.
3. **The index is built only from stored text,** by parsing the full new text,
   never from the operations themselves.
4. **One transaction.** Writing the new text, replacing the entity's index rows,
   running the catalog's per-operation conflict check, appending the event and
   queuing the mirror push happen in one database transaction. If any step
   fails, nothing is applied.
5. **Round-trip test.** Automated tests, and a daily job on real data, check
   that text → parse → apply no operations → text is byte-for-byte unchanged,
   and that text → parse → index equals the stored index. Differences are
   reported as a metric and to the installation operator.
6. **Only the indexer writes the index,** and only the mirror job writes the
   mirror.

Custom entity types (O-17) do not change this: a workspace's type definitions
are themselves stored data that the same parser reads when validating and
indexing (**Proposed**).

### 5.3 How sync works

- **Every change is a new revision.** A revision stores the full text of each
  entity it changed, its author (actor and attribution), the catalog proposal
  it came from and the revision it was based on. The "based on" revision is for
  history and display; conflicts are decided per operation by the catalog's
  rules. **Proposed.** Reason: revision-level conflicts would make two agents
  rechecking different facts of one entity conflict all the time.
- **Parser versions and rebuilds.** Each index row records the parser version
  that produced it. When a release changes the parser, the worker rebuilds the
  index from the latest revisions, and the agent index reports that it is
  behind until done. **Proposed.**
- **Serving the agent index.** Every answer names the catalog revision it came
  from (catalog draft), so agents and plugins can cache and ask "what changed
  since revision N". **Proposed.**
- **Fact checks.** A recheck that changes only the last-checked time is still a
  text edit and a new revision, and also an event. **Proposed.** Reason: no fact
  data may live outside the text.

**Expected volume (estimate, not a measurement).** The `workspace` repository's
catalog is 36 files, about 124 KB, with 73 commits touching it in its first 10
days (read 2026-11-16). If each change rewrote two entities of about 4 KB, that
is under 25 MB of revision text a year; ten times more, from frequent rechecks,
is still well under a gigabyte. **Proposed:** store full text per revision; revisit
only if measured growth requires it.

### 5.4 Import

**Proposed:** a one-time importer reads a folder of Markdown with frontmatter,
such as the `workspace` repository's catalog, and creates catalog proposals for
review. When the `workspace` repository moves over is owned by the
[roadmap](roadmap.md) (D-018).

### 5.5 Why not Git as the store

Storing the text only in a Git repository that Shinan writes (option 5.1c in
review) was considered: it would need two stores kept consistent and a
catch-up path after a crash between commit and index. The owner chose
PostgreSQL plus an always-on mirror (O-11), which keeps one transaction for
text and index, and still gives files.

### 5.6 The Git mirror

**Decided:** always on and current within seconds for the owner's installation
(owner, O-11). The rest is **proposed**.

- **One mirror repository per workspace,** on a git host, private. The
  workspace owner sets it up; the target for `shinan.guneet.dev` is a
  [decision for the owner](#decisions-needed-from-the-owner).
- **One commit per applied catalog proposal,** pushed by the worker within
  seconds of the transaction that applied it. The commit contains the
  changed files in the repository layout the [catalog](catalog.md) draft
  defines, a generated message naming the proposal, its author, approver and
  catalog revision, and Shinan as committer. Reason: O-11 asks for each change
  as a readable commit; one per proposal matches what a reviewer saw.
- **Deterministic.** Commits are built only from stored revisions, with author
  and commit times taken from the revisions, so the whole mirror can be
  regenerated from the database and comes out identical. Reason: after a lost
  push, a restore or a purge, Shinan rebuilds the mirror instead of patching it.
- **Read-only.** The repository has a generated README saying it is generated
  and read-only, and branch protection allows only Shinan's credential to push.
  If the branch ever differs from what Shinan expects, Shinan overwrites it with
  the regenerated history and reports the event. Reason: edits belong in
  catalog proposals (O-12).
- **Purge** regenerates the mirror's history without the purged content and
  force-pushes it ([4.4](#44-purge)); earlier clones keep the content, and the
  purge screen says so.
- **Lag is visible.** The time since the last successful push is shown with
  catalog health and exported as a metric. Failed pushes retry with backoff.
  If the mirror is behind, the agent index and wiki still work; the mirror is a
  copy, not a dependency.
- **Credential:** one limited to the mirror repository (on GitHub, a deploy key
  with write access, which grants access to a single repository;
  [GitHub docs](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys),
  checked 2026-11-16). Not the GitHub App, whose permissions apply to every
  repository it is installed on. Reason: the narrowest credential that can push.
- **Who can read it:** anyone with access to that repository on the git host.
  Since every member sees the whole catalog (owner, O-2, O-43), repository
  access should match workspace membership; Shinan cannot enforce that, so the
  setup screen says so ([10.1](#101-threats-and-controls)).
- **Other installations:** a workspace setting, on by default once a target is
  configured. Reason: O-11 decides it for the owner's installation; others may
  not have a git host to push to.

## 6. Git host intake: webhooks and reconciliation

The [git host integrations](git-hosts.md) document owns which events matter,
connection methods, reconciliation layers and intervals, rate limits and
write-back. This section owns the machinery.

### 6.1 Webhook intake

**Proposed** pipeline:

1. **Endpoint.**
   - **GitHub:** a GitHub App has one webhook URL and one secret for all its
     installations, so Shinan has one URL, such as
     `https://shinan.guneet.dev/hooks/github`. The connection, and so the
     workspace, is found from `installation.id` after the signature is verified.
   - **Forgejo:** one URL per Forgejo webhook (owner-level for the owner's own
     accounts, per-repository elsewhere; owner, O-55), such as
     `https://shinan.guneet.dev/hooks/forgejo/<webhook-id>`, each with its own
     secret and belonging to one git host connection.
2. **Verify the signature** before parsing: GitHub's `X-Hub-Signature-256`
   ([GitHub docs](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries))
   and Forgejo's `X-Forgejo-Signature`
   ([Forgejo docs](https://forgejo.org/docs/latest/user/repository/webhooks/)),
   both HMAC-SHA256, checked 2026-11-16. Reject unsigned, wrongly signed or
   oversized requests.
3. **Route.** For GitHub, find the connection by `installation.id`; deliveries
   for unknown installations are recorded as a health warning and dropped.
4. **Store and acknowledge.** Save the raw delivery with its delivery ID, skip
   repeats, queue a processing job in the same transaction, and return `202`.
   Reason: GitHub fails a delivery after 10 seconds and does not redeliver
   automatically
   ([GitHub docs](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries));
   Forgejo's default timeout is 5 seconds
   ([config cheat sheet](https://forgejo.org/docs/latest/admin/config-cheat-sheet/)),
   both checked 2026-11-16.
5. **Process in the worker:** normalize into events and work item updates,
   idempotently, then queue follow-ups: recalculating task status, creating a
   task from an outside issue (D-003), or a `related` link from a member's
   mention of a task ID in a comment (owner, O-25). The handling rules are the
   git hosts and tasks documents'.
6. **Record health:** last valid delivery and last signature failure per
   connection.

### 6.2 Reconciliation

GitHub keeps deliveries for redelivery for only 3 days
([GitHub docs](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks),
checked 2026-11-16), and Forgejo does not retry. **Proposed** machinery (the
layers and intervals are the git hosts draft's):

- **Scheduled jobs per git host connection,** one per reconciliation layer, each
  with its own stored watermark.
- **Catch-up after downtime.** On start, the worker queues the right layers at
  once for any connection with a gap. Reason: an approved deployment restart
  should not leave silent gaps.
- **Same output as webhooks,** with the same idempotency keys.
- **Freshness recorded** per work item (display owned by
  [human experience](human-experience.md)).
- **Rate limits respected** by a per-connection limiter that reads the host's
  remaining-quota responses.

### 6.3 Writing back to git hosts

Shinan's own writes (for example backlinks; owner, O-56) run as worker jobs with
retries, never inside a web request (**Proposed**). On GitHub they use the
installation token only (owner, O-1). Reason: git host APIs can be slow, and a
click or an MCP call should not fail because of them.

## 7. Background jobs

**Proposed:** a PostgreSQL-backed job queue with these properties:

- Jobs are added in the same transaction as the change that needs them.
- Every job is safe to run twice (at-least-once delivery).
- Retries with backoff, then a dead-letter state visible to the installation
  operator, with a manual "retry".
- Scheduled jobs run once across all worker copies.

| Job | Trigger | Owner of the rules |
|---|---|---|
| Process webhook delivery | Webhook stored | [Git hosts](git-hosts.md) |
| Reconciliation layers | Schedule, startup gap, on demand | [Git hosts](git-hosts.md) |
| Recalculate task status, including subtasks (owner, O-21) | New event on linked work, a subtask or an agent session | [Tasks](tasks.md) |
| Create a task from an outside issue | Normalized issue event | [Tasks](tasks.md) |
| Write back to a git host | Task or work link change | [Git hosts](git-hosts.md) |
| Presence timeouts (`unresponsive`, `offline`, release after silence; owner, O-32) | Every minute | [Agent integrations](agent-integrations.md) |
| Offer and withdraw nudge deliveries | A nudge is created or withdrawn | [Tasks](tasks.md), [agent integrations](agent-integrations.md) |
| Push the catalog mirror | Catalog proposal applied | This document ([5.6](#56-the-git-mirror)) |
| Rebuild or verify the agent index (round-trip test) | Release, daily | This document ([5.2](#52-the-invariant)) |
| Send email (magic links, invitations) | Sign-in or invitation request | This document ([section 9](#9-email)); content by [identity](identity.md) |
| Automatic fact checks by Shinan, if adopted | Schedule | [Catalog](catalog.md), [git hosts](git-hosts.md) |
| Prune raw webhooks and old job records | Daily | This document ([4.2](#42-kinds-of-data)) |

## 8. How agents, the MCP server and plugins reach Shinan

The [agent integrations](agent-integrations.md) document owns tools, the skill,
presence and nudge semantics; [identity](identity.md) owns agent registration,
scopes and revocation. This section owns transport, how tokens reach the
endpoints, and network shape.

**Proposed:** every agent-side component makes **outgoing HTTPS connections** to
Shinan; Shinan never connects into an agent's machine. Reason: agent machines
sit behind NAT, firewalls or tailnets. The agent-facing parts of
`shinan.guneet.dev` are public behind tokens (**Decided**, owner, O-45).

### 8.1 MCP server

- **Hosted, not installed (Proposed).** Shinan serves MCP at
  `https://shinan.guneet.dev/mcp` over Streamable HTTP. The CLI can also act as
  a local stdio MCP server that forwards to the API, for coding tools without
  remote MCP support.
- **Protocol versions (Proposed).** The current MCP revision is 2026-07-28,
  which removed protocol-level sessions and the GET stream
  ([spec](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http.md),
  checked 2026-11-16). OpenCode connects with the older `initialize` handshake
  by default (`protocol: "legacy"`)
  ([OpenCode MCP docs](https://opencode.ai/docs/mcp-servers/), checked
  2026-11-16). So the endpoint supports both 2026-07-28 and 2025-11-25.
- **Statelessness (Proposed).** No per-connection state; everything a call needs
  is in the request and the database.
- **Tokens.** Agent tokens are long-lived and last until revoked (**Decided**,
  owner, O-44). An agent is per person, coding tool and machine (**Decided**,
  owner, O-40), so each machine's coding tool has its own agent and token.
  **Proposed:**
  - The token is obtained once per agent through identity's browser-approval
    registration, run by the plugin or the CLI in the shape of the OAuth device
    authorization grant (RFC 8628: show a link and short code, the person
    approves in the browser, the tool receives the token). Better Auth has a
    device authorization plugin that implements this grant (docs, checked
    2026-11-16). Reason: agent integrations needs one approval to cover the
    plugin, MCP and the CLI on a machine, and headless runs (the agent integrations draft notes that Claude Code's
    `claude -p` cannot run an OAuth flow).
  - The token reaches the MCP endpoint as an `Authorization: Bearer` header.
    OpenCode supports this with `oauth: false` and a `headers` entry that reads
    an environment variable (OpenCode MCP docs above). Installing the plugin
    also sets up MCP and the skill (owner, O-36), so the plugin writes that
    configuration without putting the token itself in a project file.
  - **MCP's OAuth authorization flow is not used in the first version.** Reason:
    with long-lived tokens (O-44) there is nothing to refresh, the device-style
    registration already covers every component on a machine, and acting as a
    full OAuth authorization server is extra attack surface.
- **Required checks.** Validate the `Origin` header and check that
  `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` match the request body, as
  the 2026-07-28 transport requires; reject tokens in query strings.
- **Trust labels on text (Proposed).** Every text field an MCP answer returns
  carries a machine-readable field saying who wrote it (member, agent, outside
  actor, Shinan) and whether it may be treated as an instruction. Field names
  and skill wording are owned by [agent integrations](agent-integrations.md).
- **Session IDs are hints, never credentials.** OpenCode sends its session ID in
  `_meta["ai.opencode/sessionID"]` and documents that it must not be used for
  authentication. Matching calls to agent sessions follows the owner's answer
  (O-29) and is owned by agent integrations.

### 8.2 CLI

**Proposed:** the CLI uses the same agent token, stored as
[agent integrations](agent-integrations.md) and identity decide (the machine's
credential store preferred), and never accepts it as a command-line argument.
Reason: command lines are visible to other processes and end up in shell
history.

### 8.3 Plugins

**Proposed** transport for the OpenCode plugin (and later others); the delivery
states and the "one owner at a time" rules are the agent integrations draft's:

- **Reports go up as normal requests.** Presence changes and heartbeats are
  POSTed with the agent session ID and a sequence number, so repeats and
  reordering are harmless. Shinan accepts only allow-listed metadata
  (**Decided**, owner, O-34).
- **One stream per agent on a machine.** The plugin keeps one SSE stream per
  agent token, carrying offers for all of that agent's sessions on the machine,
  including subagents, each of which is its own agent session (**Decided**,
  owner, O-37). Reason: a stream per session would multiply connections as
  subagents start and stop.
- **Offers, withdrawals and answers.** The stream carries nudge offers and
  withdrawals. The plugin answers each (accepted, rejected, withdrawal
  confirmed, delivered, cancelled in the tool) with a POST. Deliveries are rows
  in the database; the stream only announces changes. If the stream drops, the
  plugin reconnects with backoff and receives every offer still open. Streams
  drop on network changes and whenever the `web` process or Caddy restarts; on
  Musashi a Caddyfile change reaches the proxy only through a restart or
  recreation (ingress catalog entry). Reason: answers stored server-side
  survive all of these; IDs prevent doubles.
- **Keep-alives** every 30 seconds (**Proposed**; a starting value).
- **Presence evidence.** Heartbeats and the stream feed the presence timeouts
  (owner, O-32; thresholds owned by agent integrations).

### 8.4 Launcher (phase 3)

Users register hardware by installing the launcher on it, and a setup guide for
such devices (VM, MacBook, and so on) is provided (**Decided**, owner, O-1).
**Proposed:** the launcher follows the same pattern as plugins: an outgoing
stream for start requests, with its own credential from identity. Reason: no
inbound ports on users' machines. Details belong to phase 3.

## 9. Email

Shinan sends email from the first version, for magic-link sign-in and
invitations (**Decided**, owner, O-41, O-48). What the messages say, link
lifetimes and who may receive them are owned by [identity](identity.md).

### 9.1 How Shinan sends

**Proposed:**

- **Generic SMTP only,** with STARTTLS or TLS required, configured by the
  installation operator. Reason: every provider offers SMTP, so self-hosters
  need nothing Shinan-specific, and one code path is easier to secure.
- **Sent by the worker,** queued in the same transaction as the sign-in or
  invitation request and picked up at once (`LISTEN`/`NOTIFY`). Reason: the
  provider's latency or outage must not block the web request.
- **Only to allowlisted addresses.** A magic link is sent only if the address is
  on the installation's allowlist (O-48), and the page answers the same either
  way. Reason: stops the sign-in form from being used to send mail to anyone,
  and does not reveal who has an account.
- **Throttled** per address and per network address. Reason: limits floods and
  cost.
- **Delivery recorded.** Each message's outcome (accepted by the provider,
  rejected) is recorded without its body, and failures show as installation
  health. Bounces after acceptance are not handled in the first version.
- **If email is down,** password and git host sign-in still work (O-41).

### 9.2 Options for `shinan.guneet.dev`

| Option | What it takes | For | Against |
|---|---|---|---|
| **A. AWS SES over SMTP** (recommended) | A dedicated IAM user with only `ses:SendRawEmail` for one From address on the already verified `guneet.dev` identity, following path A and the SMTP variant of the `workspace` repository's SES sender onboarding runbook; SMTP password derived from its key; stored in Obscuro | The domain, DKIM, MAIL FROM and production access already exist; Walls, easyshell and Drawspace already send through SES | The runbook's SMTP variant is documented but not yet exercised (runbook, verified 2026-11-07); no bounce handling configured yet (email catalog entry) |
| B. AWS SES through its API | As A, with `ses:SendEmail`; Shinan adds an SES-specific sender | Path proven by Walls (email catalog entry) | A second code path just for this installation |
| C. Another provider over SMTP | A new account and DNS records | Independent of AWS | New vendor, new DNS changes through Terraform |

**Proposed: A**, with From `shinan@guneet.dev` (any local part on `guneet.dev`
is sendable, per the runbook). Reason: reuses a verified sender with the
narrowest credential, keeps Shinan's single SMTP path, and follows the
runbook's rule of a dedicated IAM user rather than the shared `mail` key.
Listed under [Decisions needed](#decisions-needed-from-the-owner). Creating the
IAM user is an owner action in the AWS console.

## 10. Security

Shinan holds infrastructure details and is on the public internet (**Decided**,
D-015). Sign-in, roles, token and access rules are owned by
[identity](identity.md). This section owns the platform controls and states the
owner's accepted risks.

### 10.1 Threats and controls

| Threat | Controls | Status |
|---|---|---|
| A person's account is taken over | Sign-in by GitHub, Forgejo, magic link or password, with no second factor (**Decided**, owner, O-41). Controls here: an email allowlist (O-48); throttling of sign-in and magic-link requests; passwords hashed with scrypt (Better Auth); sign-in session cookies `HttpOnly`, `Secure`, `SameSite`; uniform answers | **Accepted risk:** without a second factor, one guessed or reused password, one compromised mailbox, or one compromised git host account opens the account |
| An agent token is stolen from a machine | Long-lived until revoked (**Decided**, owner, O-44). Controls: hashes only in storage; a recognizable prefix for leak scanning; per-machine agents (O-40) so one machine is revoked alone; "last used" shown; never logged; header only | **Accepted risk:** a stolen token works until someone notices and revokes it |
| Forged or replayed webhooks | HMAC verified before parsing, unique delivery IDs, size limits ([6.1](#61-webhook-intake)) | Proposed |
| One workspace sees another's data | [3.4](#34-workspace-isolation) | Proposed |
| Text written by strangers steers an agent (prompt injection) | Outside issues become tasks automatically (D-003), so text from anyone reaches agents through MCP. Controls: (1) outside text never creates nudges ([tasks](tasks.md)), enforced in the shared application layer; (2) machine-readable trust labels ([8.1](#81-mcp-server)); (3) an agent cannot claim or act on a task in `triage` until a member accepts it; (4) the skill tells agents to treat outside text as data. Mentions by outside accounts are ignored (owner, O-25) | (1), (4) from sibling documents; (2), (3) proposed here, (3) needs [tasks](tasks.md) to adopt it |
| An agent is steered into leaking what it reads | Every member, and so every member's agent, can read the whole workspace (owner, O-2, O-43). Injected text could get an agent to post infrastructure details on a public issue with its own git host credentials. Controls: read-only agent tokens where writing is not needed ([identity](identity.md)); bulk reads in the security log; trust labels; no secrets in the catalog (owner, O-2; the catalog only records where a secret lives) | Residual risk while agents share their person's git host account (D-017) |
| A Forgejo token with broad rights leaks | Shinan accepts any Forgejo token (**Decided**, owner, O-54). A site administrator's broad token can act as any user on that Forgejo; the owner is a site administrator of `git.guneet.dev`. Controls: encrypted at rest, usable only by the worker ([10.3](#103-secrets-and-credentials)), never shown again, never logged, never given to agents | **Accepted risk:** whoever gets the database and the worker's key gets that power |
| The Git mirror leaks the catalog | Private repository; push credential limited to it; setup screen says repository access should match workspace membership; no secrets in the catalog (O-2) | Proposed; access on the git host is outside Shinan's control |
| Email is abused | Magic links only to allowlisted addresses; throttling; uniform answers ([9.1](#91-how-shinan-sends)) | Proposed |
| Malicious Markdown or HTML in the wiki | Raw HTML stripped or sanitized; strict Content Security Policy | Proposed |
| Shinan tricked into calling internal addresses | Git host and Forgejo sign-in addresses are entered by people. Outgoing requests to private, loopback and link-local addresses are refused unless the installation operator allows a specific host | Proposed. Reason: on Musashi, private addresses reach other services |
| Cross-site request forgery | Same-site cookies plus a CSRF token or origin check on state-changing requests | Proposed |
| Vulnerable dependencies | Lockfiles; automated update PRs; critical advisories patched within 7 days; images rebuilt on base image updates | Proposed |
| Tampered CLI or plugin | Releases publish checksums and build provenance attestations ([12](#12-self-hosting)) | Proposed |
| Container compromise spreading | Non-root, read-only root filesystem, `cap_drop: ALL`, `no-new-privileges`, no Docker socket, no host ports, database on an internal-only network ([11.2](#112-shinan-stack)) | Proposed |
| Another service on Musashi is compromised | `monitoring-agent` and `mon-private-agent` have owner-approved root-equivalent access through the Docker socket; if either is compromised, Shinan's secrets and data are exposed | Residual risk of sharing the host |
| Abuse and floods | Per-IP and per-token rate limits; request size limits | Proposed |
| Undetected misuse | Every write is an event credited to an actor; the security log, kept forever (owner, O-47) | Log owned by identity |

**Proposed:** a written security checklist covering this table must pass before
the first public deployment, and again before the `workspace` repository's
catalog moves over. The [roadmap](roadmap.md) owns where these gates sit.

### 10.2 Web hardening

**Proposed:** HTTPS only with HSTS; a Content Security Policy without inline
scripts; `frame-ancestors 'none'`; a strict `Referrer-Policy`; no sensitive data
in URLs; uniform, generic error pages; no stack traces to clients. Nothing is
served without sign-in except the sign-in and invitation pages, the magic-link
landing page and the webhook and MCP endpoints, which need their own
credentials.

### 10.3 Secrets and credentials

- **Installation secrets** (database password, session signing key, data
  encryption keys, SMTP credentials, GitHub App client secret for sign-in) come
  from environment variables or `*_FILE` variables; on Musashi, from Obscuro.
  **Proposed.** Reason: Musashi's rule that secrets come only from Obscuro, and
  any secret manager works for self-hosters.
- **Credentials that act on git hosts** (the GitHub App private key, Forgejo
  tokens, the mirror credential) and webhook secrets are encrypted in the
  database. **Proposed:** the `web` process encrypts new ones with a public key
  and only the `worker` holds the private key to use them. Reason: Forgejo
  tokens may carry site-administrator rights (O-54); a flaw in the
  internet-facing `web` process should not expose them. Webhook verification in
  `web` needs only the webhook secrets, which are encrypted separately with a
  key `web` holds.
- **Agent tokens and passwords** are stored as hashes only.
- **Logs** never contain tokens, cookies, magic links, webhook bodies or
  Authorization headers.
- **People type secrets** (for example a Forgejo token) into Shinan's settings
  pages; agents never handle them. Reason: the `workspace` repository's rule
  that secrets never pass through agents, issues or files.

### 10.4 Extra sign-in layer

No identity-aware proxy in front of the pages in the first version (**Decided**,
owner, O-68).

## 11. Deployment on Musashi

`shinan.guneet.dev` runs on Musashi (**Decided**, D-016). Shinan is deployed as
needed, each deployment with its own approval (**Decided**, owner, O-83). This
is a plan only: carrying it out needs the approvals in
[11.6](#116-what-needs-deployment-approval).

### 11.1 Facts about Musashi that matter

From the `workspace` repository's catalog and `infra/musashi` (read 2026-11-16):

- Azure VM, ARM64, 2 vCPU, 8 GiB RAM, no swap; 32 containers running on
  2026-11-14.
- Docker data on the 128 GiB data disk at `/mnt`; the 30 GiB root disk 93% full
  on 2026-11-13.
- Docker's default address pools are exhausted; every new Compose network needs
  an explicit subnet; `10.88.10.0/24` to `10.88.13.0/24` are taken.
- Stacks live in `stacks/<name>/`, run with
  `obscuro run -n <name> -- docker compose up -d`. No environment files, no host
  ports, stack-local binds only, one `caddy-public-<app>` proxy bridge per public
  app, owned by public Caddy. Private bridges do not block outgoing internet
  access unless an egress restriction is approved.
- Images come from `cr.guneet.dev` (Dockyard, also on Musashi), pinned by
  digest. mon and easyshell images are pulled anonymously from public projects.
- DNS for `guneet.dev` is owned by the Terraform project's guarded workflow;
  `tools.guneet.dev` and `mon.guneet.dev` are CNAMEs to `musashi.guneet.xyz`.
- Fleet backups are paused and Musashi's backup tooling was retired.
- Fleet metrics run on Musashi, tailnet-only, with no alerting yet.

### 11.2 Shinan stack

| Service | Role | Networks |
|---|---|---|
| `shinan-db` | PostgreSQL, data in `./postgres` (stack-local, ignored by Git) | `shinan-backend` |
| `shinan-migrate` | One-shot: runs migrations, then exits | `shinan-backend` |
| `shinan-web` | Pages, API, MCP, sign-in, webhooks, streams | `caddy-public-shinan`, `shinan-backend`, `shinan-egress` |
| `shinan-worker` | Jobs, reconciliation, mirror pushes, email | `shinan-backend`, `shinan-egress` |

| Network | Created by | Subnet | Outgoing internet | Members |
|---|---|---|---|---|
| `caddy-public-shinan` | Public Caddy stack | Fixed `/24`, chosen at deployment | Docker default | `caddy-public`, `shinan-web` |
| `shinan-backend` | `shinan` stack | Fixed `/24` | None (`internal: true`) | All four services |
| `shinan-egress` | `shinan` stack | Fixed `/24` | Yes | `shinan-web` (sign-in with GitHub and Forgejo), `shinan-worker` (git host APIs, mirror pushes, SMTP) |

- `shinan-backend` is internal, with no internet access (**Decided**, owner,
  O-67); mon-public uses the same internal-plus-egress pattern.
- **Proposed:** names follow Musashi's rules; three fixed `/24` subnets from the
  unused `10.88.0.0/16` range, recorded in the machine entry at deployment.
- **Proposed** starting memory limits: web 512 MiB, worker 384 MiB, PostgreSQL
  512 MiB; estimates to be measured during the proof of concept.
- **Proposed:** containers hardened as in [10.1](#101-threats-and-controls); the
  same image and reference Compose layout self-hosters get, adapted to
  Musashi's rules. Reason: proves the self-hosting path by using it.

### 11.3 DNS and ingress

- **Proposed:** `shinan.guneet.dev` as a CNAME to `musashi.guneet.xyz`, through
  the Terraform project's guarded DNS workflow.
- **Proposed:** a public Caddy route to `shinan-web`, with certificates from the
  existing Cloudflare DNS challenge. Adding the bridge needs one coordinated
  recreation of public Caddy, briefly interrupting all public sites on Musashi.
- **Open:** whether Forgejo, also on Musashi, can deliver webhooks to
  `shinan.guneet.dev`. Forgejo allows only public targets by default
  (`ALLOWED_HOST_LIST = external`), and Musashi reaching its own public address
  through Azure is untested. Reconciliation covers the gap meanwhile.

### 11.4 Building and releasing

**Proposed** flow:

1. Work merges to `main` of the private `guneet-xyz/shinan` repository through
   reviewed PRs; GitHub Actions runs tests (with PostgreSQL) on every PR.
2. A release (release-please, as mon and Walls use) builds `arm64` and `amd64`
   images on native runners and pushes them to a private `shinan` project on
   `cr.guneet.dev` with build provenance attestations, using a project-scoped
   push key in GitHub secrets (mon's model). The CLI and plugin are released
   with checksums and attestations. GitHub offers `ubuntu-24.04-arm` runners to
   private repositories, drawing on included minutes and then per-minute
   charges
   ([GitHub docs](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
   checked 2026-11-16).
3. A PR to `infra/musashi` pins the new digests and updates the stack README.
   Changing Compose files does not deploy anything (Musashi's rules).
4. When a release is needed on Musashi, the owner gives deployment approval for
   that deployment (owner, O-83), naming revision, impact, checks and rollback.
5. The deploying agent takes a pre-deployment database dump to the data disk,
   runs `migrate`, then `web` and `worker`, checks health and records evidence.

- Musashi pulls with a project-scoped pull key stored in Obscuro (**Decided**,
  owner, O-66).

### 11.5 Migrations and rollback

- **Proposed:** migrations are forward-only and backward-compatible for one
  release ("expand, then contract"), so rolling back means pinning the previous
  image digests.
- **Proposed:** a migration that cannot be backward-compatible is called out in
  the approval request, with the pre-deployment dump as its rollback. Reason:
  matches the owner's practice for Drawspace and Walls (a snapshot before a
  migration). This dump is a rollback point for one deployment, kept until the
  next successful one, not a backup (see [section 14](#14-backups-accepted-risk)).

### 11.6 What needs deployment approval

Each item changes a real deployment or a live credential and needs the owner's
approval before it happens (**Decided** for deployments, D-016, O-83; the list
is **Proposed**). None of it is done by this document.

| Item | Kind |
|---|---|
| First start of the stack and every later deployment | Deployment |
| DNS record `shinan.guneet.dev` | DNS change through Terraform |
| Public Caddy route and `caddy-public-shinan` bridge (one Caddy recreation) | Deployment |
| `shinan-backend` internal network (approved in principle, O-67) | Deployment |
| Obscuro namespace `shinan` and its secrets (the owner types the values) | Credentials |
| Registry project, push key in GitHub secrets, pull key on Musashi | Credentials |
| Registering the GitHub App and installing it on `guneet-xyz` | Credentials ([git hosts](git-hosts.md)) |
| GitHub sign-in credentials and Forgejo sign-in registration on `git.guneet.dev` | Credentials ([identity](identity.md)) |
| Forgejo token and webhook | Credentials ([git hosts](git-hosts.md)) |
| SES IAM user and SMTP credentials | Credentials ([9.2](#92-options-for-shinanguneetdev)) |
| Mirror repository, its branch protection and push credential | Credentials ([5.6](#56-the-git-mirror)) |
| Metrics scraping by Musashi's monitoring agent (O-69) | Deployment of the monitoring stack |

## 12. Self-hosting

Shinan is self-hostable by design (**Decided**, D-012). Distribution waits on
licensing (D-013); this section makes sure nothing blocks it. All **proposed**:

- **Artifact:** one multi-architecture image, a reference Compose file
  (PostgreSQL, migrate, web, worker), an operator guide, and the CLI and plugin
  with published checksums and attestations.
- **Requirements:** PostgreSQL (supported major versions listed per release), an
  HTTPS reverse proxy, an SMTP provider for magic links and invitations, a
  public URL if webhooks are wanted, and a git host repository per workspace for
  the mirror if wanted.
- **Configuration:** environment variables, with `*_FILE` variants for secrets.
- **Reconciliation-only mode:** an installation git hosts cannot reach still
  works, with freshness limited to the reconciliation intervals.
- **First start:** the first person is created through a one-time setup link
  printed to the installation's own log, and the email allowlist starts with
  that person. Reason: only someone with server access can claim a fresh
  installation.
- **GitHub App per installation,** registered through GitHub's manifest flow
  (git hosts draft).
- **Installation operator:** see [3.5](#35-shinan-installation).
- **No telemetry:** a self-hosted installation never contacts the Shinan project.
- **Backups:** none built in (owner, O-62); the operator guide says plainly that
  the operator must back up PostgreSQL and the encryption keys.
- **Upgrades:** `migrate` runs on every upgrade; release notes state the minimum
  version that can be upgraded from directly.

## 13. Observability

**Proposed:**

- **Logs:** structured JSON to standard output, with a request ID on every line,
  IDs instead of content, and secrets removed ([10.3](#103-secrets-and-credentials)).
- **Health endpoints:** liveness and readiness (database reachable, migrations
  current), served only inside the container network.
- **Metrics:** Prometheus-format metrics on an unpublished internal port,
  scraped by Musashi's monitoring agent into VictoriaMetrics and Grafana
  (**Decided**, owner, O-69). Key metrics: request rates and errors by route type
  (pages, API, MCP, sign-in, webhooks), webhooks received and rejected per
  connection, time since the last webhook and reconciliation per connection,
  job queue depth and oldest job age, dead-lettered jobs, email sent and failed,
  mirror lag, open plugin streams, agent sessions by presence state, round-trip
  test failures and database size.
- **In-app status:** connection health and mirror lag for workspace owners;
  email failures and dead-lettered jobs for the installation operator.
- **External uptime:** a website tile for `shinan.guneet.dev` on the private mon
  board.
- **Alerting: Open.** The fleet has no alerting yet.
- **Error tracking:** no third-party service by default; errors are logs plus
  metrics.

## 14. Backups: accepted risk

**Decided (owner, O-62, O-63, O-64):** no built-in backups, no backup target and
no recovery objectives for now. Shinan relies on host-level backups, which are
currently paused on Musashi. This is an accepted risk.

What it means today:

- If Musashi's data disk is lost, Shinan's database is lost: tasks, comments,
  catalog proposals and history, members, agents and the security log.
- What comes back: the catalog's latest text and its history from the Git
  mirror, if the mirror is hosted off Musashi ([5.6](#56-the-git-mirror)); and
  git host data through reconciliation. Git host credentials, webhook secrets
  and agent tokens would have to be set up again.
- During the trial this loss is survivable for the catalog, because the
  `workspace` repository's catalog stays the source of truth (D-018). It is not
  survivable for the trial projects' cross-project coordination, which moves
  into Shinan during the trial (**Decided**, owner, O-73).
- The [roadmap](roadmap.md) records this as a consideration before the
  `workspace` repository's migration, when Shinan becomes the only copy (owner,
  O-62).
- Restore tests, if run, use a temporary local-only installation on Daedalus
  (**Decided**, owner, O-65).

## 15. Environments and testing

- **Local development (Proposed):** the reference Compose file with seeded test
  workspaces, fake webhooks and a local mail catcher. Not a deployment.
- **Automated tests (Proposed):** unit tests, database tests against real
  PostgreSQL, the catalog round-trip test, mirror regeneration tests (identical
  history from the same revisions), workspace-isolation tests, webhook
  signature, routing and idempotency tests with recorded payloads, and an MCP
  conformance test against both supported protocol revisions.
- **Staging (Proposed):** none in the first version. Reason: a deployed staging
  environment also needs deployment approval, and the proof of concept is
  low-risk while the `workspace` repository remains the source of truth.

## Dependencies on other documents

| Document | What this document needs from it, and known differences |
|---|---|
| [Domain model and glossary](domain-model.md) | Terms used throughout. Should confirm "Shinan installation" and its operator ([3.5](#35-shinan-installation)) and adopt **purge** as the answer to its redaction question ([4.4](#44-purge)). Its draft (`8bb5d65`) predates O-17, O-21, O-37 and O-40. |
| [Catalog](catalog.md) | Operations applied as text edits ([5.2](#52-the-invariant)); per-operation conflicts; mirror repository layout; custom type definitions (O-17). Its draft (`6613b55`) predates O-2 (restricted level removed) and O-11 (always-on mirror instead of optional export). |
| [Tasks and work](tasks.md) | Status rules including subtasks (O-21); nudge sources; adopting "agents cannot claim tasks in `triage`" ([10.1](#101-threats-and-controls)). |
| [Identity, agents and permissions](identity.md) | Sign-in design for O-41 (no passkeys) and the email allowlist (O-48); registration flow for long-lived tokens (O-44); purge rights (O-50); security log kept forever (O-47) and what that means for deletion requests; Forgejo sign-in on any instance. Its draft (`fcaea3a`) predates these answers (passkeys, short-lived tokens, one-year log, no email). |
| [Git host integrations](git-hosts.md) | GitHub App, installation token only (O-1, O-51); the person's own Forgejo account and any token (O-53, O-54); webhooks per O-55; reconciliation layers; mentions creating `related` links (O-25). Its draft (`87d9cf2`) predates O-53 and O-54 (separate `shinan` account, repository-limited tokens). |
| [Agent integrations](agent-integrations.md) | Stream offers and answers ([8.3](#83-plugins)); trust label fields; the plugin writing MCP configuration (O-36); token storage on machines. Its draft (`6bea8fb`) predates O-37 (subagents as their own sessions) and O-40. |
| [Human experience](human-experience.md) | Pages; how freshness, connection health and mirror lag are shown. |
| [Roadmap and migration](roadmap.md) | The no-backup risk before migration (O-62); security checklist gate; deploying as needed (O-83). Its draft (`6e4f795`) predates O-62 and O-83 (backups in scope, weekly release train). |
| [Decision log](decisions/) | Records for the O-n answers cited here, and for the two decisions below once made. |

## Open questions

1. **Row-level security.** Add PostgreSQL row-level security as a second
   workspace barrier? ([3.4](#34-workspace-isolation))
2. **Forgejo webhooks on the same host.** Can Forgejo on Musashi deliver to
   `shinan.guneet.dev`? Needs a test after deployment approval.
   ([11.3](#113-dns-and-ingress))
3. **Alerting.** How does the owner learn about failed mirror pushes, email
   failures or stalled reconciliation while the fleet has no alerting?
   ([section 13](#13-observability))
4. **Forgejo sign-in on any instance.** Can Better Auth add Forgejo instances at
   run time? Settle in a prototype. ([2.1](#21-decided-stack))
5. **Security log and deletion requests.** The log is kept forever (O-47) and is
   not purgeable here; how a person's deletion request is handled is for
   [identity](identity.md). ([4.4](#44-purge))
6. **Resource use.** Real memory, disk and revision growth on Musashi, measured
   during the proof of concept. ([11.2](#112-shinan-stack), [5.3](#53-how-sync-works))
7. **CI cost.** GitHub Actions minutes for ARM64 builds in a private repository.
8. **Uploads.** Confirm no attachments are needed in the first version.
9. **Retention numbers.** Raw webhooks 14 days, job records 7 days.
10. **Public pages.** If any page must be readable without sign-in, the
    single-page app needs server rendering for it.

## Decisions needed from the owner

| # | Decision | Recommended option | Reason |
|---|---|---|---|
| 1 | Where the always-on Git mirror for `shinan.guneet.dev` lives (O-11) | A private GitHub repository under `guneet-xyz`, pushed with a write deploy key for that repository only | It is the only copy of the catalog off Musashi while there are no backups (O-62); a Forgejo repository would sit on the same machine. |
| 2 | Email provider for `shinan.guneet.dev` (O-41, O-48) | AWS SES over SMTP from `shinan@guneet.dev`, with a dedicated send-only IAM user per the SES runbook | Reuses the verified `guneet.dev` sender with the narrowest credential and keeps Shinan's single SMTP path. |
