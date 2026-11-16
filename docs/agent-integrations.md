# Agent integrations

Status: **draft for review** ([issue #9](https://github.com/guneet-xyz/shinan/issues/9)).

This document covers how coding agents connect to Shinan. It owns:

- the MCP tools, the skill and the CLI (connection level 1);
- agent sessions and presence;
- the plugin for each coding tool, OpenCode first, then Claude Code (level 2);
- how nudges are delivered;
- how agents are taught the conventions they follow;
- an outline of the launcher (level 3, phase 3).

It describes behavior at a functional level. It does not define wire formats,
storage or technology; those belong to the [architecture document](architecture.md).
Where another document owns a rule, this one states only what it needs and
links to it: [tasks and work](tasks.md) owns claims, markers and when nudges are
created; [identity](identity.md) owns credentials, machines, attribution and
who may nudge whom. Terms follow the [domain model and glossary](domain-model.md).

## How to read this document

Every statement is marked:

- **Decided**: follows from an accepted decision or approved content in the
  [plan](plan.md), which is cited.
- **Proposed**: suggested here, with a reason. Proposals that change or
  reinterpret approved plan content are also listed under
  [decisions needed from the owner](#decisions-needed-from-the-owner).
- **Open**: not settled. Listed under [open questions](#open-questions).

External product facts were checked against the vendors' own documentation on
**2026-11-16**. Sources are listed in [verified external facts](#verified-external-facts).
Coding tools change quickly. Any plugin work must check these facts again first.

## Summary

| Connection level | Who has it | What it gives | Phase |
|---|---|---|---|
| 1. MCP server, skill and CLI | Any agent that can call MCP tools or run a command | Actions: read the catalog, propose catalog changes, find, create, claim and update tasks, link work, report progress, ask for a person, receive nudges. Presence is `self-reported`. | 1 |
| 2. Plugin for the coding tool | OpenCode first, then Claude Code | Everything in level 1, plus `plugin-reported` presence and live nudge delivery into the running agent session. | OpenCode presence in 1, live nudges in 2. Claude Code after OpenCode. |
| 3. Launcher | A machine that runs one | Starts a new agent session for a task when a person asks from the website. | 3 (optional) |

**Decided** (D-014): the three levels, and OpenCode before Claude Code. Reason
(from D-014): MCP alone depends on the agent choosing to report, and it cannot
reach an idle or crashed agent session. A plugin reports from inside the tool.
**Decided** (plan, section 10): phase 1 has the MCP server, the skill and the
OpenCode plugin for presence; nudges arrive in phase 2.

The main proposals are:

1. Shinan finds the agent session behind a call from an ID **the coding tool
   reports**, not one the model copies. A Shinan-issued agent session ID that
   the model passes is only the fallback for MCP-only agents.
2. A coding tool that stops is `offline`, not `ended`. When the same
   conversation comes back, it continues the same agent session and keeps its
   task.
3. Each nudge delivery has exactly one owner at a time (the plugin or check-in),
   and counts as `delivered` only when the coding tool or the agent confirms it.
4. Plugins send only allow-listed metadata, which Shinan enforces. They never
   send conversation text, file contents or tool output.
5. Nudges from the agent's own member steer by default; nudges from other
   members wait until the agent has finished its current work.
6. One plugin install also sets up the MCP server and the skill.
7. Shinan never blocks or slows a coding tool.

## Coding tool capabilities

What each coding tool allowed on 2026-11-16, from its own documentation. The
rest of the document depends on this table.

| Capability | OpenCode V2 | Claude Code | Codex | Other MCP-capable tools |
|---|---|---|---|---|
| Call MCP tools (level 1) | Yes, local and remote | Yes, local and remote | Yes | Yes |
| Tool tells the MCP server which conversation called | Yes: `_meta["ai.opencode/sessionID"]` on every tool call, hidden from the model | Not documented; a `PreToolUse` hook can add it to the tool's arguments (`updatedInput`) | Not checked | Not known |
| Load a skill | Yes, including skills served from an HTTP catalog | Yes, also bundled in plugins | Yes | Varies; the text can go in the tool's instructions file |
| Start and end signals | Plugin event stream (`session.created`, `session.deleted`, `session.archived`, `location.shutdown`) and plugin unload | `SessionStart` (with `source`) and `SessionEnd` (with `reason`) hooks; mod `session.start` and `session.end` | `SessionStart` and `SessionEnd` hooks | None |
| Busy and idle signals | `session.status` (`busy`, `idle`, `retry`), `session.idle` | `UserPromptSubmit` and `Stop` hooks; mod `turn.start` and `turn.complete` | `UserPromptSubmit` and `Stop` hooks | None |
| Waiting-for-a-person signal | `permission.asked` and `form.created`, cleared by `permission.replied`, `form.replied`, `form.cancelled` | `PermissionRequest` hook; `Notification` types `permission_prompt` and `elicitation_dialog` | `PermissionRequest` hook | None |
| Regular reports while idle | Plugin code keeps running in the OpenCode server | Only with mods (`$.clock.every`, Claude Code v2.1.287 or later); hooks run only on events | No | None |
| Send a message into a running agent session | `ctx.session.prompt` with delivery `steer` or `queue`; wakes an idle session; queued items can be listed, cancelled or changed | Several partial routes (see [Claude Code plugin](#claude-code-plugin)) | Background hook output reaches the next model request in an active turn; it does not start a new turn | None. Core MCP gives a server no way to add a message to the conversation. |
| Attach lasting context without a message | Session instruction entries (**experimental**); a `context` hook can add a system part | `additionalContext` from hooks, for example at `SessionStart` | `additionalContext` from hooks | MCP server instructions, where supported |

**Consequences** (proposed; reason: they follow from the table):

- OpenCode is the only tool where a plugin can do everything Shinan needs with
  documented features. One of them, instruction entries, is experimental and
  has a fallback ([OpenCode plugin](#opencode-plugin)). This confirms D-014's
  order.
- Claude Code can come close, but only by combining several mechanisms. Without
  mods it has no heartbeat.
- Codex can report presence through hooks and deliver nudges during a turn, but
  not wake an idle agent session. A Codex plugin is not planned
  ([question 5](#open-questions)).
- Every other tool stays at level 1 with `self-reported` presence.

## Agent sessions

An agent session is the part of one coding tool conversation that works as one
agent ([glossary](domain-model.md#agent-session)). Here "conversation" always
means a coding tool conversation, such as an OpenCode session or a Claude Code
session, and its **conversation ID** is the ID the coding tool gives it.
**Decided** (D-014) that agent sessions and presence exist.

### How a call is matched to an agent session

The agent's token tells Shinan which **agent** is calling (identity document,
"Agent sessions"). By default one agent has many agent sessions running at
once, so Shinan also needs to know which **agent session** is calling. The MCP
connection cannot tell it: one connection serves many conversations (OpenCode
connects once per directory, or shares one connection across directories with
`pool`), and MCP revision 2026-07-28 has no protocol-level sessions at all.

**Proposed** order, first match wins:

1. **Conversation ID reported by the coding tool.** OpenCode sends it on every
   MCP tool call in `_meta["ai.opencode/sessionID"]`. The Claude Code plugin adds
   it to calls to Shinan's tools with a `PreToolUse` hook (`updatedInput`).
   The plugin reports it on its own calls. Shinan looks up the agent session by
   agent, machine and conversation ID.
2. **Agent session ID passed by the model.** Shinan issues an agent session ID
   when an MCP-only agent starts an agent session. The agent passes it on later
   calls. The plugin also puts it in the environment of shell commands (see
   [the CLI](#the-cli)), where it counts as reported by the tool.
3. **Neither.** The call is credited to the agent, with no agent session. The
   glossary allows this.

If a tool-reported ID and a model-passed ID disagree, Shinan refuses writes and
tells the agent its correct agent session ID. Reads still work.

Reasons: the model can leave an ID out, reuse a stale one, or copy one from a
pull request description. A guard that "the ID must belong to this agent" does
not catch copying between agent sessions of the same agent. IDs the tool sets
outside the model's view are much harder to get wrong. Conversation IDs are
correlation values, never credentials; OpenCode's documentation says the same.
How much each source counts for [attribution](domain-model.md#attribution) is
owned by the [identity document](identity.md). This order is a
[decision for the owner](#decisions-needed-from-the-owner).

### What an agent session records

The attributes are listed in the [glossary](domain-model.md#agent-session). All
of the following is **proposed**.

| Attribute | How it is filled in | Reason |
|---|---|---|
| Agent | From the token used. | One source of truth for who is acting. |
| Machine | From the token's machine label, which can point to a `machine` catalog entity ([identity](identity.md), "What one agent is"). Not a separate local setting. | One place records the machine; identity issues one token per machine. |
| Coding tool and version | Reported by the plugin; for MCP-only agent sessions, by the agent at start, otherwise `unknown`. | The plugin knows its own tool. |
| Conversation ID | Reported by the coding tool (see above). | Lets Shinan recognize the same conversation after a restart or resume. |
| Repository and branch | The checkout's remote, reduced to git host and repository path with any user name or password removed, and the current branch. Updated on OpenCode `vcs.branch.updated` and `session.moved`, or Claude Code `CwdChanged`. | Lets Shinan match work to tasks. Remote URLs can contain credentials, for example `https://user:token@host/...`. |
| Current task | Set by a [claim](#claim-and-release). | |
| Presence state, presence source, last seen | See [presence](#presence). | |
| Model | Optional, information only. | Already proposed in the glossary. |

Machine-local checkout paths are never sent. Reason: the `workspace`
repository treats them as machine-local details, not catalog facts.

### Claim and release

Claim rules (who may claim, assignees, tasks on hold, coordination between
several attached agent sessions) belong to the
[tasks document](tasks.md), "Claims, assignees and agent sessions". This
document adds:

- **Proposed:** an agent session is attached to at most one task at a time,
  confirming the glossary's proposal. Moving to another task is a release and
  then a claim. Reason: nudges need one clear target.
- **Proposed:** the plugin claims automatically when the checkout's branch
  carries a task marker and the agent session is not attached yet, **but only
  if the task can be claimed** under the tasks document's rules. A task that is
  `on hold`, `done`, `cancelled` or in `triage` is not claimed automatically.
  The plugin tells the agent why instead, through its context (see
  [plugins](#common-behavior)). The claim event records that it came from the
  branch name. Reason: this does not depend on the agent remembering to claim,
  and it respects pauses and finished work. This is a
  [decision for the owner](#decisions-needed-from-the-owner).
- **Proposed:** a coordinating agent session that splits work into several
  tasks stays unattached; each child agent session claims its own task. Reason:
  this keeps "one task per agent session" while supporting how the owner works.
  These documents are themselves written by child agent sessions started by one
  coordinating agent session.

### Child agent sessions

Coding tools start child conversations: OpenCode child sessions (`parentID`),
Claude Code subagents and forks.

- **Proposed:** a child conversation is not a separate agent session unless it
  claims a task of its own. Until then, its activity counts as the parent's.
  When it claims a task, it becomes an agent session linked to its parent.
  Reason: most child conversations are short helpers, and showing each would
  flood presence. Children that do their own task need their own presence and
  nudges.

### One workspace per agent session

- **Proposed** (confirming the glossary): a conversation that works in two
  workspaces is two agent sessions, one per agent, each with its own token.
  Reason: agents and tokens are scoped to one workspace.

## Presence

Presence is what Shinan knows about an agent session right now
([glossary](domain-model.md#presence)). **Decided** (plan, Agent presence
pillar): presence exists, plugins report start, busy, idle, waiting and end, and
agent sessions connected only through MCP are marked "self-reported".

### States

The glossary's states are `starting`, `busy`, `idle`, `waiting`, `ended`, and
the calculated `unresponsive`. **Proposed:** add `offline`.

| State | Meaning |
|---|---|
| `offline` | The coding tool reported that it stopped, or that the person switched away from the conversation, but the conversation still exists and can be resumed. The agent session keeps its task. |
| `unresponsive` | Calculated: an agent session that sends heartbeats has gone silent without saying why. |
| `ended` | The conversation can no longer continue: it was deleted or archived, the agent ended the agent session on purpose, or it has been silent for 30 days. |

Reason: OpenCode conversations survive a server restart, and Claude Code
conversations can be resumed (`--resume`). If stopping the tool meant `ended`,
closing a laptop over a weekend would release the task, make nudges
`undeliverable`, and start a new agent session that does not own the task when
the person resumes. A clean stop is also different from a crash, so it should
not look like `unresponsive`. The plan lists "end" among the plugin reports, so
adding `offline` is a [decision for the owner](#decisions-needed-from-the-owner).
The glossary needs the new state ([dependencies](#dependencies-on-other-documents)).

### How states are detected

**Proposed** mapping. Reason: each row uses a signal the tool documents.

| State | OpenCode plugin | Claude Code plugin | Self-reported (MCP or CLI only) |
|---|---|---|---|
| `starting` | `session.created`, or a conversation found at plugin start-up | `SessionStart` (see [Claude Code lifecycle](#claude-code-lifecycle)) | The agent's "start agent session" call |
| `busy` | `session.status` `busy`; `retry` counts as `busy` with a note | `UserPromptSubmit`, mod `turn.start` | Not shown |
| `idle` | `session.status` `idle`, `session.idle` | `Stop`, mod `turn.complete` | Not shown |
| `waiting` | `permission.asked` or `form.created`, until replied or cancelled | `PermissionRequest`, `Notification` (`permission_prompt`, `elicitation_dialog`), until the next tool call or `Stop` | Not shown |
| `offline` | `location.shutdown`, plugin unload | `SessionEnd` (any reason) | Not shown |
| `ended` | `session.deleted`, `session.archived` | None (conversations can always be resumed) | The agent's "end agent session" call |
| (any, both sources) | | | `ended` after 30 days without any report or call |

Notes, all **proposed**:

- **Self-reported** agent sessions show only their last-seen time between
  start and end, as the glossary says. Every MCP or CLI call updates it.
- **Resuming.** When a conversation that Shinan knows reports again, it
  continues the same agent session. If the agent session was detached from its
  task while silent (see [timeouts](#heartbeats-and-timeouts)), it re-claims
  that task automatically, under the same rules as the
  [automatic claim](#claim-and-release), and receives any nudges still waiting
  for it. Reason: the person's work and messages should follow the
  conversation, not the process that was running it.
- **Waiting reasons.** `waiting` carries `permission` or `question` and a short
  label. For OpenCode `permission.asked`, the label is the permission action
  only, never its resources or paths. For Claude Code, it is the tool name
  only. Reason: people need to know why the agent is stuck, but arguments can
  contain secrets or private paths. Waiting for a person to act on the task
  itself is the task flag `needs a person`, not a presence state.

### Heartbeats and timeouts

The glossary leaves the time before an agent session counts as `unresponsive`
to this document. All **proposed**:

- **Heartbeats are declared.** When a plugin starts an agent session, it says
  whether it sends heartbeats. The OpenCode plugin does. The Claude Code plugin
  does only when mods are available (version 2.1.287 or later, and not turned
  off by an organization). Reason: a hooks-only plugin cannot report while the
  conversation is idle and would otherwise look `unresponsive` after every pause.
- **Heartbeat interval:** 60 seconds while the coding tool runs, including when
  `idle`.
- **`unresponsive`:** an agent session that declared heartbeats and has sent no
  report for 3 minutes. Agent sessions without heartbeats, plugin-reported or
  self-reported, are never `unresponsive`. Shinan shows how long ago they were
  last seen. Reason: three missed heartbeats rule out a single network hiccup,
  and a person checking a stuck task sees the truth quickly.
- **Shinan's own outages do not count.** Plugins buffer reports while Shinan is
  unreachable ([resilience](#resilience)). When a buffered batch shows the
  agent session was alive during a gap, Shinan records no `unresponsive` event
  for it. Reason: Shinan being down must not look like every agent crashing.
- **Detach after 24 hours.** An agent session that has been `offline` or
  `unresponsive` for 24 hours is released from its task, with the reason
  "timed out". It is not `ended`; if it comes back, it re-claims as described
  above. Reason: a crashed agent session must not hold a task forever, while a
  paused one should be able to continue.
- **End after 30 days** without any report or call, for both presence sources.
  Reason: records must close eventually; 30 days covers holidays.
- **Display threshold for MCP-only agents:** a last-seen time over 30 minutes
  is shown as a warning sign. This is for people, not a rule agents follow
  (agents have no clock; see [reporting progress](#reporting-progress)).
- **Open:** whether workspaces can change these values
  ([question 2](#open-questions)).

### What becomes an event

- **Proposed:** presence is kept as current state. Only these changes become
  [events](domain-model.md#event): agent session started, claimed, released
  (with the reason), started waiting (with the reason), stopped waiting, went
  `offline`, resumed, became `unresponsive`, ended. Changes between `busy` and
  `idle` update the current state only. Reason: busy and idle change many times
  an hour, and the plan asks for agent activity to be compact on the timeline.

### What plugins send, and what they never send

All **proposed**:

- **Allowed fields only.** Shinan accepts a fixed list of fields in plugin
  reports and rejects any report with other fields: agent session and
  conversation IDs, state and time, coding tool and version, repository (git
  host and path only) and branch, task, waiting reason and label, heartbeat
  declaration, model, and the work identifiers below. Reason: the rule must not
  rely on plugin code alone. A plugin can read the whole transcript (Claude Code
  `$.session.messages()`, OpenCode `ctx.session.context`), so the server must
  refuse anything else.
- **Never sent:** prompts, replies, reasoning, file contents, diffs, tool
  arguments or tool output. Reason: Shinan is a public web app behind sign-in
  that already holds infrastructure details (D-015). Transcripts would add risk
  for no gain.
- **Work identifiers.** While an agent session is `busy`, the plugin reports the
  branch heads and commit IDs it sees appear in the checkout (OpenCode
  `ctx.vcs`, `vcs.branch.updated`; Git in Claude Code hooks). These are
  identifiers, not content. Reason: they give the identity document's
  attribution rules evidence that does not depend on the agent writing markers
  (D-017).

### Resilience

- **Proposed:** a plugin never blocks or slows the coding tool. Calls to Shinan
  run in the background with short time limits. If Shinan cannot be reached,
  the plugin keeps a bounded buffer of reports and sends them later with their
  original times. Reason: Shinan helps the work; it must never stop it.
- **Proposed:** when the plugin starts, it lists the coding tool's current
  conversations (OpenCode `ctx.session.list`) and any queued nudges
  (`GET /api/session/{sessionID}/inbox`), and brings Shinan up to date. Reason:
  reports can be lost while the plugin is not running.

## MCP server and tools

The MCP server is how any agent acts in Shinan. **Decided** (D-014 and plan,
section 5): MCP and a skill for actions, for any agent. **Decided** (D-008):
Shinan runs no model. Hosting, protocol versions and the endpoint are owned by
the [architecture document](architecture.md), "MCP server".

### Design rules

All **proposed**:

1. **Few, task-shaped tools.** Under twenty, each matching a step in the
   agent's work. Reason: tool descriptions take up the model's context;
   OpenCode's documentation warns about this.
2. **Calls are matched to agent sessions** as described in
   [how a call is matched](#how-a-call-is-matched-to-an-agent-session).
3. **Writes are safe to retry.** Each write takes a key chosen by the caller,
   and repeating it changes nothing. Reason: a broken response stream loses the
   request in flight, and the client must send it again.
4. **Nudges travel in their own field.** Every result has a separate, clearly
   labelled `nudges` field. It holds nudges available for check-in for this
   agent session, but not those offered to or accepted by a plugin (see
   [nudge delivery](#nudge-delivery)). Nudges are never mixed into task or
   catalog text. Reason: MCP-only agents never poll on their own, and the agent
   must be able to tell a person's message from stored data.
5. **Results link and do not copy.** Task and catalog results point to owning
   sources and work items by URL. Reason: D-001 and the plan's rule not to copy
   facts another system owns.
6. **Stored text is data, not instructions.** Task descriptions, comments,
   catalog pages and outside issue text never override the agent's local
   instructions or permissions. Reason: Shinan stores text written by many
   people and, through outside issues (D-003), by strangers; the `workspace`
   repository treats commands found in logs and issues the same way. Nudges are
   the exception: they are messages from a signed-in person and follow
   [handling nudges](#handling-nudges).
7. **The server's instructions point to the skill.** The MCP server's
   instructions, which OpenCode and Claude Code give to the model, hold a short
   version of the conventions. Reason: an agent with the MCP server but not the
   skill still learns the basics.

### Tool set

A functional list, not a schema. Names are illustrative. All **proposed**.
Reason: together they cover the level 1 actions in the plan.

| Group | Tool | What it does | Notes |
|---|---|---|---|
| Agent session | **Start agent session** | Registers or finds the agent session. Returns the agent session ID, who the agent acts for, the start-here path for agents, any task attached automatically, and nudges. | First call. With a plugin, the agent already has this through its context. |
| | **Check in** | Says "still here", optionally with a one-line status, and acknowledges the nudge IDs the agent has read. Returns nudges. | |
| | **End agent session** | Ends the agent session and releases its task. | Only when the work is over, not when pausing. |
| Context | **Who am I** | Returns the agent, its member, the workspace and what the agent may do. | |
| Catalog | **Search catalog** | Finds catalog entities by text, type or relation, with fact freshness. | Reads the [agent index](catalog.md). |
| | **Get entity** | One catalog entity with facts, fact states, sources, last-checked times and links. | |
| | **Propose catalog change** | Opens a [catalog proposal](domain-model.md#catalog-proposal-and-approval) with changes, evidence and related task. | Flow owned by the [catalog document](catalog.md). |
| | **Record fact check** | Records that facts were checked against a source, with scope and result. | Unchanged claims only. The glossary proposes that such re-checks need no approval. |
| Tasks | **Find tasks** | Searches by text, repository, status or assignee. | |
| | **Get task** | Intent, acceptance criteria, decisions, status, task flags, work links, attached agent sessions, recent timeline. | |
| | **Create task** | Creates a task where the intent starts. Returns the ID for markers. | D-003. |
| | **Claim task** / **Release task** | Attaches or detaches the agent session. The claim returns the task, the marker formats, other attached agent sessions, and nudges waiting for the next claimant. | Rules in the [tasks document](tasks.md). |
| | **Report progress** | Adds a [progress update](domain-model.md#comment-and-progress-update). | |
| | **Link work** | Links a pull request, branch, commit or issue by URL, with a role. | Usually not needed when markers are used. |
| | **Ask for a person** | Sets the task flag `needs a person` with its required summary, or clears it. | Depends on the glossary's owner decision that agents may set this flag. If not adopted, the tool asks a person to set it. |
| | **Ask for deployment approval** | Sets `awaiting deployment approval` with the request details. | Contents and who clears it: [tasks document](tasks.md), "Awaiting deployment approval". |
| | **Record verification** | Records that the outcome was checked against the acceptance criteria, with evidence. | Status is calculated (D-005). |
| Nudges | **Reply to nudge** | A progress update linked to a nudge; also acknowledges it. | Progress updates create no nudges, so replies cannot loop. |

- **Proposed:** no tools set task status, approve catalog proposals, record
  deployment approvals, send nudges or comments, or manage members, tokens or
  git host connections. Reason: status is calculated (D-005), and the identity
  document reserves these actions for people.
- **Proposed:** the plan's level 1 list says agents "complete" tasks. Here that
  means **record verification**, which feeds the calculated status. No tool
  marks a task done. Reason: D-005. This reading is a
  [decision for the owner](#decisions-needed-from-the-owner).
- **Open:** whether the agent index is also offered as MCP resources
  ([question 6](#open-questions)).

## The CLI

All **proposed**:

- A `shinan` command-line program offers the same actions as the MCP tools,
  with the same token. Reason: the plan lists a CLI; scripts, people and agents
  without MCP can use it. How it holds the token is owned by the architecture
  and identity documents.
- The CLI also accepts plugin reports as subcommands, so a Claude Code command
  hook can call it. Reason: one place for authentication and buffering.
- The plugin puts the agent session ID in the environment of the agent's shell
  commands, for example `SHINAN_SESSION`, through OpenCode's session environment
  API or Claude Code's `CLAUDE_ENV_FILE` in `SessionStart`. CLI calls from those
  commands count as tool-reported. Reason: the value is set by the plugin, not
  typed by the model.

## The skill

All **proposed**:

- One skill, `shinan`, with a short main file and supporting files. Reason:
  coding tools load only a skill's description until it is needed, so a short
  main file keeps context cost low.
- The Shinan installation serves the skill. OpenCode loads it as an HTTP skill
  catalog; the Claude Code plugin bundles a copy; other tools get a file.
  Reason: one source keeps conventions current. Today the `workspace`
  repository's skills are copied to each machine by hand.
- During the trial (D-018), the skill and MCP server are enabled only for trial
  projects. Reason: D-018 keeps the `workspace` repository as the source of
  truth until migration, and two sets of instructions on one project would
  conflict.

## Conventions agents follow

The skill teaches the task-side rules in the [tasks document](tasks.md),
"Conventions agents follow", and the rules below, which this document owns.
They are adapted from the `workspace` repository's
[collaboration practice](https://git.guneet.dev/guneet/workspace/src/branch/main/docs/collaboration.md).
All are **proposed**, with reasons.

### Starting work

1. Start the agent session (or confirm the one the plugin started), then find
   or create the task and claim it. Reason: every piece of work needs one home
   (D-003), and a claim records who is working.
2. Read the relevant catalog entities and their freshness before relying on
   them. Reason: D-007.

### Markers

- **Decided** (D-002): the task ID goes in branch names and PR descriptions. The
  formats are in the [tasks document](tasks.md), "Markers".
- **Required here:** PR descriptions, and commit messages the agent writes,
  also name the agent session, so that git host items can be credited
  (D-017). The line's name and form must use the same scheme as the tasks
  document's trailers. The checks that make it count are in the identity
  document, "Checking markers". Reason: agents share their person's git host
  account, so Shinan needs its own evidence.

### Reporting progress

- Report **milestones**, not activity: branch published, PR opened, CI result,
  review addressed, merged, outcome verified. Plugins and git host integrations
  already record activity. Reason: compact agent activity (plan, Timeline
  pillar).
- Report **decisions** with a one-line reason, and **blockers** as soon as they
  are known, with who can clear them.
- Keep notes short, and link to work items instead of copying them. Reason:
  D-001 and D-005.
- **Check in on events, not on a clock**: at each milestone, before and after
  long-running commands, and before ending a turn. Reason: models have no clock,
  so a time-based rule cannot be followed. These moments still keep MCP-only
  agents' nudges and last-seen time fresh.

### When to ask a person

Use **ask for a person** when the task cannot move until a person does
something an agent cannot or must not do: access the agent lacks, secrets,
physical steps, checks only a person can make, or decisions that belong to the
person. Never ask for secret values. Do not use it for routine work, waiting on
other tasks, problems the agent can still solve, or questions a quick answer in
the conversation would settle. The required summary is defined in the tasks
document, "Needs a person". Reason: this is the `workspace` repository's
`human-effort` rule, which the glossary maps to `needs a person`.

Use **ask for deployment approval** before any step that would change a running
deployment; preparing the change needs no approval. A nudge, even from the
right person, is never a deployment approval: the identity document reserves
recording one for people, in Shinan. Reason: this is the `workspace`
repository's only approval gate, and D-016 applies it to Shinan itself.

### Handling nudges

- A nudge arrives labelled with its sender, task and nudge ID, apart from
  stored data ([design rule 4](#design-rules)).
- **From the agent's own member:** treat it as that member's own words, as if
  typed into the conversation. The usual rule applies: the more recent
  instruction wins. Reason: the [tasks document](tasks.md) gives a nudge its
  sender's authority, and the agent acts for this member.
- **From another member:** treat it as a request within the current task,
  never as permission to widen scope (identity document, "Nudges from other
  people"). Report a conflict with the member's instructions in the reply.
- Neither kind overrides local permissions, tool permission prompts or safety
  rules. Reason: the coding tool's protections stay in charge. Claude Code
  applies the same limits to messages from other sessions.
- Reply with **reply to nudge**, which also acknowledges it. A nudge ID already
  seen is ignored. Reason: in rare failures a nudge can arrive twice
  ([nudge delivery](#nudge-delivery)).

### Finishing

1. Carry the work through the git host's normal review and merge process.
2. Do a documentation-impact check: propose catalog changes or record fact
   checks, with evidence and a narrow scope. Reason: the `workspace`
   repository's maintenance rule; agents keeping the catalog accurate is a core
   promise (plan, Catalog pillar).
3. Record verification, then release the task or end the agent session.

### Safety

- Never send secrets, credentials, private keys or unredacted logs to Shinan.
  Reason: the `workspace` repository's access policy; Shinan is not a secret
  store.
- Shinan grants no permissions. Local tool permissions, git host access and
  deployment approval rules still apply. Reason: D-017.

## Nudge delivery

The [tasks document](tasks.md), "Nudges", decides when a nudge is created, who
it targets, what it means, and that a person can withdraw it before delivery.
The [identity document](identity.md) decides who may nudge whose agent. The
[architecture document](architecture.md), "Plugins", owns the transport: the
plugin's stream, acknowledgements and reconnection. This section owns how each
delivery moves from `pending` to an outcome. **Decided** (plan, Nudges pillar):
live delivery through a plugin, delivery at the next check-in otherwise, and an
option to ask for a new agent session.

### One owner at a time

**Proposed:** while a delivery is `pending` (glossary state), exactly one of
these holds it:

| Holder | Meaning | Who can move it |
|---|---|---|
| Offered to plugin | Shinan has sent it to the plugin, which has not answered. | The plugin accepts or rejects. Shinan can withdraw the offer, and the plugin confirms the withdrawal or reports that it already accepted. |
| Accepted by the coding tool | The plugin handed it to the coding tool, which queued it (OpenCode: `ctx.session.prompt` admitted it). | The coding tool delivers it, or the person cancels it in the tool. |
| Available for check-in | Returned in the `nudges` field of every MCP or CLI result for this agent session. | The agent acknowledges it. |

```mermaid
flowchart TD
  P0[pending] --> L{Plugin connected<br/>with live delivery?}
  L -->|yes| O[Offered to plugin]
  O -->|accepted| A[Accepted by the coding tool]
  A -->|tool confirms the agent received it| D[delivered, route: live]
  A -->|person cancels in the tool| X[cancelled]
  O -->|rejected, or offer withdrawn<br/>and the plugin confirms| C
  L -->|no| C[Available for check-in]
  C -->|agent acknowledges| DC[delivered, route: check-in]
  P0 -->|person withdraws before delivery| W[withdrawn]
  P0 -->|agent session ends first| U[undeliverable]
```

All of the following is **proposed**.

- **Offer timeout.** If the plugin does not answer an offer within 30 seconds,
  Shinan withdraws it. The delivery moves to check-in only after the plugin
  confirms. Reason: a plugin that accepts at 31 seconds must not race a
  check-in.
- **Lost plugins.** If the plugin's connection has been gone longer than the
  `unresponsive` threshold with an offer unanswered, the delivery moves to
  check-in without confirmation. Reason: the agent may still be making MCP
  calls. In this one case a nudge can arrive twice; it carries its ID, and the
  agent ignores repeats.
- **When it is `delivered`.** Live: when the coding tool confirms that the agent
  received it (OpenCode `session.inbox.delivered`). The plugin acknowledges
  then, through the architecture document's acknowledgement. Check-in: when the
  agent acknowledges the nudge ID on a later call or replies to it. Until then
  the nudge is returned again on each call. Reason: a result can be lost on the
  way (a broken response stream loses the request), so sending is not
  receiving. This is a [decision for the owner](#decisions-needed-from-the-owner).
- **Withdrawal.** When a person withdraws a nudge, Shinan withdraws offers. If
  the coding tool has already queued it, the plugin cancels the queued item
  (OpenCode `DELETE /api/session/{sessionID}/inbox/{inboxID}`) and confirms. If
  it was already delivered, withdrawal is too late, and the person sees that.
- **Cancelled in the coding tool.** If the person at the coding tool removes a
  queued nudge (OpenCode `session.inbox.cancelled`), the plugin reports it. The
  delivery ends as `cancelled` and does not move to check-in. Reason: someone
  at the tool decided the agent should not get it; sending it another way would
  overrule them.
- **Batching.** Nudges waiting for one agent session are delivered together, in
  order, as one message listing each nudge with its sender and ID. This follows
  the tasks document. In OpenCode the message ID is derived from the nudge IDs,
  so sending it again is harmless (OpenCode returns the original admission for
  a known ID).
- **No agent session.** A nudge whose deliveries are all `undeliverable`, or
  that had no target, stays on the task. The next agent session that claims the
  task receives it in the claim result (tasks document). A resumed agent
  session that re-claims receives its own pending deliveries the same way.
- **Route recorded.** Each delivery records its route: live `steer`, live
  `queue`, the nearest equivalent in other tools, or check-in. Reason: a person
  can see how soon the agent could have acted.
- **Framing.** The text says who sent it, the task, the nudge ID, and how to
  reply. Messages that Shinan writes for a person's action (tasks document,
  "When a nudge is created") are labelled as from Shinan, with the action they
  report.
- **New outcomes** `withdrawn` and `cancelled`, and the holder states above,
  need adding to the glossary ([dependencies](#dependencies-on-other-documents)).

### Steer or queue

OpenCode accepts two delivery modes. `steer` admits the message at the agent's
next step. `queue` waits behind work already queued, so the agent finishes its
current work first. Either one wakes an idle agent session.

- **Proposed:** nudges from the agent's own member use `steer`. Nudges from
  other members use `queue`. The sender can override this when sending. Reason:
  the member's own corrections are worth most before the agent goes further,
  but another person should not redirect someone else's agent mid-step. The
  plan says nothing about timing, so this is a
  [decision for the owner](#decisions-needed-from-the-owner).
- Tools without these modes use the nearest equivalent
  ([Claude Code plugin](#claude-code-plugin)).

### Starting a new agent session

- **Proposed:** before phase 3, when a nudge has no active agent session to
  reach, Shinan shows the person a ready-made prompt to paste into their coding
  tool. It names the task and tells the agent to claim it. Reason: no launcher
  yet; making the manual step easy keeps nudges useful. The page belongs to the
  [human experience document](human-experience.md).
- In phase 3, a launcher can start it (see [launcher](#launcher-phase-3)).

## Plugins

### Common behavior

All **proposed**:

- **One install.** Installing the plugin also sets up the Shinan MCP server and
  the skill (OpenCode `ctx.mcp.transform` and `ctx.skill.transform`; Claude Code
  plugins bundle both). Reason: fewer steps, and the parts always match.
- **Configuration.** The plugin needs the Shinan installation's address and the
  agent's token. How the token is obtained and stored is owned by the identity
  document ("Registering an agent") and the architecture document.
- **Agent context.** The plugin gives the agent its agent session ID, its task
  and title, any reason a branch marker was not claimed automatically, and a
  pointer to the skill, without spending a tool call. OpenCode: a session
  instruction entry under the key `shinan`. Claude Code: `additionalContext` from
  `SessionStart`.
- **Report, never decide.** Plugins report and deliver. They change task state
  only through automatic claims.

### OpenCode plugin

**Decided** (D-014) that OpenCode comes first. Reason (from D-014): its plugin
API can follow session events and send messages into a running session. The
documentation confirmed this on 2026-11-16.

| Need | OpenCode V2 feature |
|---|---|
| Run alongside the tool | Server part of the plugin; `setup` with a clean-up function on unload (reports `offline`). |
| Follow conversations | `ctx.event.subscribe` for the events in [how states are detected](#how-states-are-detected), plus `session.moved`, `vcs.branch.updated`, `session.inbox.delivered` and `session.inbox.cancelled`. |
| Catch up after a restart | `ctx.session.list` and `ctx.session.get` (`parentID` for [child agent sessions](#child-agent-sessions)); `GET /api/session/{sessionID}/inbox` for nudges still queued. |
| Match MCP calls to the agent session | OpenCode sends `_meta["ai.opencode/sessionID"]` on every MCP tool call. |
| Repository and branch | `ctx.vcs.get`, `ctx.location`. |
| Deliver nudges | `ctx.session.prompt` with `delivery`, a message `id` derived from the nudge IDs, and `metadata`. It can attach the `shinan` skill. |
| Withdraw a queued nudge | `DELETE /api/session/{sessionID}/inbox/{inboxID}`. |
| Give the agent its context | `ctx.session.instructions.entry.put`. **Experimental** (`/api/experimental/...`). Fallback: a `context` hook that adds a system part. |
| Credit shell commands | Session environment endpoint (`PUT /api/session/{sessionID}/environment`). Not yet checked whether it is reachable through `ctx`. |
| Local memory | `ctx.storage` for delivered nudges and buffered reports. |

- **Proposed:** nudges go in as user prompts (`ctx.session.prompt`), not
  synthetic messages. Reason: a nudge is a person's words, and prompts pass
  through the user's own prompt hooks, such as redaction plugins; synthetic
  messages skip them. **Open** which models handle better
  ([question 3](#open-questions)).
- **Proposed:** each plugin instance reports only conversations in its own
  location, and Shinan removes duplicates by conversation ID. Reason: the event
  stream is not limited to the plugin's location. To be checked in a prototype
  ([question 4](#open-questions)).
- **Phases (proposed):** phase 1 ships presence, context and automatic claims;
  phase 2 adds live nudges. Reason: follows the plan's phases.

### Claude Code plugin

**Decided** (D-014): second. One plugin can bundle a skill, hooks, a mod (hooks
written as JavaScript, v2.1.287 or later) and an MCP server.

#### Claude Code lifecycle

**Proposed** mapping. Reason: in Claude Code, `/clear`, `/resume` and forks
change the conversation ID inside one running process, and mod `session.start`
does not fire again after them, but `session.end` does.

| What happens | Signals | Agent sessions |
|---|---|---|
| New conversation | `SessionStart` `source: startup` | New agent session; automatic claim if the branch has a marker. |
| `/clear` | `SessionEnd` `reason: clear`, then `SessionStart` `source: clear` with a new conversation ID | Old agent session `offline` (it can be resumed). New agent session for the new ID, with automatic claim. |
| `/resume`, `--resume`, `--continue` | `SessionEnd` `reason: resume` for the one left; `SessionStart` `source: resume` | The left one goes `offline`. If the resumed conversation keeps its conversation ID, it continues its agent session and re-claims if needed; otherwise it is a new agent session with automatic claim (to be checked in a prototype). |
| Fork, `/branch` | `SessionStart` `source: fork` | Treated as a [child](#child-agent-sessions) of the original. |
| Compaction | `SessionStart` `source: compact`, same ID | Same agent session; the plugin repeats the agent context, because compaction may have dropped it. |
| Exit | `SessionEnd` | `offline`. |

The mod timer keeps running across `/clear` and `/resume`, so each heartbeat
carries the conversation ID current at that moment. The plugin learns it from
the `SessionStart` hook.

`SessionEnd` hooks share a time budget, 1.5 seconds by default. Per-hook
`timeout` values can raise it up to 60 seconds, but values set on hooks that a
plugin provides do not. So the plugin's `offline` report must be one quick,
fire-and-forget request. If it is lost, the timeouts still apply.

#### Matching MCP calls

A `PreToolUse` hook matching Shinan's MCP tools adds the current conversation
ID to the arguments through `updatedInput`. Shinan treats it as tool-reported.
**Proposed**; to be checked in a prototype, because Claude Code does not
document sending a conversation ID to MCP servers itself.

#### Heartbeats

Mods send heartbeats with a timer. Without mods (an older version, or mods
turned off by an organization), the plugin works with hooks only and declares
no heartbeat ([heartbeats](#heartbeats-and-timeouts)).

#### Getting a message into a running conversation

Plan question 9 asks how far this is possible. Claude Code documents these
routes (2026-11-16):

| Route | When the agent reads it | Wakes an idle conversation? | Limits |
|---|---|---|---|
| Mod `$.prompt.submit` | Waits until idle, then starts a new turn. Claude is told which mod sent it unless `asUser: true`. | Yes | No steering. Refused after the user interrupts, until their next input. Turn and budget limits in `claude -p`. |
| Hook `additionalContext` on `PostToolUse` or `Stop` | Next to the next tool result, or at turn end (the turn continues) | No | Needs nudges already held on the machine; a network call on every tool call would slow the agent. |
| Hook with `asyncRewake`, exit code 2 | Immediately | Yes | Meant for background failures; its time limit applies. |
| The conversation's inbox socket (cross-session messaging, v2.1.224 or later) | Between tool calls, or as a new turn when idle | Yes | Claude is told it came from another session and cannot approve anything with it. Only the first "auth" line of the format is documented. |
| Channels | Queued into the conversation | Yes | Research preview; custom channels need `--dangerously-load-development-channels` or an organization allowlist; no confirmation; not registered on MCP revision 2026-07-28. |

- **Proposed:** the mod holds the connection to Shinan and keeps accepted
  nudges on the machine. It delivers them with `$.prompt.submit` when the
  conversation is idle, or when the delivery mode is `queue`. During a turn, a
  `PostToolUse` hook's `additionalContext` delivers them, which is the closest
  thing to `steer`. `asUser: true` is never used, so Claude always sees the mod
  named as the sender, which matches the [framing](#nudge-delivery) rule.
  Reason: these are documented, generally available features. Channels stay out
  while they are a preview behind a "dangerous" flag. The inbox socket is an
  alternative if its format becomes documented.
- **Proposed:** the delivery is `delivered` when the hook returns the context
  or `$.prompt.submit` starts the turn. Claude Code offers no stronger
  confirmation.
- **Proposed fallback without mods:** no live delivery. A `Stop` hook checks in
  at the end of each turn, adds any nudges as context, and acknowledges them.
  Nudges otherwise wait for the agent's own calls. Reason: hooks alone cannot
  hold a connection, but the end of a turn is a natural point to look.

### Other coding tools

- **Proposed:** every other tool, including Codex, stays at level 1. Reason:
  D-014 plans only OpenCode and Claude Code plugins.
- Codex documents hooks (`SessionStart`, `SessionEnd`, `UserPromptSubmit`,
  `Stop`, `PermissionRequest`, background hooks) that could support presence
  and in-turn nudges, but not waking an idle conversation.

## Launcher (phase 3)

**Decided** (D-014): a launcher on each machine starts agents, in phase 3,
optional and depending on phases 1 and 2 (plan, section 10). Outline only. All
**proposed**:

- A small program under the person's own account, with an outgoing connection
  to Shinan like a plugin. Reason: same network reasons (architecture
  document).
- When a person asks for a new agent session on a task, the launcher creates an
  isolated checkout following the machine's catalog entry and starts the
  coding tool with the plugin and a prompt that claims the task.
- It never deploys or approves. Which coding tools and projects it offers is
  set on the machine. Reason: a person controls what starts on their machine.
- It could also set up the per-machine signing key that the identity document
  proposes as later, stronger evidence ("Agent signing keys").
- **Open:** how a launcher is authorized (identity document).

## Authentication requirements

The [identity document](identity.md) owns registration, tokens, scopes,
machines, revocation and attribution. The [architecture document](architecture.md)
owns how tokens reach the MCP endpoint. Agent integrations needs:

1. One approval covers the plugin, the MCP server and the CLI on a machine.
2. Headless runs work: `claude -p`, `opencode run` and machines without a
   browser. Claude Code documents that `claude -p` cannot run an OAuth flow.
3. Tokens never pass through the model's context, a repository or a
   command-line argument.
4. Each token carries a machine label (see [what an agent session records](#what-an-agent-session-records)).
5. An agent session ID or conversation ID is never a credential.

## Verified external facts

Checked on **2026-11-16** against the vendors' own documentation.

| Fact | Source |
|---|---|
| OpenCode V2 plugins: server part, `setup` and clean-up, `ctx.event.subscribe`, `ctx.session.list/get/prompt/synthetic/context`, instruction entries, `ctx.tool/mcp/skill.transform`, `ctx.storage`, `ctx.vcs`, `context` hook, prompt admission returns the original for a known ID | [Plugins overview](https://opencode.ai/docs/build/plugins), [Server plugins](https://opencode.ai/docs/build/plugins/server) |
| Event names, `SessionStatus`, `Session.Inbox.Delivery` (`steer`, `queue`), prompt fields (`id` starting `msg_`, `metadata`, `skills`, `delivery`, `resume`), `parentID`; inbox list, cancel and update endpoints; instruction entries under `/api/experimental/`; session environment endpoint | [API reference](https://opencode.ai/docs/api), [OpenAPI document](https://opencode.ai/docs/openapi.json) |
| OpenCode MCP: `_meta["ai.opencode/sessionID"]` on tool calls, hidden from the model, not for authentication; default `protocol` is `legacy` (up to 2025-11-25); one connection per directory unless `pool`; server instructions added to the system prompt; tools consume context | [MCP servers](https://opencode.ai/docs/mcp-servers) |
| OpenCode skills: HTTP catalogs with `index.json` | [Skills](https://opencode.ai/docs/skills) |
| Claude Code hooks: events, `SessionStart` `source` values, `SessionEnd` reasons and budget (1.5 s; per-hook timeouts up to 60 s, not for plugin hooks), `additionalContext`, `PreToolUse` `updatedInput`, `CLAUDE_ENV_FILE`, `async` and `asyncRewake`, `Notification` timings | [Hooks reference](https://code.claude.com/docs/en/hooks) |
| Claude Code plugins and mods: components, version 2.1.287, `session.start` not repeated after `/clear` or `/resume`, timers, `$.prompt.submit` and `asUser`, `$.session.messages()` | [Plugins overview](https://code.claude.com/docs/en/plugins/overview), [Mods overview](https://code.claude.com/docs/en/plugins/mods/overview), [Mods API](https://code.claude.com/docs/en/plugins/mods/api), [Mods reference](https://code.claude.com/docs/en/plugins/mods/reference) |
| Cross-session messaging and the inbox socket | [Cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging), [Environment variables](https://code.claude.com/docs/en/env-vars) |
| Channels: research preview, development flag, no acknowledgement; not registered on 2026-07-28 | [Channels](https://code.claude.com/docs/en/channels), [Channels reference](https://code.claude.com/docs/en/channels-reference), [Claude Code MCP](https://code.claude.com/docs/en/mcp) |
| Codex hooks and background hook delivery | [Codex hooks](https://learn.chatgpt.com/docs/hooks) |
| MCP 2026-07-28: no protocol-level sessions; server-created handles as tool arguments; a broken stream loses the request | [MCP key changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog) |

## Dependencies on other documents

| Document | What this document needs from it |
|---|---|
| [Domain model and glossary](domain-model.md) ([#3](https://github.com/guneet-xyz/shinan/issues/3)) | New terms: **agent session ID**, **conversation ID**, **heartbeat**; presence state **`offline`** (distinct from `ended` and `unresponsive`); nudge delivery outcomes **`withdrawn`** and **`cancelled`**, the delivery **holder** (offered to plugin, accepted by the coding tool, available for check-in) and the delivery **route**. Confirmed: one task and one workspace per agent session. Owner decisions on `needs a person` and `awaiting deployment approval` affect two tools. |
| [Tasks and work](tasks.md) ([#6](https://github.com/guneet-xyz/shinan/issues/6)) | Claim rules and which tasks can be claimed automatically; markers, and one naming scheme for the task and agent session trailers; nudge creation, targets, meaning, batching and withdrawal; Shinan-written nudges; flag contents. |
| [Identity, agents and permissions](identity.md) ([#7](https://github.com/guneet-xyz/shinan/issues/7)) | Registration and tokens meeting the [authentication requirements](#authentication-requirements); machine labels; how tool-reported and model-passed session IDs count for attribution; marker checks; who may nudge whose agent; signing keys; launcher authorization. |
| [Architecture and operations](architecture.md) ([#11](https://github.com/guneet-xyz/shinan/issues/11)) | MCP endpoint and protocol versions; the plugin stream with offers, withdrawals and acknowledgements as used in [one owner at a time](#one-owner-at-a-time); the server-side allow-list for plugin reports; serving the skill. |
| [Catalog](catalog.md) ([#5](https://github.com/guneet-xyz/shinan/issues/5)) | The agent index; catalog proposal flow; recording unchanged re-checks; the agents' start-here path. |
| [Git host integrations](git-hosts.md) ([#8](https://github.com/guneet-xyz/shinan/issues/8)) | Detecting markers and turning them into work links. |
| [Human experience](human-experience.md) ([#10](https://github.com/guneet-xyz/shinan/issues/10)) | Showing presence (including `offline`), waiting reasons and delivery outcomes; the nudge form with steer or queue; the "start a new agent session" prompt. |
| [Roadmap and migration](roadmap.md) ([#12](https://github.com/guneet-xyz/shinan/issues/12)) | Trial projects; when Claude Code support lands. |
| [Decision log](decisions/) ([#13](https://github.com/guneet-xyz/shinan/issues/13)) | Records for D-014 and for the decisions below that the owner accepts. |

## Open questions

1. **Following tasks without claiming them.** Should a coordinating agent
   session be able to follow other tasks, for example to receive their nudges?
2. **Timeouts.** Are 60 s, 3 min, 24 h and 30 days right, and should a
   workspace be able to change them?
3. **Prompt or synthetic message in OpenCode.** Which do models handle better
   for nudges? Settle with a prototype.
4. **OpenCode plugin instances and locations.** How instances, locations and
   the shared event stream relate. Settle with a prototype before relying on
   the duplicate-removal rule.
5. **Codex and other tools.** Is a Codex plugin worth building after Claude
   Code?
6. **MCP resources.** Should the agent index also be offered as MCP resources?
7. **Claude Code inbox socket.** If its message format is documented, is it a
   better live route than the mod and hooks?

## Decisions needed from the owner

| # | Decision | Recommended option | Reason |
|---|---|---|---|
| 1 | How calls are matched to an agent session | Conversation ID reported by the coding tool first; model-passed agent session ID only as fallback; refuse writes when they disagree | The model can omit, reuse or copy IDs; tool-set IDs are outside its reach. |
| 2 | When a check-in delivery counts as `delivered` | When the agent acknowledges it, not when it is sent | A result can be lost on the way; sending is not receiving. |
| 3 | Default nudge delivery mode | `steer` for the agent's own member, `queue` for other members, overridable | Own corrections are worth most early; others should not redirect an agent mid-step. |
| 4 | Add presence state `offline` and the timeouts | `offline` on tool stop; release the task after 24 h silence and re-claim on resume; `ended` only on delete, archive, explicit end or 30 days | Conversations can be resumed; work and nudges should follow them. |
| 5 | Claude Code live nudges | Mod `$.prompt.submit` plus `PostToolUse` context, after OpenCode; hooks-only fallback without heartbeat or live delivery; no channels | Documented, generally available features; no "dangerous" flag. |
| 6 | What plugins may send | Allow-listed metadata only, enforced by Shinan; remote URLs without credentials | Shinan is public and holds infrastructure details (D-015). |
| 7 | Automatic claim from a branch marker | Yes, only for tasks that can be claimed | Does not rely on the agent's memory and respects pauses. |
| 8 | Plan's "complete tasks" for agents | Means "record verification"; no tool marks a task done | Status is calculated (D-005). |
| 9 | Plugin install also sets up MCP and the skill | Yes | Fewer steps; parts stay in step. |
| 10 | Subagents | Part of the parent unless they claim their own task | Keeps presence readable. |
| 11 | Skill and MCP during the trial | Trial projects only | D-018 keeps the `workspace` repository authoritative. |
