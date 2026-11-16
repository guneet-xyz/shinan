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

- The owner self-hosts their own services, including a Forgejo server and the
  machine that will run `shinan.guneet.dev`
  ([D-016](D-016-musashi-and-deployment-approval.md)).
- Port, checked on 2026-11-16: its documentation says Port "is a multi-tenant
  SaaS product" with "no option to fully self-host"; parts such as integrations
  and the Port Agent can run on the customer's premises, and enterprises can
  ask for a single-tenant deployment
  ([Port general troubleshooting](https://docs.port.io/troubleshooting/general/)).
- Chartroom: the plan names it as a comparison. A primary source for its
  hosting options was not identified for this record; the
  [product overview](../product-overview.md) owns competitor facts.

## Decision

Self-hostable by design.

## Reasons

We self-host, and it is the clearest gap left by Port and Chartroom.

## Consequences

- **Decided:** self-hosting is part of what the architecture document covers
  ([plan, section 8](../plan.md#8-documents-to-write-next)).
- **Proposed** (in the [domain model](../domain-model.md#shinan-installation)):
  "Shinan installation" names one running copy of Shinan, such as
  `shinan.guneet.dev` or a self-hosted copy. Reason given there: documents need
  a word for it that is not "workspace".
- **Proposed:** Shinan does not depend on a service that is only available as
  someone else's hosted product. Reason: such a dependency would stop others
  from running Shinan themselves. Owned by
  [architecture and operations](../architecture.md).
- **Open:** under what licence others could self-host it. Deferred by
  [D-013](D-013-business-model-deferred.md).

## Alternatives considered

- **Hosted service only.** Rejected: the owner self-hosts, and being
  self-hostable is a gap left by Port and (per the plan) Chartroom.

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
