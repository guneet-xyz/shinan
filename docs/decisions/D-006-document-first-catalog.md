---
id: D-006
title: The catalog is document-first, with a generated agent index
status: accepted
date: 2026-11-16
decided_by: owner
evidence: https://github.com/guneet-xyz/shinan/issues/1
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-006: The catalog is document-first, with a generated agent index

Status: **Accepted** by the owner on 2026-11-16, with the plan
([issue #1](https://github.com/guneet-xyz/shinan/issues/1),
[PR #2](https://github.com/guneet-xyz/shinan/pull/2)).

## Context

- The `workspace` repository's catalog is Markdown files with structured fields
  at the top (`id`, `status`, `owner`, `last_verified` and others), read by both
  people and agents
  ([`workspace` repository maintenance practice](https://git.guneet.dev/guneet/workspace/src/branch/main/docs/maintenance.md)).
- The plan names Port, an internal developer portal, as a point of comparison.
  Positioning against competitors is owned by the
  [product overview](../product-overview.md).

## Decision

The catalog is document-first: Markdown with structured fields at the top is the
source of truth, and an index for agents is generated from it.

## Reasons

People must be able to read it; this is where Port is weakest and our workspace
repository already works well.

The statement about Port is the owner's assessment as recorded in the plan. It
was not independently checked for this record.

## Consequences

- **Decided:** the agent index is generated from the Markdown, never edited on
  its own ([plan, section 4](../plan.md#4-product-pillars)).
- **Decided:** the catalog is shown to people as a wiki with a "start here"
  path ([plan, section 4](../plan.md#4-product-pillars)).
- **Open:** where the Markdown is stored and how it and the agent index stay in
  sync ([plan, question 1](../plan.md#7-open-questions)). Owned by
  [architecture and operations](../architecture.md).
- **Open:** entity types' required fields and how relationships are expressed
  ([plan, question 5](../plan.md#7-open-questions)). Owned by the
  [catalog](../catalog.md).

## Alternatives considered

- **Structured-data-first catalog, with pages generated from a database** (the
  approach the plan contrasts with Port). Rejected: people must be able to read
  the catalog, and the Markdown approach already works in the `workspace`
  repository.
- Other alternatives: not recorded.

## Owning documents

- [Catalog](../catalog.md): entity types, editing and the agent index.
- [Human experience](../human-experience.md): the wiki.
- [Architecture and operations](../architecture.md): storage and sync.

## Related open questions

- Storage and sync of the Markdown and its index
  ([plan, question 1](../plan.md#7-open-questions)).
- Catalog schema ([plan, question 5](../plan.md#7-open-questions)).

## History

- First recorded as **proposed** in the first plan draft (commit `5c3330c`,
  2026-11-16).
- Accepted when the owner's answers were recorded (commit `e46c560`) and
  approved with the plan on 2026-11-16 (merge commit `248a2c5`).
