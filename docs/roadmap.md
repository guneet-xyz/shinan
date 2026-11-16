# Roadmap and migration

Status: **draft for review** ([issue #12](https://github.com/guneet-xyz/shinan/issues/12)).

This document owns Shinan's phases, the scope of the first version, the proof
of concept (which projects, how the trial runs and what counts as "ready"), and
how the `workspace` repository's catalog and cross-project coordination issues
move into Shinan. It answers plan question 8.

It uses the terms of the [domain model and glossary](domain-model.md) exactly.
Each statement is marked:

- **Decided**: follows from an accepted plan decision or approved plan content,
  which is cited.
- **Proposed**: suggested here, with a reason. The owner confirms or changes it.
  Proposals that change or reinterpret an accepted decision or the `workspace`
  repository's current policy are also listed under
  [decisions needed from the owner](#decisions-needed-from-the-owner).
- **Open**: not settled; listed under [open questions](#open-questions).

Decisions proposed here carry local labels (RM-1, RM-2, ...). The
[decision log](decisions/) gives them permanent IDs once accepted.

## Summary

- Shinan is built in phases with a gate between each one. The owner closes each
  gate with a recorded decision, against stated criteria (proposed, RM-1).
- The first version is the plan's phase 1 feature set plus backups, export,
  uptime monitoring and a viewer test account. A cut line says what can slip
  without blocking the trial (proposed, RM-2, RM-3).
- The proof of concept uses three projects: **Shinan** itself, **mon** and
  **easyshell**. Together they cover GitHub and Forgejo, tasks across several
  repositories, several machines, deployment approvals, high volume and work
  that needs a person (proposed, RM-5).
- During the trial the `workspace` repository stays the source of truth for
  everything it owns today (decided, D-018). Objectives and acceptance criteria
  always stay on a git host; Shinan reads them instead of asking anyone to copy
  them (proposed, RM-7).
- The trial catalog is built by checking owning sources, using `workspace`
  repository entries only as a map (proposed, RM-6).
- Readiness is judged by the owner from a weekly report against criteria R1 to
  R16. Seven are must-pass; the rest are judged. Agents prepare the samples, so
  the owner's recurring trial work is **about one hour a week** (proposed,
  RM-9).
- After the owner judges Shinan ready, the `workspace` repository moves in one
  rehearsed cutover with a 30-day rollback window. History stays where it is
  (proposed, RM-11 to RM-14).

## 1. Starting point

Facts in this section are observations, not decisions. They were checked on
**2026-11-16** at `workspace` repository revision `86bba32`, using local Git,
the Forgejo CLI (`fj`) and the GitHub CLI (`gh`), all read-only.

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
issues that need a person, with a TL;DR comment. Issue #50 carries it.

Since 2026-11-06, 48 changes on `main` touched the catalog entries a trial
would cover (the mon, easyshell and shinan `project` entries, the Musashi,
Anzen and Daedalus `machine` entries, and `service` entries); 17 of them
touched the three `project` entries.

Every machine's global OpenCode instructions tell agents to read the
`workspace` repository's `AGENTS.md` and agent entry point before project
work.

The Forgejo instance (`git.guneet.dev`, API version `16.0.5+gitea-1.22.0`) has
no Project board endpoints in its API schema (checked at
`https://git.guneet.dev/swagger.v1.json`). A Project API exists only as an
upstream [proposal](https://codeberg.org/forgejo/discussions/issues/466).
Board state therefore cannot be read automatically; this matters for
[migration](#64-coordination-issues-and-the-project-board).

Forgejo and Shinan's planned deployment both run on Musashi (Forgejo per the
`workspace` repository's `forgejo` service entry; Shinan per D-016). Both mon
boards also run on Musashi. This matters for
[measuring uptime](#5-readiness-criteria) and
[recovery](#67-rollback-and-break-glass-access).

### Activity in candidate projects

| Repository | Host, visibility | Open issues | Created since 2026-11-01 | Issue authors other than the owner |
|---|---|---|---|---|
| `guneet-xyz/shinan` | GitHub, private | 11 (document issues #3 to #13) | 12 PRs | none |
| `guneet-xyz/mon` | GitHub, public | 19 | 20 PRs | none |
| `guneet-xyz/easyshell` | GitHub, public | 28 | 79 issues, 22 PRs | one closed issue (#129, opened 2025-03-10) |
| `cranklabs/walls` | GitHub, public | 10 | 14 PRs | none |
| `guneet-xyz/dockyard` | GitHub, public | 0 | 8 PRs | none |

In `infra/musashi` on Forgejo, 14 issues concern mon or easyshell rollouts
(for example #49, #70, #91, #98 for mon and #21, #31, #46, #99 for
easyshell). So their work already spans both git hosts. `infra/musashi` also
carries rollouts for other projects, such as Walls and Dockyard.

## 2. Phases

The plan's phases (plan, section 10) are the starting point and are
**decided**. This document splits phases 1 and 2 into steps and adds gates
(**proposed**).

| Phase | Steps | Outcome | Gate to leave the phase |
|---|---|---|---|
| 0. Documents | Write, review and accept the in-depth documents | Accepted plan set | Owner accepts the integrated document set (plan, section 9) |
| 1. First version and proof of concept | **1a. Build** the [first version](#3-first-version-scope) in [milestones](#33-build-milestones). **1b. Trial** it on the [proof-of-concept projects](#4-proof-of-concept) | First version running at `shinan.guneet.dev`, used daily on three projects | **G1**: continue into phase 2 |
| 2. Collaboration and migration | **2a. Collaboration:** board, nudges, triage inbox, notifications, Claude Code plugin; the trial continues. **2b. Migration:** when [ready](#5-readiness-criteria), move the `workspace` repository | Shinan is the source of truth; the `workspace` repository is archived | **G2**: Shinan is ready; **G3**: cutover confirmed after the rollback window |
| 3. Agents run by Shinan | Launcher on each machine; start agent sessions from the website | Optional | Owner decides whether to start phase 3 at all, after G3 |

**RM-1 (proposed): every gate is an owner decision against stated criteria,
recorded in [`docs/decisions/`](decisions/).** Reason: D-018 says Shinan
moves over "when judged ready", which is a judgment; stating what is judged
keeps it from being a guess, and recording it keeps the reasons visible.

| Gate | Criteria |
|---|---|
| G1 | Two weeks after M4 is deployed: no [pause condition](#46-running-the-trial) is active, and R2, R5 and R11 are met. The owner wants to continue. |
| G2 | All must-pass criteria met and the judged criteria reviewed ([section 5](#5-readiness-criteria)). |
| G3 | The 30-day rollback window has ended without a rollback ([section 6.7](#67-rollback-and-break-glass-access)). |

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
| Tasks with task IDs, work links, calculated task status, task flags and manual states | Decided (plan, phase 1; D-002, D-005) | Core pillar. |
| GitHub and Forgejo git host connections: webhooks, API reads, reconciliation | Decided (plan, phase 1; D-009) | The trial projects live on both. |
| Outside issues become tasks | Decided (D-003) | Needed from the first day, because outside issues arrive anyway. A simple list of `triage` tasks is enough; the full triage inbox is phase 2 (plan). |
| Timeline | Decided (plan, phase 1) | Core pillar. |
| MCP server and skill | Decided (plan, phase 1; D-014 level 1) | How agents act. |
| CLI | Decided as part of level 1 (plan, integration points) | Can slip ([3.2](#32-cut-line)). |
| OpenCode plugin for presence | Decided (plan, phase 1; D-014 level 2) | How Shinan knows which agent sessions run. |
| Sign-in, one workspace, members and roles | Decided that workspaces and invitations are designed in (D-019) and that sign-in is required (D-015) | |
| A second, viewer-only test account | **Proposed** (RM-2) | The only way to test access rules before a second person joins (R11). It can be created directly; the invitation flow itself can slip. |
| Deployment at `shinan.guneet.dev` on Musashi | Decided (D-011, D-016) | First deployment target. |
| Backups with a rehearsed restore | **Proposed** (RM-2) | The trial creates data that is not stored anywhere else (agent sessions, events). [Architecture](architecture.md) proposes nightly off-host backups. |
| Full export of a workspace and import back | **Proposed** (RM-2) | The rollback (R15) and the break-glass copy depend on it. The [catalog](catalog.md) requires lossless Markdown export; [architecture](architecture.md) proposes an optional Git export, which would satisfy this. |
| Uptime monitoring of `shinan.guneet.dev` | **Proposed** (RM-2) | R10 needs a measurement. [Architecture](architecture.md) proposes a tile on the private mon board. |
| Weekly readiness report | **Proposed** (RM-2) | Readiness is judged on evidence gathered during the trial. A script is enough. |

**RM-2 (proposed): the additions above (backups, export, uptime monitoring, a
viewer test account and the readiness report) are part of the first version.**
Reason: they make a trial on real work safe and are needed to measure the
must-pass criteria. They extend the plan's phase 1 list, so they need an
owner decision.

### 3.2 Cut line

**Proposed (RM-3, part 1):** these can slip past the start of the trial
without blocking it. Reason: the owner is one person and the trial should
start as soon as the core is usable.

| Can slip | Until | Why it can wait |
|---|---|---|
| Invitation flow | G2 | A viewer account created directly tests access rules. |
| CLI | G2 | MCP and the skill cover the trial's agent actions. |
| Fresh installation from documentation (part of R10) | G2 | A restore onto the existing installation proves backups; the fresh install proves self-hosting (D-012) and is needed before migration, not before trial. |
| Export | G2 | Needed for the rollback (R15), not for the trial. |
| Automatic fact checks through git host connections | Phase 2a | Asked by the [catalog](catalog.md) (12.3). Useful but not needed to test whether agents keep the catalog current. |

These must **not** slip: sign-in, backups, uptime monitoring, the viewer test
account, and everything decided for phase 1 except the CLI.

### 3.3 Build milestones

**Proposed (RM-3, part 2):** phase 1a is built in four milestones, each
deployed before the next starts. The trial starts at milestone 2 for the
catalog and widens at milestones 3 and 4. After each milestone the owner and
the building agents review scope against the cut line. Reason: catalog
feedback can start early, the risk is low because the `workspace` repository
stays the source of truth, and a review at each milestone stops scope creep.

| Milestone | Contents | Trial use it unlocks |
|---|---|---|
| M1. Empty installation | Sign-in, one workspace, members and roles, viewer test account, deployment on Musashi, backups, uptime monitoring | None; security and restore checks |
| M2. Catalog | Catalog entities, facts with provenance, catalog proposals and catalog approval, wiki, agent index, MCP read and propose, skill | Catalog part of the trial |
| M3. Tasks and git hosts | Tasks, work links, calculated status, GitHub and Forgejo git host connections, reconciliation, outside issues become tasks, timeline, readiness report | Task part of the trial |
| M4. Presence | OpenCode plugin: agent sessions, presence, attaching an agent session to a task | Presence part of the trial; trial fully running |

The technology, storage and the order inside each milestone belong to
[architecture and operations](architecture.md) (D-020).

### 3.4 Owner actions needed in phase 1

These need the owner because they involve deployment approval (D-016, and the
`workspace` repository's access policy) or credentials (the same policy, which
stays in force until migration under D-018). Exact steps belong to
[architecture](architecture.md), [identity](identity.md) and
[git host integrations](git-hosts.md).

- Approve each deployment to Musashi (D-016), including the DNS record for
  `shinan.guneet.dev` and the mon tile in `infra/musashi`.
- Create the credentials Shinan uses to read GitHub and Forgejo, and enter them
  into the approved secret store. People type secrets; agents never handle
  them.
- Install the OpenCode plugin on the machines used for the trial.

**Proposed (RM-4): deploy on a weekly release train plus urgent fixes, with
one deployment approval per release.** Reason: D-016 requires approval for
every deployment; batching keeps that rule and the owner's approval load
small. [Architecture](architecture.md) owns the release process.

## 4. Proof of concept

### 4.1 How projects were chosen

**Proposed:** a good trial project

1. has steady agent-driven work, so the trial produces enough tasks;
2. spans GitHub and Forgejo, or several repositories, so cross-host tasks are
   tested (D-001, D-009);
3. touches several catalog entity types (project, machine, service);
4. includes hard cases: deployment approval and work that needs a person;
5. is low-risk if Shinan misbehaves. Shinan only reads git hosts in phase 1
   apart from posting links, so the main risk is confusion, not damage.

Reason: the trial must show whether Shinan works for the owner's real work,
and the hard cases are where the `workspace` repository's hand-made practice
needs the most effort today.

### 4.2 Candidates

| Project | What it tests | Concerns | Recommendation |
|---|---|---|---|
| **Shinan** (`guneet-xyz/shinan`, GitHub, private) | Daily use by the owner and agents; a private repository; Shinan used on its own development | GitHub only; if Shinan breaks, its own task records are affected (its GitHub issues and PRs remain) | **Include.** The busiest project during phase 1, and the people building it feel its gaps first. |
| **mon** (`guneet-xyz/mon` on GitHub; `infra/musashi`, `infra/anzen`, `guneet/terraform` on Forgejo) | Tasks whose work spans both hosts and four repositories; two machines; several services (ingress, Obscuro, container registry, DNS); deployment approvals (9 rollout issues in `infra/musashi`) | Rollouts touch Musashi, which is sensitive; Shinan only reads these repositories | **Include.** Best test of D-001 and one timeline across hosts. |
| **easyshell** (`guneet-xyz/easyshell` on GitHub; `infra/musashi` on Forgejo) | High volume (79 issues and 22 PRs created since 2026-11-01); open issues #50 (`human-effort`) and #43 in the `workspace` repository; releases and images published through Dockyard, rolled out on Forgejo | Volume may be noisy at first | **Include.** Tests reconciliation and calculated status under load, and has a live "needs a person" case. |
| Walls (`cranklabs/walls`, GitHub; `infra/musashi`) | A second GitHub organisation; frequent cross-host releases | Overlaps with mon and easyshell | Reserve. First to add if volume is short. |
| guneet.dev and Resume (`guneet-xyz/guneet.dev`, private; `guneet-xyz/resume`, public) | A task across two repositories on one host (open issue #103 in the `workspace` repository); a merge that publishes (Resume) | Low volume | Reserve. A small, safe fallback if a main candidate must leave the trial. |
| Dockyard, Drawspace, Obscuro | Similar to the above | Lower recent activity or overlap | Not in the trial. |
| Musashi, Anzen, Terraform, Ansible (infrastructure) | | Sensitive and depended on by everything | **Not trial projects.** `infra/musashi`, `infra/anzen` and `guneet/terraform` are connected so work links resolve ([4.4](#44-tasks-during-the-trial)); their `machine` and `service` entities are added only as far as trial projects need them. |
| Daedalus, Scripts | | Low activity (Scripts last pushed 2026-10-14) | Not in the trial; Daedalus appears as a `machine` entity because agent sessions run there. |
| Takezo, Jobfinder | | Retired; unknown owner and stopped | Not in the trial. |
| The `workspace` repository | | D-018 keeps it out until migration | **Excluded** (decided, D-018). Its issues about trial projects are read, see [4.4](#44-tasks-during-the-trial). |

**RM-5 (proposed): the trial projects are Shinan, mon and easyshell, with
Walls and guneet.dev plus Resume in reserve.** Reason: together they cover
both git hosts, multi-repository tasks, deployment approvals, high volume and
work that needs a person, while keeping the most sensitive infrastructure as
read-only context. Three projects is "a few" (D-018).

**Outside issues (D-003) in the trial.** None of the candidates gets real
outside issues today: easyshell's only one is closed and dates from
2025-03-10. D-003 is therefore exercised mainly by issues the owner and the
owner's agents open on trial repositories and in the `workspace` repository.
Under [tasks and work](tasks.md) these are outside issues opened by a member,
so they start in `to do`, not `triage`. The `triage` path is tested only if a
real outside issue arrives, or by a test issue from the viewer test account.
This is a known gap of the trial (proposed; reason: inventing outside traffic
would not show anything real).

### 4.3 The catalog during the trial

**Decided (D-018):** Shinan starts empty, and the `workspace` repository
stays the source of truth until Shinan is judged ready.

**Proposed (RM-6):**

- The trial uses one Shinan workspace, called the **trial workspace** here.
  It holds only the catalog entities the trial projects need: the three
  `project` entities; `machine` entities for Musashi, Anzen and Daedalus; and
  the `service` entities those projects depend on (ingress, container
  registry, Cloudflare DNS, Obscuro, email, Forgejo, monitoring). Reason: a
  small catalog keeps the extra work small and keeps the most sensitive
  details out until security is proven (R11).
- **Entries are a map, not a source.** Agents use each `workspace` repository
  entry to find owning sources (its `verification_source` and "Authoritative
  sources" already list them), check each fact there, and record the owning
  source with a real check time. Only pure pointers, such as repository URLs
  and IDs, may be copied with the entry (at its Git revision) as their source.
  A fact that cannot be checked is recorded as `unknown`. Reason: copying
  facts would be an early, partial migration that creates two copies of the
  same facts, against D-018's reason; checking instead follows D-007 and
  "link, don't copy" (plan section 3), and it tests exactly what R6 measures.
- **Keeping it current.** When a trial entity's facts change, the agent doing
  the work updates the `workspace` repository as today and also makes a
  catalog proposal in Shinan. A weekly comparison reports differences.
- **Disagreements.** During the trial, agents act on the `workspace`
  repository's version. A disagreement is recorded in Shinan as a discrepancy
  (glossary) and as a trial finding, and is then fixed wherever the evidence
  shows the error. That may be a `workspace` repository PR. Reason: overwriting
  a fresher observation with an older entry would hide real drift; the
  discrepancy rule keeps both with their evidence.

Copying a few facts in step 2 and making an extra catalog proposal in step 3
change what agents do today, so RM-6 is an owner decision.

### 4.4 Tasks during the trial

**Proposed (RM-7):** objectives and acceptance criteria always stay on a git
host during phase 1. Reason: the `workspace` repository's collaboration policy
says issues own objectives and acceptance criteria and project work belongs
in the owning repository's tracker; Shinan is unproven, so it must not become
the only home of any intent before G2.

| Work | Where intent lives during the trial | How Shinan sees it | Reason |
|---|---|---|---|
| Cross-project coordination for a trial project | An issue in the `workspace` repository on Forgejo, as today, with a trial label (for example `shinan-trial`) | Read as an outside issue; becomes a task. Agents put its task ID in branch names and PR descriptions | No copying by hand; tests the Forgejo connection and D-003 on real coordination issues. |
| Work inside mon and easyshell | The project's own repository issue, as today | Read as an outside issue; becomes a task. Agents put its task ID in branch names and PR descriptions | Keeps current policy. Also gives the trial its biggest stream of tasks. |
| Work inside Shinan | Either a GitHub issue, as Shinan's `AGENTS.md` asks today, or (owner decision) a task in Shinan with no repository issue, where the PR description carries the intent and acceptance criteria | Native task, or outside issue | The native option is the only test of D-004 (PRs linked directly, issues only when people need them). Limiting it to Shinan keeps the risk on the project that is built to absorb it, and the PR description keeps the intent on a git host. |
| Trial findings (bugs, gaps, friction) | Issues in `guneet-xyz/shinan`, with a trial label | Outside issues on the Shinan project | Findings must be recordable even when Shinan is down. |
| Everything else | Unchanged | Not seen | Out of trial scope. |

**Proposed: which items in shared repositories count as trial work.**
`infra/musashi`, `infra/anzen` and `guneet/terraform` also carry other
projects' work. In them, a work item belongs to the trial if it names a trial
task ID, or changes a trial project's part of the repository (for example
`stacks/mon-private`, `stacks/mon-public` and `stacks/easyshell` in
`infra/musashi`, `stacks/mon-agent` in `infra/anzen`, and the mon and
easyshell DNS records in `guneet/terraform`). Issues in these repositories,
and issues in the `workspace` repository without the trial label, do not
become tasks. Reason: otherwise every unrelated rollout and coordination
issue would become a task, burying the trial in work it is not testing.
Depends on [git host integrations](git-hosts.md) supporting per-repository
"do not import issues" and a label filter for import. If it cannot, connect
these repositories anyway and cancel unrelated tasks in bulk.

**Proposed:** if Shinan is down, agents carry on with the git-host-only
workflow: task ID in the branch name and PR description, no other change.
Reconciliation links the work afterwards. Reason: the trial must never block
real work.

**Depends on owner decisions in the [glossary](domain-model.md#decisions-needed-from-the-owner):**
whether agents may set the `needs a person` task flag (glossary decision 2),
whether each workspace has its own task ID prefix (glossary decision 4), and
whether a separate `awaiting deployment approval` task flag exists (glossary
decision 5). The trial works with any outcome: it uses `needs a person` for
issue #50 in the `workspace` repository, set by an agent or by the owner, and
uses the deployment approval flag for mon and easyshell rollouts only if it is
adopted. The `human-effort` label on issue #50 stays authoritative during the
trial.

### 4.5 Agents in the trial

**Proposed (RM-8):** a short trial note in the `workspace` repository tells
agents, for trial projects only:

- to connect to Shinan (MCP server, skill, OpenCode plugin) and check in;
- to add the trial label to coordination issues in the `workspace` repository
  that concern a trial project;
- to put the task ID in branch names and PR descriptions, alongside the issue
  reference the `workspace` repository's branch convention already uses;
- to make a catalog proposal in Shinan whenever they update a trial entity in
  the `workspace` repository (RM-6);
- to fall back to the git-host-only workflow if Shinan is down.

It lives in the trial projects' `workspace` repository entries and the
`shinan` project entry, and is added through that repository's PR workflow at
the start of the trial. The global OpenCode instructions are not changed
during the trial. Reason: agents find their context through the `workspace`
repository today, which stays the source of truth; changing the bootstrap
before G2 would undermine that. Because the note changes agent practice, it
is an owner decision. This document does not edit that repository; adding the
note is a follow-up for phase 1b.

The conventions agents follow (task ID markers, check-ins, attaching an agent
session) belong to [agent integrations](agent-integrations.md) and
[tasks and work](tasks.md).

### 4.6 Running the trial

**Proposed:**

- **Length:** at least four weeks with M4 deployed (see R1). Reason: four
  weeks covers several release and rollout cycles in each trial project and
  is long enough for freshness drift to show.
- **Weekly readiness report,** produced by a script or by Shinan itself. Agents
  prepare every sample (R3, R4, R6, R13) and check it first; the owner
  spot-checks 10 items in total each week. Reason: the owner is one person;
  agents can do the counting and rechecking, and the owner's job is to judge.

**Owner's recurring trial work (proposed budget: about one hour a week).**
Estimates; the report tracks the real time so it can be cut if it grows.

| Task | How often | Estimated time | Notes |
|---|---|---|---|
| Deployment approval for the weekly release (RM-4) | Weekly | 5 minutes | Urgent fixes extra. |
| Catalog approval of catalog proposals, in one batch | Weekly | 15–25 minutes | The [catalog](catalog.md)'s strict first-version rule needs catalog approval for everything except unchanged rechecks. From the 48 changes in ten days to the entries a trial covers, expect 10–20 proposals a week. This document proposes switching on the catalog's relaxed setting after two trial weeks if R6 is on track; most proposals would then apply on their own and this falls to the few rule and lifecycle changes. The catalog (its decision 4) recommends deciding after the proof of concept; switching earlier means the last trial weeks test the setting that will be used after migration. |
| Spot-check 10 items from agent-prepared samples | Weekly | 15 minutes | Covers R3, R4, R6 and R13. |
| The R12 questions | Weekly | 10 minutes | |
| Reading the readiness report | Weekly | 5 minutes | |
| Accepting `triage` tasks | As they come | Near zero | Issues opened by the owner or the owner's agents start in `to do` ([4.2](#42-candidates)). |

One-off owner work: credentials and the plugin (3.4), gates G1 to G3, and the
spot-check after the migration rehearsal.

**Proposed (RM-10): pause the trial and fall back to the git-host-only
workflow if any of these happen:**

- a credential or other secret is exposed through Shinan;
- data is lost and cannot be restored from backup;
- Shinan blocks agents' real work for more than one working day;
- an access rule fails, for example the viewer test account sees something it
  should not.

Reason: under RM-7 every objective and acceptance criterion also lives on a
git host, and under D-018 the `workspace` repository holds the catalog, so
pausing loses only Shinan's own records (agent sessions, events, catalog
proposals). Resuming is an owner decision after the cause is fixed.

## 5. Readiness criteria

**Proposed (RM-9):** the owner judges readiness (G2) from the readiness
report. Criteria are of two kinds:

- **Must-pass:** without these, migration is unsafe. They are R2, R3, R5, R10,
  R11, R14 and R15, plus R16 if the owner makes it a prerequisite.
- **Judged:** the owner weighs these and may accept Shinan with documented
  exceptions.

The thresholds are starting proposals, to be revisited after two trial weeks.
Reason: thresholds set before real use are guesses; a small set of hard
safety gates plus judgment on the rest is safer than a rigid formula, and
D-018 asks for a judgment.

Two scopes are used:

- **Connected repositories:** every repository the trial workspace's git host
  connections cover.
- **Trial work items:** work items in the trial projects' own repositories,
  plus work items in shared repositories that belong to the trial as defined
  in [4.4](#44-tasks-during-the-trial).

| ID | Kind | Criterion | Measure and proposed threshold | Reason |
|---|---|---|---|---|
| R1 | Judged | Trial size | At least 4 weeks with M4 deployed; at least 40 tasks reach `done` or `cancelled`; at least 10 of them have `delivers` work links on both GitHub and Forgejo. If short, extend by up to two weeks, then add Walls | The three trial projects created 54 PRs between 2026-11-01 and 2026-11-16, and mon and easyshell have had 14 rollout issues in `infra/musashi`, so this is reachable. |
| R2 | Must-pass | Event capture | Every issue, PR, merge and review in connected repositories during the trial appears in Shinan within 24 hours (100%); at least 95% within 5 minutes. Checked by comparing git host API listings with Shinan | Missed events silently corrupt calculated status (D-005); reconciliation must close every gap. |
| R3 | Must-pass | Work link coverage | At least 95% of merged PRs among trial work items have a `delivers` work link; no wrong link in an agent-prepared sample of 30, of which the owner spot-checks some | Tasks are only useful if work reaches them (D-002). |
| R4 | Judged | Calculated status | In weekly agent-prepared samples of 20 tasks, task status matches reality at least 95% of the time (owner spot-checks some); no task status needed a hand edit outside manual states | Tests D-005 on real work. |
| R5 | Must-pass | Provenance | 100% of facts in the trial workspace have a fact state, a source and a last-checked time (or an explicit `unknown`) | D-007; should be enforced, so anything less is a defect. |
| R6 | Judged | Catalog accuracy | In an agent-prepared sample of 30 facts rechecked against owning sources, at least 95% are correct or correctly shown as stale or `unknown`; every error explained | Trust is the main differentiator (D-007). |
| R7 | Judged | Catalog kept current | At least 90% of `workspace` repository changes to trial entities have a matching catalog proposal in Shinan, **made** within two days (time waiting for catalog approval does not count). Also counted: stale or `unknown` facts that agents fixed as a side effect of task work | Measures whether agents maintain the catalog, not how fast the owner approves. The side-effect count matches the [product overview](product-overview.md)'s second sign of success. |
| R8 | Judged | Presence | At least 90% of OpenCode agent sessions working on trial tasks are `plugin-reported` and attached to the right task; a stopped agent session shows as `unresponsive` within the threshold [agent integrations](agent-integrations.md) sets | Tests D-014 level 2. |
| R9 | Judged | Attribution | At least 90% of agent-made events on trial work items have attribution confidence `recorded` or `marked` | D-017 is a known limitation; this measures how well Shinan designs around it. |
| R10 | Must-pass | Reliability and recovery | Availability of at least 99% over the last four trial weeks; no unrecovered data loss; at least one successful restore from backup, with the time taken recorded; before G2, one restore onto a fresh installation built from Shinan's own documentation | Shinan will hold the runbooks used to recover everything else. The fresh install also proves self-hosting (D-012). See the note on measuring uptime below. |
| R11 | Must-pass | Security | Sign-in protections from [identity](identity.md) and the security checklist from [architecture](architecture.md) in place, with no open high-severity finding; the viewer test account sees only what its role allows; a secret scan of all catalog content and events finds nothing | D-015: a public app holding infrastructure details. |
| R12 | Judged | Useful to the owner | For the last three weekly checks, the owner answers from Shinan alone: what is in progress across the trial projects; which tasks need a person; which agent sessions are running and on what; where and how a trial project is deployed; what happened on a given task this week. Zero recorded fall-backs in the last two weeks | The point of Shinan is that people can follow the work. |
| R13 | Judged | Useful to agents | In an agent-prepared sample of 20 agent sessions on trial projects, at least 18 took their project-specific context (locations, deployment, owning sources) from Shinan's MCP server or skill rather than from `workspace` repository entries | Agents still read the `workspace` repository's general instructions, because the bootstrap is unchanged during the trial (RM-8); what matters is whether Shinan's catalog served the project context. |
| R14 | Must-pass | Migration rehearsal | A full import of the `workspace` repository into a separate rehearsal workspace ([section 6.3](#63-cutover-steps)) succeeds: every entry imported, no broken links, all verification fields preserved, owner spot-checks 10 entities | The migration must be boring by the time it is real. |
| R15 | Must-pass | Exit path | A full export of the trial workspace, imported into an empty workspace, produces the same catalog content and tasks | The rollback depends on it. |
| R16 | Must-pass if adopted | Phase 2 features needed for migration | The board and the triage inbox are deployed and used during the trial | They replace the Forgejo Project board and the manual sorting of incoming issues. Nudges and notifications are new abilities, not replacements, so they are not prerequisites. |

**Measuring uptime (R10).** Both mon boards run on Musashi, like Shinan, so an
outage of Musashi stops both Shinan and the record of it. **Proposed:** any
gap in mon's data for `shinan.guneet.dev` counts as downtime. Reason: it errs
on the safe side and needs no new service. A probe off Musashi, such as a
third-party uptime check, would separate Shinan outages from Musashi outages;
it is optional and would need a new account, so it is left **open**. Adding
the mon tile is a change in `infra/musashi` and needs deployment approval.

**Open:** how R13's sample is gathered; it may need agent sessions to report
what they read. [Agent integrations](agent-integrations.md) decides what can
be recorded.

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

**Proposed.** The detailed field mapping is the [catalog](catalog.md)'s
(section 13), including its proposal to import each entry with its prose as
body and its page-level check, then extract facts gradually. Agent
conventions belong to [agent integrations](agent-integrations.md) and
[tasks and work](tasks.md). This table is the migration's view.

| `workspace` repository part | Destination in Shinan | Notes |
|---|---|---|
| `catalog/projects/*`, `catalog/machines/*`, `catalog/services/*` | `project`, `machine` and `service` entities | Includes machine guidance agents rely on, such as Daedalus's storage and worktree locations. |
| `runbooks/*`, `decisions/*` | `runbook` and `decision` entities | |
| `docs/access-and-safety.md`, `docs/maintenance.md`, the policy parts of `docs/collaboration.md` | `policy` entities | For example the deployment-only approval rule and the update obligation. |
| `README.md` "Start here", `AGENTS.md`, `docs/agent-entrypoint.md` | The start-here path ([human experience](human-experience.md), [catalog](catalog.md)) and Shinan's skill | |
| `docs/forgejo-setup.md` | The `forgejo` `service` entity, or a `runbook` | Decided by the [catalog](catalog.md). |
| Frontmatter `id`, `status`, `owner` | Entity ID, entity status, entity owner | IDs are kept recognisable so old links resolve; the catalog proposes the form `<type>/<slug>`. |
| Frontmatter `last_verified`, `verification_scope`, `verification_source` | Fact checks | Per the catalog: the page-level check becomes one fact check on the facts taken from the page. Import never refreshes it. |
| Relative Markdown links between entries | Links between entities | Broken links block the import (R14). |
| `templates/*`, `scripts/check.py`, tests | Replaced by Shinan's type schemas and validation | Not imported. |
| `.opencode/skills/*`, `docs/skills.md` | Replaced by Shinan's skill | Not imported. |
| `integrations/opencode/*` and each machine's global OpenCode instructions | Replaced by instructions pointing at Shinan's MCP server, skill and plugin | See [6.5](#65-switching-agents-over). |
| `CHANGELOG.md`, Git history | Stays in the archived repository | Linked from the `workspace` `project` entity. |
| Forgejo issues, PRs, Project board | See [6.4](#64-coordination-issues-and-the-project-board) | |

### 6.3 Cutover steps

**Proposed (RM-12): a single cutover for the whole catalog, not a
project-by-project move.** Reason: the catalog is small (32 catalog entries,
3 runbooks, 3 decisions and 6 policy and guide documents) and heavily
cross-linked; moving it in pieces would create links that cross between two
homes and periods where agents must check both.

1. **Readiness decision (G2),** recorded with the readiness report.
2. **Rehearsal.** Import the `workspace` repository at a named revision into
   a separate rehearsal workspace. Produce an import report: entries per type,
   links resolved, verification fields preserved, items that could not be
   mapped. Fix gaps and repeat until clean (R14).
3. **Freeze.** A `workspace` repository PR marks the catalog, runbooks,
   decisions and policies as frozen for migration. Open catalog PRs are merged
   or closed first. The freeze lasts **at most two working days**; if steps 4
   to 7 are not done by then, the freeze is lifted and the cutover
   rescheduled. Reason: a moving source makes the import unreliable, and a
   long freeze stops agents recording what they learn.
4. **Import** at the frozen revision into the trial workspace (RM-13).
5. **Compare and resolve trial entities.** For entities that exist in both,
   compare fact by fact. Agreeing facts keep the better provenance (usually
   the trial's check against the owning source). Disagreeing facts are
   resolved from evidence and check time, not from which side was written
   last; where neither side can be shown right, both are kept as a
   discrepancy. Reason: this is the `workspace` repository's existing rule for
   competing claims and the glossary's discrepancy rule.
6. **Verify.** Automated comparison against the frozen revision plus an owner
   spot-check of 10 entities.
7. **Switch.** A `workspace` repository PR replaces its README, `AGENTS.md`
   and catalog indexes with a pointer to Shinan and states that Shinan is now
   the source of truth. Agents switch over ([6.5](#65-switching-agents-over)).
8. **Coordination.** Open issues move as described in
   [6.4](#64-coordination-issues-and-the-project-board).
9. **Rollback window** of 30 days ([6.7](#67-rollback-and-break-glass-access)).
10. **Archive (G3).** The owner confirms the cutover; the `workspace`
    repository is archived read-only on Forgejo.

**Proposed (RM-13): the trial workspace becomes the production workspace;
there is no fresh start at migration.** Reason: task IDs are never reused and
appear in branch names and PRs (D-002); keeping the same workspace keeps those
references and the trial's history valid. At cutover:

- the viewer test account is removed or kept, as the owner chooses;
- trial labels stop being applied, and the label filter on the `workspace`
  repository's issues is removed together with that connection after G3;
- any facts copied as pointers under RM-6 are compared in step 5 like all
  others;
- trial findings still open stay as issues in `guneet-xyz/shinan`.

### 6.4 Coordination issues and the Project board

**Proposed (RM-14):**

| Item | At cutover | Reason |
|---|---|---|
| Open issues in the `workspace` repository (5 on 2026-11-16) | Each becomes a task with an `origin` work link to the issue (D-003), if the trial has not already done so. Then the issue is closed with a comment linking the task. | One home per piece of work after cutover; the issue keeps its discussion. |
| Issues labelled `human-effort` | The task gets the `needs a person` task flag, with the TL;DR summary as its explanation. | Same meaning; the glossary maps the label to this flag. |
| Closed issues and all PRs | Not imported. Stay on Forgejo. Linked from the `workspace` `project` entity. | D-001: no copies. Their lasting outcomes already live in the catalog. |
| Project board | Not migrated automatically: the Forgejo API has no Project endpoints (checked 2026-11-16). The owner reads its columns for the open issues at cutover, and Shinan's board takes over. | No supported way to read it; calculated status replaces the columns anyway (D-005). |
| New cross-project work | Starts as a Shinan task. The `workspace` repository's issue tracker gets a notice and is archived with the repository after G3. | Prevents new work landing in the old home. |

Closing the `workspace` repository's issues and archiving it ends a current
practice, so RM-14 and 6.6 are owner decisions.

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

**Open:** where the break-glass copy ([6.7](#67-rollback-and-break-glass-access))
is written. Re-using the `workspace` repository for it would confuse agents
whose instructions still mention it; [architecture](architecture.md)'s
optional Git export to a separate repository is the likely answer.

### 6.7 Rollback and break-glass access

**Proposed:**

- **During the 30-day rollback window**, Shinan exports the workspace daily.
  If the owner decides to roll back, the latest export is turned into a
  `workspace` repository PR, the freeze is lifted, and agent instructions are
  switched back. Reason: a rollback must not lose the work done since cutover.
  Thirty days covers four weekly releases and their rollouts.
- **Break-glass copy, permanently.** A read-only export of the catalog,
  including the runbooks needed to recover Shinan itself, is kept outside
  Shinan and readable without it, for example as a checkout of the export
  repository on each development machine. Reason: Shinan and Forgejo both run
  on Musashi. If Musashi is down, the runbooks to fix it must still be
  reachable. Today a local `workspace` repository checkout serves this
  purpose; the migration must not remove it without a replacement. Where and
  how often the copy is made belongs to [architecture](architecture.md).

## 7. Risks

| Risk | Effect | Mitigation | Status |
|---|---|---|---|
| Trial work overloads the owner | The owner stops judging; the trial stalls | One-hour weekly budget; agents prepare samples; batched catalog approval; relaxed catalog approval setting after two weeks if R6 is on track ([4.6](#46-running-the-trial)) | Proposed |
| Double maintenance tires agents | Shinan's trial catalog falls behind; R7 fails for the wrong reason | Small trial catalog (RM-6); Shinan reads issues instead of copying them (RM-7) | Proposed |
| Musashi is a single point of failure for Forgejo, mon and Shinan | Recovery information unreachable during an outage; uptime unmeasured | Break-glass copy (6.7); gaps count as downtime (R10); restore rehearsal | Proposed |
| Infrastructure details on a public web app (D-015) | Exposure of sensitive context | Minimal infrastructure in the trial; R11 must pass | Proposed |
| Agents do not follow conventions | Missing work links, poor attribution | Measured by R3 and R9; the trial note (RM-8); skill and plugin enforce what they can | Proposed |
| No real outside issues during the trial | The `triage` path is barely tested before migration | Known gap ([4.2](#42-candidates)); test issue from the viewer account | Proposed |
| Phase 2 features creep into phase 1 | Trial starts late | Cut line (3.2); review at each milestone | Proposed |
| The trial is too narrow to reveal problems | Migration finds them instead | Reserve projects; R14 rehearsal imports the whole `workspace` repository before cutover | Proposed |
| Shinan tracks its own development | A broken Shinan hides its own bugs | Trial findings are GitHub issues, readable without Shinan (4.4) | Proposed |

## Dependencies on other documents

| Document | What this roadmap needs from it |
|---|---|
| [Domain model and glossary](domain-model.md) | Terms; the owner's answers to its decisions 2 (agents setting `needs a person`), 4 (task ID prefix per workspace) and 5 (`awaiting deployment approval`), which affect the trial's handling of `human-effort` issues and rollouts and the task IDs used in branch names. |
| [Product overview](product-overview.md) | Its signs of success, which R7, R12 and R13 measure. |
| [Catalog](catalog.md) | Entity types and the import mapping (its section 13); fact unit and fact checks; catalog approval rules, including the relaxed setting (its decision 4) that keeps the owner's workload small. This document answers its question on automatic fact checks: phase 2a (3.2). |
| [Tasks and work](tasks.md) | Task ID and marker conventions; member-opened outside issues starting in `to do`; closing issues at cutover; the `needs a person` flag. |
| [Identity, agents and permissions](identity.md) | Sign-in and access protections for R11; the viewer role for the test account; attribution confidence for R9. |
| [Git host integrations](git-hosts.md) | Per-repository "do not import issues" and an import label filter (4.4); reconciliation guarantees for R2; the credentials the owner must create (3.4). |
| [Agent integrations](agent-integrations.md) | The OpenCode plugin and skill used in the trial; what agent sessions can report for R8 and R13; the `unresponsive` threshold; the policy content moved into the skill (6.5). |
| [Human experience](human-experience.md) | The wiki, start-here path, board and triage inbox required by R12 and R16. |
| [Architecture and operations](architecture.md) | Technology and storage (D-020); release process (RM-4); backups, restore, Git export and import (RM-2, R10, R15); the mon tile; the security checklist (R11); the break-glass copy (6.7). |
| [Decision log](decisions/) | Permanent IDs for RM-1 to RM-14 once accepted. |

## Decisions proposed in this document

| Label | Proposal | Section |
|---|---|---|
| RM-1 | Every phase gate is a recorded owner decision against stated criteria | [2](#2-phases) |
| RM-2 | First-version additions: backups, export, uptime monitoring, viewer test account, readiness report | [3.1](#31-in-scope) |
| RM-3 | Cut line; four milestones with a scope review at each; the trial starts at M2 | [3.2](#32-cut-line), [3.3](#33-build-milestones) |
| RM-4 | Weekly release train with one deployment approval per release | [3.4](#34-owner-actions-needed-in-phase-1) |
| RM-5 | Trial projects: Shinan, mon, easyshell; reserves Walls, guneet.dev plus Resume | [4.2](#42-candidates) |
| RM-6 | Small trial catalog, checked at owning sources; extra catalog proposals; disagreements kept as discrepancies | [4.3](#43-the-catalog-during-the-trial) |
| RM-7 | Intent stays on git hosts during phase 1; which items count as trial work | [4.4](#44-tasks-during-the-trial) |
| RM-8 | A trial note in the `workspace` repository; bootstrap unchanged during the trial | [4.5](#45-agents-in-the-trial) |
| RM-9 | Readiness judged by the owner; must-pass and judged criteria; owner budget of about an hour a week | [5](#5-readiness-criteria), [4.6](#46-running-the-trial) |
| RM-10 | Conditions that pause the trial | [4.6](#46-running-the-trial) |
| RM-11 | Migration principles | [6.1](#61-principles) |
| RM-12 | One cutover for the whole catalog after a rehearsal; freeze of at most two working days | [6.3](#63-cutover-steps) |
| RM-13 | The trial workspace becomes the production workspace, with listed clean-up | [6.3](#63-cutover-steps) |
| RM-14 | How open and closed coordination issues and the board are handled | [6.4](#64-coordination-issues-and-the-project-board) |

## Open questions

1. **Import filters.** Whether git host connections can skip issue import per
   repository and filter by label (4.4). Owned with
   [git host integrations](git-hosts.md).
2. **Measuring R13.** How the sample of agent sessions' context sources is
   gathered.
3. **Off-Musashi uptime probe.** Whether to add one later (R10).
4. **Break-glass copy location** (6.6, 6.7). Owned with
   [architecture](architecture.md).
5. **Reserve projects.** When Walls or guneet.dev plus Resume join, if the
   trial is short of tasks or a main candidate has to leave.
6. **Forgejo Project API.** If Forgejo ships Project endpoints before cutover,
   board state could be read automatically; re-check at the rehearsal.

## Decisions needed from the owner

The owner's recurring trial work under these recommendations is about one
hour a week ([4.6](#46-running-the-trial)).

| # | Decision | Recommended | Reason |
|---|---|---|---|
| 1 | Trial projects (RM-5) | Shinan, mon and easyshell; Walls and guneet.dev plus Resume in reserve | Both git hosts, multi-repository tasks, rollouts, volume and a "needs a person" case with the fewest projects. |
| 2 | How the trial catalog is filled, given "starts empty" (RM-6) | Agents check facts at owning sources, using `workspace` repository entries only as a map; copy only pointers | Avoids a second copy of the same facts (D-018) and tests checking (D-007). |
| 3 | Agents also make a catalog proposal in Shinan when they update a trial entity (RM-6, RM-8) | Yes | The only way to measure whether agents keep Shinan's catalog current (R7). |
| 4 | Coordination for trial projects stays in `workspace` repository issues, with a trial label and task IDs in branch names (RM-7, RM-8) | Yes | Keeps one source of truth and needs no copying. |
| 5 | Project work for mon and easyshell keeps repository issues in phase 1; Shinan's own work may use tasks without issues, with intent in the PR description (RM-7) | Yes | Intent never depends on unproven Shinan, and D-004 is still tested on one project. |
| 6 | First-version additions: backups, export, uptime monitoring, viewer test account, readiness report (RM-2) | Yes, with the cut line in 3.2 | They make the trial safe and measurable; the cut line keeps the start early. |
| 7 | Readiness: seven must-pass criteria plus judged ones; thresholds revisited after two trial weeks (RM-9) | Yes | Hard gates where safety needs them, judgment elsewhere. |
| 8 | Owner's trial workload capped at about one hour a week: agents prepare all samples, and the catalog's relaxed approval setting is switched on after two trial weeks if R6 is on track (RM-9) | Yes | One person must be able to sustain it for four weeks or more. |
| 9 | Board and triage inbox required before migration (R16) | Yes | They replace the Forgejo Project board and manual issue sorting in use today. |
| 10 | One rehearsed cutover with a freeze of at most two working days (RM-12) | Yes | The catalog is small and cross-linked; piecemeal moves create two homes. |
| 11 | Rollback window after cutover | 30 days | Covers four weekly releases without leaving the old repository half-alive. |
| 12 | After G3, close the `workspace` repository's issues and archive it read-only (RM-14, 6.6) | Yes | Keeps history linkable without confusing agents about which source is live. |
| 13 | Claude Code plugin timing | Phase 2a | The owner's agents use OpenCode; prove one plugin first. |
| 14 | Weekly release train for deployments to Musashi (RM-4) | Yes | Keeps D-016's approval for every deployment with fewer requests. |
