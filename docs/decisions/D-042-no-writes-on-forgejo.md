---
id: D-042
title: Shinan makes no writes on Forgejo; on GitHub it writes only as its app
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (N-4)"
supersedes: []
superseded_by: []
amends: [D-033]
amended_by: []
---

# D-042: Shinan makes no writes on Forgejo; on GitHub it writes only as its app

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 12](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6913152214):
N-4).

## Context

- On GitHub, Shinan never writes as a person and writes only through its GitHub
  App ([D-032](D-032-no-writes-as-a-person-on-github.md)).
- On Forgejo, [D-033](D-033-forgejo-connection.md) had Shinan use the
  connecting person's own account and token, so its writes would appear as that
  person. The decision log asked the owner whether that difference from GitHub
  was intended.

## Decision

Shinan makes no writes on Forgejo. Forgejo connections are read-only, and
Shinan adds no backlinks on Forgejo. On GitHub, Shinan writes only as its app
(D-032). D-033 (O-53, O-54) now concerns only reading: Shinan reads through the
connecting person's own Forgejo account and accepts any Forgejo token.

## Reasons

Owner's choice; no reason recorded.

## Consequences

- **Decided:** Shinan never writes to any git host as a person: on GitHub only
  as its app, on Forgejo not at all.
- **Decided:** anything a person wants done on Forgejo is done by that person's
  own agents ([D-032](D-032-no-writes-as-a-person-on-github.md)).
- Details: see [git host integrations](../git-hosts.md) and
  [identity, agents and permissions](../identity.md).

## Alternatives considered

- **Recorded:** Shinan writes on Forgejo as the connecting person
  ([D-033](D-033-forgejo-connection.md) as first accepted). Not kept.

## Owning documents

- [Git host integrations](../git-hosts.md): what Shinan reads and writes on each
  host.
- [Identity, agents and permissions](../identity.md): attribution and
  credentials.

## Related open questions

None.

## History

- 2026-11-16: accepted by the owner on issue #25 (batch 12). Recorded in the
  decision log's pull request with the rest of the issue #25 answers (see
  [README, history](README.md#history)).
