---
id: D-064
title: '"Wiki" becomes "catalog"; people browse main as a file tree with pages and search, without editing for now'
status: accepted
date: 2026-11-19
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7007337638"
supersedes: []
superseded_by: []
amends: [D-006]
amended_by: []
---

# D-064: "Wiki" becomes "catalog"; people browse `main` as a file tree with pages and search, without editing for now

Status: **Accepted** by the owner on 2026-11-19, in conversation, with the
[Git-based catalog plan](../build-plan-git-catalog.md) ("Approve and start";
recorded on [issue #161](https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7007337638)).

## Context

- [D-006](D-006-document-first-catalog.md)'s consequences say the catalog is
  shown to people as a wiki with a "start here" path; the plan names a "Wiki
  and onboarding" pillar ([plan §4](../plan.md#4-product-pillars)).
- M2 built the wiki: entity pages, type indexes, editing forms and catalog
  review ([human experience, the wiki](../human-experience.md#the-catalog)).
- With the catalog in Git ([D-059](D-059-catalog-in-git-hosted-by-shinan.md)),
  the browser shows only `main`.

## Decision

"Wiki" is renamed "catalog" everywhere in the UI and the documents. People
browse the catalog as a file tree with navigation on the left, rendered
Markdown pages and full-text search, not by types; simple and easy on the
eyes. There is no human editing in the browser for now. Navigation and polish
get their own improvement cycle later; the Git storage comes first. Recent
changes is the commit history: the catalog shows `main`'s commit history,
with the pusher from the push log beside each commit, and no separate list.

## Reasons

Owner's choice; no reason recorded. The last sentence is the owner's answer
GQ-6 to the plan ("Recent changes is the commit history").

## Consequences

- The wiki's editing, review, type index and repair screens are removed; the
  screens that remain are proposed in the
  [plan §3](../build-plan-git-catalog.md#3-the-catalog-ui).
- The start-here document stays, as a page of the catalog.
- The glossary's "wiki" entry and the plan's pillar change
  ([O-98](README.md#relationship-to-the-plan)).

## Alternatives considered

- **Recorded:** the wiki as built in M2, organised by entity type, with
  editing and review. Replaced.

## Owning documents

- [Human experience](../human-experience.md): the catalog screens.
- [Domain model and glossary](../domain-model.md): the term.

## Related open questions

None.

## History

- 2026-11-19: decided by the owner in conversation; proposed as this record in
  the Git-based catalog plan ([issue #161](https://github.com/guneet-xyz/shinan/issues/161)).
- 2026-11-19: accepted by the owner with the plan ([PR #162](https://github.com/guneet-xyz/shinan/pull/162),
  answers GQ-1 to GQ-6 [on issue #161](https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7007337638)).
- 2026-11-19: the Context's link to human experience follows that section's
  rename to "The catalog" (GC-10, [#172](https://github.com/guneet-xyz/shinan/issues/172)); no change of decision.
