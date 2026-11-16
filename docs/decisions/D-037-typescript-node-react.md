---
id: D-037
title: The stack is TypeScript, a plain Node.js server and a React single-page app
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (O-60, O-61)"
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-037: The stack is TypeScript, a plain Node.js server and a React single-page app

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 8](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6912340335):
O-60 and O-61).

## Context

- Under [D-020](D-020-stack-chosen-from-options.md), the architecture document
  proposes stack options with trade-offs and the owner chooses.
- Storage is PostgreSQL ([D-022](D-022-catalog-storage-and-git-mirror.md)).

## Decision

Shinan is written in TypeScript, with a plain Node.js server and a React
single-page app. No Next.js.

## Reasons

Owner's choice; no reason recorded. The architecture document's trade-offs are
in [architecture and operations](../architecture.md).

## Consequences

- Details: see [architecture and operations](../architecture.md).

## Alternatives considered

- **Recorded:** the other options in the architecture document, including
  Next.js. Not chosen.

## Owning documents

- [Architecture and operations](../architecture.md): stack and system design.

## Related open questions

None.

## History

- 2026-11-16: accepted by the owner on issue #25. Recorded in the decision
  log's pull request as part of the issue #25 batch (see
  [README, history](README.md#history)).
