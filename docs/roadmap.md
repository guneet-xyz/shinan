# Roadmap and migration

Status: **draft for review** ([issue #12](https://github.com/guneet-xyz/shinan/issues/12)).

This document owns Shinan's phases, the scope of the first version, the proof
of concept (which projects, how the trial runs and what counts as "ready"), and
how the `workspace` repository's catalog and cross-project coordination issues
move into Shinan. It answers plan question 8.

It uses the terms of the [domain model and glossary](domain-model.md) exactly.
Each statement is marked:

- **Decided**: follows from an accepted plan decision, which is cited.
- **Proposed**: suggested here, with a reason. The owner confirms or changes it.
- **Open**: not settled; listed under [open questions](#open-questions).

Decisions proposed here carry local labels (RM-1, RM-2, ...). The
[decision log](decisions/) gives them permanent IDs once accepted.

## Summary

- Shinan is built in phases with a gate between each one. The owner closes each
  gate with a recorded decision (proposed, RM-1).
- The first version is the plan's phase 1 feature set plus the minimum needed to
  run safely on the public internet: sign-in, backups, export and monitoring
  (proposed, RM-2).
- The proof of concept uses three projects: **Shinan** itself, **mon** and
  **easyshell**. Together they cover GitHub and Forgejo, several repositories
  per task, several machines, deployment approvals, an outside contributor and
  work that needs a person (proposed, RM-5).
- During the trial the `workspace` repository stays the source of truth for
  everything it owns today (decided, D-018). Shinan reads the `workspace`
  repository's coordination issues instead of asking agents to copy them
  (proposed, RM-7).
- Readiness is judged by the owner from a readiness report against measurable
  criteria (R1 to R16). The thresholds are starting proposals (proposed, RM-9).
- After the owner judges Shinan ready, the `workspace` repository moves in one
  rehearsed cutover with a 30-day rollback window. History stays where it is
  (proposed, RM-11 to RM-14).

## 1. Starting point

Facts in this section are observations, not decisions. They were checked on
**2026-11-16** at `workspace` repository
revision `86bba32`, using local Git, the Forgejo CLI (`fj`) and the GitHub CLI
(`gh`), all read-only.

### The `workspace` repository today

| Part | Contents | Count |
|---|---|---|
| Catalog | `project` entries | 18 |
| | `machine` entries | 4 |
| | `service` entries | 10 |
| Runbooks | Cross-project procedures | 3 |
| Decisions | Cross-project decision records | 3 |
| Policies and guides (`docs/`) | Agent entry point, collaboration, maintenance, access and safety, Forgejo setup, skills | 6 |
| Templates | One per entry type, plus an index | 6 |
| Skills | `workspace-navigate`, `workspace-maintain`, `workspace-task`, `workspace-audit` | 4 |
| OpenCode integration | Global bootstrap instructions and configuration | 1 folder |
| Checks | `scripts/check.py` and tests | |
| History | `CHANGELOG.md`; 202 commits since the first one on 2026-11-06 | |
| Coordination | Forgejo issues: 53 in total, **5 open** (#43, #50, #71, #100, #103) | 53 |
| | Forgejo pull requests | 81 |
| | One Forgejo Project board (Backlog, Ready, In progress, Review, Done) | 1 |

Catalog entries use frontmatter with `id`, `status`, `owner`, `last_verified`,
`verification_scope` and `verification_source`. The `human-effort` label marks
issues that need a person, with a TL;DR comment.

The Forgejo instance (`git.guneet.dev`, API version `16.0.5+gitea-1.22.0`) has
no Project board endpoints in its API schema (checked 2026-11-16 at
`https://git.guneet.dev/swagger.v1.json`). A Project API exists only as an
upstream [proposal](https://codeberg.org/forgejo/discussions/issues/466)
(checked 2026-11-16). Board state therefore cannot be read automatically; this
matters for [migration](#64-coordination-issues-and-the-project-board).

Forgejo and Shinan's planned deployment both run on Musashi (Forgejo per the
`workspace` repository's `forgejo` service entry; Shinan per D-016). This
matters for [recovery](#67-rollback-and-break-glass-access).

### Activity in candidate projects

| Repository | Host, visibility | Open issues | PRs created since 2026-11-01 | Issue authors other than the owner |
|---|---|---|---|---|
| `guneet-xyz/shinan` | GitHub, private | 11 (document issues #3 to #13) | 2 (ten more expected as the documents are written) | none |
| `guneet-xyz/mon` | GitHub, public | 18 | 20 | none |
| `guneet-xyz/easyshell` | GitHub, public | 28 | 22 | yes (one account) |
| `cranklabs/walls` | GitHub, public | 10 | 14 | none |
| `guneet-xyz/dockyard` | GitHub, public | 0 | 8 | none |

Deployments of mon, easyshell, Walls and Dockyard are recorded in Forgejo
repositories (`infra/musashi`, `infra/anzen`, `guneet/terraform`), so their
work already spans both git hosts.

## 2. Phases

The plan's phases (plan, section 10) are the starting point and are
**decided**. This document splits phases 1 and 2 into steps and adds gates
(**proposed**).

| Phase | Steps | Outcome | Gate to leave the phase |
|---|---|---|---|
| 0. Documents | Write, review and accept the in-depth documents | Accepted plan set | Owner accepts the integrated document set (plan, section 9) |
| 1. First version and proof of concept | **1a. Build** the [first version](#3-first-version-scope) in [milestones](#33-build-milestones). **1b. Trial** it on the [proof-of-concept projects](#4-proof-of-concept) | First version running at `shinan.guneet.dev`, used daily on three projects | Owner decides the trial worked well enough to continue (G1) |
| 2. Collaboration and migration | **2a. Collaboration:** board, nudges, triage inbox, notifications, Claude Code plugin; the trial continues. **2b. Migration:** when [ready](#5-readiness-criteria), move the `workspace` repository | Shinan is the source of truth; the `workspace` repository is archived | Owner judges Shinan ready (G2), then confirms the cutover after the rollback window (G3) |
| 3. Agents run by Shinan | Launcher on each machine; start agent sessions from the website | Optional | Owner decides whether to start phase 3 at all, after G3 |

**RM-1 (proposed): every gate is an owner decision, recorded in
[`docs/decisions/`](decisions/).** Reason: D-018 says Shinan moves over "when
judged ready", which is a judgment, not a formula. Recording it keeps the
reasons visible later.

**Phase 3 is optional (decided, plan section 10)** and depends on how phases 1
and 2 go.

Not on the roadmap until evidence asks for them:

| Item | Status | Reason |
|---|---|---|
| GitLab | Proposed: after G3, only if a real project needs it | D-009 starts with the hosts in use; no current project is on GitLab. |
| Integrations with Multica, Linear, Plane | Proposed: after G3, only on demand | D-010 allows API integrations; none is needed for the owner's own use. |
| Business model, licensing, pricing | Decided: deferred (D-013) | No evidence of outside demand yet. |
| Running models in Shinan | Decided: not in phases 1 and 2 (D-008) | Agents connect from outside. |

## 3. First version scope

### 3.1 In scope

| Capability | Status | Reason |
|---|---|---|
| Catalog, wiki and agent index | Decided (plan, phase 1; D-006, D-007) | Core pillar. |
| Tasks with task IDs, work links and calculated task status, task flags and manual states | Decided (plan, phase 1; D-002, D-005) | Core pillar. |
| GitHub and Forgejo git host connections: webhooks, API reads, reconciliation | Decided (plan, phase 1; D-009) | The trial projects live on both. |
| Outside issues become tasks in `triage` | Decided (D-003) | Needed from the first day, because outside issues arrive anyway. A simple list of `triage` tasks is enough; the full triage inbox is phase 2 (plan). |
| Timeline | Decided (plan, phase 1) | Core pillar. |
| MCP server, skill and CLI | Decided (plan, phase 1; D-014 level 1) | How agents act. |
| OpenCode plugin for presence | Decided (plan, phase 1; D-014 level 2) | How Shinan knows which agent sessions run. |
| Sign-in, one workspace, members and roles; invitations in the data model | Decided that workspaces and invitations are designed in (D-019) and that sign-in is required (D-015). **Proposed:** the first version ships invitations and is tested with a second, viewer-only test account | D-019 says multi-user support is costly to add later; a second account is the only way to test access rules before a second person joins. |
| Deployment at `shinan.guneet.dev` on Musashi | Decided (D-011, D-016) | First deployment target. |
| Backups with a rehearsed restore | **Proposed** (RM-2) | The trial creates data that is not stored anywhere else (agent sessions, events, Shinan-native tasks). |
| Full export of a workspace to Markdown and a machine-readable form | **Proposed** (RM-2) | The migration's rollback and the break-glass copy both depend on it ([section 6.7](#67-rollback-and-break-glass-access)). It also keeps D-006's promise that Markdown is the source of truth. |
| Monitoring of `shinan.guneet.dev` by mon | **Proposed** (RM-2) | mon already monitors the owner's websites; readiness criterion R10 needs an outside measurement. |

**RM-2 (proposed): backups, export and outside monitoring are part of the first
version, not later polish.** Reason: they are what make a trial on real work
safe, and several readiness criteria cannot be measured without them.

### 3.2 Out of the first version

| Capability | Phase | Status | Reason |
|---|---|---|---|
| Board | 2a | Decided (plan, phase 2) | |
| Nudges, including live delivery | 2a | Decided (plan, phase 2) | The plugin in phase 1 reports presence only. |
| Triage inbox (full) | 2a | Decided (plan, phase 2) | |
| Notifications by email or chat | 2a | Decided (plan, phase 2) | |
| Claude Code plugin | 2a | **Proposed** | The plan says OpenCode first, then Claude Code (D-014). The owner's current setup is OpenCode (the `workspace` repository's only integration is for OpenCode). Claude Code sessions can still use the MCP server and skill in phase 1, marked `self-reported`. |
| Launcher | 3 | Decided (D-014, plan phase 3) | |
| Self-hosting guide for other people | After G3 | **Proposed** | D-012 requires self-hosting by design; the first version proves it by being installable from its own documentation during the restore rehearsal (R10). A polished guide for others is only useful once Shinan has proved itself. |

### 3.3 Build milestones

**Proposed (RM-3):** phase 1a is built in four milestones, each deployed
before the next starts. The trial starts at milestone 2 for the catalog and
widens at milestones 3 and 4. Reason: catalog feedback can start early, and
the risk is low because the `workspace` repository stays the source of truth.

| Milestone | Contents | Trial use it unlocks |
|---|---|---|
| M1. Empty installation | Sign-in, one workspace, members and roles, deployment on Musashi, backups, monitoring | None; security and restore checks |
| M2. Catalog | Catalog entities, facts with provenance, catalog proposals and approval, wiki, agent index, MCP read and propose, skill, CLI, export | Catalog part of the trial |
| M3. Tasks and git hosts | Tasks, work links, derived status, GitHub and Forgejo git host connections, reconciliation, outside issues to `triage`, timeline | Task part of the trial |
| M4. Presence | OpenCode plugin: agent sessions, presence, attaching an agent session to a task | Presence part of the trial; trial fully running |

The order inside a milestone, the technology and the storage design belong to
[architecture and operations](architecture.md) (D-020).

### 3.4 Owner actions needed in phase 1

These need the owner because they involve deployment approval (decided,
D-016) or accounts and credentials (the `workspace` repository's current access
policy, which stays in force until migration under D-018). They are listed so the plan can account for them; exact steps belong to
[architecture](architecture.md), [identity](identity.md) and
[git host integrations](git-hosts.md).

- Approve each deployment to Musashi (D-016), including the DNS record for
  `shinan.guneet.dev`.
- Create the credentials Shinan uses to read GitHub and Forgejo, and enter them
  into the approved secret store. People type secrets; agents never handle
  them.
- Install the OpenCode plugin on the machines used for the trial.

**Proposed (RM-4): deploy on a regular release train (for example weekly) plus
urgent fixes, and ask for one deployment approval per release.** Reason: D-016 requires
approval for every deployment; batching keeps the approval load small during a
busy trial. Open: the cadence; [architecture](architecture.md) owns the
release process.

## 4. Proof of concept

### 4.1 How projects were chosen

**Proposed:** a good trial project

1. has steady agent-driven work, so the trial produces enough tasks;
2. spans GitHub and Forgejo, or several repositories, so cross-host tasks are
   tested (D-001, D-009);
3. touches several catalog entity types (project, machine, service);
4. includes the hard cases: deployment approval, work that needs a person,
   outside issues;
5. is low-risk if Shinan misbehaves. Shinan only reads git hosts in phase 1
   apart from posting links, so the main risk is confusion, not damage.

Reason: the trial must show whether Shinan works for the owner's real work, and
the hard cases are where hand-made practice in the `workspace` repository needs
the most effort today.

### 4.2 Candidates

| Project | What it tests | Concerns | Recommendation |
|---|---|---|---|
| **Shinan** (`guneet-xyz/shinan`, GitHub, private) | Daily use by the owner and agents; a private repository; Shinan used on its own development (catalog entry, document tasks, PRs) | GitHub only; if Shinan breaks, its own task records are affected (its GitHub issues and PRs remain, so nothing is lost) | **Include.** Highest activity during phase 1, and the people building it feel its gaps first. |
| **mon** (`guneet-xyz/mon` on GitHub; `infra/musashi`, `infra/anzen`, `guneet/terraform` on Forgejo) | Tasks whose work spans both hosts and four repositories; two machines; several services (ingress, Obscuro, container registry, DNS); deployment approvals; an existing coordination issue (`workspace` repository #68, closed) shows the pattern | Rollouts touch Musashi, which is sensitive; Shinan only reads these repositories, so this is acceptable | **Include.** Best test of D-001 and one timeline across hosts. Also the natural monitor for Shinan (R10). |
| **easyshell** (`guneet-xyz/easyshell` on GitHub; `infra/musashi` on Forgejo) | High volume (28 open issues); an issue author other than the owner, so outside issues and `triage` (D-003); open issues #50 (`human-effort`) and #43 in the `workspace` repository; release and image publishing across Dockyard | Volume may be noisy at first | **Include.** The only candidate with real outside issues and a live "needs a person" case. |
| Walls (`cranklabs/walls`, GitHub; `infra/musashi`) | A second GitHub organisation; frequent releases | Overlaps with mon and easyshell; no outside issues | Reserve. Add if the trial needs more volume or a second GitHub organisation. |
| guneet.dev and Resume (`guneet-xyz/guneet.dev`, private; `guneet-xyz/resume`, public) | A task across two repositories on one host (open `workspace` repository #103); a merge that publishes (Resume) | Low volume | Reserve. A small, safe fallback if a main candidate must leave the trial. |
| Dockyard, Drawspace, Obscuro | Similar to the above | Lower recent activity or overlap | Not in the trial. |
| Musashi, Anzen, Terraform, Ansible (infrastructure) | | Sensitive and depended on by everything | **Not trial projects.** Their repositories are connected read-only so work links resolve; their `machine` and `service` entities are added only as far as trial projects need them. |
| Daedalus, Scripts | | Low activity (Scripts last pushed 2026-10-14) | Not in the trial; Daedalus appears as a `machine` entity because agent sessions run there. |
| Takezo, Jobfinder | | Retired; unknown owner and stopped | Not in the trial. |
| The `workspace` repository | | D-018 keeps it out until migration | **Excluded** (decided, D-018). Its issues about trial projects are read, see [4.4](#44-tasks-during-the-trial). |

**RM-5 (proposed): the trial projects are Shinan, mon and easyshell, with
Walls and guneet.dev plus Resume in reserve.** Reason: together they cover
both git hosts, multi-repository tasks, deployment approvals, an outside
contributor and work that needs a person, while keeping the most sensitive
infrastructure as read-only context. Three projects is "a few" (D-018).

### 4.3 The catalog during the trial

**Decided (D-018):** Shinan starts empty, and the `workspace` repository
stays the source of truth until Shinan is judged ready.

**Proposed (RM-6):**

- The trial uses one Shinan workspace, called the **trial workspace** here.
  It holds only the catalog entities the trial projects need:
  the three `project` entities; `machine` entities for Musashi, Anzen and
  Daedalus; and the `service` entities those projects depend on (ingress,
  container registry, Cloudflare DNS, Obscuro, email, Forgejo, monitoring).
  Reason: a small catalog keeps the extra maintenance small and keeps the most
  sensitive details out until security is proven (R11).
- Entities are created when the trial starts, by agents, from evidence. A fact
  copied from a `workspace` repository entry records that entry (at its Git
  revision) as its source and keeps the original check date, or `unknown`
  where the entry's verification scope does not cover it. Last-checked times
  are never refreshed by the copy. Reason: D-007 requires honest provenance;
  copying is not checking.
- When the `workspace` repository's catalog changes for a trial entity, the
  agent doing the work also makes a catalog proposal in Shinan. A weekly
  comparison reports differences. Where they disagree, the `workspace`
  repository wins and the difference becomes a trial finding. Reason: this
  measures what matters most (do agents keep Shinan's catalog accurate in real
  work?) without creating a second source of truth.

**Open:** whether the owner reads "starts empty" as allowing this per-project
seeding; see [decisions needed](#decisions-needed-from-the-owner). The
alternative is to let agents build trial entities only from owning sources,
which tests checking but costs more effort.

### 4.4 Tasks during the trial

**Proposed (RM-7):**

| Work | Where it is tracked during the trial | How Shinan sees it | Reason |
|---|---|---|---|
| Cross-project coordination for a trial project | An issue in the `workspace` repository on Forgejo, as today (source of truth) | Read as an outside issue and turned into a task (D-003). Agents use its task ID in branches and PRs | No copying by hand; tests the Forgejo connection and D-003 on real coordination issues. |
| Work inside a trial project's repositories | A Shinan task. Agent-driven work links PRs directly, with no repository issue unless a person needs one (D-004) | Native task | Tests D-002 and D-004. The `workspace` repository does not own project-level tasks today; owning repositories do, so this does not conflict with D-018. |
| Issues opened on a trial project's repository by anyone | The repository's issue tracker | Outside issue, task in `triage` (D-003) | Decided behaviour. |
| Trial findings (bugs, gaps, friction) | Issues in `guneet-xyz/shinan`, labelled for the trial | Outside issues on the Shinan project | Findings must be recordable even when Shinan is down. |
| Everything else | Unchanged | Not seen | Out of trial scope. |

**Proposed:** the Forgejo git host connection reads only issues in the
`workspace` repository that carry a trial label (for example `shinan-trial`).
Reason: the `workspace` repository's tracker covers all projects; turning every
issue into a `triage` task would bury the trial in unrelated work. Depends on
[git host integrations](git-hosts.md) supporting a label filter; if it does
not, connect the whole tracker and cancel unrelated `triage` tasks in bulk.

**Proposed:** if Shinan is down, agents carry on with the git-host-only
workflow: task ID in the branch name and PR description, no other change.
Reconciliation links the work afterwards. Reason: the trial must never block
real work.

**Depends on an owner decision in the [glossary](domain-model.md#decisions-needed-from-the-owner):**
whether agents may set the `needs a person` task flag (glossary decision 2) and
whether a separate `awaiting deployment approval` flag exists (glossary
decision 5). The trial works with either outcome: it uses `needs a person` for
issue #50 in the `workspace` repository, set by an agent or by the owner, and
uses the deployment approval flag for mon and easyshell rollouts only if it is
adopted. The `human-effort` label on issue #50 stays authoritative during the
trial.

### 4.5 Agents in the trial

**Proposed (RM-8):** a short note in the `workspace` repository tells agents
which projects are in the trial and how to connect to Shinan (MCP server, skill,
OpenCode plugin). It lives in the trial projects' `workspace` repository
entries and the `shinan` project entry, and is added through that repository's
normal PR workflow at the start of the trial. Reason: agents find their context
through the `workspace` repository today, which stays the source of truth.
This document does not edit that repository; the change is a follow-up for
phase 1b.

The conventions agents follow (task ID markers, check-ins, attaching an agent
session) belong to [agent integrations](agent-integrations.md) and
[tasks and work](tasks.md).

### 4.6 Running the trial

**Proposed:**

- **Length:** at least four weeks with M4 deployed (see R1). Reason: four
  weeks covers several release and deployment cycles in each trial project and
  is long enough for freshness drift to show.
- **Weekly readiness report:** counts and samples for R1 to R16, produced by a
  script or by Shinan itself. Reason: readiness is judged on evidence
  gathered during the trial, not remembered at the end.
- **Weekly owner check:** the owner answers the questions in R12 using Shinan
  and records where they had to fall back to the `workspace` repository or a
  git host.

**Proposed (RM-10): pause the trial and fall back to the git-host-only
workflow if any of these happen:**

- a credential or other secret is exposed through Shinan;
- data is lost and cannot be restored from backup;
- Shinan blocks agents' real work for more than one working day;
- an access rule fails, for example the viewer test account sees something it
  should not.

Reason: the `workspace` repository is still the source of truth, so pausing
costs only trial data. Resuming is an owner decision after the cause is fixed.

## 5. Readiness criteria

**Proposed (RM-9):** the owner judges readiness (G2) from a readiness report
covering the criteria below. The thresholds are starting proposals and can be
changed before the trial starts. The owner may accept Shinan as ready with
documented exceptions. Reason: thresholds set before any real use are
guesses; evidence plus judgment is safer than a rigid formula, and D-018 asks
for a judgment.

"Trial repositories" means the repositories of the trial projects, including
the infrastructure repositories they link to.

| ID | Criterion | Measure and proposed threshold | Reason |
|---|---|---|---|
| R1 | Trial size | At least 4 weeks with M4 deployed; at least 40 tasks reach `done` or `cancelled`; at least 10 of them have `delivers` work links on both GitHub and Forgejo | Enough volume to trust the other numbers. The `workspace` repository alone had 53 issues and 81 PRs in its first ten days, so this is reachable. |
| R2 | Event capture | Every issue, PR, merge and review in trial repositories during the trial appears in Shinan within 24 hours (100%); at least 95% within 5 minutes. Checked by comparing git host API listings with Shinan | Missed events silently corrupt derived status (D-005); reconciliation must close every gap. |
| R3 | Work link coverage | At least 95% of merged PRs in trial repositories have a `delivers` work link; no wrong link in a sample of 30 | Tasks are only useful if work reaches them (D-002). |
| R4 | Derived status | In weekly samples of 20 tasks, task status matches the owner's judgment at least 95% of the time; no task status ever needed a hand edit outside manual states | Tests D-005 on real work. |
| R5 | Provenance | 100% of facts in the trial workspace have a fact state, a source and a last-checked time (or an explicit `unknown`) | D-007; should be enforced, so anything less is a defect. |
| R6 | Catalog accuracy | In a sample of 30 facts rechecked against owning sources, at least 95% are correct or correctly shown as stale or `unknown`; every error has an explanation | Trust is the main differentiator (D-007). |
| R7 | Catalog kept current | At least 90% of `workspace` repository catalog changes to trial entities during the trial have a matching applied catalog proposal in Shinan within two days, including time waiting for catalog approval | Shows agents maintain Shinan's catalog as part of their work. |
| R8 | Presence | At least 90% of OpenCode agent sessions working on trial tasks are `plugin-reported` and attached to the right task; a killed agent session shows as `unresponsive` within the agreed threshold | Tests D-014 level 2. |
| R9 | Attribution | At least 90% of agent-made events in trial repositories have attribution confidence `recorded` or `marked` | D-017 is a known limitation; this measures how well Shinan designs around it. |
| R10 | Reliability and recovery | Availability of at least 99% over the last four trial weeks, measured by mon; no unrecovered data loss; at least one successful restore from backup onto a fresh installation built from Shinan's own documentation, with the time taken recorded | Shinan will hold the runbooks used to recover everything else. The fresh installation also proves self-hosting (D-012). |
| R11 | Security | Sign-in protections from [identity](identity.md) and the security checklist from [architecture](architecture.md) in place, with no open high-severity finding; the viewer test account sees only what its role allows; a secret scan of all catalog content and events finds nothing | D-015: a public app holding infrastructure details. |
| R12 | Useful to the owner | For the last three weekly checks, the owner answers these from Shinan alone: what is in progress across the trial projects; which tasks need a person; which agent sessions are running and on what; where and how a trial project is deployed; what happened on a given task this week. Zero recorded fall-backs in the last two weeks | The point of Shinan is that people can follow the work. |
| R13 | Useful to agents | In a sample of 20 agent sessions starting work on trial projects, at least 18 found the context they needed through Shinan's MCP server or skill without reading the `workspace` repository | Agents are the main readers and writers of the catalog. |
| R14 | Migration rehearsal | A full import of the `workspace` repository into a separate rehearsal workspace ([section 6.3](#63-cutover-steps)) succeeds: every entry imported, no broken links, all verification fields preserved, the owner spot-checks 10 entities | The migration must be boring by the time it is real. |
| R15 | Exit path | A full export of the trial workspace, re-imported into an empty workspace, produces the same catalog content and tasks | The rollback plan depends on it. |
| R16 | Phase 2 features needed for migration | The board and the triage inbox are deployed and used during the trial | They replace the Forgejo Project board and the manual sorting of incoming issues. Nudges and notifications are new abilities and are **not** migration prerequisites. |

**Open:** whether R13 can be measured reliably; it may need agent sessions to
report what they read. [Agent integrations](agent-integrations.md) decides
what can be recorded.

## 6. Migrating the `workspace` repository

### 6.1 Principles

**Proposed (RM-11):**

1. **One home per fact at every moment.** Before cutover the `workspace`
   repository owns everything it owns today; after cutover Shinan does. There
   is no period where both are editable. Reason: D-018 avoids two sources of
   truth.
2. **Preserve provenance.** Imported facts keep their recorded check dates,
   scopes and sources. Import is not a check. Reason: D-007 and the
   `workspace` repository's own rule that dates refer to actual checks.
3. **Link, do not copy, history.** Closed issues, PRs and the changelog stay
   on Forgejo and in the archived repository. Reason: D-001 and plan section 3
   (Shinan does not copy facts another system owns); reusable outcomes from
   them are already in the catalog, runbooks and decisions.
4. **Rehearse first.** The real cutover repeats a rehearsal that already
   passed (R14).

### 6.2 What moves where

**Proposed.** Entity type definitions belong to the [catalog](catalog.md);
the agent conventions belong to [agent integrations](agent-integrations.md)
and [tasks and work](tasks.md).

| `workspace` repository part | Destination in Shinan | Notes |
|---|---|---|
| `catalog/projects/*` | `project` entities | Location tables (checkouts per machine) move with them. |
| `catalog/machines/*` | `machine` entities | Includes machine guidance agents rely on, such as Daedalus's storage and worktree locations. |
| `catalog/services/*` | `service` entities | |
| `runbooks/*` | `runbook` entities | |
| `decisions/*` | `decision` entities | |
| `docs/access-and-safety.md`, `docs/maintenance.md`, the policy parts of `docs/collaboration.md` | `policy` entities | For example the deployment-only approval rule and the update obligation. |
| `docs/agent-entrypoint.md` | The start-here path for agents ([human experience](human-experience.md)) and Shinan's skill | |
| `docs/forgejo-setup.md` | The `forgejo` `service` entity, or a `runbook` | Decided by the [catalog](catalog.md). |
| Frontmatter `id`, `status`, `owner` | Entity ID, entity status, entity owner | IDs are kept unchanged so old links and references can be resolved. |
| Frontmatter `last_verified`, `verification_scope`, `verification_source` | Last checked, check scope, source on the facts they cover | Depends on the fact unit the [catalog](catalog.md) chooses. Where facts are finer than a page, facts outside the recorded scope get `unknown` as their last-checked time. |
| Relative Markdown links between entries | Links between entities | Broken links block the import (R14). |
| `templates/*`, `scripts/check.py`, tests | Replaced by Shinan's entity types and validation | Not imported. |
| `.opencode/skills/*`, `docs/skills.md` | Replaced by Shinan's skill | Not imported. |
| `integrations/opencode/*` and each machine's global OpenCode instructions | Replaced by instructions pointing at Shinan's MCP server, skill and plugin | See [6.5](#65-switching-agents-over). |
| `CHANGELOG.md`, Git history | Stays in the archived repository | Linked from the workspace's catalog. |
| Forgejo issues, PRs, Project board | See [6.4](#64-coordination-issues-and-the-project-board) | |

### 6.3 Cutover steps

**Proposed (RM-12): a single cutover for the whole catalog, not a
project-by-project move.** Reason: the catalog is small (32 catalog entries,
3 runbooks, 3 decisions and 6 policy and guide documents) and heavily
cross-linked; moving it in pieces would create
links that cross between two homes and periods where agents must check both.

1. **Readiness decision (G2).** The owner judges Shinan ready, with the
   readiness report, and records it as a decision.
2. **Rehearsal.** Import the `workspace` repository at a named revision into
   a separate rehearsal workspace. Produce an import report: entries per type,
   links resolved, verification fields preserved, items that could not be
   mapped. Fix gaps and repeat until clean (R14).
3. **Freeze.** A `workspace` repository PR marks the catalog, runbooks,
   decisions and policies as frozen for migration. Open catalog PRs are merged
   or closed first. Reason: a moving source makes reconciliation unreliable.
4. **Import** at the frozen revision into the trial workspace (the one used in
   the trial; see RM-13).
5. **Reconcile trial entities.** For entities that exist in both, compare fact
   by fact. Agreeing facts keep the better provenance. Disagreeing facts are
   resolved from evidence and check time, not from which side was written
   last; where neither side can be shown right, both are kept as a
   discrepancy. Reason: this is the `workspace` repository's existing rule for
   competing claims, and the glossary's discrepancy rule.
6. **Verify.** Automated comparison against the frozen revision plus an owner
   spot-check of 10 entities.
7. **Switch.** A `workspace` repository PR replaces its README, AGENTS.md and
   catalog indexes with a pointer to Shinan and states that Shinan is now the
   source of truth. Agents switch over ([6.5](#65-switching-agents-over)).
8. **Coordination.** Open issues move as described in
   [6.4](#64-coordination-issues-and-the-project-board).
9. **Rollback window** of 30 days ([6.7](#67-rollback-and-break-glass-access)).
10. **Archive (G3).** The owner confirms the cutover; the `workspace`
    repository is archived read-only on Forgejo.

**Proposed (RM-13): the trial workspace becomes the production workspace;
there is no fresh start at migration.** Reason: task IDs are never reused and
appear in branch names and PRs (D-002); keeping the same workspace keeps those
references and the trial's history valid.

### 6.4 Coordination issues and the Project board

**Proposed (RM-14):**

| Item | At cutover | Reason |
|---|---|---|
| Open issues in the `workspace` repository (5 on 2026-11-16) | Each becomes a task with an `origin` work link to the issue (D-003), if the trial has not already done so. Then the issue is closed with a comment linking the task. | One home per piece of work after cutover; the issue keeps its discussion. |
| Issues labelled `human-effort` | The task gets `needs a person`, with the TL;DR summary as its explanation. | Same meaning; the glossary maps the label to this task flag. |
| Closed issues and all PRs | Not imported. Stay on Forgejo. Linked from the archived repository's entry in Shinan. | D-001: no copies. Their lasting outcomes already live in the catalog. |
| Project board | Not migrated automatically: the Forgejo API has no Project endpoints (checked 2026-11-16). The board is small; the owner reads its columns for the open issues at cutover, and Shinan's board takes over. | No supported way to read it; derived status replaces the columns anyway (D-005). |
| New cross-project work | Starts as a Shinan task. The `workspace` repository's issue tracker gets a notice and, after G3, is disabled or archived with the repository. | Prevents new work landing in the old home. |

### 6.5 Switching agents over

**Proposed:**

- Every machine's global OpenCode instructions (today they bootstrap the
  `workspace` repository) are updated to point at Shinan. Under the
  `workspace` repository's current policy, updating local agent instructions
  needs no extra approval. Reason: agents must stop reading a frozen source on
  day one.
- The four `workspace-*` skills are replaced by Shinan's skill. The old skills
  stay in the archived repository but are no longer registered.
- The rules agents follow today (standing authority for routine work,
  deployment-only approval, `needs a person` instead of `human-effort`, task
  IDs in branches) become `policy` entities and parts of Shinan's skill, owned
  by [agent integrations](agent-integrations.md) and [tasks and
  work](tasks.md). Reason: they must not be lost in the move; they are what
  makes agent work safe today.

### 6.6 What is left of the `workspace` repository

**Proposed:** after G3 it is archived read-only, with a README pointing to
Shinan. It keeps its Git history, changelog, issues and PRs as the record of
how work was done before Shinan. Reason: archiving makes clear it is no longer
a source of truth while keeping the history linkable.

**Open:** whether the break-glass export ([6.7](#67-rollback-and-break-glass-access))
should be written into a new, clearly named repository or somewhere else.
Re-using the `workspace` repository name for it would confuse agents whose
instructions still mention it.

### 6.7 Rollback and break-glass access

**Proposed:**

- **During the 30-day rollback window**, Shinan exports the workspace daily.
  If the owner decides to roll back, the latest export is turned into a
  `workspace` repository PR, the freeze is lifted, and agent instructions are
  switched back. Reason: a rollback must not lose the work done since cutover.
- **Break-glass copy, permanently.** A read-only export of the catalog,
  including the runbooks needed to recover Shinan itself, is kept outside
  Shinan and readable without it, for example as a Markdown snapshot on each
  development machine. Reason: Shinan and Forgejo both run on Musashi. If
  Musashi is down, the runbooks to fix it must still be reachable. Today a
  local `workspace` repository checkout serves this purpose; the migration
  must not remove it without a replacement. Where and how often the copy is
  made belongs to [architecture](architecture.md).

## 7. Risks

| Risk | Effect | Mitigation | Status |
|---|---|---|---|
| Double maintenance tires agents and the owner | Shinan's trial catalog falls behind; R7 fails for the wrong reason | Small trial catalog (RM-6); Shinan reads coordination issues instead of copying them (RM-7) | Proposed |
| Musashi is a single point of failure for Forgejo and Shinan | Recovery information unreachable during an outage | Break-glass copy (6.7); R10 restore rehearsal | Proposed |
| Infrastructure details on a public web app (D-015) | Exposure of sensitive context | Sensitive infrastructure kept to the minimum in the trial; R11 before migration | Proposed |
| Agents do not follow conventions | Missing work links, poor attribution | Measured by R3 and R9; skill and plugin enforce what they can | Proposed |
| Deployment approvals slow down fixes during the trial | Slow feedback | Release train (RM-4) | Proposed |
| Phase 2 features creep into phase 1 | Trial starts late | First version scope is fixed by this document; additions need an owner decision | Proposed |
| The trial is too narrow to reveal problems | Migration finds them instead | Reserve projects; R14 rehearsal imports the whole `workspace` repository before cutover | Proposed |
| Shinan tracks its own development | A broken Shinan hides its own bugs | Trial findings are GitHub issues, readable without Shinan (4.4) | Proposed |

## Dependencies on other documents

| Document | What this roadmap needs from it |
|---|---|
| [Domain model and glossary](domain-model.md) | Terms; the owner's answers to its decisions 2 (agents setting `needs a person`), 4 (task ID prefix per workspace) and 5 (`awaiting deployment approval`), which affect the trial's handling of `human-effort` issues and rollouts and the task IDs used in branch names. |
| [Product overview](product-overview.md) | Confirmation that the phase boundaries match the product scope and non-goals. |
| [Catalog](catalog.md) | Entity types and required fields for the import mapping (6.2); how facts and checks are recorded; whether `docs/forgejo-setup.md` becomes a service section or a runbook; how catalog proposals for trial entities are approved. |
| [Tasks and work](tasks.md) | Task ID and marker conventions used in the trial; how outside issues become tasks and are closed at cutover; the `needs a person` state. |
| [Identity, agents and permissions](identity.md) | Sign-in and access protections for R11; the viewer role for the second test account; attribution confidence for R9. |
| [Git host integrations](git-hosts.md) | Whether a git host connection can filter by label (4.4); reconciliation guarantees for R2; the credentials the owner must create (3.4). |
| [Agent integrations](agent-integrations.md) | The OpenCode plugin and skill used in the trial; what agent sessions can report for R8 and R13; the policy content moved into the skill (6.5). |
| [Human experience](human-experience.md) | The wiki, start-here path, board and triage inbox required by R12 and R16. |
| [Architecture and operations](architecture.md) | Technology and storage (D-020); release process (RM-4); backups, restore and export (RM-2, R10, R15); the security checklist (R11); the break-glass copy (6.7). |
| [Decision log](decisions/) | Permanent IDs for RM-1 to RM-14 once accepted. |

## Decisions proposed in this document

| Label | Proposal | Section |
|---|---|---|
| RM-1 | Every phase gate is a recorded owner decision | [2](#2-phases) |
| RM-2 | Backups, export and outside monitoring are in the first version | [3.1](#31-in-scope) |
| RM-3 | Four build milestones; the trial starts at M2 and widens | [3.3](#33-build-milestones) |
| RM-4 | Release train with one deployment approval per release | [3.4](#34-owner-actions-needed-in-phase-1) |
| RM-5 | Trial projects: Shinan, mon, easyshell; reserves Walls, guneet.dev plus Resume | [4.2](#42-candidates) |
| RM-6 | Small trial catalog, seeded with honest provenance, kept current by catalog proposals, `workspace` repository wins on disagreement | [4.3](#43-the-catalog-during-the-trial) |
| RM-7 | Where trial work is tracked; Shinan reads coordination issues instead of copying them | [4.4](#44-tasks-during-the-trial) |
| RM-8 | A trial note in the `workspace` repository points agents at Shinan | [4.5](#45-agents-in-the-trial) |
| RM-9 | Readiness judged by the owner from a report against R1 to R16 | [5](#5-readiness-criteria) |
| RM-10 | Conditions that pause the trial | [4.6](#46-running-the-trial) |
| RM-11 | Migration principles | [6.1](#61-principles) |
| RM-12 | One cutover for the whole catalog after a rehearsal | [6.3](#63-cutover-steps) |
| RM-13 | The trial workspace becomes the production workspace | [6.3](#63-cutover-steps) |
| RM-14 | How open and closed coordination issues and the board are handled | [6.4](#64-coordination-issues-and-the-project-board) |

## Open questions

1. **Release cadence** during the trial (RM-4). Owned with
   [architecture](architecture.md).
2. **Label filter** for reading issues in the `workspace` repository, if the
   Forgejo connection cannot filter (4.4). Owned with
   [git host integrations](git-hosts.md).
3. **Measuring R13** (agents finding context through Shinan) depends on what
   agent sessions can report.
4. **Fact unit.** The unit the [catalog](catalog.md) chooses changes how
   page-level verification fields map to facts at import (6.2).
5. **Task flags.** Glossary owner decisions 2 (agents setting `needs a
   person`) and 5 (`awaiting deployment approval`) change how `human-effort`
   issues and pending rollouts are handled in the trial and at cutover.
6. **Break-glass copy location** and whether it is a new repository (6.6,
   6.7).
7. **Whether Walls or guneet.dev plus Resume join** if the trial produces too
   few tasks or a main candidate has to leave.
8. **Fresh Forgejo Project API.** If Forgejo ships Project endpoints before
   cutover, board state could be read automatically; re-check at the rehearsal.

## Decisions needed from the owner

| # | Decision | Options | Recommended | Reason |
|---|---|---|---|---|
| 1 | Trial projects (RM-5) | (a) Shinan, mon, easyshell; (b) add Walls; (c) a different set | **(a)** | Covers both git hosts, multi-repository tasks, outside issues and work that needs a person with the fewest projects. |
| 2 | Meaning of "starts empty" for the trial catalog (RM-6) | (a) Seed trial entities from `workspace` repository entries with honest provenance; (b) build trial entities only from owning sources; (c) automatic one-way mirror | **(a)** | Fast to start, never refreshes check dates, and still tests agents keeping the catalog current; (c) would not test catalog proposals at all. |
| 3 | Where cross-project coordination for trial projects lives during the trial (RM-7) | (a) Stays in issues in the `workspace` repository, read by Shinan; (b) moves to Shinan tasks now | **(a)** | Keeps D-018's single source of truth and avoids copying by hand. |
| 4 | Readiness thresholds R1 to R16 (RM-9) | (a) Accept as proposed; (b) adjust before the trial | **(a), revisit after two trial weeks** | Real use will show which numbers are realistic; changing them before data exists is guessing twice. |
| 5 | Are the board and triage inbox prerequisites for migration (R16)? | (a) Yes; (b) no, migrate with phase 1 features only | **(a)** | They replace the Forgejo Project board and the manual sorting of incoming issues, which are in use today. |
| 6 | Cutover style (RM-12) | (a) One cutover after a rehearsal; (b) project by project | **(a)** | The catalog is small and cross-linked; piecemeal moves create two homes. |
| 7 | Rollback window length | (a) 30 days; (b) 14 days; (c) 60 days | **(a)** | Long enough to cover several release cycles and a monthly routine, short enough not to leave the old repository half-alive. |
| 8 | Fate of the `workspace` repository after cutover (6.6) | (a) Archive read-only; (b) keep as the break-glass export; (c) delete | **(a)** | Keeps history linkable without confusing agents about which source is live. |
| 9 | Claude Code plugin timing | (a) Phase 2a; (b) phase 1 | **(a)** | The owner's current agents use OpenCode; phase 1 should prove one plugin before building a second. |
| 10 | Release train for deployments to Musashi (RM-4) | (a) Weekly release plus urgent fixes; (b) approve every deployment as it comes | **(a)** | Same safety under D-016 with far fewer approval requests during a busy trial. |
