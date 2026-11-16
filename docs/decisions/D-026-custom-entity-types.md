---
id: D-026
title: Custom entity types are allowed in the first version
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (O-17)"
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-026: Custom entity types are allowed in the first version

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 3](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6911355396):
O-17, not as recommended).

## Context

- The plan lists eight typed entities: project, machine, service, runbook,
  decision, policy, person and agent ([plan, section 4](../plan.md#4-product-pillars)).
- The catalog document recommended no custom types in the first version, and
  flagging unknown keys instead.

## Decision

Workspaces can add custom entity types in the first version. The eight
built-in types remain the defaults.

## Reasons

Owner's choice; no reason recorded.

## Consequences

- How custom types are defined and validated: see the [catalog](../catalog.md).
- How they are shown: see [human experience](../human-experience.md).

## Alternatives considered

- **Recorded:** no custom types in the first version; flag unknown keys
  (O-17's recommendation). Not chosen.

## Owning documents

- [Catalog](../catalog.md): entity types.
- [Domain model and glossary](../domain-model.md): the entity type list.
- [Human experience](../human-experience.md): display.

## Related open questions

- Catalog schema ([plan, question 5](../plan.md#7-open-questions)).

## History

- 2026-11-16: accepted by the owner on issue #25. Recorded in the decision
  log's pull request as part of the issue #25 batch (see
  [README, history](README.md#history)).
