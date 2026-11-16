---
id: D-036
title: D-019 means design now, build before the second member
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (O-49)"
supersedes: []
superseded_by: []
amends: [D-019]
amended_by: []
---

# D-036: D-019 means design now, build before the second member

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 6](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6912093727):
O-49 accepted as recommended).

## Context

- [D-019](D-019-workspaces-from-the-start.md) puts workspaces and invitations
  in the design from the start.
- Identity's first-version scope splits multi-user work into three columns:
  built in version 1, designed now and built before a second member joins, and
  later. Its stated reason: it keeps version 1 small for one owner while
  building everything that would otherwise need rework.

## Decision

Read D-019 as "design now, build before the second member", using the
three-column split in the identity document's first-version scope.

## Reasons

Owner's choice; no reason recorded.

## Notes

- **Sourced fact:** other answers in the same batch (for example sign-in in
  [D-034](D-034-sign-in-and-accounts.md) and tokens in
  [D-035](D-035-tokens-security-log-purge.md)) change items inside that split.
  The identity document updates the split to match.

## Consequences

- The split itself: see
  [identity, agents and permissions](../identity.md).

## Alternatives considered

- **Implied** by the wording (not recorded as discussed): build every
  multi-user feature in the first version.

## Owning documents

- [Identity, agents and permissions](../identity.md): first-version scope.
- [Roadmap and migration](../roadmap.md): phases.

## Related open questions

None.

## History

- 2026-11-16: accepted by the owner on issue #25. Recorded in the decision
  log's pull request as part of the issue #25 batch (see
  [README, history](README.md#history)).
