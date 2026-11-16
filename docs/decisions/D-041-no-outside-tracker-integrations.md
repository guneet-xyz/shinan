---
id: D-041
title: No integrations with outside trackers are planned; the Multica trial is skipped
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (O-97, O-88)"
supersedes: []
superseded_by: []
amends: [D-010]
amended_by: []
---

# D-041: No integrations with outside trackers are planned; the Multica trial is skipped

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 10](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6912648147):
O-88; [batch 11](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6912663334):
O-97).

## Context

- [D-010](D-010-integrate-do-not-embed.md) says to integrate with tools such as
  Multica, Linear and Plane through their APIs and not embed them. No document
  owned those integrations.
- The product overview recommended a short local trial of self-hosted Multica
  against Forgejo before phase 2 board work.

## Decision

Shinan does not embed other trackers, and no integrations with them
(Multica, Linear, Plane) are planned. Revisit only if a real need appears. No
document owns them. The local Multica trial is skipped.

## Reasons

Owner's choice; no reason recorded.

## Consequences

- **Decided:** D-010's "do not embed" still holds; its "integrate through
  their APIs" no longer applies.
- **Decided:** the glossary's "outside tool" term was removed from the
  [domain model](../domain-model.md).
- Details: see the [product overview](../product-overview.md) and
  [tasks and work](../tasks.md).

## Alternatives considered

- **Recorded:** Tasks and work, or Git host integrations, owns these
  integrations (O-97's recommendation and its alternative). Not chosen.
- **Recorded:** a short local Multica trial before phase 2 (O-88's
  recommendation). Not chosen.

## Owning documents

- [Product overview](../product-overview.md): positioning against other
  trackers.
- [Roadmap and migration](../roadmap.md): the dropped trial.

## Related open questions

None.

## History

- 2026-11-16: accepted by the owner on issue #25. Recorded in the decision
  log's pull request as part of the issue #25 batch (see
  [README, history](README.md#history)).
- 2026-11-16: noted that the glossary removed the "outside tool" term (integration review I-61, [issue #26](https://github.com/guneet-xyz/shinan/issues/26)).
