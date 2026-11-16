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

- Today, issues own objectives and acceptance criteria, and pull requests link
  to them
  ([`workspace` repository collaboration practice](https://git.guneet.dev/guneet/workspace/src/branch/main/docs/collaboration.md)).
- In Shinan, the task holds the intent and acceptance criteria
  ([plan, section 4](../plan.md#4-product-pillars)).

## Decision

Agent-driven work links PRs directly; repository issues are created only when
people need them there.

## Reasons

Avoids duplicate issues.

## Consequences

- **Decided:** a pull request from agent-driven work is linked to its task
  without an intermediate repository issue.
- Proposed refinements: see the domain model's
  [work link](../domain-model.md#work-link) entry.
- **Open:** when people need a repository issue, and who creates it. Owned by
  [tasks and work](../tasks.md).

## Alternatives considered

- **Implied** by the reasons (not recorded as discussed): a repository issue
  for every task, as in the `workspace` repository's current practice.

## Owning documents

- [Tasks and work](../tasks.md): linking conventions and when repository
  issues are created.
- [Agent integrations](../agent-integrations.md): the conventions agents follow.
- [Git host integrations](../git-hosts.md): detecting linked pull requests.

## Related open questions

None in the plan.

## History

- Recorded as accepted ("agreed in conversation with the owner") in the first
  plan draft (commit `5c3330c`, 2026-11-16).
- Approved with the plan on 2026-11-16 (merge commit `248a2c5`).
