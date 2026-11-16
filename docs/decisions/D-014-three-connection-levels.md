---
id: D-014
title: Agents connect at three connection levels - MCP and skill, plugin, launcher
status: accepted
date: 2026-11-16
decided_by: owner
evidence: https://github.com/guneet-xyz/shinan/issues/1
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-014: Agents connect at three connection levels: MCP and skill, plugin, launcher

Status: **Accepted** by the owner on 2026-11-16, with the plan
([issue #1](https://github.com/guneet-xyz/shinan/issues/1),
[PR #2](https://github.com/guneet-xyz/shinan/pull/2)).

## Context

- Agents connect from outside ([D-008](D-008-agents-connect-from-outside.md)).
- Shinan shows which agent sessions are running (presence) and passes a
  person's comment to the agent session working on a task (a nudge)
  ([plan, section 4](../plan.md#4-product-pillars)).
- MCP (Model Context Protocol) is a standard way for coding tools to call
  outside tools; a skill is an instruction file telling the agent how to use
  them ([domain model](../domain-model.md#connection-level)).
- OpenCode's plugin API, checked on 2026-11-16: a server plugin can subscribe to
  the OpenCode server's event stream (`ctx.event.subscribe`) and can send a
  prompt or a synthetic message into an OpenCode session
  (`ctx.session.prompt`, `ctx.session.synthetic`), with delivery modes "steer"
  and "queue"
  ([OpenCode server plugin documentation](https://opencode.ai/docs/build/plugins/server/)).

## Decision

Agents connect at three levels: MCP and a skill for actions (any agent); a
plugin per coding tool for presence and live nudges (OpenCode first, then Claude
Code); a launcher on each machine for starting agents (phase 3).

## Reasons

MCP alone depends on the agent choosing to report and cannot reach an idle or
crashed session. A plugin reports from the tool itself; OpenCode's plugin API
can follow session events and send messages into a running session.

## Consequences

- **Decided:** agent sessions connected only through MCP are marked
  "self-reported" ([plan, section 4](../plan.md#4-product-pillars)).
- **Decided:** agent sessions with a plugin get nudges live; others pick them
  up the next time they check in ([plan, section 4](../plan.md#4-product-pillars)).
- **Decided:** phase 1 includes the MCP server, the skill and the OpenCode
  plugin for presence; nudges are phase 2; the launcher is phase 3
  ([plan, section 10](../plan.md#10-phases-after-the-documents)).
- Proposed refinements: see the domain model's
  [connection level](../domain-model.md#connection-level),
  [presence](../domain-model.md#presence) and [nudge](../domain-model.md#nudge)
  entries.
- **Decided (owner):** an agent is per person, coding tool and machine, and
  every subagent is its own agent session ([D-031](D-031-agent-and-session-granularity.md));
  phase 3 launchers run on hardware the user registers
  ([D-032](D-032-no-writes-as-a-person-on-github.md)).
- **Open:** how far Claude Code and other coding tools can receive a message in
  a running agent session, and how presence works for tools with no plugin
  ([plan, question 9](../plan.md#7-open-questions)). Owned by
  [agent integrations](../agent-integrations.md).

## Alternatives considered

- **Recorded:** MCP and a skill only. The first plan draft said agents connect
  "through MCP and a skill" (commit `5c3330c`). Replaced by this decision for
  the reasons above.

## Owning documents

- [Agent integrations](../agent-integrations.md): MCP tools, skill, CLI,
  plugins, presence and nudge delivery.
- [Tasks and work](../tasks.md): when nudges are created.
- [Human experience](../human-experience.md): how presence is shown.
- [Roadmap and migration](../roadmap.md): which level arrives in which phase.

## Related open questions

- Message delivery and presence for coding tools other than OpenCode
  ([plan, question 9](../plan.md#7-open-questions)).

## History

- Added to the plan as **proposed** (commit `6cb3f88`, 2026-11-16).
- Accepted when the owner's answers were recorded (commit `e46c560`) and
  approved with the plan on 2026-11-16 (merge commit `248a2c5`).
- 2026-11-16: related decisions [D-031](D-031-agent-and-session-granularity.md), [D-032](D-032-no-writes-as-a-person-on-github.md) recorded from [issue #25](https://github.com/guneet-xyz/shinan/issues/25); maintained sections updated.
