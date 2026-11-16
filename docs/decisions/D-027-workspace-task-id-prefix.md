---
id: D-027
title: Each workspace has its own task ID prefix
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (O-6)"
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-027: Each workspace has its own task ID prefix

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 2](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6911197912):
O-6 accepted as recommended).

## Context

- [D-002](D-002-host-neutral-task-id.md) gives tasks a host-neutral ID used in
  branch names and PR descriptions; the plan's example is `T-123`
  ([plan, section 4](../plan.md#4-product-pillars)).
- The recommending documents (glossary, tasks and work) gave this reason: it
  keeps branch names unambiguous if a repository is connected to two
  workspaces.

## Decision

Each workspace has its own task ID prefix instead of a fixed `T-`.

## Reasons

Owner's choice; no reason recorded.

## Consequences

- How a prefix is chosen and used in markers: see
  [tasks and work](../tasks.md) and [agent integrations](../agent-integrations.md).

## Alternatives considered

- **Recorded:** a fixed `T-` prefix for every workspace. Not chosen.

## Owning documents

- [Tasks and work](../tasks.md): task IDs.
- [Git host integrations](../git-hosts.md) and
  [agent integrations](../agent-integrations.md): markers.

## Related open questions

None.

## History

- 2026-11-16: accepted by the owner on issue #25. Recorded in the decision
  log's pull request as part of the issue #25 batch (see
  [README, history](README.md#history)).
