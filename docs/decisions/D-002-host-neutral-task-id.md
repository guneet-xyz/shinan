---
id: D-002
title: The task is the core object and has a host-neutral task ID
status: accepted
date: 2026-11-16
decided_by: owner
evidence: https://github.com/guneet-xyz/shinan/issues/1
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-002: The task is the core object and has a host-neutral task ID

Status: **Accepted** by the owner on 2026-11-16, with the plan
([issue #1](https://github.com/guneet-xyz/shinan/issues/1),
[PR #2](https://github.com/guneet-xyz/shinan/pull/2)).

## Context

- A piece of work can touch several repositories on different git hosts
  ([plan, section 1](../plan.md#1-what-shinan-is)).
- A task's ID is given as "for example `T-123`" in the
  [plan, section 4](../plan.md#4-product-pillars).

## Decision

The task is the core object and has a host-neutral ID used in branch names and
PR descriptions.

## Reasons

Issue numbers only mean something inside one repository; a host-neutral ID ties
work on any host to one story.

## Consequences

- **Decided:** the task ID appears in branch names and pull request
  descriptions, so work on any git host can be connected to the task.
- Proposed refinements: see the domain model's [task](../domain-model.md#task)
  (ID uniqueness, prefix, subtasks) and [work link](../domain-model.md#work-link)
  entries.
- **Open:** the task ID format and linking conventions. Owned by
  [tasks and work](../tasks.md); the domain model asks the owner about a
  per-workspace prefix
  ([decisions needed](../domain-model.md#decisions-needed-from-the-owner)).

## Alternatives considered

- **Implied** by the reasons (not recorded as discussed): use git host issue
  numbers as the task's identity.

## Owning documents

- [Tasks and work](../tasks.md): task IDs, lifecycle and linking conventions.
- [Git host integrations](../git-hosts.md): detecting task IDs on git hosts.
- [Agent integrations](../agent-integrations.md): conventions agents follow.

## Related open questions

None in the plan.

## History

- Recorded as accepted ("agreed in conversation with the owner") in the first
  plan draft (commit `5c3330c`, 2026-11-16).
- Approved with the plan on 2026-11-16 (merge commit `248a2c5`).
