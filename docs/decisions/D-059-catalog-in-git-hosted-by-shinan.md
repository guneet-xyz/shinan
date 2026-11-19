---
id: D-059
title: The catalog is stored in Git, one repository per workspace, hosted by Shinan
status: accepted
date: 2026-11-19
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7007337638"
supersedes: [D-022, D-043]
superseded_by: []
amends: [D-006]
amended_by: []
---

# D-059: The catalog is stored in Git, one repository per workspace, hosted by Shinan

Status: **Accepted** by the owner on 2026-11-19, in conversation, with the
[Git-based catalog plan](../build-plan-git-catalog.md) ("Approve and start";
recorded on [issue #161](https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7007337638)).

## Context

- [D-022](D-022-catalog-storage-and-git-mirror.md) stored catalog revisions in
  PostgreSQL with a read-only Git mirror and review inside Shinan;
  [D-043](D-043-no-git-mirror-for-now.md) dropped the mirror for now.
- M2 built that design: catalog revisions in PostgreSQL, changed only through
  catalog proposals ([M2 build plan](../build-plan-m2.md)), deployed as v0.3.0
  on 2026-11-19.
- On 2026-11-19 the owner decided that it is not working and that the catalog
  moves to Git ([issue #161](https://github.com/guneet-xyz/shinan/issues/161),
  decisions 1 and 3).

## Decision

The catalog is stored in Git: one repository per workspace, hosted by Shinan
itself, with no external hosting such as GitHub or Forgejo. Shinan serves Git
over HTTPS. Agents clone the repository, make worktrees, handle merges
themselves and push. Multiple branches are allowed; the browser shows only
`main`.

## Reasons

Owner's choice: the M2 catalog "isn't working". No further reason recorded.

## Notes

- Proposed: the decision keeps [D-006](D-006-document-first-catalog.md)'s
  core: Markdown with structured fields at the top is still the source of
  truth, now as files on `main`, and the index is still generated from it.

## Consequences

- **Decided (owner, [issue #161](https://github.com/guneet-xyz/shinan/issues/161)):**
  the current catalog becomes the repository's first commit; waiting catalog
  proposals are not applied.
- **Decided (owner):** removing a leaked secret is an owner-only rewrite of
  the repository's history on the server; copies in clones are the operator's
  to clean, and the secret is rotated. This replaces D-043's "purge has no Git
  mirror to reach" ([D-035](D-035-tokens-security-log-purge.md)).
- The repository layout, how Git is served, the volume, branches, limits and
  purge: proposed in the [Git-based catalog plan](../build-plan-git-catalog.md)
  §2; owned afterwards by the [catalog](../catalog.md) and
  [architecture and operations](../architecture.md).
- Backups stay an accepted risk ([D-038](D-038-no-built-in-backups.md)); the
  plan notes clones as partial copies.

## Alternatives considered

- **Recorded:** catalog revisions in PostgreSQL, changed through catalog
  proposals, with or without a Git mirror (D-022, D-043, as built in M2).
  Replaced by this decision.
- **Implied:** hosting the repositories on an existing Git host (GitHub,
  Forgejo). Excluded by the owner's "hosted internally by Shinan itself".

## Owning documents

- [Catalog](../catalog.md): the repository's content and rules.
- [Architecture and operations](../architecture.md): serving Git, storage,
  purge.
- [Git-based catalog plan](../build-plan-git-catalog.md): the build.

## Related open questions

None. Where Git runs was answered by the owner (GQ-1): in its own container
([D-065](D-065-git-container-and-service-token.md)).

## History

- 2026-11-19: decided by the owner in conversation; proposed as this record in
  the Git-based catalog plan ([issue #161](https://github.com/guneet-xyz/shinan/issues/161)).
- 2026-11-19: accepted by the owner with the plan ([PR #162](https://github.com/guneet-xyz/shinan/pull/162),
  answers GQ-1 to GQ-6 [on issue #161](https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7007337638)).
