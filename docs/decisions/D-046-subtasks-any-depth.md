---
id: D-046
title: Subtasks can nest to any depth
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (N-1)"
supersedes: []
superseded_by: []
amends: [D-029]
amended_by: []
---

# D-046: Subtasks can nest to any depth

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 12](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6913152214):
N-1).

## Context

- [D-029](D-029-subtasks.md) (O-21) lets a task have subtasks; a task is done
  when all its subtasks are done and every delivering pull request linked to it
  is merged.
- Tasks and work asked whether to limit subtasks to one level.

## Decision

Subtasks can nest to any depth; there is no one-level limit.

## Reasons

Owner's choice; no reason recorded.

## Consequences

- **Decided:** D-029's "done" rule applies at every level: a subtask with its
  own subtasks is done only when they are done and its delivering pull
  requests are merged.
- Details: see [tasks and work](../tasks.md) and
  [human experience](../human-experience.md).

## Alternatives considered

- **Recorded:** subtasks limited to one level (tasks and work's question). Not
  chosen.

## Owning documents

- [Tasks and work](../tasks.md): subtasks and status.
- [Human experience](../human-experience.md): showing nested subtasks.

## Related open questions

None.

## History

- 2026-11-16: accepted by the owner on issue #25 (batch 12). Recorded in the
  decision log's pull request with the rest of the issue #25 answers (see
  [README, history](README.md#history)).
