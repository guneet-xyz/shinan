# Human experience

Status: **draft for review** ([issue #10](https://github.com/guneet-xyz/shinan/issues/10)).

This document describes what people see and do in Shinan's web app: the screens,
what each shows, and the flows between them. It covers the wiki and the start
here path, task pages, timelines, the board, nudges as a person sees them, the
agent presence view, notifications, and workspace and member management.

It describes screens and flows in words: what is shown, in what order of
importance, and what each action does. It does not choose layout, visual style
or technology (D-020: the technology stack is chosen later from the
architecture document's options).

## How to read this document

- Terms come from the [domain model and glossary](domain-model.md) and are used
  exactly as defined there. That document is still in review
  ([PR #14](https://github.com/guneet-xyz/shinan/pull/14)). Where one of its
  open questions or decisions needed from the owner affects a screen, this
  document says so and works with either answer.
- Every statement is marked:
  - **Decided**: follows from an accepted decision in the
    [plan](plan.md#6-decisions-so-far), which is cited and gives the reason.
  - **Proposed**: suggested here, with a reason. The owner confirms or changes it.
  - **Open**: not settled; listed under [open questions](#open-questions) or
    [decisions needed from the owner](#decisions-needed-from-the-owner).
- Where a rule belongs to another document (for example who may approve a
  catalog proposal, or when a nudge is created), this document only says how
  the screen shows it and lists the dependency in
  [dependencies on other documents](#dependencies-on-other-documents). The
  drafts of [Tasks and work](tasks.md) (PR #20) and
  [Agent integrations](agent-integrations.md) (PR #23) are referenced where
  they set those rules.
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
[triage inbox](#triage), the [unlinked work list](#unlinked-work),
[catalog proposal review](#reviewing-a-catalog-proposal) and the person's side
of [notifications](#notifications).

It does not cover:

- What a task status means, how it is calculated, or when a nudge is created.
  These belong to [Tasks and work](tasks.md).
- How nudges reach a running agent session, or how presence is reported and
  timed out. These belong to [Agent integrations](agent-integrations.md).
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
   change intent and acceptance criteria, comment and nudge, set task flags and
   manual states, accept or cancel tasks in triage, give deployment approval,
   approve catalog proposals, assign people. It does not offer code review, CI
   controls or a pull request view. **Decided** (D-001: Shinan sits above git
   hosts and does not replace them). Every work item links straight to its git
   host page.
4. **Show how sure Shinan is.** Facts show their fact state, source and how
   long ago they were last checked; credits show their attribution confidence;
   presence shows whether it is self-reported and when it was last seen;
   anything read from a git host shows when Shinan last read it. **Decided**
   for facts (D-007: trust is the main differentiator). **Proposed** for the
   rest, for the same reason.
5. **Explain calculated things.** Wherever Shinan shows something it
   calculated, such as a task status or `blocked`, a person can see why in one
   step. **Proposed.** Reason: status is calculated, not set by hand (D-005), so
   a person cannot fix a wrong status by editing it; they need to see which work
   link or event caused it.
6. **Link, don't copy.** Pages show a short summary of a work item or owning
   source and link to it. **Decided** (D-001, D-006 and plan section 3:
   Shinan does not copy facts that another system owns).
7. **One person and a team see the same app.** Screens show members, roles and
   "acting for" from the first version, even with one member. **Decided**
   (D-019: adding multi-user support later would mean reworking data,
   permissions and sign-in).
8. **Usable from a phone for steering.** The Now screen, task pages,
   commenting, nudging and approving work on a small screen. Browsing large
   wiki pages and settings may be desktop-first. **Proposed**; see
   [decision 8](#decisions-needed-from-the-owner). Reason: the app is on the
   public internet so the owner can reach it from anywhere (D-015); the
   steering actions are the ones needed away from a desk.

### Phase 1 and nudges

The plan puts nudges in phase 2 (plan, section 10). **Decided.** In this
document, wherever an action **tells attached agent sessions**, that means:

- **Phase 2 onwards:** a nudge is created, following the rules in
  [Tasks and work](tasks.md) (section 11 of its draft).
- **Phase 1:** the action is only an event on the task. Agents see it the next
  time they read the task. Nothing is pushed to them, and the screen does not
  claim it was delivered.

**Proposed.** Reason: the plugin in phase 1 reports presence only (roadmap
draft); the screens must not promise delivery that cannot happen yet.

## Map of the app

The app is organised per workspace. A person who belongs to several workspaces
switches between them; nothing from one workspace appears in another.
**Proposed**, following the glossary's proposed rule that nothing is shared
between workspaces except the person. Reason: workspaces hold infrastructure
details (D-015), so a hard boundary is the simplest to keep safe.

| Place | What it is for | Phase |
|---|---|---|
| [Now](#the-now-screen) | What needs me, what is being worked on, what changed | 1 |
| [Tasks](#task-list-and-board) | Task list (phase 1) and board (phase 2) | 1 and 2 |
| [Task page](#task-page) | The story of one task, and steering it | 1 |
| [Timeline](#timelines) | Everything that happened in the workspace | 1 |
| [Wiki](#the-wiki) | The catalog for people, including [start here](#start-here-and-onboarding) | 1 |
| [Agents](#agents-view) | Agent sessions and their presence | 1 |
| [Triage](#triage) | A filtered task list in phase 1; the full triage inbox in phase 2 | 1 and 2 |
| [Unlinked work](#unlinked-work) | Branches and PRs with no task ID | 1 |
| [Catalog proposals](#reviewing-a-catalog-proposal) | Changes waiting for a person | 1 |
| [Workspace settings](#workspace-and-member-management) | Members, invitations, agents, git host connections, settings | 1 |
| [Your account](#your-account) | Profile, git host accounts, your agents, your workspaces, notification settings | 1 |

Phases follow the plan (section 10): the board, nudges, the triage inbox and
notifications are phase 2; starting agents from the website is phase 3.
**Decided** (plan, section 10). Which phase 1 screens are in the very first
release is for the [Roadmap](roadmap.md).

Search is available from every page. It finds tasks (by task ID or words),
catalog entities, members and agents, and opens the result. **Proposed.**
Reason: the owner works across many repositories and projects; typing a task
ID seen in a branch name should go straight to the task.

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
| Deployment approval | A task waits for deployment approval | Opens the task's [deployment approval panel](#deployment-approval-panel) | 1 |
| Task with `needs a person` | The task flag is set | Opens the task's [needs a person panel](#needs-a-person-panel) | 1 |
| Agent session `waiting` | A plugin-reported agent session is waiting for a person, with its reason (`permission` or `question`) and short label | Opens the agent session, which says on which machine and coding tool to answer | 1 |
| Agent session silent on a task | An attached agent session is `unresponsive`, or is [overdue for a check-in](#when-an-agent-session-goes-quiet) | Opens the task with options to [start a new agent session](#when-no-agent-session-is-attached) | 1 |
| Tasks in triage | One or more tasks are in `triage` | Phase 1: opens the task list filtered to `triage`. Phase 2: opens the [triage inbox](#triage) | 1 |
| Catalog proposal waiting for approval | A `pending` catalog proposal needs a person's approval | Opens [the review screen](#reviewing-a-catalog-proposal) | 1 |
| Git host connection failing | A connection's health is failing | Opens the connection's settings | 1 |
| Invitation for you | You have a pending invitation to another workspace | Accept or decline | 1 |
| Workspace setup checklist | The workspace is new and setup is not finished | Opens the [setup checklist](#first-run-for-a-new-workspace) | 1 |
| Nudge not received | A delivery of your nudge is `undeliverable`, or still `pending` to an agent session that has gone silent | Opens the comment with delivery options | 2 |

**Proposed.** Reasons per row: deployment approval comes first because it is
the only workflow-level approval gate in the `workspace` repository's practice
and D-016 requires it for every deployment of Shinan itself; the triage count
is shown from phase 1 because outside issues become tasks from the first day
(D-003), even though the full inbox is phase 2.

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

Agent sessions are ordered by how likely they are to need help: `waiting`,
then silent ones (`unresponsive`, or self-reported and overdue for a check-in),
then `busy`, `starting`, self-reported agent sessions seen recently, and
`idle`. Self-reported agent sessions show only when they were last seen, never
a presence state they cannot report (glossary, Presence). **Proposed.** Reason:
this answers "what is being worked on now" in one glance and puts agent
sessions that may need help first.

Agent sessions that are running but attached to no task are shown as a short
group, "Not on a task", after the tasks. **Proposed.** Reason: work that is not
tied to a task cannot be steered through task comments, so the owner should
see it.

### 3. Since you last looked

A short summary of what changed since the person's previous visit, grouped by
task: tasks done, pull requests merged, tasks created, deployment approvals
given, catalog proposals applied, facts that changed fact state, and new
comments by people. Routine agent activity appears only as counts ("3 agent
sessions, 41 events") with a link to the timeline. **Proposed.** Reason: the
owner checks in between other work and wants outcomes, not a replay.

Opening the Now screen counts as having looked; nothing needs marking as seen
by hand. **Proposed.** Reason: marking items by hand is busywork for one
person, and the summary is a convenience, not a to-do list.

## Task list and board

### Task list (phase 1)

A list of tasks with filters and saved views. Each row shows task ID, title,
task status, task flags (including `blocked`), assignees, attached agent
sessions with presence, the number of linked pull requests and their combined
CI check result, and the time of the last event. **Proposed.** Reason: these
answer "what is it, who has it, is it moving, does it need me" without opening
it.

Filters: task status, task flag, assignee, agent, repository, related catalog
entity (for example a `project` entity), and "has an attached agent session".
Default view: everything not `done` or `cancelled`, with `needs a person` and
deployment approval first. **Proposed.**

A person can create a task from the list: title, intent, acceptance criteria,
optional assignee and related catalog entities. **Decided** that tasks can start
in Shinan (D-003: a task starts where the intent starts). The fields are owned
by [Tasks and work](tasks.md).

### Board (phase 2)

The board shows the same tasks in columns by task status: `triage`, `to do`,
`in progress`, `in review`, and recently `done`. If the owner adopts the
`verifying` status proposed by [Tasks and work](tasks.md), it gets a column
between `in review` and `done`. Tasks in `triage` offer **Accept** and
**Cancel**. **Decided** that the board is phase 2 (plan, section 10). Columns
by task status are **proposed**. Reason: it mirrors the flow people already use
on the `workspace` repository's Forgejo Project, without moving anything by
hand.

Rules:

- **Tasks cannot be moved between status columns by hand.** Status is
  calculated from linked work (and, if the owner accepts glossary decision 1,
  recorded events such as verification). A task moves when its work moves.
  **Decided** (D-005: copied or hand-set status goes stale). The board says so
  when someone tries, and links to the
  [status explanation](#status-explanation).
- **Task flags are shown with each task, not as columns.** A task can be
  `in progress` and `needs a person` at once. Tasks that need a person or a
  deployment approval are also gathered in a group that stays visible above
  the columns, so they cannot be overlooked. `on hold` tasks are marked as
  paused and shown after active ones. `cancelled` tasks are hidden unless
  filtered for. **Proposed.** Reason: the glossary keeps flags separate from
  status so both are true at once; the always-visible group keeps attention on
  what blocks progress.
- **Each task on the board** shows task ID, title, assignee, presence of its
  attached agent sessions, linked pull request count and CI check result,
  `blocked`, and how long since its last event. **Proposed.**
- **Grouping:** none, by assignee, or by related `project` entity. **Proposed.**
  Reason: the owner works across many projects; grouping by project shows where
  effort is going.
- **Order in `to do`:** whether people can rank tasks to say what should be
  worked on next is a decision for the owner; see
  [decision 2](#decisions-needed-from-the-owner).

## Task page

The task page is where the story of a task is read and where a person steers
it. It shows, in order of importance:

### Header

Task ID, title, task status, task flags, assignees, origin (created in Shinan,
from an outside issue, or from a conversation), and the attached agent sessions
with their presence. **Proposed** order; the fields follow the glossary's task
definition.

### Status explanation

With the status, a one-line reason in words, opening a short list of the
evidence:

> In review, because pull request #14 in `guneet-xyz/shinan` on GitHub is open
> and ready for review. Last read from GitHub 3 minutes ago.

- For `blocked`, it names the task it depends on and that task's status,
  including "dependency cancelled" where [Tasks and work](tasks.md) uses it.
- For `done` (or `verifying`, if adopted), it names the merged work and, where
  the acceptance criteria need more than the merge, the recorded verification
  and who recorded it.
- If any active work item has not been read for longer than the threshold set
  by [Git host integrations](git-hosts.md), it says when the status was last
  confirmed, following the Tasks and work draft (section 7.5).
- For a `cancelled` task with active linked work, it warns that the work is
  still open on the git host.

**Proposed.** Reason: [explain calculated things](#design-principles). The
rules behind each explanation are owned by [Tasks and work](tasks.md).

### Deployment approval panel

When a task waits for deployment approval, this panel comes before everything
else on the page after the header. It shows the items that
[Tasks and work](tasks.md) requires a deployment approval request to carry.
Today's practice in the `workspace` repository lists: target and environment,
operation and revision, expected impact and risks, verification, rollback, and
any coordination or lock.

- **Approve** records the deployment approval, with its scope and revision.
  It is unavailable while a required item is missing, and the panel says
  which.
- **Decline** asks for a reason.
- **Comment** asks a question without answering.
- Either answer tells attached agent sessions (phase 2; see
  [phase 1 and nudges](#phase-1-and-nudges)).
- If the request's revision or operation changes after approval, the approval
  is shown as no longer valid and the panel asks again. The rule for what
  counts as a material change is owned by Tasks and work (its draft, section
  8.4, makes a material change to the operation or revision stale).

**Proposed.** Reason: deployment approval is the one approval gate in today's
practice, and D-016 requires it for every deployment of Shinan itself; asking
for it in a fixed shape makes it quick to give safely.

The panel is the same whether the owner adopts the separate
`awaiting deployment approval` flag (glossary decision 5) or not. If the flag
is not adopted, Shinan needs another way to tell a deployment approval request
apart from other `needs a person` items, such as a kind on `needs a person` or
a recorded request event. That is listed as a dependency on
[Tasks and work](tasks.md).

### Needs a person panel

When `needs a person` is set, this panel comes next. It carries the same short
summary that today's `human-effort` TL;DR comment carries in the `workspace`
repository's practice, with the fields [Tasks and work](tasks.md) requires:

- **What is needed**, in one sentence.
- **Action:** the steps, where to do them, and links to runbooks.
- **Why a person:** missing access, a secret to type, a physical step, or a
  decision that belongs to the owner.
- **Then:** what this unblocks and what the agent will do next.

Buttons: **Mark as handled**, which asks for a short result and clears the
flag; **Comment**; and **Not needed**, which clears the flag with a reason.
Clearing it tells attached agent sessions with the result (phase 2; see
[phase 1 and nudges](#phase-1-and-nudges)). Secret values are never asked for;
the panel says where to type them. **Proposed.** Reason: the TL;DR format
already works for the owner today; making it a panel puts it first instead of
somewhere in a comment thread.

The glossary and Tasks and work recommend that agents may set and clear
`needs a person`, with the summary required; this is an owner decision
(glossary decision 2). The panel works either way: it always shows who set the
flag and when, and if an agent clears it, that appears as a milestone event on
the timeline.

### Intent, acceptance criteria and decisions

The task's intent (what and why), its acceptance criteria as a checklist, and
decisions made along the way. Each criterion shows who last changed it and,
when it is marked met, the evidence (a link to a work item or event). People
edit these directly; edits are events and tell attached agent sessions (phase
2). **Proposed.** Reason: intent and acceptance criteria are the main way the
owner steers, so they must be easy to change and easy to see changed, and an
agent working from old criteria wastes work.

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
reachable in one step from anywhere on the page. **Proposed.**

### Steering actions

| Action | Notes | Status |
|---|---|---|
| Comment | Tells attached agent sessions unless marked "note only" (phase 2); see [comments and nudges](#comments-and-nudges) | Decided that comments create nudges (plan, Nudges pillar), in phase 2 (plan, section 10) |
| Give or decline deployment approval | See [deployment approval panel](#deployment-approval-panel) | Proposed |
| Accept or cancel a task in `triage`; set or clear `on hold`, `cancelled`, `needs a person` | Asks for a short reason, which becomes part of the event. Setting `on hold` and clearing `needs a person` tell attached agent sessions (phase 2) | Decided that some states are set by hand (plan, Tasks pillar); names and who may set each are proposed in the glossary and Tasks and work |
| Edit intent and acceptance criteria | Tells attached agent sessions (phase 2) | Proposed |
| Assign or unassign members | Assignment is not a lock | Proposed (glossary, Assignee) |
| Start a new agent session for this task | See [below](#when-no-agent-session-is-attached) | Decided (plan, Nudges pillar) |
| Detach an agent session | Removes the agent session from the task and tells it (phase 2) | Proposed. Reason: the owner must be able to redirect work |

Viewers see the task page without these actions. **Proposed**, following the
glossary's viewer role and Tasks and work's rule that viewers cannot comment
or nudge.

## Comments and nudges

A comment is a person's message on a task. A nudge is that message delivered
to the agent sessions working on the task. **Decided** (plan, Nudges pillar;
glossary, Nudge), in phase 2 (plan, section 10). When nudges are created and to
whom is owned by [Tasks and work](tasks.md) (its draft, section 11); how they
are delivered is owned by [Agent integrations](agent-integrations.md) (its
draft, "Nudge delivery"). This section describes what the person sees.

In phase 1 the comment box is a plain comment box: no recipients, no delivery
states. See [phase 1 and nudges](#phase-1-and-nudges).

### Before sending (phase 2)

Before the person sends, the comment box shows who will receive the message
and how, worked out from the attached agent sessions and their presence:

| Situation | What the box says | Send action |
|---|---|---|
| A plugin-reported agent session (presence source `plugin-reported`) is running and not `unresponsive` | "Guneet's OpenCode on Daedalus will get this at its next step." | **Send** |
| An attached self-reported agent session (presence source `self-reported`), seen recently | "Guneet's Codex on Musashi will see this the next time it checks in. Last seen 12 minutes ago." | **Send, deliver at check-in** |
| An attached agent session is `unresponsive`, or self-reported and [overdue for a check-in](#when-an-agent-session-goes-quiet) | "The attached agent session has not been seen for 2 hours. It may never pick this up." with **Start a new agent session** | **Send anyway** |
| No agent session is attached | "No agent is working on this task. This will wait for the next agent session that claims it." (or, if [decision 6](#decisions-needed-from-the-owner) is not adopted: "No agent will get this.") with **Start a new agent session** | **Send** |
| Several agent sessions are attached | One line per agent session, each with a tick box, all ticked | As above, per agent session |

**Proposed.** Reason: the person must know, before they send, whether their
words will reach an agent now, later, or not at all; this is the purpose of the
glossary's delivery states.

Options in the box:

- **Note only:** posts the comment without creating a nudge. Off by default
  whenever an agent session is attached. Agents still see the comment when
  they read the task. Follows Tasks and work's proposed "note only" opt-out;
  the default is [decision 1](#decisions-needed-from-the-owner).
- **When:** "at its next step" or "after its current work", for plugin-reported
  agent sessions. The default and the meaning of each come from Agent
  integrations, which proposes "at its next step" (`steer`) as the default and
  "after current work" (`queue`) as the choice. **Proposed** that the person can
  choose per message; reason: a correction is worth most before the agent goes
  further, but a new idea should not interrupt good work.

### After sending (phase 2)

The comment shows the state of each delivery and updates while the page is
open:

| Delivery state (per target agent session) | Shown as |
|---|---|
| `pending`, live delivery under way | "Sending to Guneet's OpenCode on Daedalus" |
| `pending`, accepted by the coding tool but not yet confirmed | "Queued in Guneet's OpenCode; it will see this at its next step" |
| `pending`, waiting for check-in | "Waiting for Guneet's Codex to check in (sent 10:42; last seen 10:30)" |
| `delivered`, live | "Delivered live to Guneet's OpenCode on Daedalus at 10:42" |
| `delivered`, at check-in | "Delivered to Guneet's Codex when it checked in at 10:55" |
| `undeliverable` | "Not received: the agent session ended first." With [decision 6](#decisions-needed-from-the-owner): "It will go to the next agent session that claims this task." |

When the nudge had no target at all, the glossary records "no active session"
on the nudge itself, not as a delivery. The comment then shows "Waiting for an
agent session to claim this task" with **Start a new agent session**, or, if
decision 6 is not adopted, "No agent got this".

**Proposed** wording. The delivery states, the "queued in the coding tool"
detail and the live or check-in route come from the glossary and Agent
integrations. Reason for showing the route: it tells the person how quickly the
agent could have acted.

Rules for the person:

- A delivery that is `undeliverable`, or still `pending` to an agent session
  that has [gone quiet](#when-an-agent-session-goes-quiet), appears in
  [Needs you](#1-needs-you). A nudge that is simply waiting for an agent
  session to claim the task does not, because the person already chose not to
  start one. **Proposed.** Reason: an instruction that silently never arrives
  is the worst outcome for a person steering agents, but a deliberate wait is
  not news.
- A person can **withdraw** a nudge that has no `delivered` delivery yet.
  **Proposed**, following Tasks and work (section 11.3).
- **Editing a comment.** Events are not edited (glossary), so an edit is shown
  as a correction next to the original, which stays readable. Before any
  delivery, editing replaces the waiting nudge. After delivery, the edit is not
  sent unless the person ticks "Tell the agent about this change". **Proposed**,
  following Tasks and work (section 11.3). Reason: a silent change to a message
  the agent already acted on would mislead anyone reading the history, and
  repeat nudges for typo fixes would interrupt work.
- **Agent replies.** An agent's reply to a nudge (Agent integrations proposes a
  "reply to nudge" tool; Tasks and work says the agent answers with a progress
  update) is shown with the comment it answers, as a **milestone** event, not
  collapsed. **Proposed.** Reason: the person asked something and should see
  the answer without expanding agent activity. Which of the two forms a reply
  takes is listed under [Tasks and work](tasks.md) in the dependencies.

### Waiting comments and the next agent session

Tasks and work and Agent integrations both propose that a nudge with no active
agent session, or whose deliveries all became `undeliverable`, stays on the
task and goes to the next agent session that claims it. This changes the
glossary's nudge definition, where "no active session" has no later target, so
it is [decision 6](#decisions-needed-from-the-owner).

If adopted, this document proposes a bound: only nudges that have never been
`delivered` to any agent session wait, and they are delivered together, in
order, to the next claiming agent session (the order rule is Tasks and work's).
The task page shows "2 comments waiting for an agent session", each of which
can be withdrawn. **Proposed.** Reason: without a bound, a new agent session
could receive a long history of instructions that earlier agent sessions
already acted on; the history itself is in the task, which the agent reads
anyway.

### When no agent session is attached

**Start a new agent session** offers what is possible in the current phase:

- **Before phase 3:** Shinan shows a short ready-to-use start instruction for
  the person to paste into a coding tool on a machine of their choice. It names
  the task, tells the agent to claim it, names the relevant repository and
  links to the agent [start here path](#start-here-for-agents). **Proposed**,
  matching Agent integrations' ready-made prompt. Reason: there is no launcher
  yet, and a ready instruction makes the manual step one paste.
- **Phase 3, with a launcher:** the person picks a machine, a coding tool and
  one of **their own** agents; Shinan asks that machine's launcher to start an
  agent session attached to the task. The page shows `starting` until the agent
  session reaches Shinan. **Decided** that this is phase 3 (D-014, plan section
  10). **Proposed** that only the person's own agents are offered. Reason: an
  agent acts for exactly one member (glossary), so starting someone else's
  agent would act in their name. Which machines and coding tools are offered is
  set on the machine, per Agent integrations; who may use a launcher is owned
  by [Identity](identity.md).

### Nudges without a task

A person cannot nudge an agent session that is not attached to a task. The
[agents view](#agents-view) offers "Attach to a task" instead. **Proposed.**
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
| **Full** | Anything a person did in Shinan: comments, intent and criteria changes, manual state changes, deployment approvals, task creation, triage decisions, catalog approvals, work link changes, assignments. Text events on a git host by a person, or by an [unsure credit](#showing-who-did-what): comments, reviews, issue and PR descriptions. Comments by outside actors on an `origin` issue. | Never collapsed, with the person's name and a clear marker that a person did it. Comments written in Shinan are shown in full. Git host text is shown as the event's short summary with a link to the original. | Decided that human activity stands out; which events count and the git host rule are proposed |
| **Milestone** | Agent or automatic events a person usually cares about: task status changes, `needs a person` set or cleared by an agent (if the owner allows it, glossary decision 2), a deployment approval requested, a verification recorded, a pull request opened, ready for review, merged or closed, a CI check failing or recovering, an agent session `waiting`, going quiet, or ending without finishing, an agent's reply to a nudge, a catalog proposal made. | One line each, not collapsed, with the actor. | Proposed. Reason: these change what the person should do next, so they must not be hidden inside a collapsed group |
| **Compact** | All other agent and automatic activity: commits, pushes, branch creation, progress updates, catalog reads, presence changes, CI checks passing, routine work link creation, and activity from accounts listed as automated. | Grouped by agent session into one line per run of activity, for example "OpenCode session on Daedalus, acting for Guneet: 3 commits, 2 progress updates, CI passed (10:12 to 10:40)". Expands to the individual events. A full or milestone event always ends a run, so cause and effect stay in order. | Decided that agent activity is compact; grouping proposed. Reason: one line per run keeps a long agent effort to a few lines |

Git host text is shown as a summary and link, not copied, because events carry
a short summary and link to git host content (glossary, Event; D-001). If more
text is wanted later, that is a dependency on
[Git host integrations](git-hosts.md) and [Architecture](architecture.md) for
storage. **Proposed.**

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
  Guneet's agents (not sure which), from Guneet's GitHub account". The last
  follows the glossary's rule that an `unknown` action from a linked account is
  credited to the linked person, shown as "the person or one of their agents".
  **Proposed.** Reason: agents share the person's git host account (D-017), so
  some credits are guesses, and the timeline must not present a guess as fact
  (the same rule as D-007).
- **Unsure credits by event kind.** Text events with `unknown` attribution
  (comments, reviews, issue and PR descriptions) are shown at **full**
  prominence, labelled as unsure. Routine kinds with `unknown` attribution
  (commits, pushes, branch creation, CI) stay **compact**. **Proposed**; see
  [decision 3](#decisions-needed-from-the-owner). Reason: missing a person's
  written instruction costs more than seeing an agent's comment too loudly,
  but showing every unmarked commit loudly would undo "agent activity is
  compact".
- Shinan's own actions read "Shinan". Outside actors show their git host
  account and the label "outside". **Proposed**, following the glossary's actor
  kinds.
- **Automated outside accounts.** Accounts listed as automated, such as
  dependency update tools, are shown at compact prominence. **Proposed.**
  Reason: their activity is frequent and predictable. Tasks and work proposes a
  per-repository list of such accounts; where it lives is for
  [Git host integrations](git-hosts.md).

### Freshness and corrections

- Each event shows its time as relative time ("12 minutes ago"), with the
  exact time one step away. **Proposed.**
- Events that Shinan found late through reconciliation show both when they
  happened and when Shinan learned of them. **Proposed.** Reason: otherwise a
  late event looks as if it had been visible all along.
- Each timeline shows when Shinan last heard from each git host it draws on,
  and a warning when a git host connection is failing or reconciliation is
  behind. **Proposed.** Reason: an empty timeline can mean "nothing happened"
  or "Shinan could not see"; the person must be able to tell which (plan
  question 4). Thresholds come from [Git host integrations](git-hosts.md).
- Events are not edited. A correction is a new event, shown with the one it
  corrects, and the original is marked "corrected". **Proposed**, following the
  glossary's event rule. Whether events can be redacted (for example to remove
  a secret) is open in the glossary; if they can, a redacted event stays in
  place and shows that it was redacted, by whom and when, so the history still
  shows that something happened. **Proposed.**
- A "since you last looked" marker shows where new events start.
  **Proposed.**

### The workspace timeline

The Timeline page shows the whole workspace, grouped by day and then by task,
with catalog and membership events in their own groups. Default filter is
**People and milestones**. **Proposed.** Reason: the workspace timeline is the
widest view and is useless if agent activity fills it.

## Agents view

Lists agent sessions that have not ended. Plugin-reported agent sessions are
grouped by presence state: `waiting` first, then `unresponsive`, `busy`,
`starting`, `idle`. Self-reported agent sessions form their own group, overdue
ones first, then by last seen, because they cannot report `idle` or `waiting`
(glossary, Presence). For each: agent, member it acts for, coding tool,
machine, current task, repository, last seen, and presence source. A second
list shows recently ended agent sessions with how they ended. **Proposed.**
Reason: it is the operational view of "who is doing what right now".

Display rules:

- `self-reported` presence is labelled "self-reported" with a short
  explanation: "This agent only tells Shinan what it is doing when it calls
  Shinan. It may have stopped without saying so." Only its last-seen time is
  shown, never a presence state it cannot report. **Decided** that
  self-reported agent sessions are marked (plan, Agent presence pillar).
  Wording **proposed**.
- `waiting` shows its reason (`permission` or `question`) and short label, as
  reported by the plugin (Agent integrations). It never shows the tool's
  arguments, which plugins do not send. Where to answer is named: machine and
  coding tool. **Proposed**; answering from the web app is
  [decision 7](#decisions-needed-from-the-owner).
- An agent session that ended by timing out is shown as "ended: timed out",
  and a later agent session that continues it is shown linked to it.
  **Proposed**, following Agent integrations' timeout rules.
- An agent session's page shows its timeline: tasks it attached to and left,
  work it did, nudges it received and when. **Proposed.**
- Agent sessions not on a task offer **Attach to a task**. **Proposed.**

### When an agent session goes quiet

A crashed agent session reports nothing, so silence needs to be visible. This
is the weakness D-014 names ("cannot reach an idle or crashed session").

- **Plugin-reported:** shown as `unresponsive` once the plugin stops reporting
  for longer than the threshold Agent integrations sets (its draft proposes 3
  minutes, after missed heartbeats).
- **Self-reported:** Agent integrations proposes that these are never shown as
  `unresponsive`, and that MCP-only agents check in at least every 30 minutes.
  This document proposes a **display rule**: a self-reported agent session not
  seen for longer than that check-in interval is shown as **"not seen since
  10:30"** and treated as overdue. It is not a presence state.
- **Either kind**, while quiet:
  - sorts with `unresponsive` in [being worked on now](#2-being-worked-on-now)
    and the agents view;
  - gets a [Needs you](#1-needs-you) row when it is attached to a task;
  - makes the comment box use the "may never pick this up" wording.
- After the longer timeout Agent integrations sets (its draft proposes 24
  hours without any report or call), the agent session is recorded as ended
  with the reason "timed out", releases its task, and leaves these lists.

**Proposed.** Reason: without this, a self-reported agent session that crashed
days ago would look as if it were still working, keep its task in "being
worked on now", and make the comment box promise delivery that will never
happen. The thresholds are owned by Agent integrations.

Registering agents and managing their tokens is under
[workspace settings](#workspace-settings-workspace-owner) and
[your agents](#your-agents).

## The wiki

The wiki is the catalog shown to people as readable pages. **Decided** (D-006:
the catalog is document-first so people can read it). The entity types, facts
and rules are owned by the [Catalog](catalog.md) document; this section is how
they look and how people move around them.

### An entity page

An entity page shows, in order of importance:

1. **Title, entity type, entity status and entity owner** (or `unknown`).
   `deprecated` and `retired` entities say so before anything else, with the
   date and a link to the replacement. **Proposed**, following the glossary's
   entity status rule.
2. **Pending catalog proposals** for this entity, if any. **Proposed.**
3. **Owning sources.** Links to where the authoritative information lives,
   such as a repository's README or a configuration file at a revision, shown
   before the facts. **Proposed.** Reason: link, don't copy; a reader should
   know where to go for the full truth before reading Shinan's summary.
4. **Freshness summary.** One line: how many facts, the oldest last checked,
   how many never checked, how many `unknown`, and any discrepancies. The only
   page-level date is the oldest last-checked time, calculated from the facts;
   no separate page date is shown. **Proposed**, following the glossary's rule
   that any page-level date is calculated from the facts. Reason: checking one
   fact does not refresh the others, so a stored page date would mislead.
5. **Facts.** Each fact shows the claim, its [freshness](#how-freshness-is-shown),
   its fact state, its source (as a link where possible), who checked it and the
   check scope. **Decided** that these are recorded (D-007). Presentation
   **proposed**. The glossary defines a fact as the smallest unit that carries
   its own state, source and last-checked time, and leaves the exact unit to
   the Catalog document; the page shows freshness at that unit.
6. **Body text.** The readable description.
7. **Links.** Related entities, and pages that link to this one. **Proposed.**
8. **Tasks.** Unfinished tasks related to this entity, and recently done ones.
   **Proposed.** Reason: the owner can see what is changing about a project or
   machine without searching.
9. **History.** The entity's timeline: catalog proposals applied, facts
   checked, state changes. **Proposed.**

### How freshness is shown

- Each fact shows how long ago it was last checked in words ("checked 3 days
  ago"), with the exact date one step away. **Proposed.**
- Freshness is shown as age, not as right or wrong. Shinan does not mark a fact
  as "stale" by default. **Proposed.** Reason: there is no single interval after
  which a fact is wrong (glossary, Freshness); age is a risk signal for the
  reader to weigh.
- If the [Catalog](catalog.md) document lets a workspace set a "recheck after"
  period for an entity type or fact, facts past it are highlighted and listed
  on a "Due for a check" page. **Proposed**, dependent on the Catalog document;
  see [decision 4](#decisions-needed-from-the-owner).
- Facts never checked show "not checked". Facts in fact state `unknown` show
  "unknown" plainly, never a blank. **Proposed.** Reason: the `workspace`
  repository's rule that unknown and not verified are valid, visible outcomes.
- Fact states are labelled in words: intended ("should be"), observed ("seen"),
  proposed ("planned") and unknown. The glossary recommends renaming the
  `proposed` fact state to `planned` (glossary decision 3); the label reads
  "planned" either way. **Proposed.**
- **Discrepancies:** when an intended fact and an observed fact disagree, both
  are shown together with their sources and check times, marked as a
  discrepancy. Neither is presented as the right one. **Proposed**, following
  the glossary's discrepancy rule.
- The same freshness display is used wherever a fact appears outside its page,
  for example in search results or a task's related entities. **Proposed.**
  Reason: a fact quoted without its age loses the trust signal.

### Moving around the wiki

- An index per entity type (projects, machines, services, runbooks, decisions,
  policies, people, agents), each a sortable list with entity status, entity
  owner and the freshness summary.
- Search, and links between pages.
- A **Start here** link from the wiki's first page.

**Proposed.** Reason: the `workspace` repository's catalog is navigated the
same way (per-type indexes and links) and that works.

### Changing the catalog from the wiki

- **Suggest a change** opens the page's text and fields for editing. Saving
  creates a catalog proposal. The glossary proposes that in the first version
  every catalog proposal needs approval except a re-check that leaves the claim
  unchanged; the rule is owned by the [Catalog](catalog.md) document, and the
  screen says before saving whether the change will wait for approval.
  **Decided** that agents propose and people approve where needed (plan,
  Catalog pillar). The flow is **proposed**.
- **Record a check** lets a person record that they checked a fact. It asks
  what was checked (the scope) and how (the source). It cannot be saved without
  both. If the claim and its fact state are both unchanged, only the
  last-checked time moves and it applies at once. If the person found a
  different claim, or the fact state should change (for example from
  `intended` to `observed`), it becomes a catalog proposal. **Proposed.**
  Reason: the `workspace` repository's rule that dates refer to actual checks
  and must not be refreshed mechanically; and the glossary's first-version
  rule exempts only re-checks that change nothing but the time.

### Reviewing a catalog proposal

The review screen shows, per entity changed: each fact before and after
(claim, fact state, source, last checked), body text changes, the evidence, the
related task, and the author with attribution. Actions: **Approve**,
**Reject** with a reason, and **Comment**. The list of catalog proposals shows
`pending` ones first, with their age. Only people approve; agents are never
offered approval. **Proposed**, following the glossary's proposal that only
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
  repository, when and how to ask for a person (`needs a person`), and what
  needs deployment approval. This is Shinan's version of today's
  `agent-entrypoint.md` in the `workspace` repository.

Both paths are ordered lists of catalog entities (mostly `policy`, `runbook`
and `project` entities) with a short note per step. They do not copy pages;
each step opens the entity page. **Proposed**; see
[decision 5](#decisions-needed-from-the-owner). Reason: people need orientation
and setup, agents need short, strict rules because their context is limited;
building both from the same pages keeps one source of truth.

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

## Triage

Outside issues become tasks in `triage` from the first day (D-003). **Decided.**

- **Phase 1:** the task list filtered to `triage`, reachable from
  [Needs you](#1-needs-you). Each task page offers **Accept** and **Cancel**.
  **Proposed**, matching the roadmap draft's "a simple list of `triage` tasks
  is enough" for phase 1. Reason: outside issues arrive whether or not the
  inbox exists.
- **Phase 2: the triage inbox** (plan, section 10). It lists tasks in `triage`.
  For each: the outside issue's title and short summary, the repository, the
  outside actor who opened it, when, and "origin closed" if its author has
  closed it. Actions, as defined by [Tasks and work](tasks.md) (its draft,
  section 5.2): **Accept** (optionally assign and edit the intent), **Merge
  into an existing task**, and **Cancel** with a reason. **Proposed** screen;
  the actions are owned by Tasks and work. Only people see these actions.
  Batch actions (accept or cancel several) are offered. **Proposed.** Reason:
  connecting a busy repository can bring many issues at once.

## Unlinked work

[Tasks and work](tasks.md) proposes a list of branches and PRs in connected
repositories that carry no task ID (its draft, section 4). This document
proposes the screen: each item shows repository, kind, title, who made it (with
attribution confidence) and age, with **Link to a task**, **Create a task from
it** and **Dismiss**. Its count is shown in the task list, not in Needs you.
**Proposed.** Reason: a forgotten marker is a small slip, not something that
blocks agents, so it should not compete for attention with work that does.

## Notifications

Notifications by email or chat are phase 2 (plan, sections 5 and 10).
**Decided.** No document in plan section 8 owns them. This document proposes
the person's side; how they are sent is an
[open question](#open-questions).

- **What is sent:** the [Needs you](#1-needs-you) items, and replies by people
  or agents to the person's own comments. Nothing else by default.
  **Proposed.** Reason: notifications should bring a person back only for what
  needs them; the Now screen covers the rest.
- **Per-person settings** in [your account](#your-account): which kinds of
  item to receive, per workspace; immediately or as a daily summary; and quiet
  hours. Deployment approval requests are always sent immediately unless the
  person turns them off explicitly. **Proposed.** Reason: deployment approval
  blocks work that is otherwise finished.
- **Content:** a short title, the workspace and task ID, and a link that
  requires sign-in. No fact contents, approval details or comment text.
  **Proposed.** Reason: notifications leave the signed-in app, and the
  workspace holds infrastructure details (D-015).

## Workspace and member management

What roles exist and what each may do is owned by [Identity](identity.md); the
glossary proposes three roles: workspace owner, contributor and viewer. This
section describes the screens. Actions a person's role does not allow are not
offered, and a viewer sees a short note that the workspace is read-only for
them. **Proposed.**

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
| General | Name, creation date, workspace owners | Rename; delete workspace (typed confirmation, consequences listed first) |
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
glossary's rule that a workspace always has one. The rules themselves are owned
by [Identity](identity.md).

Sensitive actions (changing roles, creating or revoking tokens, adding git host
connections, deleting the workspace, giving deployment approval) may require
the person to sign in again. Which ones is owned by [Identity](identity.md).

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
workspaces they belong to with their role, pending invitations, and
[notification settings](#notifications) (phase 2). **Proposed.**

### Your agents

Agents belong to one workspace and act for one member (glossary, Agent). In
each workspace, a member sees **Your agents**:

1. **Register an agent:** a name (suggested, for example "Guneet's OpenCode")
   and the coding tool. Every role may register agents; a viewer is told that
   their agent will be read-only, because an agent can never do more than its
   member (glossary, Member and role). By default there is one agent per
   coding tool; more can be added, for example one per machine.
2. **Get a credential:** shown once, with a way to copy it and the warning
   that it will not be shown again. Where the coding tool supports signing in
   instead (Agent integrations proposes OAuth sign-in for the MCP server), the
   screen offers that first. **Proposed.** Reason: credentials must not be
   retrievable later, and signing in avoids copying them at all. Credential
   types are owned by [Identity](identity.md).
3. **Connect:** short instructions for that coding tool: install the plugin
   where one exists (Agent integrations proposes that it also sets up the MCP
   server and skill), otherwise add the MCP server and skill. The content is
   owned by [Agent integrations](agent-integrations.md).
4. **Waiting for first contact:** the screen waits until the agent's first
   agent session reaches Shinan and then confirms what is working. Phase 1:
   "Presence: plugin-reported" or "Presence: self-reported only (no plugin)".
   Phase 2 adds how nudges will arrive: "live" or "only when it checks in".
   **Proposed.** Reason: the person learns now, not later, how well Shinan
   will be able to see and reach this agent.

From the same screen a member can rename or disable their agents and create or
revoke credentials. **Proposed.**

## Phasing

How this document's screens map to the plan's phases (plan, section 10). The
[Roadmap](roadmap.md) decides the exact first release; its draft splits phase
2 into 2a (collaboration) and 2b (migration), with everything below in 2a.

| Phase | Screens | Status |
|---|---|---|
| 1 | Now screen; task list (including the `triage` filter); task page with comments, panels and steering actions (changes are events agents see when they next read the task); timelines; agents view; wiki with start here paths; catalog proposal review; unlinked work; workspace and member management; your account and agents | Decided that the wiki, tasks, timeline and presence are phase 1 (plan, section 10). Including member management in phase 1 is proposed (D-019: multi-user is designed in from the start); the rest is proposed |
| 2 | Board; nudges (recipients, delivery states, waiting comments, "nudge not received" in Needs you); triage inbox; notifications | Decided (plan, section 10) |
| 3 | Starting agent sessions from the task page through a launcher | Decided (plan, section 10; D-014) |

## How today's practice maps to these screens

For reference, since the owner already works this way in the `workspace`
repository (D-018 says it stays the source of truth until Shinan is ready).

| Today, in the `workspace` repository | In Shinan |
|---|---|
| `human-effort` label and TL;DR comment | `needs a person` task flag and its [panel](#needs-a-person-panel); listed in [Needs you](#1-needs-you) |
| Asking for deployment approval in the conversation or issue | The [deployment approval panel](#deployment-approval-panel), first in [Needs you](#1-needs-you) |
| Forgejo Project board for workflow | [Board](#board-phase-2) with columns by task status |
| `last_verified`, `verification_scope`, `verification_source` per catalog entry | Last checked, check scope and source per fact, shown as [freshness](#how-freshness-is-shown) |
| `docs/agent-entrypoint.md` | [Start here for agents](#start-here-for-agents) |
| Announcing an agent's identity in an issue comment when agents share an account | Presence and "acting for" on every agent event |

## Dependencies on other documents

| Document | What this document needs from it |
|---|---|
| [Domain model and glossary](domain-model.md) | All terms. Its pending owner decisions change wording here, and this document works with either outcome: status calculated from linked work plus recorded events (1), agents setting `needs a person` (2), renaming the fact state `proposed` to `planned` (3), per-workspace task ID prefixes (4), and the `awaiting deployment approval` flag (5). Its open question on event redaction affects [corrections](#freshness-and-corrections). If [decision 6](#decisions-needed-from-the-owner) is adopted, the nudge definition must say that a nudge with no active session waits for the next claiming agent session. |
| [Product overview](product-overview.md) | Confirmation that "steer, don't operate" matches the positioning. |
| [Catalog](catalog.md) | Entity types and their fields for entity pages; the exact unit of a fact; whether recheck periods exist; the approval rule for catalog proposals, including whether a fact state change alone needs one; where start here paths are stored and how the agent path appears in the agent index. |
| [Tasks and work](tasks.md) | Task fields; the rules behind each status explanation, including `verifying` and status freshness; who sets and clears each manual state; the required contents of a deployment approval request and what makes an approval stale; how a deployment approval request is recognised if the separate flag is not adopted; when comments become nudges and the "note only" opt-out; the bound on waiting nudges ([decision 6](#decisions-needed-from-the-owner)); whether an agent's reply to a nudge is a comment or a progress update; ranking in `to do` ([decision 2](#decisions-needed-from-the-owner)), which should be listed there; triage actions; the unlinked work list. |
| [Identity, agents and permissions](identity.md) | Roles and what each may do; who may approve catalog proposals and give deployment approval; how private repositories appear on a task; consequences of removing a member; which actions need signing in again; who may create workspaces; credential types; who may use a launcher, limited to their own agents. |
| [Git host integrations](git-hosts.md) | Connection health and what counts as "behind" for reconciliation; the threshold for showing when a task status was last confirmed; where the list of automated accounts lives; whether storing more git host text than a summary is wanted; whether Shinan may reply on an outside issue after triage. |
| [Agent integrations](agent-integrations.md) | Presence thresholds (`unresponsive`, the self-reported check-in interval used for "not seen since", and the timeout that ends an agent session); waiting reasons and labels; delivery states, the "queued in the coding tool" detail and the route; the "at its next step" and "after current work" choice and its default; the "reply to nudge" tool; the ready-made start prompt; connect instructions per coding tool; the launcher's options in phase 3; whether a session can be stopped from Shinan. |
| [Architecture and operations](architecture.md) | Installation-level settings (such as who may create workspaces); how screens update while open; storage if more git host text is kept; how notifications are sent. |
| [Roadmap and migration](roadmap.md) | Which phase 1 screens are in the first release; the proof-of-concept projects used in the setup checklist. |

## Open questions

1. **Stopping an agent session.** Should the task page offer "stop" as well as
   "detach", and can a plugin do it? ([Agent integrations](agent-integrations.md))
2. **Private repositories on a task.** Is the existence of a work item the
   person cannot see shown at all? ([Identity](identity.md), plan question 3)
3. **Who owns notifications.** No document in plan section 8 owns how
   notifications are sent (channels, delivery, failures). Recommended: the
   [Architecture](architecture.md) document for sending, this document for what
   is sent and the person's settings.

## Decisions needed from the owner

| # | Decision | Recommended | Reason |
|---|---|---|---|
| 1 | Comments tell attached agent sessions by default, with a "note only" opt-out (phase 2; shared with Tasks and work, which owns when nudges are created) | Yes | The plan already decides that comments reach the agent; most comments on a task an agent is working on are meant to steer it. |
| 2 | People can rank tasks in `to do` to say what comes next (to be listed in Tasks and work, since it adds a task attribute) | Yes, a simple order with no priority levels | Choosing what is worked on next is the main steering act, and an order is simpler than a priority field. |
| 3 | When attribution is `unknown`, text events (comments, reviews, descriptions) show at full prominence, labelled as unsure; routine events (commits, pushes, CI) stay compact | Yes | Hiding a person's written instruction is worse than showing an agent's comment too loudly, but routine activity must stay compact. |
| 4 | Freshness: show each fact's age always, and highlight facts past a recheck period only where the workspace sets one (depends on the Catalog document offering periods) | Yes | No single interval fits every fact, but some facts need a reminder. |
| 5 | Two start here paths, for people and for agents, built from the same catalog pages | Yes | People need orientation, agents need short strict rules, and shared pages keep one source of truth. |
| 6 | Comments that reach no agent session wait for the next agent session that claims the task, limited to nudges never delivered to any agent session (changes the glossary's nudge definition; shared with Tasks and work and Agent integrations) | Yes | An instruction written before an agent starts should not need repeating, and the limit stops old instructions being replayed. |
| 7 | Let people answer an agent session's permission prompt or question from the web app in the first version | No; show the reason and where to answer | Approving actions remotely through a public web app (D-015) needs its own security design. |
| 8 | Design the Now screen, task pages, commenting and approving to work on a phone from the first version ([principle 8](#design-principles)) | Yes | The app is public so the owner can steer from anywhere (D-015). |
