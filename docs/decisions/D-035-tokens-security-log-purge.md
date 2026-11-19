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
amended_by: [D-047, D-049]
---

# D-035: Agent tokens last until revoked; the security log is kept forever; only workspace owners can purge

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 6](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6912093727):
O-44, O-47 and O-50, not as recommended).
Amended by [D-047](D-047-installation-security-log-not-purgeable.md) and [D-049](D-049-security-log-never-purged.md).

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

- **Decided (owner, 2026-11-19, [D-059](D-059-catalog-in-git-hosted-by-shinan.md)):** a catalog purge rewrites the Git repository's history on the server; copies in clones are the operator's to clean. This replaces the consequence below citing D-043.
- **Decided (owner, [D-049](D-049-security-log-never-purged.md)):** no
  security-log entry can ever be purged, including workspace entries
  (extending [D-047](D-047-installation-security-log-not-purgeable.md));
  workspace owners' purge rights cover other workspace content and records.
- **Decided (owner, [D-043](D-043-no-git-mirror-for-now.md)):** purge has no
  Git mirror to reach.
- **Decided (owner, [D-050](D-050-agent-token-browser-approval.md)):** agents
  get their token by a browser approval started from the plugin or CLI, and
  one token works at every agent endpoint.
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
- 2026-11-16: amended by [D-047](D-047-installation-security-log-not-purgeable.md) (owner answers, batch 12, on [issue #25](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6913152214)). Decision and Reasons unchanged; maintained sections updated.
- 2026-11-16: amended by [D-049](D-049-security-log-never-purged.md) (owner answers, batch 13, on [issue #25](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6913301590)). Decision and Reasons unchanged; maintained sections updated.
- 2026-11-16: related decision [D-050](D-050-agent-token-browser-approval.md) recorded from [issue #26](https://github.com/guneet-xyz/shinan/issues/26#issuecomment-6918513933); maintained sections updated.
- 2026-11-19: related decisions D-059 to D-065 recorded ([Git-based catalog plan](../build-plan-git-catalog.md), accepted by the owner, [issue #161](https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7007337638)). Decision and Reasons unchanged; maintained sections updated.
