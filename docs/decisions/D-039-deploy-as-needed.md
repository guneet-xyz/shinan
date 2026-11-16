---
id: D-039
title: Deploy to Musashi as needed, each deployment with its own approval
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (O-83)"
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-039: Deploy to Musashi as needed, each deployment with its own approval

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 9](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6912465988):
O-83, not as recommended).

## Context

- Every deployment of `shinan.guneet.dev` needs the owner's approval
  ([D-016](D-016-musashi-and-deployment-approval.md)).
- The roadmap recommended a weekly release train, with one deployment approval
  per release.

## Decision

Deploy to Musashi as needed, each deployment with its own approval. There is
no weekly release train.

## Reasons

Owner's choice; no reason recorded.

## Consequences

- **Decided:** D-016's approval rule applies to each deployment; this record
  does not change it.
- Details: see [architecture and operations](../architecture.md) and
  [roadmap and migration](../roadmap.md).

## Alternatives considered

- **Recorded:** a weekly release train with one approval per release (O-83's
  recommendation). Not chosen.

## Owning documents

- [Architecture and operations](../architecture.md): deployment.
- [Roadmap and migration](../roadmap.md): release cadence.

## Related open questions

- DNS and deployment management ([plan, question 6](../plan.md#7-open-questions)).

## History

- 2026-11-16: accepted by the owner on issue #25. Recorded in the decision
  log's pull request as part of the issue #25 batch (see
  [README, history](README.md#history)).
