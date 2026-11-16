---
id: D-029
title: Tasks can have subtasks; a task is done when its subtasks are done and its delivering PRs are merged
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (O-21)"
supersedes: []
superseded_by: []
amends: []
amended_by: [D-046]
---

# D-029: Tasks can have subtasks; a task is done when its subtasks are done and its delivering PRs are merged

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 4](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6911557353):
O-21, not as recommended).
Amended by [D-046](D-046-subtasks-any-depth.md).

## Context

- Task status is calculated ([D-005](D-005-derived-task-status.md),
  [D-021](D-021-status-from-work-and-events.md)).
- For tasks delivered by several pull requests, tasks and work recommended
  `Completes` / `Part of` scopes on links. The glossary proposed no subtasks in
  the first version.

## Decision

A task can have subtasks; big work is split into subtasks, instead of using
`Completes` / `Part of` markers. A task is done when all its subtasks are done
and every pull request linked to it as delivering work is merged.

## Reasons

Owner's choice; no reason recorded.

## Consequences

- **Decided:** `Completes` / `Part of` link scopes are not used.
- **Decided (owner, [D-046](D-046-subtasks-any-depth.md)):** subtasks can nest
  to any depth.
- How subtasks are created, shown and calculated: see
  [tasks and work](../tasks.md) and [human experience](../human-experience.md).

## Alternatives considered

- **Recorded:** `Completes` / `Part of` scopes on links (O-21's
  recommendation). Not chosen.
- **Recorded:** no subtasks in the first version (glossary). Not chosen.

## Owning documents

- [Tasks and work](../tasks.md): subtasks and status.
- [Human experience](../human-experience.md): task pages.
- [Agent integrations](../agent-integrations.md) and
  [git host integrations](../git-hosts.md): markers and linking.

## Related open questions

None.

## History

- 2026-11-16: accepted by the owner on issue #25. Recorded in the decision
  log's pull request as part of the issue #25 batch (see
  [README, history](README.md#history)).
- 2026-11-16: amended by [D-046](D-046-subtasks-any-depth.md) (owner answers, batch 12, on [issue #25](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6913152214)). Decision and Reasons unchanged; maintained sections updated.
