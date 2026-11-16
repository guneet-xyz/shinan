---
id: D-045
title: Workspace roles are workspace owner and contributor only; there is no viewer role
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (N-11)"
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-045: Workspace roles are workspace owner and contributor only; there is no viewer role

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 12](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6913152214):
N-11).

## Context

- Workspaces have members and invitations from the start
  ([D-019](D-019-workspaces-from-the-start.md)), and every member sees
  everything in a workspace ([D-023](D-023-workspace-wide-visibility-no-secrets.md)).
- The [domain model](../domain-model.md#member-and-role) and identity proposed
  three roles: workspace owner, contributor and viewer. The roadmap's
  first-version additions, accepted in O-75, included a viewer test account.

## Decision

There is no viewer role. Workspace roles are workspace owner and contributor
only. The viewer test account is dropped from the first version, which changes
O-75.

## Reasons

Owner's choice; no reason recorded.

## Consequences

- **Decided:** documents remove the viewer role and the viewer test account.
- Details: see [identity, agents and permissions](../identity.md),
  [roadmap and migration](../roadmap.md),
  [human experience](../human-experience.md) and the
  [domain model](../domain-model.md#member-and-role).

## Alternatives considered

- **Recorded:** three roles including viewer (domain model and identity). Not
  chosen.
- **Recorded:** a viewer test account in the first version (O-75). Dropped.

## Owning documents

- [Identity, agents and permissions](../identity.md): roles and permissions.
- [Roadmap and migration](../roadmap.md): first-version scope.
- [Domain model and glossary](../domain-model.md): the role terms.

## Related open questions

None.

## History

- 2026-11-16: accepted by the owner on issue #25 (batch 12). Recorded in the
  decision log's pull request with the rest of the issue #25 answers (see
  [README, history](README.md#history)).
