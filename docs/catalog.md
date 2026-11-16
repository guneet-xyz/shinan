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
and [maintenance policy](https://git.guneet.dev/guneet/workspace/src/branch/main/docs/maintenance.md),
read at revision `86bba32`. Where a rule below comes from that practice, the
reason says so. A full mapping is in
[section 13](#13-mapping-from-the-workspace-repositorys-catalog).

## Summary

- A workspace's catalog is a set of Markdown documents, one per catalog entity,
  each with structured fields at the top (frontmatter) and prose below. Every
  applied catalog revision **is** a set of Markdown documents; the wiki, the
  agent index and every query table are derived from them and can be rebuilt
  from them alone (D-006).
- Structured fields hold **facts**, grouped under the **fact check** that last
  checked them. A fact check records when, by whom, what exactly was checked,
  what was not, and the source (D-007). Each fact has a fact state
  (`intended`, `observed`, `proposed`, `unknown`).
- Type schemas say whether each fact key holds one value or many. Only
  single-valued keys can have discrepancies, which are kept side by side,
  never silently resolved.
- The catalog holds identity, routing and observations that no other system
  owns. It links to owning sources for everything else.
- Every change is a catalog proposal. Which proposals need a person's catalog
  approval is an owner decision; this document recommends that routine changes
  apply on their own and that rules, lifecycle, people and exposure stay
  gated.

## 1. Principles

| # | Principle | Status and reason |
|---|---|---|
| P1 | The Markdown documents are the source of truth. Every applied catalog revision is a set of Markdown documents; the wiki, the agent index and all query tables are derived and rebuildable from them alone, and never edited directly. | **Decided** that the Markdown is the source of truth and the index is generated (D-006: people must be able to read it). The "rebuildable from Markdown alone" test is **proposed**; reason: it is what separates D-006 from the alternative D-006 rejected, a database with pages generated from it. |
| P2 | Every fact records its state, source and last-checked time. | **Decided** (D-007: trust is the main differentiator). |
| P3 | Link, don't copy. A fact owned by another system is linked, not copied. | **Decided** (plan, "What Shinan does not do"). |
| P4 | `unknown` is a valid answer. Missing, unreachable and not checked are recorded, never filled with guesses. | **Proposed**. Reason: the `workspace` repository's rule; a guessed fact is worse than a known gap because nobody rechecks it. |
| P5 | Intended and observed facts are kept apart, and disagreements are recorded, not resolved by default. | **Proposed** (glossary discrepancy rule). Reason: hiding drift is how catalogs lose trust. |
| P6 | Catalog content is context, not authorization. A runbook, a fact or an approval rule never by itself permits an agent to deploy, connect to a machine or change anything outside the catalog. An incomplete catalog does not permit scanning machines to fill it. | **Proposed**. Reason: the `workspace` repository's access policy says the same; Backstage gives the same warning for its ownership relation ("not to be used by automated processes to for example assign authorization", [Backstage well-known relations](https://backstage.io/docs/features/software-catalog/well-known-relations), checked 2026-11-16). |
| P7 | Nothing is lost. Changes create new revisions; retired entities stay readable. | **Proposed**. Reason: history explains why things are the way they are; see [section 9](#9-history). |
| P8 | The catalog never holds credentials or task status. | **Proposed**. Reason: credentials belong in a secret store; task status is derived on tasks (D-005) and would go stale if copied. |

## 2. Entity documents

### 2.1 One document per entity, and what "source of truth" means

Each catalog entity is one Markdown document: frontmatter in YAML between `---`
lines, then a Markdown body.

- **Decided:** Markdown with structured fields at the top is the source of
  truth, and the agent index is generated from it (D-006).
- **Proposed (the D-006 invariant):**
  1. Every applied catalog revision is the full Markdown text of the
     documents it changed. Nothing about the catalog's content (facts, fact
     checks, relations, entity fields, body) exists only outside that text.
  2. Changes, from the web editor, MCP or the CLI, are applied by producing
     new Markdown from the latest revision. Validation runs on the resulting
     Markdown, not on the operations that produced it.
  3. The wiki, the agent index, search and every list or table used for
     queries are derived. Deleting them all and re-parsing the Markdown
     rebuilds them exactly.

  Reason: D-006 rejected "a structured-data-first catalog, with pages
  generated from a database"
  ([D-006 record, PR #19](https://github.com/guneet-xyz/shinan/pull/19)). A
  "lossless export" alone would not rule that design out; these three rules
  do. Where the Markdown text is stored (files, Git or database rows) does not
  matter to D-006, and is owned by [architecture](architecture.md).
- Catalog proposals, approvals, comments and events are not catalog content.
  They are separate records about changes to it, like pull requests beside a
  repository, and are not expected to be rebuildable from the Markdown.
  **Proposed.** Reason: they describe the process, not the things in the
  catalog; the [glossary](domain-model.md#event) already makes events their
  own record.
- **Proposed:** YAML, restricted to plain maps, lists, strings, numbers,
  booleans, dates and `null` (no anchors, tags or multi-document files).
  Reason: YAML frontmatter is what the `workspace` repository and most Markdown
  tools already use; the restricted subset keeps documents easy to read and
  parse the same way everywhere. Unlike the `workspace` repository, which
  allows only `key: value` lines so a dependency-free script can check them,
  nested values are allowed because facts carry state and provenance.
- **Proposed:** a workspace's catalog can be exported as a folder of these
  Markdown files and imported back with no loss. Reason: it keeps the catalog
  readable without Shinan and supports self-hosting (D-012). Under the
  invariant this is a copy, not the guarantee itself.

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
| `facts` | no | Facts grouped by fact check, see [section 4](#4-facts). |

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

- A claim about the **current** state that someone may rely on and that can be
  checked should be a fact, not only a sentence; the body may explain it but
  should not restate its current value. **Proposed.** Reason: only facts carry
  state and freshness, and an unpinned value in two places drifts apart.
  Validation cannot detect this, so it is a writing rule checked in review.
- Dated history is welcome in the body, for example "grown to 128 GiB online
  on 2026-11-14 (infra/musashi#93)". **Proposed.** Reason: a dated statement
  stays true, so it cannot drift; this is how the `workspace` repository keeps
  useful operational history.
- An `intended` fact may repeat a value from its owning source
  ([section 6](#6-link-dont-copy)). That is not the drift the first rule
  prevents, because the fact check pins the source revision it came from, so
  the copy can be compared with its source at any time.
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
Values are illustrative. The deployment's facts are on the `service` entity
that the project `provides`, not here (see [section 3](#service)).

```markdown
---
id: project/dockyard
type: project
title: Dockyard
summary: Self-hosted OCI registry with a web UI and access management.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-14
    by: guneet via opencode-daedalus
    scope: Repository, agent instructions and latest release exist
    source: https://github.com/guneet-xyz/dockyard/releases/tag/v0.3.1
    observed:
      repository: https://github.com/guneet-xyz/dockyard
      docs.agent_instructions: https://github.com/guneet-xyz/dockyard/blob/main/AGENTS.md
      release.latest: v0.3.1
  - checked: 2026-11-14
    by: guneet via opencode-daedalus
    scope: Checkouts on Daedalus and Musashi and their revisions
    source: Local git on Daedalus; filtered SSH reads on Musashi (infra/musashi#85)
    limits: The Daedalus infrastructure checkout's submodule was not initialized, so it was not read
    observed:
      checkout-on:
        - {to: machine/daedalus, path: /root/dockyard}
        - {to: machine/musashi, path: /mnt/musashi/stacks/dockyard}
        - {to: machine/musashi, path: /mnt/musashi/stacks/dockyard/dockyard}
      provides: service/container-registry
---

# Dockyard

Musashi builds Dockyard images locally from the source submodule; it does not
run the published images. Do not assume a newer checkout or release is
deployed. See the [container registry](service/container-registry) and the
[Musashi stack rules](https://git.guneet.dev/infra/musashi/src/branch/main/stacks/dockyard/README.md).

## Cautions

The infrastructure checkout on [Daedalus](machine/daedalus) records the
submodule but does not initialize it. Do not initialize it as a side effect of
reading context.
```

An excerpt from the same exercise on `machine/musashi` (values illustrative), showing two
observations of one single-valued key that disagree (a
[discrepancy](#47-discrepancies)), a restricted fact and explicit unknowns:

```yaml
facts:
  - checked: 2026-11-14
    by: guneet via opencode-daedalus
    scope: Online data-disk grow; partition, filesystem and fstab after the change
    source: https://git.guneet.dev/infra/musashi/issues/93
    observed:
      disk.data.size: {value: 128 GiB, via: filesystem}
      disk.data.free: 74 GiB
  - checked: 2026-11-14
    by: guneet via opencode-daedalus
    scope: Azure instance metadata right after the resize
    source: Azure instance metadata (non-sensitive fields), infra/musashi#93
    observed:
      disk.data.size: {value: 64 GB, via: instance-metadata, note: Metadata lags after a resize}
  - checked: 2026-11-07
    by: guneet via opencode-daedalus
    scope: Identity and platform
    source: SSH identity and platform evidence (workspace 23bf602)
    observed:
      platform.arch: aarch64
      hostname: {value: musashi, restricted: true}
  - unknown:
      network.public_ipv6: Reachability not tested
      recovery.tested: The rebuild runbook has not been run
```

**Trying the shape on a full entry.** The whole Musashi entry, written this
way, needs 56 lines of frontmatter for 22 facts in 6 groups. The first draft's
form (each fact a separate item pointing to a named check) needed about 135
lines for the same content. Today's entry has 8 lines of frontmatter, because
it keeps most facts in prose; about 20 lines of its body move into facts.

**Proposed** as the shape; exact key names are confirmed when the type schemas
are built. Reason: grouping by fact check reads like the `workspace`
repository's "verified on date, scope, source" habit, keeps one line per fact
in the common case, and needs no check IDs (see
[4.3](#43-how-facts-are-written)).

## 3. Entity types

The type list is **decided** (plan, Catalog pillar). Each type has a **type
schema**: its fact keys, and for each key

- whether it is **single-valued** or **multi-valued** (its cardinality,
  [4.2](#42-fact-identity-cardinality-and-current-facts)),
- whether it is a relation, and which attributes identify it,
- whether it is **restricted by default** ([section 7](#7-sensitive-information)),
- how often it should be rechecked ([4.6](#46-freshness)),

plus body section conventions. The schemas below are **proposed**, drawn from
the `workspace` repository's templates, which have worked for its 18 projects,
4 machines, 10 services, 3 runbooks and 3 decisions (counted at `86bba32`).
In the lists below, "(many)" marks multi-valued keys and "(restricted)" keys
that are restricted by default; other keys are single-valued.

All types share one rule: each entity says **what belongs elsewhere** and links
to it. Reason: P3.

### project

A body of work with one or more repositories, for example an application or an
infrastructure repository. A project is not a repository: the repository is
the thing on the git host ([git hosts](git-hosts.md)); the project describes it.

- **Facts:** `repository` (many; preferably a repository known through a git
  host connection), `docs.readme`, `docs.agent_instructions`,
  `docs.deployment`, `issue_tracker`, `release.latest`.
- **Relations** (all many): `checkout-on` a machine, identified by machine and
  `path`; `provides` a service; `depends-on` a service; `configures` a machine
  or service (for infrastructure repositories).
- **Body:** role in one or two sentences; cautions; cross-project context.
- **Belongs elsewhere:** setup, architecture, tests and deployment commands
  (the project's repository); deployment facts (the `service` it provides);
  task worktree paths and task progress ([tasks](tasks.md)).
- **Reason:** the project entry owning checkout locations, and machines not
  repeating project lists, is the `workspace` repository's rule. Here the
  machine's list is generated from the inverse relation.

### machine

A computer: a cloud VM, a home server, a development host.

- **Facts:** `role`, `environment` (development, production and so on),
  `provider`, `platform.os`, `platform.arch`, `platform.vm_size`,
  `access.method`, `access.address` (restricted), `access.host_key`
  (restricted), `hostname` (restricted), storage facts such as
  `disk.data.size`.
- **Relations:** `configured-by` a project; `on-network` a service (many, for
  example Tailscale).
- **Body:** identity and role; access prerequisites (no secrets); operational
  constraints; cautions.
- **Belongs elsewhere:** configuration (the infrastructure repository);
  projects and services on it (generated); credentials (secret store).
- **Reason:** the `workspace` machine template; access prerequisites and
  constraints are what agents most need before touching a machine.

### service

Something running: a deployment of a project, such as the container registry,
or a shared service others depend on, such as ingress, DNS or monitoring.

- **Facts:** `endpoint` (many), `environment`, `deployment.version`,
  `deployment.built_from`.
- **Relations:** `runs-on` a machine (many), or `provided-by` an outside
  provider described in the body; `configured-by` a project; `depends-on`
  other services (many). The project it comes from is the inverse of the
  project's `provides`.
- **Body:** role and authority; dependencies and operational context;
  cautions.
- **Belongs elsewhere:** live health (the monitoring system, linked);
  configuration; secrets.
- **Proposed:** every running deployment that someone relies on is a
  `service`, and deployment facts (version, endpoint, where it runs) live only
  there. There is no `deployed-on` relation on projects. Reason: one home per
  fact (P3); a project-level version would be ambiguous as soon as a project
  has two deployments. The `workspace` repository already separates the
  Dockyard project from the `container-registry` service it runs as. Cost:
  deployed applications that have no service entry today (for example Walls)
  get one. This widens the glossary's wording ("a running service that other
  things depend on"); see [dependencies](#dependencies-on-other-documents).
- **Reason for the type:** the `workspace` service template. Live health
  changes by the minute, so copying it would always be stale.

### runbook

A real, cross-project procedure, such as rebuilding a machine.

- **Facts:** `last_successful_run` (`observed`, or `unknown` if never run),
  `changes_deployment` (true or false).
- **Relations:** `applies-to` machines, services or projects (many).
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
- **Relations:** `supersedes` another decision; `applies-to` entities (many);
  `from-task` the task where it was made ([tasks](tasks.md)).
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
  workspace (many); `see-also` runbooks (many).
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

- **Facts:** `agent_record` (link to the agent's identity record);
  `usual-machine` relations (many; informational, since the machine of each
  agent session is recorded per session, per the glossary).
- **Rules:** never holds tokens or permissions; links to the identity record.
  **Proposed** (glossary). Reason: as for `person`.

### Types not in the list

- **Repository** is not a type; repositories come from git host connections
  and are referenced by `project` facts. **Proposed** (glossary). Reason: the
  git host owns the repository.
- **Custom types** defined by a workspace: **proposed** not in the first
  version. Reason: the eight types cover the `workspace` repository's whole
  catalog, and custom types multiply schema, validation and index work. A fact
  key outside the type schema is allowed (treated as single-valued) but
  flagged in review, so needs show up before new types are added.

## 4. Facts

### 4.1 What a fact is

A fact is one structured value in an entity's frontmatter: a keyed value (such
as `platform.arch: aarch64`) or a relation to another entity (such as
`provides: service/container-registry`, see [section 5](#5-relations)). The
body is not made of facts.

**Proposed** (the glossary leaves the unit to this document, naming "a
structured field or an explicitly marked statement" as options). Reason:
per-field facts are what D-007 asks for and what the agent index can query;
page-level checks (the `workspace` repository's `last_verified`) cannot say
which part was checked, which is why that repository already writes long
`verification_scope` lists. Marked statements inside prose were rejected
because they are harder to validate and to change as single operations. This
is listed under [decisions needed](#decisions-needed-from-the-owner) because it
shapes everything else.

### 4.2 Fact identity, cardinality and current facts

Without these rules, ordinary multi-valued data (two endpoints, two checkouts
on one machine) would look like disagreement. All rules here are **proposed**.

**Cardinality.** The type schema marks each key single-valued or multi-valued.
Relations are multi-valued unless the schema says otherwise.

**Identity: which written facts are "the same fact".**

| Kind of key | A fact is identified by |
|---|---|
| Single-valued key | key + fact state + `via` (if given) |
| Multi-valued key | key + value |
| Relation | relation + target + the attributes the schema names as identifying (for `checkout-on`, the `path`) |

`via` is an optional short label for the means of observation, such as
`filesystem` or `instance-metadata`. It is only needed when two different
observations of one single-valued key are kept on purpose.

**Current facts.** The current facts are exactly the facts in the latest
applied revision. Earlier values live in [history](#9-history).

**Replace or add beside.** When a catalog proposal writes a fact, it
**replaces** the current fact with the same identity, and is **added beside**
the others otherwise. So:

- a new observation of a single-valued key by the same means replaces the old
  one (Musashi's disk size seen again with `df`);
- an observation by a different means is added beside it (instance metadata),
  which can make a discrepancy;
- an `observed` fact is added beside an `intended` fact for the same key;
- a new value of a multi-valued key is added; a value that no longer holds is
  removed by an explicit remove operation, never by omission.

Reason: these are the reviewer's "same source replaces, different source adds"
rule, made precise. Free-text sources cannot be compared reliably, so `via`
names the "source" that matters for identity.

### 4.3 How facts are written

The `facts` field is a list of **groups**. A group is either one fact check
with the facts it covers, or a list of facts that have no fact check.

```yaml
facts:
  - checked: 2026-11-13            # a fact check group
    by: guneet via opencode-daedalus
    scope: Read-only check of the VM platform
    source: Read-only SSH and Azure instance metadata (workspace issue 101)
    limits: Public IPs and network security group not inspected
    observed:                      # facts by state
      platform.vm_size: Standard_D2ps_v6
      disk.root.used: 93%
  - proposed:                      # facts with no fact check
      endpoint: {value: https://shinan.guneet.dev, task: T-12}
  - unknown:
      backup.freshness: Backups are paused; no restore test
```

- **Short form:** `key: value`. **Long form**, when a fact needs more:
  `key: {value: ..., via: ..., note: ..., restricted: true, task: ..., remove: true}`.
  A multi-valued key holds a list. In an `unknown` list the value is a short
  note saying why it is unknown.
- **No check IDs.** A fact check is identified by its group. Catalog
  proposals carry their fact checks inline, and Shinan writes them into the
  Markdown when it applies them, merging a new check into an existing group
  only when every field matches. Reason: invented local IDs such as `c5`
  collide when two proposals add checks at once.
- A fact appears in exactly one group. A recheck moves it to the new group.
  Groups left empty are dropped from the current document and remain in
  history.

**Proposed.** Reason: one line per fact in the common case (see the Musashi
trial in [2.5](#25-example)), and facts checked together sit together.

### 4.4 Fact states

The four state names are **decided** (plan, Catalog pillar). Their meanings
follow the glossary's [fact state test](domain-model.md#fact-state): if the
owning source declares something now, it is `intended`, even if not yet
applied; if it is agreed but not yet in the owning source, it is `proposed`.
The rules for each are **proposed**:

| State | Means | Fact check | Source must be |
|---|---|---|---|
| `intended` | The owning source currently declares this should be true. | Required | The owning source, pinned to a revision where possible, or a `decision` or `policy` entity. |
| `observed` | Someone saw this when they checked. | Required | A description of the observation (what, how, from where), optionally linking the task or event. |
| `proposed` | An accepted change that the owning source does not yet declare. | None | The `task` (or accepted `decision` entity) behind it, on the fact. |
| `unknown` | Not known. | Optional: in a check group it means "looked and could not tell"; in an `unknown` list without a check, "never looked". | As for `observed`, if in a check group. |

Rules:

- A `proposed` fact can add a value or, with `remove: true`, plan the removal
  of a current one (for example a checkout that will be deleted).
  **Proposed.** Reason: plans to take things away matter as much as plans to
  add them.
- A `proposed` fact never turns into another state by itself. When the owning
  source declares the change, a new `intended` fact replaces it; when the
  change is seen in the world, a new `observed` fact records it. Both come
  with fact checks. **Proposed.** Reason: the `workspace` repository's rule
  that "planned changes are proposals until implemented and verified".
- A merged change that is not yet applied is `intended`; its absence in the
  world shows as a [discrepancy](#47-discrepancies) with the `observed` fact.
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

### 4.5 Fact checks

A **fact check** records one act of checking. Several facts can share one
check when they were checked together.

| Field | Required | Meaning |
|---|---|---|
| `checked` | yes | When the check actually happened: a date, or date and time. Not when the page was edited or the proposal applied. `null` only for [imported facts](#13-mapping-from-the-workspace-repositorys-catalog) whose origin is known but that were never checked. |
| `by` | yes | The actor who checked: a person, or an agent session acting for a person, written as the [identity](identity.md) document defines; Shinan for automatic fact checks. `unknown` is allowed only for imported checks. |
| `scope` | yes | What exactly was checked, in one line. |
| `source` | yes | Where the evidence is: a URL (pinned where possible), a repository revision, or a short description of the observation. No raw logs or sensitive output. |
| `limits` | no | What was deliberately or necessarily **not** checked, in one line. |

- **Decided** that each fact records source and last-checked time (D-007).
- **Proposed:** the fact check record and these fields. Reason: they are the
  `workspace` repository's `last_verified`, `verification_scope` and
  `verification_source`, moved from page level to the facts they cover.
  `limits` keeps what that repository writes as "Verification limits" (for
  example Dockyard's "No registry login, image push/pull … was performed"),
  which tells a reader where trust ends.
- **Proposed:** rechecking a fact without changing it records a new fact check
  for it. Checking one fact never refreshes others. Reason: the `workspace`
  repository's rule against refreshing dates mechanically.
- **Proposed:** when a check goes through Shinan, `by` must match the actor
  Shinan records for the catalog proposal, with its attribution confidence.
  Reason: a self-declared `by` that disagrees with Shinan's own record would
  undermine trust; see [identity](identity.md).
- A fact check with `checked: null` shows as **not checked**. It counts as a
  source and a (missing) last-checked time for D-007, in the same way roadmap
  criterion R5 accepts "an explicit `unknown`". **Proposed.**

### 4.6 Freshness

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

### 4.7 Discrepancies

A **discrepancy** exists when a **single-valued** key has two or more current
facts, none of them `proposed` or `unknown`, whose values differ. Typical
cases:

- `intended` differs from `observed` (the configuration repository says one
  thing, the machine shows another);
- two `observed` facts with different `via` differ (Musashi's instance
  metadata reported 64 GB after the disk had been grown to 128 GiB).

Several values of a multi-valued key are never a discrepancy. Two checkouts on
Musashi are two facts with different identities.

Rules (**proposed**; reason: P5 and the `workspace` repository's practice):

- Both facts are kept with their fact checks. Neither wins by default, by state, or
  by which was written last.
- Discrepancies are detected automatically, shown prominently in the wiki and
  returned with the entity in the agent index.
- A discrepancy is resolved by one of: changing the world (a task, then a new
  check); changing the owning source (then a new `intended` check); removing
  an observation shown to be wrong, with a note in the proposal; or recording
  that the difference is accepted, with a `note` and an owner. An accepted
  discrepancy stays visible but is not flagged as needing attention.
- A `proposed` fact that differs from current facts is a plan, not a
  discrepancy.
- **Open:** whether to flag gaps between the `intended` and `observed` values
  of a multi-valued key (for example an intended endpoint never observed).
  This needs to know whether an observation was complete, which `limits` only
  states in prose.

### 4.8 Unknowns

Two lists are generated, and kept apart (**proposed**):

- **Known unknowns:** facts written as `unknown`, deliberately. These appear
  on the entity page and in a workspace-wide list. Reason: the `workspace`
  repository writes "Known unknowns" by hand on every entry because they
  matter; generating the list keeps it honest.
- **Not yet recorded:** required keys of the type schema that the entity does
  not mention at all, and facts with `checked: null`. These are shown in a
  quieter, separate place. Reason: otherwise every new entity would list every
  required key and drown out the deliberate unknowns.

Missing required keys are not validation errors, so entities can be created
from partial knowledge. **Proposed.** Reason: the `workspace` templates say to
record `unknown` rather than invent information.

## 5. Relations

A relation is a fact whose value is another entity. It has a state and a fact
check like any fact. "Dockyard's deployment runs on Musashi" (the glossary's
example of a fact) is the `runs-on` relation of `service/container-registry`.

- **Proposed:** relations are facts. Reason: relations go stale like any other
  claim, and the glossary's own fact example is a relation.
- **Proposed:** each relation is written on one side only and its inverse is
  generated, for example `checkout-on` on the project produces "checkouts" on
  the machine. Reason: the `workspace` repository forbids machines repeating
  project lists; Backstage likewise generates inverse pairs such as `ownedBy`
  and `ownerOf` (checked 2026-11-16, link in P6).
- **Proposed:** a relation may carry small attributes, such as the `path` of a
  checkout, written in long form (`{to: machine/musashi, path: /mnt/...}`).
  The schema says which attributes identify it. Reason: a checkout is
  meaningless without its path, and making it a separate entity would be heavy.
- **Proposed:** a fixed vocabulary per type pair, initially:

| Relation | From | To | Inverse shown on target |
|---|---|---|---|
| `checkout-on` (identified by `path`) | project | machine | checkouts |
| `provides` | project | service | provided by |
| `runs-on` | service | machine | services |
| `configured-by` | machine, service | project | configures |
| `depends-on` | project, service | service | dependents |
| `on-network` | machine | service | members |
| `applies-to` | runbook, policy, decision | any entity or type | runbooks, policies, decisions |
| `see-also` | policy | runbook | policies |
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

An `intended` fact may repeat a single value from its owning source (for
example the port a configuration file sets) when readers need it for routing.
Commands and whole configuration blocks are never copied. **Proposed.**
Reason: the fact check pins the source revision, so the value can be compared
with its source and flagged when the source moves on; a copied command block
cannot be compared that way and invites running outdated instructions.

## 7. Sensitive information

The web app is on the public internet behind sign-in and holds infrastructure
details (D-015), so the catalog needs three protections.

### 7.1 No credentials, ever

Every catalog proposal is scanned for things that look like secrets (private
keys, tokens, passwords) in **all** its text: fact values, `note`, fact check
`scope`, `source` and `limits`, entity fields, the body and the proposal's
explanation. A match blocks it. **Proposed.** Reason: P8; a secret in any
field ends up in history and must then be redacted
([section 9](#9-history)). The `workspace` repository relies on reviewers to
catch this; automation is cheaper and more reliable. Shinan's own token check
([identity](identity.md)) is one part of this scan.

### 7.2 Restricted content

A fact or a whole entity can be marked `restricted`, for example internal
addresses, host key fingerprints and access layouts. Type schemas mark such
keys restricted by default (`hostname`, `access.address`, `access.host_key`);
an author can restrict any other fact, and lifting a restriction needs catalog
approval ([8.2](#82-when-catalog-approval-is-needed)).

Restricted content is visible only to readers allowed to see it (who that is
is owned by [identity](identity.md)). The rule applies **everywhere the
content can appear** (**proposed**; reason: a restriction that leaks through
one side door protects nothing):

- the wiki and its search;
- the agent index and every MCP or CLI answer;
- revisions and history views, including diffs between revisions;
- event summaries and timelines;
- the recent changes feed;
- catalog proposal review screens, and pending catalog proposals shown on
  entities or in the index;
- the workspace-wide lists (discrepancies, unknowns, due for recheck);
- exports and any Git export: a full export includes restricted content and
  is itself restricted; a reduced export leaves it out and says so. The export
  screen warns that a Git export keeps whatever it receives in its history.

Hidden content is replaced by a visible "restricted" marker, never silently
dropped, so readers know something is there. Only members who can see the
restricted content of a proposal may review or approve it. **Proposed.**

**Agents and model providers.** Whatever an agent reads is sent to its coding
tool's model provider, a third party. **Proposed:** restricted content goes
only to agent tokens that carry an explicit permission for it, which the
person grants knowingly (the scope itself is owned by
[identity](identity.md)). Reason: filtering only by what the member may see
would send restricted facts to third parties by default; agents that need,
say, a host address for a task can be given the permission.

**Open (decision needed):** whether restriction is in the first version at
all. The [identity draft](https://github.com/guneet-xyz/shinan/pull/24)
currently proposes that every member reads the whole catalog in the first
version and leaves restricted entities open; see
[dependencies](#dependencies-on-other-documents).

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
- the changes, as a list of operations, each stating what it expects to find
  (see [8.5](#85-conflicts));
- for every new or changed fact, its fact check, inline.

**Operations** (**proposed**): create entity; set a fact (replacing or adding
beside, per [4.2](#42-fact-identity-cardinality-and-current-facts)); remove a
fact; recheck facts; edit body (whole body or one section); change an entity
field (title, summary, status, owner); restrict or unrestrict; retire; change
ID. Agents send operations through MCP or the CLI
([agent integrations](agent-integrations.md)); the web editor produces the
same operations. Shinan applies them by writing new Markdown from the latest
revision and validating the result (the [D-006 invariant](#21-one-document-per-entity-and-what-source-of-truth-means)).
Reason: operations on single facts rarely conflict and make review precise
("disk.data.size: 64 GiB → 128 GiB"), where a whole-file diff hides what
changed.

One proposal may change several entities and is applied all or nothing.
**Proposed.** Reason: retiring a machine and moving its checkouts must not
half-happen.

### 8.2 When catalog approval is needed

Changes fall into classes:

| Class | Examples | Option A: strict | Option B: gated classes only |
|---|---|---|---|
| Recheck | New fact check, value unchanged | Applies on its own | Applies on its own |
| Observed or unknown facts | Add, change or remove an `observed`/`unknown` fact or relation | Catalog approval | Applies on its own |
| Intended facts | From an owning source pinned to a revision | Catalog approval | Applies on its own |
| Planned changes | Add or remove a `proposed` fact | Catalog approval | Applies on its own |
| Body and bookkeeping | Body text, title, summary, new entity of type project, machine, service or runbook | Catalog approval | Applies on its own |
| Rules | Create or change a `policy`; change a `decision` to `accepted`, `rejected` or `superseded`; change the start-here document | Catalog approval | Catalog approval |
| Lifecycle | Deprecate, retire, change ID, change owner | Catalog approval | Catalog approval |
| People and agents | Any change to `person` or `agent` entities | Catalog approval | Catalog approval |
| Exposure | Removing `restricted` from a fact or entity | Catalog approval | Catalog approval |
| Doubtful | A recheck or change whose fact check is older than the current one; accepting a discrepancy; breaking a warning rule of validation | Catalog approval | Catalog approval |

**Expected owner workload during the trial.** From the `workspace`
repository's history (2026-11-06 to 2026-11-16, at `86bba32`), 49 commits
changed the 13 catalog entries that roadmap RM-6 puts in the trial
workspace, about 4 to 5 a day. The estimates below assume one catalog
proposal per commit. Five created entries; none changed an entry's
status or owner, and there are no policies or decisions in the trial set.

- **Option A (strict)**, which the [glossary](domain-model.md#catalog-proposal-and-approval)
  currently proposes for the first version: about 4 to 5 approvals a day,
  plus the initial seeding. Each wait counts against roadmap criterion R7
  (90% of changes applied within two days). It also adds a sign-off that the
  `workspace` repository's access policy deliberately removed (routine
  documentation updates have standing authority; "do not add a generic final
  signoff gate").
- **Option B (gated classes only):** close to zero approvals a day for the
  same history; the owner reads the recent changes feed when they choose and
  reverts with one action.

**Recommended: Option B from the start of the trial.** Reason: it keeps
today's standing authority for routine updates while people keep control of
rules, irreversible changes, identity and exposure. During the trial the
`workspace` repository stays the source of truth (D-018), so a wrong
catalog change is cheap, visible in the feed and easy to revert. If the owner
prefers Option A, approval should work in bulk (all proposals of one task, or
a selected list, at once), and the switch to Option B should be tied to a
readiness check. This changes the glossary's proposal and current workspace
practice, so it is an [owner decision](#decisions-needed-from-the-owner).
Settings and who may approve are owned by [identity](identity.md).

- **Proposed (either option):** a person's own edit that would need catalog
  approval is applied at once when that person may approve it. Reason:
  approving one's own edit is a formality.
- **Proposed (either option):** changes that apply on their own appear in a
  **recent changes** feed, grouped per proposal, and can be reverted with one
  action (a new proposal restoring the earlier values). Reason: review after
  the fact keeps people informed without blocking agents. The feed's design is
  owned by [human experience](human-experience.md).

### 8.3 Validation

Every proposal is validated, on the Markdown it would produce, before it
applies or reaches a reviewer. **Proposed.** Reason: the `workspace`
repository's `scripts/check.py` does this for links and frontmatter and is the
main reason its entries stay consistent.

Blocking rules (the proposal cannot apply):

- frontmatter parses; required entity fields present; `type` and `status`
  valid;
- references (`owner`, relation targets, body links to entity IDs) resolve;
- every `intended` and `observed` fact is in a fact check group whose
  `checked`, `by`, `scope` and `source` are present, and `checked` is not in
  the future; `checked: null` and `by: unknown` only on imported checks;
- `proposed` facts name a task or an accepted decision;
- no two current facts share an identity
  ([4.2](#42-fact-identity-cardinality-and-current-facts));
- relations used only between allowed types;
- no secret-like content anywhere ([7.1](#71-no-credentials-ever));
- no task status copied into facts (for example a `status` key holding a task
  status value).

Warning rules (the proposal needs catalog approval, with the reason shown):

- fact key not in the type schema;
- the new fact check is older than the one it replaces;
- a key that is restricted by default written without `restricted`;
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

Each operation states what it expects to find: the current value and fact
check of the fact it replaces or removes, or that no fact with that identity
exists yet. When the proposal is applied, Shinan compares these with the
latest revision. **Proposed.**

- Operations whose expectations still hold apply, even if other parts of the
  same entity changed meanwhile. Reason: two agents rechecking different
  facts of Musashi should not block each other.
- If any expectation fails, the proposal does not apply on its own. Its author
  is told and can refresh it; otherwise a person resolves it.
- Competing claims are resolved from evidence and check time, not from which
  proposal arrived last. Two different values with valid fact checks may both
  be kept, as a discrepancy where the key is single-valued.
- Reason: the `workspace` repository's rule ("resolve competing claims from
  evidence and observation time, not merge order"); per-fact operations make
  real conflicts rare.

The architecture draft proposes failing any proposal whose entity has moved
on since its base revision; see [dependencies](#dependencies-on-other-documents).

### 8.6 Who sees and reviews proposals

- Pending catalog proposals are shown on the entities they touch and in a
  review list; agents can read them through the agent index so they do not
  duplicate one another. **Proposed.** Reason: agents working in parallel need
  to see pending changes, as they see open pull requests today.
- Members and agents can comment on a catalog proposal; only people approve.
  An agent may be asked to review a proposal (for example by the skill, for
  large or doubtful proposals) and records its findings as a comment.
  **Proposed.** Reason: agent review is cheap and is how documents in this
  repository are reviewed today; a comment informs the person without letting
  an agent approve.
- Restricted content in a proposal is shown only to those allowed to see it
  ([7.2](#72-restricted-content)).

### 8.7 Edits outside Shinan

In the first version the catalog is changed only through catalog proposals in
Shinan. Any Git export is one-way and read-only. **Proposed.** Reason: there
must be one path to change the source of truth, or catalog approval and
history mean nothing; this matches the architecture draft's one-way export.
If two-way editing is ever added, edits made outside Shinan would enter as
catalog proposals, attributed with the confidence Shinan can establish, and go
through the same validation and approval.

## 9. History

- Every applied proposal creates a new **catalog revision**, the full Markdown
  of the documents it changed, and an event credited to its author (and
  approver), which appears on the entity's timeline. **Proposed.** Reason:
  events are the glossary's single record of what happened; revisions let
  anyone see an entity as it was.
- Revisions are not edited. A revert is a new proposal. **Proposed.** Reason:
  the glossary's rule that events are not edited.
- Retired entities stay readable, marked retired, linked to their replacement,
  and excluded from default search. **Proposed.** Reason: the `workspace`
  repository keeps retired entries (for example the Takezo machine) because
  their history still answers questions.
- **Redaction** removes leaked secrets or personal data from catalog
  revisions, as the [architecture draft](architecture.md) proposes for all
  records: the content is replaced by a marker, the redaction is an event, and
  derived data is rebuilt. **Proposed.** Reason: some content must not
  survive, but its removal must be visible. Who may redact is owned by
  [identity](identity.md).
- How revisions are stored: [architecture](architecture.md).

## 10. The wiki

The wiki is the catalog shown to people. Its layout, navigation and editing
screens are owned by [human experience](human-experience.md). The catalog
requires it to show (**proposed**; reason: these are what make the catalog
trustworthy at a glance, per D-007):

- the body, rendered;
- every fact with its state, value, freshness (age, and "due for recheck" or
  "not checked") and its fact check's source, scope and limits;
- discrepancies, prominently, with both sides' evidence;
- generated sections: inverse relations, known unknowns (and, separately,
  not-yet-recorded keys), pending catalog proposals, related tasks, the entity
  timeline;
- restricted content only to readers allowed to see it, with a visible marker
  where something is hidden ([7.2](#72-restricted-content));
- index pages per entity type, from `title`, `summary`, `status` and `owner`
  (replacing the hand-written tables in the `workspace` repository's catalog
  README files);
- workspace-wide lists: discrepancies, facts due for recheck, known unknowns,
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
  catalog approval, because it shapes how agents behave.
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
- every fact with its state, value, `via`, note, cardinality and identity, its
  fact check (`checked`, `by`, `scope`, `source`, `limits`), and the recheck
  interval from the type schema;
- relations in both directions (written and generated);
- discrepancies, known unknowns and not-yet-recorded keys;
- the policies and runbooks that apply to it (through `applies-to`, including
  ones that apply to its type or to the whole workspace);
- pending catalog proposals touching it;
- the body, split by heading so a search can return one section;
- the catalog revision it was generated from.

Workspace-level entries: the agents' start-here path, and the lists of
discrepancies, facts due for recheck and known unknowns.

### 12.2 Rules

- **Generated only, rebuildable.** Nothing writes to the index except
  generation from the Markdown, and it can be rebuilt from the Markdown alone.
  **Decided** that it is generated (D-006); rebuildable is **proposed**
  (P1).
- **Every answer names the catalog revision.** **Proposed.** Reason: the
  `workspace` repository asks agents to state the revision they consulted;
  with it, an agent's claim "the catalog said X" can be checked later.
- **Lag is visible.** If the index is behind the latest applied revision, or
  is being rebuilt, the answer says so. **Proposed.** Reason: a silently stale
  index is the failure D-007 exists to prevent.
- **Freshness is computed when read**, from `checked` and the current time,
  not stored. **Proposed.** Reason: stored ages are wrong a day later.
- **Access rules apply.** Restricted content is left out unless the agent's
  token is allowed it ([7.2](#72-restricted-content)), and the answer marks
  what was left out. An agent never sees more than its member
  ([identity](identity.md)). **Proposed.**
- **Format:** **proposed** structured JSON per entity, following the same
  field names as the documents. Reason: every coding tool and MCP client
  handles JSON; matching names mean agents learn one vocabulary. The exact
  schema is written with the first version.
- **Queries the index must support** (names and shapes owned by
  [agent integrations](agent-integrations.md)), **proposed**: get an entity by
  ID or alias; list by type and status; text search across titles, summaries,
  facts and body sections; neighbours through relations; the policies and
  runbooks for an entity; context for a task's related entities; changes
  since a given catalog revision; and the workspace lists in 12.1.

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

When and how the move happens is owned by the [roadmap](roadmap.md) (D-018);
the same rules apply to the trial workspace's seeding (roadmap RM-6) and to
the final import. This mapping shows that the model above can hold what the
`workspace` repository holds today. **Proposed.**

### 13.1 Provenance of imported facts

Copying is not checking. An imported fact keeps exactly the provenance the
entry had, and no more (**proposed**; reason: the `workspace` rule "do not …
claim a whole page was checked when only one fact was verified", and D-007):

- **Covered facts.** A fact that the entry's `verification_scope` plainly
  covers is imported into a fact check with the entry's `last_verified` date,
  its scope text, `by: unknown` (entries do not record who checked), and a
  `source` naming both the original `verification_source` and the entry at
  its Git revision. Where a long scope lists several dated checks, each
  becomes its own group when they can be told apart.
- **Facts the scope does not cover.** They are imported into a group with
  `checked: null` ("not checked"), `by: unknown` and the entry at its Git
  revision as source, so they show as not checked until someone checks them.
- **Unknowns.** Values written `unknown` and "Known unknowns" items become
  `unknown` facts; "Verification limits" sections become `limits` on the
  matching fact checks.
- **The importer** (person or agent session) is the author of the catalog
  proposal, not the checker. Last-checked times are never refreshed by the
  import.
- Whether a scope "plainly covers" a fact is judged by the importing agent, per
  fact, and listed in the import report so the owner's spot check (roadmap
  R14) can see each judgment.

This agrees with roadmap RM-6, which keeps the original check date "or
`unknown` where the entry's verification scope does not cover it": RM-6's
"`unknown` last-checked time" is written here as `checked: null` (shown as
"not checked"), because `unknown` is a fact state; see
[dependencies](#dependencies-on-other-documents).

### 13.2 What maps where

| `workspace` repository | Shinan catalog |
|---|---|
| Entry file `catalog/machines/musashi.md`, `id: musashi` | Entity `machine/musashi`; the old ID `musashi` is kept as an alias where it is unique across types |
| `status: active / deprecated / retired` | Entity status, same values |
| `owner: guneet` / `unknown` | `owner: person/guneet` / `unknown` |
| `last_verified`, `verification_scope`, `verification_source` | Fact checks, as in [13.1](#131-provenance-of-imported-facts) |
| `last_verified: null` | Facts with `checked: null` ("not checked") |
| Values written `unknown`; "Known unknowns" sections | `unknown` facts |
| "Verification limits" sections | `limits` on fact checks |
| "Locations" tables | `checkout-on` relations with `path` |
| "Authoritative sources" lists | Keyed facts (`repository`, `docs.*`, `issue_tracker`) |
| Deployment details on project entries | Facts on the `service` the project `provides`; a service entity is created where none exists |
| Discrepancies written in prose | Paired facts on single-valued keys, detected as discrepancies |
| Dated history in prose | Stays in the body |
| `templates/*.md` | Type schemas; not imported |
| `runbooks/`, `decisions/` | `runbook` and `decision` entities (decision `status` becomes `decision_state`) |
| `docs/maintenance.md`, `docs/access-and-safety.md`, policy parts of `docs/collaboration.md` | `policy` entities |
| `docs/forgejo-setup.md` | Its setup checklist becomes facts on `service/forgejo`: items the owner reported become `observed` facts with the owner's statement as source; pending items become `unknown` facts, or `proposed` facts if a task exists. Its "verified CLI usage" section becomes a `runbook` if agents still need it after Shinan's git host connections exist; otherwise it is left in the archived repository. |
| `README.md` "Start here", `AGENTS.md`, `docs/agent-entrypoint.md` | The start-here document; product-wide parts move to the skill ([agent integrations](agent-integrations.md)) |
| `docs/skills.md`, `.opencode/skills/*` (workspace-navigate, -maintain, -task, -audit) | Not imported. Replaced by Shinan's skill ([agent integrations](agent-integrations.md)); any workspace-specific rule they contain becomes a `policy` |
| `integrations/opencode/*` | Not imported. Replaced by setup instructions for Shinan's MCP server, skill and plugin ([agent integrations](agent-integrations.md)) |
| `scripts/check.py`, tests | Replaced by validation on every catalog proposal; not imported |
| Pull requests changing catalog files; `CHANGELOG.md` | Catalog proposals; revisions and events. The changelog and Git history stay in the archived repository. |
| Forgejo issues | Tasks ([tasks](tasks.md)) |

Extracting facts from prose cannot be fully automatic. **Proposed:** import
each entry with its prose as body and the facts that can be extracted
reliably, then extract the rest gradually, entity by entity, through ordinary
catalog proposals. Reason: a lossless first import, then improvement through
the normal flow, avoids a risky one-shot conversion.

## Dependencies on other documents

| Document | What this document needs from it, and where the drafts agree or differ |
|---|---|
| [Domain model and glossary](domain-model.md) ([PR #14](https://github.com/guneet-xyz/shinan/pull/14), read at `8bb5d65`) | Terms used here. **Differs:** its catalog approval rule is Option A (all proposals except unchanged rechecks); this document recommends Option B ([8.2](#82-when-catalog-approval-is-needed)), an owner decision. Its `service` wording ("other things depend on") should widen to "a running deployment or shared service" if [the one-home rule](#service) is accepted. **To add after it merges:** fact check, fact identity, cardinality, `via`, type schema, catalog revision, start-here document, recheck interval, restricted, not checked; and that an entity ID is written `<type>/<slug>`. |
| [Architecture and operations](architecture.md) ([PR #22](https://github.com/guneet-xyz/shinan/pull/22)) | **Agrees:** its proposal 5.1a stores each entity's full Markdown text as revisions and rebuilds the index from it in the same transaction, which satisfies the [D-006 invariant](#21-one-document-per-entity-and-what-source-of-truth-means); fact checks live in the Markdown, as it assumes; native catalog proposals; Git export one-way only; redaction (its 4.4) as used in [section 9](#9-history). **Differs:** its concurrent-edit rule fails a proposal whenever the entity moved on since its base revision; this document checks each operation's expectations ([8.5](#85-conflicts)) so unrelated changes to one entity do not block each other. **Needs:** export handling of restricted content ([7.2](#72-restricted-content)); secret scanning of all text fields. |
| [Roadmap and migration](roadmap.md) ([PR #17](https://github.com/guneet-xyz/shinan/pull/17)) | **Agrees:** RM-6 import provenance (see [13.1](#131-provenance-of-imported-facts); its "`unknown` last-checked time" should read "not checked"); the 6.2 mapping, including skills and `integrations/opencode` replaced by Shinan's skill. **Answers its question:** `docs/forgejo-setup.md` becomes facts on `service/forgejo` plus, if still needed, a runbook. **Differs:** 6.2 keeps IDs unchanged; here the slug is unchanged but gains a type prefix, with the old ID as an alias where unique. **Tension:** R7's two-day target fits Option B, not Option A. RM-2's export as "D-006's promise" is a copy; the promise itself is the invariant in 2.1. |
| [Identity, agents and permissions](identity.md) ([PR #24](https://github.com/guneet-xyz/shinan/pull/24)) | Who may approve and change approval settings; how actors are written in `by`; who may redact. **Differs:** its 9.5 proposes that every member reads the whole catalog in the first version and leaves restricted entities open; this document recommends restriction in the first version, plus a token permission before restricted content reaches agents ([7.2](#72-restricted-content)). Its scope list (`catalog:read`, `catalog:propose`) would need that permission added. |
| [Agent integrations](agent-integrations.md) | MCP and CLI operations for reading the index and sending catalog proposals; delivering the agents' start-here path; the recheck-before-acting and documentation-impact conventions; agent review comments on proposals. |
| [Human experience](human-experience.md) | Wiki pages, freshness display, discrepancy display, restricted markers, editors, review list and recent changes feed, start-here presentation. |
| [Tasks and work](tasks.md) | Links between tasks and entities; `proposed` facts tied to tasks and what happens when a task is cancelled; promoting task decisions to `decision` entities; whether the documentation-impact obligation is part of "done". |
| [Git host integrations](git-hosts.md) | Repository identity for `project` facts; which facts Shinan can check automatically. |
| [Decision log](decisions/) ([PR #19](https://github.com/guneet-xyz/shinan/pull/19)) | Records for the owner's decisions below once made. Confirming the D-006 invariant needs no amendment to D-006; renaming `proposed` needs a new record (as its D-007 record notes). |

## Proposed in this document

1. [Principles](#1-principles) P4 to P8, including "catalog content is context,
   not authorization".
2. The [D-006 invariant](#21-one-document-per-entity-and-what-source-of-truth-means):
   every applied revision is Markdown, everything else is rebuildable from it.
3. Restricted YAML frontmatter; [entity fields](#22-entity-fields) as
   bookkeeping, not facts.
4. [IDs](#23-ids-and-references) written `<type>/<slug>`, stable, with aliases.
5. [Body rules](#24-body): current-state claims become facts; dated history
   stays in prose; generated sections are not hand-written.
6. [Type schemas](#3-entity-types) with cardinality, default restriction and
   recheck intervals; deployment facts only on `service`; no custom types in
   the first version.
7. [A fact is one structured field or relation](#41-what-a-fact-is), with
   [identity, cardinality and replace-or-add rules](#42-fact-identity-cardinality-and-current-facts).
8. [Facts grouped by fact check](#43-how-facts-are-written), with no check IDs.
9. [Rules per fact state](#44-fact-states), including planned removals.
10. [Fact checks](#45-fact-checks) with `limits`.
11. [Per-key recheck intervals](#46-freshness) as a risk signal.
12. [Discrepancies](#47-discrepancies) on single-valued keys only;
    [unknowns kept apart from not-yet-recorded keys](#48-unknowns).
13. [Relations are facts](#5-relations), written on one side, with generated
    inverses.
14. The [hold-versus-link split](#6-link-dont-copy).
15. [Secret scanning of all text](#71-no-credentials-ever) and
    [restricted content everywhere it can appear](#72-restricted-content),
    with a token permission for agents.
16. [Every change is a catalog proposal of operations](#81-catalog-proposals);
    [catalog approval options](#82-when-catalog-approval-is-needed);
    [validation](#83-validation); [per-operation conflict checks](#85-conflicts);
    [agent review comments](#86-who-sees-and-reviews-proposals);
    [no outside edits in the first version](#87-edits-outside-shinan).
17. The [documentation-impact obligation](#84-agents-documentation-impact-obligation)
    for agents.
18. [History](#9-history): revisions, reverts, retired entities, redaction.
19. [Wiki requirements](#10-the-wiki), the
    [start-here document](#11-start-here) and the
    [agent index](#12-the-agent-index) content and rules.
20. [Import provenance](#131-provenance-of-imported-facts) and the
    [mapping](#132-what-maps-where) from the `workspace` repository.

## Open questions

1. Body embeds of fact values (`{{fact:...}}`): worth the loss of raw
   readability? ([2.4](#24-body))
2. Recheck interval values per fact key. ([4.6](#46-freshness))
3. Flagging gaps between intended and observed values of multi-valued keys.
   ([4.7](#47-discrepancies))
4. Whether Shinan enforces any `policy` beyond its own settings.
   ([3](#policy))
5. External link checking: whether, how often, and from where.
   ([8.3](#83-validation))
6. Automatic fact checks through git host connections in the first version or
   later. ([12.3](#123-automatic-fact-checks-by-shinan))
7. More than one start-here path for larger workspaces. ([11](#11-start-here))
8. Exact agent index JSON schema, written with the first version.
   ([12.2](#122-rules))

## Decisions needed from the owner

| # | Decision | Recommended | Reason |
|---|---|---|---|
| 1 | Confirm the D-006 invariant: every applied catalog revision is Markdown, and everything else is derived and rebuildable from it ([2.1](#21-one-document-per-entity-and-what-source-of-truth-means)) | Confirm (D-006 unchanged) | It is what makes "Markdown is the source of truth" testable, and the architecture draft's storage already satisfies it. |
| 2 | Where catalog proposals and review happen | Natively in Shinan; Git export one-way only | Per-fact operations and fast agent edits do not fit a pull request per change, and native review keeps the Markdown canonical. |
| 3 | Unit of a fact | One structured field or relation, with cardinality and identity rules | Only per-field facts can say which part is fresh, as D-007 requires. |
| 4 | Rename fact state `proposed` to `planned` | Rename | "Proposed" already means a catalog proposal and a document status. |
| 5 | Default catalog approval: A strict (≈4–5 approvals a day in the trial) or B gated classes only (≈0 a day) | B from the start of the trial | Keeps today's standing authority and roadmap R7 while rules, lifecycle, identity and exposure stay gated. |
| 6 | Import provenance (with roadmap RM-6) | Keep the entry's date only where its scope covers the fact; otherwise "not checked"; `by: unknown`; importer recorded on the proposal | Copying is not checking (D-007). |
| 7 | Restricted content in the first version (differs from the identity draft) | Yes: one `restricted` level, enforced everywhere, schema defaults, and a token permission before agents receive it | The app is public (D-015), and agents send what they read to third-party model providers. |
| 8 | Entity IDs as `<type>/<slug>` | Yes, old IDs as aliases | Musashi is both a project and a machine today. |
| 9 | Deployment facts only on `service` entities | Yes | One home per fact; a project can have several deployments. |
| 10 | Custom entity types in the first version | No; flag unknown keys instead | Eight types cover the whole `workspace` repository's catalog. |
| 11 | Start-here as a special document with two paths, changed only with catalog approval | Yes | It is a curated route that steers agents, not a thing with facts. |
