---
id: D-011
title: Private repository, internal brand "Shinan", first deployment at shinan.guneet.dev
status: accepted
date: 2026-11-16
decided_by: owner
evidence: https://github.com/guneet-xyz/shinan/issues/1
supersedes: []
superseded_by: []
amends: []
amended_by: [D-058]
---

# D-011: Private repository, internal brand "Shinan", first deployment at `shinan.guneet.dev`

Status: **Accepted** by the owner on 2026-11-16, with the plan
([issue #1](https://github.com/guneet-xyz/shinan/issues/1),
[PR #2](https://github.com/guneet-xyz/shinan/pull/2)).
Amended by [D-058](D-058-public-repository.md): the repository is public.

## Context

- The name and its meaning are explained in the
  [plan, section 1](../plan.md#the-name).
- Building a business is not a goal of this phase
  ([D-013](D-013-business-model-deferred.md)).

## Decision

Private repository, internal brand "Shinan", first deployment at
`shinan.guneet.dev`.

## Reasons

`shinan.ai` is too expensive for now; the product is for our own use first.

## Notes

- The price of `shinan.ai` was not checked for this record; "too expensive" is
  the owner's judgement.

## Consequences

- **Decided:** the repository's content is not copied to public places
  ([AGENTS.md](../../AGENTS.md)). **No longer holds** (owner, 2026-11-19,
  [D-058](D-058-public-repository.md)): the repository is public, and the
  rule is now that secrets, credentials and private infrastructure details
  never go in it.
- **Decided:** the web app is served at `shinan.guneet.dev`
  ([plan, section 5](../plan.md#5-integration-points)); where it runs is
  [D-016](D-016-musashi-and-deployment-approval.md).
- **Open:** whether Shinan later moves to `shinan.ai` or a public brand. Tied
  to the questions deferred by [D-013](D-013-business-model-deferred.md).

## Alternatives considered

- **Implied** by the reasons (not recorded as discussed): use `shinan.ai` from
  the start.

## Owning documents

- [Product overview](../product-overview.md): name and positioning.
- [Architecture and operations](../architecture.md): the deployment at
  `shinan.guneet.dev`.
- [Roadmap and migration](../roadmap.md): any later change of brand or domain.

## Related open questions

- Licensing now that the project is public
  ([plan, question 10](../plan.md#7-open-questions);
  [D-058](D-058-public-repository.md)).

## History

- Recorded as accepted ("agreed in conversation with the owner") in the first
  plan draft (commit `5c3330c`, 2026-11-16).
- Approved with the plan on 2026-11-16 (merge commit `248a2c5`).
- 2026-11-19: amended by [D-058](D-058-public-repository.md) (owner, in conversation; recorded on [issue #159](https://github.com/guneet-xyz/shinan/issues/159#issuecomment-7002059477)). Decision and Reasons unchanged; maintained sections updated.
