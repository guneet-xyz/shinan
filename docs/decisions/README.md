# Decision log

Status: **approved by the owner on 2026-11-16** ([issue #13](https://github.com/guneet-xyz/shinan/issues/13); integrated in [#26](https://github.com/guneet-xyz/shinan/issues/26)).

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

- **Decided**: follows from the plan or from an owner answer, which is cited.
- **Proposed**: suggested here, with a reason.
- **Open**: not settled; listed under [open questions](#open-questions).

Most rules here were accepted by the owner on 2026-11-16 in answers O-93 to
O-98 on [issue #25](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6912648147).

Inside each decision record:

| Section                                           | What it holds                                                                                                                                                                                                                    |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decision, Reasons                                 | Fixed. For D-001 to D-020, the plan's words, quoted exactly. For later records, the decision as the owner accepted it, and the owner's stated reason or "Owner's choice; no reason recorded".                                    |
| Context                                           | Sourced facts, each with a link. External facts also give the date they were checked. Reasons given by the documents that recommended an option go here, not in Reasons.                                                         |
| Notes                                             | Remarks about the wording above, such as a reason that was not independently checked. Each note says whether it is a sourced fact or proposed. Only present where needed.                                                        |
| Consequences                                      | **Decided** items with a citation. Proposals made in other documents are only linked, never copied. **Open** items name the document that owns them.                                                                             |
| Alternatives considered                           | Each alternative carries one label: **Recorded** (it appears as an option in the plan, its history or the owner's checklist), **Implied** (by the decision's wording or reasons, not recorded as discussed) or **Not recorded**. |
| Owning documents, Related open questions, History | Links and dates.                                                                                                                                                                                                                 |

**Decided (owner, O-95, [#25](https://github.com/guneet-xyz/shinan/issues/25)):**
a record does not start new proposals; it only cites proposals made in owning
documents. Where the decision log noticed a possible proposal for another
document, it is listed under
[suggestions for owning documents](#suggestions-for-owning-documents) instead.

## Index

D-001 to D-020 were accepted with the plan
([issue #1](https://github.com/guneet-xyz/shinan/issues/1),
[PR #2](https://github.com/guneet-xyz/shinan/pull/2)). D-021 to D-049 record
the owner's answers on [issue #25](https://github.com/guneet-xyz/shinan/issues/25):
O-numbers (batches 1 to 11) and N-numbers (batches 12 and 13, follow-up questions).
D-050 to D-053 record the owner's answers to the integration review on
[issue #26](https://github.com/guneet-xyz/shinan/issues/26) (NO-numbers).
D-054 records a later owner decision made in conversation and reverses O-66.
D-055 records a later owner decision on the web app's styling.
D-056 records the owner's answer M2-Q2 to the [M2 build plan](../build-plan-m2.md#7-owner-answers),
and D-057 its answer M2-Q14, an accepted risk for the M2 release
([recorded on issue #92](https://github.com/guneet-xyz/shinan/issues/92#issuecomment-6999453136)).
D-058 records a later owner decision made in conversation: the repository
is public; it amends D-011.
The numbers are in each record's `evidence` field and in the mappings for
[issue #25](#owner-answers-on-issue-25) and [issue #26](#owner-answers-on-issue-26).

| ID                                                        | Decision                                                                                                                                                                                      | Status   | Date       | Amends / amended by            | Owning documents                                                                                                  |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| [D-001](D-001-above-git-hosts.md)                         | Shinan sits above git hosts and does not replace their issues or PRs                                                                                                                          | Accepted | 2026-11-16 |                                | Product overview, Git host integrations, Tasks and work                                                           |
| [D-002](D-002-host-neutral-task-id.md)                    | The task is the core object and has a host-neutral task ID                                                                                                                                    | Accepted | 2026-11-16 |                                | Tasks and work                                                                                                    |
| [D-003](D-003-task-starts-with-intent.md)                 | A task starts where the intent starts; outside issues become tasks automatically                                                                                                              | Accepted | 2026-11-16 | Amended by D-051               | Tasks and work                                                                                                    |
| [D-004](D-004-link-prs-directly.md)                       | Agent-driven work links PRs directly; repository issues only when people need them                                                                                                            | Accepted | 2026-11-16 |                                | Tasks and work                                                                                                    |
| [D-005](D-005-derived-task-status.md)                     | Task status is calculated from linked work                                                                                                                                                    | Accepted | 2026-11-16 | Amended by D-021               | Tasks and work                                                                                                    |
| [D-006](D-006-document-first-catalog.md)                  | The catalog is document-first, with a generated agent index                                                                                                                                   | Accepted | 2026-11-16 | Amended by D-022               | Catalog                                                                                                           |
| [D-007](D-007-fact-provenance.md)                         | Every fact records its fact state, source and last-checked time                                                                                                                               | Accepted | 2026-11-16 |                                | Catalog                                                                                                           |
| [D-008](D-008-agents-connect-from-outside.md)             | Agents connect from outside; Shinan runs no model in the first phases                                                                                                                         | Accepted | 2026-11-16 |                                | Agent integrations                                                                                                |
| [D-009](D-009-github-and-forgejo-first.md)                | GitHub and Forgejo are the first git hosts                                                                                                                                                    | Accepted | 2026-11-16 |                                | Git host integrations                                                                                             |
| [D-010](D-010-integrate-do-not-embed.md)                  | Integrate with tools such as Multica, Linear and Plane through their APIs; do not embed them                                                                                                  | Accepted | 2026-11-16 | Amended by D-041               | Product overview                                                                                                  |
| [D-011](D-011-private-repository-and-brand.md)            | Private repository, internal brand "Shinan", first deployment at `shinan.guneet.dev`                                                                                                          | Accepted | 2026-11-16 | Amended by D-058               | Product overview, Architecture and operations                                                                     |
| [D-012](D-012-self-hostable.md)                           | Self-hostable by design                                                                                                                                                                       | Accepted | 2026-11-16 |                                | Architecture and operations                                                                                       |
| [D-013](D-013-business-model-deferred.md)                 | Business model, licensing and pricing are deferred                                                                                                                                            | Accepted | 2026-11-16 |                                | Product overview, Roadmap and migration                                                                           |
| [D-014](D-014-three-connection-levels.md)                 | Agents connect at three connection levels: MCP and skill, plugin, launcher                                                                                                                    | Accepted | 2026-11-16 |                                | Agent integrations                                                                                                |
| [D-015](D-015-public-web-app-with-sign-in.md)             | The web app is on the public internet and requires sign-in                                                                                                                                    | Accepted | 2026-11-16 |                                | Identity, agents and permissions; Architecture and operations                                                     |
| [D-016](D-016-musashi-and-deployment-approval.md)         | `shinan.guneet.dev` runs on Musashi; every deployment needs the owner's approval                                                                                                              | Accepted | 2026-11-16 |                                | Architecture and operations                                                                                       |
| [D-017](D-017-shared-git-host-accounts.md)                | Agents use their person's git host account; Shinan attributes actions from its own records                                                                                                    | Accepted | 2026-11-16 | Amended by D-032               | Identity, agents and permissions                                                                                  |
| [D-018](D-018-start-empty-migrate-later.md)               | Shinan starts empty; the `workspace` repository moves over only when Shinan is ready                                                                                                          | Accepted | 2026-11-16 | Amended by D-040               | Roadmap and migration                                                                                             |
| [D-019](D-019-workspaces-from-the-start.md)               | One user at first, but workspaces and invitations are designed in from the start                                                                                                              | Accepted | 2026-11-16 | Amended by D-036               | Identity, agents and permissions                                                                                  |
| [D-020](D-020-stack-chosen-from-options.md)               | The technology stack is chosen by the owner from options with trade-offs                                                                                                                      | Accepted | 2026-11-16 |                                | Architecture and operations                                                                                       |
| [D-021](D-021-status-from-work-and-events.md)             | Task status is calculated from linked work plus recorded events; agents record verification                                                                                                   | Accepted | 2026-11-16 | Amends D-005                   | Tasks and work                                                                                                    |
| [D-022](D-022-catalog-storage-and-git-mirror.md)          | Catalog revisions in PostgreSQL with an always-on read-only Git mirror; review in Shinan                                                                                                      | Accepted | 2026-11-16 | Amends D-006; amended by D-043 | Catalog; Architecture and operations                                                                              |
| [D-023](D-023-workspace-wide-visibility-no-secrets.md)    | Every member sees everything in a workspace; secrets never go in the catalog                                                                                                                  | Accepted | 2026-11-16 |                                | Catalog; Identity, agents and permissions                                                                         |
| [D-024](D-024-gated-catalog-approval.md)                  | Only gated catalog changes need approval, from the start of the trial                                                                                                                         | Accepted | 2026-11-16 |                                | Catalog                                                                                                           |
| [D-025](D-025-fact-state-planned.md)                      | The fact state `proposed` is renamed `planned`                                                                                                                                                | Accepted | 2026-11-16 |                                | Catalog                                                                                                           |
| [D-026](D-026-custom-entity-types.md)                     | Custom entity types are allowed in the first version                                                                                                                                          | Accepted | 2026-11-16 |                                | Catalog                                                                                                           |
| [D-027](D-027-workspace-task-id-prefix.md)                | Each workspace has its own task ID prefix                                                                                                                                                     | Accepted | 2026-11-16 |                                | Tasks and work                                                                                                    |
| [D-028](D-028-task-flags.md)                              | Task flags are managed per workspace; agents may set `needs a person`; `awaiting deployment approval` is its own flag                                                                         | Accepted | 2026-11-16 |                                | Tasks and work                                                                                                    |
| [D-029](D-029-subtasks.md)                                | Tasks can have subtasks; done when subtasks are done and delivering PRs are merged                                                                                                            | Accepted | 2026-11-16 | Amended by D-046               | Tasks and work                                                                                                    |
| [D-030](D-030-related-links-from-mentions.md)             | Members' mentions of a task ID in git host comments create a `related` link                                                                                                                   | Accepted | 2026-11-16 |                                | Tasks and work; Git host integrations                                                                             |
| [D-031](D-031-agent-and-session-granularity.md)           | An agent is per person, coding tool and machine; every subagent is its own agent session                                                                                                      | Accepted | 2026-11-16 |                                | Identity, agents and permissions; Agent integrations                                                              |
| [D-032](D-032-no-writes-as-a-person-on-github.md)         | Shinan never writes to GitHub as a person; person-requested git host actions are done by the person's own agents                                                                              | Accepted | 2026-11-16 | Amends D-017                   | Git host integrations; Identity, agents and permissions                                                           |
| [D-033](D-033-forgejo-connection.md)                      | On Forgejo, Shinan uses the connecting person's own account and accepts any token                                                                                                             | Accepted | 2026-11-16 | Amended by D-042               | Git host integrations                                                                                             |
| [D-034](D-034-sign-in-and-accounts.md)                    | Sign-in by GitHub, Forgejo, email magic link or password; an email allowlist decides who can have an account                                                                                  | Accepted | 2026-11-16 | Amended by D-044               | Identity, agents and permissions                                                                                  |
| [D-035](D-035-tokens-security-log-purge.md)               | Agent tokens last until revoked; the security log is kept forever; only workspace owners can purge                                                                                            | Accepted | 2026-11-16 | Amended by D-047, D-049        | Identity, agents and permissions; Architecture and operations                                                     |
| [D-036](D-036-design-now-build-before-second-member.md)   | D-019 means design now, build before the second member                                                                                                                                        | Accepted | 2026-11-16 | Amends D-019                   | Identity, agents and permissions                                                                                  |
| [D-037](D-037-typescript-node-react.md)                   | The stack is TypeScript, a plain Node.js server and a React single-page app                                                                                                                   | Accepted | 2026-11-16 |                                | Architecture and operations                                                                                       |
| [D-038](D-038-no-built-in-backups.md)                     | No built-in backups for now; relying on host-level backups is an accepted risk                                                                                                                | Accepted | 2026-11-16 |                                | Architecture and operations; Roadmap and migration                                                                |
| [D-039](D-039-deploy-as-needed.md)                        | Deploy to Musashi as needed, each deployment with its own approval                                                                                                                            | Accepted | 2026-11-16 |                                | Architecture and operations; Roadmap and migration                                                                |
| [D-040](D-040-trial-coordination-in-shinan.md)            | Cross-project coordination for trial projects moves into Shinan during the trial                                                                                                              | Accepted | 2026-11-16 | Amends D-018                   | Roadmap and migration                                                                                             |
| [D-041](D-041-no-outside-tracker-integrations.md)         | No integrations with outside trackers are planned; the Multica trial is skipped                                                                                                               | Accepted | 2026-11-16 | Amends D-010                   | Product overview                                                                                                  |
| [D-042](D-042-no-writes-on-forgejo.md)                    | Shinan makes no writes on Forgejo; on GitHub it writes only as its app                                                                                                                        | Accepted | 2026-11-16 | Amends D-033                   | Git host integrations                                                                                             |
| [D-043](D-043-no-git-mirror-for-now.md)                   | No Git mirror of the catalog for now; revisions live in PostgreSQL only                                                                                                                       | Accepted | 2026-11-16 | Amends D-022                   | Catalog; Architecture and operations                                                                              |
| [D-044](D-044-sign-in-magic-link-or-github.md)            | Sign-in by email magic link or GitHub only; Forgejo only for connecting; email through the AWS SES API                                                                                        | Accepted | 2026-11-16 | Amends D-034; amended by D-048 | Identity, agents and permissions; Architecture and operations                                                     |
| [D-045](D-045-no-viewer-role.md)                          | Workspace roles are workspace owner and contributor only; no viewer role                                                                                                                      | Accepted | 2026-11-16 |                                | Identity, agents and permissions; Roadmap and migration; Human experience; Domain model and glossary              |
| [D-046](D-046-subtasks-any-depth.md)                      | Subtasks can nest to any depth                                                                                                                                                                | Accepted | 2026-11-16 | Amends D-029                   | Tasks and work                                                                                                    |
| [D-047](D-047-installation-security-log-not-purgeable.md) | Installation-level security-log entries cannot be purged by anyone, for now                                                                                                                   | Accepted | 2026-11-16 | Amends D-035; amended by D-049 | Identity, agents and permissions                                                                                  |
| [D-048](D-048-refuse-private-forgejo-addresses.md)        | Shinan refuses Forgejo addresses on private, loopback or link-local networks by default                                                                                                       | Accepted | 2026-11-16 | Amends D-044                   | Identity, agents and permissions; Git host integrations; Architecture and operations                              |
| [D-049](D-049-security-log-never-purged.md)               | No security-log entry can ever be purged                                                                                                                                                      | Accepted | 2026-11-16 | Amends D-035, D-047            | Identity, agents and permissions; Architecture and operations; Human experience                                   |
| [D-050](D-050-agent-token-browser-approval.md)            | Agents get their token by a browser approval started from the plugin or CLI; one token works at every agent endpoint                                                                          | Accepted | 2026-11-16 |                                | Identity, agents and permissions; Architecture and operations; Agent integrations; Human experience               |
| [D-051](D-051-new-issues-setting.md)                      | Each repository has a "turn new issues into tasks" setting, on by default                                                                                                                     | Accepted | 2026-11-16 | Amends D-003                   | Tasks and work; Git host integrations                                                                             |
| [D-052](D-052-notification-ownership.md)                  | Architecture owns sending notifications; human experience owns what is sent and personal settings                                                                                             | Accepted | 2026-11-16 |                                | Architecture and operations; Human experience                                                                     |
| [D-053](D-053-deployment-approval-events.md)              | Deployment approval requests and answers are always recorded as task events                                                                                                                   | Accepted | 2026-11-16 |                                | Tasks and work; Agent integrations; Identity, agents and permissions; Human experience; Domain model and glossary |
| [D-054](D-054-public-image-registry-project.md)           | The `shinan` image project on `cr.guneet.dev` is public; Musashi pulls without a key                                                                                                          | Accepted | 2026-11-17 |                                | Architecture and operations; Build plan; Operator guide                                                           |
| [D-055](D-055-tailwind-and-shadcn.md)                     | The web app uses Tailwind CSS and shadcn/ui components                                                                                                                                        | Accepted | 2026-11-17 |                                | Architecture and operations; Build plan                                                                           |
| [D-056](D-056-public-skill-path.md)                       | The skill is served without sign-in on a public path, `/skills/`                                                                                                                              | Accepted | 2026-11-17 |                                | Agent integrations; Identity, agents and permissions; Architecture and operations; Build plan                     |
| [D-057](D-057-app-database-role-accepted-risk.md)         | The application's database role can turn off the append-only triggers; an accepted risk for v0.3.0 ([owner's answer](https://github.com/guneet-xyz/shinan/issues/92#issuecomment-6999453136)) | Accepted | 2026-11-19 |                                | Security checklist; Architecture and operations; M2 build plan                                                    |
| [D-058](D-058-public-repository.md)                       | The repository `guneet-xyz/shinan` is public                                                                                                                                                  | Accepted | 2026-11-19 | Amends D-011                   | AGENTS.md; Architecture and operations; Roadmap and migration                                                     |

The full list of owning documents, with planned paths, is in each record.

**Decided (owner, O-93, [#25](https://github.com/guneet-xyz/shinan/issues/25)):**
the index is updated in every pull request that adds a record or changes a
status, and may later be generated from the records' front matter. Parallel
pull requests will sometimes conflict on this table; the one merged second
resolves the conflict.

## Owner answers on issue #25

Mapping from the owner's answers to decision records. Answers without a record
accepted a document's own recommendation inside that document (or, for O-93
to O-96 and O-98, this README's rules); they are decided in the documents,
which cite the O-number or N-number.

| Owner answers                 | Record                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| O-4, O-10                     | [D-021](D-021-status-from-work-and-events.md)                                                 |
| O-11, O-12                    | [D-022](D-022-catalog-storage-and-git-mirror.md)                                              |
| O-2, O-43                     | [D-023](D-023-workspace-wide-visibility-no-secrets.md)                                        |
| O-3, O-46                     | [D-024](D-024-gated-catalog-approval.md)                                                      |
| O-5                           | [D-025](D-025-fact-state-planned.md)                                                          |
| O-17                          | [D-026](D-026-custom-entity-types.md)                                                         |
| O-6                           | [D-027](D-027-workspace-task-id-prefix.md)                                                    |
| O-7, O-8                      | [D-028](D-028-task-flags.md)                                                                  |
| O-21                          | [D-029](D-029-subtasks.md)                                                                    |
| O-25                          | [D-030](D-030-related-links-from-mentions.md)                                                 |
| O-37, O-40                    | [D-031](D-031-agent-and-session-granularity.md)                                               |
| O-1                           | [D-032](D-032-no-writes-as-a-person-on-github.md)                                             |
| O-53, O-54                    | [D-033](D-033-forgejo-connection.md)                                                          |
| O-41, O-48 (O-42 cited)       | [D-034](D-034-sign-in-and-accounts.md)                                                        |
| O-44, O-47, O-50              | [D-035](D-035-tokens-security-log-purge.md)                                                   |
| O-49                          | [D-036](D-036-design-now-build-before-second-member.md)                                       |
| O-60, O-61                    | [D-037](D-037-typescript-node-react.md)                                                       |
| O-62, O-63, O-64 (O-65 cited) | [D-038](D-038-no-built-in-backups.md)                                                         |
| O-83                          | [D-039](D-039-deploy-as-needed.md)                                                            |
| O-73 (O-74 cited)             | [D-040](D-040-trial-coordination-in-shinan.md)                                                |
| O-97, O-88                    | [D-041](D-041-no-outside-tracker-integrations.md)                                             |
| O-93, O-94, O-95, O-96, O-98  | This README (no record)                                                                       |
| O-66                          | No record; reversed for the image registry by [D-054](D-054-public-image-registry-project.md) |
| All other O-numbers           | No record; decided in the owning document                                                     |
| N-4                           | [D-042](D-042-no-writes-on-forgejo.md)                                                        |
| N-5, N-9                      | [D-043](D-043-no-git-mirror-for-now.md)                                                       |
| N-7, N-6                      | [D-044](D-044-sign-in-magic-link-or-github.md)                                                |
| N-11                          | [D-045](D-045-no-viewer-role.md)                                                              |
| N-1                           | [D-046](D-046-subtasks-any-depth.md)                                                          |
| N-8                           | [D-047](D-047-installation-security-log-not-purgeable.md)                                     |
| N-12                          | [D-048](D-048-refuse-private-forgejo-addresses.md)                                            |
| N-13                          | [D-049](D-049-security-log-never-purged.md)                                                   |
| N-2, N-3, N-10                | No record; decided in the owning document                                                     |

## Owner answers on issue #26

Mapping from the owner's answers to the integration review's "Needs the
owner" items ([issue #26](https://github.com/guneet-xyz/shinan/issues/26#issuecomment-6918513933))
to decision records.

| Owner answer | Record                                         |
| ------------ | ---------------------------------------------- |
| NO-1         | [D-050](D-050-agent-token-browser-approval.md) |
| NO-2         | [D-051](D-051-new-issues-setting.md)           |
| NO-3         | [D-052](D-052-notification-ownership.md)       |
| NO-4         | [D-053](D-053-deployment-approval-events.md)   |

## Record format

**Decided (owner, O-93, [#25](https://github.com/guneet-xyz/shinan/issues/25)).**
Each record is one Markdown file with a short block of structured fields at
the top (YAML front matter), followed by fixed sections. Reason given when it
was proposed: the `workspace` repository's
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

Why this choice was made, in the words the owner accepted, or "Owner's
choice; no reason recorded".

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

Field meanings (**decided**, O-93):

| Field                         | Meaning                                                                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                          | `D-` and a three-digit number. Never changes.                                                                                                                     |
| `title`                       | One line, short enough for the index.                                                                                                                             |
| `status`                      | One of the statuses below.                                                                                                                                        |
| `date`                        | The date the current status was set. For accepted records, the date the owner accepted it.                                                                        |
| `decided_by`                  | `owner` once accepted or rejected. Empty while proposed.                                                                                                          |
| `evidence`                    | A link to where the owner decided, usually the approved pull request, followed by the owner-answer numbers in brackets where there are any. Empty while proposed. |
| `supersedes`, `superseded_by` | IDs of records this one fully replaces, or that fully replace it.                                                                                                 |
| `amends`, `amended_by`        | IDs of records this one changes in part, or that change it in part.                                                                                               |

## Statuses

| Status       | Meaning                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| `proposed`   | Put forward by an owning document, which must confirm or change it. Not yet agreed with the owner.        |
| `accepted`   | Agreed with the owner. Documents follow it.                                                               |
| `rejected`   | The owner decided against it. Kept so the same idea is not proposed again without new reasons.            |
| `withdrawn`  | A `proposed` record already merged into `main` that its owning document dropped before the owner decided. |
| `superseded` | Fully replaced by a later accepted record, named in `superseded_by`.                                      |

- **Decided:** `proposed` and `accepted` keep the plan's meanings: "Accepted"
  means agreed with the owner; "Proposed" means the owning document must
  confirm or change it ([plan, section 6](../plan.md#6-decisions-so-far)).
- **Decided (owner, O-93):** `rejected`, `withdrawn` and `superseded`. Reason given when proposed: a decision log
  is only useful if it also shows what was ruled out and what replaced what.
  A proposal dropped before it ever reached `main` needs no record: its closed
  pull request is enough.
- **Decided (owner, O-93):** an accepted record that has been amended stays
  `accepted`, and its `amended_by` field points to the change. The index shows
  the amendment.
- **Decided (owner, O-93):** a record becomes `accepted` or `rejected` only through the
  owner's decision, shown by the `evidence` link. Reason: the plan defines
  "accepted" as agreed with the owner.

## Numbering

- **Decided:** decision IDs have the form `D-NNN` and D-001 to D-020 are taken
  ([plan, section 6](../plan.md#6-decisions-so-far)).
- **Decided (owner, O-93):** numbers are given in order and never reused, including for
  rejected and withdrawn records. Reason: other documents, pull requests and
  task notes cite these IDs; reusing one would make old citations point at the
  wrong decision.
- **Decided (owner, O-93):** a new record takes the next number not used on `main` or in any
  open pull request (check with `gh pr list` and by searching for `D-0` in open
  pull requests). If two pull requests still collide, the one merged second
  renumbers its record and its citations before merging. Reason: several
  document authors work in parallel, and this needs no central allocator.
- **Decided (owner, O-93):** three digits, growing to four only after D-999. Reason: keeps
  file names sorting correctly for the foreseeable future.

## How documents propose new decisions

**Decided (owner, O-94, [#25](https://github.com/guneet-xyz/shinan/issues/25)).**
Each record goes into its document's own pull request as `accepted`; the
owner's approval of that pull request is the acceptance, and the final
integrated review can supersede it. Reason given when proposed: ten documents
are written in parallel, so the log needs one path with no second round trip.

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
   comment, a pull request adds the record with `evidence` linking to that
   comment. When one session decides many items across documents, the
   decision log's pull request creates all of that batch's records, so that
   numbers do not collide (as for [issue #25](#history)).
6. **A `proposed` record** may be merged before the owner decides, only when
   several documents need to cite the same proposal. It names its owning
   document.
7. **Documents cite records by ID and link**, for example
   `[D-017](decisions/D-017-shared-git-host-accounts.md)`, and do not restate
   them ([AGENTS.md](../../AGENTS.md): "Record decisions in `docs/decisions/`
   and link to them instead of repeating them").

## Changing a decision

- **Decided (owner, O-95):** in an accepted record, the front matter's `id`, the **Decision**
  and the **Reasons** sections are fixed. Reason: they must keep showing what
  was agreed and why; silently editing them would hide that a decision changed.
  The `workspace` repository's
  [decision records](https://git.guneet.dev/guneet/workspace/src/branch/main/decisions/README.md)
  follow the same rule ("Preserve superseded decisions with links to their
  replacements").
- **Decided (owner, O-95):** the other sections (Context, Notes, Consequences, Alternatives
  considered, Owning documents, Related open questions) are maintained. They
  may be updated as owning documents settle, as long as each update adds a
  History line. Reason: they describe the decision's surroundings, which keep
  changing, and a frozen copy would drift from the owning documents.
- **Decided (owner, O-93):** the `status`, `date`, `decided_by`, `evidence`,
  `superseded_by` and `amended_by` fields change only through the steps below.
- **Decided (owner, O-93):** to change a decision completely, write a new record that lists
  the old one in `supersedes`. When the owner accepts the new record, the old
  record's status becomes `superseded` and its `superseded_by` field points to
  the new one, in the same pull request.
- **Decided (owner, O-93):** to change part of a decision, write a new record that lists the
  old one in `amends` and says exactly which part changes. The old record stays
  `accepted` and gets `amended_by`. Reason: a full replacement would force
  copying the unchanged parts, which then drift.

## Relationship to the plan

- **Decided:** the plan's section 6 table is the owner-approved summary, and
  "each decision becomes a decision record with its reasoning"
  ([plan, section 6](../plan.md#6-decisions-so-far)).
- **Decided (owner, O-95):** the Decision and Reasons sections of D-001 to
  D-020 quote the plan's wording exactly.
- **Decided (owner, O-96, [#25](https://github.com/guneet-xyz/shinan/issues/25)):**
  the plan's section 6 table stays as the approved snapshot, and a line under
  its heading points to this index ([plan, section 6](../plan.md#6-decisions-so-far)).
- **Decided (owner, O-98, [#25](https://github.com/guneet-xyz/shinan/issues/25)):**
  plan text that has no decision ID gets a record only when a document
  proposes changing it. [D-025](D-025-fact-state-planned.md) and
  [D-028](D-028-task-flags.md) are such records.

## Suggestions for owning documents

While writing the records, the decision log noticed these possible proposals.
They are **not** part of any record. Each is a suggestion for the owning
document to adopt, change or ignore.

| Suggestion                                                                                                      | For                                               | Related record                             |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------ |
| Core flows work on both GitHub and Forgejo; features specific to one host may add to them but are not required. | [Git host integrations](../git-hosts.md)          | [D-009](D-009-github-and-forgejo-first.md) |
| Avoid depending on services that are only available as someone else's hosted product.                           | [Architecture and operations](../architecture.md) | [D-012](D-012-self-hostable.md)            |
| Avoid designs that rely on a particular pricing, licence or business model.                                     | [Product overview](../product-overview.md)        | [D-013](D-013-business-model-deferred.md)  |

## Dependencies on other documents

- [Domain model and glossary](../domain-model.md): the records use its terms
  and link to its sections. Because records only link to it, its changes need
  edits here only when a heading moves.
- Each owning document named in a record specifies the details of that
  decision:
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

None. The integration review's owner items were answered on issue #26
(NO-1 to NO-4, [D-050](D-050-agent-token-browser-approval.md) to
[D-053](D-053-deployment-approval-events.md)). The earlier open questions were answered by the owner on issue #25:
acceptance (O-94), ownership of outside tracker integrations (O-97,
[D-041](D-041-no-outside-tracker-integrations.md)), plan text without IDs
(O-98), the domain model's owner decisions
([D-021](D-021-status-from-work-and-events.md),
[D-025](D-025-fact-state-planned.md), [D-027](D-027-workspace-task-id-prefix.md),
[D-028](D-028-task-flags.md)), and the GitHub and Forgejo write difference
(N-4, [D-042](D-042-no-writes-on-forgejo.md)).

## Decisions needed from the owner

None.

## History

- 2026-11-16: first draft and per-document review
  ([PR #19](https://github.com/guneet-xyz/shinan/pull/19)).
- 2026-11-16: the owner accepted this README's rules (O-93 to O-96, O-98) and
  decided O-97 on [issue #25](https://github.com/guneet-xyz/shinan/issues/25).
- 2026-11-16: records D-021 to D-041 added for the owner's answers on
  issue #25. O-94 normally puts each record in its own document's pull
  request. This batch was decided in one session on issue #25 across many
  documents, so all of its records were created in this pull request to avoid
  numbering collisions between parallel pull requests. Amended records
  (D-005, D-006, D-010, D-017, D-018, D-019) got `amended_by` and a History
  line; their Decision and Reasons are unchanged.
- 2026-11-16: records D-042 to D-047 added for the owner's follow-up answers
  (batch 12, N-numbers) on issue #25, in this pull request for the same
  reason. Amended records (D-022, D-029, D-033, D-034, D-035) got `amended_by`
  and a History line. N-4 answered this log's only open owner decision.
- 2026-11-16: records D-048 and D-049 added for the owner's batch 13 answers
  (N-12, N-13) on issue #25, in this pull request for the same reason.
  Amended records (D-035, D-044, D-047) got `amended_by` and a History line.
- 2026-11-16: integration review fixes ([issue #26](https://github.com/guneet-xyz/shinan/issues/26):
  I-60, I-61, I-62, I-65). Records D-050 to D-053 added for the owner's
  answers NO-1 to NO-4 on issue #26, in the decision log's integration-fix
  pull request for the same numbering reason as the issue #25 batch. D-003
  got `amended_by` (D-051) and a History line.
- 2026-11-16: integration round 2 ([issue #26](https://github.com/guneet-xyz/shinan/issues/26#issuecomment-6918785395):
  I-77, I-78). Index rows for D-050 and D-053 match their records; the plan
  pointer (O-96) and the plan section 8 note (D-052) are recorded as done; two
  suggestions adopted by Roadmap and Architecture were removed.
- 2026-11-17: D-054 added for the owner's decision to make the `shinan`
  image project on `cr.guneet.dev` public, reversing O-66
  ([issue #73](https://github.com/guneet-xyz/shinan/issues/73)). O-66 had no
  record, so D-054 amends none.
- 2026-11-17: D-055 added for the owner's decision to style the web app with
  Tailwind CSS and shadcn/ui components
  ([issue #75](https://github.com/guneet-xyz/shinan/issues/75)). It amends
  no record.
- 2026-11-17: D-056 added for the owner's answer M2-Q2 to the M2 build plan:
  the skill is served without sign-in at `/skills/`
  ([issue #79](https://github.com/guneet-xyz/shinan/issues/79)). It amends
  no record.
- 2026-11-19: D-057 added for the owner's answer M2-Q14 to the M2 build
  plan: the application's database role, which can turn off the append-only
  triggers, is an accepted risk for v0.3.0, fixed first in M3
  ([issue #92](https://github.com/guneet-xyz/shinan/issues/92#issuecomment-6999453136),
  [#156](https://github.com/guneet-xyz/shinan/issues/156)). It amends no
  record.
