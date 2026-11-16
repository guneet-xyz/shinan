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
amended_by: [D-041]
---

# D-010: Integrate with tools such as Multica, Linear and Plane through their APIs; do not embed them

Status: **Accepted** by the owner on 2026-11-16, with the plan
([issue #1](https://github.com/guneet-xyz/shinan/issues/1),
[PR #2](https://github.com/guneet-xyz/shinan/pull/2)).
Amended by [D-041](D-041-no-outside-tracker-integrations.md).

## Context

- Multica, Linear and Plane are tools in which teams track work. How Shinan
  compares with them is owned by the [product overview](../product-overview.md).
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

## Notes

- **Sourced fact:** as checked above, the licence forbids hosting for others
  or embedding in a distributed product unless a commercial licence is
  obtained; it does not forbid it outright.
- **Proposed:** the decision still follows from the licence because workspaces
  have invited members from the start ([D-019](D-019-workspaces-from-the-start.md)).
  People from outside the owner's organisation using a Shinan installation that
  embedded Multica would count as a hosted service to third parties. Reason
  for noting it: it explains why the "internal use is allowed" exception does
  not help.

## Consequences

- **Decided:** Shinan does not embed these tools; it connects to them through
  their APIs.
- **Decided (owner, [D-041](D-041-no-outside-tracker-integrations.md)):** no
  integrations with these tools are planned, and no document owns them.

## Alternatives considered

- **Implied** by the reasons (not recorded as discussed): embed Multica.

## Owning documents

- [Product overview](../product-overview.md): positioning against these tools.
- None for the integrations themselves; they are not planned
  ([D-041](D-041-no-outside-tracker-integrations.md)).

## Related open questions

- Licensing if Shinan is ever made public
  ([plan, question 10](../plan.md#7-open-questions)).

## History

- Recorded as accepted ("agreed in conversation with the owner") in the first
  plan draft (commit `5c3330c`, 2026-11-16).
- Approved with the plan on 2026-11-16 (merge commit `248a2c5`).
- 2026-11-16: amended by [D-041](D-041-no-outside-tracker-integrations.md) (owner answers on [issue #25](https://github.com/guneet-xyz/shinan/issues/25)). Decision and Reasons unchanged; maintained sections updated.
- 2026-11-16: removed the pointer to the glossary's "outside tool" term, which was dropped after D-041 (integration review I-61, [issue #26](https://github.com/guneet-xyz/shinan/issues/26)).
