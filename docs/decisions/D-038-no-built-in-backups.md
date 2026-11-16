---
id: D-038
title: No built-in backups for now; relying on host-level backups is an accepted risk
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (O-62, O-63, O-64)"
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-038: No built-in backups for now; relying on host-level backups is an accepted risk

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 8](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6912340335):
O-62, O-63 and O-64, not as recommended).

## Context

- `shinan.guneet.dev` runs on Musashi ([D-016](D-016-musashi-and-deployment-approval.md)).
  The owner notes that host-level backups on Musashi are currently paused.
- The `workspace` repository stays the source of truth until it moves into
  Shinan ([D-018](D-018-start-empty-migrate-later.md)); after that, Shinan
  becomes the only copy.
- Architecture recommended built-in backups to off-host object storage, with
  recovery objectives of at most 24 hours of lost data and service back within
  one working day.

## Decision

Shinan has no built-in backups, and no backup target or recovery objectives,
for now. It relies on host-level backups. This is recorded as an accepted
risk, and the roadmap notes it as a consideration before the `workspace`
repository's migration, when Shinan becomes the only copy. Restore tests, if
run, use a temporary local-only installation on Daedalus (O-65).

## Reasons

Owner's choice; no reason recorded.

## Consequences

- **Decided:** the roadmap notes this risk as a consideration before the
  `workspace` repository moves into Shinan.
- Details: see [architecture and operations](../architecture.md) and
  [roadmap and migration](../roadmap.md).

## Alternatives considered

- **Recorded:** built-in backups as an exception to Musashi's retired backup
  tooling (O-62), an off-host target that cannot delete (O-63) and recovery
  objectives (O-64). Not chosen for now.

## Owning documents

- [Architecture and operations](../architecture.md): backups and restore.
- [Roadmap and migration](../roadmap.md): readiness before migration.

## Related open questions

None.

## History

- 2026-11-16: accepted by the owner on issue #25. Recorded in the decision
  log's pull request as part of the issue #25 batch (see
  [README, history](README.md#history)).
