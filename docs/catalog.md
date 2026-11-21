# Catalog

Status: **approved by the owner on 2026-11-16** ([issue #5](https://github.com/guneet-xyz/shinan/issues/5); integrated in [#26](https://github.com/guneet-xyz/shinan/issues/26)).
The owner's answers in [#25] and the integration review findings in [#26] are applied.

This document owns the catalog: entity types and type schemas, facts and fact
states, provenance, how the catalog is changed, and what the catalog pages and
the agent index must contain. It uses the terms of the
[domain model and glossary](domain-model.md) exactly. It does not choose
technology ([architecture](architecture.md), D-020), design screens
([human experience](human-experience.md)), write the conventions agents follow
([agent integrations](agent-integrations.md), the skill) or decide who may do
what ([identity](identity.md)).

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
  each with structured fields at the top (frontmatter) and prose below. They
  are the files on `main` of the workspace's **catalog repository**, one Git
  repository per workspace hosted by Shinan
  ([D-059](decisions/D-059-catalog-in-git-hosted-by-shinan.md)); the catalog
  pages, the agent index and every query table are derived from them and can
  be rebuilt from them alone. Any clone of the repository is a readable copy
  of the catalog and its history.
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
- Agents change the catalog by pushing commits to its repository. Every push
  that passes Shinan's checks applies at once; there is no catalog approval
  ([D-060](decisions/D-060-no-catalog-approval.md)). Shinan's push log
  records which agent and person pushed what
  ([D-061](decisions/D-061-push-authentication-and-push-log.md)); undo is
  `git revert`.

## 1. Principles

| #   | Principle                                                                                                                                                                                                                                                         | Status and reason                                                                                                                                                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | The Markdown documents are the source of truth. The files on `main` of the catalog repository are the catalog; the catalog pages, the agent index and all query tables are derived and rebuildable from them alone, and never edited directly.                    | **Decided** (D-006: people must be able to read it), and the "rebuildable from Markdown alone" reading confirmed (owner, O-11, [#25]); stored in Git (D-059).                                                                                                                                                                                              |
| P2  | Every fact records its state, source and last-checked time.                                                                                                                                                                                                       | **Decided** (D-007: trust is the main differentiator).                                                                                                                                                                                                                                                                                                     |
| P3  | Link, don't copy. A fact owned by another system is linked, not copied.                                                                                                                                                                                           | **Decided** (plan, "What Shinan does not do").                                                                                                                                                                                                                                                                                                             |
| P4  | `unknown` is a valid answer. Missing, unreachable and not checked are recorded, never filled with guesses.                                                                                                                                                        | **Proposed**. Reason: the `workspace` repository's rule; a guessed fact is worse than a known gap because nobody rechecks it.                                                                                                                                                                                                                              |
| P5  | Intended and observed facts are kept apart, and disagreements are recorded, not resolved by default.                                                                                                                                                              | **Proposed** (glossary discrepancy rule). Reason: hiding drift is how catalogs lose trust.                                                                                                                                                                                                                                                                 |
| P6  | Catalog content is context, not authorization. A runbook, a fact or an approval rule never by itself permits an agent to deploy, connect to a machine or change anything outside the catalog. An incomplete catalog does not permit scanning machines to fill it. | **Proposed**. Reason: the `workspace` repository's access policy says the same; Backstage gives the same warning for its ownership relation ("not to be used by automated processes to for example assign authorization", [Backstage well-known relations](https://backstage.io/docs/features/software-catalog/well-known-relations), checked 2026-11-16). |
| P7  | Nothing is lost. Every change is a commit; retired entities stay readable.                                                                                                                                                                                        | **Proposed**. Reason: history explains why things are the way they are; see [section 9](#9-history-and-purge).                                                                                                                                                                                                                                             |
| P8  | The catalog never holds secret values or task status. It records where a secret lives.                                                                                                                                                                            | **Decided** for secrets (owner, O-2, [#25]): managing secrets is the team's job with a secrets manager such as Obscuro or Infisical. **Proposed** for task status. Reason: task status is derived on tasks (D-005) and would go stale if copied.                                                                                                           |

## 2. Entity documents

### 2.1 One document per entity, and what "source of truth" means

Each catalog entity is one Markdown document: frontmatter in YAML between `---`
lines, then a Markdown body.

- **Decided:** Markdown with structured fields at the top is the source of
  truth, and the agent index is generated from it (D-006).
- **Decided (owner, O-11, [#25]):** the D-006 invariant:
  1. The files on `main` are the catalog. Nothing about the catalog's
     content (facts, fact checks, relations, entity fields, body, type
     schemas) exists only outside that text.
  2. Changes are commits pushed to the repository. Validation runs on the
     resulting documents on `main` ([8.3](#83-validation-on-push)).
  3. The catalog pages, the agent index, search and every list or table used
     for queries are derived. Deleting them all and re-parsing the
     Markdown rebuilds them exactly.

  Reason: D-006 rejected "a structured-data-first catalog, with pages
  generated from a database"; these three rules keep the Markdown the real
  record.

- **Decided (owner, GD-1, [D-059](decisions/D-059-catalog-in-git-hosted-by-shinan.md),
  replacing O-11's storage, N-5 and N-9):** the documents are stored in Git,
  one repository per workspace, hosted by Shinan. Its `main` branch is the
  catalog; agents may push other branches, which are never indexed or shown.
  A document's path is its ID plus `.md` (`machine/musashi.md`), a type
  schema is `schema/<type>.md`, the start-here document is `start-here.md`,
  and a `README.md` may sit at the root ([8.1](#81-pushes)). How the
  repositories are stored and served is owned by
  [architecture](architecture.md) (§4.1, §8.5).
- **Decided (owner, O-12, [#25]; adapted by D-059):** the catalog changes only
  by pushes to its repository in Shinan ([8.7](#87-only-pushes-change-the-catalog)).
- The push log and events are not catalog content. They are records about
  changes to it, kept in Shinan's database, and are not expected to be
  rebuildable from the Markdown. **Proposed.** Reason: they describe who did
  what, not the things in the catalog; the
  [glossary](domain-model.md#event) already makes events their own record.
- **Proposed:** YAML, limited to plain maps, lists, strings, numbers,
  booleans, dates and `null` (no anchors, tags or multi-document files).
  Reason: YAML frontmatter is what the `workspace` repository and most Markdown
  tools already use; the limited subset keeps documents easy to read and
  parse the same way everywhere. Nested values are allowed because facts carry
  state and provenance.
- **Decided (owner, 2026-11-19, M2-Q17; M2-1, [#82](https://github.com/guneet-xyz/shinan/issues/82)):**
  how the subset is read. YAML 1.2's core schema, so `no`, `on` and dates stay
  text. Refused: anchors and aliases, tags, directives, `---` or `...` inside
  the frontmatter, duplicate keys, keys that are not plain text, and infinite
  or not-a-number values. Shinan reads dates itself: a date (`2026-11-14`) or a
  date and time with a UTC offset (`2026-11-14T09:30Z`); a time without an
  offset is refused, because "not in the future" and freshness could not be
  decided for it. A plain number is accepted only when it reads back exactly
  as written: `128`, `-5` and `0.5` are numbers, while `1.10`, `0x10`, `0o17`,
  `+12`, `1e3` and integers too large to hold exactly are refused with a
  request to quote them (a version is written `"1.10"`). Every field not
  listed for its kind of document is refused, so a misplaced fact is never
  silently ignored, and so is a fact key, type schema key or relation
  attribute named like a JavaScript object member (`__proto__`,
  `constructor`; fact keys and schema keys since
  [#113](https://github.com/guneet-xyz/shinan/issues/113)). Reason: every
  reader (the index, an agent, a person) then agrees on what the text
  says, and code that keeps keys in plain objects cannot be misled.
- **Decided (owner, 2026-11-19, M2-Q17; M2-1):** limits on what Shinan reads, checked before anything
  else. A document is at most 64 KiB of UTF-8 (65,536 bytes); the largest
  `workspace` repository document is about 19 KB. In the body:
  - a line may start with at most 32 nested quote or list markers;
  - at most 1,000 quotes or list items may be opened inside others;
  - at most 1,000 separate quotes or lists may be started;
  - at most 1,000 lines may continue a quote or list paragraph without its
    markers (lazy continuation lines);
  - at most 500 lines may consist of only `=` or `-` (setext heading
    underlines);
  - at most 1,000 link destinations may be opened with `](` and not closed.

  **When unsure, count.** The limits are checked by a quick scan that does
  not parse Markdown exactly; wherever a line could be one of the costly
  shapes, it counts as one. A line ends at `\n`, `\r\n` or a lone `\r`; a
  marker counts whether a space, a tab or the end of the line follows it; a
  line that could start with a marker but continues with text (`-x`, `1.5`)
  counts as a block start, and inside a quote or list as a lazy line; every
  unmarked line continuing a quote paragraph is lazy, at any indentation, and
  so is one in a list item indented less than the item's content, and one
  that keeps fewer markers than the line that opened its paragraph (`> > a`
  then `> b`); underlines count inside quotes and lists; markers inside code
  count too. Reason: an
  exact scan would be a second Markdown parser with its own gaps, while
  over-counting costs nothing for real documents, which stay below every
  limit (at most 452 blocks and 220 lazy lines, counted this way, across the
  `workspace` repository and Shinan's own documents).

  Longer or more complex documents are refused (`too-large`,
  `body-invalid`). Reason: the limits were set when the body model used a
  Markdown parser (micromark) whose time grows with the square of these
  shapes on hostile input (a 64 KB body of nested lists took over a minute),
  and every push check and index rebuild reads documents. The scan cannot be
  proven complete, so the checks of `main` read documents in a worker thread
  with a time limit ([8.3](#83-validation-on-push), "Cost").

- **Decided (owner, 2026-11-19, M2-Q17; M2-1b, [#102](https://github.com/guneet-xyz/shinan/issues/102)):**
  the body is read with markdown-it, in one shared configuration
  (`@shinan/markdown`) that the catalog pages render with too, so the server
  and the catalog pages agree on what is a heading and what is a link: CommonMark plus
  GitHub-style tables and strikethrough, raw HTML shown as text, no
  automatic links from bare addresses, no typographic replacements, and a
  nesting limit of 100 levels. markdown-it reads every hostile shape above
  in about linear time (the slowest, 64 KiB of `[`, in about 0.15 s), so the
  count limits are no longer needed for speed; they are kept as a cheap
  guard. Reason: the parser that showed the quadratic cases is replaced
  rather than fenced in, and the reader of the catalog pages is protected the same
  way as the server.
  - **Nesting the reader cannot follow is refused.** markdown-it stops
    reading, without an error, where blocks nest more than 100 levels deep
    (about 50 lists nested by indentation; the per-line depth limit does not
    see nesting built up across lines). A body that reaches that point is
    refused (`body-invalid`), so nothing after it is silently lost from the
    index, validation or the catalog pages.
  - **Links are listed as written.** A link's address is kept as written
    (Markdown escapes and character references decoded, nothing
    percent-encoded or decoded), and every link is listed, `javascript:`,
    `file:` and `data:` ones included, so validation sees them; the catalog
    pages never make those clickable.
  - **Rendering fits the Content Security Policy.** The shared configuration
    writes table alignment as a class, not a `style` attribute; shows an
    image as a link to it (with its alternative text), since the policy
    loads images only from Shinan itself; and leaves `javascript:`,
    `vbscript:`, `file:` and `data:` destinations as text.

### 2.2 The repository: the exit path

**Decided ([D-059](decisions/D-059-catalog-in-git-hosted-by-shinan.md);
[Git-based catalog plan §2.11](build-plan-git-catalog.md#211-backups-and-recovery)):**
the catalog's exit path is its repository. A clone of it, or a Git bundle,
holds every document and the whole history of `main` (and of any branch
fetched), readable without Shinan; every agent's clone is such a copy
already. There is no separate catalog export and no `history.jsonl`.

- **What the repository does not hold:** the push log (which agent and
  person pushed what), events and the security log. They stay in Shinan's
  database.
- **The workspace export** of tasks and their records (owner, O-75, [#25]) is
  not built yet: it is on the roadmap's cut line, before G2. Its format is
  owned by [architecture §5.5](architecture.md#55-export-and-import); its
  catalog part will be the repository. Importing a repository into a new
  workspace is designed with it, not done by an ordinary push: the `by` rule
  ([8.3](#83-validation-on-push)) would refuse old fact checks, since the
  importer would be the first pusher of every commit.
- **Clones are copies, not backups.** Nothing checks them, they may be
  behind, and a purge leaves them holding the purged text
  ([section 9](#9-history-and-purge)). Whether to keep regular copies off
  the server belongs to the roadmap's
  [backup review](roadmap.md#backups-before-migration).
- **Who can clone:** any agent with the `catalog:read` scope in the
  workspace ([identity §7.2](identity.md#72-scopes)). A clone holds
  everything in the catalog, because everyone in a workspace sees
  everything (owner, O-2, [#25]); it is exactly as sensitive as the
  workspace.

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
  (`id`, `status`, `owner`) plus what the catalog pages and index need (`type`, `title`,
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
  the catalog pages or index show one for a whole entity, it is calculated from the
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
  kept its entries consistent.
- **Decided (owner, 2026-11-19, M2-Q17; M2-1):** a body link, image or link definition is a reference
  when its destination has no scheme (such as `https:`) and does not start
  with `/`, `.`, `#` or `?`; a `#section` part is ignored, so
  `[cautions](machine/musashi#cautions)` refers to `machine/musashi`. Reason:
  such a link can only mean an entity inside the catalog, so it must resolve
  like any other reference; other relative links would be broken there.
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
  related tasks) are added by the catalog pages and are not
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
        value: 64 GB
        via: instance-metadata
        note: Metadata lags after a resize
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
"(many)" marks multi-valued keys; other keys are single-valued, except
relations, which are multi-valued unless marked otherwise
([4.2](#42-fact-identity-cardinality-and-current-facts)).

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
  `path`; `provides` a service; `depends-on` a service; `secrets-in` a secrets
  manager ([7.2](#72-where-secrets-live)). An infrastructure repository
  `configures` machines and services through the inverse of their
  `configured-by` (M2-1: relations are written on one side,
  [section 5](#5-relations)).
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
  provider described in the body (M2-1: `provided-by` is a plain key naming
  the provider, not a relation); `configured-by` a project; `depends-on`
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
  `rejected` or `superseded`; `decided_on` (date); `decided_by`. **Decided
  (owner, 2026-11-19, M2-Q17; M2-1):** `decision_state` is required on decisions; `decided_by` is a
  reference to a `person` entity, or `unknown`; these fields are refused on
  other types.
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
  actually in place. **Decided (owner, 2026-11-19, M2-Q17; M2-1):** both are the one key `enforcement`:
  the `intended` fact says how the rule is meant to be enforced and an
  `observed` fact what was seen, so a difference shows as a
  [discrepancy](#47-discrepancies).
- **Relations:** `applies-to` entity types, specific entities or the whole
  workspace (many); `see-also` runbooks (many). **Decided (owner, 2026-11-19, M2-Q17; M2-1):** a type is
  written as its schema document's ID (`applies-to: schema/machine`), the
  whole workspace as `workspace`; the same holds for runbooks and decisions.
- **Body:** the rule; why; what it covers and does not; exceptions.
- **Reason:** the `workspace` repository's policies (maintenance, access and
  safety, collaboration) are what agents most need, and they currently live
  outside the catalog. As entities they gain owners and history, and
  the agent index can return "the policies that apply to this machine".
- **Open:** whether Shinan itself enforces any policy beyond its own settings
  (for example workspace settings owned by [identity](identity.md), which a
  policy entity may describe for readers).

### person

Describes a person for readers: responsibilities, areas they own, how to reach
them for this work.

- **Facts:** `member` (link to the member record, or none); responsibilities as
  prose. **Decided (owner, 2026-11-19, M2-Q17; M2-1):** the `member` fact holds the person's handle,
  which is unique in the installation and never changes
  ([identity §8.7](identity.md#87-how-an-actor-is-written-in-text)).
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
`schema/<type>`, stored in the catalog as `schema/<type>.md`. Its frontmatter
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
  type name, and `schema` is reserved. **Decided (owner, 2026-11-19, M2-Q17; M2-1):** `workspace` and
  `task` are reserved too, because `applies-to: workspace` and `from-task`
  give them their own meaning.
- **Decided (owner, 2026-11-19, M2-Q17; M2-1), details of the key options:** `recheck` is a whole
  number of days (`30d`); a relation is multi-valued unless `many: false`
  (as in [4.2](#42-fact-identity-cardinality-and-current-facts)); a relation
  attribute cannot be named like a fact's long-form field (`value`, `to`,
  `via`, `note`, `task`, `remove`, `accepted`) or a fact check's field
  (`checked`, `by`, `scope`, `source`, `limits`); `required` names keys of the
  type. An extension of a built-in type may add keys, `required` keys and
  `sections`; a retired extension adds nothing.
- **Built-in types can be extended, not changed.** A workspace may add keys to
  a built-in type with its own `schema/<built-in>` document, for example a
  `machine.ups` key. It cannot remove built-in keys or change their options.
  Reason: Shinan's own features rely on built-in keys such as `checkout-on`
  and `runs-on`.
- **Changing a schema** is checked on push like any change
  ([8.3](#83-validation-on-push), "Type schema changes"). Adding keys or
  making a key multi-valued is always safe. Removing a key, or making a
  multi-valued key single-valued, is refused while any current entity would
  break the new rule; the refusal lists the affected entities. Reason: a
  schema change affects every entity of the type and how agents read them.
- **Retiring a type** is allowed only when it has no active entities.
  **Decided (owner, 2026-11-19, M2-Q17; M2-1):** nor deprecated ones, which are still in use; retired
  entities may keep a retired type ([8.3](#83-validation-on-push)).
- **Agents read schemas** in their clone (`schema/<type>.md`, and the
  skill's list of built-in types), so an agent creating a `domain` entity
  knows its keys.
- Keys outside a type's schema are still allowed (treated as single-valued)
  but warned about on push, so needs show up before schemas grow.
  **Proposed.**

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

| Kind of key                                                                                     | A fact is identified by                                                                                                                                        |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single-valued key, or single-valued relation (**decided**, owner, 2026-11-19, M2-Q17; M2-1)     | key + fact state + `via` (if given)                                                                                                                            |
| Multi-valued key                                                                                | key + fact state (**decided**, owner, 2026-11-19, M2-Q17; M2-1) + value                                                                                        |
| Multi-valued relation                                                                           | relation + fact state (**decided**, owner, 2026-11-19, M2-Q17; M2-1) + target + the attributes the schema names as identifying (for `checkout-on`, the `path`) |
| `unknown` fact of a multi-valued key or relation (**decided**, owner, 2026-11-19, M2-Q17; M2-1) | key + fact state (and the target, for a relation that names one)                                                                                               |

`via` is an optional short label for the means of observation, such as
`filesystem` or `instance-metadata`. It is only needed when two different
observations of one single-valued key are kept on purpose.

Reasons for the parts marked M2-1
([#82](https://github.com/guneet-xyz/shinan/issues/82)):

- **The fact state is part of every identity.** Otherwise an `intended` and
  an `observed` value of a multi-valued key, or a `planned` removal and the
  checkout it plans to remove ([4.4](#44-fact-states)), would be one fact and
  could not both be written.
- **A single-valued relation** (such as `on-machine`) is identified like a
  single-valued key. A new target then replaces the old one, and two
  different targets seen by different means are a discrepancy, as for any
  single-valued key.

**A change of state** (**decided**, owner, 2026-11-19, M2-Q17; M2-1). Because the state is part of the
identity, writing a fact in a new state does not by itself replace the fact
in the old one. A change of state (a `planned` fact becoming `intended` or
`observed`, an `unknown` fact becoming known) is one operation that names the
identity it supersedes, removes that fact and sets the new one. Reason:
replace-or-add stays a simple rule on identities, while plans and unknowns
do not linger beside the facts that settled them.

**Known values and `unknown` facts** (**decided**, owner, 2026-11-19, M2-Q17; M2-1; owner's direction
on [#95](https://github.com/guneet-xyz/shinan/pull/95)). Writing a known
(`intended` or `observed`) value removes, in the same operation, an `unknown`
fact it settles:

- for a single-valued key or relation, the `unknown` fact of the same key;
- for a multi-valued relation, an `unknown` fact that names the same target.

An `unknown` fact of a multi-valued key, or of a multi-valued relation with
no target, means "there may be more", so writing one known value does not
settle it; it stays until it is removed explicitly. Nothing is ever removed
by omission. Reason: one known endpoint does not mean every endpoint is
known.

**The fact identity key** (**decided**, owner, 2026-11-19, M2-Q17; M2-1): every fact gets one line of
text naming its identity, derived when the document is read and never
written in it. The agent index and the catalog pages name a fact by it (as
M2's operations, MCP tools and editor did). It is the key, the state, then `name=value` parts,
joined by `|`:

| Kind of key                   | Identity key                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| Single-valued key or relation | `disk.data.size\|observed`; with `via`, `disk.data.size\|observed\|via=filesystem` |
| Multi-valued key              | `endpoint\|intended\|value=https://shinan.guneet.dev`                              |
| Multi-valued relation         | `checkout-on\|observed\|to=machine/musashi\|path=/root/dockyard`                   |

Relation attributes follow the order of the schema's `identified_by`. Values
are written as text (`128`, `true`); `%`, `|` and line breaks inside a part
are written `%25`, `%7C`, `%0A` and `%0D`. Reason: anything that names a
fact can do so without rebuilding these rules, and the key changes exactly
when the identity does (for example when a
schema makes a key single-valued).

**Current facts.** The current facts are exactly the facts in the documents
on `main`. Earlier values live in [history](#9-history-and-purge).

**Replace or add beside.** A new fact **replaces** the current fact with the
same identity (the agent changes or moves that fact), and is **added beside**
the others otherwise; two current facts with one identity are refused on
push ([8.3](#83-validation-on-push)). So:

- a new observation of a single-valued key by the same means replaces the old
  one (Musashi's disk size seen again with `df`);
- an observation by a different means is added beside it (instance metadata),
  which can make a discrepancy;
- an `observed` fact is added beside an `intended` fact for the same key;
- a new value of a multi-valued key is added; a value that no longer holds is
  removed explicitly, never by omission.

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
- **No check IDs.** A fact check is identified by its group. Agents write
  their groups themselves, and add a fact to an existing group only when it
  is their own check and every field matches (its `by` names whoever first
  pushed it, [8.3](#83-validation-on-push)). Reason: invented local IDs such
  as `c5` collide when two agents add checks at once.
- A fact appears in exactly one group. A recheck moves it to the new group.
  Groups left empty are dropped from the current document and remain in
  history.
- **Decided (owner, 2026-11-19, M2-Q17; M2-1):** details of the long form. A relation's long form names
  its target with `to`; any other field is a relation attribute (such as
  `path` or `item`) and holds one value. **Decided
  (owner, 2026-11-19, M2-Q17; [#128](https://github.com/guneet-xyz/shinan/issues/128)):** an attribute
  is never named like a fact check's field (`checked`, `by`, `scope`,
  `source`, `limits`); such a fact is invalid. Reason: `{ to: …, by: guneet,
checked: 2020-01-01 }` under an agent's own fact check would read, in the
  text, as if someone else had checked it. A key that is not a relation has only
  `value`, `via`, `note`, `task`, `remove` and `accepted`. `remove: true` is
  only for `planned` facts. `task` holds a task ID (`T-12`) or the ID of an
  accepted `decision` entity. `planned` facts are in a group with no fact
  check, since they have none ([4.4](#44-fact-states)). A multi-valued key may
  hold one value without a list (`provides: service/container-registry`); a
  single-valued key never holds a list.

**Proposed.** Reason: one line per fact in the common case (see the Musashi
trial in [2.6](#26-example)), and facts checked together sit together.

### 4.4 Fact states

The four states are **decided** (plan, Catalog pillar), with `proposed`
renamed to **`planned`** (owner, O-5, [#25]; reason: "proposed" already means
a catalog proposal in M2, and a document status). Their meanings follow the
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
  with fact checks, and the operation names the `planned` fact it replaces
  ([4.2](#42-fact-identity-cardinality-and-current-facts), a change of
  state). **Proposed.** Reason: the `workspace` repository's rule that
  "planned changes are proposals until implemented and verified".
- An `unknown` fact becomes known the same way, by an operation that names
  it; a known value settles an `unknown` fact automatically only for a
  single-valued key, or a relation naming the same target
  ([4.2](#42-fact-identity-cardinality-and-current-facts)). **Decided
  (owner, 2026-11-19, M2-Q17; M2-1).**
- A merged change that is not yet applied is `intended`; its absence in the
  world shows as a [discrepancy](#47-discrepancies) with the `observed` fact.
  **Proposed** (glossary test). Reason: drift between source and reality is
  exactly what the catalog should surface.
- When the task behind a `planned` fact ends without delivering it (for
  example it is cancelled), the fact is flagged for removal. **Proposed.**
  Reason: abandoned plans otherwise linger as false promises. Depends on task
  events from [tasks](tasks.md).

### 4.5 Fact checks

> **Changed with the [Git-based catalog](build-plan-git-catalog.md)** (GC-3b): `by` names the agent that first pushed the commit introducing the fact check (D-066, amending D-061); see the last bullets.

A **fact check** records one act of checking. Several facts can share one
check when they were checked together.

| Field     | Required | Meaning                                                                                                                                                                                                                                                                                                                        |
| --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `checked` | yes      | When the check actually happened: a date, or date and time with a UTC offset ([2.1](#21-one-document-per-entity-and-what-source-of-truth-means)). Not when the page was edited or the proposal applied. `null` only for [imported facts](#131-provenance-of-imported-facts) whose origin is known but that were never checked. |
| `by`      | yes      | The actor who checked: a person, or an agent session acting for a person, written as the [identity](identity.md) document defines; Shinan for automatic fact checks. `unknown` is allowed only for imported checks.                                                                                                            |
| `scope`   | yes      | What exactly was checked, in one line.                                                                                                                                                                                                                                                                                         |
| `source`  | yes      | Where the evidence is: a URL (pinned where possible), a repository revision, or a short description of the observation. No raw logs or sensitive output.                                                                                                                                                                       |
| `limits`  | no       | What was deliberately or necessarily **not** checked, in one line.                                                                                                                                                                                                                                                             |

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
- **Decided (owner, GQ-3 as refined on 2026-11-20, [D-066](decisions/D-066-by-names-the-first-pusher.md); as built, GC-3b):**
  a new or changed fact check's `by` must name the agent, and its person,
  that **first pushed the commit introducing it** to Shinan, written as
  [identity §8.7](identity.md#87-how-an-actor-is-written-in-text) defines
  (`guneet via opencode-daedalus`); otherwise the push to `main` is refused
  (`by-not-first-pusher`, naming the file, the line, the commit, the `by`
  found and the one expected). Shinan writes nothing into the text: the
  agent writes `by` itself, and the push checks hold it to Shinan's own
  record of who first pushed each commit. So an agent may merge another
  agent's already-pushed branch (its fact checks still name that agent),
  but rebasing, cherry-picking or squashing another agent's commits makes
  new commits first pushed by whoever does it. A fact check exactly as it
  was on `main` before, restored by `git revert`, is not introduced again.
  How "new or changed" and "introducing" are decided:
  [8.3](#83-validation-on-push). Reason: a self-declared `by` that
  disagrees with Shinan's own record would undermine trust; see
  [identity](identity.md).
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
- **Decided (owner, 2026-11-19, M2-Q17; M2-1, [#82](https://github.com/guneet-xyz/shinan/issues/82)):**
  how age is counted. A fact checked on a date counts from the start of that
  day in UTC; it is due once the interval has passed since then. Facts with
  no fact check (an `unknown` list) and `checked: null` are **not checked**.

**Recheck intervals for built-in keys** (**decided**, owner, 2026-11-19, M2-Q17; M2-1; this settles
open question 2). Days; "none" means the age is shown but the fact is never
marked due. Reason for each band: 7 days for values that change with use
(free and used space); 14 to 30 days for things that change with routine work
(deployed version, release, endpoints, checkouts, addresses, where a service
runs); 90 days for configuration that changes on purpose but rarely (platform
size and OS, access method, networks, dependencies, where secrets live); 180
to 365 days for identity and ownership pointers (repositories, documentation
links, role, provider); none for facts that do not drift (architecture) or
record an event or a decision rather than a state.

| Type     | Key                                                                                               | Recheck |
| -------- | ------------------------------------------------------------------------------------------------- | ------- |
| project  | `repository` (many), `docs.readme`, `docs.agent_instructions`, `docs.deployment`, `issue_tracker` | 180     |
| project  | `release.latest`, `checkout-on`                                                                   | 30      |
| project  | `provides`, `depends-on`, `secrets-in`                                                            | 90      |
| machine  | `role`, `environment`, `hostname`, `configured-by`                                                | 180     |
| machine  | `provider`                                                                                        | 365     |
| machine  | `platform.os`, `platform.vm_size`, `access.method`, `access.host_key`, `on-network`, `secrets-in` | 90      |
| machine  | `platform.arch`                                                                                   | none    |
| machine  | `access.address`, `disk.root.size`, `disk.data.size`                                              | 30      |
| machine  | `disk.root.used`, `disk.root.free`, `disk.data.used`, `disk.data.free`                            | 7       |
| service  | `endpoint` (many), `deployment.built_from`, `runs-on`                                             | 30      |
| service  | `deployment.version`                                                                              | 14      |
| service  | `environment`, `configured-by`                                                                    | 180     |
| service  | `provided-by`                                                                                     | 365     |
| service  | `depends-on`, `secrets-in`                                                                        | 90      |
| runbook  | `last_successful_run`, `applies-to`                                                               | none    |
| runbook  | `changes_deployment`                                                                              | 365     |
| decision | `supersedes`, `applies-to`, `from-task`                                                           | none    |
| policy   | `enforcement`                                                                                     | 90      |
| policy   | `applies-to`, `see-also`                                                                          | none    |
| person   | `member`                                                                                          | none    |
| agent    | `agent_record`                                                                                    | none    |
| agent    | `on-machine`                                                                                      | 180     |

The machine's storage keys are `disk.root.*` and `disk.data.*` with `size`,
`used` and `free`; other storage keys are added with a schema extension.
Required keys (listed as not yet recorded when missing, [4.8](#48-unknowns)):
project `repository`; machine `role`, `environment`, `access.method`; service
`endpoint`, `environment`; runbook `last_successful_run`,
`changes_deployment`, `applies-to`; policy `enforcement`, `applies-to`; agent
`agent_record`, `on-machine`. Reason: these are what an agent needs before
relying on the entity at all.

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
- Discrepancies are detected automatically, shown prominently in the catalog pages and
  returned with the entity in the agent index.
- A discrepancy is resolved by one of: changing the world (a task, then a new
  check); changing the owning source (then a new `intended` check); removing
  an observation shown to be wrong, with the reason in the commit message; or recording
  that the difference is accepted, with a `note` and an owner. An accepted
  discrepancy stays visible but is not flagged as needing attention.
  **Decided (owner, 2026-11-19, M2-Q17; M2-1):** acceptance is written on the facts: each fact of the
  discrepancy names the person who accepted it with
  `accepted: person/<handle>` and says why in its `note`. A discrepancy is
  accepted when all its facts carry `accepted`. A recheck that leaves every
  value unchanged keeps `accepted` on the rechecked fact, so the acceptance
  stays. When a value changes, or a fact joins or leaves the discrepancy, the
  operation removes `accepted` from all its facts and the discrepancy needs
  accepting again. Reason: it keeps the acceptance in the text with the
  evidence; a routine recheck of an accepted difference (such as Musashi's
  lagging metadata) does not come back as a disagreement every time, while
  new evidence is looked at again.
  **With the Git-based catalog** (no catalog approval,
  [D-060](decisions/D-060-no-catalog-approval.md)), the agent writes
  `accepted` in the document like any field, and only when the person it
  names told it so, in the task; never on its own judgment (the skill,
  `references/facts.md`). Validation checks that `accepted` names a `person`
  entity ([8.3](#83-validation-on-push)). M2's `accept-discrepancy`
  operation, which applied only with that person's approval (M2-2,
  [#84](https://github.com/guneet-xyz/shinan/issues/84)), is gone with
  catalog proposals. Reason: accepting a discrepancy stays the person's
  decision; the commit history and the push log show who wrote it.
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

A known unknown leaves the list when a known value settles it (a
single-valued key, or a relation naming the same target) or when it is
removed explicitly; an `unknown` fact of a multi-valued key stays until it is
removed explicitly ([4.2](#42-fact-identity-cardinality-and-current-facts),
known values and `unknown` facts). **Decided (owner, 2026-11-19, M2-Q17; M2-1).**

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

- `owner` and `replaced_by` are entity fields, not relations, but the catalog
  pages show their inverses too ("owns", "replaces"). **Proposed.**
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
the whole catalog, its history and every clone of its repository.
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
      - to: service/obscuro
        item: musashi/dockyard/registry-admin
        note: Registry admin password
  ```

  Reason: agents then know where to look (and whom to ask) without the value
  ever passing through Shinan; the `workspace` repository already routes
  agents to Obscuro the same way.

### 7.3 A check for secret-looking values

Even with no secrets allowed, a value can slip in by mistake. Once pushed,
it is shown to every member of the workspace, sent to the model provider of
every agent that reads it (which cannot be recalled), kept in the
repository's history until a workspace owner removes it, and copied into
every clone that fetches it. A light check before a push is kept is much
cheaper than cleaning up afterwards. **Decided (owner, GD-10, GQ-2,
[D-060](decisions/D-060-no-catalog-approval.md)):**

- **Refuse a push**, on any branch, when anything it brings (files, commit
  messages, author and committer lines, branch names) contains a value
  that is almost certainly a credential: a private key block, a token with
  a known prefix (including Shinan's own tokens, per [identity](identity.md)),
  or a URL with a password in it. False alarms here are rare.
- **Warn** on weaker signs, such as `password=` or a long random-looking
  string: the push's answer points the text out, and the push still
  applies. Nobody approves pushes.
- **"Not a secret":** a workspace owner can allow one exact value the check
  refused or warned about (below).
- The check is a safety net, not a guarantee; secrets stay the team's job.
- **Decided (owner, 2026-11-19, M2-Q17; M2-1, [#82](https://github.com/guneet-xyz/shinan/issues/82)):**
  what is matched. The whole text of every file a push brings is checked
  (for a document, frontmatter and body), and the push's other text.
  Frontmatter values and keys are also checked as read, so a secret written with YAML
  escapes (such as `\x41` for `A`) is found too.
  - **Blocked:** private key blocks (`-----BEGIN … PRIVATE KEY-----`), also in base64 as Kubernetes secrets hold them, even after a certificate in the same bundle, and
    `age` secret keys; Shinan agent tokens (the prefix from
    [identity §7.4](identity.md#74-handling) followed by at least 20 letters
    and digits); GitHub, GitLab, Slack (including app tokens), AWS access
    key, Google API, Stripe live, AI provider (`sk-…` with mixed case and
    digits), npm, PyPI, Docker Hub, Hugging Face and SendGrid tokens by their
    prefixes; JSON Web Tokens; Slack and Discord webhook URLs; URLs with a
    password (`scheme://user:pw@`, the user may be empty), unless the
    password is a placeholder such as `****` or `${PASSWORD}`.
  - **Warnings:** `password`, `secret`, `token`, `api_key` and
    similar words, also inside names such as `DB_PASSWORD` or
    `AWS_SECRET_ACCESS_KEY`, followed by `=` or `:` and a value of four or
    more characters that is not a placeholder; strings of 32 or more letters,
    digits, `_`, `-`, `+` or `=` that mix upper and lower case with digits
    and look random (about 4 bits of entropy per character). Prose such as
    "The password: stored in Obscuro" is warned about too.
  - **Not flagged:** SSH public keys, and fingerprints, digests and
    subresource-integrity hashes (`SHA256:…`, `sha512-…`), whole, since host
    key fingerprints may be recorded ([7.1](#71-everyone-in-a-workspace-sees-everything)).
  - A finding names the kind and shows only the first few characters. Every
    validation message is cut the same way wherever it would repeat a
    secret-looking value (for example a token typed as a `type` or `by`), so
    the push's answer, which agents and their logs keep, never repeats
    one. A near-certain secret is cut from every message; a weaker sign only
    from messages about the text where it was found, so an ordinary word
    after `token:` is not cut elsewhere; and each message is checked itself
    before it is returned.
  - Each document on `main` is at most 64 KiB of UTF-8
    ([2.1](#21-one-document-per-entity-and-what-source-of-truth-means)),
    and any file of up to 1 MiB is read whole, so the check always reads
    all of it.

Reason: blocking only near-certain matches costs almost nothing, while one
leaked secret would have to be removed from the history, rotated at its
source, and chased through every clone (see [section 9](#9-history-and-purge)).

**As built (GC-3a; Git-based catalog plan §2.5, check 3, GQ-2):**

- **What is read:** every file, commit message (and author and committer
  line) and branch name a push brings that no branch held before, on any
  branch. History already checked is not read again. A file of up to 1 MiB
  is read whole.
- **A near-certain credential refuses the push**, whatever branch. The
  refusal names the file and line (or the commit, or "the branch name"),
  the kind of credential and its **fingerprint**, the SHA-256 of the value
  (`sha256:…`), never the value. Weaker signs are warnings
  (`secret-suspected`), printed and not blocking: nobody approves pushes.
- **"Not a secret" (decided, owner, GQ-2):** a workspace owner, after
  signing in again, allows one exact value by pasting it or the
  fingerprint from the refusal (`POST /api/workspaces/:id/catalog/allowed-values`).
  Shinan stores only the fingerprint, at most 100 per workspace, and
  records the allowance and its removal in the security log
  (`catalog.secret-allowed`, `catalog.secret-allow-removed`, fingerprint
  only). The workspace's pushes then let exactly that value through, as
  found or warned about; the same value with one character changed is
  refused again.
- **Not flagged (#157):** names made of words and numbers joined by `-` or
  `_`, such as a decision record's file name in a pinned link
  (`…/blob/<commit>/docs/decisions/D-054-public-image-registry-project.md`),
  and commit IDs in links to code hosts, are not "long random-looking
  strings".
- A refused push that held a secret is recorded in the security log
  (`catalog.push-refused`, with its codes and how many secrets, never
  text); the push and its objects are not kept.

## 8. Changing the catalog

> **Changed with the [Git-based catalog](build-plan-git-catalog.md)** (D-059, D-060, D-061, D-066; built in GC-3a and GC-3b): the catalog is a Git repository per workspace, changed only by pushes that Shinan checks. M2's catalog proposals, approval, repair and per-operation conflicts are gone (GC-5); this section describes the catalog as built.

### 8.1 Pushes

**Decided (owner, GD-1, [D-059](decisions/D-059-catalog-in-git-hosted-by-shinan.md)):**
agents change the catalog by committing to their clone of the workspace's
repository and pushing to Shinan
([architecture §8.5](architecture.md#85-git-endpoint)). People read it in
the browser and change it through their agents. **As built (GC-3a, GC-3b):**

- **Every push is checked** in Shinan's `pre-receive` hook before anything
  is kept ([Git-based catalog plan §2.5](build-plan-git-catalog.md#25-checks-on-push)):
  - **On every branch:** refs (only branches, plain names, `main` only
    fast-forwarded and never deleted, at most 100 branches), the objects a
    push brings (sizes, no symbolic links or submodules, names every system
    can check out, bounded trees, at most 1,000 new commits) and the
    secret check ([7.3](#73-a-check-for-secret-looking-values)).
  - **When `main` changes,** on its new tree against the old one: the
    layout (a document's path is its ID plus `.md`; only those, the
    type schemas, `start-here.md` and `README.md`), IDs never
    disappearing, validation ([8.3](#83-validation-on-push)), the `by` rule
    ([4.5](#45-fact-checks)) and at most 2,000 commits added to `main`.
- **One blocking problem refuses the whole push,** and nothing of it is
  kept. Each problem is one `remote:` line with its place (file and line,
  commit or ref), Shinan's code and a message; warnings are printed and do
  not block. The codes are core's `pushCheckCodes` and validation's
  `ProblemCode`; the skill explains each.
- **A check-only push** (`git push -o check-only origin HEAD:main`) runs
  every check and changes nothing.
- **Pushes to one repository are checked one at a time.** Git's own
  compare-and-swap decides a race on `main`: a push checked against an old
  `main` fails to update it, and the agent fetches and pushes again.
- **Every push is recorded** in the push log, with its agent and person,
  its refs before and after, and the first pusher of each commit it
  brought ([identity §11](identity.md#11-audit)). An accepted update of
  `main` is a `catalog.pushed` event and brings the agent index up to it
  ([architecture §5.3](architecture.md#53-how-sync-works)).

### 8.2 No catalog approval

**Never** (owner, GD-2, [D-060](decisions/D-060-no-catalog-approval.md),
superseding D-024): every push that passes Shinan's checks applies. M2's
approval classes, the strict setting, bulk approval and rejection, the
rules for approving one's own agents' proposals and `accept-discrepancy`
through a person's approval are gone (GC-5). Undo is `git revert`
([Git-based catalog plan §2.9](build-plan-git-catalog.md#29-undo-and-purge)).

**Kept:** a workspace's catalog is at most 20,000 documents and 50 MiB of
text on `main` (owner, M2-Q16), checked on push (`catalog-too-large`;
[Git-based catalog plan §2.10](build-plan-git-catalog.md#210-limits)).

### 8.3 Validation on push

Every push that changes `main` is validated, on the documents of its new
tree, before it applies. **As built (GC-3b).** Reason: the `workspace`
repository's `scripts/check.py` does this for links and frontmatter and is the
main reason its entries stay consistent.

Blocking rules (the push is refused):

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
  status value). **Decided (owner, 2026-11-19, M2-Q17; M2-1):** a warning, not blocking; see below.

Warning rules (printed with the push's answer; they do not block):

- weaker signs of a secret ([7.3](#73-a-check-for-secret-looking-values));
- fact key not in the type schema;
- the new fact check is older than the one it replaces;
- an external link does not respond (when link checking exists; **open**).

Validation cannot prove a fact matches reality; only fact checks do.

**Decided (owner, 2026-11-19, M2-Q17; M2-1, [#82](https://github.com/guneet-xyz/shinan/issues/82)):**
how the rules are applied.

- **Which problems belong to a push** (as M2 charged a proposal). In the
  documents it adds or changes on `main`, every
  blocking problem, and the warnings those documents did not already have;
  in documents it does not write, any problem it newly causes (for example a
  reference broken by removing an ID without keeping it as an alias).
  Reason: one old mistake must not block every later change, and a warning a
  person already accepted (a key outside the schema, a value confirmed not to
  be a secret) must not come back on every later recheck.
  Secret warnings are compared by the value found, not the message, so a new
  value is never taken for an accepted one. A document the change does not
  write is compared with its earlier, identical text, so even a document
  that no longer reads is never charged to others.
- **Repairing a document that reads with problems:** **removed** with
  catalog proposals (GC-5, [D-060](decisions/D-060-no-catalog-approval.md)).
  M2 let a workspace owner replace a stored document's whole text
  (`restore-document`, `catalog.repair`); a document that reads with
  problems is now fixed by a commit pushed to the catalog repository, which
  Shinan checks like any other
  ([Git-based catalog plan §2.5](build-plan-git-catalog.md#25-checks-on-push)).
- **Type schema changes.** When a change to a type schema document adds a
  problem a schema can cause (an unknown or retired type, a key outside the
  schema, a list on a single-valued key, a relation to a type no longer
  allowed, a fact identity now shared, a long form that no longer fits) to an
  entity of that type, the change is blocked and lists the entities. Retiring a type is blocked
  while active or deprecated entities use it; retired entities may keep a
  retired type. "Active type schema" therefore means one that is not retired.
- **Details of the rules.** IDs and aliases are unique across all documents.
  References resolve through IDs and aliases, retired entities included;
  `owner`, `decided_by` and `accepted` name `person` entities; a body link may
  also name a type schema document (built-in types have one without a
  document) or `start-here`. `by` is a written actor
  ([identity §8.7](identity.md#87-how-an-actor-is-written-in-text)). "Not in
  the future" allows five minutes of clock difference, and a date as soon as
  it has begun anywhere (UTC+14). `planned` facts name a task ID (its form only
  until tasks exist) or an accepted `decision`. "Older
  than the one it replaces" compares dates by day when either check has only a
  date.
- **More warnings.** The start-here warnings of [section 11](#11-start-here)
  (a step to a retired entity, or to one with discrepancies not accepted);
  and, when Shinan passes the current members, an owner whose `person` entity
  has no current `member` fact naming one ([2.3](#23-entity-fields)). The
  `member` fact holds the person's handle.
- **Task status in facts: a warning, and narrow** (**decided**, owner,
  2026-11-19, M2-Q17). A fact is warned about when its key ends in `status`
  or `state` and its value is a task workflow word of
  [tasks §7.2](tasks.md#72-statuses) that means little outside a task:
  `triage`, `to do`, `in progress`, `in review` or `verifying`. `done` and
  `cancelled` are left out. Reason: `subscription.status: cancelled` or
  `registration.state: done` are real facts, and a false alarm must never
  block a correct change.
- **Size.** A document longer than 64 KiB of UTF-8 is refused
  (`too-large`), as [2.1](#21-one-document-per-entity-and-what-source-of-truth-means)
  sets for documents. Reason: it bounds the work of every check, and no
  catalog document needs more.
- **Secret-looking values** on `main` are the secret check's
  ([7.3](#73-a-check-for-secret-looking-values), "On every push"), which
  runs on every branch and knows the values the workspace's owners
  allowed; validation does not report them a second time.
- **Cost (as built, GC-3b).** The checks of `main` run in a worker thread
  of the Git container, with a heap limit and a time limit of 60 seconds
  (`too-slow` past it). Parsed documents are kept by Git blob ID between
  pushes, so a push parses only the documents it changes; the rest are
  validated as M2 validated a revision (`validateChange`), the documents
  the push does not change judged against their own earlier problems.

**The `by` rule (decided, owner, GQ-3 as refined on 2026-11-20,
[D-066](decisions/D-066-by-names-the-first-pusher.md); as built, GC-3b).**
A new or changed fact check must name the agent that first pushed every
commit that introduced it ([4.5](#45-fact-checks)); otherwise the push is
refused (`by-not-first-pusher`).

- **New or changed:** a fact check group counts as unchanged when the old
  `main`'s version of its document (found by its ID, or by an ID in its
  `aliases`) has a group with the same `checked`, `by`, `scope`, `source`
  and `limits` covering every fact it now covers, with the same values.
  Removing facts from a group, or moving the document with its old ID kept
  in `aliases`, does not change it.
- **Restoring is not introducing:** a group exactly as it was on `main` at
  any time before (same five fields, covering facts it covered there) is
  not new, so `git revert` of its removal passes whoever pushes it. The Git
  container keeps the groups ever on `main` beside the repository; if that
  record were lost it starts again from the current `main`.
- **Introducing:** among the commits the push adds to `main`, a commit
  introduces a group when its version of the document holds it and none of
  its parents' versions does; a merge introduces a group none of its
  parents holds (written while resolving a conflict). Every introducing
  commit must have been first pushed by the agent the group names, so a
  group two agents introduced on two branches is refused unless they are
  the same agent.
- **First pushers** come from the record of the commit's first push (a
  commit Shinan never received before is first pushed by this push), and
  Shinan's own commits are first pushed by `shinan`.

### 8.4 Agents' documentation-impact obligation

When an agent's work changes or checks a durable fact that the catalog
records, the agent pushes the update to `main` before it reports the work as
done, or records on the task exactly what update is pending and why.
**Proposed.** Reason: this is the `workspace` repository's
"documentation-impact check", the habit that keeps that catalog current. The
obligation is scoped to the task, not a duty to refresh everything, and it
never authorizes extra access (P6). The fact checks it writes are its own:
`by` names the agent and its person, and `checked` is the real time of the
check, never rounded ([#158](https://github.com/guneet-xyz/shinan/issues/158)).
A fact check must name the agent that first pushed the commit introducing it
(owner, GQ-3 as refined, [D-066](decisions/D-066-by-names-the-first-pusher.md)),
so an agent may merge another agent's pushed branch, whose fact checks keep
naming that agent, but never rebases, cherry-picks or squashes another
agent's commits that add fact checks. How agents do
this with Git is the skill's ([agent integrations](agent-integrations.md#the-skill),
GC-9). During the trial, agents also push the matching change to Shinan when
they update a trial entity in the `workspace` repository (owner, O-72,
[#25]; O-72 stands with "a catalog proposal" read as "a push to the
catalog", [plan §6](build-plan-git-catalog.md#6-decision-records)).
How tasks show this, and whether it is part of "done", is owned by
[tasks](tasks.md); how agents are reminded, by
[agent integrations](agent-integrations.md).

### 8.5 Conflicts as Git merges

**As built (GC-3a, GC-3b; D-059):** conflicts are Git's. Two agents who
change the catalog at once each push to `main`; the first applies, and the
second's push fails to update `main` (it was checked against the old one)
and is told to fetch. It then merges or rebases its own commits onto
`origin/main` and pushes again, and its push is checked against the new
`main`. A conflict in a document is resolved in the merge like any other
text; a fact check written while resolving it names the agent pushing the
merge ([8.3](#83-validation-on-push), the `by` rule).

- Competing claims are resolved from evidence and check time, not from
  which push arrived last. Two different values with valid fact checks may
  both be kept, as a discrepancy where the key is single-valued. Reason:
  the `workspace` repository's rule ("resolve competing claims from
  evidence and observation time, not merge order").
- M2's per-operation expectations are gone with catalog proposals (GC-5).

### 8.6 Who sees work in progress

Agents working in parallel see each other's work as branches of the
catalog repository
([Git-based catalog plan §2.8](build-plan-git-catalog.md#28-branches)).
The browser shows only `main`; branches are never indexed. M2's waiting
proposals, review list and comments are gone (GC-5).

### 8.7 Only pushes change the catalog

**Decided (owner, O-12, [#25]; adapted by D-059):** the catalog is changed
only by pushes to its repository in Shinan, checked as [8.1](#81-pushes)
says; nothing else writes `main` except Shinan's own commits (a
repository's first commit, the migration's and a purge's rewrite). Editing
a clone changes nothing in Shinan until it is pushed. Reason: there must be one path to
change the source of truth, or the checks and history mean nothing.

## 9. History and purge

- **History is Git's.** Each workspace's catalog is a Git repository hosted
  by Shinan; every change is a commit, and the push log names the agent and
  person that first pushed it ([D-066](decisions/D-066-by-names-the-first-pusher.md);
  [Git-based catalog plan §2.6](build-plan-git-catalog.md#26-the-push-log-and-events)).
  **Decided (owner, GD-11).**
- **Undo is `git revert`,** a new commit an agent pushes to `main`, which
  passes the same checks. There is no revert button (no editing in the
  browser, GD-7). **Decided (owner, GD-11).**
- Retired entities stay readable, marked retired, linked to their replacement,
  and excluded from default search. **Proposed.** Reason: the `workspace`
  repository keeps retired entries (for example the Takezo machine) because
  their history still answers questions.
- **Purge** removes content that must not survive, such as a leaked secret or
  personal data, from everything Shinan keeps for the catalog, by rewriting
  the repository's history on the server. The screen calls it "Remove text
  from the catalog's history" (Settings › Catalog).
  - **Decided (owner, O-50, [#25]):** only workspace owners can purge,
    after signing in again; installation operators and agents cannot.
    Security-log entries are never purged (owner, N-13, [#25]).
  - **Decided (owner, GD-11):** copies outside Shinan are not reached:
    agents' clones are the operator's to clean (delete and clone again), and
    a purged secret must be rotated at its source. The screen says so, with
    the model providers that read the text
    ([operator guide](operator-guide.md#catalog-purge)).
  - **As built (GC-8, [#170](https://github.com/guneet-xyz/shinan/issues/170)):**
    - **What is purged: a text, everywhere.** A workspace owner types the
      text (4 to 10,000 characters, case-sensitive) and a reason. Every
      occurrence is replaced by `(purged)` in every version of every file,
      in commit messages and in commit authors' and committers' names and
      emails, on every branch; and by `purged` in file and folder names and
      branch names, which may not hold brackets, and in catalog IDs
      wherever they are written (a page's `id`, its aliases, references),
      so a page's ID still equals its path. A new name another page,
      folder or branch already has gets a number (`machine/purged-box-2`),
      the same in every commit, so a purge never writes one page over
      another, letter case aside so names stay distinct on Windows and
      macOS; the preview lists them (review of #197). Shinan's own records
      follow: branch names in the push log and the first-pusher record,
      timeline events, catalog IDs in the record of the catalog's move
      into Git (GC-6), and the agent index (rebuilt from the new `main`).
      Reason: a leaked secret or a
      person's details are a text, wherever they ended up; replacing only
      those bytes keeps every document readable and every record in its
      shape. The marker is plain words in brackets, so YAML still reads it
      as text.
    - **Whitespace does not have to match** (as M2 built it, owner
      M2-Q17). Any run of whitespace in the text matches any run of
      whitespace, and inside a long word (20 characters or more without a
      space, as keys and tokens are) a line break may stand between any two
      characters. Files that are not UTF-8 are matched byte for byte. The
      preview counts the places found across a line break, so the owner
      looks at them. Reason: an address or a name in a Markdown paragraph
      is wrapped, indented or written with other line endings, and a long
      secret can be split by an editor; a short word must not match the
      ends of two unrelated words on two lines.
    - **Nothing unreachable is left.** The rewrite writes a new repository
      and swaps it in, so commits no branch reached (a deleted branch's,
      or objects a push brought that no commit used) go too. Pushes that
      bring back a removed commit are refused with "this commit was
      removed by a purge: fetch, then reset your branch onto the new
      history". Reason: the Git container's API reads any commit by its
      full ID, and a clone still holds the old history.
    - **First pushers carry over.** Each rewritten commit is first pushed
      by whoever first pushed the commit it replaces (D-066), so the `by`
      rule (§8.3) holds on the new history and another agent can still
      merge an agent's rewritten branch.
    - **Only the exact text** (whitespace aside) is removed. The preview
      also reports places that may hold it encoded (base64, also wrapped
      across lines, every byte percent-encoded, quoted-printable, UTF-16,
      another letter case), also in a file that holds the text itself, for
      the owner to have them checked; they are not removed (review of
      #197).
    - **Shown first.** Before anything changes the owner sees where the
      text is: how many changes (commits) to the catalog, on `main` and on
      agents' branches; change messages; branch names; the pages that show
      it now; Shinan's records. Also shown, as in M2: copies in other forms a purge does not
      reach (URL-encoded, percent-encoded, HTML entities, JSON or YAML
      escapes), each to remove in its turn, and pages whose structure the
      purge changes (the text is in an ID or an alias, ends at a
      frontmatter key or spans lines of the frontmatter), for an agent to
      repair afterwards.
    - **Agents after a purge:** their next fetch sees `main` forced; they
      reset local branches onto the new history and redo unpushed work on
      top ([plan §2.9](build-plan-git-catalog.md#29-undo-and-purge)).
    - **Recorded:** a `catalog.purged` event with who, why and the counts;
      a security-log entry with the counts. Neither holds the text, and
      the reason may not repeat it. A purge runs in the background and
      can take minutes on a large history. A rewrite that was never
      recorded stays listed as unfinished until the owner removes the
      same text again, which records it without rewriting; it is never
      recorded under another text. Once recorded, the Git container drops
      the keyed hash it knew the text by.
    - **(M2, v0.3.0)** purged M2's stored revisions, proposals and comments
      and stored the cleaned latest text as a new revision; GC-6 moved the
      catalog into Git and dropped those tables.
    - Mechanism: [architecture §4.4](architecture.md#44-purge).

## 10. The catalog pages

The catalog pages are the catalog shown to people: `main` as a file tree,
rendered pages, search and the commit history, with no editing in the
browser for now (**decided**, owner, GD-7 to GD-9, GQ-6,
[D-064](decisions/D-064-catalog-not-wiki.md), which renamed "the wiki" to
"the catalog"). Their layout and navigation are owned by
[human experience](human-experience.md#the-catalog). The catalog requires
them to show (**proposed**; reason: these are what make the catalog
trustworthy at a glance, per D-007):

- the body, rendered;
- every fact with its state, value, age, "due for recheck" or "not checked"
  where they apply (owner, O-19, [#25]), and its fact check's source, scope and
  limits;
- discrepancies, prominently, with both sides' evidence;
- generated parts: inverse relations, the policies and runbooks that apply,
  and later related tasks;
- who last changed a page and its history, from `main`'s commits and the
  push log;
- workspace-wide: "Needs attention" (discrepancies, facts due for recheck,
  known unknowns, files that cannot be read) and Recent changes, `main`'s
  commit history with the agent and person that first pushed each commit
  (GQ-6).

Type index pages are gone (D-064: people browse by folder, not by type); a
type's schema is a page in the `schema` folder.

## 11. Start here

A new person or a new agent needs a short path through the catalog. The plan
names a "start here" path (its "Wiki and onboarding" pillar, now the catalog
pages, [D-064](decisions/D-064-catalog-not-wiki.md); shown as
[human experience](human-experience.md#start-here-and-onboarding) says);
this section defines its content.

**Decided (owner, O-18, [#25]):** each workspace has one **start-here
document** with two paths, one for people and one for agents, built from the
same catalog pages. Its "changed only with catalog approval" lapsed with
[D-060](decisions/D-060-no-catalog-approval.md): it changes by a push like
any document. Details (**proposed**):

- It is the file `start-here.md` in the catalog repository, written in
  Markdown like an entity, but it is not an entity type and holds no facts.
  Reason: the path is a curated route, not a thing in the world; keeping it
  in the catalog gives it history.
- Each path is an ordered list of entity references with a sentence on each:
  - **for people:** what the workspace covers, the main projects, machines and
    services, the policies that matter, who owns what;
  - **for agents:** the policies to follow first (for example safety and
    deployment approval), how to find context for a task, the
    documentation-impact obligation ([8.4](#84-agents-documentation-impact-obligation)),
    and how this workspace wants catalog changes made.

  Reason: the `workspace` repository has the same split today: its README
  "Start here" for people and `AGENTS.md` plus `docs/agent-entrypoint.md` for
  agents.

- It links and does not copy: each step is a reference to an entity (usually a
  policy or runbook) or a generated list, or, during the trial, a URL (see the
  shape below). Validation warns when a step points
  to a retired entity or to one with discrepancies. Reason: P3; onboarding
  pages are where copies go stale fastest.
- **Decided (owner, 2026-11-19, M2-Q17; M2-1, [#82](https://github.com/guneet-xyz/shinan/issues/82)):**
  the document's shape. Its ID is `start-here`; its fields are `title`
  (required), `summary`, `owner`, `imported_from`, and the two paths `people`
  and `agents` (both required, possibly empty). Each step is a map with
  exactly one target and a `note`, the sentence shown with it:

  ```yaml
  people:
    - to: project/shinan
      note: What this workspace is for and how its work is tracked.
    - list: discrepancies
      note: Facts that disagree and need someone to look.
  agents:
    - url: https://git.guneet.dev/guneet/workspace/src/branch/main/docs/access-and-safety.md
      note: The access and safety policy; follow it before touching any machine.
  ```

  `to` is an entity reference; `list` one of `discrepancies`,
  `due-for-recheck`, `known-unknowns` or `recent-changes`
  ([section 10](#10-the-catalog-pages)); `url` an `http` or
  `https` address. Reason for `url`: during the trial, policies stay in the
  `workspace` repository ([M2 build plan §4](build-plan-m2.md#4-starting-the-catalog-part-of-the-trial)),
  so the agents' path must be able to point at them. The body is free
  Markdown for its page in the catalog. `waiting-for-approval` was a list
  until the Git-based catalog removed catalog approval (D-060); a step that
  still names it reads as a problem (`start-here-invalid`), and the parser's
  version changed with it (GC-4).

- Generic rules that every Shinan agent follows in every workspace (how to
  read and push the catalog, how to report presence) are not in this
  document; they ship with the skill ([agent integrations](agent-integrations.md)).
  The agents' path contains only this workspace's rules. Reason: separates
  product conventions from team policy.
- Agents read the agents' path in their clone: the skill tells them to fetch
  and read `start-here.md` on `origin/main` before they start
  ([agent integrations, the skill](agent-integrations.md#the-skill)). The
  catalog pages show the people's path.
- **Open:** whether larger workspaces need more than one path (per team or
  per role).

## 12. The agent index

The agent index is a machine-readable form of the catalog, generated from the
documents on `main` of the workspace's catalog repository (D-006, D-059,
**decided**). It serves search and the catalog pages; agents read the
documents from their clone, not the index (D-063, **decided**). How it is
kept in step with `main` is owned by
[architecture §5.3](architecture.md#53-how-sync-works); built in
[GC-4](build-plan-git-catalog.md#gc-4-the-index-from-main)
([#166](https://github.com/guneet-xyz/shinan/issues/166)).

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
- the body, split by heading so a search can return one section;
- the commit of `main` it was built from, and its document's path and Git
  blob ID.

Workspace-level entries: the agents' start-here path, every type schema
(built-in and custom), and the lists of discrepancies, facts due for recheck
and known unknowns.

### 12.2 Rules

- **Generated only, rebuildable.** Nothing writes to the index except
  generation from the Markdown, and it can be rebuilt from the Markdown alone.
  **Decided** (D-006; owner, O-11, [#25]).
- **Every answer names the commit of `main` it was built from.**
  **Proposed.** Reason: with it, a claim "the catalog said X" can be checked
  later against that commit.
- **Lag is visible.** If the index is behind `main`, or is being rebuilt, the
  answer says so. **Proposed.** Reason: a silently stale index is the failure
  D-007 exists to prevent.
- **Freshness is computed when read**, from `checked` and the current time,
  not stored. **Proposed.** Reason: stored ages are wrong a day later.
- **Everything is readable** by any agent of a workspace member with the
  catalog read permission ([section 7](#7-secrets-and-visibility)).
- **Format:** **proposed** structured JSON per entity, following the same
  field names as the documents. Reason: every coding tool and MCP client
  handles JSON; matching names mean agents learn one vocabulary. The exact
  schema is in [12.4](#124-the-index-format) (M2-3).
- **Queries the index must support** (names and shapes owned by
  [agent integrations](agent-integrations.md)), **proposed**: get an entity by
  ID or alias; list by type and status; get a type schema; text search across
  titles, summaries, facts and body sections; neighbours through relations;
  the policies and runbooks for an entity; context for a task's related
  entities; and the workspace lists in 12.1. "What changed since" is not an
  index query any more: it is `main`'s commit history with the push log
  ([plan §2.7](build-plan-git-catalog.md#27-the-index-after-a-push)).

### 12.3 Automatic fact checks by Shinan

Some facts can be checked by Shinan itself through its git host connections,
for example that a `repository` exists and is reachable. Such checks would
be fact checks with Shinan as the actor, written to the catalog repository
and checked like any push. **Proposed.** Reason: cheap, reliable rechecks of routing facts keep the
catalog fresher without agent effort. The roadmap proposes them for phase 2a;
which facts is owned with [git hosts](git-hosts.md). Shinan never connects to
machines to check facts (P6).

### 12.4 The index format

**Decided (owner, 2026-11-19, M2-Q17; M2-3, [#85](https://github.com/guneet-xyz/shinan/issues/85));
this settles open question 7; changed for the Git-based catalog in GC-4.**
The JSON the index answers with. The catalog pages' REST routes (M2-7)
return these shapes; the catalog MCP tools that also did are gone (D-063).
Field names are the documents' own (`replaced_by`, `checked`, `via`, `to`);
fields the index adds use the same lower-case, underscore style. Times are
ISO 8601.
Reason: one vocabulary for documents and answers (12.2), and a shape an agent
can read without a schema at hand.

**Every answer** carries:

| Field            | Meaning                                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `catalog_commit` | The commit of `main` the index stands at (a full Git commit ID), or `null` before its first build.                                                        |
| `index_behind`   | `true` while the index is behind `main`, has not yet been built from the workspace's repository, was built by another parser, or is being rebuilt (12.2). |

For a screen, the two fields map to three states: `catalog_commit` `null`
and `index_behind` `false` means the workspace has no repository yet (being
set up); `null` and `true` means its repository is being indexed for the
first time; a commit means ready, catching up with `main` while
`index_behind` is `true`.

**An entity** (`entity`):

| Field                                               | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `type`, `title`, `summary`, `status`, `owner` | The entity fields ([2.3](#23-entity-fields)). These six are also the **entity summary** used wherever another entity is named in an answer.                                                                                                                                                                                                                                                                                                                      |
| `replaced_by`, `aliases`, `imported_from`           | As written; `aliases` is a list, possibly empty.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `decision_state`, `decided_on`, `decided_by`        | On `decision` entities only.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `path`, `blob`                                      | The document's path on `main` (its ID plus `.md`) and the Git blob ID of its text there.                                                                                                                                                                                                                                                                                                                                                                         |
| `facts`                                             | Every current fact in document order: `identity` (the fact identity key, [4.2](#42-fact-identity-cardinality-and-current-facts)), `key`, `state`; the long-form fields `value`, `to`, `via`, `note`, `task`, `remove`, `accepted` and a relation's `attributes` **only when written**; `many`, `relation` and `in_schema` from the type schema; `check` (`checked`, `by`, `scope`, `source`, `limits`, or `null` for facts with no fact check); and `freshness`. |
| `freshness` (on each fact)                          | Computed when read ([4.6](#46-freshness)): `status` (`none` for `planned`, `not-checked`, `fresh` or `due`), `age_days`, `recheck_days` from the type schema, and `due_at`.                                                                                                                                                                                                                                                                                      |
| `relations.outgoing`                                | Relations written on the entity: `key`, `to` as written, `state`, `identity`, `attributes`, and `entity` (the target's summary, through its ID or an alias; `null` for `schema/<type>`, `workspace`, a task ID, or a target that does not resolve).                                                                                                                                                                                                              |
| `relations.incoming`                                | Relations written on other entities that name this one by ID or alias, generated ([section 5](#5-relations)): `key`, `inverse` (the name shown here, such as `checkouts`), `from` (a summary), `state`, `identity`, `attributes`. Other entities' `owner` and `replaced_by` appear here too, as `owns` and `replaces`, with no state or identity.                                                                                                                |
| `discrepancies`                                     | `key`, `values` (as text), `accepted`, and `facts`: the identity keys of its facts, which are in `facts` ([4.7](#47-discrepancies)).                                                                                                                                                                                                                                                                                                                             |
| `known_unknowns`                                    | Identity keys of `unknown` facts ([4.8](#48-unknowns)).                                                                                                                                                                                                                                                                                                                                                                                                          |
| `not_yet_recorded`                                  | `missing_keys` (required keys not mentioned) and `not_checked` (identity keys of facts with `checked: null`), kept apart from known unknowns.                                                                                                                                                                                                                                                                                                                    |
| `applies`                                           | `policies` and `runbooks` that apply through `applies-to`, each with the entity's summary, `through` (`entity`, `type` for `schema/<type>`, or `workspace`), `state` and `identity`. Retired ones are left out: they no longer apply.                                                                                                                                                                                                                            |
| `body`                                              | The body split by heading ([2.5](#25-body)): `heading` (`null` for the text before the first heading), `level`, `anchor` and `text` (the section's exact Markdown). Who wrote a section is not part of the index: the section credits and word provenance M2 kept for trust labels went with them (D-062).                                                                                                                                                       |
| `problems`                                          | What kept the text from being read as section 2 describes (`code`, `message`); normally empty, since validation blocks such text, but a later parser may read old text differently.                                                                                                                                                                                                                                                                              |

**Lists** carry `items` and `next_offset` (the offset of the next page, or
`null`), 50 items by default and at most 500:

| Answer                      | Items                                                                                                                                                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entities by type and status | Entity summaries, by ID.                                                                                                                                                                                                                                                                    |
| `discrepancies`             | The entity's summary, the discrepancy's fields, and `fact_details`: its facts in full, with both sides' evidence. Accepted ones are included and marked.                                                                                                                                    |
| `due-for-recheck`           | `entity` and `fact`, most overdue first.                                                                                                                                                                                                                                                    |
| `known-unknowns`            | `entity` and `fact`.                                                                                                                                                                                                                                                                        |
| `not-yet-recorded`          | `entity`, `missing_keys` and `not_checked` (facts in full).                                                                                                                                                                                                                                 |
| Search                      | `entity`, `rank`, and `sections`: up to three matching body sections, best first. No `next_offset`; at most 100 results.                                                                                                                                                                    |
| Type schemas                | `type`, `built_in`, `extended`, `document` (`schema/<type>`, or `null`), `status`, `keys` (each with `many`, `relation` as `targets`, `identified_by` and `inverse`, `recheck_days` and `built_in`), `required` and `sections`. One type adds its document's `title`, `summary` and `body`. |

**Other answers:** neighbours give the entity's summary with `outgoing` and
`incoming` as above; policies and runbooks for an entity give `policies` and
`runbooks` as in `applies`; the start-here path gives `start_here` (`null`
until the document exists) with `path` (`agents` or `people`), `title`,
`summary`, `document` (its `path` on `main` and `blob` ID) and `steps` as
written ([section 11](#11-start-here)), each `to` step with the `entity` it
names.

Choices the format implies, all **proposed**:

- **Retired entities** are left out of search, entity lists and the
  workspace lists unless asked for, as for search in
  [section 9](#9-history-and-purge). Reason: a retired machine's old facts
  should not ask for rechecks; its page and history stay readable by ID.
- **Search** takes words as a web search does (`"exact phrase"`, `or`,
  `-word`), matched with PostgreSQL's English stemming and also word for word,
  so IDs and values such as `instance-metadata` are found. An entity matches
  as a whole (its fields, facts and body), so `-word` leaves it out wherever
  the word appears. Titles weigh most, then summaries, then facts and IDs,
  then the body; its best matching section can lift its rank. Reason:
  [architecture §4.1](architecture.md#41-postgresql-holds-everything);
  agents search by names and values as often as by prose.
- **No section credits.** M2 credited each body section with the revision
  and author that last changed it and the least-trusted author whose words
  remained, from Shinan's records of each revision, for trust labels (M2-Q6,
  M2-Q17). **Decided (owner, [D-062](decisions/D-062-no-catalog-trust-labels.md)):**
  trust labels, and with them the credits and word provenance, are gone.
  Who pushed each commit is in the push log
  ([plan §2.6](build-plan-git-catalog.md#26-the-push-log-and-events)).

## 13. Mapping from the `workspace` repository's catalog

When and how the move happens is owned by the [roadmap](roadmap.md) (D-018).

- **Trial (decided, owner, O-71, [#25]):** agents fill the trial catalog by
  checking facts at their owning sources, using `workspace` repository entries
  only as a map. Pointers such as repository URLs are checked at their source
  too, and nothing is copied (amended by the owner on 2026-11-18, M2-Q10, in
  [build plan M2 §7.3](build-plan-m2.md#73-answers-on-the-trial-start-kit)),
  so 13.1 does not apply to the trial.
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
- **The importer** (person or agent session) is the author of the import,
  not the checker. Last-checked times are never refreshed by the
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
| `integrations/opencode/*`                                                                   | Not imported. Replaced by Shinan's agent setup (credential helper, clone and skill) and plugin ([agent integrations](agent-integrations.md))                                                                                                                                                                                                                                                       |
| `scripts/check.py`, tests                                                                   | Replaced by the checks on every push; not imported                                                                                                                                                                                                                                                                                                                                                 |
| Pull requests changing catalog files; `CHANGELOG.md`                                        | Not imported: from cutover, changes are pushes, with the push log and events. The changelog and Git history stay in the archived repository.                                                                                                                                                                                                                                                       |
| Forgejo issues                                                                              | Tasks ([tasks](tasks.md))                                                                                                                                                                                                                                                                                                                                                                          |

Extracting facts from prose cannot be fully automatic. **Proposed:** import
each entry with its prose as body and the facts that can be extracted
reliably, then extract the rest gradually, entity by entity, through ordinary
pushes. Reason: a lossless first import, then improvement through
the normal flow, avoids a risky one-shot conversion.

### 13.3 Mapping back, for a rollback

The roadmap allows a rollback during the window after cutover: the catalog is
taken from a clone of the catalog repository back into a `workspace`
repository pull request
([roadmap §6.7](roadmap.md#67-rollback-and-emergency-access), which owns the
process and links here for every mapping rule). The catalog repository's
layout ([2.2](#22-the-repository-the-exit-path)) is not the `workspace`
repository's, so a **rollback converter** turns its documents back into files that
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

1. **Unchanged documents are left alone.** A document no commit on `main`
   changed after the migration import keeps its file at the frozen cutover
   revision; the converter does not touch it.
   Reason: a rewrite would turn an untouched entry into a large, meaningless
   diff.
2. **Changed and new documents are converted** to their old path:
   - a document with `imported_from` ([2.3](#23-entity-fields)) naming a whole
     file goes back to that path;
   - a document created after cutover goes to its type's folder below, using
     its slug as the file name.

| Catalog repository   | Old path                     |
| -------------------- | ---------------------------- |
| `project/<slug>.md`  | `catalog/projects/<slug>.md` |
| `machine/<slug>.md`  | `catalog/machines/<slug>.md` |
| `service/<slug>.md`  | `catalog/services/<slug>.md` |
| `runbook/<slug>.md`  | `runbooks/<slug>.md`         |
| `decision/<slug>.md` | `decisions/<slug>.md`        |

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
| The catalog repository's history                                        | Not committed. A bundle of the repository is kept beside the rollback, which the PR description names, so the history since cutover is not lost                                                                                                                                                                                                                     |

- The page fields never claim a whole-page check: they describe one fact
  check, and every other fact carries its own date in the generated section.
  Reason: the `workspace` rule against claiming more than was checked.
- Values are written on one line, so the frontmatter stays `key: value` as
  `scripts/check.py` requires.

#### Documents that still fail `scripts/check.py`

After converting, the converter runs `scripts/check.py` on the result.
**Proposed:** every document that has no old place (rule 3) or still fails the
check is committed **unchanged, in the catalog repository's format**, under a clearly
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

| Document                                        | What this document needs                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Domain model and glossary](domain-model.md)    | The terms used here, including catalog repository, push, push log and workspace export.                                                                                                                                                                                                                                                                                       |
| [Architecture and operations](architecture.md)  | The catalog repositories, how Git is served and the checks on push; the index built from `main` (the D-006 invariant); purge as a history rewrite; type schema documents in the parser and index. Its workspace export ([§5.5](architecture.md#55-export-and-import)) writes the catalog in the layout of [2.2](#22-the-repository-the-exit-path), including `history.jsonl`. |
| [Identity, agents and permissions](identity.md) | Who may clone and push (scopes); workspace owners only for "not a secret" values, export and purge; the push log; the written form of an actor in a fact check's `by` ([identity §8.7](identity.md#87-how-an-actor-is-written-in-text)); Shinan's token prefixes for the secret check.                                                                                        |
| [Agent integrations](agent-integrations.md)     | The skill and agent setup for reading and pushing the catalog; delivering the agents' start-here path; the recheck-before-acting and documentation-impact conventions.                                                                                                                                                                                                        |
| [Human experience](human-experience.md)         | Catalog pages, freshness, discrepancies, Recent changes and page history, start-here presentation, schema pages, and the workspace export link for owners.                                                                                                                                                                                                                    |
| [Tasks and work](tasks.md)                      | Links between tasks and catalog entities; promoting task decisions to `decision` entities; telling the catalog when a task behind a `planned` fact is cancelled ([4.4](#44-fact-states)); whether the documentation-impact obligation is part of "done" ([8.4](#84-agents-documentation-impact-obligation)).                                                                  |
| [Git host integrations](git-hosts.md)           | Repository identity for `project` facts; which facts Shinan can check automatically, by reading only (owner, N-4, [#25]).                                                                                                                                                                                                                                                     |
| [Roadmap and migration](roadmap.md)             | The rollback process, which uses the converter in [13.3](#133-mapping-back-for-a-rollback), and the rehearsal run of it (R14).                                                                                                                                                                                                                                                |

## Proposed in this document

1. [Principles](#1-principles) P4 to P7, including "catalog content is context,
   not authorization".
2. A limited YAML subset for frontmatter; the
   [repository as the exit path](#22-the-repository-the-exit-path); [entity fields](#23-entity-fields) as bookkeeping, not
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
11. [Changes are pushes](#81-pushes), with
    [no catalog approval](#82-no-catalog-approval) (decided, D-060);
    [validation on push](#83-validation-on-push); [conflicts as Git merges](#85-conflicts-as-git-merges);
    [work in progress on branches](#86-who-sees-work-in-progress).
12. The [documentation-impact obligation](#84-agents-documentation-impact-obligation)
    for agents.
13. [History](#9-history-and-purge): Git's history, reverts, retired entities,
    and purge warnings about copies outside Shinan.
14. [Catalog page requirements](#10-the-catalog-pages), [start-here](#11-start-here) details and
    the [agent index](#12-the-agent-index) content, rules and
    [format](#124-the-index-format).
15. [Import provenance details](#131-provenance-of-imported-facts), the
    [mapping](#132-what-maps-where) from the `workspace` repository, and the
    [reverse conversion for a rollback](#133-mapping-back-for-a-rollback).

## Open questions

1. Body embeds of fact values (`{{fact:...}}`): worth the loss of raw
   readability? ([2.5](#25-body))
2. _Settled:_ recheck interval values for built-in keys are in
   [4.6](#46-freshness) (M2-1, [#82](https://github.com/guneet-xyz/shinan/issues/82);
   decided by the owner on 2026-11-19, M2-Q17).
   The number is kept so references to the later questions stay valid.
3. Flagging gaps between intended and observed values of multi-valued keys.
   ([4.7](#47-discrepancies))
4. Whether Shinan enforces any `policy` beyond its own settings.
   ([policy](#policy))
5. External link checking: whether, how often, and from where.
   ([8.3](#83-validation-on-push))
6. More than one start-here path for larger workspaces. ([11](#11-start-here))
7. _Settled:_ the agent index's JSON format is in
   [12.4](#124-the-index-format) (M2-3, [#85](https://github.com/guneet-xyz/shinan/issues/85);
   decided by the owner on 2026-11-19, M2-Q17).

## Decisions needed from the owner

None.

[#25]: https://github.com/guneet-xyz/shinan/issues/25
[#26]: https://github.com/guneet-xyz/shinan/issues/26
