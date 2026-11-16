---
id: D-047
title: Installation-level security-log entries cannot be purged by anyone, for now
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (N-8)"
supersedes: []
superseded_by: []
amends: [D-035]
amended_by: []
---

# D-047: Installation-level security-log entries cannot be purged by anyone, for now

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 12](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6913152214):
N-8 accepted as recommended).

## Context

- [D-035](D-035-tokens-security-log-purge.md) (O-47, O-50) keeps the security
  log forever and lets only workspace owners purge, including operational
  records about their workspace; installation operators cannot purge.
- Some security-log entries, such as sign-in attempts and allowlist changes,
  belong to the installation and to no workspace, so no workspace owner can
  purge them.
- The recommending document (identity) gave this reason: it keeps the log
  complete, which matters more without a second factor, and the gap is stated.

## Decision

Installation-level security-log entries cannot be purged by anyone, for now.
Revisit if a deletion request arrives.

## Reasons

Owner's choice; no reason recorded.

## Consequences

- **Decided:** D-035's purge rights cover workspace content and records about a
  workspace only.
- Details: see [identity, agents and permissions](../identity.md) and
  [architecture and operations](../architecture.md).

## Alternatives considered

- **Not recorded.**

## Owning documents

- [Identity, agents and permissions](../identity.md): the security log.
- [Architecture and operations](../architecture.md): retention and purge.

## Related open questions

- What to do if a deletion request covers installation-level entries.

## History

- 2026-11-16: accepted by the owner on issue #25 (batch 12). Recorded in the
  decision log's pull request with the rest of the issue #25 answers (see
  [README, history](README.md#history)).
