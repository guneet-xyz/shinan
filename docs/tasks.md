# Tasks and work

Status: **draft for review** ([issue #6](https://github.com/guneet-xyz/shinan/issues/6)).
Updated with the owner's answers in [#25] (2026-11-16).

This document says how a task lives in Shinan: how it is created, identified
and split into subtasks, how work on GitHub and Forgejo is linked to it, how
its status is calculated, which manual states and task flags exist, how
outside issues are triaged, how tasks depend on each other, and when a
person's comment becomes a nudge. It uses the terms of the
[domain model and glossary](domain-model.md) exactly.

It stays at the level of rules and meanings. How Shinan reads git hosts is in
[git host integrations](git-hosts.md); how agents call Shinan and receive nudges
is in [agent integrations](agent-integrations.md); how tasks look on screen is
in [human experience](human-experience.md).

## How to read this document

Every rule is marked:

- **Decided**: follows from an accepted decision or approved plan content in
  the [plan](plan.md), or from the owner's answers in [#25]. Owner answers are
  cited as "owner, O-n, [#25]".
- **Proposed**: suggested here, with a reason. The owner confirms or changes it.
- **Open**: not settled. Listed under [open questions](#open-questions).

Examples use `T-123` as a task ID. `T` stands for the workspace's own prefix
(see [task IDs](#3-task-ids)).

### Words used in this document

These refine glossary terms and are listed under
[glossary changes](#changes-this-document-needs-in-the-glossary). All are
**proposed**.

| Word | Meaning | Reason |
|---|---|---|
| **Merged** | A PR merged into the repository's default branch, or into a branch the git host connection marks as counting (for example a long-lived release branch). A commit counts as merged when it reaches such a branch by a direct push. | GitHub draws the same line for closing keywords (checked 2026-11-16, [GitHub docs](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue)). Without it, a stacked PR merged into another feature branch would count as finished work. |
| **Merged elsewhere** | A PR merged into any other branch. It is neither active nor merged. The PR from the branch it merged into carries the work on, and should carry the marker too. | The work has not reached the code people use yet. |
| **Active** | A `delivers` branch with no PR and not merged, a draft PR, or a PR ready for review. A PR stops being active when it is merged, merged elsewhere or closed without merging. | Status needs one word for "work still in flight"; the glossary asks to avoid "open" for tasks. |
| **Confirmed link** | A work link that counts toward status. Links made by members' markers, agents' calls and people are confirmed when made; some are made **unconfirmed** ([6.4](#64-unconfirmed-links)). | Outsiders can write markers on public repositories. |
| **Parent** and **subtask** | A task split into smaller tasks is their parent; each smaller task is a subtask ([2.1](#21-subtasks)). | Decided that subtasks exist (owner, O-21, [#25]). |

Issues are never `delivers` work items; they are `origin` or `related`.
**Proposed.** Reason: an issue describes intent, not a change to the code, and
its open or closed state is set by hand, which D-005 avoids copying into
status.

## Contents

1. [From today's practice to Shinan](#1-from-todays-practice-to-shinan)
2. [What a task holds](#2-what-a-task-holds), including [subtasks](#21-subtasks) and [order](#22-order-of-to-do-tasks)
3. [Task IDs](#3-task-ids)
4. [Creating tasks](#4-creating-tasks)
5. [Triage of outside issues](#5-triage-of-outside-issues)
6. [Linking work](#6-linking-work)
7. [Calculated status](#7-calculated-status)
8. [Manual states and task flags](#8-manual-states-and-task-flags)
9. [Dependencies](#9-dependencies)
10. [Claims, assignees and agent sessions](#10-claims-assignees-and-agent-sessions)
11. [Nudges](#11-nudges)
12. [Task events](#12-task-events)
13. [Conventions agents follow](#13-conventions-agents-follow)
14. [Worked examples](#14-worked-examples)
15. [During the trial](#15-during-the-trial)

## 1. From today's practice to Shinan

Shinan grew out of the hand-made practice in the `workspace` repository's
[collaboration guide](https://git.guneet.dev/guneet/workspace/src/branch/main/docs/collaboration.md)
and [access and safety policy](https://git.guneet.dev/guneet/workspace/src/branch/main/docs/access-and-safety.md).
That practice works; Shinan keeps its rules and removes the manual parts. The
`workspace` repository stays the source of truth until migration (D-018),
except that coordination for trial projects moves into Shinan during the trial
([section 15](#15-during-the-trial)).

| Today (issues in the `workspace` repository) | In Shinan | Status |
|---|---|---|
| A coordinating issue in the `workspace` repository links project issues and PRs and does not copy their progress. | A [task](#2-what-a-task-holds). Work on any git host links to it through work links. | Decided (D-001, D-004) |
| Issue numbers are repository-scoped, so cross-repository work needs qualified references or full URLs. | A host-neutral task ID used in branch names and PR descriptions. | Decided (D-002) |
| Branch `task/42-update-locations-agent-a`. | Branch `task/T-123-update-locations-agent-a`. | Proposed ([6.2](#62-markers)) |
| `Closes #42` only in the PR that completes the issue; intermediate PRs merely reference it. | Work that needs several PRs is split into subtasks; a task is done when all its subtasks are done and every PR delivering it has merged. | Decided (owner, O-21, [#25]) ([2.1](#21-subtasks)) |
| Project board columns moved by hand; no Markdown status mirror. | Status calculated from linked work and recorded events. | Decided (D-005; owner, O-4, [#25]) |
| "Merely opening a PR or marking it ready is not task completion"; verify the outcome after merge. | `done` needs merged work, plus a recorded verification where the acceptance criteria need more than the merge. | Decided (owner, O-4, O-9, O-22, [#25]) ([7.4](#74-verification-and-done)) |
| `human-effort` label plus a TL;DR comment. | The `needs a person` task flag with the same TL;DR as structured fields; agents may set it. | Decided (plan, Tasks pillar; owner, O-7, [#25]) ([8.3](#83-needs-a-person)) |
| Deployment approval asked for in the conversation, never through `human-effort`; scope and revision recorded in the issue or PR. | A separate task flag, `awaiting deployment approval`. Approval is given in Shinan, or in the conversation and recorded by the agent. | Decided (owner, O-8, O-20, [#25]) ([8.4](#84-awaiting-deployment-approval)) |
| One fixed set of labels per repository. | Task flags are managed per workspace; the built-in ones are defaults. | Decided (owner, O-8, [#25]) ([8.1](#81-managing-flags)) |
| "Waiting on another issue or PR: link the dependency instead." | A dependency between tasks; the `blocked` flag is calculated from it. | Proposed ([section 9](#9-dependencies)) |
| "Announce the agent/session identity in a comment if agents share an account." | The agent session claims the task through Shinan, so its identity is recorded. | Proposed ([section 10](#10-claims-assignees-and-agent-sessions)) |
| "Assignment is not an atomic lock; recheck and coordinate overlaps." | Neither an assignee nor a claim is a lock. | Proposed ([section 10](#10-claims-assignees-and-agent-sessions)) |
| Close a cross-repository coordinating issue by hand if the host cannot. | The task's status is calculated across hosts, so the task itself is never closed by hand. Origin issues on the hosts may still need closing ([5.3](#53-after-triage)). | Decided (D-005; owner, O-57, [#25]) |
| Project board order says what comes next. | People rank `to do` tasks in a simple order. | Decided (owner, O-28, [#25]) ([2.2](#22-order-of-to-do-tasks)) |

## 2. What a task holds

A task is the story of one piece of work, from intent to verified outcome
([glossary](domain-model.md#task)).

| Field | Meaning | Status |
|---|---|---|
| Task ID | Stable, host-neutral, never reused ([section 3](#3-task-ids)). | Decided (D-002) |
| Title | Short name for people. | Proposed |
| Intent | What and why, in plain words. | Decided (plan, Tasks pillar) |
| Acceptance criteria | A checklist. A criterion can be marked as a person's step (as today's `**Owner (human effort):**` lines are) or as **verify after merge** ([7.4](#74-verification-and-done)). | Decided that criteria exist (plan, Tasks pillar); markings proposed, reason: they keep today's practice and drive verification |
| Decisions | Decisions made along the way. Lasting ones are promoted to a `decision` catalog entity ([catalog](catalog.md)). | Decided that decisions are held (plan, Tasks pillar); promotion proposed by the glossary |
| Origin | Where the intent started: Shinan, an outside issue or PR, a conversation (with a short summary), or a parent task. | Decided (D-003); parent origin proposed |
| Parent and subtasks | The task this one was split from, and the tasks split from this one ([2.1](#21-subtasks)). | Decided (owner, O-21, [#25]) |
| Task status | Calculated ([section 7](#7-calculated-status)). | Decided (D-005; owner, O-4, [#25]) |
| Task flags | The workspace's flags; by default `needs a person`, `awaiting deployment approval`, `on hold`, `blocked` ([section 8](#8-manual-states-and-task-flags)). | Decided (owner, O-8, [#25]) |
| Verification records | How `done` is reached where the merge is not enough ([7.4](#74-verification-and-done)). | Decided (owner, O-4, O-10, [#25]) |
| Rank | Position in the workspace's order of `to do` tasks ([2.2](#22-order-of-to-do-tasks)). | Decided (owner, O-28, [#25]) |
| Assignees | Members responsible. | Proposed (glossary) |
| Attached agent sessions | Sessions that have claimed the task. | Decided (plan, Integration points: the plugin will "attach the session to its task") |
| Work links | Links to PRs, issues, branches and commits ([section 6](#6-linking-work)). | Decided (D-002, D-004) |
| Dependencies | Tasks this one waits for ([section 9](#9-dependencies)). | Proposed |
| Related catalog entities | What the task touches. | Proposed (glossary) |
| Comments, progress updates and timeline | Discussion in Shinan; events from every host. | Decided (plan, Timeline pillar); comment and progress update proposed (glossary) |

Every member of the workspace sees every task, including tasks whose work is in
private repositories; the links themselves stay protected by the git host's
own access control. **Decided** (owner, O-43, [#25]).

Agents and people may both edit title, intent, acceptance criteria and
decisions; every edit is an [event](#12-task-events). **Proposed.** Reason:
today agents write scope and criteria into issues as part of their work, and
the timeline keeps every change visible.

### 2.1 Subtasks

A task can have subtasks; big work is split into subtasks. A task is done when
all its subtasks are done and every PR linked to it as delivering work is
merged. **Decided** (owner, O-21, [#25]). This replaces the earlier
`Completes` / `Part of` proposal and reverses the glossary's "no subtasks for
now".

The rest of this section is **proposed**:

| Rule | Reason |
|---|---|
| A subtask is an ordinary task with a parent. It has its own ID, title, intent, acceptance criteria, work links, flags, claims, comments and status. | Everything that works for a task works for a subtask, with no second set of rules. |
| A subtask's ID comes from the same sequence as every other task, for example `T-124` under `T-123`. There is no special form such as `T-123.1`. | Branch names and PR markers keep one shape ([6.2](#62-markers)), and a subtask can be moved to another parent or made a top-level task without its ID changing. |
| **One level only** in the first version: a subtask cannot have subtasks of its own. | Small and legible over configurable (owner, O-86, [#25]); one level covers splitting big work, and status stays easy to explain. Allowing more levels later is easy; removing them once trees exist is not. This is an [owner decision](#decisions-needed-from-the-owner). |
| A parent and its subtasks are in the same workspace. | Nothing is shared between workspaces except the person (glossary). |
| A task in `triage` can neither have nor be a subtask. Accept it first. | Triage decides whether the work is taken on at all. |
| People and agents can create subtasks, move a task under a parent, or make a subtask a top-level task. Each is an event on both tasks. | Agents split work today when they divide it between sessions; the timeline shows every change. |
| A new subtask takes its parent's assignees if none are given. Its origin is "split from" the parent. Outside origins stay on the parent. | The person responsible for the whole is responsible for its parts unless someone says otherwise. |
| A cancelled subtask is ignored when the parent's status is calculated. If every subtask is cancelled, the parent is calculated as a task without subtasks. | Cancelling a part means it is no longer needed. |
| Cancelling a parent also cancels its unfinished subtasks, each with an event. Reopening the parent does not reopen them. | Subtasks exist only for their parent; reopening should not resurrect parts someone already decided to drop. |
| Adding a subtask to a `done` parent moves the parent back by the [rules](#73-rules). Agents are told to create a follow-up task instead unless the parent's outcome was wrong. | Status stays calculated; finished stories stay finished by convention. |
| Task flags do not roll up. A parent's page shows its subtasks' flags ([human experience](human-experience.md)). | A flag describes one task; copying it upwards would be a second copy to keep in sync. |
| Ordering between subtasks uses [dependencies](#9-dependencies). | One mechanism for order. |

How a parent's status is calculated from its subtasks is in
[7.3](#73-rules). Which PRs deliver which subtask is set by markers that name
the subtask's own ID ([6.2](#62-markers)).

### 2.2 Order of `to do` tasks

People can rank `to do` tasks to say what comes next: a simple order with no
priority levels. **Decided** (owner, O-28, [#25]). The details are
**proposed**:

- The workspace has one order of top-level tasks. Subtasks are ordered within
  their parent. Reason: the parent's place in the order already says when its
  parts come up.
- A new task goes to the bottom. A task keeps its place while it is worked on,
  so it comes back to the same place if its work is closed. Only `to do` tasks
  are shown in order. Reason: the order is about what to start next.
- People change the order. Agents read it to pick the next task, but do not
  change it. Reason: choosing what is worked on next is the main steering act
  (human experience), and it is a person's call.

## 3. Task IDs

| Rule | Status | Reason |
|---|---|---|
| Every task has an ID, used in branch names and PR descriptions. | Decided (D-002) | Issue numbers mean something only inside one repository. |
| Each workspace has its own prefix, not a fixed `T-`. | Decided (owner, O-6, [#25]) | Markers stay unambiguous whatever repositories are connected. |
| An ID is `<PREFIX>-<number>`, for example `T-123`. | Proposed | Short, readable, and the shape people already know from other trackers. |
| IDs are unique within the workspace and never reused, even after a task is cancelled. | Proposed (glossary) | A reused ID would make old branches and PRs point at the wrong story. |
| The number counts up from 1 within the workspace, shared by tasks and subtasks. | Proposed | Short numbers are easy to say and type; one sequence keeps subtask IDs the same shape. |
| A prefix is 1 to 5 letters, chosen when the workspace is created, and unique within the Shinan installation. Two or more letters are recommended. | Proposed | Longer prefixes make accidental matches rarer. |
| `GH`, `CVE` and `GHSA` are not allowed as prefixes. | Proposed | GitHub already turns `GH-26` into a link to issue 26 of the same repository (checked 2026-11-16, [GitHub docs](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/autolinked-references-and-urls)); `CVE-` and `GHSA-` identifiers of security advisories appear often in branch names and descriptions of dependency updates. |
| If a workspace changes its prefix, the old prefix keeps working as an alias forever and is never given to another workspace. | Proposed | Old branch names and PR descriptions cannot be rewritten. |
| IDs are shown in upper case. Branch names are matched without regard to case; everything else needs upper case ([6.2](#62-markers)). | Proposed | Many people write branch names in lower case (`task/t-123-...`), but in prose a lower-case `t-2` or `ui-2` is usually something else. |
| A task cannot move to another workspace. A new task is created there and linked as related. | Proposed | Its ID belongs to its workspace; moving it would break markers. |

A repository is connected to only one workspace in the first version
(**Decided**, owner, O-59, [#25]), so a marker is always resolved within that
workspace.

## 4. Creating tasks

A task starts where the intent starts, not where the code lands (D-003: every
story needs one home, even when its first chapter was written elsewhere).
**Decided.**

| Where the intent starts | How the task is created | Starting status | Status |
|---|---|---|---|
| A person in Shinan | Created in the web app. | `to do` | Proposed |
| A conversation between a person and an agent | The agent creates the task through MCP or the CLI, with origin "conversation" and a short summary of the request (not the transcript). | `to do` | Proposed. Reason: the request is the intent; the transcript stays in the coding tool, as tool transcripts stay out of the `workspace` repository today. |
| Splitting an existing task | A person or agent creates a subtask ([2.1](#21-subtasks)). | `to do` | Decided (owner, O-21, [#25]) |
| An outside issue on a git host | Shinan creates it automatically ([section 5](#5-triage-of-outside-issues)). | `triage`, or `to do` if a member opened it | Decided (D-003); starting status proposed |
| A PR from an outside actor with no task ID | Shinan creates it automatically, like an outside issue. The PR is the task's `origin`; when a person accepts the task, the PR also becomes a confirmed `delivers` link. | `triage` | Proposed. Reason: the PR is where that intent starts (D-003), and accepting the task is the person's confirmation that this PR is the work. |

Shinan has no integrations with other trackers such as Multica, Linear or Plane;
tasks never come from them. **Decided** (owner, O-97, [#25], amending D-010).

Before creating a task, an agent searches existing tasks and reuses one that
fits. **Proposed.** Reason: today's practice says "search related open issues
… reuse an issue when appropriate"; duplicate tasks split one story.

Routine lookups and questions need no task. **Proposed.** Reason: today's
practice says the same, and tasks for trivial reads would bury real work.

A PR or branch by a member or their agent that carries no task ID is not turned
into a task automatically. It appears in a list of **unlinked work** in
connected repositories, where a person or agent links it or dismisses it.
**Proposed.** Reason: members are expected to use markers; creating tasks for
every forgotten marker would hide the slip and fill the workspace with tasks
nobody asked for. Whether some repositories (for example personal scratch
repositories) are left out of this list is **open**.

## 5. Triage of outside issues

An **outside issue** is an issue opened on a git host without going through
Shinan ([glossary](domain-model.md#outside-issue)). It becomes a task
automatically with a work link of role `origin` (D-003). **Decided.**

### 5.1 Which issues become tasks

Checked in this order; the first row that matches applies. All **proposed**
except where marked.

| Issue | Result | Reason |
|---|---|---|
| Opened by a member or their agent and carrying Shinan's own marker (an issue created from a task, see [git host integrations](git-hosts.md#9-what-shinan-writes-back)) or a known task ID | No new task. It links to that task as `related`. | Decided for issues made for people (D-004: avoids duplicate issues). Because agents share their member's git host account (D-017), an issue an agent opens for an existing task arrives from the member's account; without this rule it would become a second task for the same story. |
| Opened by an outside actor (an account not linked to a member) | New task in `triage`, even if it mentions a task ID | Someone in the team must decide whether to take it on (proposed by the glossary). Outsiders' mentions are ignored (owner, O-25, [#25]). |
| Opened by a member or their agent, directly on the host | New task in `to do`, assigned to that member | The member already decided; triage would ask them to approve their own request. Shinan cannot tell the member from their agent here (D-017), and does not need to. |

Issues that already exist when a repository is first connected are **not**
imported automatically. A person can import them explicitly, in a batch, into
`triage`. **Decided** (owner, O-23, [#25]). Reason: Shinan starts empty and is
tried on a few projects first (D-018); importing years of old issues would
flood triage on day one.

Accounts such as dependency bots can be listed per repository so their issues
and PRs skip triage and go straight to `to do`, or are ignored; their branch
names are not searched for markers. **Proposed.** Reason: automatic update PRs
are frequent and predictable, and their branch names (for example ones naming
`CVE-` advisories or package versions) are where accidental matches happen.
Where this setting lives is for [git host integrations](git-hosts.md).

### 5.2 Triage actions

The [triage inbox](domain-model.md#supporting-terms) lists tasks in `triage`
(Decided: plan, phase 2; required before migration, owner, O-78, [#25]). A
person can:

| Action | Effect | Status |
|---|---|---|
| Accept | Status becomes `to do`. The person can set assignees, intent and acceptance criteria. An outside PR that is the origin becomes a confirmed `delivers` link. | Proposed |
| Merge into an existing task | The outside issue or PR is linked to the existing task as another `origin`. The triage task is cancelled with a pointer to the surviving task. Its ID is never reused. | Proposed. Reason: each reporter's item should be updated when the work is done, so each stays an origin. |
| Cancel | Manual status `cancelled`, with a reason. | Proposed |

Leaving triage is a manual state change made by people only
([glossary](domain-model.md#task-status-task-flags-and-manual-states)).
**Proposed** (glossary). Reason: accepting outside intent commits the team's
effort, which is a person's call.

**Before the inbox exists.** Automatic creation of tasks from outside issues
(D-003) starts in phase 1, before the inbox ([roadmap](roadmap.md)). Until the
inbox exists, `triage` tasks appear in the ordinary task list, filtered by
status. **Proposed.** Reason: nothing new needs building, and the tasks are not
lost.

**Keeping the load low.** In the single-owner phase every outside item waits on
the owner. Agents can read `triage` tasks and post a suggested action (accept,
merge into a named task, or cancel) with its reason as a progress update, so
the owner only confirms. **Proposed.** Reason: this is the main way to keep
triage from becoming the owner's bottleneck without letting agents commit the
team's effort. Whether a workspace can let agents accept some kinds of outside
issues is **open**.

### 5.3 After triage

- The reporter hears the outcome on the host where they reported it, from the
  team rather than from Shinan. **Decided** (owner, O-57, [#25]: Shinan writes
  nothing to origin issues in the first version; whoever finishes acts on a
  reminder). In practice:
  - If the completing PR is in the same repository as the origin issue, it
    carries the host's closing reference (`Closes #42`), so the host closes the
    issue at merge ([6.2](#62-markers)).
  - Otherwise the agent or person who finishes the task closes or comments on
    the origin issue with their own git host tools. Anything a person wants
    done on a git host is done by them or by an agent on their own hardware,
    never by Shinan as that person (owner, O-1, [#25]).
  - A `done` or `cancelled` task shows any origin issues still open on the host
    as a reminder.
- The origin issue's own state never drives task status. If its author closes
  it while the task is in `triage`, the task shows "origin closed" and offers
  cancel; Shinan does not cancel on its own. **Proposed.** Reason: an outside
  actor should not be able to cancel a team's task, and a closed report can
  still describe a real problem.
- If the origin issue is deleted or moved, the work link is marked gone, an
  event is recorded, and the task is otherwise unchanged. **Proposed.**
- The text of an outside issue is never sent to an agent session as a nudge
  ([section 11](#11-nudges)). Agents read it as data when they work on the
  task. **Proposed.** Reason: anyone on the internet can write an outside
  issue; delivering it as an instruction would let them steer an agent.

## 6. Linking work

The work itself (branches, PRs, reviews, CI) stays on the git hosts; Shinan
links to it (D-001: work spans GitHub and Forgejo, neither can manage the
other, and copying issues creates two sources of truth). **Decided.**

Where Shinan looks for markers, and how it reads them, is owned by
[git host integrations](git-hosts.md#6-detecting-task-markers). This section
settles the syntax and the meaning: which link each marker makes, with which
role, and when it counts.

### 6.1 Work links

A [work link](domain-model.md#work-link) joins a task to a work item. Its role
is `origin`, `delivers` or `related` (glossary, proposed). A PR delivers the
task (or subtask) whose ID it names; there is no "completes" or "part"
attribute (owner, O-21, [#25]).

| How a link is made ("how made") | Role | Status |
|---|---|---|
| Task ID in a branch name | `delivers` | Proposed |
| `Shinan-Task: T-123` line in a PR description | `delivers` | Proposed |
| `Shinan-Task: T-123` trailer in a commit pushed straight to a counting branch | `delivers` | Proposed |
| Any other mention of a task ID or task address by a member in a PR title or description | `related` | Proposed |
| A mention of a task ID by a member in a comment on an issue or PR on the git host | `related`; shown on the task page, never affects status | Decided (owner, O-25, [#25]) |
| A mention by an outside actor anywhere (title, description, issue, comment), other than a `delivers` marker | Nothing | Decided for comments (owner, O-25, [#25]); proposed elsewhere, reason: the same risk applies to every place an outsider can write |
| A `delivers` marker by an outside actor | `delivers`, **unconfirmed** ([6.4](#64-unconfirmed-links)) | Decided (owner, O-24, [#25]) |
| A member's PR whose host closing reference (`Closes #42`) names a task's `origin` issue, without a task marker | `delivers`, **unconfirmed** | Proposed |
| An agent's call through MCP or the CLI | As the agent says | Decided that agents link PRs directly (D-004) |
| A person in Shinan | As the person says | Proposed |
| Shinan, for an outside issue or PR | `origin` | Decided (D-003) |

A PR, branch or comment that names several task IDs gets one link per task.
**Proposed.** Reason: small fixes sometimes finish two tasks at once, a work
item can link to more than one task (glossary), and one rule for every place a
marker appears is easier to follow.

**When links change.** While a work item is active, links made from markers
follow the markers: editing a marker out removes the link, as an event. Once a
PR is merged, merged elsewhere or closed, its marker-made `delivers` links are
fixed; later edits to its description or title produce a warning event and
change nothing. `related` links from comments follow the comment: editing the
mention out or deleting the comment removes them. Links made by an agent's call
or by a person stay until someone removes them. **Proposed.** Reason: while
work is in flight, the visible text on the host and the link in Shinan should
agree; after the work is finished, an edit to an old PR's description must not
quietly change the status of a finished task. `related` links never affect
status, so they can always follow the text.

### 6.2 Markers

A [marker](domain-model.md#supporting-terms) is text on the git host that
carries a task ID. This section defines the task part. The part that names the
agent session, used for [attribution](domain-model.md#attribution), is defined
by [agent integrations](agent-integrations.md) and [identity](identity.md), in
the same scheme (see below).

**Name the most specific task.** A PR that delivers a subtask names the
subtask's ID, not its parent's. **Proposed.** Reason: the parent's status
already rolls up from its subtasks ([7.3](#73-rules)); naming both would link
the same PR twice. A PR that names the parent directly delivers the parent
itself, and the parent is not done until it merges (owner, O-21, [#25]).

**Branch names (proposed):**

```text
task/T-124-short-description
task/T-124-short-description-agent-a   # when several sessions work on one task
fix/t-124                               # also matches; case does not matter here
```

- The task ID must start a path segment (right after the start of the name or
  a `/`) and be followed by the end of the name, `-`, `_` or `/`. Case does not
  matter. Reason: people and other tools name branches their own way, and many
  use lower case, but requiring the ID to start a segment avoids matching
  inside words.
- The recommended form keeps today's `task/<number>-<slug>` shape with the task
  ID in place of the issue number. Reason: agents and people already know it.
- A bare number never matches, so today's `task/42-...` branches do not link by
  accident.
- Branches from listed bot accounts are not searched ([5.1](#51-which-issues-become-tasks)).
- A branch marker also lets the plugin claim the task automatically, if it can
  be claimed (owner, O-35, [#25]; [section 10](#10-claims-assignees-and-agent-sessions)).

**PR descriptions and commit trailers (proposed):** one scheme for both.

```text
Shinan-Task: T-124 https://shinan.guneet.dev/t/T-124
```

- One line per task, written as a [Git trailer](https://git-scm.com/docs/git-interpret-trailers)
  (`Key: value`) on its own line. In a PR description it may appear anywhere;
  in a commit message it goes at the end. The value is the task ID, optionally
  followed by the task address. Task IDs in descriptions and titles must be
  written in upper case. Reason: one form for agents to write and Shinan to
  read, and lower-case look-alikes are common in prose.
- The key is namespaced (`Shinan-Task`, not `Task`). The agent session part
  uses the same `Shinan-` scheme, with its key named by
  [agent integrations](agent-integrations.md) (for example `Shinan-Session`).
  Reason: other tools use plain words as trailer keys, and a namespaced key is
  unlikely to clash; agent integrations asked for one scheme for both.
- The key is not the hosts' `Closes` or `Fixes`. Reason: both GitHub and
  Forgejo give `close`, `fix` and `resolve` (and their variants) a meaning for
  host issues, and Forgejo also acts on `reopen`, `reopens` and `reopened`
  (checked 2026-11-16,
  [GitHub](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue),
  [Forgejo](https://forgejo.org/docs/latest/user/collaboration/linked-references/));
  reusing them for tasks would confuse readers about which tracker acts.
- The address is written next to the ID in PR descriptions. Reason: people
  reading the PR on the host can click it without any host setup, and git host
  integrations then skips its own backlink (owner, O-56, [#25]). GitHub can
  turn a prefix such as `T-` into a link through custom autolinks configured
  per repository (checked 2026-11-16,
  [GitHub docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/configuring-autolinks-to-reference-external-resources)).
  Forgejo's equivalent for letter-and-number IDs is part of its external issue
  tracker setting (checked 2026-11-16,
  [Forgejo docs](https://forgejo.org/docs/latest/user/collaboration/linked-references/#external-trackers)),
  which also changes what `#` references mean in that repository. So the
  written address is the only form that works everywhere. The URL shape shown
  here is illustrative; [architecture](architecture.md) and
  [human experience](human-experience.md) own it.
- Commit trailers count only on commits that reach a counting branch by a
  direct push. Commits that belong to a PR, including ones copied into the
  default branch by a squash or rebase merge, are ignored; the PR's own markers
  decide. Reason: squash merges copy PR commit messages, trailers included,
  into the default branch, where they would otherwise look like direct pushes
  and link the same work twice. Git host integrations tells the two apart. The
  `workspace` repository forbids direct pushes, but personal repositories may
  allow them, and that work would otherwise go unlinked.

**Host closing references.** If the task's origin issue is in the same
repository as the PR that finishes the task, the PR also says `Closes #42`, so
the host closes it at merge without needing Shinan. **Proposed.** Limits,
checked 2026-11-16: GitHub acts on it only when the PR targets the default
branch ([GitHub docs](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue));
Forgejo closes the issue only if the person merging has permission to close it
([Forgejo docs](https://forgejo.org/docs/latest/user/collaboration/linked-references/#actionable-references-in-pull-requests-and-commit-messages));
and neither reaches across hosts. Origin issues the host cannot close are
handled as in [5.3](#53-after-triage). With subtasks, the closing reference
belongs in the last PR of the whole task, which the agent finishing the parent
knows; if in doubt, the reminder in 5.3 covers it.

**PR titles (proposed):** titles stay plain language. A task ID in a title is
treated like any other mention (`related`). Reason: titles are for people, and
most PRs already carry the ID in their branch name.

**Unknown IDs (proposed):** a marker that names an ID which does not exist in
the workspace that owns the repository's connection makes no link. It is
recorded as unresolved so someone can fix the typo, as git host integrations
proposes. Reason: guessing would link work to the wrong story.

### 6.3 Several PRs for one piece of work

Work often needs more than one PR: a change in a Forgejo infrastructure
repository and another in a GitHub application repository, or a large change
split into steps.

| Situation | What to do | Status |
|---|---|---|
| One PR | Link it to the task. | Decided (D-002, D-004) |
| Several PRs whose number and order are not settled, or that are worked by different sessions | Split the task into subtasks, one per PR or step, before the first PR merges. Each PR names its subtask. | Decided that big work is split into subtasks (owner, O-21, [#25]); "before the first PR merges" proposed |
| Several PRs that are all known up front and worked together | Either use subtasks, or link all the PRs to one task and publish every branch or draft PR early. | Proposed |

Reason for the timing: a task without subtasks is done when every PR linked to
it has merged. Shinan cannot know that another PR is still to come, so if the
first PR merges before the second exists, the task would reach `verifying` or
`done` too early. Subtasks, or branches published early (already today's
practice), keep it open, because an unfinished subtask or an active branch
holds the parent back.

### 6.4 Unconfirmed links

Some links are made **unconfirmed**. An unconfirmed link is shown on the task
but does not count toward status until it is confirmed. **Decided** for
outside actors' markers (owner, O-24, [#25]). Reason: on public repositories
anyone can open a PR from a fork that names `T-123`; if that counted, an
outsider could move a task to `in review` or reopen a `done` one.

| Made by | Who can confirm | Status | Reason |
|---|---|---|---|
| A `delivers` marker from a git host account not linked to any member (an outside actor) | A person (workspace owner or contributor), in Shinan | Decided (owner, O-24, [#25]) that a member confirms; "a person, not an agent" proposed | The text was written by an outsider; an agent reading it could be steered by it. |
| A member's host closing reference to a task's `origin` issue, without a task marker | A person, or an agent session acting for a member | Proposed | The PR comes from the team; the only question is whether it is the delivering work, which an agent working on the task can judge. |

All **proposed**:

- Confirming makes the link count, as an event credited to whoever confirmed
  it. Dismissing removes the link, as an event. Confirmation is recorded per
  link; a later marker on the same PR does not need a second confirmation.
- Accepting a `triage` task confirms its outside PR origin as `delivers`
  ([section 4](#4-creating-tasks)).
- If a member later adds a marker to the PR (for example by editing the
  description from their own account), the link counts at once, because the
  marker now comes from a member.

### 6.5 When a PR closes without merging

A `delivers` PR closed without merging stops being active and stops counting
towards status. Its link stays, marked closed, and an event is recorded.
**Proposed.** Reason: status is calculated from linked work (D-005); a closed
PR is no longer work in flight, but the history of a rejected approach is part
of the story.

- If other active work remains, status follows it.
- If nothing is left, status falls back to `to do` (or `in progress` if an
  agent session is still attached).
- The task is never cancelled automatically. Reason: a PR is often closed
  because it is replaced by a better one or the approach was wrong; the intent
  is still there. Only a person cancels.
- If the PR is reopened, it is active again.
- Attached sessions are told when a PR is closed by any actor other than an
  attached session acting through Shinan. Because agents share their person's
  git host account (D-017), a closure on the host often has attribution
  `unknown`; the message then says the PR was closed and by which account,
  without claiming it was someone else. **Proposed.** Whether this message is a
  nudge or a separate kind of message is **open**
  ([open question 4](#open-questions)).

### 6.6 Repository issues for people

Agent-driven work links PRs directly; repository issues are created only when
people need them there (D-004: avoids duplicate issues). **Decided.** Examples
of need: a public project whose users follow issues, or a collaborator who
works only on the host. When a person asks for one, Shinan creates it with its
own GitHub App identity, noting who asked (owner, O-1, [#25]); details are in
[git host integrations](git-hosts.md#9-what-shinan-writes-back).

Such an issue links to the task as `related` and carries the task ID and link in
its description ([5.1](#51-which-issues-become-tasks)). Its state on the host
does not drive task status. **Proposed.** Reason: it is a window onto the task
for people on the host, not a second place where the work is tracked.

## 7. Calculated status

Task status is calculated from linked work and recorded events (acceptance,
agent session attachment, verification), not copied by hand. Verification that
covers every acceptance criterion can make a task `done`. **Decided** (D-005;
owner, O-4, [#25]). Reason: copied status goes stale, and `triage`,
`in progress` and `done` cannot be told from links alone. Nobody types a
status except the manual ones the glossary allows (`cancelled`, and leaving
`triage`), and no tool marks a task done (owner, O-10, [#25]).

### 7.1 Inputs

| Input | Used for | Status |
|---|---|---|
| State of each **confirmed** `delivers` work item: active (branch without PR, draft PR, PR ready for review), merged, merged elsewhere, closed without merging | Main status | Decided that linked work drives status (D-005); the states are proposed |
| Status of each subtask that is not cancelled | Parent's status | Decided (owner, O-21, [#25]) |
| Attached agent sessions | `to do` versus `in progress` | Decided (owner, O-4, [#25]) |
| Acceptance criteria marked verify after merge, and verification records | `verifying` versus `done` | Decided (owner, O-4, O-9, O-22, [#25]) |
| An outside origin not yet accepted | `triage` | Decided (D-003) |
| Manual `cancelled` | Replaces status | Proposed (glossary) |

Unconfirmed links, `related` links, issues, CI checks, reviews, comments and
task flags do not change status. They appear beside it or on the timeline.
**Proposed.** Reason: status answers "where is the work"; mixing in review
comments or CI results would make it flicker without the work moving. A failing
check or a requested change is visible beside the PR on the task page
([human experience](human-experience.md)).

### 7.2 Statuses

`triage`, `to do`, `in progress`, `in review`, `verifying`, `done` and
`cancelled`. `verifying` means all delivering work has merged, but an
acceptance criterion marked verify after merge has not yet been covered by a
passing verification. **Decided** (owner, O-9, [#25]).

Reason for `verifying`: some outcomes can only be checked after merge.
Examples are projects that deploy as a separate step after merge, scheduled
jobs whose first run is the real test, and changes whose effect shows only in
production. Where a merge itself deploys, today's policy requires approval
**before** the merge, so that wait happens in `in review` with the
[`awaiting deployment approval`](#84-awaiting-deployment-approval) flag set,
not in `verifying`.

The diagram shows the usual paths for a task without subtasks. It is
illustrative; [the rules](#73-rules) decide.

```mermaid
stateDiagram-v2
  [*] --> triage: outside issue or PR
  [*] --> to_do: created in Shinan, split from a parent, or opened by a member on a host
  triage --> to_do: person accepts
  to_do --> in_progress: session attached, branch or draft PR
  to_do --> in_review: PR opened ready for review
  to_do --> done: direct push with trailer, or verification covers all criteria
  in_progress --> in_review: every active item is a PR ready for review
  in_review --> in_progress: PR back to draft, or new branch
  in_review --> verifying: work merged, verification needed
  in_review --> done: work merged, no verification needed
  in_progress --> to_do: work closed, session released
  verifying --> done: passing verification
  verifying --> in_progress: failed verification
  done --> in_progress: failed verification, or new active work
  done --> in_review: new PR ready for review
  triage --> cancelled: person cancels
  to_do --> cancelled: person cancels
  in_progress --> cancelled: person cancels
  in_review --> cancelled: person cancels
  verifying --> cancelled: person cancels
  cancelled --> to_do: person reopens
```

`to_do`, `in_progress` and `in_review` stand for `to do`, `in progress` and
`in review`.

### 7.3 Rules

Only confirmed links count. The **current verification** is the latest
verification record made after the most recent merge of the task's own
`delivers` work, or of any of its subtasks' work (or the latest record at all,
if nothing has merged). The rules below are **proposed**; they implement the
decisions cited in [7.1](#71-inputs).

**A task without subtasks** (or whose subtasks are all cancelled). Status is
the first row that matches.

| # | Condition | Status |
|---|---|---|
| 1 | A person has set `cancelled` | `cancelled` |
| 2 | The task came from an outside issue or PR and has not been accepted | `triage` |
| 3 | There is active `delivers` work, and every active item is a PR ready for review | `in review` |
| 4 | There is active `delivers` work | `in progress` |
| 5 | The current verification is `failed` | `in progress` |
| 6 | At least one `delivers` item has merged, and no acceptance criterion is marked verify after merge | `done` |
| 7 | At least one `delivers` item has merged, and the current verification is `passed` and covers every criterion marked verify after merge | `done` |
| 8 | No `delivers` item has merged, the task has at least one acceptance criterion, and the current verification is `passed` and covers every acceptance criterion | `done` |
| 9 | At least one `delivers` item has merged | `verifying` |
| 10 | An agent session is attached | `in progress` |
| 11 | Otherwise | `to do` |

**A parent** (a task with at least one subtask that is not cancelled). Its
**parts** are each such subtask's status, plus the parent's own work if it has
any `delivers` links: `in review` or `in progress` by rules 3 and 4 while it is
active, `done` once all of it has merged. Status is the first row that matches.

| # | Condition | Status |
|---|---|---|
| P1 | A person has set `cancelled` | `cancelled` |
| P2 | The parent's current verification is `failed` | `in progress` |
| P3 | Every part is `to do` | `in progress` if an agent session is attached to the parent, otherwise `to do` |
| P4 | Any part is `to do` or `in progress` | `in progress` |
| P5 | Any part is `in review` | `in review` |
| P6 | Any part is `verifying` | `verifying` |
| P7 | Every part is `done`, and either no acceptance criterion of the parent is marked verify after merge, or the current verification is `passed` and covers every such criterion | `done` |
| P8 | Otherwise (every part is `done`) | `verifying` |

A parent cannot be finished by verification alone while a subtask is
unfinished (owner, O-21, [#25]: done when all subtasks are done). Its own
verify-after-merge criteria are for checks of the whole, such as an end-to-end
test once every part has merged.

Notes on the rules:

- **Least advanced work wins (rules 3 and P4 to P6).** With one PR ready and
  another still a draft, or one subtask in review and another not started, the
  task is `in progress`. Reason: status should say what has to happen next. The
  task page still shows what is waiting for review. This narrows the
  glossary's wording ("a `delivers` PR is open and ready for review").
- **An attached session does not pull status back.** A session addressing
  review feedback leaves the task `in review`. Rules 10 and P3 only lift
  `to do` to `in progress`. Reason: "someone is working on it" is weaker
  information than the state of the PRs.
- **A failed verification reopens (rules 5 and P2).** It applies whether the
  task was `verifying` or `done`, and whether or not any criterion was marked
  verify after merge. A later merge starts a new round, so an old failure does
  not linger. Reason: a person must be able to say "this did not work" and see
  the task move.
- **A verification must cover the criteria (rules 7, 8 and P7).** A passing
  record finishes a task only if it names every criterion that needs checking.
  Reason: otherwise any agent could move any task to `done` by recording one
  vague "verified", which is a typed status in all but name. A task with no
  criteria and no merged work cannot be finished by verification; someone adds
  criteria first.
- **Tasks without code (rule 8).** Some tasks are a console step, a decision or
  an investigation. A verification covering every acceptance criterion
  finishes them (owner, O-4, [#25]).
- **New work reopens a finished task.** A new confirmed, active `delivers` link
  or a new subtask on a `done` task moves it back, with an event that names the
  cause. Agents are told to create a follow-up task instead (linked as related
  or as a dependency) unless the original outcome was wrong. Reason: status
  stays calculated, while the convention keeps finished stories finished.
  Outsiders cannot do this, because their links are unconfirmed
  ([6.4](#64-unconfirmed-links)).
- **Reverts.** A revert PR that carries the task ID is ordinary `delivers`
  work and reopens the task by the rule above. Detecting reverts that carry no
  marker is **open** ([git host integrations](git-hosts.md)).

### 7.4 Verification and done

`done` means the outcome is verified, not only that code merged (plan: tasks
run "from intent to verified outcome"). Agents complete tasks by recording
verification; no tool marks a task done. **Decided** (owner, O-4, O-10,
[#25]).

- An acceptance criterion can be marked **verify after merge**, for example
  "the first scheduled backup succeeds" or "the page loads on
  `shinan.guneet.dev`". If any criterion is so marked, the task passes through
  `verifying`. When nobody marks a criterion, merging is enough. **Decided**
  (owner, O-22, [#25]). Reason: it matches today's "applicable verification"
  and keeps documentation-only tasks simple.
- A **verification record** says who verified, when, which criteria were
  covered, the result (`passed` or `failed`) and a link to evidence where one
  exists (a deployment log, a URL, the merged commit). It is an event on the
  task. **Proposed.**
- Agents and people may record verification. A person can record a `failed`
  verification at any time, which moves the task back to `in progress`
  ([rule 5](#73-rules)). **Proposed** (glossary). Reason: today agents verify
  the outcome as part of finishing work, and a person must be able to say it
  did not work.
- Agents mark deployment-related criteria as verify after merge when they write
  them ([section 13](#13-conventions-agents-follow)). **Proposed.**
- **Handing off at "ready for review".** Today's practice allows an agent to
  stop at "ready for review" when the person asked for that handoff. In
  Shinan the task simply stays `in review`; nothing extra is recorded.
  **Proposed.** Reason: that is the true state of the work, and the person
  picks it up from there.

### 7.5 How fresh the status is

Status is only as fresh as Shinan's last reading of each linked work item. If
any active work item has not been read for longer than a threshold, the task
shows when it was last confirmed. **Proposed.** Reason: catalog facts show how
fresh they are (D-007); a status calculated from stale readings deserves the
same honesty. Reading, reconciliation and the threshold belong to
[git host integrations](git-hosts.md); display belongs to
[human experience](human-experience.md).

Every status change is recorded as an event that names its cause (for example
"PR guneet/infra!12 on git.guneet.dev merged", or "subtask T-124 done").
**Proposed.** Reason: a calculated status is only trusted if people can see
why it changed.

## 8. Manual states and task flags

Some states cannot be calculated. The plan names "needs a person" as one only a
person can set (plan, Tasks pillar); the owner has since decided agents may set
it too (O-7). The glossary calls a status or flag set explicitly by an actor a
**manual state**, and a marker shown beside the status a **task flag**.

### 8.1 Managing flags

Task flags are managed per workspace: a workspace can add and remove flags as
it needs, and the built-in ones are defaults. **Decided** (owner, O-8, [#25]).

The built-in flags:

| Flag | Kind | Who sets it | Who clears it | Status |
|---|---|---|---|---|
| `needs a person` | Manual | An agent or a person, with the TL;DR fields | A person, or the agent after it confirms the step is done | Decided (owner, O-7, [#25]); TL;DR fields and clearing rule proposed ([8.3](#83-needs-a-person)) |
| `awaiting deployment approval` | Manual | Whoever asks for approval | A recorded approval or decline | Decided (owner, O-8, O-20, [#25]) ([8.4](#84-awaiting-deployment-approval)) |
| `on hold` | Manual | A person | A person | Proposed (glossary) ([8.6](#86-on-hold)) |
| `blocked` | Calculated from [dependencies](#9-dependencies) | Never set by hand | Calculated | Proposed (glossary) |

How workspace flags work, all **proposed**:

- **Who manages them.** Workspace owners add, change and remove flags. Reason:
  a flag changes how everyone in the workspace works; [identity](identity.md)
  owns the final rights.
- **What a custom flag has.** A name, a short description of when to use it,
  who may set and clear it (people only, or people and agents), and whether
  setting it needs a short text (for example "why"). Reason: enough to cover
  needs like `needs design` or `waiting on vendor` without a rules engine
  (small and legible over configurable, owner, O-86, [#25]).
- **What a custom flag does.** It is shown beside the status and can be
  filtered on. It never changes status, never nudges by itself and never
  blocks a claim. Reason: status stays calculated (D-005); a person who wants
  an agent to react can comment.
- **Built-in behaviour stays with the built-ins.** The TL;DR fields of
  `needs a person`, the request and approval rules of
  `awaiting deployment approval`, the claim rule of `on hold` and the
  calculation of `blocked` cannot be given to custom flags or changed.
  Reason: these encode the `workspace` repository's policies; making them
  configurable would make them easy to weaken by accident.
- **Removing a flag.** A workspace may remove any flag, including a built-in
  one. It is cleared from every task, each with an event; history keeps it.
  Removing `blocked` hides the flag only; dependencies stay. Removing
  `awaiting deployment approval` means approvals are only given in the
  conversation, without a record in Shinan. Reason: the owner decided built-ins
  are only defaults; keeping history means nothing is lost.
- **Agents read the workspace's flags** through MCP, with each flag's
  description, so they know when to use a custom one. How is owned by
  [agent integrations](agent-integrations.md).

### 8.2 Cancelled

`cancelled` is a manual status, set and cleared (reopened) by a person.
**Proposed** (glossary). A person cancels with a reason. Linked PRs that are
still active are **not** closed by Shinan; the task shows a warning that active
work is linked to a cancelled task. Reason: Shinan does not manage git host
work (D-001); the person decides on the host. Cancelling a parent cancels its
unfinished subtasks ([2.1](#21-subtasks)). A cancelled task can be reopened by
a person; status is then calculated again.

### 8.3 Needs a person

This replaces today's `human-effort` label and keeps its rules. Agents and
people may set it with a required summary, and both may clear it. **Decided**
(owner, O-7, [#25]). The rest is **proposed**, taken from today's practice,
which works:

- **Use it** when the task cannot progress until a person does something an
  agent cannot or must not do: access agents lack, entering or rotating
  secrets, physical or out-of-band steps, checks only a person can make, and
  decisions that belong to the owner.
- **Do not use it** for deployment approval (see
  [8.4](#84-awaiting-deployment-approval)), routine work, waiting on another
  task (use a [dependency](#9-dependencies)), blockers an agent can still fix,
  or questions a quick answer in the conversation would settle.
- **The required summary is today's TL;DR**: summary (one sentence), action
  (steps with where to do them), why a person, and then (what this unblocks and
  how to say it is done). The matching acceptance criterion is marked as a
  person's step.
- **Secrets never pass through Shinan.** The fields say where the person types
  a secret, never the value. Reason: the same rule as today, and secrets never
  go into Shinan at all (owner, O-2, [#25]); they live in a secrets manager.
- If the needed action changes, the fields are replaced and the change is an
  event. When the step is done, the flag is cleared with a short result, and
  who cleared it is recorded.
- An agent clears it only after confirming the step is done (for example by
  checking that the access now works). Reason: an agent clearing it on
  assumption would hide a step nobody did.
- Setting it sends no nudge; a person clearing it nudges attached sessions with
  the result. Reason: the agent set it and already knows; it needs to hear when
  it can continue.

### 8.4 Awaiting deployment approval

Deployment approval is a separate flag, apart from `needs a person`.
Approval is given in Shinan, or in the conversation as recorded by the agent;
never by a comment or nudge. **Decided** (owner, O-8, O-20, [#25]). Reason:
today the only approval gate in routine work is a change to an actual
deployment, kept apart from `human-effort`
([access and safety](https://git.guneet.dev/guneet/workspace/src/branch/main/docs/access-and-safety.md)),
and the owner usually gives it in the conversation with the agent that asks.

What is asked and what an approval covers (taken from today's policy;
**proposed** for Shinan):

- An agent sets `awaiting deployment approval` when it asks for approval,
  before the action that would trigger the deployment (including an
  auto-deploying merge). The request carries today's required contents: target
  and environment, operation and relevant revision, expected impact and risks,
  verification, rollback, and any coordination or lock.
- **In Shinan:** a signed-in person approves or declines the request. This is
  the stronger record.
- **In the conversation:** the agent records the approval with its scope and
  revision. The record is shown as reported by the agent session, not as the
  person's own action, so people can see it has lower attribution confidence.
  This should be revisited when other people join a workspace, because an
  agent's report of an approval is weaker evidence than a person's own action.
- **Never** a comment or review on the git host saying "approved" (agents use
  the same git host account as their person, D-017, so Shinan cannot tell who
  wrote it), and never a task comment or nudge saying "approved" (the approve
  action is one step away and binds the answer to the exact request).
- An approval can cover a defined deployment sequence, so the agent does not
  ask again for unchanged approved steps. A material change to the operation,
  target, impact or revision makes the approval stale; the agent must ask again
  and the flag returns.
- A decline also clears the flag and is recorded. Reason: a declined request
  should not look as if it is still waiting. (The glossary says the flag is
  cleared only by an approval.)
- A person's answer given in Shinan nudges the waiting session. Reason: the
  agent is waiting for exactly this answer.
- Shinan records requests and answers and shows them on the task and timeline.
  It does not run deployments or enforce the gate on the host. Reason: Shinan
  sits above git hosts and does not replace them (D-001), and agents do the
  work from outside (D-008); enforcing belongs to the host's protections and
  the agent's rules.
- Every deployment of Shinan itself to Musashi has its own approval (D-016;
  owner, O-83, [#25]); those are ordinary tasks under these rules.

How approvals are attributed and protected is owned by [identity](identity.md).

### 8.5 Blocked

See [dependencies](#9-dependencies).

### 8.6 On hold

A person pauses a task. Agents do not claim a task on hold without a person's
go-ahead, and attached sessions are told through a nudge from that person
([11.1](#111-when-a-nudge-is-created)). **Proposed.** Reason: a pause the agent
does not hear about is not a pause.

## 9. Dependencies

A task can **depend on** other tasks in the same workspace. **Proposed.**

| Rule | Status | Reason |
|---|---|---|
| `blocked` is shown while any dependency is not `done`. It is calculated, never set by hand. | Proposed (glossary) | Today's practice: "waiting on another issue or PR: link the dependency instead", and waiting is not `human-effort`. |
| A dependency that is `cancelled` does not unblock the task. It shows "dependency cancelled" until a person removes or replaces the dependency. | Proposed | Cancelling a prerequisite rarely means the dependent work can go ahead unchanged; a person should decide. |
| Dependencies that would form a loop are refused. | Proposed | A loop can never be unblocked. |
| A task cannot depend on its own parent or its own subtask. | Proposed | A parent already waits for its subtasks; a subtask waiting for its parent could never finish. |
| Subtasks of one parent may depend on each other, to set their order. | Proposed | Subtasks need an order; dependencies already express it. |
| Dependencies stay inside one workspace. | Proposed | Nothing is shared between workspaces except the person (glossary). |
| `blocked` does not stop work. Agents may prepare work on a blocked task but should not merge work that relies on the unfinished dependency. | Proposed | Today agents continue work that the blocker does not affect. |
| When a dependency becomes `done`, sessions attached to dependent tasks are told. | Proposed; delivery form **open** ([open question 4](#open-questions)) | The waiting agent should not have to poll. |

Waiting on something outside the workspace (for example an upstream project's
issue in a repository no git host connection covers) is shown as a `related`
link with a note. It does not produce `blocked`. **Open.** Reason it stays
open: Shinan cannot read the state of work it has no connection to, so it
cannot calculate the flag.

## 10. Claims, assignees and agent sessions

- An agent session **claims** a task to work on it; the session is then
  attached (glossary: at most one task per session). The claim is recorded with
  the session's identity. **Proposed.** Reason: today agents sharing an account
  must announce their identity in a comment; a claim through Shinan records it
  reliably (D-017).
- **Which tasks can be claimed.** Any task except one in `triage` or
  `cancelled`. A task `on hold` can be claimed only after a person's go-ahead.
  A `done` task can be claimed by hand (for example to check a reported
  problem) but never automatically. **Proposed.** Reason: triage and
  cancelled tasks are not accepted work; pauses and finished work need a
  person's intent.
- **Automatic claims.** The plugin claims automatically when the checkout's
  branch carries a task marker, only for tasks that can be claimed and are not
  `done`. **Decided** (owner, O-35, [#25]); the plugin side is in
  [agent integrations](agent-integrations.md).
- **Release after silence.** A session silent for 24 hours is released from its
  task, and claims it again when it resumes. **Decided** (owner, O-32, [#25]).
  Releasing is an event, and status is recalculated ([rule 10](#73-rules)).
- **Subagents and subtasks.** Every subagent is its own agent session
  (owner, O-37, [#25]). A coordinating session that splits work may claim the
  parent; each subagent claims its own subtask. **Proposed.** Reason: subtasks
  give each subagent a task of its own while keeping "one task per session",
  and the coordinating session gets the parent's nudges.
- **Neither a claim nor an assignee is a lock.** Several sessions may claim one
  task. The claiming session is told who else is attached, and sessions agree
  how to divide the work in progress updates, each on its own branch.
  **Proposed** (glossary). Reason: today's practice says "assignment is not an
  atomic lock; recheck and coordinate overlaps". When the division is lasting,
  subtasks are the better tool.
- Exclusive operations (deployments, database migrations, shared-checkout
  refreshes) need their own coordination and locks. Whether Shinan provides
  such locks is **open**; today they are coordinated by hand.
- If a task has no assignee when a session claims it, the member the agent acts
  for becomes the assignee. **Proposed.** Reason: the person stays accountable
  for their agents' work (glossary, acting for).
- A claim is not needed for an agent to read a task. **Proposed.** Reason:
  reading for context should not change status or presence.

## 11. Nudges

When a person comments, the agent session working on the task is told. Sessions
with a tool plugin get the message live; others pick it up the next time they
check in. If no session is active, the person can ask for a new one (plan,
Nudges pillar). **Decided.**

This section owns **when a nudge is created and to whom**. Delivery (how the
message reaches a running session, check-ins, presence, delivery states and
the `steer` or `queue` mode, owner, O-31, [#25]) is owned by
[agent integrations](agent-integrations.md). Screens are owned by
[human experience](human-experience.md).

### 11.1 When a nudge is created

| Source | Creates a nudge? | Status | Reason |
|---|---|---|---|
| A comment on the task by a workspace owner or contributor | Yes, unless the person marks it "note only" | Decided (plan; owner, O-26, [#25]) | People sometimes write notes for other people; interrupting the agent for those wastes its work. |
| An explicit nudge (a message to a chosen session) | Yes | Proposed | A person may want to reach one of several attached sessions. |
| A person's action that the agent must hear about: answering a deployment approval request in Shinan, clearing `needs a person`, setting `on hold` | Yes. The nudge is **from that person**; Shinan writes the message text for them. | Proposed | The agent is waiting for, or must react to, exactly these, and they come from a person, as the glossary's definition of a nudge requires. |
| Setting or clearing a custom flag | No | Proposed | Custom flags have no behaviour ([8.1](#81-managing-flags)); the person can comment. |
| Something that happens without a person's action in Shinan: a PR closed on the host, a dependency becoming `done`, a linked PR merged | Not a nudge; how the session hears is **open** ([open question 4](#open-questions)) | Open | The glossary defines a nudge as a message from a person. |
| A progress update or comment by an agent | No | Proposed (glossary for progress updates) | Agents nudging agents can loop; agents coordinate through progress updates they read when they check in. |
| A viewer | Viewers cannot comment or nudge | Proposed | The glossary's viewer role only reads. |
| A comment or review on a linked PR or issue on the git host | No, in the first version. A member's mention of a task ID there makes a `related` link only (owner, O-25, [#25]). | Proposed; **open** for later | Agents share their person's git host account (D-017), so Shinan often cannot tell whether a host comment came from the person or from the agent itself. Nudging on it would make agents nudge themselves. |
| An outside issue's text, or comments by outside actors | Never | Proposed | Anyone can write them; delivering them as instructions would let strangers steer agents. |

### 11.2 To whom

- A nudge goes to every agent session attached to the task, or to the one the
  person chose, with one delivery per session (glossary). **Proposed.** Reason:
  normally there is one; when there are several, all should hear about a change
  of direction.
- A nudge on a parent with no session attached to the parent itself goes to the
  sessions attached to its subtasks. **Proposed.** Reason: a comment on the
  parent is about the whole work, and whoever is working on it should hear;
  with subagents on subtasks (O-37), the parent often has no session of its
  own.
- A nudge that reaches no session waits on the task, and the next session that
  claims the task gets a delivery for it, but only if the nudge was never
  delivered to any session. **Decided** (owner, O-27, [#25]). Reason: an
  instruction written before an agent starts should not need repeating, and
  the limit stops old instructions being replayed. This changes the glossary's
  nudge definition.
- A nudge counts as `delivered` to a session when the agent acknowledges it,
  not when it is sent. **Decided** (owner, O-30, [#25]). If a target session
  ends before acknowledging, that delivery is `undeliverable` (glossary), and
  the person sees this.
- The person can ask for a new agent session from the task. Before phase 3 this
  records a request that a person acts on by hand; in phase 3 a launcher on the
  person's registered hardware can start the session (D-014; owner, O-1,
  [#25]). **Decided** that the person can ask (plan, Nudges pillar); how is
  owned by [agent integrations](agent-integrations.md).

### 11.3 What a nudge means

- A nudge carries the message, the person it is from, the task ID and a link.
  It is an instruction from a signed-in member, with that member's authority.
  **Proposed.** Reason: only workspace owners and contributors can nudge, so
  the agent can treat it as it would treat the same words typed by that person
  in its conversation. The one exception is deployment approval, which a nudge
  never grants ([8.4](#84-awaiting-deployment-approval)).
- `delivered` means the agent acknowledged receiving the message, not that it
  agreed or acted. The agent answers with a progress update. **Proposed.**
  Reason: a receipt that claimed action would mislead.
- Several nudges waiting for one session are delivered together, in order.
  **Proposed.**
- A person may withdraw a nudge before it is delivered. Editing a comment after
  its nudge was delivered does not send a new nudge unless the person asks for
  one. **Proposed.** Reason: avoids surprise repeats; the edit is still on the
  timeline.
- Nudges on a `done` or `cancelled` task are created the same way; usually
  there is no active session, so the person can ask for one. Work that follows
  is linked as usual and moves status by [the rules](#73-rules). **Proposed.**

## 12. Task events

Everything that happens to a task is an [event](domain-model.md#event) credited
to an actor. The task produces these kinds (**proposed**); git host events and
presence events are listed by their owning documents.

| Event | Typical actor |
|---|---|
| Task created (with origin) | Person, agent session, or Shinan |
| Accepted, merged into another task, cancelled, reopened | Person |
| Subtask added, moved under a parent, made top-level | Person or agent session |
| Rank changed | Person |
| Title, intent, acceptance criteria or decisions changed | Person or agent session |
| Work link added, removed, confirmed or dismissed (with "how made") | Person, agent session, or Shinan |
| Marker edited on a finished PR (warning; no change) | Shinan |
| Status changed (with the cause) | Shinan |
| Task flag set, changed or cleared; flag added to or removed from the workspace | Person, agent session, or Shinan (`blocked`) |
| Deployment approval requested, approved, declined, made stale | Agent session; person; agent session reporting a conversation approval |
| Verification recorded | Person or agent session |
| Dependency added or removed | Person or agent session |
| Session claimed or released; assignee changed | Agent session; person; Shinan |
| Comment or progress update added | Person; agent session |
| Nudge created, delivered, undeliverable, withdrawn | Person; Shinan |

## 13. Conventions agents follow

These are the task-side rules that the skill and MCP tools will teach. How they
are taught and enforced is owned by [agent integrations](agent-integrations.md).
All are **proposed**, following the sections above.

1. Search for an existing task before creating one; reuse it when it fits.
2. Claim the task before working on it (the plugin does this from the branch
   name). Read others' claims and coordinate in progress updates.
3. When work needs several PRs whose number or order is not settled, or several
   sessions, split it into subtasks before the first PR merges. Give each
   subagent its own subtask.
4. Name the branch `task/<task ID>-<short description>[-<suffix>]`, using the
   most specific task's ID.
5. Open a draft PR early. In its description write
   `Shinan-Task: <task ID> <task address>`, with the task ID in upper case.
6. If the task came from an issue in the same repository, write the host's
   closing reference (`Closes #42`) in the PR that finishes the whole task.
   Otherwise, when the task is done, close or comment on the origin issue with
   your own git host tools.
7. Mark acceptance criteria that need verifying after merge when writing them.
8. Set `needs a person` with all TL;DR fields when blocked on a person; set
   `awaiting deployment approval` with the full request before any action that
   triggers a deployment. Never put secrets in either. Never treat a comment or
   nudge as deployment approval; record an approval given in the conversation
   with its scope and revision.
9. Use the workspace's custom flags as their descriptions say.
10. Record dependencies instead of waiting silently.
11. After the delivering work merges, verify what the criteria require and
    record the verification, naming the criteria covered and the evidence.
12. Answer nudges with a progress update.
13. Prefer a follow-up task over linking new work to a `done` task.
14. When the person asked for a handoff at "ready for review", stop there; the
    task stays `in review`.
15. Pick the next task from the top of the `to do` order; do not reorder it.

## 14. Worked examples

### A change across GitHub and Forgejo

1. The owner asks an agent for a new backup schedule. The agent finds no
   existing task and creates `T-123` (origin: conversation), with the
   criterion "the first scheduled backup succeeds" marked verify after merge.
   It needs a Forgejo infrastructure change and a GitHub application change,
   so the agent creates subtasks `T-124` (Forgejo) and `T-125` (GitHub) and
   claims the parent. Status `to do`.
2. Two subagents, each its own agent session, claim `T-124` and `T-125`. Their
   branches `task/T-124-backup-schedule` and `task/T-125-backup-ui` with draft
   PRs (`Shinan-Task: T-124 …`, `Shinan-Task: T-125 …`) make both subtasks
   `in progress`, so the parent is `in progress` (P4).
3. The Forgejo PR is marked ready: `T-124` is `in review`, but `T-125` is still
   a draft, so the parent stays `in progress`.
4. The Forgejo PR merges: `T-124` is `done` (no criterion of its own needs
   verifying). The GitHub PR is ready: `T-125` is `in review`, so the parent is
   `in review` (P5).
5. The GitHub PR merges: `T-125` is `done`. Every part is `done`, but the
   parent's criterion needs verifying: the parent is `verifying` (P8).
6. Rolling out the schedule is a separate step that changes a deployment. The
   coordinating agent sets `awaiting deployment approval` with the full
   request. The owner approves in the conversation; the agent records the
   approval with its scope and revision. It rolls out, checks the first backup
   and records a passing verification covering the criterion, with a link to
   its log. The parent is `done` (P7).

Without subtasks, if both PRs had named `T-123` and the Forgejo PR had merged
before the GitHub branch existed, `T-123` would have reached `verifying` too
early ([6.3](#63-several-prs-for-one-piece-of-work)).

### A PR closed without merging

1. `T-130` has one PR, `Shinan-Task: T-130`, in review.
2. The owner comments on the task: "Wrong approach, use the existing queue."
   The attached session gets a nudge, closes the PR itself and opens a new
   branch.
3. When the PR closes, its link is marked closed. Status drops to
   `in progress` (a new branch exists). The closed PR stays on the timeline.
   The session is not told about the closure as if someone else did it: the
   closure has attribution `unknown` (D-017), so any message only states that
   the PR was closed and by which account.

### An outside issue

1. A stranger opens issue #57 in a public GitHub repository. Shinan creates
   `T-140` in `triage` with #57 as `origin`.
2. An agent posts a suggestion as a progress update: "Duplicate of T-121."
   The owner merges it into `T-121`; #57 becomes a second `origin` of `T-121`,
   and `T-140` is cancelled with a pointer.
3. The stranger comments "see T-121" on another issue: ignored (O-25). Then
   they open a fork PR with `Shinan-Task: T-121`. Its link is unconfirmed and
   does not change status until the owner confirms it.
4. The owner's agent's PR that finishes `T-121` is in the same repository and
   targets the default branch, so it also says `Closes #57`; GitHub closes the
   issue at merge.

## 15. During the trial

Cross-project coordination for trial projects moves into Shinan during the
trial, instead of staying in `workspace` repository issues. **Decided** (owner,
O-73, [#25]). Repository issues for mon and easyshell still stay, and Shinan's
own work may use tasks without issues, with the intent in the PR description.
**Decided** (owner, O-74, [#25]). Which projects are in the trial is decided in
the [roadmap](roadmap.md) (owner, O-70, [#25]).

What this means for tasks (**proposed** unless marked):

| Work | Where it starts | How it appears in Shinan |
|---|---|---|
| Cross-project coordination for a trial project | A task created in Shinan, by a person or an agent, with subtasks for the parts in each repository | A native task; nothing in the `workspace` repository's issues |
| Work inside mon and easyshell | The project's own repository issue, as today | An outside issue that becomes a task in `to do` (opened by a member, [5.1](#51-which-issues-become-tasks)); PRs name that task's ID |
| Work inside Shinan | A task in Shinan; the PR description carries the intent and acceptance criteria as well (O-74) | A native task. Repository issues in `guneet-xyz/shinan` are only for trial findings, which must be recordable even when Shinan is down ([roadmap](roadmap.md)) |
| Everything else | Unchanged, in the `workspace` repository's issues | Not seen |

- The rules of this document apply to trial tasks in full. Reason: the trial is
  meant to test them.
- The `workspace` repository's collaboration rules need a note for trial
  projects at trial start, saying their coordination now lives in Shinan. That
  is a separate PR in the `workspace` repository, not part of this document.
- What agents do if Shinan is down during the trial, now that coordination for
  trial projects lives only there, is for the [roadmap](roadmap.md) to settle.
  This document suggests that agents keep working on their branches and PRs,
  with the task ID already in the branch name, and record decisions and
  progress in the PR description until Shinan is back. Reason: the git host
  stays the record of the code work (D-001), and markers let Shinan catch up
  by reconciliation.

## Changes this document needs in the glossary

The [domain model and glossary](domain-model.md) is in review. This document
depends on these changes, which should be made there:

1. **Subtasks**: replace "no subtasks in the first version" with subtasks as
   decided (O-21), add **parent** and **subtask**, and "split from a parent" as
   an origin ([2.1](#21-subtasks)).
2. **Task flags are managed per workspace**, with the built-ins as defaults
   (O-8) ([8.1](#81-managing-flags)).
3. **Rank** as a task attribute (O-28) ([2.2](#22-order-of-to-do-tasks)).
4. **Nudge**: a nudge that reaches no session waits for the next claiming
   session, if never delivered to any session (O-27); `delivered` means
   acknowledged (O-30).
5. Remove **outside tool** from the supporting terms and its open question
   (O-97).
6. Add **unconfirmed link** (and confirm, dismiss) ([6.4](#64-unconfirmed-links)),
   and members' comment mentions as a "how made" for `related` links (O-25).
7. Add **merged**, **merged elsewhere** and **active**
   ([words used](#words-used-in-this-document)), and state that issues are
   never `delivers` work items.
8. Widen `origin` from "the outside issue the task came from" to "the outside
   issue or PR where the task's intent started; a task can have several".
9. Add the status **`verifying`** (O-9) ([7.2](#72-statuses)).
10. Add **verification record** and the acceptance-criterion marking **verify
    after merge** ([7.4](#74-verification-and-done)). It is not called "check
    after merge" because the glossary keeps "check" for fact checks and CI
    checks.
11. Add **unlinked work** ([section 4](#4-creating-tasks)).
12. Record the D-005 reading as decided (O-4), including verification covering
    every criterion as a way to reach `done`.
13. `needs a person`: agents may set and clear it (O-7).
14. `awaiting deployment approval`: decided (O-8); a decline also clears it;
    an approval given in the conversation and recorded by the agent counts
    (O-20) ([8.4](#84-awaiting-deployment-approval)).
15. Per-workspace task ID prefixes are decided (O-6).
16. Narrow `in review` to "every active `delivers` item is a PR ready for
    review" ([7.3](#73-rules)).
17. Mark glossary open question 3 (several `delivers` links, PR closed without
    merging) as answered here, and question 1 (outside tools) as closed by
    O-97.

## Dependencies on other documents

| Document | What this document needs from it |
|---|---|
| [Domain model and glossary](domain-model.md) | The terms used here, and the changes listed above. |
| [Git host integrations](git-hosts.md) (PR #21) | Reading markers, PR states and merges, reconciliation and freshness thresholds, per-repository bot account lists, revert detection, and recognising issues that carry Shinan's marker. Points where its current draft should follow this document: |
| | 1. **Marker syntax** is now one scheme, `Shinan-Task: T-123`, for PR descriptions and commit trailers; `Completes`, `Part of` and `Shinan-Task-Part` are gone (O-21). |
| | 2. **Comments**: a member's mention of a task ID in a comment makes a `related` link; outsiders' mentions are ignored (O-25). Its comment rows should say so; edits and deletions of comments are re-read. |
| | 3. **Outside actors' mentions** in titles, descriptions and issues make no link; only their `delivers` markers make unconfirmed links (O-24). The connector must mark each mention with whether its author is a member. |
| | 4. **A closing reference to an `origin` issue** in a member's PR makes an unconfirmed `delivers` link (no scope any more). |
| | 5. **Subtasks**: markers name the subtask's own ID; nothing special is needed in the connector. |
| | 6. Rules already agreed and unchanged: trailers on commits that belong to a PR are ignored; marker-made `delivers` links are fixed once a PR is finished; branch name matching; `GH`, `CVE` and `GHSA` reserved; "merged" means a counting branch; Shinan writes nothing to origin issues (O-57); backlinks skipped when the description has the task address (O-56). |
| | 7. **Comments as nudges** (its open question 8): not in the first version ([11.1](#111-when-a-nudge-is-created)). |
| [Agent integrations](agent-integrations.md) (PR #23) | Claim and release calls; nudge delivery, acknowledgement and modes; how sessions hear about events that are not nudges (open question 4); the session part of markers, named in the `Shinan-` scheme ([6.2](#62-markers)); reading workspace flags and their descriptions; teaching the conventions in [section 13](#13-conventions-agents-follow); requesting a new agent session. Mismatches in its current draft: it says a coordinating session "stays unattached", while this document lets it claim the parent and gives subagents subtasks (O-21, O-37); its list of tasks that cannot be claimed automatically matches [section 10](#10-claims-assignees-and-agent-sessions). |
| [Identity, agents and permissions](identity.md) (PR #24) | Who may comment, nudge, triage, cancel, confirm links, rank, manage flags and approve; how a deployment approval given in Shinan is protected and how an agent-reported approval is shown. Visibility is settled: every member sees everything (O-43). |
| [Human experience](human-experience.md) (PR #16) | Task page with subtasks and their flags, how a parent's status is explained, ranking, flag management screens, triage inbox, unlinked work list, unconfirmed links and how to confirm them, origin issues still open on `done` tasks, board, display of status freshness, nudge delivery states and the "ask for a session" action. |
| [Catalog](catalog.md) | Promoting task decisions to `decision` entities; linking tasks to catalog entities. |
| [Architecture and operations](architecture.md) | Task URL shape; how status is recalculated and stored, including the parent rollup. |
| [Roadmap and migration](roadmap.md) (PR #17) | Its §4.4 still keeps cross-project coordination for trial projects in `workspace` repository issues with a trial label; O-73 moves it into Shinan, as in [section 15](#15-during-the-trial). It should also settle what agents do if Shinan is down during the trial, which phase each rule here belongs to, and how active coordinating issues in the `workspace` repository become tasks at migration. |
| [Decision log](decisions/) (PR #19) | Records for the owner's answers cited here (O-4, O-6 to O-10, O-20 to O-28, O-73, O-74, O-97) and for the remaining decision below. |
| `workspace` repository | A note in its collaboration rules at trial start, saying coordination for trial projects lives in Shinan (O-73). A separate PR there. |

## Open questions

1. **Unlinked work exclusions.** Should some repositories (scratch, personal)
   be left out of the unlinked work list? ([section 4](#4-creating-tasks))
2. **Agents in triage.** Can a workspace let agents accept some kinds of
   outside issues, for example from listed bot accounts? ([5.2](#52-triage-actions))
3. **Git host comments as nudges.** Once attribution is reliable enough, should
   a person's review comment on a linked PR nudge the session? Depends on how
   reliable attribution can be (plan question 2). ([11.1](#111-when-a-nudge-is-created))
4. **Messages that are not from a person.** When a PR is closed on the host, a
   dependency finishes or a linked PR merges, the attached session should hear.
   The glossary defines a nudge as a message from a person. Is this a separate
   kind of message, or a nudge from Shinan? ([6.5](#65-when-a-pr-closes-without-merging), [section 9](#9-dependencies), [11.1](#111-when-a-nudge-is-created))
5. **Outside waiting.** How to show that a task waits on work in a repository
   no git host connection covers. ([section 9](#9-dependencies))
6. **Exclusive operations.** Should Shinan offer locks for deployments and
   migrations, or stay out of it? ([section 10](#10-claims-assignees-and-agent-sessions))
7. **Stale work.** Should a branch or draft PR with no activity for a long time
   still count as active, or be flagged? ([7.3](#73-rules))
8. **Reverts without markers.** Can Shinan detect them, and should they reopen
   the task? ([7.3](#73-rules))
9. **Same prefix in two installations.** Two self-hosted copies of Shinan
   connected to one repository could both use `T-`. Is that worth guarding
   against? ([section 3](#3-task-ids))

## Decisions needed from the owner

| # | Decision | Recommended | Reason |
|---|---|---|---|
| 1 | How deep subtasks can nest ([2.1](#21-subtasks)) | One level in the first version: a subtask cannot have subtasks | Small and legible (O-86); covers splitting big work; easy to allow more later, hard to remove once trees exist. |

[#25]: https://github.com/guneet-xyz/shinan/issues/25
