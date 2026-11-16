---
id: D-043
title: No Git mirror of the catalog for now; catalog revisions live in PostgreSQL only
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (N-5, N-9)"
supersedes: []
superseded_by: []
amends: [D-022]
amended_by: []
---

# D-043: No Git mirror of the catalog for now; catalog revisions live in PostgreSQL only

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 12](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6913152214):
N-5 and N-9).

## Context

- [D-022](D-022-catalog-storage-and-git-mirror.md) (O-11, O-12) stores catalog
  revisions in PostgreSQL with an always-on, read-only Git mirror for the
  owner's installation.
- The architecture and catalog documents raised follow-up questions about the
  mirror, including how purge would rewrite it.

## Decision

There is no Git mirror of the catalog for now; it is left for later. Catalog
revisions live in PostgreSQL only. Purge therefore has no mirror to rewrite.
The rest of D-022 stands: each revision's Markdown text is the source of truth,
and catalog proposals and review happen inside Shinan.

## Reasons

Owner's choice; no reason recorded.

## Consequences

- **Decided:** the always-on mirror in D-022 is not built for now.
- **Decided:** purge ([D-035](D-035-tokens-security-log-purge.md)) does not
  need to reach a Git mirror.
- Details: see the [catalog](../catalog.md) and
  [architecture and operations](../architecture.md).

## Alternatives considered

- **Recorded:** an always-on read-only Git mirror
  ([D-022](D-022-catalog-storage-and-git-mirror.md), O-11). Deferred to later.

## Owning documents

- [Catalog](../catalog.md): revisions and export.
- [Architecture and operations](../architecture.md): storage and purge.

## Related open questions

- When a Git mirror is added later, and how purge then reaches it: not
  scheduled.

## History

- 2026-11-16: accepted by the owner on issue #25 (batch 12). Recorded in the
  decision log's pull request with the rest of the issue #25 answers (see
  [README, history](README.md#history)).
