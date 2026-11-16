# Human experience

Status: **draft for review** ([issue #10](https://github.com/guneet-xyz/shinan/issues/10)).

This document describes what people see and do in Shinan's web app: the screens,
what each shows, and the flows between them. It covers the wiki and the start
here path, task pages, timelines, the board, nudges as a person sees them, the
agent presence view, and workspace and member management.

It describes screens and flows in words. It does not choose a visual style,
layout grid, colours or technology (D-020: the technology stack is chosen
later from the architecture document's options).

## How to read this document

- Terms come from the [domain model and glossary](domain-model.md) and are used
  exactly as defined there. That document is still in review
  ([PR #14](https://github.com/guneet-xyz/shinan/pull/14)); where one of its
  open questions or decisions needed from the owner affects a screen, this
  document says so and works with either answer.
- Every statement is marked:
  - **Decided**: follows from an accepted decision in the
    [plan](plan.md#6-decisions-so-far), which is cited and gives the reason.
  - **Proposed**: suggested here, with a reason. The owner confirms or changes it.
  - **Open**: not settled; listed under [open questions](#open-questions) or
    [decisions needed from the owner](#decisions-needed-from-the-owner).
- Where a rule belongs to another document (for example who may approve a
  catalog proposal), this document only says how the screen shows it and lists
  the dependency in [dependencies on other documents](#dependencies-on-other-documents).
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
gives Human experience ownership of how presence is displayed), the
[triage inbox](#triage-inbox) and [catalog proposal review](#reviewing-a-catalog-proposal).

It does not cover:

- What a task status means, how it is calculated, or when a nudge is created.
  These belong to [Tasks and work](tasks.md).
- How nudges reach a running agent session, or how presence is reported. These
  belong to [Agent integrations](agent-integrations.md).
- Catalog entity types, fact rules and the approval rules for catalog
  proposals. These belong to the [Catalog](catalog.md) document.
- Sign-in, roles, tokens and access rules. These belong to
  [Identity, agents and permissions](identity.md).
- When each screen ships. This belongs to the [Roadmap](roadmap.md); the
  [phasing](#phasing) section here only maps screens to the plan's phases.

## Design principles

These shape every screen below.

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
   change intent and acceptance criteria, comment and nudge, set task flags
   and manual states, accept or cancel tasks in triage, approve catalog proposals, assign
   people. It does not offer code review, CI controls or a pull request view.
   **Decided** (D-001: Shinan sits above git hosts and does not replace them).
   Every work item links straight to its git host page.
4. **Show how sure Shinan is.** Facts show their fact state, source and how
   long ago they were last checked; credits show their attribution confidence;
   presence shows whether it is self-reported; anything read from a git host
   shows when Shinan last read it. **Decided** for facts (D-007: trust is the
   main differentiator). **Proposed** for the rest, for the same reason.
5. **Explain calculated things.** Wherever Shinan shows something it calculated,
   such as a task status or `blocked`, a person can see why in one step.
   **Proposed.** Reason: status is calculated, not set by hand (D-005), so a
   person cannot fix a wrong status by editing it; they need to see which work
   link caused it.
6. **Link, don't copy.** Pages show a short summary of a work item or owning
   source and link to it. **Decided** (D-001, D-006 and plan section 3:
   Shinan does not copy facts that another system owns).
7. **One person and a team see the same app.** Screens show members, roles and
   "acting for" from the first version, even with one member. **Decided**
   (D-019: adding multi-user support later would mean reworking data,
   permissions and sign-in).
8. **Usable from a phone for steering.** The Now screen, task pages,
   commenting, nudging and approving work on a small screen. Browsing large
   wiki pages and settings may be desktop-first. **Proposed.** Reason: the app
   is on the public internet so the owner can reach it from anywhere (D-015);
   the steering actions are the ones needed away from a desk.

## Map of the app

The app is organised per workspace. A person who belongs to several workspaces
switches between them; nothing from one workspace appears in another.
**Proposed**, following the glossary's proposed rule that nothing is shared
between workspaces except a person's sign-in. Reason: workspaces hold
infrastructure details (D-015), so a hard boundary is the simplest to keep safe.

| Place | What it is for | Phase |
|---|---|---|
| [Now](#the-now-screen) | What needs me, what is being worked on, what changed | 1 |
| [Tasks](#task-list-and-board) | Task list (phase 1) and board (phase 2) | 1 and 2 |
| [Task page](#task-page) | The story of one task, and steering it | 1 |
| [Timeline](#timelines) | Everything that happened in the workspace | 1 |
| [Wiki](#the-wiki) | The catalog for people, including [start here](#start-here-and-onboarding) | 1 |
| [Agents](#agents-view) | Agent sessions and their presence | 1 |
| [Triage inbox](#triage-inbox) | Tasks created from outside issues, waiting to be accepted | 2 |
| [Catalog proposals](#reviewing-a-catalog-proposal) | Changes waiting for a person | 1 |
| [Workspace settings](#workspace-and-member-management) | Members, invitations, agents, git host connections, settings | 1 |
| [Your account](#your-account) | Profile, git host accounts, your agents, your workspaces | 1 |

Phases follow the plan (section 10): the board, nudges and the triage inbox are
phase 2; starting agents from the website is phase 3. **Decided** (plan,
section 10). Which phase 1 screens are in the very first release is for the
[Roadmap](roadmap.md).

A search box is available everywhere. It finds tasks (by task ID or words),
catalog entities, members and agents, and opens the result. **Proposed.**
Reason: the owner works across many repositories and projects; typing a task
ID such as `T-123` seen in a branch name should go straight to the task.

## The Now screen

The Now screen is the home page of a workspace. It has three sections, always
in this order. **Proposed.** Reason: [attention first](#design-principles).

### 1. Needs you

Everything waiting on a person, newest-blocking first. Each item says in one
line what is needed and opens the place to act. Items for you come first; a
second group shows items waiting on any person in the workspace, so nothing is
missed when nobody is assigned.

| Item | Shown when | One-step action |
|---|---|---|
| Task with `needs a person` | The task flag is set | Opens the task's [needs a person panel](#needs-a-person-panel) |
| Agent session `waiting` | An agent session is waiting for a person, for example on a question or a permission prompt in its coding tool | Opens the agent session, which says where to answer (see [open question 3](#open-questions)) |
| Agent session `unresponsive` with a task attached | An agent session working on a task has gone silent | Opens the task with options to nudge or [start a new agent session](#when-no-agent-session-is-attached) |
| Nudge not received | A nudge you sent is `undeliverable`, is still `pending` to an agent session that became `unresponsive`, or found no active session | Opens the comment with delivery options |
| Catalog proposal waiting for approval | A `pending` catalog proposal needs a person's approval | Opens [the review screen](#reviewing-a-catalog-proposal) |
| Tasks in triage (phase 2) | One or more tasks are in `triage` | Opens the [triage inbox](#triage-inbox) |
| Git host connection failing | A connection's health is failing | Opens the connection's settings |
| Invitation for you | You have a pending invitation to another workspace | Accept or decline |
| Workspace setup checklist | The workspace is new and setup is not finished | Opens the [setup checklist](#first-run-for-a-new-workspace) |

The Now screen shows a count of "needs you" items in the app's header on every
page. **Proposed.** Reason: notifications by email or chat come later (plan,
section 5), so the app itself must make waiting items visible.

Deployment approval: the glossary recommends a separate
`awaiting deployment approval` task flag; this is an owner decision (glossary
decision 5, owned by [Tasks and work](tasks.md)). Either way, a task waiting
for deployment approval appears in "Needs you" as its own row type, with the
target, the change and the risk visible before the person opens it, and opens
the task's [deployment approval panel](#deployment-approval-panel).
**Proposed.** Reason: deployment approval is the only workflow-level approval
gate in the `workspace` repository's practice, and D-016 requires it for every
deployment of Shinan itself, so it must never be buried.

### 2. Being worked on now

Every task with at least one attached agent session that has not ended, and
every task changed by a person in the last day. For each task: task ID, title,
task status, task flags, and one line per attached agent session:

> OpenCode session on Daedalus, acting for Guneet · busy · `shinan` repository ·
> last seen 2 minutes ago · "Writing the human experience document"

The last part is the agent session's latest progress update, if any. Agent
sessions are ordered `waiting`, `unresponsive`, `busy`, `starting`, then
self-reported agent sessions (which report no presence state, only when they
were last seen; see [agents view](#agents-view)), then `idle`.
**Proposed.** Reason: this answers "what is being worked on now" in one glance
and puts agent sessions that may need help first.

Agent sessions that are running but attached to no task are shown in a small
group at the end, "Not on a task". **Proposed.** Reason: work that is not tied
to a task cannot be steered through task comments, so the owner should see it.

### 3. Since you last looked

A short summary of what changed since the person's previous visit, grouped by
task: tasks done, pull requests merged, tasks created, catalog proposals
applied, facts that changed fact state, and new comments by people. Agent
activity appears only as counts ("3 agent sessions, 41 events") with a link to
the timeline. **Proposed.** Reason: the owner checks in between other work and
wants outcomes, not a replay.

## Task list and board

### Task list (phase 1)

A list of tasks with filters and saved views. Each row shows task ID, title,
task status, task flags (including `blocked`), assignees, attached agent sessions
with presence, the number of linked pull requests and their combined CI check
result, and the time of the last event. **Proposed.** Reason: these answer
"what is it, who has it, is it moving, does it need me" without opening it.

Filters: task status, task flag, assignee, agent, repository, related
catalog entity (for example a `project` entity), and "has an attached agent
session". Default view: everything not `done` or `cancelled`, with
`needs a person` first. **Proposed.**

A person can create a task from the list: title, intent, acceptance criteria,
optional assignee and related catalog entities. **Decided** that tasks can start
in Shinan (D-003: a task starts where the intent starts). The fields are owned
by [Tasks and work](tasks.md).

### Board (phase 2)

The board shows the same tasks in columns by task status: `triage`, `to do`,
`in progress`, `in review`, and recently `done`. Tasks in `triage` show
**Accept** and **Cancel** buttons. **Decided** that the board is
phase 2 (plan, section 10). Columns by task status are **proposed**. Reason:
it mirrors the flow people already use on the `workspace` repository's Forgejo
Project, but without moving anything by hand.

Rules:

- **Tasks cannot be dragged between status columns.** Status is calculated from
  linked work (and, if the owner accepts glossary decision 1, recorded events
  such as verification). A task moves when its work moves. **Decided** (D-005:
  copied or hand-set status goes stale). The board says so when someone tries,
  and links to the [status explanation](#status-explanation).
- **Task flags are badges, not columns.** A task can be `in progress` and
  `needs a person` at once. Tasks with `needs a person` (or
  `awaiting deployment approval`, if adopted) also appear in a row pinned
  above the columns, so they cannot scroll out of view. `on hold` tasks are
  dimmed. `cancelled` tasks are hidden unless filtered for. **Proposed.**
  Reason: the glossary keeps flags separate from status so both are
  true at once; the pinned row keeps attention on what blocks progress.
- **Each task on the board** shows task ID, title, assignee, presence of its
  attached agent sessions, linked pull request count and CI check result,
  `blocked`, and how long since its last event. **Proposed.**
- **Grouping:** none, by assignee, or by related `project` entity. **Proposed.**
  Reason: the owner works across many projects; grouping by project shows where
  effort is going.
- **Priority:** whether people can rank tasks in the `to do` column to say what
  should be worked on next is open; see
  [decision needed 2](#decisions-needed-from-the-owner).

## Task page

The task page is where the story of a task is read and where a person steers
it. From top to bottom:

### Header

Task ID, title, task status, task flags, assignees, origin
(created in Shinan, from an outside issue, or from a conversation), and the
attached agent sessions with their presence. **Proposed** layout; the fields follow
the glossary's task definition.

### Status explanation

Next to the status, a one-line reason in words, opening a short list of the
evidence:

> In review, because pull request #14 in `guneet-xyz/shinan` on GitHub is open
> and ready for review. Last read from GitHub 3 minutes ago.

For `blocked`, it names the task it depends on and that task's status. For
`done`, it names the merged work and, where the acceptance criteria needed more
than the merge, the recorded verification and who recorded it (glossary, task
status). **Proposed.** Reason:
[explain calculated things](#design-principles). The words follow the rules in
[Tasks and work](tasks.md).

### Needs a person panel

When `needs a person` is set, a panel sits directly below the header. It
carries the same short summary that today's `human-effort` TL;DR comment
carries in the `workspace` repository's practice:

- **What is needed**, in one sentence.
- **Action:** the steps, where to do them, and links to runbooks.
- **Why a person:** missing access, a secret to type, a physical step, or a
  decision that belongs to the owner.
- **Then:** what this unblocks and what the agent will do next.

Buttons: **Done**, which asks for a short result and clears the flag (and
nudges attached agent sessions with the result); **Comment**; and **Not
needed**, which clears the flag with a reason. Secret values are never asked
for; the panel says where to type them. **Proposed.** Reason: the TL;DR format
already works for the owner today; making it a panel puts it first instead of
somewhere in a comment thread.

The glossary recommends that agents may set and clear `needs a person`, with
the summary required; this is an owner decision (glossary decision 2). The
panel works either way: it always shows who set the flag and when, and if an
agent clears it, that appears as a milestone event on the timeline.

### Deployment approval panel

When a task waits for deployment approval, a panel sits directly below the
header (above the needs a person panel, if both apply). It shows what the
`workspace` repository's practice requires a deployment approval to name: the
target and environment, the operation and revision, expected impact and risks,
how it will be verified, how to roll back, and any coordination or lock.
Buttons: **Approve** (records the deployment approval with its scope and
revision), **Decline** with a reason, and **Comment**. Approving nudges the
attached agent sessions. If any of the listed items is missing, **Approve** is
unavailable and the panel says what is missing. **Proposed.** Reason:
deployment approval is the one approval gate in today's practice, and D-016
requires it for every deployment of Shinan itself; asking for it in a fixed
shape makes it quick to give safely.

Whether this is the separate `awaiting deployment approval` flag or a kind of
`needs a person` is an owner decision (glossary decision 5). The panel is the
same either way. What a recorded deployment approval contains is owned by
[Tasks and work](tasks.md).

### Intent, acceptance criteria and decisions

The task's intent (what and why), its acceptance criteria as a checklist, and
decisions made along the way. Each criterion shows who last changed it and,
when it is marked met, the evidence (a link to a work item or event).
People edit these directly; edits are events. **Proposed.** Reason: intent and
acceptance criteria are the main way the owner steers, so they must be easy to
change and easy to see changed.

Each decision has a **Record as a `decision` entity** action, which creates a
catalog proposal. **Proposed**, following the glossary's proposal that lasting
decisions on a task are promoted to `decision` entities.

### Work

Work items linked to the task, grouped by repository, each showing kind, title,
state on the host, work link role (`origin`, `delivers`, `related`), its CI
check result for pull requests, and when Shinan last read it. Details show how
the work link was made and by whom. Each links to the git host. **Proposed.**
Reason: link, don't copy (D-001); the "last read" time is the freshness of
everything shown about that work item.

A person can add, change the role of, or remove a work link. **Proposed**;
the rules are owned by [Tasks and work](tasks.md).

If a work item is in a repository the person cannot see, the page shows that
a linked item exists without its title or link. Whether even that is shown is
open (plan question 3, owned by [Identity](identity.md)).

### Related

Related tasks (depends on, depended on by), related catalog entities, and
catalog proposals made during this task. **Proposed.**

### Task timeline and comment box

The task's [timeline](#timelines), with the [comment box](#comments-and-nudges)
at the end of it, which is also reachable from a fixed button so it is always
one step away. **Proposed.**

### Steering actions

All in one menu on the task page, and the common ones as buttons:

| Action | Notes | Status |
|---|---|---|
| Comment, and nudge attached agent sessions | See [comments and nudges](#comments-and-nudges) | Decided that comments create nudges (plan, Nudges pillar) |
| Accept or cancel a task in `triage`; set or clear `on hold`, `cancelled`, `needs a person` | Asks for a short reason, which becomes part of the event | Decided that some states are set by hand (plan, Tasks pillar); names and who may set each are proposed in the glossary |
| Edit intent and acceptance criteria | Attached agent sessions are nudged with the change | Proposed. Reason: an agent working from old criteria wastes work |
| Assign or unassign members | Assignment is not a lock | Proposed (glossary, Assignee) |
| Start a new agent session for this task | See [below](#when-no-agent-session-is-attached) | Decided (plan, Nudges pillar) |
| Detach an agent session | Removes an agent session from the task; the agent session is nudged | Proposed. Reason: the owner must be able to redirect work. Whether Shinan can also stop an agent session is open |

## Comments and nudges

A comment is a person's message on a task. A nudge is that message delivered
to the agent sessions working on the task. **Decided** (plan, Nudges pillar;
glossary, Nudge). When nudges are created is owned by
[Tasks and work](tasks.md); how they are delivered is owned by
[Agent integrations](agent-integrations.md). This section describes what the
person sees.

### Before sending

Above the send button, the comment box shows who will receive the message and
how, worked out from the attached agent sessions and their presence:

| Situation | What the box says | Send button |
|---|---|---|
| An agent session with a plugin is running (presence `plugin-reported`, not `ended` or `unresponsive`) | "Guneet's OpenCode on Daedalus will get this now." | **Send now** |
| An agent session is attached but can only receive at check-in (presence `self-reported`, or the plugin is not reachable) | "Guneet's Codex on Musashi will see this the next time it checks in. Last checked in 12 minutes ago." | **Send, deliver at check-in** |
| An agent session is attached but `unresponsive` | "The attached agent session has not been seen for 2 hours. It may never pick this up." with **Start a new agent session** beside it | **Send anyway** |
| No agent session is attached | "No agent is working on this task." with **Start a new agent session** | **Comment** |
| Several agent sessions are attached | One line per agent session, each with a tick box, all ticked | As above, for the best delivery available |

**Proposed.** Reason: the person must know, before they send, whether their
words will reach an agent now, later, or not at all; this is the purpose of the
glossary's delivery states.

A tick box, **Tell the agent**, is on by default whenever an agent session
is attached. Turning it off posts a comment that is not sent as a nudge (agents
can still read it when they read the task). **Proposed**; see
[decision needed 1](#decisions-needed-from-the-owner). Reason: most comments on
a task an agent is working on are meant to steer it, but people also need to
leave notes.

Whether live delivery interrupts a `busy` agent session immediately or reaches
it after its current step depends on the coding tool and plugin (owned by
[Agent integrations](agent-integrations.md)). The box uses that document's
answer in its wording, for example "will get this after its current step".
**Open** until that document settles it.

### After sending

The comment shows its delivery state on each target agent session and updates
without reloading:

| Delivery state (per target) | Shown as |
|---|---|
| `pending`, live delivery under way | "Sending to Guneet's OpenCode on Daedalus" |
| `pending`, waiting for check-in | "Waiting for Guneet's Codex to check in (sent 10:42; it was last seen 10:30)" |
| `delivered` live | "Delivered live to Guneet's OpenCode on Daedalus at 10:42" |
| `delivered` at check-in | "Delivered to Guneet's Codex at its check-in at 10:55" |
| `undeliverable` | "Not received: the agent session ended first" with **Start a new agent session** |
| No active session (recorded on the nudge) | "No agent got this" with **Start a new agent session** |

**Proposed** wording; the delivery states are **proposed** in the glossary,
which records one delivery per target agent session. Showing whether a
delivery was live or at check-in is **proposed**. Reason: it tells the person
how quickly the agent saw it. If live delivery fails, the comment shows that it
is now waiting for check-in. A delivery that is `undeliverable`, or still
`pending` to an agent session that has become `unresponsive`, appears in
[Needs you](#1-needs-you). **Proposed.** Reason: an instruction that silently
never arrives is the worst outcome for a person steering agents.

When the agent replies on the task or posts a progress update after the nudge
is delivered, that is shown under the comment as a compact agent event.
**Proposed.** Reason: the person sees cause and effect in one place.

### When no agent session is attached

**Start a new agent session** offers what is possible in the current phase:

- **Before phase 3:** Shinan shows a short ready-to-use start instruction for
  the person to paste into a coding tool on a machine of their choice, for
  example "Work on Shinan task T-123", with the relevant repository and a link
  to the agent [start here path](#start-here-for-agents). **Proposed.** Reason:
  the glossary's nudge definition has new agent sessions started by hand
  before the launcher exists (phase 3); a ready instruction makes that one
  paste. The task ID format may change (glossary decision 4).
- **Phase 3, with a launcher:** the person picks a machine, a coding tool and
  the agent to act as; Shinan asks that machine's launcher to start an agent
  session attached to the task. The page shows `starting` until the agent
  session checks in.
  **Decided** that this is phase 3 (D-014, plan section 10). The screen details
  are **proposed** and depend on [Agent integrations](agent-integrations.md).

Either way, comments sent while no agent session was attached are delivered to
the next agent session that claims the task. **Proposed**; see
[decision needed 6](#decisions-needed-from-the-owner). Reason: a person who
writes "do it this way" before an agent starts should not have to repeat it.

### Nudges without a task

Whether a person can nudge an agent session that is not attached to any task,
from the [agents view](#agents-view), is **open**. The glossary defines a nudge
as tied to a task. Recommended answer: no in the first version; the person
attaches the agent session to a task first. Reason: every instruction then has a home
in a task's story.

## Timelines

A timeline shows events in time order for one subject: a task, a catalog
entity, an agent session, or the whole workspace. **Decided** that the timeline
exists and that human activity stands out while agent activity is compact
(plan, Timeline pillar). Timelines per subject are proposed in the glossary.

### Three levels of prominence

| Level | Which events | How shown | Status |
|---|---|---|---|
| **Full** | Anything a person did: comments, intent and criteria changes, manual state changes, task creation, triage decisions, catalog approvals, work link changes, assignments. Comments by outside actors on an `origin` issue. | Full text, the person's name, and a distinct marker that it was a person. Never collapsed. | Decided that human activity stands out; which events count is proposed |
| **Milestone** | Agent or automatic events a person usually cares about: task status changes, `needs a person` set or cleared by an agent (if the owner allows it, glossary decision 2), a request for deployment approval, a recorded verification, a pull request opened, ready for review, merged or closed, a CI check failing or recovering, an agent session `waiting`, `unresponsive` or ending without finishing, an agent's question to people, a catalog proposal made. | One line, not collapsed, with the actor. | Proposed. Reason: these change what the person should do next, so they must not be hidden inside a collapsed group |
| **Compact** | All other agent and automatic activity: commits, pushes, progress updates, catalog reads, presence changes, CI checks passing, routine work link creation. | Grouped by agent session into one line per run of activity, for example "OpenCode session on Daedalus, acting for Guneet: 3 commits, 2 progress updates, CI passed (10:12 to 10:40)". Expands to the individual events. | Decided that agent activity is compact; grouping proposed. Reason: one line per run keeps a long agent effort to a few lines |

A person can switch any timeline between **Default** (as above), **People
only** and **Everything expanded**, and filter by actor, kind or repository.
**Proposed.**

### Showing who did what

- Agent actions read "agent session, acting for person", for example
  "OpenCode session on Daedalus, acting for Guneet". **Decided** (glossary,
  Acting for, from the plan's Timeline pillar).
- Attribution confidence is shown on credits that are not `recorded`: `marked`
  as a small label, `inferred` as "probably", and `unknown` as "Guneet or one of Guneet's
  agents (not sure which), from Guneet's GitHub account". The last follows the
  glossary's rule that an `unknown` action from a linked account is credited
  to the linked person, shown as "the person or one of their agents". **Proposed.** Reason:
  agents share the person's git host account (D-017), so some credits are
  guesses, and the timeline must not present a guess as fact (the same rule as
  D-007).
- Events with `unknown` attribution from a member's linked git host account
  are shown at **full** prominence, labelled as unsure. **Proposed**; see
  [decision needed 3](#decisions-needed-from-the-owner). Reason: missing a
  person's instruction costs more than seeing an agent's comment too loudly.
- Shinan's own actions read "Shinan". Outside actors show their git host
  account and the label "outside". **Proposed**, following the glossary's actor
  kinds.

### Freshness and corrections

- Each event shows its time as relative time ("12 minutes ago") with the exact
  time on hover or tap. **Proposed.**
- Events that Shinan found late through reconciliation show both when they
  happened and when Shinan learned of them. **Proposed.** Reason: otherwise a
  late event looks as if it had been visible all along.
- Each timeline shows when Shinan last heard from each git host it draws on,
  and a warning when a git host connection is failing or reconciliation is
  behind. **Proposed.** Reason: an empty timeline can mean "nothing happened"
  or "Shinan could not see"; the person must be able to tell which (plan
  question 4). Thresholds come from [Git host integrations](git-hosts.md).
- Events are not edited. A correction is a new event, shown next to the one
  it corrects, with the original marked "corrected". **Proposed**, following the
  glossary's event rule. Whether events can be redacted (for example to remove
  a secret) is open in the glossary; if they can, a redacted event stays in
  place and shows that it was redacted, by whom and when, so the history still
  shows that something happened. **Proposed.**
- A "since you last looked" divider marks where new events start.
  **Proposed.**

### The workspace timeline

The Timeline page shows the whole workspace, grouped by day and then by task,
with catalog and membership events in their own groups. Default filter is
**People and milestones**. **Proposed.** Reason: the workspace timeline is the
widest view and is useless if agent activity fills it.

## Agents view

Lists agent sessions that have not ended. Plugin-reported agent sessions are
grouped by presence state, `waiting` first, then `unresponsive`, `busy`,
`starting`, `idle`. Self-reported agent sessions form their own group, sorted
by last seen, because they cannot report `idle` or `waiting` (glossary,
Presence). For each: agent, member
it acts for, coding tool, machine, current task, repository, last seen, and
presence source. A second tab lists recently ended agent sessions. **Proposed.**
Reason: it is the operational view of "who is doing what right now".

Display rules:

- `self-reported` presence is labelled "self-reported" with a short
  explanation: "This agent only tells Shinan what it is doing when it calls
  Shinan. It may have stopped without saying so." Only its last-seen time is
  shown, never a presence state it cannot report. **Decided** that
  self-reported agent sessions are marked (plan, Agent presence pillar).
  Wording **proposed**.
- `unresponsive` is shown distinctly from `ended`, with the time last seen.
  The threshold is owned by [Agent integrations](agent-integrations.md),
  based on the plugin's reporting interval (glossary, Presence).
- An agent session's page shows its timeline: tasks it attached to and left, work it
  did, nudges it received and when. **Proposed.**

Registering agents and managing their tokens is under
[workspace and member management](#workspace-settings-workspace-owner).

## The wiki

The wiki is the catalog shown to people as readable pages. **Decided** (D-006:
the catalog is document-first so people can read it). The entity types, facts
and rules are owned by the [Catalog](catalog.md) document; this section is how
they look and how people move around them.

### An entity page

From top to bottom:

1. **Title, entity type, entity status and entity owner** (or `unknown`). `deprecated` and `retired`
   entities show a banner with the date and a link to the replacement.
   **Proposed**, following the glossary's entity status rule.
2. **Owning sources.** Links to where the authoritative information lives,
   such as a repository's README or a configuration file at a revision, shown
   before the facts. **Proposed.** Reason: link, don't copy; a reader should
   know where to go for the full truth before reading Shinan's summary.
3. **Freshness summary.** One line: how many facts, the oldest last checked,
   how many never checked, how many `unknown`, and any discrepancies. The only
   page-level date is the oldest last-checked time, calculated from the facts;
   no separate page date is shown. **Proposed**, following the glossary's rule
   that any page-level date is calculated from the facts. Reason: checking one
   fact does not refresh the others, so a stored page date would mislead.
4. **Facts.** Each fact shows the claim, its [freshness](#how-freshness-is-shown),
   its fact state, its source (as a link where possible), who checked it and the
   check scope. **Decided** that these are recorded (D-007). Layout
   **proposed**. The glossary defines a fact as the smallest unit that carries
   its own state, source and last-checked time, and leaves the exact unit (for
   example a structured field or a marked statement) to the Catalog document;
   the page shows freshness at that unit.
5. **Body text.** The readable description.
6. **Links.** Related entities, and pages that link to this one. **Proposed.**
7. **Tasks.** Unfinished tasks related to this entity, and recently done ones.
   **Proposed.** Reason: the owner can see what is changing about a project or
   machine without searching.
8. **Pending catalog proposals** for this entity, as a banner near the top when
   any exist. **Proposed.**
9. **History.** The entity's timeline: catalog proposals applied, facts
   checked, state changes. **Proposed.**

### How freshness is shown

- Each fact shows how long ago it was last checked in words ("checked 3 days
  ago"), with the exact date on hover or tap. **Proposed.**
- Freshness is shown as age, not as right or wrong. Shinan does not mark a fact
  as "stale" by default. **Proposed.** Reason: there is no single interval after
  which a fact is wrong (glossary, Freshness); age is a risk signal for the
  reader to weigh.
- If the [Catalog](catalog.md) document lets a workspace set a "recheck after"
  period for an entity type or fact, facts past it are highlighted and listed
  on a "Due for a check" page. **Proposed**, dependent on the Catalog document;
  see [decision needed 4](#decisions-needed-from-the-owner).
- Facts never checked show "not checked". Facts in fact state `unknown` show
  "unknown" plainly, never a blank. **Proposed.** Reason: the `workspace`
  repository's rule that unknown and not verified are valid, visible outcomes.
- Fact states are labelled in words: intended ("should be"), observed ("seen"),
  proposed ("planned") and unknown. The glossary recommends renaming the
  `proposed` fact state to `planned` (glossary decision 3); the label reads
  "planned" either way.
  **Proposed.**
- **Discrepancies:** when an intended fact and an observed fact disagree, both
  are shown side by side with their sources and check times, marked as a
  discrepancy. Neither is styled as the right one. **Proposed**, following the
  glossary's discrepancy rule.
- The same freshness display is used wherever a fact appears outside its page,
  for example in search results or a task's related entities. **Proposed.**
  Reason: a fact quoted without its age loses the trust signal.

### Moving around the wiki

- An index per entity type (projects, machines, services, runbooks, decisions,
  policies, people, agents), each a sortable list with entity status, entity owner and
  the freshness summary.
- Search, and links between pages.
- A **Start here** link at the top of the wiki.

**Proposed.** Reason: the `workspace` repository's catalog is navigated the
same way (per-type indexes and links) and that works.

### Changing the catalog from the wiki

- **Suggest a change** opens the page's text and fields for editing. Saving
  creates a catalog proposal. The glossary proposes that in the first version
  every catalog proposal needs approval except a re-check that leaves the claim
  unchanged; the rule is owned by the [Catalog](catalog.md) document, and the
  screen says before saving whether the change will wait for approval. **Decided** that agents propose and people
  approve where needed (plan, Catalog pillar). The flow is **proposed**.
- **Record a check** lets a person record that they checked a fact. It asks
  what was checked (the scope) and how (the source), and sets the fact state.
  It cannot be saved without both. If the claim is unchanged, only the
  last-checked time moves and it applies at once; if the person found
  something different, it becomes a catalog proposal for the new claim. **Proposed.** Reason: the `workspace`
  repository's rule that dates refer to actual checks, and that dates must not
  be refreshed mechanically.

### Reviewing a catalog proposal

The review screen shows, per entity changed: each fact before and after
(claim, fact state, source, last checked), body text changes, the evidence, the
related task, and the author with attribution. Actions: **Approve**,
**Reject** with a reason, and **Comment**. The list of catalog proposals shows
`pending` ones first, with their age. Only people approve; agents never
see an approve button. **Proposed**, following the glossary's proposal that only
people approve. Who may approve which changes is owned by
[Identity](identity.md) and the [Catalog](catalog.md) document.

## Start here and onboarding

The plan asks for a "start here" path for a new person or a new agent.
**Decided** (plan, Wiki and onboarding pillar).

### Two paths, one set of pages

A workspace has two start here paths:

- **For people:** orientation. What this workspace is for, the main projects,
  the machines and how access to them is arranged (prerequisites, never
  credentials), the key policies (for example deployment approval), how tasks
  and nudges work here, who's who, and how to connect your own agent.
- **For agents:** rules and routing. The policies an agent must follow, task
  ID and marker conventions, how to find the right project and its owning
  repository, when and how to ask for a person (`needs a person`), and what needs
  deployment approval.
  This is Shinan's version of today's `agent-entrypoint.md` in the `workspace`
  repository.

Both paths are ordered lists of catalog entities (mostly `policy`, `runbook`
and `project` entities) with a short note per step. They do not copy pages;
each step opens the entity page. **Proposed**; see
[decision needed 5](#decisions-needed-from-the-owner). Reason: people need
orientation and setup, agents need short, strict rules because their context is
limited; building both from the same pages keeps one source of truth.

### Start here for people

- The path is shown as numbered steps. Each step shows whether the person has
  opened it, and whether it changed since they did. **Proposed.** Reason: the
  catalog keeps changing; a returning person should see what is new without
  rereading everything.
- The workspace owner edits the path in workspace settings: add, remove, order
  steps, and write the note for each. **Proposed.**
- A new member lands on the path after accepting an invitation (see
  [joining a workspace](#joining-a-workspace)).

### Start here for agents

- Agents receive this path through the MCP server and skill at the start of an
  agent session. How is owned by [Agent integrations](agent-integrations.md),
  and its form in the agent index by the [Catalog](catalog.md) document.
- In the wiki, the agent path has a **Preview as agent** view that shows
  exactly what an agent is given, in order, so the owner can check it.
  **Proposed.** Reason: today the owner can read `agent-entrypoint.md` directly;
  if agents get their instructions from Shinan instead, the owner must still be
  able to see them.
- The page shows the total size of the agent path and warns when it grows past
  a size the workspace owner sets. **Proposed.** Reason: everything on the path
  is read by every agent session, so growth has a cost.

### First run for a new workspace

Shinan starts empty (D-018). A new workspace's Now screen shows a setup
checklist until it is done or dismissed:

1. Connect a git host.
2. Register your first agent and connect it (see [your agents](#your-agents)).
3. Start the catalog: create the first `project` entities, or ask an agent to
   propose them (shown as catalog proposals to approve).
4. Write the start here paths.
5. Create a first task, or let outside issues arrive in triage.
6. Invite members (optional).

**Proposed.** Reason: an empty workspace gives no hint of what to do first, and
the order follows the dependencies (agents need a git host to do work; the
start here paths need catalog pages to point to). Which projects are tried
first is owned by the [Roadmap](roadmap.md).

## Triage inbox

Phase 2 (plan, section 10). Lists tasks in `triage`, created from outside
issues (D-003). For each: the outside issue's title and a short summary, the
repository, the outside actor who opened it, and when. Actions: **Accept**
(optionally assign and edit the intent), **Cancel** with a reason (and
optionally post a reply on the git host issue, if
[Git host integrations](git-hosts.md) allows writing back), and **Combine with
an existing task** (the issue becomes an `origin` or `related` work link on that
task). **Proposed.** Whether combining is allowed is owned by
[Tasks and work](tasks.md).

## Workspace and member management

What roles exist and what each may do is owned by [Identity](identity.md); the
glossary proposes three roles: workspace owner, contributor and viewer. This
section describes the screens. Actions a person's role does not allow are hidden, and a viewer
sees a short note that the workspace is read-only for them. **Proposed.**

All changes below are events on the workspace timeline, at full prominence.
**Proposed.** Reason: membership, tokens and git host connections control
access to infrastructure details (D-015), so changes to them must be visible.

### Creating and switching workspaces

- A workspace switcher lists the person's workspaces and their role in each.
  **Proposed.**
- **Create a workspace** asks for a name, and for a task ID prefix if the owner
  accepts per-workspace prefixes (glossary decision 4; the prefix cannot be
  changed later, so the screen says so). It makes the person its workspace
  owner, then opens the [setup checklist](#first-run-for-a-new-workspace).
  Whether any signed-in person may create a workspace is owned by
  [Identity](identity.md) and [Architecture](architecture.md) (an installation
  setting).

### Workspace settings (workspace owner)

| Screen | Shows | Actions |
|---|---|---|
| General | Name, creation date, workspace owner(s) | Rename; delete workspace (typed confirmation, consequences listed first) |
| Members | Each member: name, role, joined, invited by, linked git host accounts (and whether each link is verified), their agents, last active | Change role; remove member. The last workspace owner cannot be removed or given another role |
| Invitations | Pending, expired and declined invitations with role and who invited | Invite (address and role); resend; withdraw |
| Agents | Every agent in the workspace: name, member it acts for, coding tool, state, last agent session seen, its tokens (created, last used, scope) | Disable an agent; revoke a token |
| Git host connections | Each connection: git host, repositories covered, who set it up, health, last successful contact | Add; reconnect; change repositories covered; remove |
| Catalog settings | Which catalog proposals need approval, and any recheck periods | Change (options owned by the [Catalog](catalog.md) document) |
| Start here | Both start here paths | Edit steps and notes |

**Proposed** screen set. Reason: one screen per thing the glossary lists as
part of a workspace (members, invitations, agents, git host connections,
settings).

Before removing a member, the screen lists the consequences: their agents and
tokens that will be disabled, tasks they are assigned to, agent sessions of
theirs attached to tasks, and git host connections they set up. **Proposed.**
Reason: an agent acts for a member, so removing a member must not leave agents
running in their name. Keeping at least one workspace owner follows the
glossary's rule that a workspace always has one. The rules themselves are owned by [Identity](identity.md).

Sensitive actions (changing roles, creating or revoking tokens, adding git host
connections, deleting the workspace) may require the person to sign in again.
Which ones is owned by [Identity](identity.md).

### Joining a workspace

1. The invited person follows the invitation link, signs in or creates an
   account, and sees the workspace name, who invited them and the role.
2. They accept or decline.
3. On accepting, they are asked to link their git host accounts, if not
   already linked, with a short reason: "so Shinan can show what you and your
   agents did on GitHub and Forgejo". Each link is verified before it counts
   (glossary, Git host account); how is owned by [Identity](identity.md).
4. They are offered to [register an agent](#your-agents) now or later.
5. They land on [start here for people](#start-here-for-people).

**Decided** that invitations exist (D-019). The flow is **proposed**. Reason:
linking git host accounts is how git host activity is credited at all (glossary,
Git host account), so it belongs at the start.

### Your account

Each person has an account area, separate from any workspace: profile, sign-in
settings (owned by [Identity](identity.md)), linked git host accounts, the
workspaces they belong to with their role, and pending invitations. **Proposed.**

### Your agents

Agents belong to one workspace and act for one member (glossary, Agent). In
each workspace, a member sees **Your agents**:

1. **Register an agent:** a name (suggested, for example "Guneet's OpenCode")
   and the coding tool. Every role may register agents; a viewer is told that
   their agent will be read-only, because an agent can never do more than its
   member (glossary, Member and role). By default there is one agent per
   coding tool; the screen allows more, for example one per machine.
2. **Get a token:** shown once, with a copy button and the warning that it will
   not be shown again. **Proposed.** Reason: tokens are credentials and must
   not be retrievable later.
3. **Connect:** short instructions for that coding tool: add the MCP server
   and skill, and install the plugin where one exists. The content is owned by
   [Agent integrations](agent-integrations.md).
4. **Waiting for first check-in:** the screen waits until the agent's first
   agent session reaches Shinan and then confirms which connection levels are
   working (for example "MCP: working. Plugin: not installed, so nudges arrive
   only at check-in."). **Proposed.** Reason: the person learns now, not later,
   whether nudges will be live.

From the same screen a member can rename or disable their agents and create or
revoke tokens. **Proposed.**

## Phasing

How this document's screens map to the plan's phases (plan, section 10). The
[Roadmap](roadmap.md) decides the exact first release.

| Phase | Screens | Status |
|---|---|---|
| 1 | Now screen, task list, task page with comments, timelines, agents view, wiki with start here paths, catalog proposal review, workspace and member management, your account and agents | Decided that the wiki, tasks, timeline and presence are phase 1 (plan, section 10). Including member management in phase 1 is proposed (D-019: multi-user is designed in from the start) |
| 2 | Board, nudges and their delivery states in the comment box, triage inbox | Decided (plan, section 10) |
| 3 | Starting agent sessions from the task page through a launcher | Decided (plan, section 10; D-014) |

In phase 1, comments on a task are visible to agents when they read the task,
but the comment box does not show delivery or offer live delivery.
**Proposed.** Reason: nudges are phase 2 in the plan; until then the comment
box must not promise delivery it cannot make.

## How today's practice maps to these screens

For reference, since the owner already works this way in the `workspace`
repository (D-018 says it stays the source of truth until Shinan is ready).

| Today, in the `workspace` repository | In Shinan |
|---|---|
| `human-effort` label and TL;DR comment | `needs a person` task flag and its [panel](#needs-a-person-panel); listed in [Needs you](#1-needs-you) |
| Forgejo Project board for workflow | [Board](#board-phase-2) with columns by task status |
| `last_verified`, `verification_scope`, `verification_source` per catalog entry | Last checked, check scope and source per fact, shown as [freshness](#how-freshness-is-shown) |
| `docs/agent-entrypoint.md` | [Start here for agents](#start-here-for-agents) |
| Announcing an agent's identity in an issue comment when agents share an account | Presence and "acting for" on every agent event |
| Asking for deployment approval in the conversation or issue | The [deployment approval panel](#deployment-approval-panel) and a row in [Needs you](#1-needs-you); the `awaiting deployment approval` flag if adopted |

## Dependencies on other documents

| Document | What this document needs from it |
|---|---|
| [Domain model and glossary](domain-model.md) | All terms. Its pending owner decisions change wording here, and this document works with either outcome: status calculated from linked work plus recorded events (1), agents setting `needs a person` (2), renaming the fact state `proposed` to `planned` (3), per-workspace task ID prefixes (4), and the `awaiting deployment approval` flag (5). Its open question on event redaction affects [corrections](#freshness-and-corrections). |
| [Product overview](product-overview.md) | Confirmation that "steer, don't operate" matches the positioning. |
| [Catalog](catalog.md) | Entity types and their fields for entity pages; the exact unit of a fact; whether recheck periods exist; the approval rule for catalog proposals; where start here paths are stored and how the agent path appears in the agent index. |
| [Tasks and work](tasks.md) | Task fields; the rules behind each status explanation; who sets and clears each manual state; what a recorded deployment approval contains; when comments become nudges; whether nudges queue for the next agent session that claims a task; priority or ranking; triage actions including combining. |
| [Identity, agents and permissions](identity.md) | Roles and what each may do; who may approve catalog proposals; how private repositories appear on a task; consequences of removing a member; which actions need signing in again; who may create workspaces; token scopes. |
| [Git host integrations](git-hosts.md) | Connection health and what counts as "behind" for reconciliation; whether Shinan may reply on an outside issue when cancelling a task in triage. |
| [Agent integrations](agent-integrations.md) | Whether live delivery interrupts a busy agent session; how agents receive the start here path; connect instructions per coding tool; the launcher's options in phase 3; whether `waiting` prompts can or should be answered from the web app; whether an agent session can be stopped from Shinan. |
| [Architecture and operations](architecture.md) | Installation-level settings (such as who may create workspaces); how the app updates screens without reloading. |
| [Roadmap and migration](roadmap.md) | Which phase 1 screens are in the first release; the proof-of-concept projects used in the setup checklist. |

## Open questions

1. **Live delivery timing.** Does a live nudge interrupt a `busy` agent session
   or wait for its current step? The comment box wording depends on it.
   ([Agent integrations](agent-integrations.md))
2. **Stopping an agent session.** Should the task page offer "stop" as well as
   "detach", and can a plugin do it? ([Agent integrations](agent-integrations.md))
3. **Answering `waiting` prompts.** Should a person be able to answer an agent
   session's question or permission prompt from the web app, or only see that
   it is waiting and where to answer? See
   [decision needed 7](#decisions-needed-from-the-owner).
4. **Nudges without a task.** Can a person nudge an agent session that is not
   attached to a task? Recommended: no in the first version.
5. **Private repositories on a task.** Is the existence of a work item the
   person cannot see shown at all? ([Identity](identity.md), plan question 3)
6. **Outside actors that are automated.** Comments from a dependency tool on an
   outside issue are credited to an outside actor. Should a workspace be able
   to mark such accounts so they show as compact? Recommended: yes, as a
   workspace setting, because otherwise automated noise is shown at full
   prominence.
7. **"Since you last looked."** Is a visit enough to count as looked, or should
   a person mark things as seen? Recommended: a visit counts, because marking
   by hand is busywork.

## Decisions needed from the owner

1. **Comments nudge by default.** When an agent session is attached, should a
   new comment be sent to it unless the person turns that off?
   **Recommended: yes.** Reason: on a task an agent is working on, most
   comments are meant to steer it, and a missed instruction costs more than an
   occasional unneeded nudge.
2. **Ranking on the board.** Should people be able to order tasks in the
   `to do` column to say what comes next? **Recommended: yes, a simple order
   with no priority levels.** Reason: choosing what is worked on next is the
   main steering act, and an order is simpler than a priority field. (Owned
   with [Tasks and work](tasks.md).)
3. **Unsure credits from your own git host account.** When Shinan cannot tell
   whether you or one of your agents did something on a git host, should the
   timeline show it at full prominence, labelled as unsure?
   **Recommended: yes.** Reason: hiding a real human instruction is worse than
   showing an agent's action too loudly.
4. **Freshness warnings.** Show only the age of each fact, or also highlight
   facts past a recheck period set per entity type? **Recommended: age always;
   highlight only where the workspace sets a period.** Reason: no single
   interval fits every fact, but some facts (such as which machine runs a
   service) need a reminder.
5. **Separate start here paths for people and agents.** **Recommended: two
   paths built from the same catalog pages.** Reason: people need orientation
   and setup, agents need short strict rules, and shared pages keep one source
   of truth.
6. **Comments waiting for the next agent session.** When no agent session is
   attached, should comments be delivered to the next agent session that
   claims the task? **Recommended: yes.** Reason: an instruction written before
   the agent starts should not need repeating.
7. **Answering agent prompts from the web app.** Should the first version let
   a person answer an agent session's permission prompt from Shinan?
   **Recommended: no; show that it is waiting and on which machine and coding
   tool.** Reason: approving actions remotely through a public web app (D-015)
   is a security risk that should get its own design later.
8. **Phone use.** Should the Now screen, task pages, commenting and approving
   be designed to work on a phone from the first version?
   **Recommended: yes.** Reason: the app is public so the owner can steer from
   anywhere (D-015), and these are the actions needed away from a desk.
