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
  ([D-001](D-001-above-git-hosts.md)).
- Issue and pull request numbers are given by each repository on its git host,
  so the same number means different things in different repositories.

## Decision

The task is the core object and has a host-neutral ID used in branch names and
PR descriptions.

## Reasons

Issue numbers only mean something inside one repository; a host-neutral ID ties
work on any host to one story.

## Consequences

- **Decided:** the task ID (for example `T-123`) appears in branch names and
  pull request descriptions, so work items on any git host can be connected to
  the task ([plan, section 4](../plan.md#4-product-pillars)).
- **Proposed** (in the [domain model](../domain-model.md#task)): task IDs are
  unique within a workspace and never reused. Reason: a reused ID would make
  old branch names and pull requests point at the wrong story.
- **Proposed** (in the [domain model](../domain-model.md#work-link)): a task ID
  found in a branch name, pull request description or commit message creates a
  work link. Reason: this is how the ID ties work to the task without manual
  linking.
- **Open, awaiting the owner** (raised by the
  [domain model](../domain-model.md#decisions-needed-from-the-owner)): whether
  each workspace has its own task ID prefix instead of a fixed `T-`. The
  domain model also proposes no subtasks in the first version. Owned by
  [tasks and work](../tasks.md).
- **Open:** the exact naming conventions agents must follow. Owned by
  [agent integrations](../agent-integrations.md) and
  [tasks and work](../tasks.md).

## Alternatives considered

- **Use git host issue numbers (or URLs) as the task's identity.** Rejected:
  they only mean something inside one repository.
- Other alternatives: not recorded.

## Owning documents

- [Tasks and work](../tasks.md): task IDs, lifecycle and linking conventions.
- [Git host integrations](../git-hosts.md): detecting task IDs on git hosts.
- [Agent integrations](../agent-integrations.md): conventions agents follow.
- [Domain model and glossary](../domain-model.md): the task as the core object.

## Related open questions

None in the plan beyond those listed above.

## History

- Recorded as accepted ("agreed in conversation with the owner") in the first
  plan draft (commit `5c3330c`, 2026-11-16).
- Approved with the plan on 2026-11-16 (merge commit `248a2c5`).
