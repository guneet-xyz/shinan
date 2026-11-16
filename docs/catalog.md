# Catalog

Status: **approved by the owner on 2026-11-16** ([issue #5](https://github.com/guneet-xyz/shinan/issues/5); integrated in [#26](https://github.com/guneet-xyz/shinan/issues/26)).
The owner's answers in [#25] and the integration review findings in [#26] are applied.

This document owns the catalog: entity types and type schemas, facts and fact
states, provenance, editing and approval, and what the wiki and the agent index
must contain. It uses the terms of the [domain model and glossary](domain-model.md)
exactly. It does not choose technology ([architecture](architecture.md),
D-020), design screens ([human experience](human-experience.md)), name MCP
tools ([agent integrations](agent-integrations.md)) or decide who may approve
([identity](identity.md)).

## How to read this document

Every rule carries one of these markers:

- **Decided**: follows from an accepted decision in the
  [plan](plan.md#6-decisions-so-far), which is cited and gives the reason.
- **Decided (owner, O-n or N-n, [#25])**: the owner's answer to item O-n of
  the consolidated decision checklist, or to follow-up item N-n. The Decision
  log maps these to decision records.
- **Proposed**: suggested here, with a reason. Owner review confirms or changes
  it.
- **Open**: not settled. Listed under [open questions](#open-questions).

Code formatting marks literal values, for example the fact state `planned`.

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
  from them alone. Revisions are stored in PostgreSQL only; there is no Git
  mirror for now. A workspace's catalog can be exported as a folder of these
  Markdown files and imported back without loss.
- Structured fields hold **facts**, grouped under the **fact check** that last
  checked them. A fact check records when, by whom, what exactly was checked,
  what was not, and the source (D-007). Each fact has a fact state
  (`intended`, `observed`, `planned`, `unknown`).
- **Type schemas** say which keys a type has, whether each holds one value or
  many, and how often to recheck it. Eight built-in types are the defaults; a
  workspace can add its own types with a short schema document.
- The catalog holds identity, routing and observations that no other system
  owns. It links to owning sources for everything else, and never holds
  secrets: it records where a secret lives.
- Everyone in a workspace sees the whole catalog.
- Every change is a catalog proposal, made and reviewed inside Shinan. Routine
  changes apply on their own; only high-risk (gated) changes need a person's
  catalog approval.

## 1. Principles

| #   | Principle                                                                                                                                                                                                                                                         | Status and reason                                                                                                                                                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | The Markdown documents are the source of truth. Every applied catalog revision is a set of Markdown documents; the wiki, the agent index, exports and all query tables are derived and rebuildable from them alone, and never edited directly.                    | **Decided** (D-006: people must be able to read it), and the "rebuildable from Markdown alone" reading confirmed (owner, O-11, [#25]).                                                                                                                                                                                                                     |
| P2  | Every fact records its state, source and last-checked time.                                                                                                                                                                                                       | **Decided** (D-007: trust is the main differentiator).                                                                                                                                                                                                                                                                                                     |
| P3  | Link, don't copy. A fact owned by another system is linked, not copied.                                                                                                                                                                                           | **Decided** (plan, "What Shinan does not do").                                                                                                                                                                                                                                                                                                             |
| P4  | `unknown` is a valid answer. Missing, unreachable and not checked are recorded, never filled with guesses.                                                                                                                                                        | **Proposed**. Reason: the `workspace` repository's rule; a guessed fact is worse than a known gap because nobody rechecks it.                                                                                                                                                                                                                              |
| P5  | Intended and observed facts are kept apart, and disagreements are recorded, not resolved by default.                                                                                                                                                              | **Proposed** (glossary discrepancy rule). Reason: hiding drift is how catalogs lose trust.                                                                                                                                                                                                                                                                 |
| P6  | Catalog content is context, not authorization. A runbook, a fact or an approval rule never by itself permits an agent to deploy, connect to a machine or change anything outside the catalog. An incomplete catalog does not permit scanning machines to fill it. | **Proposed**. Reason: the `workspace` repository's access policy says the same; Backstage gives the same warning for its ownership relation ("not to be used by automated processes to for example assign authorization", [Backstage well-known relations](https://backstage.io/docs/features/software-catalog/well-known-relations), checked 2026-11-16). |
| P7  | Nothing is lost. Changes create new revisions; retired entities stay readable.                                                                                                                                                                                    | **Proposed**. Reason: history explains why things are the way they are; see [section 9](#9-history-and-purge).                                                                                                                                                                                                                                             |
| P8  | The catalog never holds secret values or task status. It records where a secret lives.                                                                                                                                                                            | **Decided** for secrets (owner, O-2, [#25]): managing secrets is the team's job with a secrets manager such as Obscuro or Infisical. **Proposed** for task status. Reason: task status is derived on tasks (D-005) and would go stale if copied.                                                                                                           |

## 2. Entity documents

### 2.1 One document per entity, and what "source of truth" means

Each catalog entity is one Markdown document: frontmatter in YAML between `---`
lines, then a Markdown body.

- **Decided:** Markdown with structured fields at the top is the source of
  truth, and the agent index is generated from it (D-006).
- **Decided (owner, O-11, [#25]):** the D-006 invariant:
  1. Every applied catalog revision is the full Markdown text of the
     documents it changed. Nothing about the catalog's content (facts, fact
     checks, relations, entity fields, body, type schemas) exists only
     outside that text.
  2. Changes are applied by producing new Markdown from the latest revision.
     Validation runs on the resulting Markdown, not on the operations that
     produced it.
  3. The wiki, the agent index, search, exports and every list or table used
     for queries are derived. Deleting them all and re-parsing the
     Markdown rebuilds them exactly.

  Reason: D-006 rejected "a structured-data-first catalog, with pages
  generated from a database"; these three rules keep the Markdown the real
  record even though it is stored in a database.

- **Decided (owner, O-11 as changed by N-5 and N-9, [#25]):** revisions are
  stored in **PostgreSQL only**. There is **no Git mirror for now**; it is left
  for later. How revisions are stored is owned by
  [architecture](architecture.md).
- **Decided (owner, O-12, [#25]):** catalog proposals and review happen inside
  Shinan ([8.7](#87-no-edits-outside-shinan)).
- Catalog proposals, approvals, comments and events are not catalog content.
  They are separate records about changes to it, like pull requests beside a
  repository, and are not expected to be rebuildable from the Markdown.
  **Proposed.** Reason: they describe the process, not the things in the
  catalog; the [glossary](domain-model.md#event) already makes events their
  own record.
- **Proposed:** YAML, limited to plain maps, lists, strings, numbers,
  booleans, dates and `null` (no anchors, tags or multi-document files).
  Reason: YAML frontmatter is what the `workspace` repository and most Markdown
  tools already use; the limited subset keeps documents easy to read and
  parse the same way everywhere. Nested values are allowed because facts carry
  state and provenance.

### 2.2 Export: the exit path

Without a Git mirror, the way to get the catalog out of Shinan, as plain files
to read, keep or move elsewhere, is the **workspace export**: one full export
of a workspace (catalog, tasks and their records), in the first version
(owner, O-75, [#25]). There is no separate catalog-only export. A workspace
owner starts it and downloads it ([architecture §5.5](architecture.md#55-export-and-import),
[identity](identity.md)). Its overall format is owned by
[architecture](architecture.md); the catalog's part of it is **proposed**
here:

| Path in the export          | Content                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `catalog/README.md`         | Generated: what the export is, the workspace, the catalog revision it was taken at, and that changes are made only through catalog proposals in Shinan. |
| `catalog/start-here.md`     | The [start-here document](#11-start-here).                                                                                                              |
| `catalog/schemas/<type>.md` | One [type schema document](#39-custom-types-and-type-schema-documents) per custom type, and per built-in type the workspace has extended.               |
| `catalog/<type>/<slug>.md`  | One file per entity, so the entity ID `machine/musashi` is the path `catalog/machine/musashi.md`.                                                       |
| `catalog/history.jsonl`     | Every catalog revision: the document's ID, its full Markdown, the time, the author, the approver (if any) and the catalog proposal it came from.        |

- The Markdown files are exactly the latest revision's text, so they read like
  the `workspace` repository's catalog does today. **Proposed.** Reason: the
  exit path should not need Shinan to be readable.
- History is included as one machine-readable file rather than as Git
  commits. **Proposed.** Reason: nothing is lost on exit (P7), without
  building the mirror the owner left for later.
- Importing an export into an empty workspace reproduces the catalog
  exactly, including its history. **Proposed.** Reason: this is the rollback
  path that roadmap criterion R15 tests.
- An export holds everything in the catalog, because everyone in a workspace
  sees everything (owner, O-2, [#25]); it is exactly as sensitive as the
  workspace. Only workspace owners may export, as [identity](identity.md)
  sets out.
- While there are no built-in backups (owner, O-62 to O-64, [#25]), the
  catalog exists only in Shinan's PostgreSQL database unless someone exports
  it. An export can serve as a manual copy; whether to take them regularly
  belongs to the roadmap's backup review before migration.
- If a Git mirror is added later, it should use this same layout, so exports
  and the mirror stay interchangeable. **Proposed.**

### 2.3 Entity fields

These fields are about the page itself and the catalog's own bookkeeping. They
are not facts about the world, so they carry no fact state.

| Field           | Required              | Meaning                                                                                                                                                                                                                         |
| --------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | yes                   | Entity ID, see [2.4](#24-ids-and-references).                                                                                                                                                                                   |
| `type`          | yes                   | A built-in or custom [entity type](#3-entity-types).                                                                                                                                                                            |
| `title`         | yes                   | Display name. Can change freely.                                                                                                                                                                                                |
| `summary`       | yes                   | One sentence used in index pages and search results.                                                                                                                                                                            |
| `status`        | yes                   | Entity status: `active`, `deprecated` or `retired`. Describes the thing, not the page's accuracy.                                                                                                                               |
| `owner`         | yes                   | The entity owner: a reference to the `person` entity of the responsible member, or `unknown`.                                                                                                                                   |
| `replaced_by`   | when retired, if any  | Reference to the replacing entity.                                                                                                                                                                                              |
| `aliases`       | no                    | Former IDs, kept so old links still resolve.                                                                                                                                                                                    |
| `imported_from` | set only by an import | Where the document came from in the source repository: a file path, with a section anchor when only part of a file was imported, and the revision, for example `catalog/machines/musashi.md@86bba32`. Never changed afterwards. |
| `facts`         | no                    | Facts grouped by fact check, see [section 4](#4-facts).                                                                                                                                                                         |

- **Proposed.** Reason: these are the `workspace` repository's required fields
  (`id`, `status`, `owner`) plus what the wiki and index need (`type`, `title`,
  `summary`). Entity status values come from the glossary. Treating `status`
  and `owner` as catalog bookkeeping rather than facts keeps every fact
  checkable against something outside the catalog; who changed them and when
  is still recorded in [history](#9-history-and-purge).
- **Proposed:** `imported_from` records where an imported document came from.
  Reason: provenance for readers, and the old path the
  [rollback converter](#133-mapping-back-for-a-rollback) needs.
- **Proposed:** the glossary defines the entity owner as a member. In the
  document it is written as the member's `person` entity, and validation warns
  when that entity is not linked to a current member (for example after
  someone leaves). Reason: a readable, stable reference in the Markdown, while
  membership itself stays in the identity records.
- **Proposed:** there is no hand-written page-level "last checked" date. Where
  the wiki or index shows one for a whole entity, it is calculated from the
  entity's facts (for example oldest and newest fact check). Reason: the
  glossary's rule; a page date written by hand claims more than was checked.

### 2.4 IDs and references

- **Decided (owner, O-15, [#25]):** an entity ID is written `<type>/<slug>`,
  for example `machine/musashi`, with old IDs kept as aliases. The slug is
  lowercase kebab-case and unique within its type; the full ID is unique in the
  workspace. Reason: the `workspace` repository has both a `musashi` project
  and a `musashi` machine.
- IDs are stable. A rename changes the `title`. If the slug must change, the
  old ID moves to `aliases` and keeps resolving. **Proposed.** Reason: tasks,
  other entities and agents' notes hold references that must not break.
- A reference to another entity is its ID. In the body, a Markdown link whose
  target is an ID, such as `[Musashi](machine/musashi)`, is a reference.
  References must resolve; validation blocks broken ones. **Proposed.** Reason:
  the `workspace` repository's checker catches missing link targets, which has
  kept its entries consistent. The same links also work as relative paths in
  an [export](#22-export-the-exit-path).
- Links to owning sources are ordinary URLs. Where the source is versioned,
  prefer a link pinned to a revision (a commit) in fact checks.
  **Proposed.** Reason: "the file said X at revision Y" stays true; "the file
  says X" does not.

### 2.5 Body

The body is prose for people and agents: what the thing is, why it is set up
this way, warnings, and history worth keeping. It follows the type schema's
section conventions.

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

### 2.6 Example

An abbreviated `project/dockyard`, based on the `workspace` repository's entry.
Values are illustrative. The deployment's facts are on the `service` entity
that the project `provides`, not here ([service](#service)).

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
        - { to: machine/daedalus, path: /root/dockyard }
        - { to: machine/musashi, path: /mnt/musashi/stacks/dockyard }
        - { to: machine/musashi, path: /mnt/musashi/stacks/dockyard/dockyard }
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

An excerpt from the same exercise on `machine/musashi` (values illustrative),
showing two observations of one single-valued key that disagree (a
[discrepancy](#47-discrepancies)) and explicit unknowns:

```yaml
facts:
  - checked: 2026-11-14
    by: guneet via opencode-daedalus
    scope: Online data-disk grow; partition, filesystem and fstab after the change
    source: https://git.guneet.dev/infra/musashi/issues/93
    observed:
      disk.data.size: { value: 128 GiB, via: filesystem }
      disk.data.free: 74 GiB
  - checked: 2026-11-14
    by: guneet via opencode-daedalus
    scope: Azure instance metadata right after the resize
    source: Azure instance metadata (non-sensitive fields), infra/musashi#93
    observed:
      disk.data.size:
        {
          value: 64 GB,
          via: instance-metadata,
          note: Metadata lags after a resize,
        }
  - unknown:
      network.public_ipv6: Reachability not tested
      recovery.tested: The rebuild runbook has not been run
```

**Trying the shape on a full entry.** The whole Musashi entry, written this
way, needs 56 lines of frontmatter for 22 facts in 6 groups. A form with each
fact as a separate item pointing to a named check needed about 135 lines for
the same content. Today's entry has 8 lines of frontmatter, because it keeps
most facts in prose; about 20 lines of its body move into facts.

**Proposed** as the shape; exact key names are confirmed when the built-in type
schemas are written. Reason: grouping by fact check reads like the
`workspace` repository's "verified on date, scope, source" habit, keeps one
line per fact in the common case, and needs no check IDs (see
[4.3](#43-how-facts-are-written)).

## 3. Entity types

Every entity type is described by a **type schema**: its fact keys, and for
each key

- whether it is **single-valued** or **multi-valued** (its cardinality,
  [4.2](#42-fact-identity-cardinality-and-current-facts)),
- whether it is a relation, to which types, which attributes identify it, and
  what its inverse is called,
- whether it is required (missing required keys are listed, not errors;
  [4.8](#48-unknowns)),
- how often it should be rechecked ([4.6](#46-freshness)),

plus body section conventions and what belongs elsewhere.

- **Decided:** the eight built-in types (plan, Catalog pillar).
- **Decided (owner, O-17, [#25]):** workspaces may define custom types in the
  first version; the eight built-in types remain the defaults. How a custom
  type is defined is [3.9](#39-custom-types-and-type-schema-documents).

The built-in schemas below are **proposed**, drawn from the `workspace`
repository's templates, which have worked for its 18 projects, 4 machines,
10 services, 3 runbooks and 3 decisions (counted at `86bba32`). In the lists,
"(many)" marks multi-valued keys; other keys are single-valued.

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
  or service (for infrastructure repositories); `secrets-in` a secrets manager
  ([7.2](#72-where-secrets-live)).
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
  `access.method`, `access.address`, `access.host_key`, `hostname`, storage
  facts such as `disk.data.size`.
- **Relations:** `configured-by` a project; `on-network` a service (many, for
  example Tailscale); `secrets-in` a secrets manager (many).
- **Body:** identity and role; access prerequisites (no secret values);
  operational constraints; cautions.
- **Belongs elsewhere:** configuration (the infrastructure repository);
  projects, services and agents on it (generated); secret values (the secrets
  manager).
- **Reason:** the `workspace` machine template; access prerequisites and
  constraints are what agents most need before touching a machine.

### service

Something running: a deployment of a project, such as the container registry,
or a shared service others depend on, such as ingress, DNS, monitoring or a
secrets manager.

- **Facts:** `endpoint` (many), `environment`, `deployment.version`,
  `deployment.built_from`.
- **Relations:** `runs-on` a machine (many), or `provided-by` an outside
  provider described in the body; `configured-by` a project; `depends-on`
  other services (many); `secrets-in` a secrets manager (many). The project it
  comes from is the inverse of the project's `provides`.
- **Body:** role and authority; dependencies and operational context;
  cautions.
- **Belongs elsewhere:** live health (the monitoring system, linked);
  configuration; secret values.
- **Decided (owner, O-16, [#25]):** deployment facts (version, endpoint, where
  it runs) live only on `service` entities, and every running deployment that
  someone relies on is a `service`. There is no `deployed-on` relation on
  projects. Reason: one home per fact; a project can have several
  deployments. Deployed applications without a service entry today (for
  example Walls) get one.
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
change needs the owner's approval" or "secret values never go in the
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

Describes an agent for readers: what it is used for and any
workspace-specific conventions.

- **Facts:** `agent_record` (link to the agent's identity record).
- **Relations:** `on-machine` the machine it runs on (single-valued).
  Reason: an agent is per person, coding tool and machine (owner, O-40,
  [#25]), for example "Guneet's OpenCode on Daedalus".
- **Rules:** never holds tokens or permissions; links to the identity record.
  **Proposed** (glossary). Reason: as for `person`.

### 3.9 Custom types and type schema documents

**Decided (owner, O-17, [#25]):** custom types are allowed in the first
version. The design below is **proposed**, kept as small as possible in line
with the "small and legible over configurable" principle (owner, O-86,
[#25]).

A **type schema document** is a Markdown document like an entity, with the ID
`schema/<type>`, stored in the catalog (and in exports). Its frontmatter
lists the keys; its body explains the type for people and agents.

```markdown
---
id: schema/domain
title: Domain
summary: A DNS domain the team owns, and where it is registered and served.
status: active
owner: person/guneet
keys:
  registrar: {}
  expires_on: { recheck: 30d }
  nameservers: { many: true, recheck: 90d }
  served-by: { relation: [service], many: true, inverse: domains }
  configured-by: { relation: [project], inverse: domains }
required: [registrar, served-by]
sections: [Role, Cautions]
---

# Domain

One entity per registered domain, such as `domain/guneet-dev`. Records belong
in the DNS configuration repository; link it through `configured-by`.
Registrar credentials belong in the secrets manager.
```

Rules (all **proposed**):

- **Key options**, all optional: `many` (default single-valued), `relation`
  (target types, making the key a relation), `identified_by` (attributes that
  identify a relation, like `path`), `inverse` (the name shown on the target),
  `recheck` (a duration). `required` and `sections` are lists. Nothing else.
  Reason: these are exactly the properties the rest of this document needs;
  anything more is configuration nobody will read.
- **Custom type names** are lowercase kebab-case, may not reuse a built-in
  type name, and `schema` is reserved.
- **Built-in types can be extended, not changed.** A workspace may add keys to
  a built-in type with its own `schema/<built-in>` document, for example a
  `machine.ups` key. It cannot remove built-in keys or change their options.
  Reason: Shinan's own features rely on built-in keys such as `checkout-on`
  and `runs-on`.
- **Changing a schema needs catalog approval** (a gated class,
  [8.2](#82-when-catalog-approval-is-needed)). Adding keys or making a key
  multi-valued is always safe. Removing a key, or making a multi-valued key
  single-valued, is blocked while any current entity would break the new rule;
  the proposal lists the affected entities. Reason: a schema change affects
  every entity of the type and how agents read them.
- **Retiring a type** is allowed only when it has no active entities.
- **Agents read schemas** through the agent index, so an agent creating a
  `domain` entity knows its keys.
- Keys outside a type's schema are still allowed (treated as single-valued)
  but flagged in review, so needs show up before schemas grow. **Proposed.**

### Types that are not entity types

- **Repository** is not a type; repositories come from git host connections
  and are referenced by `project` facts. **Proposed** (glossary). Reason: the
  git host owns the repository.
- **The start-here document** and **type schema documents** are catalog
  documents but not entities: they have no facts.

## 4. Facts

### 4.1 What a fact is

A fact is one structured value in an entity's frontmatter: a keyed value (such
as `platform.arch: aarch64`) or a relation to another entity (such as
`provides: service/container-registry`, see [section 5](#5-relations)). The
body is not made of facts.

**Decided (owner, O-13, [#25]):** one structured field or relation, with the
cardinality and identity rules in 4.2. Reason: per-field facts are what D-007
asks for and what the agent index can query; page-level checks (the
`workspace` repository's `last_verified`) cannot say which part was checked,
which is why that repository already writes long `verification_scope` lists.

### 4.2 Fact identity, cardinality and current facts

These rules are part of the decided fact unit (owner, O-13, [#25]); the
details below are **proposed**. Without them, ordinary multi-valued data (two
endpoints, two checkouts on one machine) would look like disagreement.

**Cardinality.** The type schema marks each key single-valued or multi-valued.
Relations are multi-valued unless the schema says otherwise.

**Identity: which written facts are "the same fact".**

| Kind of key       | A fact is identified by                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| Single-valued key | key + fact state + `via` (if given)                                                                |
| Multi-valued key  | key + value                                                                                        |
| Relation          | relation + target + the attributes the schema names as identifying (for `checkout-on`, the `path`) |

`via` is an optional short label for the means of observation, such as
`filesystem` or `instance-metadata`. It is only needed when two different
observations of one single-valued key are kept on purpose.

**Current facts.** The current facts are exactly the facts in the latest
applied revision. Earlier values live in [history](#9-history-and-purge).

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

Reason: "the same source replaces, a different source adds" needs a source
that can be compared reliably; free-text sources cannot, so `via` names it.

### 4.3 How facts are written

The `facts` field is a list of **groups**. A group is either one fact check
with the facts it covers, or a list of facts that have no fact check.

```yaml
facts:
  - checked: 2026-11-13 # a fact check group
    by: guneet via opencode-daedalus
    scope: Read-only check of the VM platform
    source: Read-only SSH and Azure instance metadata (workspace issue 101)
    limits: Public IPs and network security group not inspected
    observed: # facts by state
      platform.vm_size: Standard_D2ps_v6
      disk.root.used: 93%
  - planned: # facts with no fact check
      endpoint: { value: https://shinan.guneet.dev, task: T-12 }
  - unknown:
      backup.freshness: Backups are paused; no restore test
```

- **Short form:** `key: value`. **Long form**, when a fact needs more:
  `key: {value: ..., via: ..., note: ..., task: ..., remove: true}`.
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
trial in [2.6](#26-example)), and facts checked together sit together.

### 4.4 Fact states

The four states are **decided** (plan, Catalog pillar), with `proposed`
renamed to **`planned`** (owner, O-5, [#25]; reason: "proposed" already means
a catalog proposal and a document status). Their meanings follow the
glossary's [fact state test](domain-model.md#fact-state): if the owning source
declares something now, it is `intended`, even if not yet applied; if it is
agreed but not yet in the owning source, it is `planned`. The rules for each
are **proposed**:

| State      | Means                                                           | Fact check                                                                                                             | Source must be                                                                                  |
| ---------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `intended` | The owning source currently declares this should be true.       | Required                                                                                                               | The owning source, pinned to a revision where possible, or a `decision` or `policy` entity.     |
| `observed` | Someone saw this when they checked.                             | Required                                                                                                               | A description of the observation (what, how, from where), optionally linking the task or event. |
| `planned`  | An accepted change that the owning source does not yet declare. | None                                                                                                                   | The `task` (or accepted `decision` entity) behind it, on the fact.                              |
| `unknown`  | Not known.                                                      | Optional: in a check group it means "looked and could not tell"; in an `unknown` list without a check, "never looked". | As for `observed`, if in a check group.                                                         |

Rules:

- A `planned` fact can add a value or, with `remove: true`, plan the removal
  of a current one (for example a checkout that will be deleted).
  **Proposed.** Reason: plans to take things away matter as much as plans to
  add them.
- A `planned` fact never turns into another state by itself. When the owning
  source declares the change, a new `intended` fact replaces it; when the
  change is seen in the world, a new `observed` fact records it. Both come
  with fact checks. **Proposed.** Reason: the `workspace` repository's rule
  that "planned changes are proposals until implemented and verified".
- A merged change that is not yet applied is `intended`; its absence in the
  world shows as a [discrepancy](#47-discrepancies) with the `observed` fact.
  **Proposed** (glossary test). Reason: drift between source and reality is
  exactly what the catalog should surface.
- When the task behind a `planned` fact ends without delivering it (for
  example it is cancelled), the fact is flagged for removal. **Proposed.**
  Reason: abandoned plans otherwise linger as false promises. Depends on task
  events from [tasks](tasks.md).

### 4.5 Fact checks

A **fact check** records one act of checking. Several facts can share one
check when they were checked together.

| Field     | Required | Meaning                                                                                                                                                                                                                                  |
| --------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checked` | yes      | When the check actually happened: a date, or date and time. Not when the page was edited or the proposal applied. `null` only for [imported facts](#131-provenance-of-imported-facts) whose origin is known but that were never checked. |
| `by`      | yes      | The actor who checked: a person, or an agent session acting for a person, written as the [identity](identity.md) document defines; Shinan for automatic fact checks. `unknown` is allowed only for imported checks.                      |
| `scope`   | yes      | What exactly was checked, in one line.                                                                                                                                                                                                   |
| `source`  | yes      | Where the evidence is: a URL (pinned where possible), a repository revision, or a short description of the observation. No raw logs or sensitive output.                                                                                 |
| `limits`  | no       | What was deliberately or necessarily **not** checked, in one line.                                                                                                                                                                       |

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
- A fact check with `checked: null` shows as **not checked**. It gives the
  fact a source and an explicitly missing last-checked time, which is how
  D-007 is met for imported facts (owner, O-14, [#25]).

### 4.6 Freshness

Freshness is the time since a fact's last check. It is a risk signal, never a
verdict: an old fact is not wrong, it is less certain.

- **Decided (owner, O-19, [#25]):** every fact's age is always shown; a fact is
  marked **due for recheck** only where its key has a recheck interval and the
  interval has passed. Intervals are set per key in the type schema, for
  example `disk.data.free`: 7 days; `repository`: 180 days; `platform.arch`:
  none. Reason: the `workspace` repository rejects one universal interval, but
  how volatile a fact is depends on its key.
- Facts never checked are shown as **not checked**. `planned` facts have no
  freshness. **Proposed.**
- Agents must recheck volatile or consequential facts before acting on them
  (for example before a deployment). **Proposed.** Reason: the `workspace`
  repository's rule. The convention itself is owned by
  [agent integrations](agent-integrations.md); the catalog supplies the
  checked time and interval.
- How freshness looks: [human experience](human-experience.md).
- **Open:** the actual interval values for built-in keys; they are set while
  writing the built-in type schemas.

### 4.7 Discrepancies

A **discrepancy** exists when a **single-valued** key has two or more current
facts, none of them `planned` or `unknown`, whose values differ. Typical
cases:

- `intended` differs from `observed` (the configuration repository says one
  thing, the machine shows another);
- two `observed` facts with different `via` differ (Musashi's instance
  metadata reported 64 GB after the disk had been grown to 128 GiB).

Several values of a multi-valued key are never a discrepancy. Two checkouts on
Musashi are two facts with different identities.

Rules (**proposed**; reason: P5 and the `workspace` repository's practice):

- Both facts are kept with their fact checks. Neither wins by default, by
  state, or by which was written last.
- Discrepancies are detected automatically, shown prominently in the wiki and
  returned with the entity in the agent index.
- A discrepancy is resolved by one of: changing the world (a task, then a new
  check); changing the owning source (then a new `intended` check); removing
  an observation shown to be wrong, with a note in the proposal; or recording
  that the difference is accepted, with a `note` and an owner. An accepted
  discrepancy stays visible but is not flagged as needing attention.
- A `planned` fact that differs from current facts is a plan, not a
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
- **Proposed:** the built-in relations, which custom type schemas can extend:

| Relation                             | From                      | To                 | Inverse shown on target       |
| ------------------------------------ | ------------------------- | ------------------ | ----------------------------- |
| `checkout-on` (identified by `path`) | project                   | machine            | checkouts                     |
| `provides`                           | project                   | service            | provided by                   |
| `runs-on`                            | service                   | machine            | services                      |
| `configured-by`                      | machine, service          | project            | configures                    |
| `depends-on`                         | project, service          | service            | dependents                    |
| `on-network`                         | machine                   | service            | members                       |
| `secrets-in` (identified by `item`)  | project, machine, service | service            | secrets kept for              |
| `applies-to`                         | runbook, policy, decision | any entity or type | runbooks, policies, decisions |
| `see-also`                           | policy                    | runbook            | policies                      |
| `supersedes`                         | decision                  | decision           | superseded by                 |
| `from-task`                          | decision                  | task               | decisions                     |
| `on-machine` (single-valued)         | agent                     | machine            | agents                        |

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

| The catalog holds                                                                                    | Example                                                      |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Identity and routing: what exists, where, who owns it, what depends on what, where its secrets live. | Dockyard has a checkout at `/root/dockyard` on Daedalus.     |
| Observations no other system records.                                                                | Musashi's Docker address pools were exhausted on 2026-11-14. |
| Cross-project knowledge: runbooks, decisions and policies.                                           | Every deployment change needs the owner's approval.          |

| The catalog links to                            | Owner                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| Setup, architecture, tests, deployment commands | The project's repository                                            |
| Infrastructure configuration                    | The infrastructure repository                                       |
| Task intent, progress, acceptance criteria      | [Tasks](tasks.md)                                                   |
| Pull requests, issues, CI results               | Git hosts ([git hosts](git-hosts.md))                               |
| Live health and metrics                         | The monitoring system                                               |
| Sign-in, roles, tokens, git host accounts       | [Identity](identity.md)                                             |
| Secret values                                   | A secrets manager, such as Obscuro or Infisical (owner, O-2, [#25]) |

An `intended` fact may repeat a single value from its owning source (for
example the port a configuration file sets) when readers need it for routing.
Commands and whole configuration blocks are never copied. **Proposed.**
Reason: the fact check pins the source revision, so the value can be compared
with its source and flagged when the source moves on; a copied command block
cannot be compared that way and invites running outdated instructions.

## 7. Secrets and visibility

### 7.1 Everyone in a workspace sees everything

**Decided (owner, O-2 and O-43, [#25]):** there is no restricted level in the
catalog. Every member of a workspace, and every agent acting for one, can read
the whole catalog, its history, its proposals and any export of it.
Consequences:

- Sensitive but non-secret details, such as internal addresses and host key
  fingerprints, may be recorded when people need them. They are visible to the
  whole workspace and to the model providers of the agents that read them, so
  record only what the work needs. **Proposed.** Reason: the `workspace`
  repository already records such details for agents, with the same exposure.
- A team that must hide something from some members uses a separate
  workspace. **Proposed** (glossary: the workspace is the boundary).

### 7.2 Where secrets live

**Decided (owner, O-2, [#25]):** secret values never go in the catalog. The
catalog records **where a secret lives**, not the secret.

- **Proposed:** the `secrets-in` relation points from a project, machine or
  service to the `service` entity of a secrets manager, identified by `item`
  (the name or path of the secret in that manager), with an optional `note`
  saying what it is for:

  ```yaml
  observed:
    secrets-in:
      - {
          to: service/obscuro,
          item: musashi/dockyard/registry-admin,
          note: Registry admin password,
        }
  ```

  Reason: agents then know where to look (and whom to ask) without the value
  ever passing through Shinan; the `workspace` repository already routes
  agents to Obscuro the same way.

### 7.3 A check for secret-looking values

Even with no secrets allowed, a value can slip in by mistake. Once applied,
it is shown to every member of the workspace, sent to the model provider of
every agent that reads it (which cannot be recalled), kept in revision history
until someone purges it, and copied into any export taken meanwhile. A light
check before applying is much cheaper than cleaning up afterwards.
**Proposed:**

- **Block** a catalog proposal when any of its text (fact values, `note`,
  fact check `scope`, `source` and `limits`, entity fields, the body, the
  proposal's explanation) contains a value that is almost certainly a
  credential: a private key block, a token with a known prefix (including
  Shinan's own tokens, per [identity](identity.md)), or a URL with a password
  in it. False alarms here are rare.
- **Warn** on weaker signs, such as `password=` or a long random-looking
  string: the proposal is held for catalog approval, with the matching text
  pointed out, so a person confirms it is not a secret.
- The check is a safety net, not a guarantee; secrets stay the team's job.

Reason: blocking only near-certain matches costs almost nothing, while one
leaked secret would have to be purged, rotated at its source, and chased
through any exports (see [section 9](#9-history-and-purge)).

## 8. Editing and approval

### 8.1 Catalog proposals

Every change to the catalog, by a person or an agent, is a catalog proposal.
A proposal is applied (immediately or after catalog approval), rejected or
withdrawn, with the states `pending`, `applied`, `rejected`, `withdrawn` from
the glossary.

- **Decided** that agents propose and people approve where needed (plan,
  Catalog pillar), inside Shinan (owner, O-12, [#25]).
- **Proposed:** people's own edits are also catalog proposals. Reason: one
  path for every change gives one history, one validation and one event
  stream.
- **Proposed:** only people give catalog approval (glossary). Reason: an agent
  acts for a person, so an agent approving would be that person approving
  without looking.
- **Decided (owner, O-46, [#25]):** a person may approve catalog proposals made
  by their own agents while one person uses Shinan. What applies after that is
  owned by [identity](identity.md).

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
field (title, summary, status, owner); retire; change ID; create or change a
type schema document; change the start-here document. Agents send operations
through MCP or the CLI ([agent integrations](agent-integrations.md)); the web
editor produces the same operations. Shinan applies them by writing new
Markdown from the latest revision and validating the result
([the D-006 invariant](#21-one-document-per-entity-and-what-source-of-truth-means)).
Reason: operations on single facts rarely conflict and make review precise
("disk.data.size: 64 GiB → 128 GiB"), where a whole-file diff hides what
changed.

One proposal may change several entities and is applied all or nothing.
**Proposed.** Reason: retiring a machine and moving its checkouts must not
half-happen.

### 8.2 When catalog approval is needed

**Decided (owner, O-3, [#25]):** only high-risk (gated) changes need catalog
approval, from the start of the trial; switch to strict if accuracy slips.
Reason: it keeps today's standing authority for routine updates (the
`workspace` repository's access policy says "do not add a generic final
signoff gate") while people keep control of rules, irreversible changes and
identity. From the `workspace` repository's history (49 changes to the
13 trial entries in ten days, none in a gated class), strict approval would
have meant 4 to 5 approvals a day; gated approval meant close to none.

| Class                     | Examples                                                                                                                                                                    | Default            | Strict setting     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------ |
| Recheck                   | New fact check, value unchanged                                                                                                                                             | Applies on its own | Applies on its own |
| Observed or unknown facts | Add, change or remove an `observed`/`unknown` fact or relation                                                                                                              | Applies on its own | Catalog approval   |
| Intended facts            | From an owning source pinned to a revision                                                                                                                                  | Applies on its own | Catalog approval   |
| Planned changes           | Add or remove a `planned` fact                                                                                                                                              | Applies on its own | Catalog approval   |
| Body and bookkeeping      | Body text, title, summary, new entity of any type                                                                                                                           | Applies on its own | Catalog approval   |
| Rules (gated)             | Create or change a `policy`; change a `decision` to `accepted`, `rejected` or `superseded`; create, change or retire a type schema document; change the start-here document | Catalog approval   | Catalog approval   |
| Lifecycle (gated)         | Deprecate, retire, change ID, change owner                                                                                                                                  | Catalog approval   | Catalog approval   |
| People and agents (gated) | Any change to `person` or `agent` entities                                                                                                                                  | Catalog approval   | Catalog approval   |
| Doubtful (gated)          | A recheck or change whose fact check is older than the current one; accepting a discrepancy; a warning from validation, including a secret-looking value                    | Catalog approval   | Catalog approval   |

- **Proposed:** the strict setting is one workspace setting, switched on by a
  workspace owner when catalog accuracy slips (for example when roadmap
  criterion R6 misses its target) and off again when it recovers. When it is
  on, approval works in bulk (all proposals of one task, or a selected list).
  Reason: the owner's answer names the switch; bulk approval keeps it
  bearable.
- **Proposed:** a person's own edit that would need catalog approval is
  applied at once when that person may approve it. Reason: approving one's own
  edit is a formality.
- **Proposed:** changes that apply on their own appear in a **recent changes**
  feed, grouped per proposal, and can be reverted with one action (a new
  proposal restoring the earlier values). Reason: review after the fact keeps
  people informed without blocking agents. The feed's design is owned by
  [human experience](human-experience.md).
- Settings and who may approve are owned by [identity](identity.md).

### 8.3 Validation

Every proposal is validated, on the Markdown it would produce, before it
applies or reaches a reviewer. **Proposed.** Reason: the `workspace`
repository's `scripts/check.py` does this for links and frontmatter and is the
main reason its entries stay consistent.

Blocking rules (the proposal cannot apply):

- frontmatter parses; required entity fields present; `type` names a built-in
  type or an active type schema; `status` valid;
- references (`owner`, relation targets, body links to entity IDs) resolve;
- every `intended` and `observed` fact is in a fact check group whose
  `checked`, `by`, `scope` and `source` are present, and `checked` is not in
  the future; `checked: null` and `by: unknown` only on imported checks;
- `planned` facts name a task or an accepted decision;
- no two current facts share an identity
  ([4.2](#42-fact-identity-cardinality-and-current-facts));
- relations used only between the types their schema allows;
- a type schema change does not break current entities
  ([3.9](#39-custom-types-and-type-schema-documents));
- no near-certain credential anywhere ([7.3](#73-a-check-for-secret-looking-values));
- no task status copied into facts (for example a `status` key holding a task
  status value).

Warning rules (the proposal needs catalog approval, with the reason shown):

- weaker signs of a secret ([7.3](#73-a-check-for-secret-looking-values));
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
During the trial, agents also make the matching proposal in Shinan when they
update a trial entity in the `workspace` repository (owner, O-72, [#25]).
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

### 8.7 No edits outside Shinan

**Decided (owner, O-12, [#25]):** the catalog is changed only through catalog
proposals in Shinan. **Proposed:** editing an export changes nothing in
Shinan; an export comes back only by importing it into an empty workspace
([2.2](#22-export-the-exit-path)), and imports for the migration arrive as
catalog proposals ([section 13](#13-mapping-from-the-workspace-repositorys-catalog)).
Reason: there must be one path to change the source of truth, or catalog
approval and history mean nothing.

## 9. History and purge

- Every applied proposal creates a new **catalog revision**, the full Markdown
  of the documents it changed, an event credited to its author (and approver),
  which appears on the entity's timeline.
  **Proposed.** Reason: events are the glossary's single record of what
  happened; revisions let anyone see an entity as it was.
- Revisions are not edited. A revert is a new proposal. **Proposed.** Reason:
  the glossary's rule that events are not edited.
- Retired entities stay readable, marked retired, linked to their replacement,
  and excluded from default search. **Proposed.** Reason: the `workspace`
  repository keeps retired entries (for example the Takezo machine) because
  their history still answers questions.
- **Purge** removes content that must not survive, such as a leaked secret or
  personal data, from catalog revisions. The content is replaced by a marker,
  the purge is itself an event saying who purged what and why, and derived
  data is rebuilt (mechanism: [architecture](architecture.md)).
  - **Decided (owner, O-50, [#25]):** only workspace owners can purge,
    including operational records about their workspace; installation
    operators cannot. Security-log entries are never purged (owner, N-13,
    [#25]).
  - There is no Git mirror to rewrite (owner, N-5 and N-9, [#25]).
    **Proposed:** the purge screen warns that exports taken before the purge,
    and agents' model providers, may still hold the content, so a purged
    secret must be rotated at its source. Reason: a purge cleans Shinan, not
    copies that already left it.
- How revisions are stored: [architecture](architecture.md).

## 10. The wiki

The wiki is the catalog shown to people. Its layout, navigation and editing
screens are owned by [human experience](human-experience.md). The catalog
requires it to show (**proposed**; reason: these are what make the catalog
trustworthy at a glance, per D-007):

- the body, rendered;
- every fact with its state, value, age, "due for recheck" or "not checked"
  where they apply (owner, O-19, [#25]), and its fact check's source, scope and
  limits;
- discrepancies, prominently, with both sides' evidence;
- generated sections: inverse relations, known unknowns (and, separately,
  not-yet-recorded keys), pending catalog proposals, related tasks, the entity
  timeline;
- index pages per entity type, built-in and custom, from `title`, `summary`,
  `status` and `owner` (replacing the hand-written tables in the `workspace`
  repository's catalog README files), with each type's schema document;
- workspace-wide lists: discrepancies, facts due for recheck, known unknowns,
  recent changes, and catalog proposals waiting for catalog approval;
- for workspace owners, a link to the workspace export
  ([2.2](#22-export-the-exit-path)).

## 11. Start here

A new person or a new agent needs a short path through the catalog. The plan
names a "start here" path (Wiki and onboarding pillar, owned by
[human experience](human-experience.md)); this section defines its content.

**Decided (owner, O-18, [#25]):** each workspace has one **start-here
document** with two paths, one for people and one for agents, built from the
same catalog pages and changed only with catalog approval. Details
(**proposed**):

- It is written in Markdown like an entity and changed through catalog
  proposals, but is not an entity type and holds no facts. Reason: the path is
  a curated route, not a thing in the world; keeping it in the catalog gives it
  history and approval.
- Each path is an ordered list of entity references with a sentence on each:
  - **for people:** what the workspace covers, the main projects, machines and
    services, the policies that matter, who owns what;
  - **for agents:** the policies to follow first (for example safety and
    deployment approval), how to find context for a task, the
    documentation-impact obligation ([8.4](#84-agents-documentation-impact-obligation)),
    and where to propose changes.

  Reason: the `workspace` repository has the same split today: its README
  "Start here" for people and `AGENTS.md` plus `docs/agent-entrypoint.md` for
  agents.

- It links and does not copy: each step is a reference to an entity (usually a
  policy or runbook) or a generated list. Validation warns when a step points
  to a retired entity or to one with discrepancies. Reason: P3; onboarding
  pages are where copies go stale fastest.
- Generic rules that every Shinan agent follows in every workspace (how to use
  the MCP tools, how to report presence) are not in this document; they ship
  with the skill ([agent integrations](agent-integrations.md)). The agents'
  path contains only this workspace's rules. Reason: separates product
  conventions from team policy.
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

Workspace-level entries: the agents' start-here path, every type schema
(built-in and custom), and the lists of discrepancies, facts due for recheck
and known unknowns.

### 12.2 Rules

- **Generated only, rebuildable.** Nothing writes to the index except
  generation from the Markdown, and it can be rebuilt from the Markdown alone.
  **Decided** (D-006; owner, O-11, [#25]).
- **Every answer names the catalog revision.** **Proposed.** Reason: the
  `workspace` repository asks agents to state the revision they consulted;
  with it, an agent's claim "the catalog said X" can be checked later.
- **Lag is visible.** If the index is behind the latest applied revision, or
  is being rebuilt, the answer says so. **Proposed.** Reason: a silently stale
  index is the failure D-007 exists to prevent.
- **Freshness is computed when read**, from `checked` and the current time,
  not stored. **Proposed.** Reason: stored ages are wrong a day later.
- **Everything is readable** by any agent of a workspace member with the
  catalog read permission ([section 7](#7-secrets-and-visibility)).
- **Format:** **proposed** structured JSON per entity, following the same
  field names as the documents. Reason: every coding tool and MCP client
  handles JSON; matching names mean agents learn one vocabulary. The exact
  schema is written with the first version.
- **Queries the index must support** (names and shapes owned by
  [agent integrations](agent-integrations.md)), **proposed**: get an entity by
  ID or alias; list by type and status; get a type schema; text search across
  titles, summaries, facts and body sections; neighbours through relations;
  the policies and runbooks for an entity; context for a task's related
  entities; changes since a given catalog revision; and the workspace lists
  in 12.1.

### 12.3 Automatic fact checks by Shinan

Some facts can be checked by Shinan itself through its git host connections,
for example that a `repository` exists and is reachable. Such checks are fact
checks with Shinan as the actor and go through the same catalog proposals.
**Proposed.** Reason: cheap, reliable rechecks of routing facts keep the
catalog fresher without agent effort. The roadmap proposes them for phase 2a;
which facts is owned with [git hosts](git-hosts.md). Shinan never connects to
machines to check facts (P6).

## 13. Mapping from the `workspace` repository's catalog

When and how the move happens is owned by the [roadmap](roadmap.md) (D-018).

- **Trial (decided, owner, O-71, [#25]):** agents fill the trial catalog by
  checking facts at their owning sources, using `workspace` repository entries
  only as a map, and copy only pointers such as repository URLs. Those copied
  pointers follow the provenance rules in 13.1.
- **Migration and its rehearsal:** the full import follows 13.1 and 13.2.

### 13.1 Provenance of imported facts

**Decided (owner, O-14, [#25]):** copying is not checking. An imported fact
keeps exactly the provenance the entry had, and no more. Details
(**proposed**; reason: the `workspace` rule "do not … claim a whole page was
checked when only one fact was verified", and D-007):

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
- **Original paths.** The importer sets `imported_from` on every document it
  creates, including policies and the start-here document, with a section
  anchor when only part of a file was used. Reason: the
  [rollback converter](#133-mapping-back-for-a-rollback) writes documents back
  to the same place.
- Whether a scope "plainly covers" a fact is judged by the importing agent, per
  fact, and listed in the import report so the owner's spot check (roadmap
  R14) can see each judgment.

### 13.2 What maps where

| `workspace` repository                                                                      | Shinan catalog                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry file `catalog/machines/musashi.md`, `id: musashi`                                     | Entity `machine/musashi`; the old ID `musashi` is kept as an alias where it is unique across types                                                                                                                                                                                                                                                                                                 |
| `status: active / deprecated / retired`                                                     | Entity status, same values                                                                                                                                                                                                                                                                                                                                                                         |
| `owner: guneet` / `unknown`                                                                 | `owner: person/guneet` / `unknown`                                                                                                                                                                                                                                                                                                                                                                 |
| `last_verified`, `verification_scope`, `verification_source`                                | Fact checks, as in [13.1](#131-provenance-of-imported-facts)                                                                                                                                                                                                                                                                                                                                       |
| `last_verified: null`                                                                       | Facts with `checked: null` ("not checked")                                                                                                                                                                                                                                                                                                                                                         |
| Values written `unknown`; "Known unknowns" sections                                         | `unknown` facts                                                                                                                                                                                                                                                                                                                                                                                    |
| "Verification limits" sections                                                              | `limits` on fact checks                                                                                                                                                                                                                                                                                                                                                                            |
| "Locations" tables                                                                          | `checkout-on` relations with `path`                                                                                                                                                                                                                                                                                                                                                                |
| "Authoritative sources" lists                                                               | Keyed facts (`repository`, `docs.*`, `issue_tracker`)                                                                                                                                                                                                                                                                                                                                              |
| Mentions of where credentials are kept (for example Obscuro paths)                          | `secrets-in` relations                                                                                                                                                                                                                                                                                                                                                                             |
| Deployment details on project entries                                                       | Facts on the `service` the project `provides`; a service entity is created where none exists                                                                                                                                                                                                                                                                                                       |
| Discrepancies written in prose                                                              | Paired facts on single-valued keys, detected as discrepancies                                                                                                                                                                                                                                                                                                                                      |
| Dated history in prose                                                                      | Stays in the body                                                                                                                                                                                                                                                                                                                                                                                  |
| `templates/*.md`                                                                            | Built-in type schemas; not imported                                                                                                                                                                                                                                                                                                                                                                |
| `runbooks/`, `decisions/`                                                                   | `runbook` and `decision` entities (decision `status` becomes `decision_state`)                                                                                                                                                                                                                                                                                                                     |
| `docs/maintenance.md`, `docs/access-and-safety.md`, policy parts of `docs/collaboration.md` | `policy` entities                                                                                                                                                                                                                                                                                                                                                                                  |
| `docs/forgejo-setup.md`                                                                     | Its setup checklist becomes facts on `service/forgejo`: items the owner reported become `observed` facts with the owner's statement as source; pending items become `unknown` facts, or `planned` facts if a task exists. Its "verified CLI usage" section becomes a `runbook` if agents still need it after Shinan's git host connections exist; otherwise it is left in the archived repository. |
| `README.md` "Start here", `AGENTS.md`, `docs/agent-entrypoint.md`                           | The start-here document; product-wide parts move to the skill ([agent integrations](agent-integrations.md))                                                                                                                                                                                                                                                                                        |
| `docs/skills.md`, `.opencode/skills/*` (workspace-navigate, -maintain, -task, -audit)       | Not imported. Replaced by Shinan's skill ([agent integrations](agent-integrations.md)); any workspace-specific rule they contain becomes a `policy`                                                                                                                                                                                                                                                |
| `integrations/opencode/*`                                                                   | Not imported. Replaced by setup instructions for Shinan's MCP server, skill and plugin ([agent integrations](agent-integrations.md))                                                                                                                                                                                                                                                               |
| `scripts/check.py`, tests                                                                   | Replaced by validation on every catalog proposal; not imported                                                                                                                                                                                                                                                                                                                                     |
| Pull requests changing catalog files; `CHANGELOG.md`                                        | Catalog proposals; revisions and events. The changelog and Git history stay in the archived repository.                                                                                                                                                                                                                                                                                            |
| Forgejo issues                                                                              | Tasks ([tasks](tasks.md))                                                                                                                                                                                                                                                                                                                                                                          |

Extracting facts from prose cannot be fully automatic. **Proposed:** import
each entry with its prose as body and the facts that can be extracted
reliably, then extract the rest gradually, entity by entity, through ordinary
catalog proposals. Reason: a lossless first import, then improvement through
the normal flow, avoids a risky one-shot conversion.

### 13.3 Mapping back, for a rollback

The roadmap allows a rollback during the window after cutover: the catalog is
taken from a workspace export back into a `workspace` repository pull request
([roadmap §6.7](roadmap.md#67-rollback-and-emergency-access), which owns the
process and links here for every mapping rule). The export's layout
([2.2](#22-export-the-exit-path)) is not the `workspace` repository's, so a
**rollback converter** turns the export's catalog back into files that
repository's checker, `scripts/check.py`, accepts. This section is the
complete rule set. All of it is **proposed**. Reason: a rollback must land in
the format the `workspace` repository's people, agents and checker already
use, lose nothing recorded since cutover, and never claim more than Shinan
recorded.

**What `scripts/check.py` requires** (read at `86bba32`): every internal
Markdown link in the repository resolves; files in `catalog/projects/`,
`catalog/machines/` and `catalog/services/` have simple `key: value`
frontmatter with `id` equal to the file name, `status` of `active`,
`deprecated` or `retired`, `owner`, and `last_verified` as an ISO date or
`null`; a dated entry needs a real `verification_scope` and
`verification_source`.

#### Which documents are written

1. **Unchanged documents are left alone.** A document with no catalog
   revision after the migration import (in `catalog/history.jsonl`) keeps its
   file at the frozen cutover revision; the converter does not touch it.
   Reason: a rewrite would turn an untouched entry into a large, meaningless
   diff.
2. **Changed and new documents are converted** to their old path:
   - a document with `imported_from` ([2.3](#23-entity-fields)) naming a whole
     file goes back to that path;
   - a document created after cutover goes to its type's folder below, using
     its slug as the file name.

| Export                       | Old path                     |
| ---------------------------- | ---------------------------- |
| `catalog/project/<slug>.md`  | `catalog/projects/<slug>.md` |
| `catalog/machine/<slug>.md`  | `catalog/machines/<slug>.md` |
| `catalog/service/<slug>.md`  | `catalog/services/<slug>.md` |
| `catalog/runbook/<slug>.md`  | `runbooks/<slug>.md`         |
| `catalog/decision/<slug>.md` | `decisions/<slug>.md`        |

3. **Documents with no old place are not converted:** `policy`, `person` and
   `agent` entities; entities of custom types; type schema documents; the
   start-here document; and any document whose `imported_from` names only a
   part of a file (for example a policy taken from one section of
   `docs/collaboration.md`). If they changed since cutover, they go to the
   fallback folder below and are listed in the rollback report for a person to
   merge into the original prose documents.

#### How a converted document is written

| Shinan                                                                  | `workspace` repository                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id: machine/musashi`                                                   | `id: musashi` (the slug, which the import kept unchanged)                                                                                                                                                                                                                                                                                                           |
| `status`                                                                | `status`, same value                                                                                                                                                                                                                                                                                                                                                |
| `owner: person/guneet`, `owner: unknown`                                | `owner: guneet`, `owner: unknown`                                                                                                                                                                                                                                                                                                                                   |
| `decision_state`, `decided_on` (decisions)                              | `status`, `date`, as in the `workspace` decision template                                                                                                                                                                                                                                                                                                           |
| `title`                                                                 | The page's first heading, if the body has none                                                                                                                                                                                                                                                                                                                      |
| `summary`                                                               | Not written; the body's first paragraph already says what the thing is                                                                                                                                                                                                                                                                                              |
| Fact checks                                                             | `last_verified`, `verification_scope` and `verification_source` describe **only the newest fact check** on the page: its date, its scope and its source, on one line each. With no dated fact check: `last_verified: null`, `verification_scope: Not yet verified`, `verification_source: unknown` (the template values)                                            |
| Facts                                                                   | A generated section at the end of the body, `## Facts recorded in Shinan`, with one row per fact: key, value, fact state, date checked (or "not checked") and the fact check's source and scope. This is where every other fact keeps its own check date, as the `workspace` maintenance policy allows ("per-fact notes can preserve different verification times") |
| Discrepancies                                                           | Both facts in that table, each with its own check, marked "discrepancy"                                                                                                                                                                                                                                                                                             |
| `checkout-on` relations                                                 | A `### Locations` table inside that section, in the template's form: machine, checkout path, evidence and date                                                                                                                                                                                                                                                      |
| `unknown` facts; `limits`                                               | `### Known unknowns` and `### Verification limits` inside that section                                                                                                                                                                                                                                                                                              |
| `secrets-in` relations                                                  | A row naming the secrets manager and the item; never a value                                                                                                                                                                                                                                                                                                        |
| The body                                                                | Kept as written in Shinan                                                                                                                                                                                                                                                                                                                                           |
| References to converted documents, such as `[Musashi](machine/musashi)` | Relative links to their old paths, such as `[Musashi](../machines/musashi.md)`                                                                                                                                                                                                                                                                                      |
| References to documents that are not converted                          | Plain text: the title with the ID in code, so no link is broken                                                                                                                                                                                                                                                                                                     |
| `catalog/history.jsonl` and the export file                             | Not committed. Kept with the export archive, which the PR description names, so the history since cutover is not lost                                                                                                                                                                                                                                               |

- The page fields never claim a whole-page check: they describe one fact
  check, and every other fact carries its own date in the generated section.
  Reason: the `workspace` rule against claiming more than was checked.
- Values are written on one line, so the frontmatter stays `key: value` as
  `scripts/check.py` requires.

#### Documents that still fail `scripts/check.py`

After converting, the converter runs `scripts/check.py` on the result.
**Proposed:** every document that has no old place (rule 3) or still fails the
check is committed **unchanged, in the export's format**, under a clearly
marked folder `shinan-export/` at the top of the repository, with a
`README.md` saying it is a copy from Shinan awaiting manual merging. The same
rollback PR adds `shinan-export` to the ignored directories in
`scripts/check.py`, and the rollback report lists each such document and the
check error. People then merge them by hand in later PRs. Reason: a rollback
happens under time pressure, so it should never wait on hand edits or lose
content; an ignored, clearly named folder keeps everything in the repository
and keeps the checker passing for the rest.

#### Testing

The converter is deterministic and can be run by a script or an agent. The
migration rehearsal (roadmap criterion R14) runs it once on a rehearsal
workspace with at least one changed entity, one new entity, one unchanged
entity and one custom-type entity, and checks that `scripts/check.py` passes
and that the unchanged entity produces no diff.

## Dependencies on other documents

What this document still needs from other documents:

| Document                                        | What this document needs                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Domain model and glossary](domain-model.md)    | The terms used here, including workspace export, recent changes feed and strict setting.                                                                                                                                                                                                                                                                                     |
| [Architecture and operations](architecture.md)  | Revisions stored as Markdown text and the index built from it (the D-006 invariant); per-operation conflicts; purge; the check for secret-looking values; type schema documents in the parser and index. Its workspace export ([§5.5](architecture.md#55-export-and-import)) writes the catalog in the layout of [2.2](#22-export-the-exit-path), including `history.jsonl`. |
| [Identity, agents and permissions](identity.md) | Who may approve and switch the strict setting; workspace owners only for export and purge; the written form of an actor in a fact check's `by` ([identity §8.7](identity.md#87-how-an-actor-is-written-in-text)); Shinan's token prefixes for the secret check.                                                                                                              |
| [Agent integrations](agent-integrations.md)     | MCP and CLI tools to read the index and type schemas, send catalog proposals and rechecks, and comment on proposals; delivering the agents' start-here path; the recheck-before-acting and documentation-impact conventions.                                                                                                                                                 |
| [Human experience](human-experience.md)         | Wiki pages, freshness, discrepancies, the editor, review list and recent changes feed, start-here presentation, pages for custom types and their schema documents, and the workspace export link for owners.                                                                                                                                                                 |
| [Tasks and work](tasks.md)                      | Links between tasks and catalog entities; promoting task decisions to `decision` entities; telling the catalog when a task behind a `planned` fact is cancelled ([4.4](#44-fact-states)); whether the documentation-impact obligation is part of "done" ([8.4](#84-agents-documentation-impact-obligation)).                                                                 |
| [Git host integrations](git-hosts.md)           | Repository identity for `project` facts; which facts Shinan can check automatically, by reading only (owner, N-4, [#25]).                                                                                                                                                                                                                                                    |
| [Roadmap and migration](roadmap.md)             | The rollback process, which uses the converter in [13.3](#133-mapping-back-for-a-rollback), and the rehearsal run of it (R14).                                                                                                                                                                                                                                               |

## Proposed in this document

1. [Principles](#1-principles) P4 to P7, including "catalog content is context,
   not authorization".
2. A limited YAML subset for frontmatter; the catalog's
   [export layout, with history](#22-export-the-exit-path); [entity fields](#23-entity-fields) as bookkeeping, not
   facts.
3. [Body rules](#25-body): current-state claims become facts; dated history
   stays in prose; generated sections are not hand-written.
4. [Built-in type schemas](#3-entity-types) with cardinality and recheck
   intervals, and the [custom type design](#39-custom-types-and-type-schema-documents).
5. [Fact identity and replace-or-add rules](#42-fact-identity-cardinality-and-current-facts);
   [facts grouped by fact check](#43-how-facts-are-written), with no check IDs.
6. [Rules per fact state](#44-fact-states), including planned removals;
   [fact checks](#45-fact-checks) with `limits`.
7. [Discrepancies](#47-discrepancies) on single-valued keys only;
   [unknowns kept apart from not-yet-recorded keys](#48-unknowns).
8. [Relations are facts](#5-relations), written on one side, with generated
   inverses, including `secrets-in`.
9. The [hold-versus-link split](#6-link-dont-copy).
10. [Where secrets live](#72-where-secrets-live) and a
    [light check for secret-looking values](#73-a-check-for-secret-looking-values).
11. [Every change is a catalog proposal of operations](#81-catalog-proposals);
    the [strict setting and bulk approval](#82-when-catalog-approval-is-needed);
    [validation](#83-validation); [per-operation conflict checks](#85-conflicts);
    [agent review comments](#86-who-sees-and-reviews-proposals).
12. The [documentation-impact obligation](#84-agents-documentation-impact-obligation)
    for agents.
13. [History](#9-history-and-purge): revisions, reverts, retired entities, and
    purge warnings about copies outside Shinan.
14. [Wiki requirements](#10-the-wiki), [start-here](#11-start-here) details and
    the [agent index](#12-the-agent-index) content and rules.
15. [Import provenance details](#131-provenance-of-imported-facts), the
    [mapping](#132-what-maps-where) from the `workspace` repository, and the
    [reverse conversion for a rollback](#133-mapping-back-for-a-rollback).

## Open questions

1. Body embeds of fact values (`{{fact:...}}`): worth the loss of raw
   readability? ([2.5](#25-body))
2. Recheck interval values for built-in keys. ([4.6](#46-freshness))
3. Flagging gaps between intended and observed values of multi-valued keys.
   ([4.7](#47-discrepancies))
4. Whether Shinan enforces any `policy` beyond its own settings.
   ([policy](#policy))
5. External link checking: whether, how often, and from where.
   ([8.3](#83-validation))
6. More than one start-here path for larger workspaces. ([11](#11-start-here))
7. Exact agent index JSON schema, written with the first version.
   ([12.2](#122-rules))

## Decisions needed from the owner

None.

[#25]: https://github.com/guneet-xyz/shinan/issues/25
[#26]: https://github.com/guneet-xyz/shinan/issues/26
