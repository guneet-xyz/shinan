---
id: D-048
title: Shinan refuses Forgejo addresses on private, loopback or link-local networks by default
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (N-12)"
supersedes: []
superseded_by: []
amends: [D-044]
amended_by: []
---

# D-048: Shinan refuses Forgejo addresses on private, loopback or link-local networks by default

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 13](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6913301590):
N-12 accepted as recommended).

## Context

- [D-044](D-044-sign-in-magic-link-or-github.md) (N-7) lets anyone enter any
  Forgejo URL to connect accounts and repositories.
- The web app is on the public internet behind sign-in
  ([D-015](D-015-public-web-app-with-sign-in.md)).
- The recommending document (identity) gave this reason: otherwise any
  signed-in person could use Shinan's server to probe services reachable only
  from Musashi or the tailnet.

## Decision

Shinan refuses Forgejo addresses that resolve to private, loopback or
link-local networks by default. An installation operator may allow specific
hosts.

## Reasons

Owner's choice; no reason recorded.

## Consequences

- **Decided:** D-044's "any Forgejo URL" holds for public addresses; other
  addresses need an operator's allowance.
- Details: see [identity, agents and permissions](../identity.md),
  [git host integrations](../git-hosts.md) and
  [architecture and operations](../architecture.md).

## Alternatives considered

- **Implied** by the wording (not recorded as discussed): accept any address,
  as D-044 alone would allow.

## Owning documents

- [Identity, agents and permissions](../identity.md): protections for a public
  installation.
- [Git host integrations](../git-hosts.md): connecting Forgejo.
- [Architecture and operations](../architecture.md): outbound network rules.

## Related open questions

None.

## History

- 2026-11-16: accepted by the owner on issue #25 (batch 13). Recorded in the
  decision log's pull request with the rest of the issue #25 answers (see
  [README, history](README.md#history)).
