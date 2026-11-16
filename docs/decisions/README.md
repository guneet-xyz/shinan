# Decision log

Status: **draft for review** ([issue #13](https://github.com/guneet-xyz/shinan/issues/13)).

This folder holds Shinan's decision records: one file per decision about how
Shinan is designed and built, with its context, reasons, consequences and the
alternatives that were considered. The [high-level plan](../plan.md#6-decisions-so-far)
lists decisions D-001 to D-020 in one line each. The records here give each one
its full reasoning.

A decision record is not the same thing as a `decision` catalog entity. The
[domain model and glossary](../domain-model.md) uses "`decision` entity" for a
team's lasting decisions stored in a workspace's catalog inside the product.
This folder records decisions about Shinan itself, made in this repository.
Always say "decision record" for a file here.

## How to read this document and the records

Every rule in this README is marked:

- **Decided**: follows from the plan, which is cited.
- **Proposed**: suggested here, with a reason. The owner confirms or changes it
  when approving this document.
- **Open**: not settled; listed under [open questions](#open-questions).

Inside each decision record:

| Section | What it holds |
|---|---|
| Decision, Reasons | The plan's words, quoted exactly. Decided. Nothing else goes here. |
| Context | Sourced facts, each with a link. External facts also give the date they were checked. |
| Notes | Remarks about the plan's wording, such as a reason that was not independently checked. Each note says whether it is a sourced fact or proposed. Only present where needed. |
| Consequences | **Decided** items that follow from the plan, with a citation. Proposals made in other documents are only linked, never copied. **Open** items name the document that owns them. |
| Alternatives considered | Each alternative carries one label: **Recorded** (it appears as an option in the plan or its history), **Implied** (by the decision's wording or reasons, not recorded as discussed) or **Not recorded**. |
| Owning documents, Related open questions, History | Links and dates. |

A record does not start new proposals. Where the decision log noticed a
possible proposal for another document, it is listed under
[suggestions for owning documents](#suggestions-for-owning-documents) instead.
**Proposed.** Reason: a proposal should start in the document that owns the
subject, where it is reviewed with that subject.

## Index

All twenty records were accepted by the owner on 2026-11-16 when the plan was
approved ([issue #1](https://github.com/guneet-xyz/shinan/issues/1),
[PR #2](https://github.com/guneet-xyz/shinan/pull/2)).

| ID | Decision | Status | Date | Owning documents |
|---|---|---|---|---|
| [D-001](D-001-above-git-hosts.md) | Shinan sits above git hosts and does not replace their issues or PRs | Accepted | 2026-11-16 | Product overview, Git host integrations, Tasks and work |
| [D-002](D-002-host-neutral-task-id.md) | The task is the core object and has a host-neutral task ID | Accepted | 2026-11-16 | Tasks and work |
| [D-003](D-003-task-starts-with-intent.md) | A task starts where the intent starts; outside issues become tasks automatically | Accepted | 2026-11-16 | Tasks and work |
| [D-004](D-004-link-prs-directly.md) | Agent-driven work links PRs directly; repository issues only when people need them | Accepted | 2026-11-16 | Tasks and work |
| [D-005](D-005-derived-task-status.md) | Task status is calculated from linked work | Accepted | 2026-11-16 | Tasks and work |
| [D-006](D-006-document-first-catalog.md) | The catalog is document-first, with a generated agent index | Accepted | 2026-11-16 | Catalog |
| [D-007](D-007-fact-provenance.md) | Every fact records its fact state, source and last-checked time | Accepted | 2026-11-16 | Catalog |
| [D-008](D-008-agents-connect-from-outside.md) | Agents connect from outside; Shinan runs no model in the first phases | Accepted | 2026-11-16 | Agent integrations |
| [D-009](D-009-github-and-forgejo-first.md) | GitHub and Forgejo are the first git hosts | Accepted | 2026-11-16 | Git host integrations |
| [D-010](D-010-integrate-do-not-embed.md) | Integrate with tools such as Multica, Linear and Plane through their APIs; do not embed them | Accepted | 2026-11-16 | Product overview |
| [D-011](D-011-private-repository-and-brand.md) | Private repository, internal brand "Shinan", first deployment at `shinan.guneet.dev` | Accepted | 2026-11-16 | Product overview, Architecture and operations |
| [D-012](D-012-self-hostable.md) | Self-hostable by design | Accepted | 2026-11-16 | Architecture and operations |
| [D-013](D-013-business-model-deferred.md) | Business model, licensing and pricing are deferred | Accepted | 2026-11-16 | Product overview, Roadmap and migration |
| [D-014](D-014-three-connection-levels.md) | Agents connect at three connection levels: MCP and skill, plugin, launcher | Accepted | 2026-11-16 | Agent integrations |
| [D-015](D-015-public-web-app-with-sign-in.md) | The web app is on the public internet and requires sign-in | Accepted | 2026-11-16 | Identity, agents and permissions; Architecture and operations |
| [D-016](D-016-musashi-and-deployment-approval.md) | `shinan.guneet.dev` runs on Musashi; every deployment needs the owner's approval | Accepted | 2026-11-16 | Architecture and operations |
| [D-017](D-017-shared-git-host-accounts.md) | Agents use their person's git host account; Shinan attributes actions from its own records | Accepted | 2026-11-16 | Identity, agents and permissions |
| [D-018](D-018-start-empty-migrate-later.md) | Shinan starts empty; the `workspace` repository moves over only when Shinan is ready | Accepted | 2026-11-16 | Roadmap and migration |
| [D-019](D-019-workspaces-from-the-start.md) | One user at first, but workspaces and invitations are designed in from the start | Accepted | 2026-11-16 | Identity, agents and permissions |
| [D-020](D-020-stack-chosen-from-options.md) | The technology stack is chosen by the owner from options with trade-offs | Accepted | 2026-11-16 | Architecture and operations |

The full list of owning documents, with planned paths, is in each record.

**Proposed:** the index is updated in every pull request that adds a record or
changes a status, and may later be generated from the records' front matter.
Reason: it is the first place people and agents look. Parallel pull requests
will sometimes conflict on this table; the one merged second resolves the
conflict, which is a one-line change.

## Record format

**Proposed.** Each record is one Markdown file with a short block of
structured fields at the top (YAML front matter), followed by fixed sections.
Reason: the `workspace` repository's
[decision records](https://git.guneet.dev/guneet/workspace/src/branch/main/decisions/README.md)
use a similar shape (front matter with `id`, `status`, `owner` and `date`, then
sections), and it works for both people and agents. This log adds sections and
fields for alternatives, amendments and supersession.

File name: `D-NNN-short-slug.md`, for example `D-001-above-git-hosts.md`.

```markdown
---
id: D-021
title: Short statement of the decision
status: proposed
date: 2026-11-20
decided_by:
evidence:
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-021: Short statement of the decision

## Context

Sourced facts that led to the decision, each with a link. External facts give
the date they were checked.

## Decision

The decision, in one short paragraph. For accepted decisions, the exact
wording the owner accepted.

## Reasons

Why this choice was made, in the words the owner accepted.

## Notes

Optional. Remarks about the wording above, each marked as a sourced fact or
proposed.

## Consequences

Decided items with a citation; links to proposals in owning documents; open
items with the document that owns them.

## Alternatives considered

Each alternative labelled Recorded, Implied or Not recorded.

## Owning documents

Links to the documents that specify the details.

## Related open questions

Questions this decision leaves for the owning documents.

## History

When the decision was proposed, changed and accepted, and when maintained
sections were updated, with links.
```

Field meanings (**proposed**; reason: each one answers a question a reader or
an agent asks first):

| Field | Meaning |
|---|---|
| `id` | `D-` and a three-digit number. Never changes. |
| `title` | One line, short enough for the index. |
| `status` | One of the statuses below. |
| `date` | The date the current status was set. For accepted records, the date the owner accepted it. |
| `decided_by` | `owner` once accepted or rejected. Empty while proposed. |
| `evidence` | A link to where the owner decided, usually the approved pull request. Empty while proposed. |
| `supersedes`, `superseded_by` | IDs of records this one fully replaces, or that fully replace it. |
| `amends`, `amended_by` | IDs of records this one changes in part, or that change it in part. |

## Statuses

| Status | Meaning |
|---|---|
| `proposed` | Put forward by an owning document, which must confirm or change it. Not yet agreed with the owner. |
| `accepted` | Agreed with the owner. Documents follow it. |
| `rejected` | The owner decided against it. Kept so the same idea is not proposed again without new reasons. |
| `withdrawn` | A `proposed` record already merged into `main` that its owning document dropped before the owner decided. |
| `superseded` | Fully replaced by a later accepted record, named in `superseded_by`. |

- **Decided:** `proposed` and `accepted` keep the plan's meanings: "Accepted"
  means agreed with the owner; "Proposed" means the owning document must
  confirm or change it ([plan, section 6](../plan.md#6-decisions-so-far)).
- **Proposed:** `rejected`, `withdrawn` and `superseded`. Reason: a decision log
  is only useful if it also shows what was ruled out and what replaced what.
  A proposal dropped before it ever reached `main` needs no record: its closed
  pull request is enough.
- **Proposed:** an accepted record that has been amended stays `accepted`, and
  its `amended_by` field points to the change. Reason: most of it still applies,
  and readers need to know to read both.
- **Proposed:** a record becomes `accepted` or `rejected` only through the
  owner's decision, shown by the `evidence` link. Reason: the plan defines
  "accepted" as agreed with the owner.

## Numbering

- **Decided:** decision IDs have the form `D-NNN` and D-001 to D-020 are taken
  ([plan, section 6](../plan.md#6-decisions-so-far)).
- **Proposed:** numbers are given in order and never reused, including for
  rejected and withdrawn records. Reason: other documents, pull requests and
  task notes cite these IDs; reusing one would make old citations point at the
  wrong decision.
- **Proposed:** a new record takes the next number not used on `main` or in any
  open pull request (check with `gh pr list` and by searching for `D-0` in open
  pull requests). If two pull requests still collide, the one merged second
  renumbers its record and its citations before merging. Reason: several
  document authors work in parallel, and this needs no central allocator.
- **Proposed:** three digits, growing to four only after D-999. Reason: keeps
  file names sorting correctly for the foreseeable future.

## How documents propose new decisions

**Proposed** process. Reason: ten documents are being written in parallel, so
the log needs one path that works inside each document's own pull request,
with no second round trip.

1. **Inside a document**, an author marks a choice "proposed" with its reason,
   as the [plan's conventions](../plan.md#9-how-the-documents-are-produced)
   require. Most proposals stay there and need no decision record.
2. **A choice needs a decision record** when at least one of these is true:
   - it constrains more than one document;
   - it would be costly to reverse once code exists;
   - it changes or reinterprets an accepted decision record;
   - the owner has to make it (cost, accounts, deployment, security posture,
     scope).
3. **The author lists it** in the document's own "Decisions needed from the
   owner" section, with a recommended option and a one-line reason.
4. **The author adds the record in the same pull request**, with status
   `accepted`, `decided_by: owner`, `evidence` set to that pull request and the
   date the owner approves it. The pull request description lists every record
   it adds. The owner's approval of the pull request is the acceptance. If the
   owner decides against one, the author changes that record to `rejected`
   (or changes the decision as the owner asks) before merging.
5. **If the owner decides outside a pull request**, for example in an issue
   comment, a small pull request adds the record with `evidence` linking to
   that comment.
6. **A `proposed` record** may be merged before the owner decides, only when
   several documents need to cite the same proposal. It names its owning
   document.
7. **Documents cite records by ID and link**, for example
   `[D-017](decisions/D-017-shared-git-host-accounts.md)`, and do not restate
   them ([AGENTS.md](../../AGENTS.md): "Record decisions in `docs/decisions/`
   and link to them instead of repeating them").

## Changing a decision

- **Proposed:** in an accepted record, the front matter's `id`, the **Decision**
  and the **Reasons** sections are fixed. Reason: they must keep showing what
  was agreed and why; silently editing them would hide that a decision changed.
  The `workspace` repository's
  [decision records](https://git.guneet.dev/guneet/workspace/src/branch/main/decisions/README.md)
  follow the same rule ("Preserve superseded decisions with links to their
  replacements").
- **Proposed:** the other sections (Context, Notes, Consequences, Alternatives
  considered, Owning documents, Related open questions) are maintained. They
  may be updated as owning documents settle, as long as each update adds a
  History line. Reason: they describe the decision's surroundings, which keep
  changing, and a frozen copy would drift from the owning documents.
- **Proposed:** the `status`, `date`, `decided_by`, `evidence`,
  `superseded_by` and `amended_by` fields change only through the steps below.
- **Proposed:** to change a decision completely, write a new record that lists
  the old one in `supersedes`. When the owner accepts the new record, the old
  record's status becomes `superseded` and its `superseded_by` field points to
  the new one, in the same pull request.
- **Proposed:** to change part of a decision, write a new record that lists the
  old one in `amends` and says exactly which part changes. The old record stays
  `accepted` and gets `amended_by`. Reason: a full replacement would force
  copying the unchanged parts, which then drift.

## Relationship to the plan

- **Decided:** the plan's section 6 table is the owner-approved summary, and
  "each decision becomes a decision record with its reasoning"
  ([plan, section 6](../plan.md#6-decisions-so-far)).
- **Proposed:** the Decision and Reasons sections of D-001 to D-020 quote the
  plan's wording exactly. Reason: that is the wording the owner accepted;
  rewording it here could change its meaning without approval.
- **Open:** whether the plan's table should later point to this index as the
  current list. See [decisions needed from the owner](#decisions-needed-from-the-owner).

## Suggestions for owning documents

While writing the records, the decision log noticed these possible proposals.
They are **not** part of any record. Each is a suggestion for the owning
document to adopt, change or ignore.

| Suggestion | For | Related record |
|---|---|---|
| Say what happens to the `workspace` repository's issue-per-task practice when it moves into Shinan. | [Roadmap and migration](../roadmap.md) | [D-004](D-004-link-prs-directly.md), [D-018](D-018-start-empty-migrate-later.md) |
| Core flows work on both GitHub and Forgejo; features specific to one host may add to them but are not required. | [Git host integrations](../git-hosts.md) | [D-009](D-009-github-and-forgejo-first.md) |
| Avoid depending on services that are only available as someone else's hosted product. | [Architecture and operations](../architecture.md) | [D-012](D-012-self-hostable.md) |
| Avoid designs that rely on a particular pricing, licence or business model. | [Product overview](../product-overview.md) | [D-013](D-013-business-model-deferred.md) |
| Say whether the owner's deployment approval rule applies to Shinan installations that others self-host. | [Architecture and operations](../architecture.md) | [D-016](D-016-musashi-and-deployment-approval.md), [D-012](D-012-self-hostable.md) |

## Dependencies on other documents

- [Domain model and glossary](../domain-model.md): the records use its terms
  and link to its proposals. It is still in review
  ([PR #14](https://github.com/guneet-xyz/shinan/pull/14)); because records only
  link to it, its changes need no edits here unless an anchor moves.
- [Domain model and glossary](../domain-model.md): add **decision record** as a
  term ("a file in `docs/decisions/` recording a decision about Shinan
  itself"), next to the `decision` entity it must not be confused with.
- Each owning document named in a record specifies the details of that
  decision. Planned paths:
  [product overview](../product-overview.md), [catalog](../catalog.md),
  [tasks and work](../tasks.md), [identity, agents and permissions](../identity.md),
  [git host integrations](../git-hosts.md),
  [agent integrations](../agent-integrations.md),
  [human experience](../human-experience.md),
  [architecture and operations](../architecture.md),
  [roadmap and migration](../roadmap.md).
- [Roadmap and migration](../roadmap.md): owns phases. Several records refer to
  phases 1 to 3 as defined in the [plan, section 10](../plan.md#10-phases-after-the-documents).

## Open questions

1. **When does a decision made inside an approved document count as
   accepted?** The plan's process ends with an owner review of the complete,
   integrated set ([plan, section 9](../plan.md#9-how-the-documents-are-produced)).
   It is not stated whether a decision is accepted when the owner approves the
   document that proposes it, or only after that final review.
2. **Which document owns integrations with Multica, Linear and Plane?**
   [D-010](D-010-integrate-do-not-embed.md) decides to integrate through their
   APIs, but no document in the plan's section 8 lists these integrations in
   what it owns. The [domain model](../domain-model.md#supporting-terms)
   proposes that Tasks and work owns the term "outside tool".
3. **Should decisions stated in plan prose but without an ID get records?**
   Examples: GitLab comes after GitHub and Forgejo
   ([plan, section 5](../plan.md#5-integration-points)); notifications are not
   in the first version; agent sessions connected only through MCP are marked
   "self-reported" ([plan, section 4](../plan.md#4-product-pillars)).
4. **Owner decisions raised by the domain model.** The
   [domain model](../domain-model.md#decisions-needed-from-the-owner) asks the
   owner for several decisions and says each needs a record here. Some
   reinterpret or change approved plan content (for example its reading of
   D-005, and changes to plan section 4 wording). This log does not assume any
   outcome. Under the process above, each decision the owner makes is recorded
   as a new record in the domain model's pull request, amending the affected
   record where one exists.

## Decisions needed from the owner

| # | Decision | Recommended | Reason |
|---|---|---|---|
| 1 | Adopt this record format, the five statuses and the numbering rule. | Adopt as written. | Close to the `workspace` repository's practice and needs no tooling. |
| 2 | How and when records are written and accepted (open question 1). | The record goes into the document's own pull request as `accepted`, listed in its description; the owner's approval of that pull request is the acceptance, and the final integrated review can supersede it. | One path for many parallel authors, firm decisions to build on, and later changes stay visible. |
| 3 | May records contain consequences proposed by the decision log itself, and are their non-normative sections updated over time? | Records only cite proposals made in owning documents; Decision and Reasons are fixed, other sections are maintained with a History line. | Proposals get reviewed where their subject lives, and records do not drift from the documents they summarise. |
| 4 | Where decisions live long-term. | Keep the plan's section 6 table as the approved snapshot and add one line pointing to this index, in a separate small pull request on the plan. | The plan stays an accurate record of what was approved; new decisions get one home. |
| 5 | Which document owns integrations with Multica, Linear and Plane (open question 2). | Tasks and work, with Git host integrations as the alternative; Tasks and work maps outside items to tasks either way. | Tasks and work already holds the "outside tool" term; Git host integrations would fit if these are treated like other connections with webhooks and reconciliation. |
| 6 | Records for plan prose without IDs (open question 3). | None for now; add one only when a document proposes changing such text. | Already approved in the plan; a record adds value only when there is reasoning or a change to capture. |
