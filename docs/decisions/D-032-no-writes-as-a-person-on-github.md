---
id: D-032
title: Shinan never writes to GitHub as a person; person-requested git host actions are done by the person's own agents
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (O-1)"
supersedes: []
superseded_by: []
amends: [D-017]
amended_by: []
---

# D-032: Shinan never writes to GitHub as a person; person-requested git host actions are done by the person's own agents

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 1](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6910985893):
O-1, not as recommended).

## Context

- Agents use the same git host account as the person they work for
  ([D-017](D-017-shared-git-host-accounts.md)). Phase 3 adds a launcher on each
  machine to start agents ([D-014](D-014-three-connection-levels.md)).
- Git host integrations recommended the GitHub App installation token for
  writes a person asks for. Identity recommended each person's GitHub user
  access token, so the write shows as the person.

## Decision

Shinan does not write to GitHub as a person and stores no per-person GitHub
tokens. Shinan's own writes, such as backlinks, use the GitHub App's
installation token. Anything a person wants done on a git host is done by an
agent running on that person's own hardware, which is already authenticated to
the git host. When agents can be started from Shinan (phase 3), they run
OpenCode on hardware the user registers by installing the launcher, and a setup
guide for such a device (a VM, a MacBook and so on) is provided.

## Reasons

Owner's choice; no reason recorded.

## Notes

- **Sourced fact:** the owner's answer names GitHub. On Forgejo, the owner
  chose that Shinan uses the connecting person's own account
  ([D-033](D-033-forgejo-connection.md)). See
  [decisions needed](README.md#decisions-needed-from-the-owner).

## Consequences

- **Decided:** the only GitHub credential Shinan holds for writing is the
  GitHub App installation.
- Details: see [git host integrations](../git-hosts.md),
  [identity, agents and permissions](../identity.md),
  [agent integrations](../agent-integrations.md) and
  [roadmap and migration](../roadmap.md) (phase 3 device guide).

## Alternatives considered

- **Recorded:** each person's GitHub user access token, so writes show as the
  person (identity's recommendation). Not chosen.
- **Recorded:** the installation token with "requested by <person>" for writes
  a person asks for (O-1's recommendation). Not chosen; such writes are made by
  the person's agents instead.

## Owning documents

- [Git host integrations](../git-hosts.md): what Shinan writes.
- [Identity, agents and permissions](../identity.md): credentials held.
- [Agent integrations](../agent-integrations.md): the launcher.
- [Roadmap and migration](../roadmap.md): phase 3.

## Related open questions

- How reliable attribution can be ([plan, question 2](../plan.md#7-open-questions)).

## History

- 2026-11-16: accepted by the owner on issue #25. Recorded in the decision
  log's pull request as part of the issue #25 batch (see
  [README, history](README.md#history)).
