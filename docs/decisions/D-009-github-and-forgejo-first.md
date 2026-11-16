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

- The owner's repositories are on GitHub and on a self-hosted Forgejo server
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
- **Proposed** (in the [domain model](../domain-model.md#git-host)): a git host
  is identified by its address, not its type, so two Forgejo servers are two
  git hosts. Reason given there: they have separate accounts.
- **Proposed:** the design should not assume features only one of the two hosts
  has. Reason: Shinan sits above both hosts ([D-001](D-001-above-git-hosts.md)),
  and a feature that only works on one would split the story by host. Owned by
  [git host integrations](../git-hosts.md).

## Alternatives considered

- **GitLab as a first git host.** Not chosen for the first version; it is
  planned for later. No further reasoning was recorded.

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
