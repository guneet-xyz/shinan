---
id: D-004
title: Agent-driven work links PRs directly; repository issues only when people need them
status: accepted
date: 2026-11-16
decided_by: owner
evidence: https://github.com/guneet-xyz/shinan/issues/1
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-004: Agent-driven work links PRs directly; repository issues only when people need them

Status: **Accepted** by the owner on 2026-11-16, with the plan
([issue #1](https://github.com/guneet-xyz/shinan/issues/1),
[PR #2](https://github.com/guneet-xyz/shinan/pull/2)).

## Context

- Today, substantive work starts with a Forgejo issue that owns the objective
  and acceptance criteria, and pull requests link to it
  ([`workspace` repository collaboration practice](https://git.guneet.dev/guneet/workspace/src/branch/main/docs/collaboration.md)).
- In Shinan, the task holds the intent and acceptance criteria
  ([D-002](D-002-host-neutral-task-id.md)), so a repository issue for every
  task would hold the same thing twice.

## Decision

Agent-driven work links PRs directly; repository issues are created only when
people need them there.

## Reasons

Avoids duplicate issues.

## Consequences

- **Decided:** an agent working on a task opens a pull request that carries the
  task ID, and the pull request is linked to the task without an intermediate
  repository issue.
- **Proposed** (in the [domain model](../domain-model.md#work-link)): such a
  pull request has a work link with role `delivers`. Reason: derived status
  ([D-005](D-005-derived-task-status.md)) is calculated from `delivers` links.
- **Open:** when people "need" a repository issue (for example, for outside
  contributors or public visibility), and who creates it. Owned by
  [tasks and work](../tasks.md).
- **Proposed:** moving the `workspace` repository into Shinan
  ([D-018](D-018-start-empty-migrate-later.md)) replaces its issue-per-task
  practice. Reason: keeping both would recreate the duplicate issues this
  decision avoids. Owned by [roadmap and migration](../roadmap.md).

## Alternatives considered

- **Create a repository issue for every task, as the `workspace` repository's
  practice does today.** Rejected: duplicate issues.

## Owning documents

- [Tasks and work](../tasks.md): linking conventions and when repository
  issues are created.
- [Agent integrations](../agent-integrations.md): the conventions agents follow.
- [Git host integrations](../git-hosts.md): detecting linked pull requests.

## Related open questions

None in the plan beyond those listed above.

## History

- Recorded as accepted ("agreed in conversation with the owner") in the first
  plan draft (commit `5c3330c`, 2026-11-16).
- Approved with the plan on 2026-11-16 (merge commit `248a2c5`).
