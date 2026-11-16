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

## How to read the statuses in this document

Every rule in this README is marked:

- **Decided**: follows from the plan, which is cited.
- **Proposed**: suggested here, with a reason. The owner confirms or changes it
  when approving this document.
- **Open**: not settled; listed under [open questions](#open-questions).

Inside each decision record, the **Decision** and **Reasons** sections restate
the plan and are decided. **Context**, **Consequences** and **Alternatives
considered** mark each item as decided, proposed or unknown, because some of it
is reasoning added while writing the record.

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

## Record format

**Proposed.** Each record is one Markdown file with a short block of
structured fields at the top (YAML front matter), followed by fixed sections.
Reason: the `workspace` repository's decision records already use this shape
and it works for both people and agents; it also follows the same
document-first idea Shinan uses for its catalog ([D-006](D-006-document-first-catalog.md)).

File name: `D-NNN-short-slug.md`, for example `D-001-above-git-hosts.md`.

```markdown
---
id: D-021
title: Short statement of the decision
status: proposed
date: 2026-11-20
decided_by: owner
evidence: https://github.com/guneet-xyz/shinan/pull/NN
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-021: Short statement of the decision

## Context

What situation or question led to this decision. Link to issues, pull
requests and documents rather than repeating them.

## Decision

The decision itself, in one short paragraph. For accepted decisions, the
exact wording the owner accepted.

## Reasons

Why this choice was made.

## Consequences

What follows from the decision: what it commits Shinan to, what it rules out,
and what other documents must now handle. Mark each item decided, proposed or
open.

## Alternatives considered

Each alternative and why it was not chosen. Write "Not recorded" where the
alternatives are unknown rather than inventing them.

## Owning documents

Links to the documents that specify the details.

## Related open questions

Questions this decision leaves for the owning documents.

## History

When the decision was proposed, changed and accepted, with links.
```

Field meanings (**proposed**; reason: each one answers a question a reader or
an agent asks first):

| Field | Meaning |
|---|---|
| `id` | `D-` and a three-digit number. Never changes. |
| `title` | One line, short enough for the index. |
| `status` | One of the statuses below. |
| `date` | The date the current status was set. For accepted records, the date the owner accepted it. |
| `decided_by` | `owner` for accepted records. Empty while proposed. |
| `evidence` | A link to where the owner accepted it, such as an issue comment or an approved pull request. |
| `supersedes`, `superseded_by` | IDs of records this one fully replaces, or that fully replace it. |
| `amends`, `amended_by` | IDs of records this one changes in part, or that change it in part. |

## Statuses

| Status | Meaning |
|---|---|
| `proposed` | Written down for the owner to decide. Documents may rely on it only as a proposal. |
| `accepted` | Agreed with the owner. Documents follow it. |
| `rejected` | The owner decided against it. Kept so the same idea is not proposed again without new reasons. |
| `withdrawn` | Dropped by its author before the owner decided. |
| `superseded` | Fully replaced by a later accepted record, named in `superseded_by`. |

- **Decided:** `proposed` and `accepted` have the meanings the plan gives them:
  "Accepted" means agreed with the owner; "Proposed" means the owning document
  must confirm or change it ([plan, section 6](../plan.md#6-decisions-so-far)).
- **Proposed:** `rejected`, `withdrawn` and `superseded`. Reason: a decision log
  is only useful if it also shows what was ruled out and what replaced what.
  Keeping these records stops the same debate from starting again without the
  earlier reasoning.
- **Proposed:** an accepted record that has been amended stays `accepted`, and
  its `amended_by` field points to the change. Reason: most of it still applies,
  and readers need to know to read both.
- **Proposed:** only the owner moves a record to `accepted` or `rejected`.
  Reason: the plan defines "accepted" as agreed with the owner.

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
the log needs one simple path that does not make every document author edit
this folder at the same time.

1. **Inside a document**, an author marks a choice "proposed" with its reason,
   as the plan's conventions require. Most proposals stay there. They do not
   need a decision record.
2. **A choice becomes a decision record** when at least one of these is true:
   - it constrains more than one document;
   - it would be costly to reverse once code exists;
   - it changes or narrows an existing decision record;
   - the owner has to make it (cost, accounts, deployment, security posture,
     scope).
3. **The author lists it** under "Decisions needed from the owner" in their
   document, with a recommended option and a one-line reason (as the shared
   author brief requires).
4. **When the owner decides**, the decision is recorded here as a new record
   with status `accepted` or `rejected`, `date` set to the day the owner
   decided, and `evidence` linking to where they did so. The record is added in
   its own pull request, or in the owning document's pull request if that is
   simpler. Either way the pull request references this document's issue or
   the owning document's issue.
5. **A `proposed` record** may also be added before the owner decides, when
   several documents need to cite the same proposal. It must say which
   document owns it.
6. **Documents cite records by ID and link**, for example
   `[D-017](decisions/D-017-shared-git-host-accounts.md)`, and do not restate
   them (AGENTS.md: "Record decisions in `docs/decisions/` and link to them
   instead of repeating them").

## Changing a decision

- **Proposed:** the Decision and Reasons sections of an accepted record are not
  rewritten. Reason: the record must show what was agreed and why at the time;
  silently editing it would hide that the decision changed. The `workspace`
  repository follows the same rule ("Preserve superseded decisions with links to
  their replacements").
- **Proposed:** allowed edits to an accepted record: fixing typos and broken
  links, filling in the `superseded_by` or `amended_by` fields, updating
  planned document paths once documents exist, and adding to History.
- **Proposed:** to change a decision completely, write a new record that lists
  the old one in `supersedes`. When the owner accepts the new record, the old
  record's status becomes `superseded` and its `superseded_by` field points to
  the new one, in the same pull request.
- **Proposed:** to change part of a decision, write a new record that lists the
  old one in `amends` and says exactly which part changes. The old record stays
  `accepted` and gets `amended_by`. Reason: a full replacement would force
  copying the unchanged parts, which then drift.
- **Proposed:** the index table above is updated in every pull request that
  adds a record or changes a status. Reason: it is the first place people and
  agents look.

## Relationship to the plan

- **Decided:** the plan's section 6 table is the owner-approved summary, and
  "each decision becomes a decision record with its reasoning"
  ([plan, section 6](../plan.md#6-decisions-so-far)).
- **Proposed:** the Decision section of D-001 to D-020 quotes the plan's
  wording exactly. Reason: that is the wording the owner accepted; rewording it
  here could change its meaning without approval.
- **Open:** whether the plan's table should later be replaced by a link to this
  index, so decisions have one home. See
  [decisions needed from the owner](#decisions-needed-from-the-owner).

## Dependencies on other documents

- [Domain model and glossary](../domain-model.md): the records use its terms.
  It is still in review
  ([PR #14](https://github.com/guneet-xyz/shinan/pull/14)); where it changes a
  term, the records follow.
- Each owning document named in a record confirms or adjusts the
  "proposed" consequences listed there. Planned paths:
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
   proposes that Tasks and work owns the term "outside tool"; product overview
   covers positioning only.
3. **Does D-016's approval rule apply beyond `shinan.guneet.dev`?** It is
   written for the owner's deployment. Self-hosted Shinan installations
   ([D-012](D-012-self-hostable.md)) are run by their own operators; the record
   assumes the rule does not reach them.
4. **Should decisions stated in plan prose but without an ID get records?**
   Examples: GitLab comes after GitHub and Forgejo
   ([plan, section 5](../plan.md#5-integration-points)); notifications are not
   in the first version; agent sessions connected only through MCP are marked
   "self-reported"; attribution is necessary but not a selling point
   ([plan, section 3](../plan.md#3-what-shinan-does-not-do)).
5. **Candidate decisions from the glossary.** The
   [domain model](../domain-model.md#decisions-needed-from-the-owner) asks the
   owner for five decisions and says each needs a record here. If accepted,
   they would be recorded as follows (this log does not assume the outcome):

   | Domain model proposal | Record it would need |
   |---|---|
   | Read D-005 as "calculated from linked work plus recorded events" | New record that amends [D-005](D-005-derived-task-status.md) |
   | Let agents set and clear `needs a person` | New record; it changes plan text in [section 4](../plan.md#4-product-pillars) that has no ID |
   | Rename the fact state `proposed` to `planned` | New record; it changes plan text in [section 4](../plan.md#4-product-pillars) and affects [D-007](D-007-fact-provenance.md) |
   | Give each workspace its own task ID prefix | New record that amends [D-002](D-002-host-neutral-task-id.md) only if the owner reads its `T-123` as binding; otherwise a new record citing it |
   | Add an `awaiting deployment approval` task flag | New record citing [D-005](D-005-derived-task-status.md) and [D-016](D-016-musashi-and-deployment-approval.md) |

   Other proposals in the domain model also pass the "becomes a decision
   record" test above, for example that nothing is shared between workspaces
   except the person, that an agent can never do more than the member it acts
   for, that only people approve catalog proposals, and that events are not
   edited. They stay proposals in their owning documents until the owner
   decides them.

## Decisions needed from the owner

1. **Adopt this record format, the five statuses and the numbering rule.**
   Recommended: adopt as written. Reason: it matches the `workspace`
   repository's practice and needs no tooling.
2. **Who may add records and when.** Recommended: any document author may add a
   `proposed` record when several documents cite it, and accepted records are
   added only after the owner decides. Reason: keeps the log trustworthy while
   letting parallel authors share a proposal.
3. **When a decision counts as accepted (open question 1).** Recommended: when
   the owner approves a pull request that lists the decision explicitly in its
   description, with the final integrated review able to supersede it. Reason:
   documents need firm decisions to build on before the final review, and
   supersession keeps any later change visible.
4. **Where decisions live long-term.** Recommended: keep the plan's section 6
   table as it is (the approved snapshot) and add one line there pointing to
   this index as the current list, through a separate small pull request on
   the plan. Reason: the plan stays an accurate record of what was approved,
   while new decisions get one place to live.
5. **Owner of tool integrations (open question 2).** Recommended: give
   integrations with Multica, Linear and Plane to Tasks and work, with
   positioning staying in Product overview. Reason: those tools hold tasks and
   issues, which Tasks and work already links to, and the domain model already
   gives it the "outside tool" term.
6. **Plan prose without IDs (open question 4).** Recommended: do not create
   records for them now; create one only if a document proposes changing one.
   Reason: they are already approved in the plan, and a record adds value only
   when there is reasoning or a change to capture.
7. **How to record the glossary's five owner decisions (open question 5).**
   Recommended: record each one the owner accepts or rejects as a new record
   with the next free number, amending D-005 or D-002 where the table above
   says so. Reason: the earlier records keep the wording the owner approved,
   and the amendment shows exactly what changed.
