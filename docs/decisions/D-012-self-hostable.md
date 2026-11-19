---
id: D-012
title: Self-hostable by design
status: accepted
date: 2026-11-16
decided_by: owner
evidence: https://github.com/guneet-xyz/shinan/issues/1
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-012: Self-hostable by design

Status: **Accepted** by the owner on 2026-11-16, with the plan
([issue #1](https://github.com/guneet-xyz/shinan/issues/1),
[PR #2](https://github.com/guneet-xyz/shinan/pull/2)).

## Context

- The owner self-hosts, including a Forgejo server and the machine that will
  run `shinan.guneet.dev` ([D-016](D-016-musashi-and-deployment-approval.md)).
- Port, checked on 2026-11-16: its documentation says Port "is a multi-tenant
  SaaS product" with "no option to fully self-host"; some parts can run on the
  customer's premises, and enterprises can ask for a single-tenant deployment
  ([Port general troubleshooting](https://docs.port.io/troubleshooting/general/)).
- Chartroom: a primary source for its hosting options was not identified for
  this record; the [product overview](../product-overview.md) owns competitor
  facts.

## Decision

Self-hostable by design.

## Reasons

We self-host, and it is the clearest gap left by Port and Chartroom.

## Consequences

- **Decided (owner, 2026-11-19, [D-059](D-059-catalog-in-git-hosted-by-shinan.md), [D-065](D-065-git-container-and-service-token.md)):** an installation also runs a Git container, whose volume holds the catalog; operators keep it as well as PostgreSQL.
- **Decided:** self-hosting is covered by the architecture document
  ([plan, section 8](../plan.md#8-documents-to-write-next)).
- Proposed refinements: see the domain model's
  [Shinan installation](../domain-model.md#shinan-installation) entry.
- **Open:** under what licence others could self-host it. Deferred by
  [D-013](D-013-business-model-deferred.md).

## Alternatives considered

- **Implied** by the reasons (not recorded as discussed): a hosted service
  only.

## Owning documents

- [Architecture and operations](../architecture.md): self-hosting design.
- [Product overview](../product-overview.md): positioning.

## Related open questions

- Licensing if the project is ever made public
  ([plan, question 10](../plan.md#7-open-questions)).

## History

- First recorded as **proposed** in the first plan draft (commit `5c3330c`,
  2026-11-16).
- Accepted when the owner's answers were recorded (commit `e46c560`) and
  approved with the plan on 2026-11-16 (merge commit `248a2c5`).
- 2026-11-19: related decisions D-059 to D-065 recorded ([Git-based catalog plan](../build-plan-git-catalog.md), accepted by the owner, [issue #161](https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7007337638)). Decision and Reasons unchanged; maintained sections updated.
