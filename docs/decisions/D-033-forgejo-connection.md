---
id: D-033
title: On Forgejo, Shinan uses the connecting person's own account and accepts any token
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (O-53, O-54)"
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-033: On Forgejo, Shinan uses the connecting person's own account and accepts any token

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 7](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6912226367):
O-53 and O-54, not as recommended).

## Context

- Forgejo is one of the first git hosts ([D-009](D-009-github-and-forgejo-first.md)).
- Git host integrations recommended a separate non-admin `shinan` Forgejo
  account and a token limited to specific repositories, refusing "All" tokens.

## Decision

Shinan uses the connecting person's own Forgejo account; there is no separate
`shinan` account. Shinan's writes on Forgejo appear as that person, and Shinan
recognises its own writes only by stored IDs. Shinan accepts any Forgejo
token, without requiring it to be limited to specific repositories and
without refusing broad tokens. The documents state the residual risk plainly
(a site administrator's broad token can act as any user), and the token is
stored encrypted.

## Reasons

Owner's choice; no reason recorded.

## Notes

- **Sourced fact:** for GitHub, the owner chose that Shinan never writes as a
  person and stores no per-person tokens
  ([D-032](D-032-no-writes-as-a-person-on-github.md)). See
  [decisions needed](README.md#decisions-needed-from-the-owner).

## Consequences

- **Decided:** Forgejo tokens are stored encrypted, and the residual risk is
  stated in the owning documents.
- Details: see [git host integrations](../git-hosts.md),
  [identity, agents and permissions](../identity.md) and
  [architecture and operations](../architecture.md).

## Alternatives considered

- **Recorded:** a separate non-admin `shinan` account (O-53's
  recommendation). Not chosen.
- **Recorded:** repository-limited tokens only, refusing "All" tokens (O-54's
  recommendation). Not chosen.

## Owning documents

- [Git host integrations](../git-hosts.md): Forgejo connections.
- [Identity, agents and permissions](../identity.md): attribution of
  Shinan's writes.
- [Architecture and operations](../architecture.md): encrypted storage.

## Related open questions

- How reliable attribution can be ([plan, question 2](../plan.md#7-open-questions)).

## History

- 2026-11-16: accepted by the owner on issue #25. Recorded in the decision
  log's pull request as part of the issue #25 batch (see
  [README, history](README.md#history)).
