---
id: D-021
title: Task status is calculated from linked work plus recorded events; agents record verification
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (O-4, O-10)"
supersedes: []
superseded_by: []
amends: [D-005]
amended_by: []
---

# D-021: Task status is calculated from linked work plus recorded events; agents record verification

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 2](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6911197912):
O-4 and O-10 accepted as recommended).

## Context

- [D-005](D-005-derived-task-status.md) says task status is calculated from
  linked work, not copied by hand.
- The plan lists "complete" among the task actions agents can take through MCP
  ([plan, section 5](../plan.md#5-integration-points)).
- The recommending documents gave these reasons. Tasks and work: without this
  reading, `triage`, `verifying`, session-based `in progress` and `done` for
  tasks without code disappear. Agent integrations: status is calculated
  (D-005).

## Decision

Read D-005 as "task status is calculated from linked work plus recorded
events", such as acceptance, agent session attachment and verification.
Verification that covers every acceptance criterion can make a task `done`.
The plan's "agents complete tasks" means agents record verification; no tool
marks a task done directly.

## Reasons

Owner's choice; no reason recorded.

## Consequences

- **Decided:** status stays calculated; nobody types it, including agents.
- Details of the status rules: see [tasks and work](../tasks.md) and the
  [domain model](../domain-model.md#task-status-task-flags-and-manual-states).
- Related: subtasks also count toward `done`
  ([D-029](D-029-subtasks.md)).

## Alternatives considered

- **Recorded:** read D-005 literally, as linked work only (the plan's
  wording). Not chosen.

## Owning documents

- [Tasks and work](../tasks.md): status rules and verification.
- [Agent integrations](../agent-integrations.md): the tools agents use to
  record verification.

## Related open questions

None.

## History

- 2026-11-16: accepted by the owner on issue #25. Recorded in the decision
  log's pull request as part of the issue #25 batch (see
  [README, history](README.md#history)).
