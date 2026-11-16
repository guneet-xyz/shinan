---
id: D-035
title: Agent tokens last until revoked; the security log is kept forever; only workspace owners can purge
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (O-44, O-47, O-50)"
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-035: Agent tokens last until revoked; the security log is kept forever; only workspace owners can purge

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 6](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6912093727):
O-44, O-47 and O-50, not as recommended).

## Context

- The web app is public, and sign-in, access rules and security get extra
  attention ([D-015](D-015-public-web-app-with-sign-in.md)). Shinan is
  self-hostable, so installation operators may differ from workspace owners
  ([D-012](D-012-self-hostable.md)).
- Identity recommended short-lived access tokens with rotating renewal tokens,
  and one year of security log retention. Architecture recommended that
  installation operators may purge operational records.

## Decision

Agent tokens are long-lived and last until revoked: no one-hour access tokens,
no rotation and no forced re-approval. The security log is kept forever. Only
workspace owners can purge, including operational records about their
workspace (raw webhook deliveries, job records, logs). Installation operators
cannot purge.

## Reasons

Owner's choice; no reason recorded.

## Consequences

- Token handling, the security log and purge: see
  [identity, agents and permissions](../identity.md),
  [agent integrations](../agent-integrations.md),
  [architecture and operations](../architecture.md) and the
  [catalog](../catalog.md).

## Alternatives considered

- **Recorded:** about one-hour access tokens with rotating renewal tokens and
  a static fallback of at most 30 days (O-44's recommendation). Not chosen.
- **Recorded:** one year of security log retention (O-47's recommendation).
  Not chosen.
- **Recorded:** installation operators purge operational records (O-50's
  recommendation). Not chosen.

## Owning documents

- [Identity, agents and permissions](../identity.md): tokens, security log and
  purge rights.
- [Architecture and operations](../architecture.md): retention and purge.

## Related open questions

None.

## History

- 2026-11-16: accepted by the owner on issue #25. Recorded in the decision
  log's pull request as part of the issue #25 batch (see
  [README, history](README.md#history)).
