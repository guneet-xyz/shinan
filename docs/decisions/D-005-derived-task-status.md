---
id: D-005
title: Task status is calculated from linked work
status: accepted
date: 2026-11-16
decided_by: owner
evidence: https://github.com/guneet-xyz/shinan/issues/1
supersedes: []
superseded_by: []
amends: []
amended_by: [D-021]
---

# D-005: Task status is calculated from linked work

Status: **Accepted** by the owner on 2026-11-16, with the plan
([issue #1](https://github.com/guneet-xyz/shinan/issues/1),
[PR #2](https://github.com/guneet-xyz/shinan/pull/2)).
Amended by [D-021](D-021-status-from-work-and-events.md).

## Context

- The `workspace` repository's practice keeps no Markdown status mirror
  ([`workspace` repository collaboration practice](https://git.guneet.dev/guneet/workspace/src/branch/main/docs/collaboration.md)).
- A task's work items live on git hosts
  ([D-001](D-001-above-git-hosts.md)).

## Decision

Task status is calculated from linked work, not copied by hand.

## Reasons

Copied status goes stale; this matches the current workspace rule.

## Consequences

- **Decided:** a few states that only a person can set, such as "needs a
  person" (today's `human-effort` label), are set by hand
  ([plan, section 4](../plan.md#4-product-pillars)).
- **Decided:** Shinan learns about linked work through webhooks and periodic
  reconciliation ([plan, section 5](../plan.md#5-integration-points)).
- Proposed refinements: see the domain model's
  [task status, task flags and manual states](../domain-model.md#task-status-task-flags-and-manual-states).
- **Decided (owner):** this decision is read as "calculated from linked work
  plus recorded events" ([D-021](D-021-status-from-work-and-events.md)); task
  flags are managed per workspace ([D-028](D-028-task-flags.md)); a task with
  subtasks is done when they are done and its delivering PRs are merged
  ([D-029](D-029-subtasks.md)).
- Detailed status rules: Owned by [tasks and work](../tasks.md).

## Alternatives considered

- **Implied** by the wording (not recorded as discussed): status set and
  maintained by hand.

## Owning documents

- [Tasks and work](../tasks.md): status rules and manual states.
- [Git host integrations](../git-hosts.md): the events status is calculated
  from.

## Related open questions

- Reconciliation when webhooks are missed, and how freshness is shown
  ([plan, question 4](../plan.md#7-open-questions)).

## History

- Recorded as accepted ("agreed in conversation with the owner") in the first
  plan draft (commit `5c3330c`, 2026-11-16).
- Approved with the plan on 2026-11-16 (merge commit `248a2c5`).
- 2026-11-16: amended by [D-021](D-021-status-from-work-and-events.md) (owner answers on [issue #25](https://github.com/guneet-xyz/shinan/issues/25)). Decision and Reasons unchanged; maintained sections updated.
- 2026-11-16: related decisions [D-028](D-028-task-flags.md), [D-029](D-029-subtasks.md) recorded from [issue #25](https://github.com/guneet-xyz/shinan/issues/25); maintained sections updated.
