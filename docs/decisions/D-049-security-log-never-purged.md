---
id: D-049
title: No security-log entry can ever be purged
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (N-13)"
supersedes: []
superseded_by: []
amends: [D-035, D-047]
amended_by: []
---

# D-049: No security-log entry can ever be purged

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 13](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6913301590):
N-13 accepted as recommended).

## Context

- [D-035](D-035-tokens-security-log-purge.md) (O-47, O-50) keeps the security
  log forever and lets workspace owners purge records about their workspace.
- [D-047](D-047-installation-security-log-not-purgeable.md) (N-8) says
  installation-level security-log entries cannot be purged by anyone, for now.
- The recommending document (identity) gave this reason: it keeps "kept
  forever" (O-47) meaningful and stops a taken-over owner account from erasing
  its own traces.

## Decision

No security-log entry can ever be purged, including workspace entries. This
narrows O-50 for the security log: workspace owners keep their purge rights for
other workspace content and records.

## Reasons

Owner's choice; no reason recorded.

## Consequences

- **Decided:** the purge rights in D-035 do not reach the security log.
- **Decided:** D-047's rule extends to every security-log entry, and is no
  longer limited to "for now".
- Details: see [identity, agents and permissions](../identity.md),
  [architecture and operations](../architecture.md) and
  [human experience](../human-experience.md).

## Alternatives considered

- **Recorded:** workspace owners may purge their workspace's security-log
  entries (D-035 as first accepted, O-50). Not kept.

## Owning documents

- [Identity, agents and permissions](../identity.md): the security log.
- [Architecture and operations](../architecture.md): retention and purge.
- [Human experience](../human-experience.md): purge screens.

## Related open questions

None.

## History

- 2026-11-16: accepted by the owner on issue #25 (batch 13). Recorded in the
  decision log's pull request with the rest of the issue #25 answers (see
  [README, history](README.md#history)).
