---
id: D-010
title: Integrate with tools such as Multica, Linear and Plane through their APIs; do not embed them
status: accepted
date: 2026-11-16
decided_by: owner
evidence: https://github.com/guneet-xyz/shinan/issues/1
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-010: Integrate with tools such as Multica, Linear and Plane through their APIs; do not embed them

Status: **Accepted** by the owner on 2026-11-16, with the plan
([issue #1](https://github.com/guneet-xyz/shinan/issues/1),
[PR #2](https://github.com/guneet-xyz/shinan/pull/2)).

## Context

- Multica, Linear and Plane are tools in which teams track tasks and issues;
  Multica is built around assigning work to coding agents. How Shinan compares
  with them is owned by the [product overview](../product-overview.md).
- Multica's licence, checked on 2026-11-16: the
  [Multica License](https://github.com/multica-ai/multica/blob/main/LICENSE)
  is the Apache License 2.0 plus extra conditions. Without a commercial licence
  from its producer, Multica's source code may not be used to provide a hosted
  service to third parties, or be embedded as a component of a product that is
  sold, licensed or otherwise commercially distributed. Internal use within one
  organisation is allowed ([Multica licensing page](https://multica.ai/licensing)).
- The licences of Linear and Plane were not checked for this record.

## Decision

Integrate with tools such as Multica, Linear and Plane through their APIs; do
not embed them.

## Reasons

Multica's license forbids embedding or hosting for others; integrating keeps
Shinan host-neutral.

More precisely, as checked above, the licence forbids this unless a commercial
licence is obtained. That does not change the decision: depending on a
commercial licence would conflict with deferring the business model
([D-013](D-013-business-model-deferred.md)) and with self-hosting
([D-012](D-012-self-hostable.md)). This last point is **proposed** reasoning
added in this record.

## Consequences

- **Decided:** Shinan does not embed these tools; it connects to them through
  their APIs.
- **Proposed** (in the [domain model](../domain-model.md#supporting-terms)):
  such tools are called outside tools, and the term is owned by
  [tasks and work](../tasks.md).
- **Open:** whether items from outside tools become work items or task origins
  ([domain model, open questions](../domain-model.md#open-questions)), and
  which integrations are built in which phase. The plan's section 8 does not
  list these integrations in any document's scope; see
  [open questions in the decision log](README.md#open-questions).

## Alternatives considered

- **Embed Multica (or build Shinan on its code).** Rejected: its licence
  requires a commercial licence for hosting it for others or embedding it in a
  distributed product, and embedding one tool would tie Shinan to it.

## Owning documents

- [Product overview](../product-overview.md): positioning against these tools.
- [Tasks and work](../tasks.md): owner of the outside tool term, as proposed in
  the domain model. Ownership of the integrations themselves is **open**.

## Related open questions

- Licensing if Shinan is ever made public
  ([plan, question 10](../plan.md#7-open-questions)).

## History

- Recorded as accepted ("agreed in conversation with the owner") in the first
  plan draft (commit `5c3330c`, 2026-11-16).
- Approved with the plan on 2026-11-16 (merge commit `248a2c5`).
