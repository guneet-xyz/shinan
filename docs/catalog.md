# Catalog

Status: **draft for review** ([issue #5](https://github.com/guneet-xyz/shinan/issues/5)).

This document owns the catalog: entity types, facts and fact states,
provenance, editing and approval, and what the wiki and the agent index must
contain. It uses the terms of the [domain model and glossary](domain-model.md)
exactly. It does not choose storage or technology
([architecture](architecture.md), D-020), design screens
([human experience](human-experience.md)), name MCP tools
([agent integrations](agent-integrations.md)) or decide who may approve
([identity](identity.md)).

## How to read this document

Every rule carries one of three markers:

- **Decided**: follows from an accepted decision in the
  [plan](plan.md#6-decisions-so-far), which is cited and gives the reason.
- **Proposed**: suggested here, with a reason. Owner review confirms or changes
  it.
- **Open**: not settled. Listed under [open questions](#open-questions) or
  [decisions needed from the owner](#decisions-needed-from-the-owner).

Code formatting marks literal values, for example the fact state `proposed`.
The word "proposed" in bold is the document marker above; the two are unrelated.

The working prototype is the `workspace` repository's catalog: its
[catalog README](https://git.guneet.dev/guneet/workspace/src/branch/main/catalog/README.md),
[templates](https://git.guneet.dev/guneet/workspace/src/branch/main/templates/README.md)
and [maintenance policy](https://git.guneet.dev/guneet/workspace/src/branch/main/docs/maintenance.md).
Where a rule below comes from that practice, the reason says so. A full mapping
is in [section 13](#13-mapping-from-the-workspace-repositorys-catalog).

## Summary

- A workspace's catalog is a set of Markdown documents, one per catalog entity,
  each with structured fields at the top (frontmatter) and prose below. These
  documents are the source of truth; the wiki and the agent index are generated
  from them (D-006).
- Structured fields hold **facts**. Each fact has a fact state (`intended`,
  `observed`, `proposed`, `unknown`) and points to a **fact check** that records
  the source, the last-checked time, who checked and what exactly was checked
  (D-007).
- The catalog holds identity, routing and observations that no other system
  owns. It links to owning sources for everything else.
- Every change is a catalog proposal. In the first version every proposal
  except an unchanged recheck waits for a person's catalog approval; a relaxed
  setting later lets routine changes apply on their own after validation.
- Disagreements between sources are kept side by side as discrepancies, never
  silently resolved.

## 1. Principles

| # | Principle | Status and reason |
|---|---|---|
| P1 | The Markdown documents are the source of truth. The wiki and the agent index are generated from them and never edited directly. | **Decided** (D-006: people must be able to read it). |
| P2 | Every fact records its state, source and last-checked time. | **Decided** (D-007: trust is the main differentiator). |
| P3 | Link, don't copy. A fact owned by another system is linked, not copied. | **Decided** (plan, "What Shinan does not do"). |
| P4 | `unknown` is a valid answer. Missing, unreachable and not checked are recorded, never filled with guesses. | **Proposed**. Reason: the `workspace` repository's rule; a guessed fact is worse than a known gap because nobody rechecks it. |
| P5 | Intended and observed facts are kept apart, and disagreements are recorded, not resolved by default. | **Proposed** (glossary discrepancy rule). Reason: hiding drift is how catalogs lose trust. |
| P6 | Catalog content is context, not authorization. A runbook, a fact or an approval rule never by itself permits an agent to deploy, connect to a machine or change anything outside the catalog. An incomplete catalog does not permit scanning machines to fill it. | **Proposed**. Reason: the `workspace` repository's access policy says the same; Backstage gives the same warning for its ownership relation ("not to be used by automated processes to for example assign authorization", [Backstage well-known relations](https://backstage.io/docs/features/software-catalog/well-known-relations), checked 2026-11-16). |
| P7 | Nothing is lost. Changes create new revisions; retired entities stay readable. | **Proposed**. Reason: history explains why things are the way they are; see [section 9](#9-history). |
| P8 | The catalog never holds credentials or task status. | **Proposed**. Reason: credentials belong in a secret store; task status is derived on tasks (D-005) and would go stale if copied. |

## 2. Entity documents

### 2.1 One document per entity

Each catalog entity is one Markdown document: frontmatter in YAML between `---`
lines, then a Markdown body.

- **Decided:** Markdown with structured fields at the top (D-006).
- **Proposed:** YAML, restricted to plain maps, lists, strings, numbers,
  booleans, dates and `null` (no anchors, tags or multi-document files).
  Reason: YAML frontmatter is what the `workspace` repository and most Markdown
  tools already use; the restricted subset keeps documents easy to read and
  parse identically everywhere. Unlike the `workspace` repository, which allows
  only `key: value` lines so a dependency-free script can check them, nested
  values are allowed because facts need several fields each.
- **Open (owned by [architecture](architecture.md)):** where the documents are
  stored, and whether a git repository holds or mirrors them (plan question 1).
  This document only requires that a workspace's catalog can be exported as a
  folder of these Markdown files and imported back without loss. Reason: a
  plain export keeps the catalog readable without Shinan and supports
  self-hosting (D-012).

### 2.2 Entity fields

These fields are about the page itself and the catalog's own bookkeeping. They
are not facts about the world, so they carry no fact state.

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Entity ID, see [2.3](#23-ids-and-references). |
| `type` | yes | One of the [entity types](#3-entity-types). |
| `title` | yes | Display name. Can change freely. |
| `summary` | yes | One sentence used in index pages and search results. |
| `status` | yes | Entity status: `active`, `deprecated` or `retired`. Describes the thing, not the page's accuracy. |
| `owner` | yes | The entity owner: a reference to the `person` entity of the responsible member, or `unknown`. |
| `replaced_by` | when retired, if any | Reference to the replacing entity. |
| `aliases` | no | Former IDs, kept so old links still resolve. |
| `restricted` | no | `true` if the whole entity is restricted, see [section 7](#7-sensitive-information). |
| `facts` | no | List of facts, see [section 4](#4-facts). |
| `fact_checks` | no | Map of fact checks, see [4.4](#44-fact-checks). |

- **Proposed.** Reason: these are the `workspace` repository's required fields
  (`id`, `status`, `owner`) plus what the wiki and index need (`type`, `title`,
  `summary`). Entity status values come from the glossary. Treating `status`
  and `owner` as catalog bookkeeping rather than facts keeps every fact
  checkable against something outside the catalog; who changed them and when
  is still recorded in [history](#9-history).
- **Proposed:** the glossary defines the entity owner as a member. In the
  document it is written as the member's `person` entity, and validation warns
  when that entity is not linked to a current member (for example after
  someone leaves). Reason: a readable, stable reference in the Markdown, while
  membership itself stays in the identity records.
- **Proposed:** there is no hand-written page-level "last checked" date. Where
  the wiki or index shows one for a whole entity, it is calculated from the
  entity's facts (for example oldest and newest fact check). Reason: the
  glossary's rule; a page date written by hand claims more than was checked.

### 2.3 IDs and references

- An entity ID is written `<type>/<slug>`, for example `machine/musashi`. The
  slug is lowercase kebab-case and unique within its type. The full ID is
  unique in the workspace. **Proposed.** Reason: the `workspace` repository has
  both a `musashi` project and a `musashi` machine, so slugs alone collide;
  prefixing the type keeps both natural names. This satisfies the glossary's
  "unique in the workspace".
- IDs are stable. A rename changes the `title`. If the slug must change, the
  old ID moves to `aliases` and keeps resolving. **Proposed.** Reason: tasks,
  other entities and agents' notes hold references that must not break.
- A reference to another entity is its ID. In the body, a Markdown link whose
  target is an ID, such as `[Musashi](machine/musashi)`, is a reference.
  References must resolve; validation blocks broken ones. **Proposed.** Reason:
  the `workspace` repository's checker catches missing link targets, which has
  kept its entries consistent.
- Links to owning sources are ordinary URLs. Where the source is versioned,
  prefer a link pinned to a revision (a commit) in fact checks.
  **Proposed.** Reason: "the file said X at revision Y" stays true; "the file
  says X" does not.

### 2.4 Body

The body is prose for people and agents: what the thing is, why it is set up
this way, warnings, and history worth keeping. It follows the
[type's section conventions](#3-entity-types).

- A claim in the body that someone may rely on and that can be checked should
  be a fact in the frontmatter, not only a sentence. The body may explain a
  fact but should not repeat its value. **Proposed.** Reason: only facts carry
  state and freshness; a value in two places drifts. Validation cannot detect
  this, so it is a writing rule checked in review.
- Generated sections (relations in both directions, unknowns, discrepancies,
  pending catalog proposals, related tasks) are added by the wiki and are not
  written in the body. **Proposed.** Reason: the `workspace` repository writes
  "Known unknowns" and location tables by hand; generating them from facts
  removes a second copy.
- **Open:** whether the body may embed a fact's value by reference (for example
  `{{fact:disk.data.size}}`). It removes repetition but makes raw Markdown
  harder to read.

### 2.5 Example

An abbreviated `project/dockyard`, based on the `workspace` repository's entry.
Values are illustrative.

```markdown
---
id: project/dockyard
type: project
title: Dockyard
summary: Self-hosted OCI registry with a web UI and access management.
status: active
owner: person/guneet
facts:
  - key: repository
    value: https://github.com/guneet-xyz/dockyard
    state: observed
    check: c1
  - key: docs.agent_instructions
    value: https://github.com/guneet-xyz/dockyard/blob/main/AGENTS.md
    state: observed
    check: c1
  - key: release.latest
    value: v0.3.1
    state: observed
    check: c1
  - rel: checkout-on
    to: machine/daedalus
    path: /root/dockyard
    state: observed
    check: c2
  - rel: deployed-on
    to: machine/musashi
    state: intended
    check: c3
  - key: deployment.version
    value: v0.3.1
    state: observed
    check: c4
  - key: deployment.built_from_commit
    value: null
    state: unknown
    check: c4
    note: No build attestation was checked; a checkout alone does not prove which source a build used.
fact_checks:
  c1:
    checked: 2026-11-14
    by: guneet via opencode-daedalus
    scope: Repository, agent instructions and latest release exist
    source: https://github.com/guneet-xyz/dockyard/releases/tag/v0.3.1
  c2:
    checked: 2026-11-14
    by: guneet via opencode-daedalus
    scope: Daedalus checkout is a clean main at 022de7d
    source: Local git on Daedalus
  c3:
    checked: 2026-11-14
    by: guneet via opencode-daedalus
    scope: Musashi stack source defines the dockyard stack
    source: https://git.guneet.dev/infra/musashi/src/commit/5b1a4a8/stacks/dockyard/README.md
  c4:
    checked: 2026-11-14
    by: guneet via opencode-daedalus
    scope: Web UI on the running deployment reports its version
    source: HTTPS check of the public endpoint (infra/musashi#85)
---

# Dockyard

Musashi builds Dockyard images locally from a source submodule; it does not
run the published images. Do not assume a newer checkout or release is
deployed. See the [Musashi stack rules](https://git.guneet.dev/infra/musashi/src/branch/main/stacks/dockyard/README.md).

## Cautions

The infrastructure checkout on [Daedalus](machine/daedalus) records the
submodule but does not initialize it. Do not initialize it as a side effect of
reading context.
```

**Proposed** as the shape; exact field names are confirmed when the type
schemas are built. Reason: it keeps the `workspace` repository's content and
habits while giving each fact its own state and check.

## 3. Entity types

The type list is **decided** (plan, Catalog pillar). Each type has a **type
schema**: required and recommended fact keys, allowed relations, body section
conventions and how often each fact should be rechecked. The schemas below are
**proposed**, drawn from the `workspace` repository's templates, which have
worked for its 18 projects, 4 machines, 10 services, 3 runbooks and 3
decisions (counted 2026-11-16).

All types share one rule: each entity says **what belongs elsewhere** and links
to it. Reason: P3.

### project

A body of work with one or more repositories, for example an application or an
infrastructure repository. A project is not a repository: the repository is
the thing on the git host ([git hosts](git-hosts.md)); the project describes it.

- **Facts:** `repository` (one or more, preferably a repository known through a
  git host connection), `docs.readme`, `docs.agent_instructions`,
  `docs.deployment`, `issue_tracker`, `release.latest`.
- **Relations:** `checkout-on` a machine, with the path (one per checkout);
  `deployed-on` a machine; `provides` a service; `depends-on` a service;
  `configures` a machine or service (for infrastructure repositories).
- **Body:** role in one or two sentences; cautions; cross-project context.
- **Belongs elsewhere:** setup, architecture, tests and deployment commands
  (the project's repository); task worktree paths (tasks); task progress
  (tasks).
- **Reason:** the project entry owning checkout locations, and machines not
  repeating project lists, is the `workspace` repository's rule. Here the
  machine's list is generated from the inverse relation.

### machine

A computer: a cloud VM, a home server, a development host.

- **Facts:** `role`, `environment` (development, production and so on),
  `platform.os`, `platform.arch`, `provider`, `access.method`,
  `access.network`, storage facts such as `disk.data.size`, `hostname`
  (restricted).
- **Relations:** `configured-by` a project; `on-network` a service (for example
  Tailscale).
- **Body:** identity and role; access prerequisites (no secrets); operational
  constraints; cautions.
- **Belongs elsewhere:** configuration (the infrastructure repository);
  projects and services on it (generated); credentials (secret store).
- **Reason:** the `workspace` machine template; access prerequisites and
  constraints are what agents most need before touching a machine.

### service

Something running that others depend on: a git host, ingress, DNS, a registry,
monitoring.

- **Facts:** `endpoint` (one or more), `environment`, `deployment.version`.
- **Relations:** `runs-on` a machine, or `provided-by` an outside provider
  described in the body; `configured-by` a project; `depends-on` other
  services.
- **Body:** role and authority; dependencies and operational context;
  cautions.
- **Belongs elsewhere:** live health (the monitoring system, linked);
  configuration; secrets.
- **Reason:** the `workspace` service template. Live health changes by the
  minute, so copying it would always be stale.

### runbook

A real, cross-project procedure, such as rebuilding a machine.

- **Facts:** `last_successful_run` (`observed`, or `unknown` if never run),
  `changes_deployment` (true or false).
- **Relations:** `applies-to` machines, services or projects.
- **Body:** purpose and owning sources; targets and prerequisites; expected
  impact; procedure; verification; rollback and escalation.
- **Rules:** only verified steps or links to owning procedures; untested parts
  are labelled. Steps that change a deployment are marked. A runbook never
  authorizes its own execution (P6).
- **Reason:** the `workspace` runbook template. `last_successful_run` makes
  visible what that repository writes in prose ("has not been run yet").

### decision

A lasting decision with its reasoning, for example how releases are versioned.

- **Fields beyond the common ones:** `decision_state`: `proposed`, `accepted`,
  `rejected` or `superseded`; `decided_on` (date); `decided_by`.
- **Relations:** `supersedes` / `superseded-by` another decision;
  `applies-to` entities; `from-task` the task where it was made
  ([tasks](tasks.md)).
- **Body:** context; decision; alternatives and reasons; consequences;
  replacement.
- **Rules:** a superseded decision is kept and linked to its replacement, never
  rewritten. A decision's state and date are bookkeeping, not facts, because a
  decision is true by being made, not by being observed.
- **Reason:** the `workspace` decision template; the glossary proposes that
  lasting decisions on tasks are promoted to this type. Not to be confused with
  this repository's design decisions in `docs/decisions/`.

### policy

A rule people and agents follow in this workspace, such as "every deployment
change needs the owner's approval" or "never store credentials in the
catalog".

- **Facts:** `enforcement`: `shinan` (Shinan enforces it), `git-host` (for
  example branch protection), or `convention` (people and agents follow it);
  for `shinan` and `git-host`, an `observed` fact that the enforcement is
  actually in place.
- **Relations:** `applies-to` entity types, specific entities or the whole
  workspace; `see-also` runbooks.
- **Body:** the rule; why; what it covers and does not; exceptions.
- **Reason:** the `workspace` repository's policies (maintenance, access and
  safety, collaboration) are what agents most need, and they currently live
  outside the catalog. As entities they gain owners, history and approval, and
  the agent index can return "the policies that apply to this machine".
- **Open:** whether Shinan itself enforces any policy beyond its own settings
  (for example catalog approval rules, which are workspace settings owned by
  [identity](identity.md), and which a policy entity may describe for readers).

### person

Describes a person for readers: responsibilities, areas they own, how to reach
them for this work.

- **Facts:** `member` (link to the member record, or none); responsibilities as
  prose.
- **Rules:** never copies sign-in, role, git host accounts or contact details
  that the identity records own; links to them. Personal data is kept to what
  the work needs. **Proposed** (glossary). Reason: one home for identity.
- **Non-members:** a `person` entity can describe someone who is not a member,
  such as a former member or an outside maintainer; it then has no `member`
  link and holds only what the work needs. **Proposed** (glossary). Reason:
  ownership and history must still name people who left or never joined.

### agent

Describes an agent for readers: what it is used for, its usual machines, any
workspace-specific conventions.

- **Facts:** `agent_record` (link to the agent's identity record); `usual-machine`
  relations (informational; the machine of each agent session is recorded per
  session, per the glossary).
- **Rules:** never holds tokens or permissions; links to the identity record.
  **Proposed** (glossary). Reason: as for `person`.

### Types not in the list

- **Repository** is not a type; repositories come from git host connections
  and are referenced by `project` facts. **Proposed** (glossary). Reason: the
  git host owns the repository.
- **Custom types** defined by a workspace: **proposed** not in the first
  version. Reason: the eight types cover the `workspace` repository's whole
  catalog, and custom types multiply schema, validation and index work. A fact
  key outside the type schema is allowed but flagged in review, so needs show
  up before new types are added.

## 4. Facts

### 4.1 What a fact is

A fact is one structured value in an entity's frontmatter: either a **keyed
fact** (`key` and `value`) or a **relation** (`rel` and `to`, see
[section 5](#5-relations)). The body is not made of facts.

- **Proposed** (the glossary leaves the unit to this document, naming "a
  structured field or an explicitly marked statement" as options). Reason:
  per-field facts are what D-007 asks for and what the agent index can query;
  page-level checks (the `workspace` repository's `last_verified`) cannot say
  which part was checked, which is why that repository already writes long
  `verification_scope` lists. Marked statements inside prose were rejected
  because they are harder to validate and to edit as single operations.
  Per-section facts would still mix fresh and stale claims. This is listed
  under [decisions needed](#decisions-needed-from-the-owner) because it shapes
  everything else.

A key may appear more than once when the values come from different sources or
states (for example an `intended` and an `observed` value). Each item is then
its own fact. **Proposed.** Reason: this is how discrepancies are recorded
([4.6](#46-discrepancies)).

### 4.2 Fact fields

| Field | Required | Meaning |
|---|---|---|
| `key` or `rel` + `to` | yes | What the fact is about. Keys are lowercase, dotted (`platform.arch`). |
| `value` | for keyed facts | String, number, boolean, date, URL, entity reference, or a list of these. `null` only with state `unknown`. |
| `state` | yes | Fact state, see [4.3](#43-fact-states). |
| `check` | see 4.3 | The ID of a [fact check](#44-fact-checks) on the same entity. |
| `task` | for `proposed` | The task (or accepted `decision` entity) behind the change. |
| `note` | no | Short explanation, especially for `unknown` and discrepancies. |
| `restricted` | no | `true` for a restricted fact, see [section 7](#7-sensitive-information). |

**Proposed.** Reason: the smallest set that satisfies D-007 and the
`workspace` repository's evidence rules.

### 4.3 Fact states

The four state names are **decided** (plan, Catalog pillar). Their meanings
follow the glossary's [fact state test](domain-model.md#fact-state): if the
owning source declares something now, it is `intended`, even if not yet
applied; if it is agreed but not yet in the owning source, it is `proposed`.
The rules for each are **proposed**:

| State | Means | Needs a fact check? | Source must be |
|---|---|---|---|
| `intended` | The owning source currently declares this should be true. | Yes. | The owning source, pinned to a revision where possible, or a `decision` or `policy` entity. |
| `observed` | Someone saw this when they checked. | Yes. | A description of the observation (what, how, from where), optionally linking the task or event. |
| `proposed` | An accepted change that the owning source does not yet declare. | No. | The `task` (or accepted `decision` entity) behind it. |
| `unknown` | Not known. | Optional: with a check it means "looked and could not tell"; without, "never looked". | As for `observed`, if a check is given. |

Rules:

- A `proposed` fact never turns into another state by itself. When the owning
  source declares the change, a new `intended` fact replaces it; when the
  change is seen in the world, a new `observed` fact records it. Both come
  with fact checks. **Proposed.** Reason: the `workspace` repository's rule
  that "planned changes are proposals until implemented and verified".
- A merged change that is not yet applied is `intended`; its absence in the
  world shows as a [discrepancy](#46-discrepancies) with the `observed` fact.
  **Proposed** (glossary test). Reason: drift between source and reality is
  exactly what the catalog should surface.
- When the task behind a `proposed` fact ends without delivering it (for
  example it is cancelled), the fact is flagged for removal. **Proposed.**
  Reason: abandoned plans otherwise linger as false promises. Depends on task
  events from [tasks](tasks.md).
- **Open (decision needed):** renaming `proposed` to `planned`. The glossary
  recommends it because `proposed` collides with "catalog proposal" and with
  document status. This document works either way; a rename is a
  find-and-replace of the value.

### 4.4 Fact checks

A **fact check** records one act of checking. Several facts can share one
check when they were checked together.

| Field | Required | Meaning |
|---|---|---|
| `checked` | yes | When the check actually happened: a date, or date and time. Not when the page was edited or the proposal applied. |
| `by` | yes | The actor who checked: a person, or an agent session acting for a person, written as the [identity](identity.md) document defines. Shinan for automatic fact checks. |
| `scope` | yes | What exactly was checked, in one line. |
| `source` | yes | Where the evidence is: a URL (pinned where possible), a repository revision, or a short description of the observation. No raw logs or sensitive output. |

- **Decided** that each fact records source and last-checked time (D-007).
- **Proposed:** the shared, named check record and these fields. Reason: they
  are the `workspace` repository's `last_verified`, `verification_scope` and
  `verification_source`, moved from page level to the facts they cover. Sharing
  one check across facts avoids repeating the same evidence ten times.
- **Proposed:** rechecking a fact without changing it adds a new fact check
  and points the fact at it. Checking one fact never refreshes others.
  Reason: the `workspace` repository's rule against refreshing dates
  mechanically.
- **Proposed:** fact checks no fact refers to any more are dropped from the
  current document; they remain in [history](#9-history). Reason: keeps
  frontmatter short.
- **Proposed:** when a check goes through Shinan, the `by` value must match the
  actor Shinan records for the catalog proposal, with its attribution
  confidence. Reason: a self-declared `by` that disagrees with Shinan's own
  record would undermine trust; see [identity](identity.md).

### 4.5 Freshness

Freshness is the time since a fact's last check. It is a risk signal, never a
verdict: an old fact is not wrong, it is less certain.

- Each fact key in a type schema may set a **recheck interval**, for example
  `disk.data.free`: 7 days; `repository`: 180 days; `platform.arch`: none. A
  fact past its interval is shown as **due for recheck**. **Proposed.** Reason:
  the `workspace` repository rejects one universal interval, but how volatile a
  fact is depends on its key, so a per-key hint is useful.
- Facts never checked are shown as **not checked**. `proposed` facts have no
  freshness. **Proposed.**
- Agents must recheck volatile or consequential facts before acting on them
  (for example before a deployment). **Proposed.** Reason: the `workspace`
  repository's rule. The convention itself is owned by
  [agent integrations](agent-integrations.md); the catalog supplies the
  checked time and interval.
- How freshness looks: [human experience](human-experience.md).
- **Open:** the actual interval values; they are set while building the type
  schemas.

### 4.6 Discrepancies

A **discrepancy** exists when two current facts with the same key (or the same
relation and target) have different values and neither is `proposed`. Typical
cases:

- `intended` differs from `observed` (the configuration repository says one
  thing, the machine shows another);
- two `observed` facts from different sources differ (the `workspace`
  repository records Azure instance metadata reporting 64 GB after the disk
  had been grown to 128 GiB).

Rules (**proposed**; reason: P5 and the `workspace` repository's practice):

- Both facts are kept with their fact checks. Neither wins by default, by state, or
  by which was written last.
- Discrepancies are detected automatically, shown prominently in the wiki and
  returned with the entity in the agent index.
- A discrepancy is resolved by one of: changing the world (a task, then a new
  check); changing the owning source (then a new `intended` check); or
  recording that the difference is accepted, with a `note` and an owner. An
  accepted discrepancy stays visible but is not flagged as needing attention.
- A `proposed` fact that differs from current facts is a plan, not a
  discrepancy.

### 4.7 Unknowns

Every `unknown` fact appears in the entity's generated **known unknowns** list
and in a workspace-wide list. **Proposed.** Reason: the `workspace` repository
writes "Known unknowns" by hand on every entry; generating it keeps it honest.
Required facts of a type that are missing are treated as `unknown` "never
looked" (not as errors) so new entities can be created from partial
knowledge. **Proposed.** Reason: the `workspace` templates say to record
`unknown` rather than invent information.

## 5. Relations

A relation is a fact whose value is another entity: `rel` names the relation,
`to` the target. It has a state and a check like any fact. "Dockyard's
deployment runs on Musashi" (the glossary's example of a fact) is a relation.

- **Proposed:** relations are facts. Reason: relations go stale like any other
  claim, and the glossary's own fact example is a relation.
- **Proposed:** each relation is written on one side only and its inverse is
  generated, for example `checkout-on` on the project produces "checkouts" on
  the machine. Reason: the `workspace` repository forbids machines repeating
  project lists; Backstage likewise generates inverse pairs such as `ownedBy`
  and `ownerOf` (checked 2026-11-16, link in P6).
- **Proposed:** a relation may carry small attributes, such as the `path` of a
  checkout. Reason: a checkout is meaningless without its path, and making it a
  separate entity would be heavy.
- **Proposed:** a fixed vocabulary per type pair, initially:

| Relation | From | To | Inverse shown on target |
|---|---|---|---|
| `checkout-on` (with `path`) | project | machine | checkouts |
| `deployed-on` | project | machine | deployments |
| `provides` | project | service | provided by |
| `runs-on` | service | machine | services |
| `configured-by` | machine, service | project | configures |
| `depends-on` | project, service | service | dependents |
| `on-network` | machine | service | members |
| `applies-to` | runbook, policy, decision | any entity or type | runbooks, policies, decisions |
| `supersedes` | decision | decision | superseded by |
| `from-task` | decision | task | decisions |
| `usual-machine` | agent | machine | agents |

  Reason: a small fixed set keeps generated inverses readable and queryable;
  the [glossary](domain-model.md) asks this document to settle how
  relationships are expressed (plan question 5).
- `owner` and `replaced_by` are entity fields, not relations, but the wiki
  shows their inverses too ("owns", "replaces"). **Proposed.**
- Links between catalog entities and tasks ("this task touched this entity")
  are owned by [tasks](tasks.md); the catalog shows them, generated, on the
  entity page. **Proposed.** Reason: task links change with the work and must
  not be written into catalog documents.
- Task worktree paths are not catalog facts. **Proposed.** Reason: the
  `workspace` repository's rule; they are temporary and machine-local.

## 6. Link, don't copy

The catalog holds three kinds of information and links to everything else.
**Decided** in principle (P3); the split below is **proposed**, from the
`workspace` repository's ownership table.

| The catalog holds | Example |
|---|---|
| Identity and routing: what exists, where, who owns it, what depends on what. | Dockyard has a checkout at `/root/dockyard` on Daedalus. |
| Observations no other system records. | Musashi's Docker address pools were exhausted on 2026-11-14. |
| Cross-project knowledge: runbooks, decisions and policies. | Every deployment change needs the owner's approval. |

| The catalog links to | Owner |
|---|---|
| Setup, architecture, tests, deployment commands | The project's repository |
| Infrastructure configuration | The infrastructure repository |
| Task intent, progress, acceptance criteria | [Tasks](tasks.md) |
| Pull requests, issues, CI results | Git hosts ([git hosts](git-hosts.md)) |
| Live health and metrics | The monitoring system |
| Sign-in, roles, tokens, git host accounts | [Identity](identity.md) |
| Credentials | A secret manager; never the catalog |

An `intended` fact may repeat a value from its owning source (for example the
port a configuration file sets) when readers need it for routing, because its
fact check pins the revision it came from. Commands and whole configuration
blocks are never copied. **Proposed.** Reason: a pinned value can be checked
for staleness against its source; a copied command block cannot, and invites
running outdated instructions.

## 7. Sensitive information

The web app is on the public internet behind sign-in and holds infrastructure
details (D-015), so the catalog needs two protections.

- **No credentials, ever.** Every catalog proposal is scanned for things that
  look like secrets (private keys, tokens, passwords); a match blocks it.
  **Proposed.** Reason: P8; once applied, a secret is in history and must be
  purged ([section 9](#9-history)). The `workspace` repository relies on
  reviewers to catch this; automation is cheaper and more reliable.
- **Restricted facts and entities.** A fact or entity can be marked
  `restricted` (for example internal addresses, host key fingerprints, account
  layouts). Restricted content is hidden from readers who lack access, in both
  the wiki and the agent index. Who has access is owned by
  [identity](identity.md). **Proposed.** Reason: some routing facts are
  harmless to the team but useful to an attacker; a whole-workspace boundary
  alone is coarse once viewers and outside readers are invited (D-019).
  Listed under [decisions needed](#decisions-needed-from-the-owner).

## 8. Editing and approval

### 8.1 Catalog proposals

Every change to the catalog, by a person or an agent, is a catalog proposal.
A proposal is applied (immediately or after catalog approval), rejected or
withdrawn, with the states `pending`, `applied`, `rejected`, `withdrawn` from
the glossary.

- **Decided** that agents propose and people approve where needed (plan,
  Catalog pillar).
- **Proposed:** people's own edits are also catalog proposals. Reason: one
  path for every change gives one history, one validation and one event
  stream.
- **Proposed:** only people give catalog approval (glossary). Reason: an agent
  acts for a person, so an agent approving would be that person approving
  without looking. A person may approve proposals by their own agents; with
  one user this is the normal case.

A catalog proposal contains (**proposed**; reason: what a reviewer and the
history need):

- the author (actor) and, where there is one, the related task;
- a short explanation of why;
- the changes, as a list of operations, each stating the value it expects to
  replace (see [8.5](#85-conflicts));
- for every new or changed fact, its fact check (evidence).

**Operations** (**proposed**): create entity; set or remove a fact; add a fact
check (a recheck); edit body (whole body or one section); change an entity field
(title, summary, status, owner); retire; change ID. Agents send operations
through MCP or the CLI ([agent integrations](agent-integrations.md)); the web
editor and any outside Markdown edit ([8.7](#87-edits-outside-shinan)) are
turned into the same operations. Reason: operations on single facts rarely
conflict and make review precise ("disk.data.size: 64 GiB → 128 GiB"), where a
whole-file diff hides what changed.

One proposal may change several entities and is applied all or nothing.
**Proposed.** Reason: retiring a machine and moving its checkouts must not
half-happen.

### 8.2 When catalog approval is needed

The glossary proposes a strict first version: every catalog proposal needs
catalog approval except a recheck that leaves the claim unchanged, and
workspace settings may relax this later. This document adopts that as the
first-version default and proposes the shape of the relaxed setting, so that
the change after the proof of concept is a settings switch, not a redesign.
Settings and who may approve are owned by [identity](identity.md).

| Class | Examples | First version | Relaxed setting (proposed) |
|---|---|---|---|
| Recheck | New fact check, value unchanged | Applies on its own | Applies on its own |
| Observed or unknown facts | Add or change an `observed`/`unknown` fact or relation | Needs catalog approval | Applies on its own |
| Intended facts | From an owning source pinned to a revision | Needs catalog approval | Applies on its own |
| Planned changes | Add or remove a `proposed` fact | Needs catalog approval | Applies on its own |
| Body and bookkeeping | Body text, title, summary, new entity of type project, machine, service or runbook | Needs catalog approval | Applies on its own |
| Rules | Create or change a `policy`; change a `decision` to `accepted`, `rejected` or `superseded`; the start-here document | Needs catalog approval | Needs catalog approval |
| Lifecycle | Deprecate, retire, change ID, change owner | Needs catalog approval | Needs catalog approval |
| People and agents | Any change to `person` or `agent` entities | Needs catalog approval | Needs catalog approval |
| Exposure | Removing `restricted` from a fact or entity | Needs catalog approval | Needs catalog approval |
| Doubtful | A recheck or change whose fact check is older than the current one; accepting a discrepancy; breaking a warning rule of validation | Needs catalog approval | Needs catalog approval |

- **Proposed:** the first-version column. Reason: the glossary's reason,
  starting strict while trust in the catalog is being built; the proof of
  concept covers a few projects only (D-018), so the volume is small.
- **Proposed:** the relaxed column, for a workspace owner to switch on.
  Reason: today agents merge routine changes to the `workspace` repository's
  catalog themselves, under standing authority, after validation. At that
  scale, approving every fact would bury one person and push agents to skip
  updates. People keep control of what changes the rules, what is hard to
  undo, and what exposes information.
- **Proposed:** a person's own edit that would need catalog approval is
  applied at once when that person may approve it. Reason: approving one's own
  edit is a formality.

Changes that apply on their own still appear in a **recent changes** feed,
grouped per proposal, and can be reverted with one action (a new proposal
restoring the earlier values). **Proposed.** Reason: review after the fact
keeps people informed without blocking agents. The feed's design is owned by
[human experience](human-experience.md).

### 8.3 Validation

Every proposal is validated before it applies or reaches a reviewer.
**Proposed.** Reason: the `workspace` repository's `scripts/check.py` does this
for links and frontmatter and is the main reason its entries stay consistent.

Blocking rules (the proposal cannot apply):

- frontmatter parses; required entity fields present; `type` and `status`
  valid;
- references (`owner`, `to`, body links to entity IDs, `check`) resolve;
- every non-`proposed`, non-`unknown` fact has a fact check with all four
  fields, and `checked` is not in the future;
- `proposed` facts link a task or an accepted decision;
- relation used between allowed types;
- no secret-like content ([section 7](#7-sensitive-information));
- no task status copied into facts (for example a `status` key holding a task
  status value).

Warning rules (the proposal needs catalog approval, with the reason shown):

- fact key not in the type schema;
- the new fact check is older than the one it replaces;
- an external link does not respond (when link checking exists; **open**).

Validation cannot prove a fact matches reality; only fact checks do.

### 8.4 Agents' documentation-impact obligation

When an agent's work changes or checks a durable fact that the catalog
records, the agent proposes the update before it reports the work as done, or
records on the task exactly what update is pending and why. **Proposed.**
Reason: this is the `workspace` repository's "documentation-impact check", the
habit that keeps that catalog current. The obligation is scoped to the task,
not a duty to refresh everything, and it never authorizes extra access (P6).
How tasks show this, and whether it is part of "done", is owned by
[tasks](tasks.md); how agents are reminded, by
[agent integrations](agent-integrations.md).

### 8.5 Conflicts

Each operation states the value (and fact check) it expects to replace. If the
current value is different when the proposal is applied, that operation
conflicts. **Proposed.**

- A conflicting proposal does not apply on its own. Its author is told and can
  refresh it; otherwise a person resolves it.
- Competing claims are resolved from evidence and check time, not from which
  proposal arrived last. Two different values with valid fact checks may both be
  kept as a discrepancy.
- Reason: the `workspace` repository's rule ("resolve competing claims from
  evidence and observation time, not merge order"); per-fact operations make
  real conflicts rare.

### 8.6 Who sees and reviews proposals

Pending catalog proposals are shown on the entities they touch and in a review
list; agents can read them through the agent index so they do not duplicate
one another. Members and agents can comment on a proposal; only people
approve. **Proposed.** Reason: agents working in parallel need to see pending
changes, as they see open pull requests today.

### 8.7 Edits outside Shinan

If the documents can be edited outside Shinan (for example in a git
repository, should [architecture](architecture.md) choose one), such edits
enter as catalog proposals, attributed to whoever made them with the
attribution confidence Shinan can establish, and go through the same
validation and catalog approval. **Proposed.** Reason: there must be one path to
change the source of truth, or catalog approval and history mean nothing.
**Open (decision needed):** whether catalog proposals are native to Shinan or
are pull requests on a git repository that holds the documents.

## 9. History

- Every applied proposal creates a new **catalog revision** of the documents it
  changed and an event credited to its author (and approver), which appears on
  the entity's timeline. **Proposed.** Reason: events are the glossary's single
  record of what happened; revisions let anyone see an entity as it was.
- Revisions are not edited. A revert is a new proposal. **Proposed.** Reason:
  the glossary's rule that events are not edited.
- Retired entities stay readable, marked retired, linked to their replacement,
  and excluded from default search. **Proposed.** Reason: the `workspace`
  repository keeps retired entries (for example the Takezo machine) because
  their history still answers questions.
- **Purge** removes content from all revisions, for leaked secrets or personal
  data only. Only a workspace owner can purge; a purge leaves an event saying
  what was removed and why, without the content. **Proposed.** Reason: some
  content must not survive, but its removal must be visible. This is the
  catalog's answer to the glossary's open question on redaction; the
  installation-wide rule, including events, belongs to
  [architecture](architecture.md) and [identity](identity.md).
- How revisions are stored: [architecture](architecture.md).

## 10. The wiki

The wiki is the catalog shown to people. Its layout, navigation and editing
screens are owned by [human experience](human-experience.md). The catalog
requires it to show (**proposed**; reason: these are what make the catalog
trustworthy at a glance, per D-007):

- the body, rendered;
- every fact with its state, value, freshness (age, and "due for recheck" or
  "not checked") and a link to its fact check's source and scope;
- discrepancies, prominently, with both sides' evidence;
- generated sections: inverse relations, known unknowns, pending catalog
  proposals, related tasks, the entity timeline;
- restricted content only to readers allowed to see it, with a visible note
  that something is hidden;
- index pages per entity type, from `title`, `summary`, `status` and `owner`
  (replacing the hand-written tables in the `workspace` repository's catalog
  README files);
- workspace-wide lists: discrepancies, facts due for recheck, unknowns,
  recent changes, and catalog proposals waiting for catalog approval.

## 11. Start here

A new person or a new agent needs a short path through the catalog. The plan
names a "start here" path (Wiki and onboarding pillar, owned by
[human experience](human-experience.md)); this section defines its content.

- Each workspace has one **start-here document**, written in Markdown like an
  entity and changed through catalog proposals, but not an entity type and
  holding no facts. **Proposed.** Reason: the start-here path is a curated
  route, not a thing in the world, so it should not pretend to have facts;
  keeping it in the catalog gives it history and approval. Changing it needs
  catalog approval by default, because it shapes how agents behave.
  Listed under [decisions needed](#decisions-needed-from-the-owner).
- It holds two ordered paths of entity references with a sentence on each:
  - **for people:** what the workspace covers, the main projects, machines and
    services, the policies that matter, who owns what;
  - **for agents:** the policies to follow first (for example safety and
    deployment approval), how to find context for a task, the
    documentation-impact obligation ([8.4](#84-agents-documentation-impact-obligation)),
    and where to propose changes.

  **Proposed.** Reason: the `workspace` repository has the same split today:
  its README "Start here" for people and `AGENTS.md` plus
  `docs/agent-entrypoint.md` for agents.
- It links and does not copy: each step is a reference to an entity (usually a
  policy or runbook) or a generated list. Validation warns when a step points
  to a retired entity or to one with discrepancies. **Proposed.** Reason: P3;
  onboarding pages are where copies go stale fastest.
- Generic rules that every Shinan agent follows in every workspace (how to use
  the MCP tools, how to report presence) are not in this document; they ship
  with the skill ([agent integrations](agent-integrations.md)). The agents'
  path contains only this workspace's rules. **Proposed.** Reason: separates
  product conventions from team policy.
- How agents receive the agents' path (for example when an agent session
  starts, through the skill or MCP): [agent integrations](agent-integrations.md).
- **Open:** whether larger workspaces need more than one path (per team or
  per role).

## 12. The agent index

The agent index is a machine-readable form of the catalog, generated from the
documents (D-006, **decided**). Agents read it through MCP and the CLI; the
tool names and query shapes are owned by
[agent integrations](agent-integrations.md); how it is kept in sync is owned
by [architecture](architecture.md) (plan question 1).

### 12.1 Content

For each entity (**proposed**; reason: everything an agent needs to decide
whether it can rely on a fact, in one read):

- entity fields (`id`, `type`, `title`, `summary`, `status`, `owner`,
  `replaced_by`, `aliases`);
- every fact with its state, value, note and its fact check inlined
  (`checked`, `by`, `scope`, `source`), plus the recheck interval from the
  type schema;
- relations in both directions (written and generated);
- discrepancies and unknowns;
- the policies and runbooks that apply to it (through `applies-to`, including
  ones that apply to its type or to the whole workspace);
- pending catalog proposals touching it;
- the body, split by heading so a search can return one section;
- the catalog revision it was generated from.

Workspace-level entries: the agents' start-here path, and the lists of
discrepancies, facts due for recheck and unknowns.

### 12.2 Rules

- **Generated only.** Nothing writes to the index except generation from the
  documents; changes go through catalog proposals. **Decided** (D-006).
- **Every answer names the catalog revision.** **Proposed.** Reason: the
  `workspace` repository asks agents to state the revision they consulted;
  with it, an agent's claim "the catalog said X" can be checked later.
- **Lag is visible.** If the index is behind the latest applied revision, the
  answer says so. **Proposed.** Reason: a silently stale index is the failure
  D-007 exists to prevent.
- **Freshness is computed when read**, from `checked` and the current time,
  not stored. **Proposed.** Reason: stored ages are wrong a day later.
- **Access rules apply.** Restricted content is left out for agents whose
  member cannot see it, and the answer says something was left out.
  **Proposed.** Reason: [section 7](#7-sensitive-information); an agent never
  sees more than its member ([identity](identity.md)).
- **Format:** **proposed** structured JSON per entity, following the same
  field names as the documents. Reason: every coding tool and MCP client
  handles JSON; matching names mean agents learn one vocabulary. The exact
  schema is written with the first version.
- **Queries the index must support** (names and shapes owned by
  [agent integrations](agent-integrations.md)), **proposed**: get an entity by
  ID or alias; list by type and status; text search across titles, summaries,
  facts and body sections; neighbours through relations; the policies and
  runbooks for an entity; context for a task's related entities; and the
  workspace lists in 12.1.

### 12.3 Automatic fact checks by Shinan

Some facts can be checked by Shinan itself through its git host connections,
for example that a `repository` exists and is reachable. Such checks are fact
checks with Shinan as the actor and go through the same catalog proposals.
**Proposed.** Reason: cheap, reliable rechecks of routing facts keep the
catalog fresher without agent effort. Which facts, and when, depends on
[git hosts](git-hosts.md) and the [roadmap](roadmap.md); **open** whether this
is in the first version. Shinan never connects to machines to check facts
(P6).

## 13. Mapping from the `workspace` repository's catalog

The move itself is owned by the [roadmap](roadmap.md) (D-018). This mapping
shows that the model above can hold what the `workspace` repository holds
today. **Proposed.**

| `workspace` repository | Shinan catalog |
|---|---|
| Entry file `catalog/machines/musashi.md`, `id: musashi` | Entity `machine/musashi` |
| `status: active / deprecated / retired` | Entity status, same values |
| `owner: guneet` / `unknown` | `owner: person/guneet` / `unknown` |
| `last_verified`, `verification_scope`, `verification_source` | Fact checks. On import, the page-level check becomes one fact check on all facts extracted from the page; dated items in long scopes become separate checks where they can be told apart. |
| `last_verified: null` | Facts without a fact check ("not checked") |
| Values written `unknown`; "Known unknowns" sections | `unknown` facts; generated known-unknowns list |
| "Locations" tables | `checkout-on` relations with `path` |
| "Authoritative sources" lists | Keyed facts (`repository`, `docs.*`, `issue_tracker`) |
| Discrepancies written in prose | Paired facts, detected as discrepancies |
| `templates/*.md` | Type schemas |
| `runbooks/`, `decisions/` | `runbook` and `decision` entities (decision `status` becomes `decision_state`) |
| `docs/maintenance.md`, `docs/access-and-safety.md`, parts of `docs/collaboration.md` | `policy` entities |
| `README.md` "Start here", `AGENTS.md`, `docs/agent-entrypoint.md` | Start-here document; product-wide parts move to the skill |
| `scripts/check.py` | Validation on every catalog proposal |
| Pull requests changing catalog files; `CHANGELOG.md` | Catalog proposals; revisions and events (no changelog file) |
| Forgejo issues | Tasks ([tasks](tasks.md)) |

Extracting facts from prose cannot be fully automatic. **Proposed:** import
each entry with its prose as body and its page-level check, then extract facts
gradually, entity by entity, through ordinary catalog proposals. Reason: a
lossless first import, then improvement through the normal flow, avoids a
risky one-shot conversion.

## Dependencies on other documents

| Document | What this document needs from it |
|---|---|
| [Domain model and glossary](domain-model.md) | Terms used here. After it merges, it should gain the new terms proposed here: fact check, type schema, relation, catalog revision, start-here document, recheck interval, restricted; clarify that an entity ID is written `<type>/<slug>`; and record the owner's answers on fact granularity and the `planned` rename. Its first-version catalog approval rule is adopted here; the relaxed setting and the shared-fact-check model should be reflected there. |
| [Architecture and operations](architecture.md) | Storage of documents and revisions; whether a git repository holds or mirrors them; generating and syncing the agent index (plan question 1); export and import; secret scanning. |
| [Identity, agents and permissions](identity.md) | Who may approve catalog proposals and change approval settings; how actors are written in `by`; who may see restricted content; purge rights. |
| [Agent integrations](agent-integrations.md) | MCP and CLI operations for reading the index and sending catalog proposals; delivering the agents' start-here path; the recheck-before-acting and documentation-impact conventions. |
| [Human experience](human-experience.md) | Wiki pages, freshness display, discrepancy display, editors, review list and recent changes feed, start-here presentation. |
| [Tasks and work](tasks.md) | Links between tasks and entities; `proposed` facts tied to tasks and what happens when a task is cancelled; promoting task decisions to `decision` entities; whether the documentation-impact obligation is part of "done". |
| [Git host integrations](git-hosts.md) | Repository identity for `project` facts; which facts Shinan can check automatically. |
| [Roadmap and migration](roadmap.md) | Moving the `workspace` repository's catalog; whether automatic checks are in the first version. |
| [Decision log](decisions/) | Records for the owner's decisions below once made. |

## Proposed in this document

1. [Principles](#1-principles) P4 to P8, including "catalog content is context,
   not authorization".
2. Restricted YAML frontmatter; [entity fields](#22-entity-fields) as
   bookkeeping, not facts.
3. [IDs](#23-ids-and-references) written `<type>/<slug>`, stable, with aliases.
4. Body rules: checkable claims become facts; generated sections are not
   hand-written.
5. [Type schemas](#3-entity-types) for all eight types, the relation
   vocabulary, and no custom types in the first version.
6. [A fact is one structured field or relation](#41-what-a-fact-is).
7. [Rules per fact state](#43-fact-states) and [shared fact checks](#44-fact-checks).
8. [Per-key recheck intervals](#45-freshness) as a risk signal.
9. [Discrepancy](#46-discrepancies) detection and resolution.
10. [Relations are facts](#5-relations), written on one side, with generated
    inverses.
11. The [hold-versus-link split](#6-link-dont-copy).
12. [Secret blocking and restricted content](#7-sensitive-information).
13. [Every change is a catalog proposal of operations](#81-catalog-proposals);
    [default catalog approval rules](#82-when-catalog-approval-is-needed);
    [validation](#83-validation); [conflict handling](#85-conflicts).
14. The [documentation-impact obligation](#84-agents-documentation-impact-obligation)
    for agents.
15. [History](#9-history): revisions, reverts, retired entities, purge.
16. [Wiki requirements](#10-the-wiki), the
    [start-here document](#11-start-here) and the
    [agent index](#12-the-agent-index) content and rules.
17. [Mapping](#13-mapping-from-the-workspace-repositorys-catalog) and gradual
    import from the `workspace` repository.

## Open questions

1. Body embeds of fact values (`{{fact:...}}`): worth the loss of raw
   readability? ([2.4](#24-body))
2. Recheck interval values per fact key. ([4.5](#45-freshness))
3. Whether Shinan enforces any `policy` beyond its own settings.
   ([3](#policy))
4. External link checking: whether, how often, and from where.
   ([8.3](#83-validation))
5. Automatic fact checks through git host connections in the first version or
   later. ([12.3](#123-automatic-fact-checks-by-shinan))
6. More than one start-here path for larger workspaces. ([11](#11-start-here))
7. Whether an agent reviewer step (agents commenting on catalog proposals
   before a person decides) should be built in, as reviewer agents are used
   for documents today. ([8.6](#86-who-sees-and-reviews-proposals))
8. Exact agent index JSON schema, written with the first version.
   ([12.2](#122-rules))

## Decisions needed from the owner

| # | Question | Recommended | Reason |
|---|---|---|---|
| 1 | How fine-grained is a fact? (the glossary leaves the unit to this document) | One structured field or one relation, with shared fact checks; prose is not facts. | Only per-field facts let the catalog say which part is fresh, which D-007 requires. |
| 2 | Rename the fact state `proposed` to `planned`? (also an owner decision in the glossary) | Rename to `planned`. | "Proposed" already means a catalog proposal and a document status; three meanings will confuse readers and agents. |
| 3 | Are catalog proposals native to Shinan, or pull requests on a git repository holding the documents? | Native to Shinan, with a lossless Markdown export (and an optional read-only git mirror if architecture wants it). | Per-fact operations, auto-apply rules and fast agent edits do not fit a pull request per fact check; export keeps the Markdown portable. |
| 4 | Catalog approval rules ([8.2](#82-when-catalog-approval-is-needed)): the glossary's strict first version, plus a relaxed setting for later? | Yes: strict during the proof of concept; offer the relaxed setting (routine facts, rechecks and body edits apply on their own with a recent changes feed; rules, lifecycle, people and agents, and exposure still need catalog approval) and decide whether to switch it on after the proof of concept. | Strict is cheap at proof-of-concept volume and builds trust; the relaxed setting matches today's standing authority once volume grows. |
| 5 | Entity IDs as `<type>/<slug>`? | Yes. | The `workspace` repository already has `musashi` as both a project and a machine. |
| 6 | Restricted facts and entities in the first version? | Yes, one level (`restricted`), with access set by the identity document. | The app is public behind sign-in (D-015), and invited viewers should not see every address and fingerprint. |
| 7 | Custom entity types in the first version? | No; allow unknown fact keys, flagged in review. | Eight types cover the whole `workspace` repository's catalog; flagged keys show real needs first. |
| 8 | Start here as a special catalog document (not an entity type) with separate paths for people and agents, changed only with catalog approval? | Yes. | It is a curated route, not a thing with facts, and it steers agent behaviour, so changes deserve a person's look. |
