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
amended_by: [D-022, D-059, D-063, D-064]
---

# D-006: The catalog is document-first, with a generated agent index

Status: **Accepted** by the owner on 2026-11-16, with the plan
([issue #1](https://github.com/guneet-xyz/shinan/issues/1),
[PR #2](https://github.com/guneet-xyz/shinan/pull/2)).
Amended by [D-022](D-022-catalog-storage-and-git-mirror.md), [D-059](D-059-catalog-in-git-hosted-by-shinan.md), [D-063](D-063-no-mcp-for-the-catalog.md) and [D-064](D-064-catalog-not-wiki.md).

## Context

- The `workspace` repository's catalog is Markdown files with structured fields
  at the top, read by both people and agents
  ([`workspace` repository maintenance practice](https://git.guneet.dev/guneet/workspace/src/branch/main/docs/maintenance.md)).

## Decision

The catalog is document-first: Markdown with structured fields at the top is the
source of truth, and an index for agents is generated from it.

## Reasons

People must be able to read it; this is where Port is weakest and our workspace
repository already works well.

## Notes

- The statement about Port is the owner's assessment as recorded in the plan.
  It was not independently checked for this record; the
  [product overview](../product-overview.md) owns facts about competitors.

## Consequences

- **Decided (owner, 2026-11-19, [D-059](D-059-catalog-in-git-hosted-by-shinan.md), [D-063](D-063-no-mcp-for-the-catalog.md), [D-064](D-064-catalog-not-wiki.md)):** the Markdown is stored as files on `main` of one Git repository per workspace, hosted by Shinan (replacing D-022's storage); the generated index stays, for search and the catalog pages, while agents read the documents from their clone rather than through MCP; people see the catalog (no longer called the wiki) as a file tree, rendered pages, search and commit history.
- **Decided:** the agent index is generated from the Markdown
  ([plan, section 4](../plan.md#4-product-pillars)).
- **Decided:** the catalog is shown to people as a wiki with a "start here"
  path ([plan, section 4](../plan.md#4-product-pillars)).
- Proposed refinements: see the domain model's
  [catalog](../domain-model.md#catalog) and
  [wiki and agent index](../domain-model.md#wiki-and-agent-index) entries.
- **Decided (owner, [D-022](D-022-catalog-storage-and-git-mirror.md)):**
  revisions are stored in PostgreSQL and review happens in Shinan. There is
  no Git mirror for now ([D-043](D-043-no-git-mirror-for-now.md)). How the agent index is rebuilt: see
  [architecture and operations](../architecture.md).
- **Open:** the catalog schema ([plan, question 5](../plan.md#7-open-questions)).
  Owned by the [catalog](../catalog.md).

## Alternatives considered

- **Not recorded.** The reasons contrast the decision with Port, but the plan
  does not describe Port's approach as an alternative that was considered.

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
- 2026-11-16: amended by [D-022](D-022-catalog-storage-and-git-mirror.md) (owner answers on [issue #25](https://github.com/guneet-xyz/shinan/issues/25)). Decision and Reasons unchanged; maintained sections updated.
- 2026-11-16: related decision [D-043](D-043-no-git-mirror-for-now.md) recorded from batch 12 on [issue #25](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6913152214); maintained sections updated.
- 2026-11-19: amended by D-059, D-063 and D-064 ([Git-based catalog plan](../build-plan-git-catalog.md), accepted by the owner, [issue #161](https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7007337638)). Decision and Reasons unchanged; maintained sections updated.
