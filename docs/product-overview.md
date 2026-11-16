# Product overview

Status: **draft for review** ([issue #4](https://github.com/guneet-xyz/shinan/issues/4)).

This document owns Shinan's vision, users, scope, non-goals and positioning
against competitors. It does not specify how anything works; each pillar links
to the document that owns it. Terms follow the
[domain model and glossary](domain-model.md).

## How to read this document

Every statement is marked:

- **Decided**: follows from an accepted decision or from approved plan content
  (pillars, integration points, phases, non-goals) in the [plan](plan.md),
  which is cited and carries the reason.
- **Proposed**: suggested here, with a reason. The owner confirms or changes it.
  Items that set direction for other documents or go beyond the plan are also
  listed under [decisions needed from the owner](#decisions-needed-from-the-owner).
- **Open**: not settled. Listed under [open questions](#open-questions) or
  [decisions needed from the owner](#decisions-needed-from-the-owner).

Facts about other products were checked on **2026-11-16** against the sources
listed under [sources](#sources), unless another date is given. Products in this
market change monthly, so these facts go stale quickly.

## Summary

Shinan is the place where the story of work and the context behind it live,
for teams where coding agents do much of the work and people set direction
(**Decided**, plan section 1). It has two halves:

- a **catalog**: a trusted record of what the team runs and works on, kept
  accurate by agents as part of their work, readable by people as a wiki, where
  every fact shows its state, source and last-checked time (D-006, D-007);
- **tasks**: the story of each piece of work from intent to verified outcome,
  across any number of repositories and git hosts, with the code work staying
  on the git hosts (D-001, D-002).

Agents connect from outside; Shinan runs no model (D-008).

The market research below shows that a board where agents work beside people,
and crediting work to a person or an agent, are now **table stakes**: Multica,
Linear, GitHub and Chartroom all have both, and Plane lets agents take work
items too. Shinan's proposed
differentiator is the catalog: a **document-first record of running
infrastructure and decisions that agents keep accurate, with freshness and
provenance on every fact**, owned by the team and self-hostable. No product
checked combines those properties. The task story is necessary but is not, on
its own, a differentiator: Multica now links pull requests from self-hosted
Forgejo, Gitea and GitLab to its issues in the same way Shinan intends to.

## Vision

### The problem

**Decided** that Shinan grew from the owner's hand-made practice in the
`workspace` repository (plan section 1). The points below describe that
practice; the reading of what hurts is **proposed**, with the evidence given.

| What works today | What hurts | Evidence in the `workspace` repository |
|---|---|---|
| A Markdown catalog of projects, machines and shared services that both people and agents read. | Freshness is recorded by hand per page. Nothing shows which facts are stale, and checking one fact must not refresh the others, which is easy to get wrong. | [maintenance](https://git.guneet.dev/guneet/workspace/src/branch/main/docs/maintenance.md): `last_verified`, `verification_scope`, `verification_source`; "do not refresh dates mechanically". |
| Rules for intended versus observed state, recording discrepancies instead of picking a winner. | The rules live in prose; nothing enforces or displays them. | [agent entry point](https://git.guneet.dev/guneet/workspace/src/branch/main/docs/agent-entrypoint.md), "Source authority and freshness". |
| Forgejo issues for cross-project work, with branches and pull requests linked by URL. | Work spans GitHub and Forgejo (Shinan itself lives on GitHub; the `workspace` repository's coordination issues live on Forgejo). Issue numbers only mean something inside one repository, so links need full URLs and there is no single story. | [collaboration](https://git.guneet.dev/guneet/workspace/src/branch/main/docs/collaboration.md): "Issue numbers are repository-scoped; use qualified references or full URLs". |
| A `human-effort` label with a TL;DR comment for work only a person can do. | It is a label convention per issue, with no overview across repositories and hosts. | [collaboration](https://git.guneet.dev/guneet/workspace/src/branch/main/docs/collaboration.md), "Work only a person can do". |
| Agents use the owner's git host account. | Who did what is only known if the agent announces its agent session in a comment. | [collaboration](https://git.guneet.dev/guneet/workspace/src/branch/main/docs/collaboration.md): "Announce the agent/session identity in a comment if agents share an account." |
| Several agent sessions work in parallel, each in its own worktree. | Nothing shows which agent sessions are running, on what, and whether they are stuck; a person's comment does not reach a running agent session. (Reported by the owner; the `workspace` repository has no mechanism for either.) | [collaboration](https://git.guneet.dev/guneet/workspace/src/branch/main/docs/collaboration.md), step 4: "Never share a writable directory between independent agents." |

The links above point into the private `workspace` repository on Forgejo
(sign-in needed); they are evidence, not part of Shinan.

### The vision

**Proposed** vision statement (owner decision 1). Reason: it restates plan
section 1 as an outcome a user can check.

> A person who opens Shinan, or an agent that connects to it, can answer three
> questions without asking anyone: *what do we run and how sure are we*, *what
> is being worked on and where does each piece stand*, and *who did it, a
> person or an agent acting for one*.

### Product principles

These guide trade-offs in every other document.

| Principle | Status and reason |
|---|---|
| **Documents first.** The catalog is Markdown with structured fields at the top; people can read it and it outlives the tool. | **Decided** (D-006: people must be able to read it). |
| **Show how sure we are.** Every fact carries its fact state, source and last-checked time, and stale or unknown facts are visible rather than hidden. | **Decided** (D-007: trust is the main differentiator). |
| **Link, don't copy.** Facts owned elsewhere are linked; git host discussions stay on the git host. | **Decided** (plan section 3; D-001). |
| **Host-neutral.** A task and its timeline span any git host; no git host is privileged. | **Decided** (D-001, D-002, D-009). |
| **Bring your own agent.** People keep their coding tools and pay for their own models. | **Decided** (D-008). |
| **People set direction; agents do the work.** Agents make catalog proposals and report progress; people make the decisions, for example approving catalog proposals, accepting or cancelling a task, and giving deployment approval. | **Decided** that agents propose and people approve where needed (plan, Catalog pillar). Who may set each manual state, including the `needs a person` task flag, is owned by [Tasks and work](tasks.md) and pending an owner decision in the [domain model](domain-model.md#task-status-task-flags-and-manual-states). |
| **Calculate, don't maintain.** Task status is calculated from linked work, not kept by hand. | **Decided** (D-005). How far "linked work" includes recorded events is a pending owner decision in the [domain model](domain-model.md#task-status-task-flags-and-manual-states). |
| **Self-hostable.** One installation can be run by anyone on their own machines. | **Decided** (D-012). |
| **Small and legible over configurable.** Prefer a fixed, well-explained model (entity types, fact states, task states) to custom fields and workflows. | **Proposed** (owner decision 3). Reason: the target users are small teams; Chartroom makes the same bet for teams of 2 to 25, and configurable tools such as Port need a platform team to model them (see [Port](#port)). It constrains the catalog schema (plan question 5) and workspace settings, so the owning documents may argue for exceptions. |

## Users

### Who Shinan is for

| Stage | Users | Status |
|---|---|---|
| Now | The owner alone, with several agents, many repositories on GitHub and Forgejo, and a small fleet of machines. | **Decided** (plan section 2). |
| Designed in from the start | Teams: people invited to a workspace as members. | **Decided** (D-019). |
| Later, if it proves itself | Small teams that run many projects or machines, such as agencies, consultancies and small infrastructure teams. | **Decided** as the eventual fit (plan section 2). Building a business is not a goal of this phase (D-013). |

### Personas and what they need

Each persona maps to glossary terms. The roles named are the
[proposed roles](domain-model.md#member-and-role); their rules belong to
[Identity, agents and permissions](identity.md).

| Persona | Glossary terms | What they need from Shinan | Status |
|---|---|---|---|
| **The owner** today | Person; workspace owner | Know what runs where and how fresh that knowledge is; see every piece of work across GitHub and Forgejo as one story; see which agent sessions are running and what needs a person; approve catalog proposals; reach a running agent session with a comment. | **Decided** as first user (plan section 2). Needs **proposed** from the [problem](#the-problem) table. |
| **An agent** working for a person | Agent, agent session, acting for | Read the relevant part of the catalog through the agent index at the start of a task; find or create the task; report progress and link work; propose catalog changes from what it observed; receive nudges. | **Decided** that agents are users through MCP, a skill and plugins (D-014). The interface belongs to [Agent integrations](agent-integrations.md). |
| **A team member** | Member with the contributor role | Pick up tasks, comment, nudge agent sessions, register their own agents, read and propose catalog changes. | **Decided** that members exist (D-019). |
| **A reader** | Viewer | Read the wiki, follow tasks and timelines, without changing anything. Examples: a new hire on day one, a stakeholder. | **Proposed**. Reason: onboarding (plan, Wiki and onboarding pillar) needs a read-only path. |
| **A newcomer, person or agent** | Start here path | Get from zero to useful in one reading path. | **Decided** (plan, Wiki and onboarding pillar). |
| **An outside contributor** | Outside actor; outside issue | Nothing in Shinan directly; they open issues on a git host, and Shinan turns those into tasks. | **Decided** (D-003) that outside issues become tasks; the `triage` status they start in is **proposed** in the [domain model](domain-model.md#outside-issue). |
| **A later adopter**: agency, consultancy or small infrastructure team | Several workspaces per person | Keep each client's or system's catalog and tasks apart; hand over a readable catalog when an engagement ends; run Shinan themselves. | **Proposed** needs. Reason: these teams work across many separate estates, which is the workspace boundary (D-019) and the self-hosting decision (D-012). Whether clients ever sign in is **open** (question 3). |

### Who Shinan is not for

**Proposed** (owner decision 4), each with its reason:

- **Large engineering organisations that want an internal developer portal**
  with scorecards, self-service actions and hundreds of integrations. Port and
  OpsLevel serve them and need a platform team to model the catalog (see
  [positioning](#context-layers-for-agents)).
- **Teams that want a company-wide search over chat, documents and tickets.**
  Glean and Unblocked do this; Shinan's catalog is curated, not an index of
  everything (see [non-goals](#non-goals)).
- **Teams that want agents run for them in a vendor's cloud** without their own
  coding tools. GitHub Agent HQ, Linear's coding agent and Augment Cosmos offer
  this; Shinan runs no model (D-008).
- **Non-technical teams looking for a general work tracker.** Chartroom and
  Plane serve mixed teams; Shinan's catalog and git host focus would be
  overhead for them.

## Scope

### What Shinan covers

Each row names the question the pillar answers for a user. Details belong to
the owning document; phases and first-version scope belong to
[Roadmap and migration](roadmap.md).

| Pillar | The user's question | Owning document | Status |
|---|---|---|---|
| Catalog | What do we run, who owns it, how does it fit together, and how sure are we? | [Catalog](catalog.md) | **Decided** (D-006, D-007). |
| Tasks | What is being worked on, why, and where does each piece stand across hosts? | [Tasks and work](tasks.md) | **Decided** (D-002, D-003, D-004, D-005). |
| Timeline | What happened, and was it a person or an agent acting for one? | [Human experience](human-experience.md) | **Decided** (plan, Timeline pillar). |
| Agent presence | Which agent sessions are running, on what, and when were they last seen? | [Agent integrations](agent-integrations.md) | **Decided** (D-014). |
| Nudges | How do I reach the agent session working on this task? | [Tasks and work](tasks.md), [Agent integrations](agent-integrations.md) | **Decided** (plan, Nudges pillar). |
| Wiki and onboarding | Where do I start, as a new person or a new agent? | [Human experience](human-experience.md) | **Decided** (plan, Wiki and onboarding pillar). |
| Workspaces | Who can see and do what, and how do I invite someone? | [Identity, agents and permissions](identity.md) | **Decided** (D-019). |
| Git host connections | How does work on GitHub and Forgejo reach Shinan, and what is written back? | [Git host integrations](git-hosts.md) | **Decided** (D-009). |
| Self-hosting and operations | Can I run my own Shinan installation? | [Architecture and operations](architecture.md) | **Decided** (D-012, D-016). |

### Relationship to the `workspace` repository

**Decided** (D-018): Shinan starts empty and is tried on a few projects. The
`workspace` repository's catalog and its cross-project coordination issues stay
the source of truth until Shinan is judged ready, then move over. Which projects,
what "ready" means and how the move works belong to
[Roadmap and migration](roadmap.md).

### What success looks like

**Proposed** product-level outcomes. Reason: "proved itself in our own use"
(D-013) needs observable signs. Measurable readiness criteria belong to
[Roadmap and migration](roadmap.md).

1. The owner and the owner's agents answer "where does this run, who owns it,
   how sure are we" from Shinan instead of reading the `workspace` repository.
2. Stale and unknown facts are visible at a glance, and agents fix some of them
   as a side effect of task work, through catalog proposals.
3. Every piece of agent work on the trial projects, on GitHub or Forgejo, has
   one task with a correct calculated status and one timeline.
4. The owner can tell what each running agent session is doing, and which tasks
   need a person, without opening terminals or searching repositories.

## Non-goals

| Shinan does not | Status and reason |
|---|---|
| Replace git hosts: no code review, CI, pull request interface or per-repository issue tracker. | **Decided** (D-001, plan section 3). |
| Run models or host agents, at least until a later phase. | **Decided** (D-008). A launcher that starts agent sessions on the user's own machines is a phase 3 option (D-014). |
| Copy facts that another system owns. | **Decided** (plan section 3). |
| Sell human-versus-agent attribution as a feature. It is necessary, but every competitor has it. | **Decided** (plan section 3). The survey confirms it for every agent board checked (see [table stakes](#table-stakes)). |
| Embed other products such as Multica, Linear or Plane. It integrates with them through their APIs. | **Decided** (D-010). |
| Act as an internal developer portal: no scorecards, maturity rubrics, self-service actions or provisioning workflows. | **Proposed** (owner decision 4). Reason: Port and OpsLevel own this space for organisations with platform teams; it is outside the owner's need and would pull the catalog towards ingesting everything instead of recording checked facts. The phase 3 launcher, which starts agent sessions on a member's own machines (D-014), is not a self-service action in this sense. |
| Index everything: no search across chat, email or third-party document tools. | **Proposed** (owner decision 4). Reason: Glean and Unblocked do this at scale; a curated, checked catalog is a different product, and indexing would copy facts owned elsewhere. |
| Act as a live inventory or monitoring system for what the catalog describes. Catalog facts are checked observations with a time, not live metrics. Agent presence, which is live, is in scope. | **Proposed** (owner decision 4). Reason: the `workspace` repository already states "the catalog is not a live inventory", and monitoring is owned by monitoring tools. |
| Act as a secrets manager. The catalog records where a credential lives and who holds it, never its value. | **Proposed** (owner decision 4). Reason: the web app is public behind sign-in and holds infrastructure details (D-015), and the `workspace` repository's rule is "Document credential sources and required roles, not credential values" ([access and safety](https://git.guneet.dev/guneet/workspace/src/branch/main/docs/access-and-safety.md)). How Shinan holds the credentials it needs itself (git host connection and agent tokens), and what happens to a secret pasted by mistake, belong to [Identity, agents and permissions](identity.md) and [Architecture and operations](architecture.md). |
| Become a general work tracker with custom fields and configurable workflows. | **Proposed** (owner decision 4). Reason: the [small and legible](#product-principles) principle; tools that do this well already exist. |

## Positioning against competitors

### Method

Products were grouped by the problem they start from. For each, the questions
were: does it have a board where agents work beside people; does it credit work
to a person or an agent; does it span several git hosts, including Forgejo;
does it keep a catalog of what a team runs; is that catalog readable documents;
does it show freshness and provenance per fact; can it be self-hosted. Sources
are vendor pages and documentation unless marked otherwise.

### Agent boards

Products where agents take work from a shared board or tracker.

#### Multica

- **What it is.** A source-available workspace where agents are named members
  of the board: you assign an issue to an agent, a daemon on your machine runs
  the matching coding tool (OpenCode, Claude Code, Codex and over twenty
  others), and the agent comments and moves the issue to review. Squads,
  scheduled "autopilots", skills, workspaces and roles. About 56,300 GitHub
  stars (56,271 on 2026-11-16).
- **Git hosts.** GitHub on cloud and self-hosted. On **self-hosted** Multica
  only, Forgejo, Gitea and GitLab can be connected per workspace: a pull request
  whose branch name or title carries the issue identifier is linked to the
  issue, CI status is shown, and the issue moves to a chosen status when all
  linked pull requests merge.
- **License and price.** Apache 2.0 text with extra conditions. Use inside your
  own organisation is free, including self-hosting, and so is deploying it for
  a client who then owns and uses it internally. A commercial license is needed
  when people outside your organisation sign in, when you run instances for
  clients as a managed service, or when you embed it in a product you sell.
  Cloud prices are not shown on its pages (the pricing page rendered no prices
  when fetched); a third-party review reports the cloud plan is billed per
  human seat, which we could not confirm.
- **Overlap with Shinan.** Strong on tasks: host-neutral pull request linking
  by identifier in the branch name, status calculated on merge, Forgejo support,
  self-hosting, agents as named actors. Also close to Shinan's Nudges pillar:
  @-mentioning an agent in a comment starts a run on the issue, and **issue
  wakeups** bring an agent back to an issue at a set time or after an event
  such as a reply, a status change or a linked pull request merging.
- **Differences.** No catalog of what a team runs, and no fact states,
  provenance or freshness; its context is "projects" with attached repositories
  and documents, plus skills. Every way of reaching an agent, including
  mentions and wakeups, starts a new run through the daemon; Shinan's first
  version instead follows, and delivers nudges into, agent sessions a person
  already has open in their own coding tool (D-014). Its license blocks the
  agency case of running an installation that clients sign in to, or running
  it for them as a managed service.

#### Linear

- **What it is.** A hosted issue tracker. Agents are installed as app users. An
  issue can be **delegated** to an agent while a person stays the
  **assignee** and remains responsible; agent sessions report states such as
  working, waiting for input, error and complete. MCP access on every plan.
- **Direction.** Its essay "Issue tracking is dead" (2026-03-24) repositions
  Linear as "the shared product system that turns context into execution",
  launched the Linear Agent, skills and automations, and reports coding agents
  in more than 75% of its enterprise workspaces.
- **Price.** Free; Basic $10 and Business $16 per user per month billed yearly;
  Enterprise custom. No self-hosted edition is offered on its pricing page.
- **Overlap.** The delegate-versus-assignee model is the same idea as Shinan's
  "agent acting for a person" (domain model, [acting for](domain-model.md#acting-for)).
  Its "context" pivot targets product context: feedback, plans, decisions.
- **Differences.** Hosted only; its context is about the product, not about the
  machines and services a team runs; no per-fact provenance. Forgejo support
  was not checked.

#### GitHub Agent HQ and mission control

- **What it is.** Announced 2025-10-28. Mission control is one place on
  github.com, VS Code, mobile and the CLI to assign, steer and track agent
  tasks. Claude and Codex became available as coding agents in public preview
  on 2026-02-04 (Copilot Pro+ and Enterprise) and 2026-02-26 (Pro and
  Business). Issues can be assigned to one or several agents; each produces a
  draft pull request. An agent control plane for enterprises reached general
  availability on 2026-02-26.
- **Overlap.** Agent sessions with logs, assignment, attribution.
- **Differences.** GitHub only, by design; agents run in GitHub's cloud on a
  Copilot subscription; no catalog.

#### Chartroom (Cloud City Computing)

- **What it is.** Planning for mixed teams of 2 to 25, with tasks and documents
  together. A task key in a branch name or pull request moves the task on its
  own; "a person always wins" over automatic moves. Agents connect over MCP and
  take only ready tasks; history names the person first, then the agent, and
  edits read "(via an agent)". No AI runs inside it.
- **Status.** Private beta; sign-up and payment not open. The vendor lists it as
  proprietary and "not offered for sale, licence or download".
- **Overlap.** Very close to Shinan's task half and its principles (no model
  inside, agents act for a person, key in branch name, calculated status).
- **Differences.** Only GitHub is named as a git host; not self-hostable; its
  documents are product specs, not a catalog of running infrastructure with
  provenance.

#### Plane

- **What it is.** An open-core project management tool. The Community Edition
  is AGPL-3.0; paid plans run on the cloud or on a closed-source Commercial
  Edition that can be self-hosted. It has a native MCP server (MIT licensed),
  a workspace wiki on paid plans, and AI agents that can be assigned to work
  items.
- **Price.** Free up to 12 users; Pro $6 and Business $13 per seat per month
  billed yearly ($8 and $15 monthly).
- **Differences.** A general project tracker; its wiki is free-form pages, not
  typed entities with fact states.

### Context layers for agents

Products that give agents organisational knowledge.

#### Port

- **What it is.** An internal developer portal now sold as an "AI software
  factory". Its **context lake** is built on its software catalog: you define
  blueprints (entity types) and integrations fill them with entities from over
  200 tools. Agents read it through an MCP server, a CLI or an API.
- **Documents.** Markdown can be stored as entity properties. A recent guide
  ingests Markdown files as `techDoc` entities and renders them with a
  reference TechDocs plugin (which does not render images), and another guide
  uses a Claude agent to write and refresh a repository wiki through pull
  requests. Documents are an add-on to the catalog, not its source of truth.
- **Hosting and price.** Multi-tenant SaaS with no full self-hosted option;
  Enterprise customers can ask for a single-tenant deployment ("dedicated
  tenancy"). Free up to 5 seats;
  Basic $30 per seat per month billed yearly; Standard $48 per seat per month;
  Enterprise custom. Every authenticated user, including read-only users,
  counts as a seat.
- **Differences.** Port's catalog is a database filled by integrations, built
  for organisations with platform teams; it records when data was last ingested, not
  a fact state with a source and a check. Not self-hostable. This is where
  D-006 and D-012 position Shinan.

#### OpsLevel

- **What it is.** An internal developer portal marketed as "the context layer
  for your AI agents": ownership, dependencies, tiers, on-call and live state
  from about 40 sources, served to Claude Code, Cursor and Copilot through a
  read-only hosted MCP server, a CLI and an API. Workflows and an agent registry
  are in preview.
- **Hosting and price.** SaaS, with self-hosting on Kubernetes for Enterprise
  (the documented default needs 24 CPU cores and 48 GB of memory). Prices on
  request.
- **Differences.** A portal for larger engineering organisations; context is
  correlated from tools, not written and checked as documents.

#### Unblocked

- **What it is.** "The context layer for agentic software development". It
  builds a knowledge graph over code, pull requests, chat, issues, documents and
  production tools, resolves conflicts between sources by recency and authority,
  and serves cited answers to agents (including OpenCode) over MCP, a CLI and an
  API.
- **Note.** Its pitch states that "Markdown goes stale", the opposite bet to
  D-006. Shinan's answer is that Markdown goes stale when nobody records checks;
  freshness and provenance per fact (D-007) are there to make staleness visible
  and fixable.

#### Glean

- **What it is.** Enterprise search and assistant over 100+ sources with a
  permission-aware knowledge graph, exposed to coding tools through an MCP
  server, a gateway for third-party tools, and plugins for Cursor, Claude Code
  and Codex.
- **Differences.** An index of everything a company has written, not a curated
  record of what it runs.

#### Dosu

- **What it is.** A knowledge base for engineering teams and their agents. It
  drafts and updates Markdown documents when pull requests change the code they
  describe; a person accepts, edits or declines each update. Agents read and
  write knowledge over MCP. Knowledge is kept as Markdown which the vendor describes as "syncable to
  GitHub, Confluence, Notion, and more".
- **Price.** Free for public repositories; Pro $16 per month billed yearly ($20
  monthly); Enterprise custom, with self-hosting for large enterprise customers.
- **Overlap.** The closest to "documents that agents keep current, approved by
  people".
- **Differences.** Its trigger is a code change, so it keeps code
  documentation current; Shinan's facts are mostly about machines, services and
  deployments that code diffs do not reveal, and they carry a fact state
  (such as intended or observed) and a last-checked time.

#### Augment Cosmos

- **What it is.** Augment Code's platform for teams of agents ("Experts") with
  shared, tenant-wide and private memory over a shared virtual file system,
  triggers from GitHub, Linear and Slack, and agents that run in Augment's cloud,
  on your own VMs or on laptops. Public preview announced 2026-05-04.
- **Differences.** Memory is what agents learned, gathered by the platform; it
  is not a document people own, and it is tied to Augment's agents.

### Small agent-coordination tools

Several small projects explore the same ideas. More than one project uses each
of the names Cairn, Muster and Waymark, so which ones the owner looked at is
**open** (question 6). Examples found:

| Tool | What it is |
|---|---|
| Beads | A dependency-aware issue tracker for coding agents, stored in a versioned database inside the repository, with a "ready work" query and atomic claims. MIT licensed. |
| Cairn (cairn.computer) | Long-lived agent "threads" that file issues, brief builder agents and record transcripts, diffs and checks at stable addresses. |
| Muster (muster.tools) | A local message bus between agent sessions over MCP, with messages, tasks and shared values. Another Muster (musterai.org) offers a board with claim leases, a design-document vault and a knowledge base. |
| Waymark (waymark-cli) | Spec-driven development with "living specs" kept as Markdown in the repository; agents build each task from the written change. |

**Proposed** reading: these confirm the demand for task claiming, agent session
coordination and written context, and show that per-repository, single-host
tools are cheap to build. None keeps a cross-host catalog of running
infrastructure. Shinan should borrow good ideas (ready-work queries, claim
leases, addresses for every artifact) through the owning documents rather than
compete on them.

### Comparison

"Yes" and "No" mean what the vendor documents; "Partly" is explained in the
profiles above; "?" means not checked.

| | Agent board | Person or agent credit | GitHub and Forgejo | Catalog of what a team runs | Readable documents as source | Per-fact freshness and provenance | Self-hostable |
|---|---|---|---|---|---|---|---|
| **Shinan (planned)** | Phase 2 | Yes; reliability open (D-017) | Yes (D-009) | Yes (D-006) | Yes (D-006) | Yes (D-007) | Yes (D-012) |
| Multica | Yes | Yes | Yes, self-hosted only | No | No | No | Yes, internal use |
| Linear | Yes | Yes (delegate) | ? | No | No | No | No |
| GitHub Agent HQ | Yes | Yes | GitHub only | No | No | No | No |
| Chartroom | Yes | Yes | GitHub only | No | Partly (specs) | No | No |
| Plane | Yes | ? | ? | No | Partly (wiki) | No | Yes |
| Port | ? | ? | ? | Yes | Partly | No | No |
| OpsLevel | No | ? | ? | Yes | No | No | Enterprise |
| Unblocked | No | No | ? | No | No | Partly (cited, recency) | ? |
| Glean | No | No | ? | No | No | Partly (cited) | ? |
| Dosu | No | No | ? | No | Yes | Partly (reviewed updates) | Enterprise |
| Augment Cosmos | No | ? | ? | No | No | No | Agents only |

### Table stakes

Every agent board checked (Multica, Linear, GitHub Agent HQ, Chartroom) has
these, so Shinan needs them but cannot win on them. Context layers such as
Port, OpsLevel and Glean are not agent boards and lack most of them.

| Table stake | Status |
|---|---|
| Crediting each action to a person or an agent acting for a person. | **Decided** (plan section 3: "Attribution is necessary, but every competitor has it"). Shinan's version is harder than the others' because agents share their person's git host account (D-017); see [risks](#risks-to-this-positioning). |
| A board or queue where agents take work beside people. | **Proposed**. Reason: all four agent boards have one; Shinan's board is planned for phase 2 (plan section 10). |
| Access for any agent through MCP or a CLI. | **Proposed**. Reason: Linear, Chartroom and Plane offer an MCP server and Multica gives agents a CLI and API; Shinan already plans MCP, a skill and a CLI (D-014). |
| Linking pull requests to tasks by a key in the branch name or title, and calculating status from them. | **Proposed**. Reason: Multica and Chartroom do exactly this; Shinan already plans it (D-002, D-005). |
| Letting people bring their own coding tools. | **Proposed**. Reason: Multica and Chartroom work with the coding tools people already have, and Linear's MCP server lets them work on issues (GitHub Agent HQ runs agents in GitHub's cloud instead); Shinan already plans it (D-008). |

### Differentiators

**Proposed**, in order of strength, each with the evidence:

1. **A catalog of what the team runs, kept accurate by agents.** Machines,
   services, projects, runbooks, decisions and policies as typed entities
   (plan, Catalog pillar). Port and OpsLevel catalog services for large
   organisations; Dosu and Unblocked cover code knowledge; nobody checked
   offers a small team's record of its running estate that agents update as
   part of task work.
2. **Trust signals on every fact.** Fact state, source and last-checked time,
   with intended and observed facts kept side by side when they disagree
   (D-007). No product checked shows this per fact; the nearest are Unblocked's
   recency weighting (hidden inside its engine) and Dosu's reviewed updates.
3. **Documents people own.** Markdown as the source of truth, readable as a
   wiki, portable if Shinan goes away (D-006). Dosu and Waymark are also
   Markdown-based, so this is a differentiator only in combination with 1 and 2.
4. **Self-hostable.** D-012 makes Shinan self-hostable; Port and Chartroom are
   not. Multica is self-hostable for internal use but needs a commercial
   license once outside people sign in or it is run as a managed service.
   Whether Shinan's own license would allow hosting for others is deferred
   (D-013, [open question 7](#open-questions)).
5. **Follows the agent sessions people already run.** Presence and nudges for
   agent sessions started in a person's own coding tool, through a plugin (D-014).
   Multica, Linear and GitHub start a new run when work is assigned, an agent
   is mentioned or (in Multica) a wakeup fires; none of them reaches a
   conversation a person already has open. This matters for people who work
   interactively with agents, as the owner does; how much it matters to others
   is **open**.

The host-neutral task story is **not** listed: it is essential to Shinan
(D-001, D-002) and still beats GitHub Agent HQ and Chartroom, which are
GitHub-only, but Multica's self-hosted edition now offers the same linking
across GitHub, Forgejo, Gitea and GitLab.

### Positioning statements

**Proposed** (owner decision 1), in two parts. Reason: plan section 2 and
D-013 make the owner the user now, while the eventual fit is small teams; each
statement names its audience and claims only the differentiators above.

**Now**, while Shinan is tried in the owner's own use:

> For the owner and the owner's agents, Shinan is the one place that says what
> runs where and how sure we are, and where each piece of work stands across
> GitHub and Forgejo, so neither has to reconstruct it from repositories and
> terminals.

**Later**, if Shinan proves itself:

> For small teams that run many projects and machines and let coding agents do
> much of the work, Shinan is the trusted record of what the team runs and the
> story of each piece of work across git hosts. Unlike agent boards such as
> Multica, Linear or GitHub Agent HQ, its centre is a catalog that agents keep
> accurate, where every fact shows how fresh it is and where it came from.
> Unlike context layers such as Port, OpsLevel or Unblocked, that catalog is
> plain documents the team owns and can host itself, and it describes the
> running estate, not only the code.

### Risks to this positioning

**Proposed** watch list. Reason: the market moves monthly, so the
positioning should be rechecked rather than assumed.

| Risk | Why it matters | Signal to watch |
|---|---|---|
| Multica adds a catalog or knowledge base. | It already has the task half, self-hosting and Forgejo; a catalog would close most of the gap. | Releases mentioning knowledge, docs, inventory or memory. |
| Port moves to documents first. | It already ingests Markdown and refreshes wikis with agents. | TechDocs leaving "reference plugin" status; a self-hosted offer. |
| Dosu extends from code to infrastructure. | Its review flow is the closest to catalog proposals. | Sources beyond code and chat, such as infrastructure repositories or observations. |
| Linear's "context" pivot reaches engineering operations. | Large user base, strong design. | Linear features for systems, services or runbooks. |
| "Markdown goes stale" proves true for us. | It would undercut D-006. | Share of facts past their expected check age during the trial. |
| Agents do not reliably make catalog proposals. | Differentiator 1 depends on it. | Proportion of tasks that touch infrastructure and produce a catalog proposal. |
| Attribution with shared git host accounts proves unreliable. | Agents share their person's git host account (D-017), while boards that start the agent themselves know who acted; how reliable Shinan's attribution can be is plan question 2. | Share of events with attribution `unknown` during the trial. |

### How Shinan relates to these products

**Decided** (D-010): Shinan integrates with outside tools such as Multica,
Linear and Plane through their APIs and does not embed them. D-010's reason is
Multica's license; precisely, that license requires a commercial agreement for
embedding, for a managed service, or when outside people sign in.
**Proposed** consequence: a team that already uses one of these boards should
be able to keep it, with Shinan holding the catalog and linking to their tasks. Whether items in outside tools become
work items or task origins is open in the
[domain model](domain-model.md#work-item) and belongs to
[Tasks and work](tasks.md).

## Fit for later adopters

**Decided** that agencies, consultancies and small infrastructure teams are the
eventual fit and that business decisions are deferred (plan section 2, D-013).
**Proposed** reasons they fit, from the survey:

- They run many separate estates (one per client or system), which maps to one
  workspace each (D-019), and they hand estates over at the end of an
  engagement, which favours readable documents they own (D-006).
- Their records are only useful if they can be trusted months later, which is
  what freshness and provenance give (D-007).
- They often host tools themselves or for clients. Port and Chartroom cannot be
  self-hosted, and Multica needs a commercial license once clients sign in or
  it is run for them as a managed service.

**Proposed** rule (owner decision 6): these users act only as a tie-breaker
between otherwise equal designs in the documents for this phase; nothing is
built only for them.
Reason: D-013 defers business decisions until Shinan proves itself in the
owner's use.

## Dependencies on other documents

Links use each document's planned path; until it merges, its issue holds the
work.

| Document | Issue | What this document relies on it for |
|---|---|---|
| [Domain model and glossary](domain-model.md) | [#3](https://github.com/guneet-xyz/shinan/issues/3) | All terms. Its proposed roles (workspace owner, contributor, viewer) underlie the personas; its pending owner decisions (for example who may set `needs a person`) are not assumed here. |
| [Catalog](catalog.md) | [#5](https://github.com/guneet-xyz/shinan/issues/5) | Whether the catalog can deliver differentiators 1 to 3: entity types, fact states, granularity, catalog proposals, catalog approval, the agent index. |
| [Tasks and work](tasks.md) | [#6](https://github.com/guneet-xyz/shinan/issues/6) | The task story, calculated status and nudges; how tasks link to outside tools such as Multica or Linear; findings from the Multica trial (decision 5). |
| [Identity, agents and permissions](identity.md) | [#7](https://github.com/guneet-xyz/shinan/issues/7) | Roles behind the personas, the viewer role, whether people outside a team (for example a client) can be members, and how Shinan holds its own credentials. |
| [Git host integrations](git-hosts.md) | [#8](https://github.com/guneet-xyz/shinan/issues/8) | That GitHub and several Forgejo servers can be treated alike. |
| [Agent integrations](agent-integrations.md) | [#9](https://github.com/guneet-xyz/shinan/issues/9) | That plugin-based presence and nudges work for agent sessions a person starts (differentiator 5). |
| [Human experience](human-experience.md) | [#10](https://github.com/guneet-xyz/shinan/issues/10) | The wiki and start here path that make the catalog readable by people. |
| [Architecture and operations](architecture.md) | [#11](https://github.com/guneet-xyz/shinan/issues/11) | That a single person can self-host an installation (differentiator 4), that the public app is safe for infrastructure details (D-015), and what happens to secrets pasted by mistake. |
| [Roadmap and migration](roadmap.md) | [#12](https://github.com/guneet-xyz/shinan/issues/12) | Phases, trial projects and the measurable readiness criteria behind [what success looks like](#what-success-looks-like); findings from the Multica trial (decision 5). |
| [Decision log](decisions/) | [#13](https://github.com/guneet-xyz/shinan/issues/13) | Records for the decisions below once the owner takes them. |

## Open questions

1. **Multica and outside issues.** Does Multica turn issues opened on a git
   host into Multica issues, as Shinan does with outside issues (D-003)? Not
   found in its documentation. (This document; the Multica trial in decision 5
   can answer it.)
2. **Linear and Forgejo.** Does Linear link work from Forgejo or other
   self-hosted git hosts? Not checked. (This document.)
3. **Clients as users.** Should an agency's client ever sign in to see their
   catalog or tasks, and as which role? (Identity, agents and permissions.)
4. **Interactive versus dispatched agents.** How many target users work with
   agents interactively, as the owner does, versus assigning work and walking
   away? This decides how much differentiator 5 is worth. (This document;
   evidence from the trial.)
5. **Is "readable like a wiki" enough?** Port now renders Markdown documents
   and Dosu publishes reviewed Markdown. What must Shinan's wiki do beyond
   rendering to justify D-006 to a newcomer? (Human experience.)
6. **Which small tools.** For the owner: which projects named Cairn, Muster and
   Waymark did you have in mind? Several projects share each name. (This
   document.)
7. **Hosting for others.** Would Shinan's license allow others to run it for
   third parties? Differentiator 4 claims only self-hosting until this is
   settled. Deferred by D-013; plan question 10.

## Decisions needed from the owner

Each stays **proposed** until the owner agrees; agreed items get a record in
the [decision log](decisions/).

| # | Decision | Recommended | Reason |
|---|---|---|---|
| 1 | Adopt the [vision statement](#the-vision) and the two [positioning statements](#positioning-statements) (now and later). | Adopt | They claim only what the survey supports and keep the owner as today's user (plan section 2). |
| 2 | Use "catalog first" as a tie-breaker in design trade-offs, without changing phase 1 scope. | Yes | The catalog is the one part no competitor checked offers; Multica already covers most of the task half. |
| 3 | Adopt the "small and legible over configurable" [principle](#product-principles). | Yes | Small teams are the target; owning documents can still argue for specific exceptions. |
| 4 | Accept all proposed [non-goals](#non-goals) and [non-audiences](#who-shinan-is-not-for). | Accept all | Others serve these well, and most would pull the catalog towards copying facts. |
| 5 | Run a short local trial of self-hosted Multica against Forgejo before phase 2 board work; findings go to Roadmap and Tasks and work. | Yes; nothing deployed | Cheapest way to confirm the overlap; changing the phase 2 board would be a separate plan change. |
| 6 | Treat later adopters as a [tie-breaker](#fit-for-later-adopters) only. | Yes | D-013 defers business decisions; a tie-breaker keeps the option open at no cost. |
| 7 | Recheck the competitor survey at each phase boundary, updating this document by pull request. | Yes | Several facts here changed within the last six months. |

## Sources

All checked on 2026-11-16 unless stated.

| Product | Sources |
|---|---|
| Multica | [README](https://github.com/multica-ai/multica), [GitHub API](https://api.github.com/repos/multica-ai/multica) (stars), [how Multica works](https://github.com/multica-ai/multica/blob/main/apps/docs/content/docs/how-multica-works.mdx), [issue wakeups](https://multica.ai/docs/issue-wakeups), [agents](https://github.com/multica-ai/multica/blob/main/apps/docs/content/docs/agents.mdx), [self-hosted Git providers](https://multica.ai/docs/vcs-integration), [GitHub integration](https://multica.ai/docs/github-integration), [licensing](https://multica.ai/licensing), [pricing page](https://multica.ai/pricing) (no prices rendered). Per-seat cloud billing reported by [The Open Source Drop](https://www.opensourcedrop.com/tools/multica-ai/multica) (third party, not confirmed). |
| Linear | [Issue tracking is dead](https://linear.app/next) (2026-03-24), [assign and delegate issues](https://linear.app/docs/assigning-issues), [agents developer guide](https://linear.app/developers/agents), [pricing](https://linear.app/pricing). |
| GitHub | [Introducing Agent HQ](https://github.blog/news-insights/company-news/welcome-home-agents/) (2025-10-28), [Claude and Codex public preview](https://github.blog/changelog/2026-02-04-claude-and-codex-are-now-available-in-public-preview-on-github) (2026-02-04), [Claude and Codex for Business and Pro](https://github.blog/changelog/2026-02-26-claude-and-codex-now-available-for-copilot-business-pro-users) (2026-02-26). |
| Chartroom | [Chartroom](https://cloudcitycomputing.com/products/chartroom), [products page](https://cloudcitycomputing.com/products). |
| Plane | [pricing](https://plane.so/pricing), [Pro](https://plane.so/pro), [self-hosting licensing](https://developers.plane.so/self-hosting/self-hosting-101), [MCP server](https://developers.plane.so/dev-tools/mcp-server). |
| Port | [context lake](https://docs.port.io/context-lake/overview/), [pricing](https://www.port.io/pricing), [self-hosting FAQ](https://docs.port.io/troubleshooting/general), [technical docs guide](https://docs.port.io/guides/all/manage-and-surface-technical-docs), [AI-generated docs guide](https://docs.port.io/guides/all/generate-technical-docs-with-ai). |
| OpsLevel | [context layer](https://www.opslevel.com/product/context-layer), [self-hosted setup](https://docs.opslevel.com/docs/getting-started-with-self-hosted-opslevel), [pricing](https://www.opslevel.com/pricing/). |
| Unblocked | [home](https://getunblocked.com/), [context engine](https://getunblocked.com/context-engine/), [information for AI models](https://getunblocked.com/ai-info/). |
| Glean | [MCP server](https://docs.glean.com/administration/platform/mcp/about). |
| Dosu | [home](https://dosu.dev/), [pricing](https://dosu.dev/pricing). |
| Augment Cosmos | [public preview announcement](https://www.augmentcode.com/blog/cosmos-now-in-public-preview) (2026-05-04), [Hello, Cosmos](https://www.augmentcode.com/blog/cosmos-the-platform-for-ai-native-engineering-teams). |
| Small tools | [Beads](https://github.com/gastownhall/beads), [Cairn](https://cairn.computer/), [Muster (muster.tools)](https://muster.tools/), [Muster (musterai.org)](https://musterai.org/), [Waymark (waymark-cli)](https://pypi.org/project/waymark-cli). |
