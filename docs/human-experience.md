# Human experience

Status: **approved by the owner on 2026-11-16** ([issue #10](https://github.com/guneet-xyz/shinan/issues/10); integrated in [#26](https://github.com/guneet-xyz/shinan/issues/26)).
The owner's answers in [#25] (O-1 to O-98 and follow-ups N-1 to N-13) and on
the integration review [#26] (NO-1 to NO-4) are applied.

This document describes what people see and do in Shinan's web app: the screens,
what each shows, and the flows between them. It covers the catalog pages and
the start here path, task pages, timelines, the board, nudges as a person sees them, the
agent presence view, notifications, and workspace and member management.

It describes screens and flows in words: what is shown, in what order of
importance, and what each action does. It does not choose layout or visual
style. The technology is now chosen (TypeScript, a plain Node.js server and a
React single-page app: **Decided** (owner, O-60, O-61, [#25])), but nothing here
depends on it.

## How to read this document

- Terms come from the [domain model and glossary](domain-model.md) and are used
  exactly as defined there. Decisions are recorded in the
  [decision log](decisions/README.md).
- Every statement is marked:
  - **Decided**: follows from an accepted plan decision (D-nnn) or from the
    owner's answers, cited as "owner, O-n, [#25]" or "owner, N-n, [#25]" for
    the decision checklist and its follow-ups, and "owner, NO-n, [#26]" for
    the integration review.
  - **Proposed**: suggested here, with a reason.
  - **Open**: not settled; listed under [open questions](#open-questions).
- Where a rule belongs to another document (for example when a nudge is
  created, or which catalog changes need approval), this document only says how
  the screen shows it and lists the dependency.
- No external product facts are relied on in this document, so none needed
  checking.

## Scope

This document owns (plan, section 8):

| Area                            | Covered in                                                          |
| ------------------------------- | ------------------------------------------------------------------- |
| Catalog (formerly "wiki")       | [The catalog](#the-catalog)                                         |
| Onboarding path                 | [Start here and onboarding](#start-here-and-onboarding)             |
| Task pages                      | [Task page](#task-page)                                             |
| Timeline                        | [Timelines](#timelines)                                             |
| Board                           | [Task list and board](#task-list-and-board)                         |
| Nudges (the person's side)      | [Comments and nudges](#comments-and-nudges)                         |
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
   large catalog pages and settings may be desktop-first. **Decided** (owner,
   O-92, [#25]). Reason: the app is public so the owner can steer from
   anywhere (D-015).
9. **Small and legible over configurable.** Where the owner allows
   configuration (custom task flags, custom entity types), screens keep the
   defaults visible and say what a change affects. **Decided** principle
   (owner, O-86, [#25]); its use here is **proposed**.

**Decided** (owner, 2026-11-20, [D-067](decisions/D-067-product-owner-role.md)):
the experience of people using Shinan comes first. Every screen follows the
[product principles](product-principles.md): few concepts, plain words, one
job per screen, and calm, readable design.

### Phase 1 and nudges

The plan puts nudges in phase 2 (plan, section 10). **Decided.** In this
document, wherever an action **tells attached agent sessions**, that means:

- **Phase 2 onwards:** a nudge is created, following the rules in
  [Tasks and work](tasks.md).
- **Phase 1:** the action is only an event on the task. Agents see it the next
  time they read the task. Nothing is pushed to them, and the screen does not
  claim it was delivered.

**Proposed.** Reason: the plugin in phase 1 reports presence only
([Roadmap](roadmap.md)); the screens must not promise delivery that cannot
happen yet.

## Map of the app

> **Changing with the [Git-based catalog](build-plan-git-catalog.md)** ([GC-7](build-plan-git-catalog.md#gc-7-the-catalog-ui)): the catalog's screens follow the plan's §3; catalog review goes. The navigation below is built (GC-7's first PR); the table's catalog rows change with GC-7's later PRs.

**Navigation: one left sidebar for the whole app. Decided (owner,
2026-11-20, [answers on #183](https://github.com/guneet-xyz/shinan/issues/183#issuecomment-7029973618));
as built in GC-7 ([#169](https://github.com/guneet-xyz/shinan/issues/169)).**

- **What it holds, top to bottom:** "Shinan" and the workspace switcher, a
  search box ("Search the catalog…"), Start here, Recent changes, Needs attention (with how
  many things need it, when there are any), the catalog's folders, then
  Settings, Your account, and Installation for installation operators.
- **The folders** are those of `main`, by their names in the repository
  (`machine`, `service`), sorted with `schema` last. Each holds its pages
  by title only. Only the folder of the page open starts open; any folder
  opens with a click. A large folder shows its first 100 pages, then "Show
  more (N more)" adds 500 at a time; the page open always shows, with five
  pages on each side, after a "…".
- **Titles, folder names and other one-line texts** (a page's summary,
  search snippets, Needs attention's fact lines) are written by agents, so
  hidden, bidirectional and control characters in them show as markers
  such as `⟨U+202E⟩` wherever they appear (sidebar, search, Needs
  attention, a page's heading and summary): "Invoice ⟨U+202E⟩gnp.exe"
  cannot pass for "Invoice exe.png". A page's rendered body is left as
  written. Long unbroken words, such as an address, wrap.
- **Left out of the folders:** the start-here page, which is Start here;
  `README.md`; retired pages, which search finds; and files that cannot be
  read as pages, which are under Needs attention.
- **On narrow screens** the sidebar folds into a "Menu" button at the top,
  which opens it as a sheet. Focus starts on its "Close menu" ×, not the
  search box (which would bring up a phone's keyboard). Following a link
  closes it and moves focus to the new page's heading; the × or Escape
  closes it and returns focus to Menu.
- **Outside a workspace** (Your account, Installation) it shows the
  workspace last open, else the person's first, so it keeps its shape.
  Someone with no workspace sees only Your account.
- **The old navigation is gone:** the top bar and the workspace's "Wiki |
  Settings" tabs. Workspace settings keep their own tabs inside the
  settings page.
- **Reason:** one navigation instead of a file tree beside two rows of tabs
  ([product brief on #169](https://github.com/guneet-xyz/shinan/issues/169#issuecomment-7029844112)).

The app is organised per workspace. A person who belongs to several workspaces
switches between them; nothing from one workspace appears in another.
**Proposed**, following the glossary. Reason: workspaces hold infrastructure
details (D-015), so a hard boundary is the simplest to keep safe. Inside a
workspace every member sees everything, including work from private
repositories. **Decided** (owner, O-43, [#25]).

| Place                                                  | What it is for                                                                                                               | Phase   |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------- |
| [Now](#the-now-screen)                                 | What needs me, what is being worked on, what changed                                                                         | 1       |
| [Tasks](#task-list-and-board)                          | Task list (phase 1) and board (phase 2)                                                                                      | 1 and 2 |
| [Task page](#task-page)                                | The story of one task, and steering it                                                                                       | 1       |
| [Timeline](#timelines)                                 | Everything that happened in the workspace                                                                                    | 1       |
| [Catalog](#the-catalog)                                | The catalog for people, including [start here](#start-here-and-onboarding)                                                   | 1       |
| [Catalog review](#reviewing-catalog-changes)           | Removed (GC-5, [D-060](decisions/D-060-no-catalog-approval.md)): no catalog approval; GC-7 rewrites the map                  | 1       |
| [Agents](#agents-view)                                 | Agent sessions and their presence                                                                                            | 1       |
| [Triage](#triage)                                      | A filtered task list in phase 1; the full triage inbox in phase 2                                                            | 1 and 2 |
| [Unlinked work](#unlinked-work)                        | Branches and PRs with no task ID                                                                                             | 1       |
| [Workspace settings](#workspace-and-member-management) | Members, invitations, agents, git host connections, task flags, catalog settings, security log, data (export, import, purge) | 1       |
| [Your account](#your-account)                          | Sign-in, git host accounts, your agents, your machines (phase 3), workspaces, notification settings (phase 2)                | 1       |

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

Every task page has a stable address built from its task ID, used in markers,
backlinks and emails. An address with an earlier prefix of the workspace leads
to the same task. The address is `https://<installation address>/t/<task ID>`,
for example `https://shinan.guneet.dev/t/T-124`, as defined by
[Architecture](architecture.md) section 3.6; prefixes are unique within an
installation ([Tasks and work](tasks.md) section 3), so the task ID alone
identifies the workspace. **Proposed.**

## The Now screen

The Now screen is the home page of a workspace. It has three sections, always
in this order. **Proposed.** Reason: [attention first](#design-principles).

### 1. Needs you

Everything waiting on a person, longest-waiting first. Each item says in one
line what is needed and opens the place to act. Items for you come first; a
second group shows items waiting on any person in the workspace, so nothing is
missed when nobody is assigned.

| Item                                | Shown when                                                                                                                                                                                        | One-step action                                                                                | Phase |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----- |
| Deployment approval                 | A task has `awaiting deployment approval`                                                                                                                                                         | Opens the task's [deployment approval panel](#deployment-approval-panel)                       | 1     |
| Task needs a person                 | A task has `needs a person`, or a [workspace flag](#task-flags) set to appear here                                                                                                                | Opens the task's [needs a person panel](#needs-a-person-panel), or the task                    | 1     |
| Agent session `waiting`             | A plugin-reported agent session is waiting for a person, with its reason (`permission` or `question`) and short label                                                                             | Opens the agent session, which says on which machine and coding tool to answer                 | 1     |
| Agent session silent on a task      | An attached agent session is `unresponsive`, or sends no heartbeats and is [overdue](#when-an-agent-session-goes-quiet)                                                                           | Opens the task with options to [start a new agent session](#when-no-agent-session-is-attached) | 1     |
| Work link to confirm                | An unconfirmed work link is waiting: from an outside actor's marker (only a person can confirm it), or from a member's closing reference to an `origin` issue that no agent session has confirmed | Opens the task's [work](#work) with **Confirm** and **Dismiss**                                | 1     |
| Tasks in triage                     | One or more tasks are in `triage`                                                                                                                                                                 | Phase 1: the task list filtered to `triage`. Phase 2: the [triage inbox](#triage)              | 1     |
| Catalog change waiting for approval | Removed (GC-5, [D-060](decisions/D-060-no-catalog-approval.md)): catalog changes no longer wait for approval                                                                                      | Opens [catalog review](#reviewing-catalog-changes)                                             | 1     |
| Git host connection failing         | A connection's health is failing                                                                                                                                                                  | Opens the connection's settings                                                                | 1     |
| Invitation for you                  | You have a pending invitation to another workspace                                                                                                                                                | Accept or decline                                                                              | 1     |
| Workspace setup checklist           | The workspace is new and setup is not finished                                                                                                                                                    | Opens the [setup checklist](#first-run-for-a-new-workspace)                                    | 1     |
| Nudge not received                  | A delivery of your nudge is `undeliverable`, or still `pending` to an agent session that has gone silent                                                                                          | Opens the comment with delivery options                                                        | 2     |

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
  delivering PR merged, and, where an acceptance criterion is marked "verify
  after merge", the recorded verification and who recorded it. **Decided** rule
  (owner, O-4, O-21, O-22, [#25]: a task is done when all its subtasks are done
  and every PR linked to it as delivering work is merged; "verify after merge"
  is off unless a criterion is marked).
- For `verifying`, it names the criterion still waiting for verification.
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
- **Approve** and **Decline** are shown only to people allowed to answer:
  workspace owners, and contributors when the workspace setting "contributors
  may give deployment approval" is on (off by default). Others see who can
  answer. Answering asks the person to sign in again. The rules are
  [Tasks and work](tasks.md)'s (section 8.4) and [Identity](identity.md)'s;
  the setting is on the [General](#workspace-settings) settings screen.
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

Deployment approval requests and answers are always recorded as task events,
whether or not the workspace keeps the `awaiting deployment approval` flag.
**Decided** (owner, NO-4, [#26]). If a workspace removes the flag, the panel
and its Needs you row go with it; a pending request is then shown on the task
timeline as a milestone event with the same **Approve** and **Decline**
actions. **Proposed.** Reason: removing a flag removes how it is displayed,
never the record or the ability to answer.

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
it is marked "verify after merge", and, when met, the evidence (a link to a work
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
  count toward status until confirmed. A link from an outside actor's marker
  can be confirmed only by a person. **Decided** (owner, O-24, [#25]). A link
  from a member's closing reference to an `origin` issue can also be confirmed
  by an agent session acting for a member, following
  [Tasks and work](tasks.md) section 6.4. The screen says which kind each
  link is. **Proposed.**
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

| Action                                                                                                         | Notes                                                                                                           | Status                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Comment                                                                                                        | Tells attached agent sessions unless marked "note only" (phase 2)                                               | Decided (plan, Nudges pillar; owner, O-26, [#25])                                                                                  |
| Give or decline deployment approval                                                                            | See [deployment approval panel](#deployment-approval-panel)                                                     | Decided where approval is given (owner, O-20, [#25]); panel proposed                                                               |
| Accept or cancel a task in `triage`; set or clear `on hold`, `cancelled`, `needs a person` and workspace flags | Asks for a short reason. Setting `on hold` and clearing `needs a person` tell attached agent sessions (phase 2) | Decided that some states are set by hand (plan, Tasks pillar; owner, O-7, O-8, [#25]); who may set each is owned by Tasks and work |
| Edit intent and acceptance criteria                                                                            | Tells attached agent sessions (phase 2)                                                                         | Proposed                                                                                                                           |
| Add or remove subtasks                                                                                         |                                                                                                                 | Decided (owner, O-21, [#25])                                                                                                       |
| Rank in `to do`                                                                                                | See [ranking](#ranking)                                                                                         | Decided (owner, O-28, [#25])                                                                                                       |
| Assign or unassign members                                                                                     | Assignment is not a lock                                                                                        | Proposed (glossary, Assignee)                                                                                                      |
| Start a new agent session for this task                                                                        | See [below](#when-no-agent-session-is-attached)                                                                 | Decided (plan, Nudges pillar)                                                                                                      |
| Release an agent session                                                                                       | Releases the agent session from the task and tells it by a nudge from the person (phase 2)                      | Proposed, following [Tasks and work](tasks.md) section 10 (releasing by hand). Reason: the owner must be able to redirect work     |
| Ask my agent to act on a git host                                                                              | See [below](#asking-your-agent-to-act-on-a-git-host)                                                            | Decided (owner, O-1, N-3, [#25])                                                                                                   |

### Asking your agent to act on a git host

Shinan does not act on git hosts for a person: it writes to GitHub only as its
app and makes no writes on Forgejo. **Decided** (owner, O-1, N-4, [#25]).
Wherever a person might want something done on a git host (for example
opening a repository issue for the task, or closing or commenting on an origin
issue), the screen offers **Ask my agent**. The request is sent as a queued
nudge to the person's **own** agent sessions, never to sessions found on
subtasks or acting for someone else; if none is running, it waits like any
nudge until one claims the task or the person starts one. **Decided**
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
and how. Recipients follow [Tasks and work](tasks.md) section 11.2: the agent
sessions attached to the task; or, if none is attached to the task itself, the
agent sessions of its nearest descendants (on each path down, the first
subtask with a session). Each recipient is shown with its presence; recipients
found on subtasks also show which subtask they work on. **Decided** that a
nudge waits only when nothing in the tree reaches an agent session (owner,
O-27, [#25]); the descendant rule is Tasks and work's.

| Situation                                                                                                                | What the box says                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| A plugin-reported agent session (presence source `plugin-reported`) with live delivery is running and not `unresponsive` | "Guneet's OpenCode on Daedalus will get this at its next step."                                                                  |
| A recipient without live delivery (self-reported, or a plugin without live delivery), seen recently                      | "Guneet's Codex on Musashi will see this when it next calls Shinan. Last seen 12 minutes ago."                                   |
| A recipient is `offline`                                                                                                 | "Guneet's OpenCode on Daedalus is offline. This will reach it when it resumes, or the next agent session that claims this task." |
| A recipient is `unresponsive`, or [overdue](#when-an-agent-session-goes-quiet)                                           | "This agent session has not been seen for 2 hours. It may never pick this up." with **Start a new agent session**                |
| No agent session is attached to the task or any of its subtasks                                                          | "No agent is working on this task. This will wait for the next agent session that claims it." with **Start a new agent session** |
| Recipients come from subtasks                                                                                            | "No agent session is on this task itself. This goes to the agent sessions on its subtasks:" followed by one line per recipient   |
| Several recipients                                                                                                       | One line per agent session, each with a tick box, all ticked                                                                     |
| A recipient's member has turned off nudges from other members (built before a second member joins)                       | "Alex's OpenCode does not accept nudges from other members." That recipient is left out                                          |

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

| Delivery (per target agent session)    | Shown as                                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `pending`, offered to the plugin       | "Sending to Guneet's OpenCode on Daedalus"                                                                 |
| `pending`, accepted by the coding tool | "Queued in Guneet's OpenCode; it will see this at its next step"                                           |
| `pending`, available at check-in       | "Waiting for Guneet's Codex to acknowledge (sent 10:42; last seen 10:30)"                                  |
| `pending`, agent session `offline`     | "Waiting for Guneet's OpenCode to resume"                                                                  |
| `delivered`, live                      | "Delivered live to Guneet's OpenCode on Daedalus at 10:42"                                                 |
| `delivered`, at check-in               | "Acknowledged by Guneet's Codex at 10:55"                                                                  |
| `undeliverable`                        | "Not received: the agent session ended first. It will go to the next agent session that claims this task." |
| `withdrawn`                            | "Withdrawn by Guneet at 10:44"                                                                             |
| `cancelled` in the coding tool         | "Removed in the coding tool by the person at Daedalus; not sent another way"                               |

When a nudge had no target at all (no agent session anywhere in the task's
tree), the comment shows "Waiting for an agent session to claim this task" with
**Start a new agent session**.

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

A comment that reaches no agent session, on the task or any of its
descendants, waits for the next agent session that claims the task, but only
nudges never delivered to any agent session wait. **Decided** (owner, O-27,
[#25]). Waiting nudges are delivered together, in order, when an agent session claims
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

### Task notices

A task notice is a message from Shinan, not from a person, telling the agent
sessions on a task that something happened which no person did in Shinan: a
`delivers` PR closed or merged, a dependency finished, or an unconfirmed link
from an outside actor. When notices are sent and how they travel are owned by
[Tasks and work](tasks.md) (section 11.4) and
[Agent integrations](agent-integrations.md).

- On the task timeline, a notice is a **compact** event labelled "from
  Shinan", grouped with the event that caused it, with its delivery outcomes
  shown the same way as a nudge's.
- On an agent session's page, notices are listed with the nudges it received.
- A notice that reached no agent session is shown as "not delivered; the next
  agent session reads it on the task's timeline". It does not appear in
  [Needs you](#1-needs-you).

**Proposed.** Reason: notices carry no person's instruction, so they stay
compact and never ask for attention; showing their delivery lets a person see
whether the agent heard about, for example, its PR being closed. Notices use
the nudge delivery path, so they arrive in phase 2.

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

| Level         | Which events                                                                                                                                                                                                                                                                                                                                                                                                                                          | How shown                                                                                                                                                                                                                                                                                                                                                   | Status                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Full**      | Anything a person did in Shinan: comments, intent and criteria changes, manual state and flag changes, deployment approvals, task creation, subtask changes, ranking, triage decisions, catalog approvals and reverts, link confirmations, assignments. Text events on a git host by a person or with an [unsure credit](#showing-who-did-what): comments, reviews, issue and PR descriptions. Comments by outside actors on an `origin` issue.       | Never collapsed, with the person's name and a clear marker that a person did it. Comments written in Shinan are shown in full. Git host text is shown as the event's short summary with a link to the original.                                                                                                                                             | Decided that human activity stands out; which events count is proposed |
| **Milestone** | Agent or automatic events a person usually cares about: task status changes, `needs a person` set or cleared by an agent, a deployment approval requested or recorded from a conversation, a verification recorded, a pull request opened, ready for review, merged or closed, a CI check failing or recovering, an agent session `waiting`, going quiet, released after timing out, or ending, an agent's reply to a nudge, a catalog proposal made. | One line each, not collapsed, with the actor.                                                                                                                                                                                                                                                                                                               | Proposed. Reason: these change what the person should do next          |
| **Compact**   | All other agent and automatic activity: commits, pushes, branch creation, progress updates, catalog reads and routine catalog changes, presence changes, CI checks passing, routine work link creation including `related` links from mentions, [task notices](#task-notices) (labelled "from Shinan"), and activity from automated accounts.                                                                                                         | Grouped by agent session into one line per run of activity, for example "OpenCode session on Daedalus, acting for Guneet: 3 commits, 2 progress updates, CI passed (10:12 to 10:40)". Subagent runs are grouped under their parent's run. Expands to the individual events. A full or milestone event always ends a run, so cause and effect stay in order. | Decided that agent activity is compact; grouping proposed              |

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
  Automated accounts, such as dependency update tools, are shown at compact
  prominence. **Proposed.** Reason: their activity is frequent and
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
  records about their workspace. **Decided** (owner, O-50, [#25]). No
  security-log entry can ever be purged, by anyone. **Decided** (owner, N-13,
  [#25]; D-049). A purged
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
  work it did, and the nudges and [task notices](#task-notices) it received,
  with their delivery outcomes. **Proposed.**
- Agent sessions not on a task offer **Attach to a task**. **Proposed.**

### When an agent session goes quiet

Presence states and timeouts follow the owner's answer: a coding tool that
stops is `offline`; an agent session with no report or call for 24 hours is
released from its task, whatever its presence source, and re-claims it when it
resumes; `ended` only on delete, archive, an explicit end or after 30 days.
**Decided** (owner, O-32, [#25]: "release the task after 24 h of silence").
The other values below are set by [Agent integrations](agent-integrations.md).

- **With heartbeats:** shown as `unresponsive` after the threshold Agent
  integrations sets (3 minutes).
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
- **After 24 hours** with no report or call, with or without heartbeats, the
  agent session is released from its task with the reason "timed out", shown
  as a milestone event, and the task shows
  no agent working on it. If the agent session resumes, the re-claim is shown
  as a milestone too.

**Proposed** display. Reason: a crashed agent session that looks as if it were
still working would keep its task in "being worked on now" and make the comment
box promise delivery that may never happen.

Registering agents and revoking their tokens is under
[workspace settings](#workspace-settings) and [your agents](#your-agents).

## The catalog

> **Changing with the [Git-based catalog](build-plan-git-catalog.md)** ([GC-7](build-plan-git-catalog.md#gc-7-the-catalog-ui)): people browse `main` as a file tree, rendered pages, search, "needs attention" and commit history, with no editing (D-064). [A page](#a-page) and [moving around the catalog](#moving-around-the-catalog) are as built in GC-7; the introduction below describes M2 (v0.3.0).

The catalog pages show the catalog to people as readable pages (called "the
wiki" until the owner renamed it, [D-064](decisions/D-064-catalog-not-wiki.md)). **Decided** (D-006).
Each catalog revision's Markdown text is the source of truth and is stored in
Shinan's database only; there is no Git mirror for now. Catalog proposals and
review happen inside Shinan. **Decided** (owner, O-11, O-12, N-5, [#25]). The entity types, facts and rules are owned by the
[Catalog](catalog.md) document; this section is how they look and how people
move around them.

### A page

**As built in GC-7 ([#169](https://github.com/guneet-xyz/shinan/issues/169)),
from the [product brief](https://github.com/guneet-xyz/shinan/issues/169#issuecomment-7029844112).**
It replaces M2's entity page (v0.3.0), whose header row, cards, freshness
summary, "Owning sources" and "Not yet recorded" are gone. A page reads, in
order:

1. **A calm notice if it is retired or deprecated**, with where to go
   instead: "This page is retired. See Email." Without a replacement, a
   retired page "is kept for its history".
2. **The title, then the summary as one line.** If the title has hidden
   characters, one line under it says so ("This title has hidden
   characters, shown as ⟨U+…⟩: they can make text read as something
   else."), or "This page's title or summary has…" when the summary has
   them. An old ID opens the current page, which says "You followed an
   old address".
3. **One sentence for each disagreement** not accepted, in a notice: "Two
   checks disagree about disk data size: 128 GiB and 64 GB (both seen 5
   days ago)." When the checks are of different ages, each value has its
   own.
4. **Facts**, as a short two-column list: the key as a label (dots,
   underscores and dashes become spaces, in sentence case, so
   `disk.data.size` reads "Disk data size"), then the value and its age:
   "74 GiB · checked 40 days ago · due for a recheck". The state shows only
   when it isn't "seen": "should be 128 GiB", "planned 128 GiB", "unknown:
   reachability not tested". A key with several values lists each with its
   own age. A key whose values disagree says "disagree · show both checks"
   ("disagree · hide checks" while open):
   the sentence at the top has the values, and the button opens each value
   with its age and its check ("128 GiB · seen 6 days ago", then when, by
   whom, what was checked and the source). Relations are links to the other page by
   title; a `secrets-in` fact reads "kept in Vault as musashi/ssh", never a
   value. **The check is one tap away, on the age**: when, by whom (the
   check's `by`, with "via" in words: "guneet, through opencode-daedalus"),
   what was checked, the source and what wasn't checked.
5. **The body**, rendered. A first heading that repeats the title is left
   out, and the body's top headings sit at the level of the page's own.
   Raw HTML is shown as text; only web and mail addresses, references to
   other pages and links to a section of the page are links
   ([security checklist 10.3](security-checklist.md#10-features-not-built-yet)).
6. **Related pages:** pages that link to this one, by title, under plain
   headings (the relation's inverse name, such as "Services", else "Linked
   from"), and "Policies and runbooks that apply". Each page shows once,
   under the first heading it belongs to. The page's own relations are among its facts.
7. **The footer:** "Last changed 2 hours ago · History · View source", then
   a quiet "About this page" line: its file, its ID only when it isn't the
   file's name without `.md` (until push checks enforce that, GC-3), old
   IDs, owner and status (and a decision's state). Who changed it comes from the push log
   (GC-3a): a commit's author isn't trusted
   ([D-061](decisions/D-061-push-authentication-and-push-log.md)), so until
   then no name is shown. When the repository can't be read, "Last changed"
   is left out.

- **Type schema pages** (`schema/<type>`) are pages like any other: title,
  summary, body and footer, with a muted line under the summary:
  "Describes the pages in the `domain` folder." M2's type pages and type indexes are gone
  (D-064: not by types); `…/catalog/types/<type>` leads to
  `…/catalog/p/schema/<type>`.
- **History** (`…/catalog/history/<ID>`) lists the changes of the page's
  file on `main`, newest first (in `git log`'s order), under "Today",
  "Yesterday" or the date. Commit times are set by agents and can go
  backwards in that order: a new day heading starts only on an earlier
  day, and a change dated later than its heading shows its own date
  ("Nov 20, 3:10 PM").
  Each is the change's message, its first line as the headline and the
  start of the rest under it (about 1,000 characters at most; hidden
  characters marked), when, and the short commit ID in muted text, so a
  person can tell an agent "revert abc1234". "Show older changes" reads the
  next 50, by a cursor Shinan signs holding where the list started and how
  far it got, so no change is skipped around merges. A cursor Shinan didn't
  give out for the page is refused, so History never shows a commit off the
  index's `main`.
- **Code blocks** in a body scroll sideways when a line is long, by
  keyboard too.
- **Recent changes** (`…/catalog/changes`, in the sidebar under Start
  here; GQ-6) lists `main`'s commits from the one the index is at, newest
  first, by day, as History does: the message's first line as the
  headline, the start of the rest, the time and the short commit ID, then
  up to three pages it changed by title ("Project 1, Project 2, Project 3
  and 2 more"). A file that isn't a page now (`README.md`, a deleted page)
  shows by its name. **Merges:** a merge whose changes all came with the
  merged commits is left out, since those commits are listed themselves; a
  merge that changed a file itself (a conflict resolved) stays, with only
  the files it changed itself (those that differ from every parent, as
  Git's combined diff), and one too large to work out stays with "Changed
  files not known". Each commit of a page gets a fair share of the Git container's work budget, so one very large commit can't leave the others on its page "not known". 30 commits at a time, then "Show older changes" by
  signed cursor; a page reads on past merges left out, up to 90 commits,
  rather than come back empty ("These latest commits only merged work
  listed further back. Show older changes to see it." if it still does). It is the review after the fact, now that
  changes need no approval. **Who pushed each change** comes with the push
  log (GC-3a); until then no name is shown (commit authors aren't
  trusted, D-061). Start here's "recent-changes" step links here.
- **View source** (`…/catalog/source/<ID>`) shows the file as it is, with
  hidden characters marked and long lines wrapped, and a Copy button that
  copies it exactly.
- **History, View source and Last changed read the repository**, at the
  commit the index is at, so they agree with the page. While `web` can't
  reach the Git container they say "This isn't available right now. Try
  again in a minute."
- **Hidden characters** in anything an agent wrote and the page shows on
  one line (titles, summaries, labels, values, check details, folder and
  file names) show as markers such as `⟨U+202E⟩`. Hovering a marker shows
  the character's name ("right-to-left override"); screen readers hear
  "hidden character: right-to-left override" instead of the marker.
- **A page that couldn't be read in full** says what couldn't be read.
- **Catching up:** "Catching up with the latest changes…" follows where the
  sidebar says the catalog stands now; once it has caught up, the page reads
  its answer again.

**Secrets.** Secrets never go in the catalog; the catalog records only where a
secret lives, for example a path in a secrets manager such as Obscuro or
Infisical. **Decided** (owner, O-2, [#25]). The catalog shows such a fact as a
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
  `planned` facts show no age, following [Catalog](catalog.md) section 4.6.
- **Discrepancies:** when an intended fact and an observed fact disagree, both
  are shown together with their sources and check times. Neither is presented
  as the right one. **Proposed**, following the glossary.
- The same freshness display is used wherever a fact appears outside its page,
  for example in search results or a task's related entities. **Proposed.**
  Reason: a fact quoted without its age loses the trust signal.
- **Decided (owner, 2026-11-19, M2-Q17; M2-7):** the exact check (when, by whom, scope, source and
  what was not checked) is one step away, behind "How it was checked" on
  each fact. The one-line freshness summary is the same on the page and in
  the type index: facts, the oldest check, how many are due, never checked
  and unknown.
- **As built in GC-7 ([#169](https://github.com/guneet-xyz/shinan/issues/169)):**
  the check is one tap away on the fact's age instead, "seen" gets no
  label, a disagreement is one sentence at the top of the page, and the
  freshness summary line is gone with the type index ([a page](#a-page)).

### Moving around the catalog

**As built in GC-7 ([#169](https://github.com/guneet-xyz/shinan/issues/169)),
from the [product brief](https://github.com/guneet-xyz/shinan/issues/169#issuecomment-7029844112):**

- **Where things are.** The catalog is under `/w/<workspace>/catalog`. A
  page is at `…/catalog/p/<ID>`, for example `…/catalog/p/machine/musashi`.
  The sidebar's folders, search and Needs attention lead there
  ([map of the app](#map-of-the-app)). Until the Now screen exists (M3),
  opening a workspace opens Start here.
- **The wiki's addresses lead to the same place for one release** (D-064):
  - `/wiki/e/<ID>` goes to `/catalog/p/<ID>`;
  - `/wiki/start-here` goes to Start here;
  - the old workspace lists go to Needs attention;
  - any other `/wiki/…` keeps its path under `/catalog/`.
- **Search** sits at the top of the sidebar. A result shows the page's
  title, its folder in muted text, and one line (the best matching
  section's words, else the summary). Retired pages are left out; if any
  matched, one button shows them ("Show 2 retired pages"). There are no
  type filters. With nothing searched yet, the page is titled "Search the
  catalog". In search results and Needs attention, page titles are links
  with a quiet underline that shows without hovering (a phone cannot
  hover), and a long title wraps rather than running off the screen.
- **Needs attention** is one page with up to four short parts, only those
  that have something in them:
  - "These disagree": differences not accepted;
  - "Not checked in a while": due for a recheck;
  - "Unknown";
  - "Files that can't be read": by file name, with hidden characters
    shown as markers such as `⟨U+000A⟩`.

  Each item is the page's title, then the fact's label and one line, such
  as "Disk data size: 128 GiB and 64 GB". With nothing in any part:
  "Nothing needs attention." M2's "Not yet recorded" list is left out (the
  schema's machinery).

- **States:**
  - While a new workspace's repository is made: "Your catalog is being set
    up. This takes a few seconds." The sidebar asks where the catalog
    stands after 3 seconds, then after twice as long each time up to once a
    minute, and not while the browser tab is hidden. Once that changes it
    reads the folders again, and the page updates by itself. Until then the
    sidebar shows no folder area.
  - While the index catches up: "Catching up with the latest changes…".
  - With no pages at all: "Your catalog is empty. Agents write it. Set up an
    agent, then ask it to add your first machine.", with a "Set up an
    agent" button.
- **Start here** is `start-here.md` rendered as a page, its people's steps
  first as a numbered list, then its body. Without it, the catalog's
  `README.md` is shown, its first heading as the title, with a line saying
  so. Without either (or while the repository can't be read): "There's no
  Start here page yet. Open a page from the folders, or ask an agent to
  write start-here.md." An empty catalog shows its empty state whatever its
  README says. The agents' path isn't shown: agents read the file.
- **Type indexes and type pages** are gone (D-064: not by types): a type's
  schema is a page in the `schema` folder.
- **Large folders** in the sidebar show 100 pages, then "Show 500 more
  (19,889 left)", and "Show the last 37" when fewer are left.

### Changing the catalog from the browser

**Removed** (owner, GD-7, [D-064](decisions/D-064-catalog-not-wiki.md); GC-5):
there is no editing in the browser for now. Agents change the catalog by
pushing to its Git repository; people ask their agents
([Git-based catalog plan §3](build-plan-git-catalog.md#3-the-catalog-ui)).
M2's "Suggest a change", "Record a check", "New entity", "New type",
editing Start here, "Check the change" and the repair page are gone: GC-5a
removed their routes and GC-5b their screens.

### Reviewing catalog changes

**Removed** (owner, GD-2, [D-060](decisions/D-060-no-catalog-approval.md);
GC-5): there is no catalog approval, so no review list, comments, bulk
approval or revert by proposal (screens removed in GC-5b). `main`'s commit history in the catalog
UI shows what changed (GC-7); undo is `git revert`.

## Start here and onboarding

> **Changing with the [Git-based catalog](build-plan-git-catalog.md)** ([GC-7](build-plan-git-catalog.md#gc-7-the-catalog-ui)): `start-here.md` is rendered as a page; "preview as agent" is removed. Until then, this section describes M2 as built (v0.3.0).

"Start here" is one special catalog document with two ordered paths, one for
people and one for agents, built from the same catalog pages and changed only
with catalog approval. **Decided** (owner, O-18, [#25]). Its content rules are
owned by the [Catalog](catalog.md) document; this section is how it is shown.

### Start here for people

- **Orientation:** what this workspace is for, the main projects, the machines
  and how access to them is arranged (prerequisites, never credentials), the
  key policies (for example deployment approval), how tasks and nudges work
  here, who's who, and how to connect your own agent.
- Shown as numbered steps, each opening its entity page. **Proposed.**
- **Removed (GC-5):** the "opened" and "changed since you opened it"
  markers (M2-7). GC-5a removed the `opened` routes and the
  `catalog.mark-opened` permission
  ([Git-based catalog plan §2.14](build-plan-git-catalog.md#214-permissions-scopes-and-the-security-log));
  GC-5b removed the markers from the page.
- Changing the path: **Suggest a change** on the start-here document was
  removed with catalog approval (GD-7,
  [D-060](decisions/D-060-no-catalog-approval.md); GC-5b); agents change it
  in Git like any catalog document.
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
- **Removed (GC-5):** **Preview as agent** and the size of the agents' path
  with its warning (M2-7). They showed the path as MCP's
  `workspace_context` gave it, which no longer carries catalog content
  ([Git-based catalog plan §2.13](build-plan-git-catalog.md#213-mcp-after-this-change));
  GC-5a removed the preview route and GC-5b the button. The page still
  lists the agents' path.

### First run for a new workspace

Shinan starts empty (D-018). A new workspace's Now screen shows a setup
checklist until it is done or dismissed:

1. Connect a git host and choose, per repository, whether new issues become
   tasks. Existing issues are not imported unless the person asks (owner,
   O-23, [#25]); the connection screen offers **Import existing issues into
   triage**.
2. Connect your first agent (see [your agents](#your-agents)).
3. Start the catalog: create the first entities, or ask an agent to propose
   them.
4. Write the start-here document.
5. Create a first task, or let outside issues arrive in triage.
6. Invite members (optional; built before a second member joins, O-49).

**Proposed.** Reason: an empty workspace gives no hint of what to do first, and
the order follows the dependencies.

## Triage

Outside issues become tasks in `triage` from the first day (D-003), in every
repository whose "turn new issues into tasks" setting is on. The setting is on
by default and turned off for shared repositories, where most issues are
unrelated; issues there are still read for markers and mentions. **Decided**
(D-003; owner, NO-2, [#26]). Git host integrations holds the setting and Tasks
and work defines it; this document shows it on the
[git host connection](#workspace-settings) screen.

- **Phase 1:** the task list filtered to `triage`, reachable from
  [Needs you](#1-needs-you). Each task page offers **Accept** and **Cancel**.
  **Proposed**, matching the [Roadmap](roadmap.md). Reason: outside issues arrive
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

Notifications are phase 2 (plan, sections 5 and 10). **Decided.** This
document owns what is sent and each person's notification settings;
[Architecture](architecture.md) owns sending (channels, delivery, retries and
failures), email first, through the AWS SES API. **Decided** (owner, NO-3,
[#26]; N-6, [#25]). Email is already sent from the first version for email
magic links (owner, N-7, [#25]).

- **What is sent:** the [Needs you](#1-needs-you) items, and replies by people
  or agents to the person's own comments. Nothing else by default.
  **Proposed.** Reason: notifications should bring a person back only for what
  needs them.
- **Per-person settings** in [your account](#your-account): which kinds of
  item, per workspace; immediately or as a daily summary; and quiet hours.
  Deployment approval requests are sent immediately unless the person turns
  them off. **Proposed.** Reason: deployment approval blocks finished work.
- **Content:** a short title, the workspace and task ID, and a link to the
  task's address, which requires sign-in. No fact values, approval details or
  comment text. **Proposed.** Reason: notifications leave the signed-in app,
  and the workspace holds infrastructure details (D-015).
- **Security emails are not notifications.** The emails [Identity](identity.md)
  requires (sign-in from a new browser, sign-in method changes, new agent
  tokens) are always sent, from the first version, and are not in the
  notification settings; the settings screen lists them as always on.
  **Proposed.** Reason: a person must not be able to silence the only warning
  that someone else is using their account.

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
- **Create a workspace** asks for a name and a task ID prefix, unique within
  the installation. **Decided** that each workspace has its own prefix (owner,
  O-6, [#25]); the prefix rules are [Tasks and work](tasks.md)'s (section 3). It makes the person its workspace owner, then
  opens the [setup checklist](#first-run-for-a-new-workspace). Whether any
  signed-in person may create a workspace is owned by [Identity](identity.md).
  **Proposed (M1-4):** until tasks exist, it asks only for a name, offered
  on the start page to someone with no workspace and under Your account,
  Workspaces; the prefix and the setup checklist come with tasks (M2, M3).

### Workspace settings

> **Changing with the [Git-based catalog](build-plan-git-catalog.md)** ([GC-7](build-plan-git-catalog.md#gc-7-the-catalog-ui)): the "Catalog" screen holds the clone URL, "not a secret" values and purge (GC-5 removed the strict setting). Until then, this section describes M2 as built (v0.3.0).
>
> **As built in GC-7 ([#169](https://github.com/guneet-xyz/shinan/issues/169)):** a **Catalog** tab, for every member, between Agents and Security log. It holds "Address for agents": the address agents clone the catalog from (`https://<installation>/git/<workspace ID>.git`), shown whole (it wraps on a phone), with a Copy button, and "Agents clone the catalog from here. Set up an agent →". The "not a secret" values (GC-3) and removing text from the catalog's history (GC-8) join it with their packages; until GC-8, M2's purge stays under Data.

For workspace owners. Contributors see three of these screens read only:
General, Members and Security log (only the entries they made or that are
about them, as [Identity](identity.md) section 11 allows), with no actions.
The other screens are not shown to them. **Proposed.** Reason: every member
already sees everything in the workspace (owner, O-43, [#25]), so who the
members and owners are is no secret, and a contributor needs somewhere to
leave the workspace and to read their own security log. Actions their role
does not allow are still not offered.

| Screen               | Shows                                                                                                                                                                 | Actions                                                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| General              | Name, task ID prefix and any earlier prefixes, creation date, workspace owners, the setting "contributors may give deployment approval" (off by default)              | Rename; change the task ID prefix; turn the deployment approval setting on or off; delete workspace (typed confirmation, consequences listed first) |
| Members              | Each member: name, role (workspace owner or contributor), joined, invited by, linked git host accounts, their agents, last active                                     | Change role; remove member. The last workspace owner cannot be removed or made a contributor                                                        |
| Invitations          | Pending, expired and declined invitations with role and who invited                                                                                                   | Invite; resend; withdraw                                                                                                                            |
| Agents               | Every agent: name (person, coding tool and machine), member it acts for, state, last agent session seen, its token (created, last used, full or read-only)            | Disable an agent; revoke its token                                                                                                                  |
| Git host connections | Each connection: git host, account used, repositories covered, each repository's "turn new issues into tasks" setting, who set it up, health, last successful contact | Add; reconnect; change repositories covered; turn new issues into tasks on or off per repository; import existing issues into triage; remove        |
| Task flags           | Built-in and workspace-defined flags, each with its description, whether it shows in Needs you, and how many tasks have it                                            | Add; edit; remove                                                                                                                                   |
| Security log         | Security-relevant events, kept forever and never purged                                                                                                               | Read only                                                                                                                                           |
| Data                 | The time of the last export; what can be purged, including operational records about this workspace                                                                   | Export the workspace; import an export into an empty workspace; purge (typed confirmation). Security-log entries are never offered for purge        |

**Proposed** screen set, based on these answers: task flags managed per
workspace (owner, O-8, [#25]); the strict setting (O-3); the security log is
kept forever (O-47) and no security-log entry can ever be purged (N-13,
D-049); only workspace owners can purge, and installation operators cannot
(O-50); a full workspace export and import are in the first version (O-75);
the "turn new issues into tasks" setting (owner, NO-2, [#26]); the
deployment approval setting ([Tasks and work](tasks.md) section 8.4). Custom entity
types are not a setting: they are type schema documents in the catalog, changed
like any catalog document ([moving around the catalog](#moving-around-the-catalog)).
Reason: one screen per thing the workspace owns.

**As built (M2-10, [#91](https://github.com/guneet-xyz/shinan/issues/91)), decided (owner, 2026-11-19, M2-Q17):**
the Data tab has **Purge catalog text** for workspace owners
([catalog §9](catalog.md#9-history-and-purge)). It first warns that a purge
cleans Shinan, not copies that left it (exports, the host's backups, agents'
model providers), that a secret must be rotated where it was issued, and
that security-log entries are never purged. The owner types the text and
chooses **Find it**; spaces and line breaks need not match. Shinan shows
where it is (revision texts and documents, the current pages it will store
again, proposals and the waiting ones it will reject, comments, timeline
events, and where it was found across a line break, to check),
copies in other forms (URL- or percent-encoded, HTML entities, escapes),
each with **Find this form**, and pages whose structure the purge changes
(the text in an ID or alias, or across frontmatter lines). Purging takes a
reason, which must not repeat the text, and typing "purge". Afterwards the
screen lists pages that now read with problems and asks the
owner to press **Find it** again in a minute, since a change in progress
can bring the text back. The text stays only in the page's memory and is
cleared once purged. Below, every member sees the list of purges: who,
when, why and how much, never the text. A purge revision shows "purge N" in
an entity page's history. Exports come with a later milestone.

Screen details:

- **Catalog settings:** removed with the strict setting (GC-5,
  [D-060](decisions/D-060-no-catalog-approval.md)). The tab returns for
  the owner's "not a secret" values (GC-7).
- **Task ID prefix.** Changing it keeps every earlier prefix working as an
  alias forever, and it is never given to another workspace; the screen says
  so before saving. Old task IDs keep their old prefix. **Proposed**, following
  [Tasks and work](tasks.md) section 3, which owns the rule.
- **Export and import.** A workspace owner starts an export; it is built in
  the background and offered as one download behind sign-in. Import recreates
  a workspace from an export into an empty workspace. Both ask the person to
  sign in again and are recorded in the security log. The screen shows when
  the last export was made. **Proposed** screens; the machinery is
  [Architecture](architecture.md)'s (section 5.5) and who may do it is
  [Identity](identity.md)'s. Reason: with no backups (O-62) and no Git mirror
  (N-5), the export is the only copy a person can take off the machine.
- **Task flags.** Each flag has a name, a description, and a "show in Needs
  you" choice (off by default for workspace-defined flags). Removing a
  built-in flag warns what it affects: its panel, its Needs you row, and
  agents' conventions that use it. For `awaiting deployment approval`, it says
  that approval requests and answers are still recorded on tasks and can still
  be answered from the task timeline (owner, NO-4, [#26]).
  Calculated flags such as `blocked` are listed but cannot be edited. Tasks
  keep a record of a removed flag in their history. **Proposed.** Reason:
  [small and legible](#design-principles) means saying what a change affects.
  The rules for flags are owned by [Tasks and work](tasks.md).
- **Git host connections.** A Forgejo connection is read-only: Shinan makes
  no writes there, so there are no backlinks on Forgejo. It uses the
  connecting person's own Forgejo account and accepts any token. Any Forgejo
  address can be entered, except addresses that resolve to private, loopback
  or link-local networks, which are refused unless an installation operator
  has allowed that host. **Decided** (owner, O-53, O-54, N-4, N-7, N-12,
  [#25]). Only workspace owners add connections ([Identity](identity.md)), so
  a Forgejo connection reads with a workspace owner's account. Before saving,
  the screen states the risk plainly: Shinan only reads, but the stored token can do whatever its owner can, and a broad
  token (for example a site administrator's) could act as any user on that
  Forgejo if it were stolen; the token is stored encrypted. A repository
  already connected to another workspace cannot be added (owner, O-59, [#25]).
  Each repository shows its "turn new issues into tasks" setting, on by
  default (owner, NO-2, [#26]). **Proposed** wording.
- **Agents.** **Decided (owner, 2026-11-19, M2-Q17; M2-5):** the same rows as Your agents, with the
  member each agent acts for. On another member's agent a workspace owner is
  offered only Revoke token and Disable; their own agents have every action.
  "Last agent session seen" joins with agent sessions (M4). Like the other
  owner-only screens, the tab is not shown to contributors; their own agents
  are in Your agents. The Members screen lists each member's agents by name,
  with "(disabled)" where it applies.
- **Removing a member** lists the consequences first: their agents and tokens
  that will be disabled, tasks they are assigned to, agent sessions of theirs
  attached to tasks, and git host connections they set up. **Proposed.**
  Reason: an agent acts for a member, so removing a member must not leave
  agents running in their name. The rules are owned by [Identity](identity.md).
- **Invitations.** Joining a workspace needs an invitation; whether a person
  can have an account at all is decided by the installation's email allowlist.
  **Decided** (owner, O-48, [#25]). The invitation screen asks for an email
  address and a role. An address that is not on the email allowlist cannot be
  invited: the screen refuses it and asks the inviter to have an installation
  operator add it first. **Proposed** screen, following [Identity](identity.md)
  section 5.2, which owns the rule; the email allowlist is an installation
  setting.
- Sensitive actions may ask the person to sign in again. Which ones, including
  whether giving deployment approval does, is owned by [Identity](identity.md).

### Joining a workspace

1. The invited person follows the emailed invitation and signs in, or creates
   an account if their email is on the email allowlist. Sign-in is by email
   magic link or GitHub only. **Decided** (owner, O-48, N-7, [#25]).
2. They see the workspace name, who invited them and the role, and accept or
   decline.
3. On accepting, they are asked to link their git host accounts, if not
   already linked, with a short reason: "so Shinan can show what you and your
   agents did on GitHub and Forgejo". Forgejo accounts on any address can be
   linked, but are never used to sign in (N-7). Each link is verified before
   it counts (glossary, Git host account); how is owned by
   [Identity](identity.md).
4. They are offered to [connect an agent](#your-agents) now or later.
5. They land on [start here for people](#start-here-for-people).

**Decided** that invitations exist (D-019). The flow is **proposed**. Reason:
linking git host accounts is how git host activity is credited at all. Shinan
does not store git host tokens for people (owner, O-1, [#25]); linking is for
credit, and a linked GitHub account can also be used to sign in (N-7).

### Your account

Each person has an account area, separate from any workspace: profile,
sign-in (an email address for email magic links, and an optional linked
GitHub account; owned by [Identity](identity.md)), linked git host accounts,
the workspaces they belong to with their role, pending invitations,
[notification settings](#notifications) (phase 2), and
[your machines](#your-machines-phase-3) (phase 3). **Proposed.**

It also lists the person's sign-in sessions (browser, when signed in, last
active, network address), each of which they can end, and "sign out
everywhere" ([Identity](identity.md) section 3.3). Installation operators
also find a link to the installation settings, where they keep the email
allowlist ([Identity](identity.md) section 3.2). **Proposed** (M1-4).
Reason: identity requires both, and they belong to the person, not to a
workspace.

**Proposed ([#66](https://github.com/guneet-xyz/shinan/issues/66)):** under
Sign-in methods, **Change email address** opens a field for the new address,
explaining that it must be on the allowlist, that a link is sent there, and
what confirming does; sending it asks for a recent sign-in if needed. While
the link waits, the section says where it went and until when, with
**Cancel the change**. The link opens a page that, before sign-in, shows
only the installation's name and asks the person to sign in; signed in as
the person who asked, it shows the old and new address and **Confirm new
address**; anyone else is told the link does not work for their account.
The rules are [Identity](identity.md) §3.4's.

### Your agents

> **Changing with the [Git-based catalog](build-plan-git-catalog.md)** ([GC-7](build-plan-git-catalog.md#gc-7-the-catalog-ui), [GC-9](build-plan-git-catalog.md#gc-9-the-skill-and-agent-setup)): "Set up OpenCode" becomes "Set up an agent". Until then, this section describes M2 as built (v0.3.0).

An agent is per person, coding tool and machine, for example "Guneet's
OpenCode on Daedalus". **Decided** (owner, O-40, [#25]). Agents belong to one
workspace.

**Connecting an agent** starts on the machine, not in the web app:

1. The person installs the plugin, or the CLI for tools without a plugin.
   Installing the plugin also sets up the MCP server and skill (owner, O-36,
   [#25]). The instructions per coding tool are owned by
   [Agent integrations](agent-integrations.md) and linked from **Your agents**.
2. The plugin or CLI starts a browser approval: it opens Shinan's approval page,
   or, on a machine without a browser, shows a short code that the person
   enters on that page from another device.
3. On the approval page the person signs in, picks the workspace, and
   confirms the agent: the coding tool and machine are filled in from the
   request and the name is suggested from them. An existing agent for the same
   coding tool and machine is reused. The person chooses a **full** token or a
   **read-only token** (only the `read` scopes), then approves. A read-only
   token is a choice of scopes, not a role.
4. The token goes straight to the plugin or CLI. It is one token per agent,
   accepted at every agent endpoint (MCP, REST API and the plugin stream), and
   it lasts until revoked.
5. **Waiting for first contact:** the approval page waits until the agent's
   first agent session reaches Shinan and then confirms what is working. Phase
   1: "Presence: plugin-reported" or "Presence: self-reported only (no
   plugin)". Phase 2 adds how nudges will arrive: "live" or "when it calls
   Shinan".

**Fallback:** for runs that cannot open the approval (for example a headless
run that reads its token from an environment variable), **Your agents** offers
**Create a token by hand**: the person picks the coding tool and machine,
chooses full or read-only, signs in again, and sees the token once.

**Decided:** browser approval started from the plugin or CLI, with a short code
for machines without a browser and a hand-made token as the fallback; one token
per agent at every agent endpoint; no MCP-specific sign-in in the first version
(owner, NO-1, [#26]); tokens last until revoked (owner, O-44, [#25]). The
screens are **proposed**; the approval rules are owned by
[Identity](identity.md). Reason for confirming first contact: the person learns
at once how well Shinan will be able to see and reach this agent.

**Your agents** lists the member's agents with their token's kind, creation
and last use, and lets them rename or disable an agent and revoke its token.
Because tokens never expire, the last use is shown prominently so unused ones
are easy to spot and revoke. **Proposed.** Reason: long-lived tokens (O-44)
make revoking unused ones the main protection.

**Decided (owner, 2026-11-19, M2-Q17; M2-5, [#83](https://github.com/guneet-xyz/shinan/issues/83)),
as built until browser approval arrives (M4):**

- **Your agents** is its own page (`/account/agents`), linked from Your
  account. It lists the person's agents in every workspace they belong to.
  Each row shows the agent's name and handle, its state (a full or read-only
  token, no token, or disabled), "Last used … from <network address>" or
  "Never used" on its own line, "Unused for 30 days" as a warning mark, the
  workspace, coding tool, machine, when the token was made and how many
  requests it has made.
- Row actions: **Replace token…** (a new token with the same access, shown
  once; the old one stops working), **Rename**, **Revoke token…** and
  **Disable…**. Replace, Revoke and Disable each ask first, saying the
  current token stops on its next request; Revoke and Disable also say that
  the agent's git host access on that machine is not affected
  ([Identity](identity.md) section 7.5). **Enable** for a disabled agent.
- **Create a token by hand** asks for the workspace (when there is more than
  one), the coding tool (OpenCode, Claude Code, Codex, Gemini CLI, or another
  by name), the machine, an optional name ("OpenCode on Daedalus" is
  suggested) and the access (full or read-only), then asks the person to sign
  in again. The token is shown once, with a Copy button, a reminder that it
  will not be shown again, and a link to set the agent up, which Git then
  reads it for (GC-9).
- **Decided (owner, 2026-11-19, M2-Q17; M2-9, [#90](https://github.com/guneet-xyz/shinan/issues/90)):**
  **Set up an agent** (`/account/agents/setup`, "Set up OpenCode" until
  GC-9), linked from the top of Your agents and from the token shown once
  (in a new tab, so the token stays on screen, filled in for that agent):
  five numbered steps (make a token, store it on the machine, clone the
  catalog with Git's credential helper, configure OpenCode, check it) with this installation's
  addresses, the agent's workspace and its written form filled in, an agent
  picker when the person has several, and Copy buttons, then how to keep
  the token safe. Its content is owned by
  [agent integrations](agent-integrations.md#setting-up-an-agent-with-a-hand-made-token).
  Reason: like the device setup guide, it is product help, the same for
  every workspace.
- "Sign out everywhere" on Your account has an unticked option to also
  revoke all the person's agent tokens.

### Your machines (phase 3)

A person registers a machine for launching agents by installing the launcher
on it; a device setup guide (for example for a VM or a MacBook) explains how.
**Decided** (owner, O-1, [#25]). This screen lists the person's registered
machines with their coding tools and last contact, links to the setup guide,
and offers **Remove**. The guide is part of Shinan's own built-in help, the
same for every workspace, and is also linked from the launcher's install step.
**Proposed.** Reason: it is product help, not team knowledge, so it does not
belong in a workspace's catalog. Only the person's own machines are offered
when they [start an agent session](#when-no-agent-session-is-attached).
**Proposed** screen. The guide's content is owned by
[Agent integrations](agent-integrations.md).

## Phasing

How this document's screens map to the plan's phases (plan, section 10). The
[Roadmap](roadmap.md) decides the exact first release; it splits phase 2 into
2a (collaboration) and 2b (migration).

| Phase                        | Screens                                                                                                                                                                                                                                                                                                                                                                                                   | Status                                                                                                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1                            | Now screen; task list with ranking and the `triage` filter; task page with comments, panels, subtasks and steering actions (changes are events agents see when they next read the task); timelines; agents view; catalog pages with start here; catalog review and recent changes; unlinked work; workspace settings for one owner, including export and import; security emails; your account and agents | Decided that the catalog pages (the plan's "wiki"), tasks, timeline and presence are phase 1 (plan, section 10), and export and import (owner, O-75, [#25]); the rest proposed |
| Before a second member joins | Invitations, the contributor role in screens, member removal                                                                                                                                                                                                                                                                                                                                              | Decided (owner, O-49, [#25]: D-019 read as "design now, build before the second member")                                                                                       |
| 2                            | Board; nudges (recipients, delivery states, waiting comments, "nudge not received", asking your agent to act on a git host); task notices; triage inbox; notifications                                                                                                                                                                                                                                    | Decided (plan, section 10). Board and triage inbox are required before migration (owner, O-78, [#25])                                                                          |
| 3                            | Your machines; starting agent sessions from the task page through a launcher                                                                                                                                                                                                                                                                                                                              | Decided (plan, section 10; D-014; owner, O-1, [#25])                                                                                                                           |

## How today's practice maps to these screens

For reference. Coordination for trial projects moves into Shinan during the
trial (owner, O-73, [#25]); otherwise the `workspace` repository stays the
source of truth until migration (D-018).

| Today, in the `workspace` repository                                            | In Shinan                                                                                                                       |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `human-effort` label and TL;DR comment                                          | `needs a person` task flag and its [panel](#needs-a-person-panel); listed in [Needs you](#1-needs-you)                          |
| Asking for deployment approval in the conversation or issue                     | The [deployment approval panel](#deployment-approval-panel), first in Needs you; approval in the conversation is still recorded |
| Forgejo Project board for workflow                                              | [Board](#board-phase-2) with columns by task status                                                                             |
| `last_verified`, `verification_scope`, `verification_source` per catalog entry  | Last checked, check scope and source per fact, shown as [freshness](#how-freshness-is-shown)                                    |
| `docs/agent-entrypoint.md`                                                      | [Start here for agents](#start-here-for-agents)                                                                                 |
| Announcing an agent's identity in an issue comment when agents share an account | Presence and "acting for" on every agent event                                                                                  |

## Dependencies on other documents

What this document relies on other documents for.

| Document                                        | What this document needs from it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Domain model and glossary](domain-model.md)    | All terms, including task notices.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| [Tasks and work](tasks.md)                      | Status rules behind each explanation; required fields for `needs a person` and deployment approval requests, what makes an approval stale, and the "contributors may give deployment approval" setting; when nudges and task notices are created and where they go; batching of waiting nudges; releasing an agent session by hand; triage actions and the "turn new issues into tasks" setting; unlinked work; unconfirmed links; rules for workspace-defined flags, including "show in Needs you"; task ID prefixes and their aliases; which git host actions a person can ask for. |
| [Agent integrations](agent-integrations.md)     | Presence thresholds (`unresponsive`, the 30-minute display threshold, the 24-hour release, the 30-day end); waiting reasons; delivery holders and outcomes for nudges and task notices; the "reply to nudge" tool; delivering git host action requests; the ready-made start prompt; connect instructions per coding tool; the device setup guide's content and the launcher (phase 3); whether an agent session can be stopped from Shinan.                                                                                                                                          |
| [Identity, agents and permissions](identity.md) | What each role may do, including who may give deployment approval and which actions need re-authentication; the token approval flow and read-only tokens; removal effects; who may create workspaces; the email allowlist and invitations; nudges from other members and the per-agent opt-out; who may export, import and purge.                                                                                                                                                                                                                                                     |
| [Catalog](catalog.md)                           | Gated classes and the strict setting; validation results shown in the editor; rechecks as catalog proposals; recheck intervals; type schema documents; the start-here document; workspace-wide lists; revert; comparing revisions.                                                                                                                                                                                                                                                                                                                                                    |
| [Git host integrations](git-hosts.md)           | Connection health and reconciliation thresholds; how unconfirmed links and mentions are detected; where the list of automated accounts lives; the "turn new issues into tasks" setting; the origin-issue reminder.                                                                                                                                                                                                                                                                                                                                                                    |
| [Architecture and operations](architecture.md)  | How screens update while open; the task address (section 3.6); sending notifications and security emails; export and import (section 5.5); purge of operational records.                                                                                                                                                                                                                                                                                                                                                                                                              |
| [Roadmap and migration](roadmap.md)             | Which phase 1 screens are in the first release.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Open questions

1. **Stopping an agent session.** Should the task page offer "stop" as well as
   "release", and can a plugin do it? ([Agent integrations](agent-integrations.md))

## Decisions needed from the owner

None. Every earlier decision was answered in [#25] (O-1 to O-98, N-1 to N-13)
and [#26] (NO-1 to NO-4) and is marked Decided above. The screens these answers
need are proposals that follow directly from them.

[#25]: https://github.com/guneet-xyz/shinan/issues/25
[#26]: https://github.com/guneet-xyz/shinan/issues/26
