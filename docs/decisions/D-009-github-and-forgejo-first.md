---
id: D-009
title: GitHub and Forgejo are the first git hosts
status: accepted
date: 2026-11-16
decided_by: owner
evidence: https://github.com/guneet-xyz/shinan/issues/1
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-009: GitHub and Forgejo are the first git hosts

Status: **Accepted** by the owner on 2026-11-16, with the plan
([issue #1](https://github.com/guneet-xyz/shinan/issues/1),
[PR #2](https://github.com/guneet-xyz/shinan/pull/2)).

## Context

- The owner's repositories are on GitHub and Forgejo
  ([plan, section 2](../plan.md#2-who-it-is-for)).

## Decision

GitHub and Forgejo are the first git hosts.

## Reasons

They are the hosts we use.

## Consequences

- **Decided:** phase 1 includes GitHub and Forgejo connectors
  ([plan, section 10](../plan.md#10-phases-after-the-documents)).
- **Decided:** GitLab comes later
  ([plan, section 5](../plan.md#5-integration-points)).
- Proposed refinements: see the domain model's
  [git host](../domain-model.md#git-host) entry.

## Alternatives considered

- **Recorded:** GitLab, listed in the plan as a later git host
  ([plan, section 5](../plan.md#5-integration-points)). No reason for its
  order was recorded beyond the decision's reason.

## Owning documents

- [Git host integrations](../git-hosts.md): events, API use, reconciliation
  and rate limits for each host.
- [Roadmap and migration](../roadmap.md): when further hosts arrive.

## Related open questions

- Reconciliation when webhooks are missed
  ([plan, question 4](../plan.md#7-open-questions)).

## History

- Recorded as accepted ("agreed in conversation with the owner") in the first
  plan draft (commit `5c3330c`, 2026-11-16).
- Approved with the plan on 2026-11-16 (merge commit `248a2c5`).
