---
id: D-028
title: Task flags are managed per workspace; agents may set needs a person; awaiting deployment approval is its own flag
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (O-7, O-8)"
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-028: Task flags are managed per workspace; agents may set `needs a person`; `awaiting deployment approval` is its own flag

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 2](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6911197912):
O-7 accepted as recommended; O-8 accepted with an addition).

## Context

- The plan says task status is calculated "apart from states only a person can
  set, such as 'needs a person'" ([plan, section 4](../plan.md#4-product-pillars)).
  Letting agents set it changes that plan text, so it gets a record under the
  rule accepted in O-98.
- Every deployment needs the owner's approval
  ([D-016](D-016-musashi-and-deployment-approval.md)).
- The recommending documents (glossary, tasks and work) gave these reasons:
  agents usually discover that a person is needed, as with today's
  `human-effort` label; current practice keeps deployment approval apart from
  `needs a person`, and D-016 makes it routine.

## Decision

Agents and people may set and clear `needs a person`, with a required summary
of what is needed. `awaiting deployment approval` is a separate task flag from
`needs a person`. Task flags are managed per workspace: a workspace can add and
remove flags as it needs, and the built-in flags are defaults.

## Reasons

Owner's choice; no reason recorded.

## Consequences

- Built-in flags and who may set and clear each: see
  [tasks and work](../tasks.md) and the
  [domain model](../domain-model.md#task-status-task-flags-and-manual-states).
- **Decided (owner, [D-053](D-053-deployment-approval-events.md)):**
  deployment approval requests and answers are always recorded as task
  events, so removing `awaiting deployment approval` keeps that record.
- Managing flags per workspace: see [human experience](../human-experience.md).

## Alternatives considered

- **Recorded:** only people set `needs a person` (the plan's wording). Not
  chosen.
- **Recorded:** a fixed set of flags. Not chosen; the owner added per-workspace
  flags to O-8.

## Owning documents

- [Tasks and work](../tasks.md): task flags.
- [Human experience](../human-experience.md): flag management screens.
- [Domain model and glossary](../domain-model.md): the terms.

## Related open questions

None.

## History

- 2026-11-16: accepted by the owner on issue #25. Recorded in the decision
  log's pull request as part of the issue #25 batch (see
  [README, history](README.md#history)).
- 2026-11-16: related decision [D-053](D-053-deployment-approval-events.md) recorded from [issue #26](https://github.com/guneet-xyz/shinan/issues/26#issuecomment-6918513933); maintained sections updated.
