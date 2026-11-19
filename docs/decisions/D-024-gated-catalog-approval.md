---
id: D-024
title: Only gated catalog changes need approval, from the start of the trial
status: superseded
date: 2026-11-19
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (O-3, O-46)"
supersedes: []
superseded_by: [D-060]
amends: []
amended_by: []
---

# D-024: Only gated catalog changes need approval, from the start of the trial

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 1](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6910985893):
O-3 accepted as recommended;
[batch 6](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6912093727):
O-46 accepted as recommended).

Superseded by [D-060](D-060-no-catalog-approval.md) on 2026-11-19.

## Context

- The plan says agents propose catalog changes and people approve them "where
  needed" ([plan, section 4](../plan.md#4-product-pillars)).
- The catalog, roadmap and glossary disagreed on the default: catalog said
  only gated classes from the start; roadmap said strict at first; the
  glossary said everything except unchanged rechecks.
- The recommending documents gave these reasons. Catalog: it keeps today's
  standing authority while rules, lifecycle, identity and exposure stay gated.
  Identity (O-46): nobody else can approve while one person uses Shinan.

## Decision

Only high-risk (gated) classes of catalog change need catalog approval, from
the start of the trial. If catalog accuracy slips, switch to strict approval.
While one person uses Shinan, that person may approve their own agent's
catalog proposals.

## Reasons

Owner's choice; no reason recorded.

## Consequences

- **Superseded (owner, 2026-11-19, [D-060](D-060-no-catalog-approval.md)):** catalog changes need no approval; Shinan's checks on push are the only gate, and undo is a revert.
- Which classes are gated: see the [catalog](../catalog.md).
- When "accuracy slips" is measured: see [roadmap and migration](../roadmap.md).
- Revisit self-approval when a second member joins: see
  [identity, agents and permissions](../identity.md).

## Alternatives considered

- **Recorded:** strict approval at first, relaxed after two trial weeks
  (roadmap). Not chosen.
- **Recorded:** approval for everything except unchanged rechecks (glossary).
  Not chosen.

## Owning documents

- [Catalog](../catalog.md): change classes and approval.
- [Roadmap and migration](../roadmap.md): trial measures.
- [Identity, agents and permissions](../identity.md): who may approve.

## Related open questions

None.

## History

- 2026-11-16: accepted by the owner on issue #25. Recorded in the decision
  log's pull request as part of the issue #25 batch (see
  [README, history](README.md#history)).
- 2026-11-19: superseded by [D-060](D-060-no-catalog-approval.md) ([Git-based catalog plan](../build-plan-git-catalog.md), accepted by the owner, [issue #161](https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7007337638)). Decision and Reasons unchanged.
