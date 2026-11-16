---
id: D-001
title: Shinan sits above git hosts and does not replace their issues or PRs
status: accepted
date: 2026-11-16
decided_by: owner
evidence: https://github.com/guneet-xyz/shinan/issues/1
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-001: Shinan sits above git hosts and does not replace their issues or PRs

Status: **Accepted** by the owner on 2026-11-16, with the plan
([issue #1](https://github.com/guneet-xyz/shinan/issues/1),
[PR #2](https://github.com/guneet-xyz/shinan/pull/2)).

## Context

- The owner's work spans many repositories on GitHub and Forgejo
  ([plan, section 2](../plan.md#2-who-it-is-for)).
- Today, cross-project work is coordinated in the `workspace` repository's
  Forgejo issues, which link project issues and pull requests rather than
  copying their progress
  ([`workspace` repository collaboration practice](https://git.guneet.dev/guneet/workspace/src/branch/main/docs/collaboration.md)).

## Decision

Shinan sits above git hosts and does not replace their issues or PRs.

## Reasons

Work spans GitHub and Forgejo; neither can manage the other, and copying issues
creates two sources of truth.

## Consequences

- **Decided:** Shinan has no code review, CI, PR interface or per-repository
  issue tracker ([plan, section 3](../plan.md#3-what-shinan-does-not-do)).
- **Decided:** code work stays on git hosts; Shinan links to it and shows one
  timeline ([plan, section 1](../plan.md#1-what-shinan-is)).
- **Decided:** Shinan reads pull requests, issues, comments, checks and merges
  through webhooks, API calls and reconciliation, and posts links back where
  appropriate ([plan, section 5](../plan.md#5-integration-points)).
- **Proposed** (in the [domain model](../domain-model.md#event)): events link
  to git host content rather than copying it, and comments on work items stay
  on the git host. Reason: copying would recreate the second source of truth
  this decision avoids.
- **Open:** exactly what Shinan writes back to git hosts. Owned by
  [git host integrations](../git-hosts.md).

## Alternatives considered

- **Replace git host issues and pull requests with Shinan's own tracker.**
  Rejected: it would duplicate what git hosts already do and create two sources
  of truth ([plan, section 3](../plan.md#3-what-shinan-does-not-do)).
- **Let one git host manage work on the other.** Rejected: neither GitHub nor
  Forgejo can manage the other.
- **Copy (mirror) issues into Shinan.** Rejected: two sources of truth.

## Owning documents

- [Product overview](../product-overview.md): scope and non-goals.
- [Git host integrations](../git-hosts.md): what is read and written back.
- [Tasks and work](../tasks.md): how tasks link to work items.
- [Human experience](../human-experience.md): the timeline.

## Related open questions

- Reconciliation when webhooks are missed, and how freshness is shown
  ([plan, question 4](../plan.md#7-open-questions)).
- Permissions when a user can see a task but not a private repository it links
  to ([plan, question 3](../plan.md#7-open-questions)).

## History

- Recorded as accepted ("agreed in conversation with the owner") in the first
  plan draft (commit `5c3330c`, 2026-11-16).
- Approved with the plan on 2026-11-16 (merge commit `248a2c5`).
