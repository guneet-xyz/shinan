---
id: D-016
title: shinan.guneet.dev runs on Musashi; every deployment needs the owner's approval
status: accepted
date: 2026-11-16
decided_by: owner
evidence: https://github.com/guneet-xyz/shinan/issues/1
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-016: `shinan.guneet.dev` runs on Musashi; every deployment needs the owner's approval

Status: **Accepted** by the owner on 2026-11-16, with the plan
([issue #1](https://github.com/guneet-xyz/shinan/issues/1),
[PR #2](https://github.com/guneet-xyz/shinan/pull/2)).

## Context

- Musashi is one of the owner's machines. The `workspace` repository's catalog
  describes it as the production machine hosting the owner's public
  applications (entry last verified there on 2026-11-14;
  [Musashi catalog entry](https://git.guneet.dev/guneet/workspace/src/branch/main/catalog/machines/musashi.md)).
- The owner's current practice already makes a change to an actual deployment
  the one step that needs their approval
  ([`workspace` repository access and safety policy](https://git.guneet.dev/guneet/workspace/src/branch/main/docs/access-and-safety.md)).

## Decision

`shinan.guneet.dev` runs on Musashi. Every deployment needs the owner's
approval.

## Reasons

Musashi already runs the owner's public applications.

The plan gives no separate reason for the approval rule. It matches the
owner's current practice cited above.

## Consequences

- **Decided:** no agent deploys `shinan.guneet.dev`, or changes its running
  deployment, without the owner's approval.
- **Open:** how DNS and deployment to Musashi are managed
  ([plan, question 6](../plan.md#7-open-questions)). Owned by
  [architecture and operations](../architecture.md).
- **Open, awaiting the owner** (raised by the
  [domain model](../domain-model.md#decisions-needed-from-the-owner)): whether
  a task waiting for deployment approval gets its own task flag,
  `awaiting deployment approval`, separate from `needs a person`. Owned by
  [tasks and work](../tasks.md).
- **Proposed:** the approval rule applies to the owner's deployment, not to
  Shinan installations that others self-host
  ([D-012](D-012-self-hostable.md)). Reason: those operators decide their own
  deployment rules. See [open questions in the decision log](README.md#open-questions).

## Alternatives considered

Not recorded. The first plan draft left the machine open ("Which machine hosts
`shinan.guneet.dev`") and already stated that any deployment needs the owner's
approval.

## Owning documents

- [Architecture and operations](../architecture.md): deployment on Musashi,
  DNS and backups.
- [Roadmap and migration](../roadmap.md): when the first deployment happens.

## Related open questions

- DNS and deployment management ([plan, question 6](../plan.md#7-open-questions)).

## History

- First plan draft: machine open; deployment approval already required
  (commit `5c3330c`, 2026-11-16).
- Recorded as accepted from the owner's answers (commit `e46c560`, 2026-11-16)
  and approved with the plan on 2026-11-16 (merge commit `248a2c5`).
