# Roadmap and migration

Status: **draft for review** ([issue #12](https://github.com/guneet-xyz/shinan/issues/12)).
Updated with the owner's answers in [issue #25][o].

This document owns Shinan's phases, the scope of the first version, the proof
of concept (which projects, how the trial runs and what counts as "ready"), and
how the `workspace` repository's catalog and cross-project coordination issues
move into Shinan. It answers plan question 8.

It uses the terms of the [domain model and glossary](domain-model.md) exactly.
Each statement is marked:

- **Decided**: follows from an accepted plan decision or approved plan content,
  which is cited. **Decided (owner, O-n, [#25][o])** means the owner answered
  item O-n in the decision checklist.
- **Proposed**: suggested here, with a reason. The owner confirms or changes it.
- **Open**: not settled; listed under [open questions](#open-questions).

Proposals that remain carry local labels (RM-1, RM-3, ...). The
[decision log](decisions/) maps the owner's answers to permanent IDs.

## Summary

- Shinan is built in phases with a gate between each one. The owner closes each
  gate with a recorded decision against stated criteria (proposed, RM-1).
- The first version is the plan's phase 1 feature set plus export, uptime
  monitoring, a viewer test account and a weekly readiness report, with a cut
  line for what can slip (decided, owner, O-75). **There are no built-in
  backups** (decided, owner, O-62 to O-64); this is an accepted risk that is
  reviewed again before migration.
- The proof of concept uses **Shinan**, **mon** and **easyshell** (decided,
  owner, O-70).
- During the trial the `workspace` repository stays the source of truth for
  its catalog and policies (D-018). **Cross-project coordination for the trial
  projects moves into Shinan** as tasks (decided, owner, O-73). mon and
  easyshell keep their repository issues (decided, owner, O-74).
- The trial catalog is built by checking owning sources, using `workspace`
  repository entries only as a map (decided, owner, O-71, O-72).
- Readiness is judged by the owner against criteria R1 to R16: seven must-pass,
  the rest judged (decided, owner, O-76). Agents prepare the samples, so the
  owner's recurring trial work is **under one hour a week** (decided, owner,
  O-77).
- Deployments to Musashi happen as needed, each with its own approval
  (decided, owner, O-83).
- After the owner judges Shinan ready, the `workspace` repository moves in one
  rehearsed cutover, with a 30-day rollback window, and is then archived
  (decided, owner, O-79 to O-81).

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
issues that need a person, with a TL;DR comment. Issue #50 carries it. Of the
open issues, #43 and #50 concern only easyshell, a trial project.

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

Forgejo, both mon boards and Shinan's planned deployment all run on Musashi
(Forgejo per the `workspace` repository's `forgejo` service entry; Shinan per
D-016). Fleet backups are paused, so Musashi's data disk is the only copy of
its applications' data (per [architecture](architecture.md), from the
`workspace` repository's `backups` service entry). This matters for
[measuring uptime](#5-readiness-criteria), [data loss](#7-risks) and
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
| 3. Agents run by Shinan | A launcher that a person installs on hardware they own, which registers it; agent sessions started from the website run OpenCode there. A setup guide for such a device (for example a virtual machine or a MacBook) | Optional | Owner decides whether to start phase 3 at all, after G3 |

**Phase 3** is optional (decided, plan section 10). Its shape follows the
owner's answer that anything a person wants done on a git host is done by an
agent on that person's own, already authenticated hardware (decided, owner,
O-1, [#25][o]).

**RM-1 (proposed): every gate is an owner decision against stated criteria,
recorded in [`docs/decisions/`](decisions/).** Reason: D-018 says Shinan
moves over "when judged ready", which is a judgment; stating what is judged
keeps it from being a guess, and recording it keeps the reasons visible.

| Gate | Criteria |
|---|---|
| G1 | Two weeks after M4 is deployed: no [pause condition](#46-running-the-trial) is active, and R2, R5 and R11 are met. The owner wants to continue. |
| G2 | All must-pass criteria met and the judged criteria reviewed ([section 5](#5-readiness-criteria)). The owner has reviewed the [backup risk](#backups-before-migration) again. |
| G3 | The 30-day rollback window has ended without a rollback ([section 6.7](#67-rollback-and-break-glass-access)). |

At each phase boundary (G1, and the decision on phase 3 after G3) the
competitor survey in the [product overview](product-overview.md) is rechecked
through a pull request (decided, owner, O-90, [#25][o]).

Not on the roadmap:

| Item | Status | Reason |
|---|---|---|
| GitLab | Proposed: after G3, only if a real project needs it | D-009 starts with the hosts in use; no current project is on GitLab. |
| Integrations with outside trackers (Multica, Linear, Plane) | **Decided (owner, O-97, [#25][o]):** none planned; D-010 is amended; revisit only if a real need appears | The owner dropped them. |
| A local trial of self-hosted Multica before phase 2 board work | **Decided (owner, O-88, [#25][o]):** skipped | The owner chose not to run it. |
| Business model, licensing, pricing | Decided: deferred (D-013) | No evidence of outside demand yet. |
| Running models in Shinan | Decided: not in phases 1 and 2 (D-008) | Agents connect from outside. |

## 3. First version scope

### 3.1 In scope

| Capability | Status | Reason |
|---|---|---|
| Catalog, wiki and agent index | Decided (plan, phase 1; D-006, D-007) | Core pillar. |
| Read-only Git mirror of the catalog, always kept current | Decided (owner, O-11, [#25][o]) | Readable files for cloning, searching, history and exit. |
| Tasks with task IDs, subtasks, work links, calculated task status, task flags and manual states | Decided (plan, phase 1; D-002, D-005; owner, O-21 for subtasks, O-8 for flags) | Core pillar. |
| GitHub and Forgejo git host connections: webhooks, API reads, reconciliation | Decided (plan, phase 1; D-009) | The trial projects live on both. |
| Outside issues become tasks | Decided (D-003) | A simple list of `triage` tasks is enough; the full triage inbox is phase 2 (plan). |
| Timeline | Decided (plan, phase 1) | Core pillar. |
| MCP server and skill | Decided (plan, phase 1; D-014 level 1) | How agents act. |
| CLI | Decided as part of level 1 (plan, integration points) | On the cut line ([3.2](#32-cut-line)). |
| OpenCode plugin for presence | Decided (plan, phase 1; D-014 level 2) | How Shinan knows which agent sessions run. Installing it also sets up MCP and the skill (decided, owner, O-36). |
| Sign-in, one workspace, members and roles | Decided (D-015, D-019). Methods: GitHub, Forgejo, email magic link and password (decided, owner, O-41) | Magic links mean Shinan sends email from the first version. |
| Deployment at `shinan.guneet.dev` on Musashi | Decided (D-011, D-016) | First deployment target. |
| Full export of a workspace (catalog, tasks and their records) and import back | Decided (owner, O-75, [#25][o]) | Needed for the rollback (R15). The Git mirror covers the catalog; export adds tasks and the rest. |
| Uptime monitoring of `shinan.guneet.dev` | Decided (owner, O-75) | R10 needs a measurement. [Architecture](architecture.md) proposes a tile on the private mon board. |
| A viewer test account | Decided (owner, O-75) | Tests the viewer role and sign-in limits before a second person joins (R11). |
| Weekly readiness report | Decided (owner, O-75) | Readiness is judged on evidence gathered during the trial. A script is enough. |
| Built-in backups | **Not included.** Decided (owner, O-62 to O-64, [#25][o]) | Shinan relies on host-level backups, which are currently paused on Musashi. Accepted risk; see [backups before migration](#backups-before-migration). |

### 3.2 Cut line

**Decided (owner, O-75, [#25][o]):** these can slip past the start of the
trial without blocking it. Reason: the owner is one person and the trial
should start as soon as the core is usable.

| Can slip | Until | Why it can wait |
|---|---|---|
| CLI | G2 | MCP and the skill cover the trial's agent actions. |
| Export | G2 | Needed for the rollback (R15), not for the trial. The Git mirror covers the catalog meanwhile. |
| Automatic fact checks through git host connections | Phase 2a | Asked by the [catalog](catalog.md) (12.3). Useful but not needed to test whether agents keep the catalog current. |

These must **not** slip: sign-in, uptime monitoring, the viewer test account,
and everything decided for phase 1 except the CLI.

**The viewer test account needs two things the [identity](identity.md) draft
builds only "before a second member joins"** (its section 13, accepted as
O-49): viewer role enforcement, and an invitation, because joining a
workspace needs one (decided, owner, O-48). **Proposed:** bring a minimal
invitation and viewer enforcement into M1. Reason: O-75 makes the viewer test
account part of the first version, and it is the only way to test the access
rules before a real second member. This is a
[decision for the owner](#decisions-needed-from-the-owner).

### 3.3 Build milestones

**Proposed (RM-3):** phase 1a is built in four milestones, each deployed
before the next starts. The trial starts at milestone 2 for the catalog and
widens at milestones 3 and 4. After each milestone the owner and the building
agents review scope against the cut line. Reason: catalog feedback can start
early, the risk is low because the `workspace` repository stays the source of
truth for the catalog, and a review at each milestone stops scope creep.

| Milestone | Contents | Trial use it unlocks |
|---|---|---|
| M1. Empty installation | Sign-in, email sending, one workspace, members and roles, viewer test account, deployment on Musashi, uptime monitoring | None; security checks |
| M2. Catalog | Catalog entities, facts with provenance, catalog proposals and catalog approval, wiki, agent index, Git mirror, MCP read and propose, skill | Catalog part of the trial |
| M3. Tasks and git hosts | Tasks and subtasks, work links, calculated status, GitHub and Forgejo git host connections, reconciliation, outside issues become tasks, timeline, readiness report | Task part of the trial, including cross-project coordination |
| M4. Presence | OpenCode plugin: agent sessions, presence, attaching an agent session to a task | Presence part of the trial; trial fully running |

The technology, storage and the order inside each milestone belong to
[architecture and operations](architecture.md) (D-020; TypeScript, a plain
Node.js server and a React single-page app, decided, owner, O-60, O-61).

### 3.4 Owner actions needed in phase 1

These need the owner because they involve deployment approval (D-016, and the
`workspace` repository's access policy) or credentials (the same policy, which
stays in force until migration under D-018). Exact steps belong to
[architecture](architecture.md), [identity](identity.md) and
[git host integrations](git-hosts.md).

- **Approve each deployment to Musashi** when it is ready (decided, owner,
  O-83, [#25][o]: deploy as needed, each deployment with its own approval).
  This includes the DNS record for `shinan.guneet.dev` and the mon tile in
  `infra/musashi`.
- **Connect the git hosts:** install the private GitHub App owned by
  `guneet-xyz` (decided, owner, O-51, O-52) and give Shinan a Forgejo token
  from the owner's own account (decided, owner, O-53, O-54). People type
  secrets; agents never handle them.
- **Email:** provide the sending credential Shinan uses for magic links
  (O-41). Where it comes from belongs to [architecture](architecture.md).
- **Agents:** install the OpenCode plugin on each machine used for the trial.
  Each person, coding tool and machine is one agent (decided, owner, O-40).

## 4. Proof of concept

### 4.1 How projects were chosen

A good trial project (proposed):

1. has steady agent-driven work, so the trial produces enough tasks;
2. spans GitHub and Forgejo, or several repositories, so cross-host tasks are
   tested (D-001, D-009);
3. touches several catalog entity types (project, machine, service);
4. includes hard cases: deployment approval and work that needs a person;
5. is low-risk if Shinan misbehaves. Shinan's own writes to git hosts are
   limited to links (O-1, O-56), so the main risk is confusion, not damage.

### 4.2 Trial projects

**Decided (owner, O-70, [#25][o]):** the trial projects are Shinan, mon and
easyshell, with Walls and guneet.dev plus Resume in reserve. Reason: together
they cover both git hosts, multi-repository tasks, deployment approvals, high
volume and work that needs a person, while keeping the most sensitive
infrastructure as read-only context.

| Project | What it tests |
|---|---|
| **Shinan** (`guneet-xyz/shinan`, GitHub, private) | Daily use by the owner and agents; a private repository; Shinan used on its own development. Its GitHub issues and PRs remain if Shinan breaks. |
| **mon** (`guneet-xyz/mon` on GitHub; `infra/musashi`, `infra/anzen`, `guneet/terraform` on Forgejo) | Tasks whose work spans both hosts and four repositories; two machines; several services (ingress, Obscuro, container registry, DNS); deployment approvals (9 rollout issues in `infra/musashi`). |
| **easyshell** (`guneet-xyz/easyshell` on GitHub; `infra/musashi` on Forgejo) | High volume (79 issues and 22 PRs created since 2026-11-01); work that needs a person (#50); releases through Dockyard rolled out on Forgejo. |
| Walls (reserve) | A second GitHub organisation (`cranklabs`) and frequent cross-host releases. Adding it needs the GitHub App to cover `cranklabs`, which a private app owned by `guneet-xyz` cannot (per [git host integrations](git-hosts.md)); see [open questions](#open-questions). |
| guneet.dev and Resume (reserve) | A task across two repositories on one host; a merge that publishes (Resume). Both in `guneet-xyz`, so no app change. |

Not in the trial: Dockyard, Drawspace and Obscuro (overlap or low activity);
Daedalus and Scripts (low activity; Daedalus appears as a `machine` entity
because agent sessions run there); Takezo and Jobfinder (retired, or unknown
owner and stopped). Musashi, Anzen, Terraform and Ansible are not trial
projects: `infra/musashi`, `infra/anzen` and `guneet/terraform` are connected
so work links resolve ([4.4](#44-tasks-during-the-trial)), and their `machine`
and `service` entities are added only as far as trial projects need them. The
`workspace` repository is not a trial project (D-018).

**Outside issues (D-003) in the trial.** None of the trial projects gets real
outside issues today: easyshell's only one is closed and dates from
2025-03-10. Issues opened by the owner or the owner's agents are outside
issues opened by a member, so under [tasks and work](tasks.md) they start in
`to do`, not `triage`. The `triage` path is tested only if a real outside
issue arrives, or by a test issue from a git host account that is not linked
to a member. This is a known gap (proposed; reason: inventing outside traffic
would not show anything real).

### 4.3 The catalog during the trial

**Decided (D-018):** Shinan starts empty, and the `workspace` repository
stays the source of truth for the catalog until Shinan is judged ready.

**Decided (owner, O-71, O-72, [#25][o]):**

- The trial uses one Shinan workspace, called the **trial workspace** here.
  It holds only the catalog entities the trial projects need: the three
  `project` entities; `machine` entities for Musashi, Anzen and Daedalus; and
  the `service` entities those projects depend on (ingress, container
  registry, Cloudflare DNS, Obscuro, email, Forgejo, monitoring). Reason: a
  small catalog keeps the extra work small.
- **Entries are a map, not a source.** Agents use each `workspace` repository
  entry to find owning sources, check each fact there, and record the owning
  source with a real check time. Only pure pointers, such as repository URLs
  and IDs, may be copied with the entry (at its Git revision) as their source.
  A fact that cannot be checked is recorded as `unknown`. Reason: copying facts
  would create two copies of the same facts, against D-018's reason; checking
  follows D-007 and tests what R6 measures.
- **Keeping it current.** When a trial entity's facts change, the agent doing
  the work updates the `workspace` repository as today and also makes a
  catalog proposal in Shinan. A weekly comparison reports differences.

**Proposed:**

- **Disagreements.** During the trial, agents act on the `workspace`
  repository's version. A disagreement is recorded in Shinan as a discrepancy
  (glossary) and as a trial finding, and is then fixed wherever the evidence
  shows the error, which may be a `workspace` repository PR. Reason:
  overwriting a fresher observation with an older entry would hide real drift.
- **Secrets.** Secrets never go in the catalog; it records only where a secret
  lives, for example an Obscuro namespace (decided, owner, O-2). There is no
  restricted level, and every member sees everything (decided, owner, O-2,
  O-43). The trial catalog therefore holds only what the `workspace`
  repository already holds, which by its policy contains no secrets.

**Catalog approval.** Only high-risk (gated) changes need catalog approval,
from the start of the trial; if accuracy (R6) slips, the workspace switches
to approving everything (decided, owner, O-3, [#25][o]). The owner may approve
their own agents' catalog proposals (decided, owner, O-46).

### 4.4 Tasks during the trial

**Decided (owner, O-73, O-74, [#25][o]):** cross-project coordination for the
trial projects moves into Shinan during the trial, as tasks, instead of issues
in the `workspace` repository. mon and easyshell keep their repository issues
for project work, and Shinan's own work may use tasks without repository
issues, with the intent in the PR description. This is the owner's exception
to D-018 for trial coordination; the `workspace` repository stays the source
of truth for everything else.

| Work | Where intent lives during the trial | How Shinan sees it |
|---|---|---|
| Cross-project coordination for a trial project | A task in Shinan (O-73). No issue in the `workspace` repository | Native task. Agents put its task ID in branch names and PR descriptions. |
| Work inside mon and easyshell | The project's own repository issue, as today (O-74) | Read as an outside issue opened by a member; becomes a task in `to do`. |
| Work inside Shinan | A GitHub issue, or a task in Shinan with the intent and acceptance criteria in the PR description (O-74) | Outside issue or native task. The native option tests D-004. |
| Trial findings (bugs, gaps, friction) | Issues in `guneet-xyz/shinan`, with a trial label (proposed) | Outside issues on the Shinan project. Reason: findings must be recordable even when Shinan is down. |
| Everything else | Unchanged | Not seen. |

**Proposed: moving existing coordination at trial start.** Open issues in the
`workspace` repository that concern only trial projects (#43 and #50 on
2026-11-16) are imported as tasks on request (existing issues are imported
only when a person asks, decided, owner, O-23). An agent then closes each
issue with a comment linking its task (git host writes a person wants are done
by an agent on their hardware, O-1). Issue #50's task gets the `needs a
person` flag with the TL;DR summary. Issues that also concern other projects,
such as #71, stay in the `workspace` repository until migration. Reason: one
home per piece of work, as O-73 intends, without moving work that is not part
of the trial.

**Proposed: which items in shared repositories count as trial work.**
`infra/musashi`, `infra/anzen` and `guneet/terraform` also carry other
projects' work. In them, a work item belongs to the trial if it names a trial
task ID, or changes a trial project's part of the repository (for example
`stacks/mon-private`, `stacks/mon-public` and `stacks/easyshell` in
`infra/musashi`, `stacks/mon-agent` in `infra/anzen`, and the mon and
easyshell DNS records in `guneet/terraform`). New issues in these
repositories, and in the `workspace` repository if it is connected, do not
become tasks. Reason: otherwise every unrelated rollout and coordination
issue would become a task. Depends on [git host integrations](git-hosts.md)
supporting a per-repository "do not import issues" setting; if it cannot,
connect these repositories anyway and cancel unrelated tasks in bulk.

**Proposed:** if Shinan is down, agents carry on with the git-host-only
workflow: task ID in the branch name and PR description, no other change.
Reconciliation links the work afterwards. Reason: the trial must never block
real work.

**Task conventions in the trial** follow the owner's answers: each workspace
has its own task ID prefix (O-6); agents may set and clear `needs a person`
with a summary (O-7); rollouts waiting for approval get the separate
`awaiting deployment approval` flag, and a workspace can add or remove flags
(O-8); large work is split into subtasks (O-21); a member mentioning a task ID
in a git host comment creates a `related` link (O-25). All decided by the
owner in [#25][o]; details are in [tasks and work](tasks.md).

### 4.5 Agents in the trial

**Decided (owner, O-72, O-73, O-38, [#25][o]):** agents follow a short trial
note, added to the `workspace` repository through its normal PR workflow at
trial start. For trial projects only, it tells agents:

- to connect to Shinan (plugin, which sets up the MCP server and skill) and
  check in; the skill and MCP server are enabled for trial projects only
  (O-38);
- that cross-project coordination for trial projects is a task in Shinan, not
  an issue in the `workspace` repository (O-73), and how to put its task ID in
  branch names and PR descriptions;
- to make a catalog proposal in Shinan whenever they update a trial entity in
  the `workspace` repository (O-72);
- to fall back to the git-host-only workflow if Shinan is down.

**Proposed:** the global OpenCode instructions are not changed during the
trial. Reason: agents find their general context through the `workspace`
repository, which stays the source of truth for it until G2. The note is a
follow-up for phase 1b; this document does not edit that repository.

The conventions agents follow (markers, check-ins, attaching an agent session,
subagents as their own agent sessions under O-37) belong to
[agent integrations](agent-integrations.md) and [tasks and work](tasks.md).

### 4.6 Running the trial

**Proposed:**

- **Length:** at least four weeks with M4 deployed (see R1). Reason: four
  weeks covers several release and rollout cycles in each trial project and
  is long enough for freshness drift to show.
- **Weekly readiness report,** produced by a script or by Shinan itself
  (decided, owner, O-75). Agents prepare every sample (R3, R4, R6, R13) and
  check it first; the owner spot-checks 10 items in total each week (decided,
  owner, O-77).
- **Weekly record of open trial tasks.** The report also lists every open task
  that has no repository issue (coordination tasks under O-73 and Shinan's own
  tasks without issues under O-74), with its intent and acceptance criteria,
  and is posted as a comment on a trial issue in `guneet-xyz/shinan`. Reason:
  with no backups (O-62), that intent would otherwise exist only in Shinan's
  database; a weekly record outside Shinan limits what a data loss can take.
  This is a [decision for the owner](#decisions-needed-from-the-owner).

**Owner's recurring trial work: under one hour a week** (decided as a cap,
owner, O-77). Estimates; the report tracks the real time so it can be cut if
it grows.

| Task | How often | Estimated time | Notes |
|---|---|---|---|
| Deployment approvals | As deployments are ready (O-83) | 10–15 minutes a week | A few deployments a week during active building, a few minutes each. |
| Catalog approval of gated catalog proposals | As they come, or in one batch | 5 minutes | Only high-risk classes need approval (O-3), such as rules, lifecycle and people. Routine fact changes apply on their own. |
| Spot-check 10 items from agent-prepared samples | Weekly | 15 minutes | Covers R3, R4, R6 and R13. |
| The R12 questions | Weekly | 10 minutes | |
| Reading the readiness report | Weekly | 5 minutes | |
| Accepting `triage` tasks | As they come | Near zero | Issues from the owner's account start in `to do` ([4.2](#42-trial-projects)). |

Working on coordination tasks in Shinan instead of issues replaces existing
work rather than adding to it. One-off owner work: the actions in 3.4, gates
G1 to G3, and the spot-check after the migration rehearsal.

**Proposed (RM-10): pause the trial and fall back to the git-host-only
workflow if any of these happen:**

- a credential or other secret is exposed through Shinan;
- data is lost;
- Shinan blocks agents' real work for more than one working day;
- an access rule fails, for example someone not on the email allowlist (O-48)
  can sign in, or the viewer test account can change something.

On a pause, open coordination tasks are recreated as issues in the
`workspace` repository by an agent, from Shinan if it is readable or from the
last weekly record if it is not. Reason: the `workspace` repository holds the
catalog, and mon and easyshell keep their issues, so pausing loses only
Shinan's own records plus whatever changed since the last weekly record.
Resuming is an owner decision after the cause is fixed.

## 5. Readiness criteria

**Decided (owner, O-76, [#25][o]):** the owner judges readiness (G2) from the
readiness report. Criteria are of two kinds:

- **Must-pass:** without these, migration is unsafe. They are R2, R3, R5, R10,
  R11, R14 and R15, plus R16 (decided, owner, O-78).
- **Judged:** the owner weighs these and may accept Shinan with documented
  exceptions.

The thresholds are revisited after two trial weeks. Reason: thresholds set
before real use are guesses; hard gates where safety needs them, judgment
elsewhere.

Two scopes are used:

- **Connected repositories:** every repository the trial workspace's git host
  connections cover.
- **Trial work items:** work items in the trial projects' own repositories,
  plus work items in shared repositories that belong to the trial as defined
  in [4.4](#44-tasks-during-the-trial).

| ID | Kind | Criterion | Measure and proposed threshold | Reason |
|---|---|---|---|---|
| R1 | Judged | Trial size | At least 4 weeks with M4 deployed; at least 40 tasks, not counting subtasks, reach `done` or `cancelled`; at least 10 of them have `delivers` work links on both GitHub and Forgejo. If short, extend by up to two weeks, then add a reserve project | The three trial projects created 54 PRs between 2026-11-01 and 2026-11-16, and mon and easyshell have had 14 rollout issues in `infra/musashi`, so this is reachable. |
| R2 | Must-pass | Event capture | Every issue, PR, merge and review in connected repositories during the trial appears in Shinan within 24 hours (100%); at least 95% within 5 minutes. Checked by comparing git host API listings with Shinan | Missed events silently corrupt calculated status (D-005); reconciliation must close every gap. |
| R3 | Must-pass | Work link coverage | At least 95% of merged PRs among trial work items have a `delivers` work link; no wrong link in an agent-prepared sample of 30 | Tasks are only useful if work reaches them (D-002). |
| R4 | Judged | Calculated status | In weekly agent-prepared samples of 20 tasks, task status matches reality at least 95% of the time; no task status needed a hand edit outside manual states | Tests D-005 on real work. |
| R5 | Must-pass | Provenance | 100% of facts in the trial workspace have a fact state, a source and a last-checked time (or an explicit `unknown`) | D-007; should be enforced, so anything less is a defect. |
| R6 | Judged | Catalog accuracy | In an agent-prepared sample of 30 facts rechecked against owning sources, at least 95% are correct or correctly shown as stale or `unknown`; every error explained | Trust is the main differentiator (D-007). It also decides whether catalog approval switches to strict (O-3). |
| R7 | Judged | Catalog kept current | At least 90% of `workspace` repository changes to trial entities have a matching catalog proposal in Shinan, made within two days. Also counted: stale or `unknown` facts that agents fixed as a side effect of task work | Measures whether agents maintain the catalog. The side-effect count matches the [product overview](product-overview.md)'s second sign of success. |
| R8 | Judged | Presence | At least 90% of OpenCode agent sessions working on trial tasks, subagents included (O-37), are `plugin-reported` and attached to the right task; presence states follow the rules in [agent integrations](agent-integrations.md) | Tests D-014 level 2. |
| R9 | Judged | Attribution | At least 90% of agent-made events on trial work items have attribution confidence `recorded` or `marked` | D-017 is a known limitation; this measures how well Shinan designs around it. |
| R10 | Must-pass | Reliability | Availability of at least 99% over the last four trial weeks; no data loss incident | Shinan will hold the runbooks used to recover everything else. See the note on measuring uptime below. Restore tests are not a gate (no backups, O-62). |
| R11 | Must-pass | Security | Sign-in protections from [identity](identity.md) and the security checklist from [architecture](architecture.md) in place, with no open high-severity finding; only allowlisted emails can create accounts (O-48); the viewer test account can read but not change anything; a secret scan of all catalog content and events finds nothing | D-015: a public app holding infrastructure details. |
| R12 | Judged | Useful to the owner | For the last three weekly checks, the owner answers from Shinan alone: what is in progress across the trial projects; which tasks need a person; which agent sessions are running and on what; where and how a trial project is deployed; what happened on a given task this week. Zero recorded fall-backs in the last two weeks | The point of Shinan is that people can follow the work. |
| R13 | Judged | Useful to agents | In an agent-prepared sample of 20 agent sessions on trial projects, at least 18 took their project-specific context (locations, deployment, owning sources) from Shinan's MCP server or skill rather than from `workspace` repository entries | Agents still read the `workspace` repository's general instructions, because the bootstrap is unchanged during the trial. |
| R14 | Must-pass | Migration rehearsal | A full import of the `workspace` repository into a rehearsal workspace ([section 6.3](#63-cutover-steps)) succeeds: every entry imported, no broken links, all verification fields preserved, owner spot-checks 10 entities. The rehearsal runs on a temporary local-only installation on Daedalus, set up from Shinan's own documentation | The migration must be boring by the time it is real. Setting up from the documentation also proves self-hosting (D-012). Daedalus follows the owner's choice for temporary test installations (O-65). |
| R15 | Must-pass | Exit path | A full export of the trial workspace, imported into an empty workspace, produces the same catalog content and tasks | The rollback depends on it. |
| R16 | Must-pass | Phase 2 features needed for migration | The board and the triage inbox are deployed and used during the trial (decided, owner, O-78) | They replace the Forgejo Project board and the manual sorting of incoming issues. Nudges and notifications are new abilities, not replacements, so they are not prerequisites. |

**Measuring uptime (R10).** Both mon boards run on Musashi, like Shinan, so an
outage of Musashi stops both Shinan and the record of it. **Proposed:** any
gap in mon's data for `shinan.guneet.dev` counts as downtime. Reason: it errs
on the safe side and needs no new service. An off-Musashi probe is **open**.

### Backups before migration

**Decided (owner, O-62 to O-64, [#25][o]):** Shinan has no built-in backups,
backup target or recovery objectives for now. It relies on host-level backups,
which are paused on Musashi. This is an accepted risk.

During the trial the risk is limited: the `workspace` repository holds the
catalog, the Git mirror holds a copy of Shinan's catalog, and the weekly
record (4.6) holds open trial tasks. **At migration Shinan becomes the only
copy** of tasks, events, agent session history and catalog proposals; only the
catalog's Markdown also survives in the Git mirror.

**Proposed:** before G2 the owner reviews this risk again with the readiness
report, and either confirms it or turns on backups (host-level or built-in)
before the cutover. It is a review item at G2, not a must-pass criterion,
because the owner has already accepted the risk for now. Reason: the owner
asked for it to be noted as a consideration before migration.

## 6. Migrating the `workspace` repository

### 6.1 Principles

**Proposed (RM-11):**

1. **One home per fact at every moment.** Before cutover the `workspace`
   repository owns everything it owns today, except trial coordination (O-73);
   after cutover Shinan does. There is no period where both are editable.
   Reason: D-018 avoids two sources of truth.
2. **Preserve provenance.** Imported facts keep their recorded check dates,
   scopes and sources. Import is not a check. Reason: D-007 and the
   `workspace` repository's own rule that dates refer to actual checks.
3. **Link, do not copy, history.** Closed issues, PRs and the changelog stay
   on Forgejo and in the archived repository. Reason: D-001 and plan section 3;
   reusable outcomes from them are already in the catalog, runbooks and
   decisions.
4. **Rehearse first.** The real cutover repeats a rehearsal that already
   passed (R14).

### 6.2 What moves where

The detailed field mapping is the [catalog](catalog.md)'s (its section 13).
Agent conventions belong to [agent integrations](agent-integrations.md) and
[tasks and work](tasks.md). This table is the migration's view (proposed,
except where marked).

| `workspace` repository part | Destination in Shinan | Notes |
|---|---|---|
| `catalog/projects/*`, `catalog/machines/*`, `catalog/services/*` | `project`, `machine` and `service` entities | Includes machine guidance agents rely on, such as Daedalus's storage and worktree locations. |
| `runbooks/*`, `decisions/*` | `runbook` and `decision` entities | |
| `docs/access-and-safety.md`, `docs/maintenance.md`, the policy parts of `docs/collaboration.md` | `policy` entities | For example the deployment-only approval rule and the update obligation. |
| `README.md` "Start here", `AGENTS.md`, `docs/agent-entrypoint.md` | The start-here document (decided, owner, O-18) and Shinan's skill | |
| `docs/forgejo-setup.md` | The `forgejo` `service` entity, a `runbook`, or a custom type (custom types allowed, decided, owner, O-17) | Decided by the [catalog](catalog.md). |
| Frontmatter `id`, `status`, `owner` | Entity ID written `<type>/<slug>`, with the old ID kept as an alias (decided, owner, O-15); entity status; entity owner | Old links and references keep resolving. |
| Frontmatter `last_verified`, `verification_scope`, `verification_source` | Fact checks: the entry's check date is kept only where its scope covers the fact, otherwise "not checked"; `by: unknown`; the importer is recorded on the catalog proposal (decided, owner, O-14) | Import never refreshes a check date. |
| Relative Markdown links between entries | Links between entities | Broken links block the import (R14). |
| `templates/*`, `scripts/check.py`, tests | Replaced by Shinan's type schemas and validation | Not imported. |
| `.opencode/skills/*`, `docs/skills.md` | Replaced by Shinan's skill | Not imported. |
| `integrations/opencode/*` and each machine's global OpenCode instructions | Replaced by instructions pointing at Shinan | See [6.5](#65-switching-agents-over). |
| `CHANGELOG.md`, Git history | Stay in the archived repository | Linked from the `workspace` `project` entity. |
| Forgejo issues, PRs, Project board | See [6.4](#64-coordination-issues-and-the-project-board) | |

### 6.3 Cutover steps

**Decided (owner, O-79, [#25][o]): one rehearsed cutover for the whole
catalog, with a freeze of at most two working days.** Reason: the catalog is
small (32 catalog entries, 3 runbooks, 3 decisions and 6 policy and guide
documents) and heavily cross-linked; moving it in pieces would create links
that cross between two homes.

1. **Readiness decision (G2),** recorded with the readiness report, including
   the [backup review](#backups-before-migration).
2. **Rehearsal** on the temporary installation (R14). Import the `workspace`
   repository at a named revision and produce an import report: entries per
   type, links resolved, verification fields preserved, items that could not
   be mapped. Fix gaps and repeat until clean.
3. **Freeze.** A `workspace` repository PR marks the catalog, runbooks,
   decisions and policies as frozen. Open catalog PRs are merged or closed
   first. If steps 4 to 7 are not done within two working days, the freeze is
   lifted and the cutover rescheduled.
4. **Import** at the frozen revision into the trial workspace (RM-13).
5. **Compare and resolve trial entities.** For entities that exist in both,
   compare fact by fact. Agreeing facts keep the better provenance (usually
   the trial's check against the owning source). Disagreeing facts are
   resolved from evidence and check time, not from which side was written
   last; where neither side can be shown right, both are kept as a
   discrepancy. Reason: the `workspace` repository's rule for competing claims
   and the glossary's discrepancy rule.
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

**Proposed (RM-13): the trial workspace becomes the production workspace.**
Reason: task IDs are never reused and appear in branch names and PRs (D-002);
keeping the same workspace keeps those references and the trial's history
valid. At cutover:

- the viewer test account is removed or kept, as the owner chooses;
- the per-repository "do not import issues" setting is removed where
  repositories become fully covered;
- pointers copied under O-71 are compared in step 5 like all other facts;
- trial findings still open stay as issues in `guneet-xyz/shinan`, and the
  weekly record of open trial tasks stops.

### 6.4 Coordination issues and the Project board

**Decided (owner, O-81, [#25][o]):** after G3 the `workspace` repository's
issues are closed and the repository is archived read-only. The rest of the
table is proposed.

| Item | At cutover | Reason |
|---|---|---|
| Open issues in the `workspace` repository (5 on 2026-11-16; #43 and #50 move earlier, at trial start) | Each is imported as a task with an `origin` work link (O-23). An agent then closes the issue with a comment linking the task (O-1). | One home per piece of work; the issue keeps its discussion. |
| Issues labelled `human-effort` | The task gets the `needs a person` flag, with the TL;DR summary as its explanation. | Same meaning; the glossary maps the label to this flag. |
| Closed issues and all PRs | Not imported. Stay on Forgejo, linked from the `workspace` `project` entity. | D-001: no copies. Their lasting outcomes already live in the catalog. |
| Project board | Not migrated automatically: the Forgejo API has no Project endpoints (checked 2026-11-16). The owner reads its columns for the open issues, and Shinan's board takes over (R16). | No supported way to read it; calculated status replaces the columns anyway (D-005). |
| New cross-project work | Starts as a Shinan task. The issue tracker gets a notice and is archived with the repository. | Prevents new work landing in the old home. |

### 6.5 Switching agents over

**Proposed:**

- Every machine's global OpenCode instructions are updated to point at
  Shinan. Under the `workspace` repository's current policy, updating local
  agent instructions needs no extra approval. Reason: agents must stop reading
  a frozen source on day one.
- The four `workspace-*` skills are replaced by Shinan's skill. The old skills
  stay in the archived repository but are no longer registered.
- The rules agents follow today (standing authority for routine work,
  deployment-only approval, `needs a person` instead of `human-effort`, task
  IDs in branches) become `policy` entities and parts of Shinan's skill, owned
  by [agent integrations](agent-integrations.md) and
  [tasks and work](tasks.md). Reason: they are what makes agent work safe today.

### 6.6 What is left of the `workspace` repository

**Decided (owner, O-81):** after G3 it is archived read-only. **Proposed:**
its README points to Shinan; it keeps its Git history, changelog, issues and
PRs as the record of how work was done before Shinan.

### 6.7 Rollback and break-glass access

**Decided (owner, O-80, [#25][o]):** a 30-day rollback window after cutover.

**Proposed:**

- **Rollback.** If the owner decides to roll back during the window, the
  catalog is taken from the Git mirror (O-11) into a `workspace` repository
  PR, open tasks are exported and recreated as issues there by an agent, the
  freeze is lifted, and agent instructions are switched back. Reason: a
  rollback must not lose the work done since cutover.
- **Break-glass copy, permanently.** A checkout of the read-only Git mirror is
  kept on each development machine and stays readable without Shinan. Reason:
  Shinan, Forgejo and mon all run on Musashi; if Musashi is down, the runbooks
  to fix it must still be reachable. Today a local `workspace` repository
  checkout serves this purpose; the migration must not remove it without this
  replacement. Where the mirror is hosted belongs to
  [architecture](architecture.md) (**open**; a host off Musashi would avoid
  depending on Forgejo).

## 7. Risks

| Risk | Effect | Mitigation | Status |
|---|---|---|---|
| No built-in backups, and host backups on Musashi are paused | Data loss in Shinan is unrecoverable; after migration it would lose tasks and their history | Accepted risk (owner, O-62 to O-64). During the trial: the `workspace` repository, the Git mirror and the weekly record of open trial tasks. Before migration: the [backup review](#backups-before-migration) at G2 | Decided (accepted risk); mitigations proposed |
| Coordination intent for trial projects lives only in Shinan (O-73) | A data loss or pause loses open coordination tasks | Weekly record outside Shinan (4.6); recreate as issues on a pause | Proposed |
| Trial work overloads the owner | The owner stops judging; the trial stalls | Under one hour a week (O-77); agents prepare samples; only gated catalog changes need approval (O-3) | Decided |
| Double maintenance tires agents | Shinan's trial catalog falls behind; R7 fails for the wrong reason | Small trial catalog (O-71) | Decided |
| Musashi is a single point of failure for Forgejo, mon and Shinan | Recovery information unreachable during an outage; uptime unmeasured | Break-glass copy (6.7); gaps count as downtime (R10) | Proposed |
| Infrastructure details on a public web app, with no restricted level (D-015, O-2) | Exposure of sensitive context | No secrets in the catalog (O-2); email allowlist (O-48); R11 must pass | Decided; R11 proposed |
| Agents do not follow conventions | Missing work links, poor attribution | Measured by R3 and R9; the trial note; skill and plugin enforce what they can | Proposed |
| No real outside issues during the trial | The `triage` path is barely tested before migration | Known gap ([4.2](#42-trial-projects)) | Proposed |
| Phase 2 features creep into phase 1 | Trial starts late | Cut line (3.2); review at each milestone | Decided (O-75); review proposed |
| Shinan tracks its own development | A broken Shinan hides its own bugs | Trial findings are GitHub issues, readable without Shinan (4.4) | Proposed |

## Dependencies on other documents

Sibling drafts were read on 2026-11-16 at the commits before they applied the
owner's answers. Mismatches below are for the integration review.

| Document | What this roadmap needs from it |
|---|---|
| [Domain model and glossary](domain-model.md) | Terms. It should reflect O-6 to O-8, O-21 (subtasks), O-37 and O-40, which this document already follows. |
| [Product overview](product-overview.md) | Signs of success, which R7, R12 and R13 measure; the competitor survey rechecked at each phase boundary (O-90). Its D-010 non-goal and Multica trial must follow O-88 and O-97. |
| [Catalog](catalog.md) | Entity types (with custom types, O-17) and the import mapping (its section 13, with O-14 and O-15); catalog approval with only gated classes from the start (O-3); no restricted level (O-2). Its question on automatic fact checks is answered here: phase 2a (3.2). |
| [Tasks and work](tasks.md) | Task ID prefix, flags (including per-workspace flags, O-8), subtasks (O-21), `related` links from members' mentions (O-25); member-opened outside issues starting in `to do`; importing existing issues only on request (O-23); trial coordination as Shinan tasks (O-73). |
| [Identity, agents and permissions](identity.md) | Sign-in methods (O-41), email allowlist and invitations (O-48), every member sees everything (O-43), for R11. **Mismatch:** its section 13 builds viewer enforcement and invitations only before a second member (O-49), while O-75 needs a viewer test account in the first version ([3.2](#32-cut-line)). |
| [Git host integrations](git-hosts.md) | A per-repository "do not import issues" setting (4.4); reconciliation guarantees for R2; the GitHub App (O-51, O-52) and Forgejo token from the person's own account (O-53, O-54). Its open question on GitHub organisations is answered here: the trial needs only `guneet-xyz`; Walls would need `cranklabs`. Its GitLab question is answered here: after G3, only if needed. |
| [Agent integrations](agent-integrations.md) | The OpenCode plugin and skill used in the trial (O-36, O-38); subagents as agent sessions (O-37); what agent sessions can report for R8 and R13; the policy content moved into the skill (6.5). Claude Code support follows in phase 2a (O-82, O-33). |
| [Human experience](human-experience.md) | The wiki, start-here document, board and triage inbox required by R12 and R16. |
| [Architecture and operations](architecture.md) | Technology (O-60, O-61); the always-on Git mirror (O-11) and where it is hosted; export and import (R15); the mon tile; the security checklist, which it proposes to pass before the first public deployment and again before migration (R11); deployment as needed (O-83). **Mismatch:** its draft has nightly backups, restore tests as a gate and an optional, off-by-default Git export, which O-62 to O-64 and O-11 replace. |
| [Decision log](decisions/) | Records for the owner's answers (O-n) cited here. |

## Decisions in this document

| Label | Decision | Status | Section |
|---|---|---|---|
| RM-1 | Every phase gate is a recorded owner decision against stated criteria | Proposed | [2](#2-phases) |
| — | First-version additions (export, uptime monitoring, viewer test account, readiness report) and the cut line; no built-in backups | Decided (owner, O-75, O-62 to O-64) | [3.1](#31-in-scope), [3.2](#32-cut-line) |
| RM-3 | Four milestones with a scope review at each; the trial starts at M2 | Proposed | [3.3](#33-build-milestones) |
| — | Deploy to Musashi as needed, each deployment approved | Decided (owner, O-83) | [3.4](#34-owner-actions-needed-in-phase-1) |
| — | Trial projects Shinan, mon, easyshell; reserves Walls, guneet.dev plus Resume | Decided (owner, O-70) | [4.2](#42-trial-projects) |
| — | Trial catalog checked at owning sources; extra catalog proposals | Decided (owner, O-71, O-72) | [4.3](#43-the-catalog-during-the-trial) |
| — | Trial coordination as Shinan tasks; mon and easyshell keep repository issues | Decided (owner, O-73, O-74) | [4.4](#44-tasks-during-the-trial) |
| — | Readiness: must-pass and judged criteria; owner work under one hour a week; board and triage inbox required | Decided (owner, O-76 to O-78) | [5](#5-readiness-criteria), [4.6](#46-running-the-trial) |
| RM-10 | Conditions that pause the trial, and recreating coordination issues on a pause | Proposed | [4.6](#46-running-the-trial) |
| RM-11 | Migration principles | Proposed | [6.1](#61-principles) |
| — | One rehearsed cutover; freeze of at most two working days; 30-day rollback window; archive after G3 | Decided (owner, O-79 to O-81) | [6.3](#63-cutover-steps), [6.7](#67-rollback-and-break-glass-access) |
| RM-13 | The trial workspace becomes the production workspace, with listed clean-up | Proposed | [6.3](#63-cutover-steps) |
| — | Claude Code plugin in phase 2a | Decided (owner, O-82) | [2](#2-phases) |

## Open questions

1. **Import filters.** Whether git host connections can skip issue import per
   repository (4.4). Owned with [git host integrations](git-hosts.md).
2. **Measuring R13.** How the sample of agent sessions' context sources is
   gathered.
3. **Off-Musashi uptime probe** for R10.
4. **Git mirror host.** Where the read-only mirror lives, ideally off Musashi
   (6.7). Owned with [architecture](architecture.md).
5. **Walls as a reserve.** Adding it needs the GitHub App to cover the
   `cranklabs` organisation, which O-52's private app cannot; decide only if
   Walls is actually needed.
6. **Forgejo Project API.** If Forgejo ships Project endpoints before cutover,
   board state could be read automatically; re-check at the rehearsal.

## Decisions needed from the owner

Two new questions follow from the answers in [#25][o]. Neither adds to the
owner's weekly trial work.

| # | Decision | Recommended | Reason |
|---|---|---|---|
| 1 | Post a weekly record of open trial tasks that have no repository issue (intent and acceptance criteria) as a comment on a trial issue in `guneet-xyz/shinan` | Yes | With no backups (O-62) and coordination in Shinan (O-73), it keeps that intent recoverable at almost no cost. |
| 2 | Build a minimal invitation and viewer role enforcement in M1, so the viewer test account (O-75) can join as O-48 requires | Yes | Otherwise O-75 cannot be met before the second member that identity's split (O-49) waits for. |

[o]: https://github.com/guneet-xyz/shinan/issues/25
