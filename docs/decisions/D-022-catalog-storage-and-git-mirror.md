---
id: D-022
title: Catalog revisions are stored in PostgreSQL with an always-on read-only Git mirror; review happens in Shinan
status: superseded
date: 2026-11-19
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (O-11, O-12)"
supersedes: []
superseded_by: [D-059]
amends: [D-006]
amended_by: [D-043]
---

# D-022: Catalog revisions are stored in PostgreSQL with an always-on read-only Git mirror; review happens in Shinan

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 3](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6911355396):
O-11 and O-12).
Amended by [D-043](D-043-no-git-mirror-for-now.md).

Superseded by [D-059](D-059-catalog-in-git-hosted-by-shinan.md) on 2026-11-19.

## Context

- [D-006](D-006-document-first-catalog.md) makes Markdown with structured
  fields the catalog's source of truth, and left storage open
  ([plan, question 1](../plan.md#7-open-questions)).
- The catalog and architecture documents recommended storing revisions in
  PostgreSQL with an optional, off-by-default one-way Git export, and catalog
  proposals and review inside Shinan.

## Decision

Each catalog revision's Markdown text is the source of truth, and everything
else is rebuilt from it. Revisions are stored in PostgreSQL. For the owner's
installation, a read-only Git mirror is always kept current: each change
appears within seconds as a readable commit. Catalog proposals and review
happen inside Shinan; the Git mirror is read-only.

## Reasons

The owner's stated purpose for the mirror: cloning, grep, history and exit.
No other reason recorded.

## Consequences

- **Superseded (owner, 2026-11-19, [D-059](D-059-catalog-in-git-hosted-by-shinan.md)):** the catalog is stored in Git, one repository per workspace hosted by Shinan; there are no PostgreSQL revisions, no mirror and no catalog proposals.
- **Decided (owner, [D-043](D-043-no-git-mirror-for-now.md)):** no Git
  mirror for now; catalog revisions live in PostgreSQL only. Proposals and
  review stay inside Shinan.
- Details: see the [catalog](../catalog.md) and
  [architecture and operations](../architecture.md).

## Alternatives considered

- **Recorded:** an optional, off-by-default Git export (the documents'
  recommendation). Changed to always on.
- **Recorded:** proposals and review through Git pull requests. Not chosen
  (O-12).

## Owning documents

- [Catalog](../catalog.md): revisions, proposals and review.
- [Architecture and operations](../architecture.md): PostgreSQL storage and the
  Git mirror.

## Related open questions

None.

## History

- 2026-11-16: accepted by the owner on issue #25. Recorded in the decision
  log's pull request as part of the issue #25 batch (see
  [README, history](README.md#history)).
- 2026-11-16: amended by [D-043](D-043-no-git-mirror-for-now.md) (owner answers, batch 12, on [issue #25](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6913152214)). Decision and Reasons unchanged; maintained sections updated.
- 2026-11-19: superseded by [D-059](D-059-catalog-in-git-hosted-by-shinan.md) ([Git-based catalog plan](../build-plan-git-catalog.md), accepted by the owner, [issue #161](https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7007337638)). Decision and Reasons unchanged.
