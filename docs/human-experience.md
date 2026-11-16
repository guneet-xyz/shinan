# Human experience

Status: **draft for review** ([issue #10](https://github.com/guneet-xyz/shinan/issues/10)).
The owner's answers in [#25] (O-1 to O-98 and follow-ups N-1 to N-11) are
applied.

This document describes what people see and do in Shinan's web app: the screens,
what each shows, and the flows between them. It covers the wiki and the start
here path, task pages, timelines, the board, nudges as a person sees them, the
agent presence view, notifications, and workspace and member management.

It describes screens and flows in words: what is shown, in what order of
importance, and what each action does. It does not choose layout or visual
style. The technology is now chosen (TypeScript, a plain Node.js server and a
React single-page app: **Decided** (owner, O-60, O-61, [#25])), but nothing here
depends on it.

## How to read this document

- Terms come from the [domain model and glossary](domain-model.md) and are used
  exactly as defined there. That document is still in review
  ([PR #14](https://github.com/guneet-xyz/shinan/pull/14)) and does not yet
  reflect the owner's answers; differences are listed under
  [dependencies](#dependencies-on-other-documents).
- Every statement is marked:
  - **Decided**: follows from an accepted plan decision (D-nnn) or from the
    owner's answers in the decision checklist, cited as "owner, O-n, [#25]" or
    "owner, N-n, [#25]" for the follow-up answers.
  - **Proposed**: suggested here, with a reason.
  - **Open**: not settled; listed under [open questions](#open-questions).
- Where a rule belongs to another document (for example when a nudge is
  created, or which catalog changes need approval), this document only says how
  the screen shows it and lists the dependency.
- No external product facts are relied on in this document, so none needed
  checking.

## Scope

This document owns (plan, section 8):

| Area | Covered in |
|---|---|
| Wiki | [The wiki](#the-wiki) |
| Onboarding path | [Start here and onboarding](#start-here-and-onboarding) |
| Task pages | [Task page](#task-page) |
| Timeline | [Timelines](#timelines) |
| Board | [Task list and board](#task-list-and-board) |
| Nudges (the person's side) | [Comments and nudges](#comments-and-nudges) |
| Workspace and member management | [Workspace and member management](#workspace-and-member-management) |

It also covers the screens that pull these together: the
[Now screen](#the-now-screen), the [agents view](#agents-view) (the glossary
gives Human experience ownership of how presence is displayed),
[triage](#triage), [unlinked work](#unlinked-work), catalog
[review and recent changes](#reviewing-catalog-changes), and the person's side
of [notifications](#notifications).

It does not cover:

- What a task status means, how it is calculated, or when a nudge is created.
  These belong to [Tasks and work](tasks.md).
- How nudges reach a running agent session, or how presence is reported and
  timed out. These belong to [Agent integrations](agent-integrations.md).
- Catalog entity types, fact rules and which catalog changes need approval.
  These belong to the [Catalog](catalog.md) document.
- Sign-in, roles, tokens and access rules. These belong to
  [Identity, agents and permissions](identity.md).
- When each screen ships. This belongs to the [Roadmap](roadmap.md); the
  [phasing](#phasing) section here only maps screens to the plan's phases.

## Design principles

1. **Attention first.** The first thing a person sees answers "what needs me?",
   then "what is being worked on now?", then "what changed?".
   **Proposed.** Reason: the owner wants to set direction while agents do the
   work; the scarce resource is the owner's attention, and anything that blocks
   agents waits on it.
2. **People stand out; agents are compact.** A person's comment, decision or
   state change is shown in full. Agent activity is grouped into short,
   expandable lines. **Decided** (plan, Timeline pillar). Reason given there:
   human activity is rarer and usually more important to read.
3. **Steer, don't operate.** The web app offers steering actions: write and
   change intent and acceptance criteria, split work into subtasks, comment and
   nudge, set task flags and manual states, rank work, accept or cancel tasks
   in triage, give deployment approval, review catalog changes, assign people.
   It does not offer code review, CI controls or a pull request view. Shinan
   writes to GitHub only as its app and makes no writes on Forgejo; anything a
   person wants done on a git host is [asked of their own agent](#asking-your-agent-to-act-on-a-git-host).
   **Decided** (D-001: Shinan sits above git hosts; owner, O-1, N-3, N-4,
   [#25]). Every work item links straight to its git host page.
4. **Show how sure Shinan is.** Facts show their fact state, source and how
   long ago they were last checked; credits show their attribution confidence;
   presence shows whether it is self-reported and when it was last seen;
   anything read from a git host shows when Shinan last read it. **Decided**
   for facts (D-007; owner, O-19, [#25]). **Proposed** for the rest, for the
   same reason: trust is the main differentiator.
5. **Explain calculated things.** Wherever Shinan shows something it
   calculated, such as a task status or `blocked`, a person can see why in one
   step. **Proposed.** Reason: status is calculated, not set by hand (D-005,
   read as linked work plus recorded events: owner, O-4, [#25]), so a person
   cannot fix a wrong status by editing it; they need to see the cause.
6. **Link, don't copy.** Pages show a short summary of a work item or owning
   source and link to it. **Decided** (D-001, D-006 and plan section 3).
7. **One person and a team see the same app.** Screens show members, roles and
   "acting for" even with one member. **Decided** (D-019, read as "design now,
   build before the second member": owner, O-49, [#25]).
8. **Usable from a phone for steering.** The Now screen, task pages,
   commenting and approving work on a phone from the first version. Browsing
   large wiki pages and settings may be desktop-first. **Decided** (owner,
   O-92, [#25]). Reason: the app is public so the owner can steer from
   anywhere (D-015).
9. **Small and legible over configurable.** Where the owner allows
   configuration (custom task flags, custom entity types), screens keep the
   defaults visible and say what a change affects. **Decided** principle
   (owner, O-86, [#25]); its use here is **proposed**.

### Phase 1 and nudges

The plan puts nudges in phase 2 (plan, section 10). **Decided.** In this
document, wherever an action **tells attached agent sessions**, that means:

- **Phase 2 onwards:** a nudge is created, following the rules in
  [Tasks and work](tasks.md).
- **Phase 1:** the action is only an event on the task. Agents see it the next
  time they read the task. Nothing is pushed to them, and the screen does not
  claim it was delivered.

**Proposed.** Reason: the plugin in phase 1 reports presence only (roadmap
draft); the screens must not promise delivery that cannot happen yet.

## Map of the app

The app is organised per workspace. A person who belongs to several workspaces
switches between them; nothing from one workspace appears in another.
**Proposed**, following the glossary. Reason: workspaces hold infrastructure
details (D-015), so a hard boundary is the simplest to keep safe. Inside a
workspace every member sees everything, including work from private
repositories. **Decided** (owner, O-43, [#25]).

| Place | What it is for | Phase |
|---|---|---|
| [Now](#the-now-screen) | What needs me, what is being worked on, what changed | 1 |
| [Tasks](#task-list-and-board) | Task list (phase 1) and board (phase 2) | 1 and 2 |
| [Task page](#task-page) | The story of one task, and steering it | 1 |
| [Timeline](#timelines) | Everything that happened in the workspace | 1 |
| [Wiki](#the-wiki) | The catalog for people, including [start here](#start-here-and-onboarding) | 1 |
| [Catalog review](#reviewing-catalog-changes) | Catalog changes waiting for approval, and recent changes | 1 |
| [Agents](#agents-view) | Agent sessions and their presence | 1 |
| [Triage](#triage) | A filtered task list in phase 1; the full triage inbox in phase 2 | 1 and 2 |
| [Unlinked work](#unlinked-work) | Branches and PRs with no task ID | 1 |
| [Workspace settings](#workspace-and-member-management) | Members, invitations, agents, git host connections, task flags, catalog settings, security log, data | 1 |
| [Your account](#your-account) | Sign-in, git host accounts, your agents, your machines (phase 3), workspaces, notification settings (phase 2) | 1 |

Phases follow the plan (section 10): the board, nudges, the triage inbox and
notifications are phase 2; starting agents from the website is phase 3.
**Decided** (plan, section 10). The board and the triage inbox are required
before the `workspace` repository moves into Shinan. **Decided** (owner, O-78,
[#25]). Which phase 1 screens are in the very first release is for the
[Roadmap](roadmap.md).

Search is available from every page. It finds tasks (by task ID or words),
catalog entities (by `<type>/<slug>` ID or words), members and agents.
**Proposed.** Reason: typing a task ID seen in a branch name should go straight
to the task.

## The Now screen

The Now screen is the home page of a workspace. It has three sections, always
in this order. **Proposed.** Reason: [attention first](#design-principles).

### 1. Needs you

Everything waiting on a person, longest-waiting first. Each item says in one
line what is needed and opens the place to act. Items for you come first; a
second group shows items waiting on any person in the workspace, so nothing is
missed when nobody is assigned.

| Item | Shown when | One-step action | Phase |
|---|---|---|---|
| Deployment approval | A task has `awaiting deployment approval` | Opens the task's [deployment approval panel](#deployment-approval-panel) | 1 |
| Task needs a person | A task has `needs a person`, or a [workspace flag](#task-flags) set to appear here | Opens the task's [needs a person panel](#needs-a-person-panel), or the task | 1 |
| Agent session `waiting` | A plugin-reported agent session is waiting for a person, with its reason (`permission` or `question`) and short label | Opens the agent session, which says on which machine and coding tool to answer | 1 |
| Agent session silent on a task | An attached agent session is `unresponsive`, or sends no heartbeats and is [overdue](#when-an-agent-session-goes-quiet) | Opens the task with options to [start a new agent session](#when-no-agent-session-is-attached) | 1 |
| Work link to confirm | An unconfirmed work link was made from a marker by an outside actor | Opens the task's [work](#work) with **Confirm** and **Dismiss** | 1 |
| Tasks in triage | One or more tasks are in `triage` | Phase 1: the task list filtered to `triage`. Phase 2: the [triage inbox](#triage) | 1 |
| Catalog change waiting for approval | A `pending` catalog proposal in a gated class | Opens [catalog review](#reviewing-catalog-changes) | 1 |
| Git host connection failing | A connection's health is failing | Opens the connection's settings | 1 |
| Invitation for you | You have a pending invitation to another workspace | Accept or decline | 1 |
| Workspace setup checklist | The workspace is new and setup is not finished | Opens the [setup checklist](#first-run-for-a-new-workspace) | 1 |
| Nudge not received | A delivery of your nudge is `undeliverable`, or still `pending` to an agent session that has gone silent | Opens the comment with delivery options | 2 |

**Proposed.** Reasons: deployment approval comes first because it is the only
workflow-level approval gate in the `workspace` repository's practice, and each
deployment of Shinan needs its own approval (D-016; owner, O-83, [#25]). Triage
is shown from phase 1 because outside issues become tasks from the first day
(D-003). Unconfirmed links come from outsiders and do not count toward status
until a member confirms them (owner, O-24, [#25]).

The number of "needs you" items is visible from every page. **Proposed.**
Reason: until [notifications](#notifications) arrive in phase 2, the app itself
must make waiting items visible.

### 2. Being worked on now

Every task with at least one attached agent session that has not ended, and
every task changed by a person in the last day. For each task: task ID, title,
task status, task flags, and one line per attached agent session:

> OpenCode session on Daedalus, acting for Guneet · busy · `shinan` repository ·
> last seen 2 minutes ago · "Writing the human experience document"

The last part is the agent session's latest progress update, if any.

Agent sessions are ordered by how likely they are to need help: `waiting`;
then silent ones (`unresponsive`, or overdue without heartbeats); then `busy`,
`starting`, agent sessions without heartbeats seen recently, `idle`, and
`offline`. Self-reported agent sessions show only when they were last seen,
never a presence state they cannot report (glossary, Presence). **Proposed.**
Reason: this answers "what is being worked on now" in one glance and puts
agent sessions that may need help first.

Every subagent is its own agent session, and it is attached to a task only
when it claims one; automatic claims from a branch marker apply only to
top-level agent sessions. **Decided** (owner, O-37, N-2, [#25]). A subagent
that claimed a task is shown on that task, labelled with its parent agent
session. Subagents not on a task are summarised in their parent's line, for
example "3 subagents (2 busy)", expandable; one that is `waiting` or silent is
shown on its own. **Proposed.** Reason: this keeps the screen readable when one
agent session starts many subagents, without hiding one that needs help.

Agent sessions that are running but attached to no task are shown as a short
group, "Not on a task", after the tasks. **Proposed.** Reason: work that is not
tied to a task cannot be steered through task comments.

### 3. Since you last looked

A short summary of what changed since the person's previous visit, grouped by
task: tasks done, pull requests merged, tasks created, deployment approvals
given, catalog changes applied, facts that changed fact state, and new comments
by people. Routine agent activity appears only as counts ("3 agent sessions, 41
events") with a link to the timeline. Opening the Now screen counts as having
looked. **Proposed.** Reason: the owner checks in between other work and wants
outcomes, not a replay; marking items as seen by hand is busywork.

## Task list and board

### Task list (phase 1)

A list of tasks with filters and saved views. Each row shows task ID, title,
parent task (for a subtask), subtask progress ("2 of 3 subtasks done", counting
direct subtasks), task status, task flags (including `blocked`), assignees, attached agent sessions
with presence, the number of linked pull requests and their combined CI check
result, and the time of the last event. **Proposed.** Reason: these answer
"what is it, who has it, is it moving, does it need me" without opening it.

Filters: task status, any task flag (built-in or workspace-defined), assignee,
agent, repository, related catalog entity, parent task, and "has an attached
agent session". Default view: everything not `done` or `cancelled`, with tasks
that need a person or a deployment approval first, then `to do` tasks in their
[ranked order](#ranking). **Proposed.**

A person can create a task from the list: title, intent, acceptance criteria,
optional parent, assignee and related catalog entities. **Decided** that tasks
can start in Shinan (D-003). The fields are owned by [Tasks and work](tasks.md).

### Ranking

People rank tasks in `to do` to say what should be worked on next: a simple
order, with no priority levels. **Decided** (owner, O-28, [#25]). Ranking is
done in the task list or on the board by moving a task up or down. It is an
event, and agents choosing their next task see the order. **Proposed.**
Reason: choosing what comes next is the main steering act. The attribute
itself is owned by [Tasks and work](tasks.md).

### Board (phase 2)

The board shows tasks in columns by task status: `triage`, `to do` (in ranked
order), `in progress`, `in review`, `verifying`, and recently `done`. Tasks in
`triage` offer **Accept** and **Cancel**. **Decided** that the board is phase 2
(plan, section 10) and that `verifying` exists (owner, O-9, [#25]). Columns by
task status are **proposed**. Reason: it mirrors the flow people already use on
the `workspace` repository's Forgejo Project, without moving anything by hand.

Rules:

- **Tasks cannot be moved between status columns by hand.** Status is
  calculated from linked work and recorded events. **Decided** (D-005; owner,
  O-4, [#25]). The board says so when someone tries, and links to the
  [status explanation](#status-explanation). Moving a task within `to do`
  changes its rank, not its status.
- **Task flags are shown with each task, not as columns.** A task can be
  `in progress` and `needs a person` at once. Tasks that need a person or a
  deployment approval are also gathered in a group that stays visible above
  the columns. `on hold` tasks are marked as paused and shown after active
  ones. `cancelled` tasks are hidden unless filtered for. **Proposed.** Reason:
  flags are separate from status so both are true at once; the always-visible
  group keeps attention on what blocks progress.
- **Subtasks** appear as tasks in their own right, labelled with their parent.
  The board can be grouped by top-level task. **Proposed.** Reason: subtasks
  are how big work is split and can nest to any depth (owner, O-21, N-1,
  [#25]); grouping by the top-level task keeps a deep tree in one group.
- **Each task on the board** shows task ID, title, assignee, presence of its
  attached agent sessions, linked pull request count and CI check result,
  `blocked`, and how long since its last event. **Proposed.**
- **Grouping:** none, by assignee, by top-level task, or by related `project`
  entity. **Proposed.** Reason: grouping by project shows where effort goes.

## Task page

The task page is where the story of a task is read and where a person steers
it. It shows, in order of importance:

### Header

Task ID, title, parent task if it is a subtask, task status, task flags,
assignees, origin (created in Shinan, from an outside issue, or from a
conversation), and the attached agent sessions with their presence.
**Proposed** order; the fields follow the glossary's task definition.

### Status explanation

With the status, a one-line reason in words, opening a short list of the
evidence:

> In review, because pull request #14 in `guneet-xyz/shinan` on GitHub is open
> and ready for review. Last read from GitHub 3 minutes ago.

- For `done`, it names what made the task done: all subtasks done, every
  delivering PR merged, and, where an acceptance criterion needs a check after
  merge, the recorded verification and who recorded it. **Decided** rule
  (owner, O-4, O-21, O-22, [#25]: a task is done when all its subtasks are done
  and every PR linked to it as delivering work is merged; "check after merge"
  is off unless a criterion is marked).
- For `verifying`, it names the criterion still waiting for its check.
- For `blocked`, it names the task it depends on and that task's status.
- Unconfirmed links and `related` links are listed as not counting.
- If any active work item has not been read for longer than the threshold set
  by [Git host integrations](git-hosts.md), it says when the status was last
  confirmed.
- For a `cancelled` task with active linked work, it warns that the work is
  still open on the git host.

**Proposed.** Reason: [explain calculated things](#design-principles). The
rules behind each explanation are owned by [Tasks and work](tasks.md).

### Deployment approval panel

When a task has `awaiting deployment approval` (a separate flag:
**Decided**, owner, O-8, [#25]), this panel comes before everything else after
the header. It shows the items [Tasks and work](tasks.md) requires a request
to carry. Today's practice lists: target and environment, operation and
revision, expected impact and risks, verification, rollback, and any
coordination or lock.

- **Approve** records the deployment approval with its scope and revision. It
  is unavailable while a required item is missing, and the panel says which.
- **Decline** asks for a reason.
- **Comment** asks a question without answering.
- Either answer tells attached agent sessions (phase 2; see
  [phase 1 and nudges](#phase-1-and-nudges)).
- An approval the person gave in the agent's conversation, recorded by the
  agent, is shown as "approved in the conversation, recorded by <agent
  session>", with its lower attribution confidence. **Decided** that approval
  is given in Shinan or in the conversation as recorded by the agent, and
  never by a comment or nudge (owner, O-20, [#25]). The panel says that a
  comment saying "approved" does not count.
- If the request's operation, target, impact or revision changes after
  approval, the approval is shown as no longer valid and the panel asks again.
  What counts as a material change is owned by Tasks and work.

**Proposed** panel. Reason: asking for approval in a fixed shape makes it
quick to give safely.

### Needs a person panel

When `needs a person` is set, this panel comes next. It carries the same short
summary that today's `human-effort` TL;DR comment carries, with the fields
[Tasks and work](tasks.md) requires:

- **What is needed**, in one sentence.
- **Action:** the steps, where to do them, and links to runbooks.
- **Why a person:** missing access, a secret to type, a physical step, or a
  decision that belongs to the owner.
- **Then:** what this unblocks and what the agent will do next.

Buttons: **Mark as handled**, which asks for a short result and clears the
flag; **Comment**; and **Not needed**, which clears the flag with a reason.
Clearing it tells attached agent sessions with the result (phase 2). Secret
values are never asked for; the panel says where to type them. **Proposed.**
Reason: the TL;DR format already works for the owner today; a panel puts it
first instead of somewhere in a comment thread.

Agents may set and clear `needs a person`, with the summary required.
**Decided** (owner, O-7, [#25]). The panel shows who set the flag and when; an
agent clearing it appears as a milestone event on the timeline.

### Task flags

Task flags are managed per workspace: a workspace can add and remove flags,
and the built-in ones are defaults. **Decided** (owner, O-8, [#25]). On the
task page, workspace-defined flags are shown with the built-in ones and can be
set or cleared with a short reason. They have no panel of their own; a flag
set to "show in Needs you" also appears in [Needs you](#1-needs-you).
**Proposed.** Reason: [small and legible](#design-principles); only the two
flags with required fields get panels. The flags are managed in
[workspace settings](#workspace-settings).

### Intent, acceptance criteria and decisions

The task's intent (what and why), its acceptance criteria as a checklist, and
decisions made along the way. Each criterion shows who last changed it, whether
it is marked "check after merge", and, when met, the evidence (a link to a work
item or a recorded verification). People edit these directly; edits are events
and tell attached agent sessions (phase 2). **Proposed.** Reason: intent and
acceptance criteria are the main way the owner steers, and an agent working
from old criteria wastes work.

Each decision has a **Record as a `decision` entity** action, which creates a
catalog proposal. **Proposed**, following the glossary.

### Subtasks

Subtasks of this task, each with its status, assignee and attached agent
sessions, and **Add subtask**. Subtasks can nest to any depth; deeper levels
are shown as an expandable tree, collapsed below the first level. The header
of a subtask shows its full chain of parents. **Decided** that tasks have
subtasks, that they nest to any depth, and that a parent is done only when all
its subtasks are done (owner, O-21, N-1, [#25]). The screen is **proposed**.
Reason: a collapsed tree keeps deep splits readable while every level stays
one step away.

### Work

Work items linked to the task, grouped by repository, each showing kind, title,
state on the host, work link role (`origin`, `delivers`, `related`), its CI
check result for pull requests, and when Shinan last read it. Details show how
the work link was made and by whom, for example "mentioned by Guneet in a
GitHub comment". Each links to the git host. **Proposed.** Reason: link, don't
copy (D-001); the "last read" time is the freshness of everything shown about
that work item.

- **Unconfirmed links** are shown with **Confirm** and **Dismiss** and do not
  count toward status until a member confirms them. **Decided** (owner, O-24,
  [#25]).
- **Mentions** of the task ID in git host comments by members create `related`
  links, which never affect status. Mentions by outside accounts are ignored.
  **Decided** (owner, O-25, [#25]).
- **Origin issues** still open when the task is `done` or `cancelled` are
  shown as a reminder to whoever finishes the task, with **Ask my agent to
  close it** ([asking your agent](#asking-your-agent-to-act-on-a-git-host)).
  **Decided** that Shinan does nothing to them and relies on the reminder
  (owner, O-57, [#25]); the reminder's display is **proposed**.
- A person can add, change the role of, or remove a work link. **Proposed**;
  the rules are owned by [Tasks and work](tasks.md).
- Work from private repositories is shown like any other: every member sees its
  stored title and summary, and opening the link is protected by the git host's
  own access control. **Decided** (owner, O-43, [#25]).

### Related

Related tasks (depends on, depended on by), related catalog entities, and
catalog proposals made during this task. **Proposed.**

### Task timeline and comment box

The task's [timeline](#timelines), with the [comment box](#comments-and-nudges)
reachable in one step from anywhere on the page. **Proposed.**

### Steering actions

| Action | Notes | Status |
|---|---|---|
| Comment | Tells attached agent sessions unless marked "note only" (phase 2) | Decided (plan, Nudges pillar; owner, O-26, [#25]) |
| Give or decline deployment approval | See [deployment approval panel](#deployment-approval-panel) | Decided where approval is given (owner, O-20, [#25]); panel proposed |
| Accept or cancel a task in `triage`; set or clear `on hold`, `cancelled`, `needs a person` and workspace flags | Asks for a short reason. Setting `on hold` and clearing `needs a person` tell attached agent sessions (phase 2) | Decided that some states are set by hand (plan, Tasks pillar; owner, O-7, O-8, [#25]); who may set each is owned by Tasks and work |
| Edit intent and acceptance criteria | Tells attached agent sessions (phase 2) | Proposed |
| Add or remove subtasks | | Decided (owner, O-21, [#25]) |
| Rank in `to do` | See [ranking](#ranking) | Decided (owner, O-28, [#25]) |
| Assign or unassign members | Assignment is not a lock | Proposed (glossary, Assignee) |
| Start a new agent session for this task | See [below](#when-no-agent-session-is-attached) | Decided (plan, Nudges pillar) |
| Detach an agent session | Removes the agent session from the task and tells it (phase 2) | Proposed. Reason: the owner must be able to redirect work |
| Ask my agent to act on a git host | See [below](#asking-your-agent-to-act-on-a-git-host) | Decided (owner, O-1, N-3, [#25]) |

### Asking your agent to act on a git host

Shinan does not act on git hosts for a person: it writes to GitHub only as its
app and makes no writes on Forgejo. **Decided** (owner, O-1, N-4, [#25]).
Wherever a person might want something done on a git host (for example
opening a repository issue for the task, or closing or commenting on an origin
issue), the screen offers **Ask my agent**. The request is sent as a queued
nudge to the person's **own** agent sessions; if none is running, it waits like
any nudge until one claims the task or the person starts one. **Decided**
(owner, N-3, [#25]). The request shows its delivery like a comment, and the
agent's reply links to the result. **Proposed** display. Which actions are
offered is owned by [Tasks and work](tasks.md) and
[Git host integrations](git-hosts.md).

These requests are nudges, so they arrive in phase 2. In phase 1 the screen
shows the reminder and a link to the item on the git host. **Proposed.**

## Comments and nudges

A comment is a person's message on a task. A nudge is that message delivered
to the agent sessions working on the task. **Decided** (plan, Nudges pillar;
glossary, Nudge), in phase 2 (plan, section 10). When nudges are created and to
whom is owned by [Tasks and work](tasks.md); how they are delivered is owned by
[Agent integrations](agent-integrations.md). This section describes what the
person sees.

In phase 1 the comment box is a plain comment box: no recipients, no delivery
states. See [phase 1 and nudges](#phase-1-and-nudges).

### Before sending (phase 2)

Before the person sends, the comment box shows who will receive the message
and how, worked out from the attached agent sessions and their presence:

| Situation | What the box says |
|---|---|
| A plugin-reported agent session (presence source `plugin-reported`) with live delivery is running and not `unresponsive` | "Guneet's OpenCode on Daedalus will get this at its next step." |
| An attached agent session without live delivery (self-reported, or a plugin without live delivery), seen recently | "Guneet's Codex on Musashi will see this when it next calls Shinan. Last seen 12 minutes ago." |
| An attached agent session is `offline` | "Guneet's OpenCode on Daedalus is offline. This will reach it when it resumes, or the next agent session that claims this task." |
| An attached agent session is `unresponsive`, or [overdue](#when-an-agent-session-goes-quiet) | "The attached agent session has not been seen for 2 hours. It may never pick this up." with **Start a new agent session** |
| No agent session is attached | "No agent is working on this task. This will wait for the next agent session that claims it." with **Start a new agent session** |
| Several agent sessions are attached | One line per agent session, each with a tick box, all ticked |

**Proposed** wording. Reason: the person must know, before they send, whether
their words will reach an agent now, later, or not at all.

Options in the box:

- **Note only:** posts the comment without creating a nudge. Off by default
  whenever an agent session is attached; agents still see the comment when
  they read the task. **Decided** (owner, O-26, [#25]).
- **When:** "at its next step" (`steer`) or "after its current work"
  (`queue`), for agent sessions with live delivery. The default is "at its next
  step" when the sender is the member the agent acts for, and "after its
  current work" for anyone else; the sender can change it per message.
  **Decided** (owner, O-31, [#25]).

### After sending (phase 2)

The comment shows the state of each delivery and updates while the page is
open:

| Delivery (per target agent session) | Shown as |
|---|---|
| `pending`, offered to the plugin | "Sending to Guneet's OpenCode on Daedalus" |
| `pending`, accepted by the coding tool | "Queued in Guneet's OpenCode; it will see this at its next step" |
| `pending`, available at check-in | "Waiting for Guneet's Codex to acknowledge (sent 10:42; last seen 10:30)" |
| `pending`, agent session `offline` | "Waiting for Guneet's OpenCode to resume" |
| `delivered`, live | "Delivered live to Guneet's OpenCode on Daedalus at 10:42" |
| `delivered`, at check-in | "Acknowledged by Guneet's Codex at 10:55" |
| `undeliverable` | "Not received: the agent session ended first. It will go to the next agent session that claims this task." |
| `withdrawn` | "Withdrawn by Guneet at 10:44" |
| `cancelled` in the coding tool | "Removed in the coding tool by the person at Daedalus; not sent another way" |

When a nudge had no target at all, the comment shows "Waiting for an agent
session to claim this task" with **Start a new agent session**.

A check-in delivery counts as `delivered` only when the agent acknowledges it.
**Decided** (owner, O-30, [#25]). The holder states and the `withdrawn` and
`cancelled` outcomes are proposed by [Agent integrations](agent-integrations.md);
this table follows them. The wording is **proposed**. Reason for showing the
route: it tells the person how quickly the agent could have acted.

Rules for the person:

- A delivery that is `undeliverable`, or still `pending` to an agent session
  that has [gone quiet](#when-an-agent-session-goes-quiet), appears in
  [Needs you](#1-needs-you). A nudge that is simply waiting for an agent
  session to claim the task does not. **Proposed.** Reason: an instruction that
  silently never arrives is the worst outcome, but a deliberate wait is not
  news.
- A person can **withdraw** a nudge that has no `delivered` delivery yet.
  **Proposed**, following Tasks and work.
- **Editing a comment.** Events are not edited (glossary), so an edit is shown
  as a correction next to the original, which stays readable. Before any
  delivery, editing replaces the waiting nudge. After delivery, the edit is not
  sent unless the person ticks "Tell the agent about this change".
  **Proposed**, following Tasks and work. Reason: a silent change to a message
  the agent already acted on would mislead, and repeat nudges for typo fixes
  would interrupt work.
- **Agent replies.** An agent replies with a progress update linked to the
  nudge (the "reply to nudge" tool in Agent integrations), which also
  acknowledges it. The reply is shown with the comment it answers, as a
  **milestone** event, not collapsed. **Proposed.** Reason: the person asked
  something and should see the answer without expanding agent activity.

### Waiting comments and the next agent session

A comment that reaches no agent session waits for the next agent session that
claims the task, but only nudges never delivered to any agent session wait.
**Decided** (owner, O-27, [#25]). This changes the glossary's nudge definition.
Waiting nudges are delivered together, in order, when an agent session claims
the task (Tasks and work and Agent integrations). The task page shows
"2 comments waiting for an agent session", each of which can be withdrawn.
**Proposed** display.

### When no agent session is attached

**Start a new agent session** offers what is possible in the current phase:

- **Before phase 3:** Shinan shows a short ready-to-use start instruction for
  the person to paste into a coding tool on one of their machines. It names
  the task, tells the agent to claim it, names the relevant repository and
  links to the agents' [start here path](#start-here-for-agents).
  **Proposed**, matching Agent integrations' ready-made prompt. Reason: there
  is no launcher yet, and a ready instruction makes the manual step one paste.
- **Phase 3, with a launcher:** the person picks one of **their own**
  registered machines (see [your machines](#your-machines-phase-3)); the
  launcher there starts OpenCode as the person's agent on that machine,
  attached to the task. The page shows `starting` until the agent session
  reaches Shinan. **Decided** that this is phase 3 (D-014) and that launched
  agents run OpenCode on hardware the person registered by installing the
  launcher (owner, O-1, [#25]). Offering only the person's own machines is
  **proposed**. Reason: an agent is per person, coding tool and machine
  (owner, O-40, [#25]) and acts for exactly that person.

### Nudges without a task

A person cannot nudge an agent session that is not attached to a task. The
[agents view](#agents-view) offers **Attach to a task** instead. **Proposed.**
Reason: the glossary defines a nudge as tied to a task, and every instruction
then has a home in a task's story.

## Timelines

A timeline shows events in time order for one subject: a task, a catalog
entity, an agent session, or the whole workspace. **Decided** that the timeline
exists and that human activity stands out while agent activity is compact
(plan, Timeline pillar). Timelines per subject are proposed in the glossary.

### Three levels of prominence

| Level | Which events | How shown | Status |
|---|---|---|---|
| **Full** | Anything a person did in Shinan: comments, intent and criteria changes, manual state and flag changes, deployment approvals, task creation, subtask changes, ranking, triage decisions, catalog approvals and reverts, link confirmations, assignments. Text events on a git host by a person or with an [unsure credit](#showing-who-did-what): comments, reviews, issue and PR descriptions. Comments by outside actors on an `origin` issue. | Never collapsed, with the person's name and a clear marker that a person did it. Comments written in Shinan are shown in full. Git host text is shown as the event's short summary with a link to the original. | Decided that human activity stands out; which events count is proposed |
| **Milestone** | Agent or automatic events a person usually cares about: task status changes, `needs a person` set or cleared by an agent, a deployment approval requested or recorded from a conversation, a verification recorded, a pull request opened, ready for review, merged or closed, a CI check failing or recovering, an agent session `waiting`, going quiet, released after timing out, or ending, an agent's reply to a nudge, a catalog proposal made. | One line each, not collapsed, with the actor. | Proposed. Reason: these change what the person should do next |
| **Compact** | All other agent and automatic activity: commits, pushes, branch creation, progress updates, catalog reads and routine catalog changes, presence changes, CI checks passing, routine work link creation including `related` links from mentions, and activity from accounts listed as automated. | Grouped by agent session into one line per run of activity, for example "OpenCode session on Daedalus, acting for Guneet: 3 commits, 2 progress updates, CI passed (10:12 to 10:40)". Subagent runs are grouped under their parent's run. Expands to the individual events. A full or milestone event always ends a run, so cause and effect stay in order. | Decided that agent activity is compact; grouping proposed |

Git host text is shown as a summary and link, not copied (glossary, Event;
D-001). If more text is wanted later, that depends on
[Git host integrations](git-hosts.md) and [Architecture](architecture.md).
**Proposed.**

A person can switch any timeline between **Default** (as above), **People
only** and **Everything expanded**, and filter by actor, kind or repository.
**People only** includes full-prominence events with unsure credits, labelled
as unsure. **Proposed.** Reason: hiding them would hide real human
instructions whenever attribution fails.

### Showing who did what

- Agent actions read "agent session, acting for person", for example
  "OpenCode session on Daedalus, acting for Guneet". **Decided** (glossary,
  Acting for, from the plan's Timeline pillar).
- Attribution confidence is shown on credits that are not `recorded`: `marked`
  as a label, `inferred` as "probably", and `unknown` as "Guneet or one of
  Guneet's agents (not sure which), from Guneet's GitHub account", following
  the glossary. **Proposed.** Reason: agents share the person's git host
  account (D-017), so some credits are guesses.
- **Unsure credits by event kind.** Text events with `unknown` attribution
  (comments, reviews, issue and PR descriptions) are shown at full prominence,
  labelled as unsure. Routine kinds (commits, pushes, branch creation, CI) stay
  compact. **Decided** (owner, O-91, [#25]).
- **Shinan's own writes**, made on GitHub as its app (it makes none on
  Forgejo: owner, N-4, [#25]), are shown as "Shinan". **Proposed** display.
- Outside actors show their git host account and the label "outside".
  Accounts listed as automated, such as dependency update tools, are shown at
  compact prominence. **Proposed.** Reason: their activity is frequent and
  predictable. Where the list lives is for [Git host integrations](git-hosts.md).

### Freshness and corrections

- Each event shows its time as relative time ("12 minutes ago"), with the
  exact time one step away. **Proposed.**
- Events that Shinan found late through reconciliation show both when they
  happened and when Shinan learned of them. **Proposed.** Reason: otherwise a
  late event looks as if it had been visible all along.
- Each timeline shows when Shinan last heard from each git host it draws on,
  and a warning when a git host connection is failing or reconciliation is
  behind. **Proposed.** Reason: an empty timeline can mean "nothing happened"
  or "Shinan could not see" (plan question 4).
- Events are not edited. A correction is a new event, shown with the one it
  corrects. **Proposed**, following the glossary.
- **Purged content.** Only workspace owners can purge, including operational
  records about their workspace. **Decided** (owner, O-50, [#25]). A purged
  event stays in place as a marker showing that content was removed, by whom
  and when. **Proposed.** Reason: the history must still show that something
  happened.
- A "since you last looked" marker shows where new events start.
  **Proposed.**

### The workspace timeline

The Timeline page shows the whole workspace, grouped by day and then by task,
with catalog and membership events in their own groups. Default filter is
**People and milestones**. **Proposed.** Reason: the workspace timeline is the
widest view and is useless if agent activity fills it.

## Agents view

Lists agent sessions that have not ended. Agent sessions that send heartbeats
are grouped by presence state: `waiting`, `unresponsive`, `busy`, `starting`,
`idle`, `offline`. Agent sessions without heartbeats (self-reported, or a
plugin that cannot send them) form their own group, overdue ones first, then by
last seen. For each: agent, member it acts for, coding tool, machine, current
task, repository, last seen, and presence source. Subagent sessions are listed
under their parent, each with the task it claimed, if any (N-2). A second list shows recently ended agent sessions with how
they ended. **Proposed.** Reason: it is the operational view of "who is doing
what right now".

Display rules:

- `self-reported` presence is labelled "self-reported" with a short
  explanation: "This agent only tells Shinan what it is doing when it calls
  Shinan. It may have stopped without saying so." Only its last-seen time is
  shown. **Decided** that self-reported agent sessions are marked (plan, Agent
  presence pillar). Wording **proposed**.
- `waiting` shows its reason (`permission` or `question`) and short label, as
  reported by the plugin, never the tool's arguments. It names where to answer:
  machine and coding tool. Answering from the web app is not offered in the
  first version. **Decided** (owner, O-39, [#25]).
- `offline` shows "offline since 18:20; keeps its task until 18:20 tomorrow".
- An agent session's page shows its timeline: tasks it attached to and left,
  work it did, nudges it received and when. **Proposed.**
- Agent sessions not on a task offer **Attach to a task**. **Proposed.**

### When an agent session goes quiet

Presence states and timeouts follow the owner's answer: a coding tool that
stops is `offline`; an agent session silent for 24 hours is released from its
task and re-claims it when it resumes; `ended` only on delete, archive, an
explicit end or after 30 days. **Decided** (owner, O-32, [#25]). The other
values below are proposed by [Agent integrations](agent-integrations.md).

- **With heartbeats:** shown as `unresponsive` after the threshold Agent
  integrations sets (its draft proposes 3 minutes).
- **Without heartbeats:** never `unresponsive`. Agent integrations proposes a
  display threshold of 30 minutes since last seen. This document proposes that
  past it the agent session is shown as **"not seen since 10:30"** and treated
  as **overdue**. Overdue is a display rule, not a presence state.
- **While `unresponsive` or overdue**, an agent session:
  - sorts with the silent ones in [being worked on now](#2-being-worked-on-now)
    and the agents view;
  - gets a [Needs you](#1-needs-you) row when it is attached to a task;
  - makes the comment box use the "may never pick this up" wording.
- **`offline`** is a clean stop, usually by the person, so it gets no Needs you
  row; the task shows how long the agent session keeps it.
- **After 24 hours** of silence the agent session is released from its task
  with the reason "timed out", shown as a milestone event, and the task shows
  no agent working on it. If the agent session resumes, the re-claim is shown
  as a milestone too.

**Proposed** display. Reason: a crashed agent session that looks as if it were
still working would keep its task in "being worked on now" and make the comment
box promise delivery that may never happen.

Registering agents and revoking their tokens is under
[workspace settings](#workspace-settings) and [your agents](#your-agents).

## The wiki

The wiki is the catalog shown to people as readable pages. **Decided** (D-006).
Each catalog revision's Markdown text is the source of truth and is stored in
Shinan's database only; there is no Git mirror for now. Catalog proposals and
review happen inside Shinan. **Decided** (owner, O-11, O-12, N-5, [#25]). The entity types, facts and rules are owned by the
[Catalog](catalog.md) document; this section is how they look and how people
move around them.

### An entity page

An entity page shows, in order of importance:

1. **Title, entity type, ID, entity status and entity owner** (or `unknown`).
   The ID is written `<type>/<slug>`, and old IDs lead to the current page.
   **Decided** (owner, O-15, [#25]). `deprecated` and `retired` entities say so
   before anything else, with the date and a link to the replacement.
   **Proposed**, following the glossary.
2. **Pending catalog proposals** for this entity, if any. **Proposed.**
3. **Discrepancies**, if any, with both sides' evidence. **Proposed**,
   following the Catalog draft's request to show them prominently.
4. **Owning sources.** Links to where the authoritative information lives,
   shown before the facts. **Proposed.** Reason: link, don't copy.
5. **Freshness summary.** One line: how many facts, the oldest last checked,
   how many due for recheck, how many never checked, and how many `unknown`.
   The only page-level date is the oldest last-checked time, calculated from
   the facts. **Proposed**, following the glossary. Reason: checking one fact
   does not refresh the others, so a stored page date would mislead.
6. **Facts.** Each fact is one structured field or relation (**Decided**,
   owner, O-13, [#25]) and shows its value, [freshness](#how-freshness-is-shown),
   fact state, source (as a link where possible), who checked it and the check
   scope. **Decided** that these are recorded (D-007). Presentation
   **proposed**.
7. **Body text.** The readable description.
8. **Links.** Related entities, and pages that link to this one. **Proposed.**
9. **Tasks.** Unfinished tasks related to this entity, and recently done ones.
   **Proposed.** Reason: the owner can see what is changing about a project or
   machine without searching.
10. **History.** The entity's timeline. Any earlier catalog revision can be
    opened and compared with the current one. **Proposed.** Reason: with no
    Git mirror (N-5), the wiki is where people read a page's history.

**Secrets.** Secrets never go in the catalog; the catalog records only where a
secret lives, for example a path in a secrets manager such as Obscuro or
Infisical. **Decided** (owner, O-2, [#25]). The wiki shows such a fact as a
pointer to the secrets manager, never a value. There is no restricted content:
every member sees every page. **Decided** (owner, O-2, O-43, [#25]).

### How freshness is shown

Each fact's age is always shown; a fact is marked **due for recheck** only
where a recheck interval is set for its key in the type's schema. **Decided**
(owner, O-19, [#25]; intervals per the Catalog document).

- Age is shown in words ("checked 3 days ago"), with the exact date one step
  away. **Proposed.**
- Freshness is shown as age, not as right or wrong. **Proposed.** Reason:
  there is no single interval after which a fact is wrong (glossary).
- Facts never checked show "not checked". Facts in fact state `unknown` show
  "unknown" plainly, never a blank. **Proposed.** Reason: the `workspace`
  repository's rule that unknown and not verified are valid, visible outcomes.
- Fact states are labelled in words: intended ("should be"), observed
  ("seen"), `planned`, and unknown. **Decided** that the fact state `proposed`
  is renamed `planned` (owner, O-5, [#25]); the labels are **proposed**.
  `planned` facts show no age, following the Catalog draft.
- **Discrepancies:** when an intended fact and an observed fact disagree, both
  are shown together with their sources and check times. Neither is presented
  as the right one. **Proposed**, following the glossary.
- The same freshness display is used wherever a fact appears outside its page,
  for example in search results or a task's related entities. **Proposed.**
  Reason: a fact quoted without its age loses the trust signal.

### Moving around the wiki

- An index per entity type, each a sortable list with entity status, entity
  owner and the freshness summary. This includes workspace-defined types next
  to the eight built-in ones. **Decided** that custom entity types are allowed
  in the first version (owner, O-17, [#25]); the index is **proposed**.
- Workspace-wide lists the Catalog draft asks for: discrepancies, facts due
  for recheck, known unknowns, [recent changes](#reviewing-catalog-changes),
  and catalog proposals waiting for approval. **Proposed.**
- Search, and links between pages.
- A **Start here** link from the wiki's first page.

**Proposed.** Reason: the `workspace` repository's catalog is navigated the
same way (per-type indexes and links) and that works.

### Changing the catalog from the wiki

- **Suggest a change** opens the page's text and fields for editing. Saving
  creates a catalog proposal. Only high-risk (gated) classes of change need
  catalog approval, from the start; the rest apply at once. **Decided**
  (owner, O-3, [#25]). Which classes are gated is owned by the
  [Catalog](catalog.md) document (its draft gates rules, lifecycle, people and
  agents, and doubtful changes). Before saving, the screen says whether the
  change applies at once or waits for approval, and shows the Catalog
  document's validation results. **Proposed.**
- **Record a check** lets a person record that they checked a fact. It asks
  what was checked (the scope) and how (the source), and cannot be saved
  without both. If the value and fact state are unchanged, only the
  last-checked time moves. Otherwise it becomes a catalog proposal, applied or
  gated by the same rule. **Proposed.** Reason: the `workspace` repository's
  rule that dates refer to actual checks and must not be refreshed
  mechanically.

### Reviewing catalog changes

**Catalog review** has two lists. **Proposed.**

- **Waiting for approval:** gated catalog proposals, oldest first. The review
  screen shows, per entity changed, each fact before and after (value, fact
  state, source, last checked), body text changes, the evidence, the related
  task, the author with attribution, and agents' review comments. Actions:
  **Approve**, **Reject** with a reason, and **Comment**. Only people approve.
  While one person uses Shinan, they may approve their own agent's proposals
  (owner, O-46, [#25]); the screen marks such proposals "from your agent".
- **Recent changes:** catalog changes that applied without approval, grouped
  per proposal, newest first, each with **Revert** (one action, which creates a
  new proposal restoring the earlier values, following the Catalog draft).
  **Proposed.** Reason: with most changes applying at once (O-3), review after
  the fact is how people stay informed and correct mistakes.

If catalog accuracy slips during the trial, the workspace switches to strict
approval (owner, O-3, [#25]); the setting is in
[catalog settings](#workspace-settings).

## Start here and onboarding

"Start here" is one special catalog document with two ordered paths, one for
people and one for agents, built from the same catalog pages and changed only
with catalog approval. **Decided** (owner, O-18, [#25]). Its content rules are
owned by the [Catalog](catalog.md) document; this section is how it is shown.

### Start here for people

- **Orientation:** what this workspace is for, the main projects, the machines
  and how access to them is arranged (prerequisites, never credentials), the
  key policies (for example deployment approval), how tasks and nudges work
  here, who's who, and how to connect your own agent.
- Shown as numbered steps, each opening its entity page. Each step shows
  whether the person has opened it, and whether it changed since they did.
  **Proposed.** Reason: the catalog keeps changing; a returning person should
  see what is new without rereading everything.
- Changing the path is done with **Suggest a change** on the start-here
  document, which needs catalog approval. **Decided** (owner, O-18, [#25]).
- A new member lands on the path after accepting an invitation (see
  [joining a workspace](#joining-a-workspace)).

### Start here for agents

- **Rules and routing:** this workspace's policies an agent must follow, how to
  find the right project and its owning repository, when and how to ask for a
  person, and what needs deployment approval. This replaces today's
  `agent-entrypoint.md` in the `workspace` repository; rules that apply to
  every workspace ship with the skill (Agent integrations).
- Agents receive the path through the MCP server and skill. How is owned by
  [Agent integrations](agent-integrations.md).
- **Preview as agent** shows exactly what an agent is given, in order, so the
  owner can check it. **Proposed.** Reason: today the owner can read
  `agent-entrypoint.md` directly; they must still be able to see what agents
  are told.
- The page shows the total size of the agents' path and warns when it grows
  large. **Proposed.** Reason: every agent session reads all of it.

### First run for a new workspace

Shinan starts empty (D-018). A new workspace's Now screen shows a setup
checklist until it is done or dismissed:

1. Connect a git host. Existing issues are not imported unless the person asks
   (owner, O-23, [#25]); the connection screen offers **Import existing issues
   into triage**.
2. Register your first agent and connect it (see [your agents](#your-agents)).
3. Start the catalog: create the first entities, or ask an agent to propose
   them.
4. Write the start-here document.
5. Create a first task, or let outside issues arrive in triage.
6. Invite members (optional; built before a second member joins, O-49).

**Proposed.** Reason: an empty workspace gives no hint of what to do first, and
the order follows the dependencies.

## Triage

Outside issues become tasks in `triage` from the first day (D-003). **Decided.**

- **Phase 1:** the task list filtered to `triage`, reachable from
  [Needs you](#1-needs-you). Each task page offers **Accept** and **Cancel**.
  **Proposed**, matching the roadmap draft. Reason: outside issues arrive
  whether or not the inbox exists.
- **Phase 2: the triage inbox** (plan, section 10). For each task in `triage`:
  the outside issue's title and short summary, the repository, the outside
  actor who opened it, when, and "origin closed" if its author has closed it.
  Actions as defined by [Tasks and work](tasks.md): **Accept** (optionally
  assign and edit the intent), **Merge into an existing task**, and **Cancel**
  with a reason. Batch accept and cancel are offered. Only people see these
  actions. **Proposed** screen. Reason: connecting a busy repository can bring
  many issues at once.

## Unlinked work

[Tasks and work](tasks.md) proposes a list of branches and PRs in connected
repositories that carry no task ID. This document proposes the screen: each
item shows repository, kind, title, who made it (with attribution confidence)
and age, with **Link to a task**, **Create a task from it** and **Dismiss**.
Its count is shown in the task list, not in Needs you. **Proposed.** Reason: a
forgotten marker is a small slip, not something that blocks agents.

## Notifications

Notifications are phase 2 (plan, sections 5 and 10). **Decided.** Shinan sends
email from the first version, for sign-in links (owner, O-41, N-7, [#25]),
through the AWS SES API (owner, N-6, [#25]), so email is available as the first
channel. No document in plan section 8 owns
notifications; this document proposes the person's side, and how they are sent
is an [open question](#open-questions).

- **What is sent:** the [Needs you](#1-needs-you) items, and replies by people
  or agents to the person's own comments. Nothing else by default.
  **Proposed.** Reason: notifications should bring a person back only for what
  needs them.
- **Per-person settings** in [your account](#your-account): which kinds of
  item, per workspace; immediately or as a daily summary; and quiet hours.
  Deployment approval requests are sent immediately unless the person turns
  them off. **Proposed.** Reason: deployment approval blocks finished work.
- **Content:** a short title, the workspace and task ID, and a link that
  requires sign-in. No fact values, approval details or comment text.
  **Proposed.** Reason: notifications leave the signed-in app, and the
  workspace holds infrastructure details (D-015).

## Workspace and member management

What each role may do is owned by [Identity](identity.md). Workspace roles
are owner and contributor only; there is no viewer role. **Decided** (owner,
N-11, [#25]). This section describes the screens. Actions a person's role does
not allow are not offered. **Proposed.**

All changes below are events on the workspace timeline, at full prominence, and
security-relevant ones are also in the security log. **Proposed.** Reason:
membership, tokens and git host connections control access to infrastructure
details (D-015).

### Creating and switching workspaces

- A workspace switcher lists the person's workspaces and their role in each.
  **Proposed.**
- **Create a workspace** asks for a name and a task ID prefix, and says that
  the prefix cannot be changed later. **Decided** that each workspace has its
  own prefix (owner, O-6, [#25]). It makes the person its workspace owner, then
  opens the [setup checklist](#first-run-for-a-new-workspace). Whether any
  signed-in person may create a workspace is owned by [Identity](identity.md).

### Workspace settings

For workspace owners.

| Screen | Shows | Actions |
|---|---|---|
| General | Name, task ID prefix, creation date, workspace owners | Rename; delete workspace (typed confirmation, consequences listed first) |
| Members | Each member: name, role (workspace owner or contributor), joined, invited by, linked git host accounts, their agents, last active | Change role; remove member. The last workspace owner cannot be removed or made a contributor |
| Invitations | Pending, expired and declined invitations with role and who invited | Invite; resend; withdraw |
| Agents | Every agent: name (person, coding tool and machine), member it acts for, state, last agent session seen, its tokens (created, last used) | Disable an agent; revoke a token |
| Git host connections | Each connection: git host, account used, repositories covered, who set it up, health, last successful contact | Add; reconnect; change repositories covered; import existing issues into triage; remove |
| Task flags | Built-in and workspace-defined flags, each with its description, whether it shows in Needs you, and how many tasks have it | Add; edit; remove |
| Catalog settings | Approval mode (gated classes only, or strict), workspace-defined entity types | Change (options owned by the [Catalog](catalog.md) document) |
| Security log | Security-relevant events, kept forever | Read only |
| Data | What can be purged, including operational records about this workspace | Purge (typed confirmation). Installation-level security-log entries are not offered |

**Proposed** screen set, based on these answers: task flags managed per
workspace (owner, O-8, [#25]); approval mode (O-3); custom entity types
(O-17); the security log is kept forever (O-47); only workspace owners can
purge, and installation operators cannot (O-50); installation-level
security-log entries cannot be purged by anyone (N-8). Reason: one screen per thing
the workspace owns.

Screen details:

- **Task flags.** Removing a built-in flag warns what it affects: its panel,
  its Needs you row, and agents' conventions that use it (for example removing
  `awaiting deployment approval` removes the deployment approval panel).
  Calculated flags such as `blocked` are listed but cannot be edited. Tasks
  keep a record of a removed flag in their history. **Proposed.** Reason:
  [small and legible](#design-principles) means saying what a change affects.
  The rules for flags are owned by [Tasks and work](tasks.md).
- **Git host connections.** A Forgejo connection is read-only: Shinan makes
  no writes there, so there are no backlinks on Forgejo. It uses the
  connecting person's own Forgejo account and accepts any token, and anyone
  can enter any Forgejo address to connect. **Decided** (owner, O-53, O-54,
  N-4, N-7, [#25]). Before saving, the screen states the risk plainly: Shinan
  only reads, but the stored token can do whatever its owner can, and a broad
  token (for example a site administrator's) could act as any user on that
  Forgejo if it were stolen; the token is stored encrypted. A repository
  already connected to another workspace cannot be added (owner, O-59, [#25]).
  **Proposed** wording.
- **Removing a member** lists the consequences first: their agents and tokens
  that will be disabled, tasks they are assigned to, agent sessions of theirs
  attached to tasks, and git host connections they set up. **Proposed.**
  Reason: an agent acts for a member, so removing a member must not leave
  agents running in their name. The rules are owned by [Identity](identity.md).
- **Invitations.** Joining a workspace needs an invitation; whether a person
  can have an account at all is decided by the installation's email allowlist.
  **Decided** (owner, O-48, [#25]). The invitation screen names the person and
  the role, and warns if the invitee's email address is not on the allowlist,
  since they could not sign up. The allowlist itself is an installation
  setting, owned by [Identity](identity.md) and
  [Architecture](architecture.md). **Proposed.**
- Sensitive actions (changing roles, revoking tokens, adding git host
  connections, purging, deleting the workspace, giving deployment approval)
  may ask the person to sign in again. Which ones is owned by
  [Identity](identity.md).

### Joining a workspace

1. The invited person follows the invitation and signs in, or creates an
   account if their email is on the allowlist. Sign-in is by an emailed
   sign-in link or GitHub only. **Decided** (owner, O-48, N-7, [#25]).
2. They see the workspace name, who invited them and the role, and accept or
   decline.
3. On accepting, they are asked to link their git host accounts, if not
   already linked, with a short reason: "so Shinan can show what you and your
   agents did on GitHub and Forgejo". Forgejo accounts on any address can be
   linked, but are never used to sign in (N-7). Each link is verified before
   it counts (glossary, Git host account); how is owned by
   [Identity](identity.md).
4. They are offered to [register an agent](#your-agents) now or later.
5. They land on [start here for people](#start-here-for-people).

**Decided** that invitations exist (D-019). The flow is **proposed**. Reason:
linking git host accounts is how git host activity is credited at all. Shinan
does not store git host tokens for people (owner, O-1, [#25]); linking is for
credit, and a linked GitHub account can also be used to sign in (N-7).

### Your account

Each person has an account area, separate from any workspace: profile,
sign-in (an email address for sign-in links, and an optional linked GitHub
account; owned by [Identity](identity.md)), linked git host accounts,
the workspaces they belong to with their role, pending invitations,
[notification settings](#notifications) (phase 2), and
[your machines](#your-machines-phase-3) (phase 3). **Proposed.**

### Your agents

An agent is per person, coding tool and machine, for example "Guneet's
OpenCode on Daedalus". **Decided** (owner, O-40, [#25]). Agents belong to one
workspace. In each workspace, a member sees **Your agents**:

1. **Register an agent:** the coding tool and the machine; the name is
   suggested from them.
2. **Connect:** short instructions for that coding tool. Installing the plugin
   also sets up the MCP server and skill (owner, O-36, [#25]); without a
   plugin, add the MCP server and skill. The content is owned by
   [Agent integrations](agent-integrations.md).
3. **Approve the agent's token:** the person approves it in the browser when
   the coding tool asks, or creates one by hand, shown once. Tokens last until
   revoked. **Decided** (owner, O-44, [#25]). How tokens are issued is owned by
   [Identity](identity.md).
4. **Waiting for first contact:** the screen waits until the agent's first
   agent session reaches Shinan and then confirms what is working. Phase 1:
   "Presence: plugin-reported" or "Presence: self-reported only (no plugin)".
   Phase 2 adds how nudges will arrive: "live" or "when it calls Shinan".
   **Proposed.** Reason: the person learns now how well Shinan will be able to
   see and reach this agent.

From the same screen a member can rename or disable their agents and revoke
tokens. Because tokens never expire, the screen shows each token's last use,
so unused ones are easy to spot and revoke. **Proposed.** Reason: long-lived
tokens (O-44) make revoking unused ones the main protection.

### Your machines (phase 3)

A person registers a machine for launching agents by installing the launcher
on it; a device setup guide (for example for a VM or a MacBook) explains how.
**Decided** (owner, O-1, [#25]). This screen lists the person's registered
machines with their coding tools and last contact, links to the setup guide,
and offers **Remove**. The guide is part of Shinan's own built-in help, the
same for every workspace, and is also linked from the launcher's install step.
**Proposed.** Reason: it is product help, not team knowledge, so it does not
belong in a workspace's catalog. Only the person's own machines are offered when they
[start an agent session](#when-no-agent-session-is-attached). **Proposed**
screen. The guide's content is owned by
[Agent integrations](agent-integrations.md).

## Phasing

How this document's screens map to the plan's phases (plan, section 10). The
[Roadmap](roadmap.md) decides the exact first release; its draft splits phase
2 into 2a (collaboration) and 2b (migration).

| Phase | Screens | Status |
|---|---|---|
| 1 | Now screen; task list with ranking and the `triage` filter; task page with comments, panels, subtasks and steering actions (changes are events agents see when they next read the task); timelines; agents view; wiki with start here; catalog review and recent changes; unlinked work; workspace settings for one owner; your account and agents | Decided that the wiki, tasks, timeline and presence are phase 1 (plan, section 10); the rest proposed |
| Before a second member joins | Invitations, the contributor role in screens, member removal | Decided (owner, O-49, [#25]: D-019 read as "design now, build before the second member") |
| 2 | Board; nudges (recipients, delivery states, waiting comments, "nudge not received"); triage inbox; notifications | Decided (plan, section 10). Board and triage inbox are required before migration (owner, O-78, [#25]) |
| 3 | Your machines; starting agent sessions from the task page through a launcher | Decided (plan, section 10; D-014; owner, O-1, [#25]) |

## How today's practice maps to these screens

For reference. Coordination for trial projects moves into Shinan during the
trial (owner, O-73, [#25]); otherwise the `workspace` repository stays the
source of truth until migration (D-018).

| Today, in the `workspace` repository | In Shinan |
|---|---|
| `human-effort` label and TL;DR comment | `needs a person` task flag and its [panel](#needs-a-person-panel); listed in [Needs you](#1-needs-you) |
| Asking for deployment approval in the conversation or issue | The [deployment approval panel](#deployment-approval-panel), first in Needs you; approval in the conversation is still recorded |
| Forgejo Project board for workflow | [Board](#board-phase-2) with columns by task status |
| `last_verified`, `verification_scope`, `verification_source` per catalog entry | Last checked, check scope and source per fact, shown as [freshness](#how-freshness-is-shown) |
| `docs/agent-entrypoint.md` | [Start here for agents](#start-here-for-agents) |
| Announcing an agent's identity in an issue comment when agents share an account | Presence and "acting for" on every agent event |

## Dependencies on other documents

The sibling drafts were read again on 2026-11-16 at the commits shown. They
include the first batch of owner answers but not the follow-up answers N-1 to
N-11. The mismatches below are for the integration review.

| Document (commit read) | What this document needs from it | Known mismatches |
|---|---|---|
| [Domain model and glossary](domain-model.md) (`0e4bfcd`) | All terms. | Still lists a viewer role (N-11), password and Forgejo sign-in methods (N-7), and a Git mirror term (N-5). Its open question 4 (how subagent sessions are grouped on screen) is answered [here](#2-being-worked-on-now) and in the [agents view](#agents-view). |
| [Tasks and work](tasks.md) (`fae89ac`) | Status rules behind each explanation; required fields for `needs a person` and deployment approval requests, and what makes an approval stale; when comments become nudges; batching of waiting nudges; triage actions; unlinked work; rules for workspace-defined flags; which git host actions a person can ask for (N-3). | Subtasks limited to one level (N-1 allows any depth); a "viewer" row in its nudge table (N-11). |
| [Agent integrations](agent-integrations.md) (`88acc1d`) | Presence thresholds (`unresponsive`, the 30-minute display threshold, 24-hour release, 30-day end); waiting reasons; delivery holders and outcomes; the "reply to nudge" tool; delivering git host action requests (N-3); the ready-made start prompt; connect instructions; the device setup guide's content and the launcher (phase 3); whether an agent session can be stopped from Shinan. | Says Shinan's own Forgejo writes go through the connecting person's account (N-4: no Forgejo writes). It asks this document where the device setup guide lives: answered in [your machines](#your-machines-phase-3). |
| [Identity, agents and permissions](identity.md) (`03207c7`) | What each role may do; who may approve catalog proposals and give deployment approval; removal effects; which actions need signing in again; who may create workspaces; the email allowlist and invitations; token issue and revocation; linking Forgejo accounts on any address. | Password and Forgejo sign-in (N-7: email link or GitHub only); viewer role and read-only agents (N-11); security-log purge rules to align with N-8. |
| [Catalog](catalog.md) (`78d6bb1`) | Gated classes; validation results shown in the editor; recheck intervals; the start-here document; workspace-wide lists; revert; comparing revisions. | Always-on Git mirror and its layout (N-5: no mirror for now). |
| [Git host integrations](git-hosts.md) (`98333b8`) | Connection health and reconciliation thresholds; how unconfirmed links and mentions are detected; where the automated-account list lives; the origin-issue reminder; which git host actions a person can ask for. | Backlinks and write scopes on Forgejo (N-4: Forgejo connections are read-only). |
| [Architecture and operations](architecture.md) (`d3ca54e`) | How screens update while open; how notifications and sign-in email are sent; purge of operational records. | Always-on Git mirror (N-5); email through SMTP (N-6: the AWS SES API). |
| [Roadmap and migration](roadmap.md) (`820f2a6`) | Which phase 1 screens are in the first release. | Viewer test account (N-11 drops it); Git mirror as a first-version item and as the catalog's exit copy (N-5). |

## Open questions

1. **Stopping an agent session.** Should the task page offer "stop" as well as
   "detach", and can a plugin do it? ([Agent integrations](agent-integrations.md))
2. **Who owns notifications.** No document in plan section 8 owns how
   notifications are sent (channels, delivery, failures). Recommended: the
   [Architecture](architecture.md) document for sending, starting with email
   (already sent for sign-in links, N-6, N-7); this document for what is sent
   and the person's settings.

## Decisions needed from the owner

None. All earlier decisions and the follow-ups N-1 to N-11 were answered in
[#25] and are marked Decided above. The screens these answers need (task flags,
purge, security log, your machines, recent changes, asking your agent to act on
a git host) are proposals that follow directly from them.

[#25]: https://github.com/guneet-xyz/shinan/issues/25
