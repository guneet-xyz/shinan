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
- The owner's current practice makes a change to an actual deployment the one
  step that needs their approval
  ([`workspace` repository access and safety policy](https://git.guneet.dev/guneet/workspace/src/branch/main/docs/access-and-safety.md)).

## Decision

`shinan.guneet.dev` runs on Musashi. Every deployment needs the owner's
approval.

## Reasons

Musashi already runs the owner's public applications.

## Notes

- **Sourced fact:** the plan gives no separate reason for the approval rule.
  It matches the owner's current practice cited in Context.

## Consequences

- **Decided:** no deployment of `shinan.guneet.dev` happens without the
  owner's approval.
- **Decided (owner):** deployments happen as needed, each with its own
  approval ([D-039](D-039-deploy-as-needed.md)); `awaiting deployment
  approval` is its own task flag ([D-028](D-028-task-flags.md)); no built-in
  backups for now ([D-038](D-038-no-built-in-backups.md)).
- Proposed refinements: see the domain model's
  [supporting terms](../domain-model.md#supporting-terms) ("deployment
  approval") and its
  [decisions needed](../domain-model.md#decisions-needed-from-the-owner).
  This record does not assume their outcome.
- **Open:** how DNS and deployment to Musashi are managed
  ([plan, question 6](../plan.md#7-open-questions)). Owned by
  [architecture and operations](../architecture.md).

## Alternatives considered

- **Not recorded.** The first plan draft left the machine open ("Which machine
  hosts `shinan.guneet.dev`") and already required the owner's approval for
  any deployment.

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
- 2026-11-16: related decisions [D-028](D-028-task-flags.md), [D-038](D-038-no-built-in-backups.md), [D-039](D-039-deploy-as-needed.md) recorded from [issue #25](https://github.com/guneet-xyz/shinan/issues/25); maintained sections updated.
