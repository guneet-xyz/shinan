---
id: D-061
title: Pushes are authenticated by the agent token; commit authors are not trusted; a push log records who pushed
status: proposed
date: 2026-11-19
decided_by:
evidence:
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-061: Pushes are authenticated by the agent token; commit authors are not trusted; a push log records who pushed

Status: **Proposed.** The owner decided this in conversation on 2026-11-19
(recorded on [issue #161](https://github.com/guneet-xyz/shinan/issues/161));
the record is accepted when the owner approves the
[Git-based catalog plan](../build-plan-git-catalog.md).

## Context

- Agents use their person's git host account, and Shinan attributes actions
  from its own records ([D-017](D-017-shared-git-host-accounts.md)).
- One agent token per agent works at every agent endpoint
  ([D-050](D-050-agent-token-browser-approval.md)); on Daedalus it is kept in
  a root-only file that agents must never read
  ([trial guide §4.2](../trial.md#42-the-token-file-owner)).
- Git records an author name and email in each commit, which the committer
  chooses freely ([git-commit](https://git-scm.com/docs/git-commit), checked
  2026-11-19).

## Decision

Commit author names and emails are not trusted and do not matter; agents may
commit under any name. Authentication is the token used to push: over HTTPS,
the agent token is the password, supplied by a Git credential helper that
reads the root-only token file, so agents never handle the token. Shinan keeps
a push log recording which agent and which person pushed each push, with the
commits, the ref, and the commits before and after.

## Reasons

Owner's choice; no reason recorded.

## Consequences

- The push log's records, events and the security log's refusals are proposed
  in the [plan §2.6 and §2.14](../build-plan-git-catalog.md#26-the-push-log-and-events).
- `/git/` accepts the agent token as the password of HTTP Basic
  authentication, because Git's credential helpers supply credentials that
  way ([plan §2.2](../build-plan-git-catalog.md#22-how-shinan-serves-git));
  owned afterwards by [identity](../identity.md) §7.4.
- Whether a fact check's `by` must name the pusher is open
  ([plan, GQ-3](../build-plan-git-catalog.md#102-questions-for-the-owner)).

## Alternatives considered

- **Implied:** trusting commit authors, or requiring signed commits. Not
  chosen: the owner made the token the only proof of who pushed.

## Owning documents

- [Identity, agents and permissions](../identity.md): tokens, attribution and
  audit.
- [Architecture and operations](../architecture.md): the Git endpoint.
- [Agent integrations](../agent-integrations.md): the setup on a machine.

## Related open questions

- [Plan, GQ-3](../build-plan-git-catalog.md#102-questions-for-the-owner).

## History

- 2026-11-19: decided by the owner in conversation; proposed as this record in
  the Git-based catalog plan ([issue #161](https://github.com/guneet-xyz/shinan/issues/161)).
