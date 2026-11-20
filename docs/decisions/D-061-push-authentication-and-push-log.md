---
id: D-061
title: Pushes are authenticated by the agent token; commit authors are not trusted; a push log records who pushed; fact checks name the pusher
status: accepted
date: 2026-11-19
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7007337638"
supersedes: []
superseded_by: []
amends: []
amended_by: [D-066]
---

# D-061: Pushes are authenticated by the agent token; commit authors are not trusted; a push log records who pushed; fact checks name the pusher

Status: **Accepted** by the owner on 2026-11-19, in conversation, with the
[Git-based catalog plan](../build-plan-git-catalog.md) ("Approve and start";
recorded on [issue #161](https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7007337638)).
Amended by [D-066](D-066-by-names-the-first-pusher.md).

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
commits, the ref, and the commits before and after. A new or changed fact
check's `by` must name the pusher, in the written form for the pushing agent
and its person; otherwise the push is refused, with the reason.

## Reasons

Owner's choice; no reason recorded. The last sentence is the owner's answer
GQ-3 to the plan, against its recommendation not to match `by` to the
pusher.

## Consequences

- **Decided (owner, 2026-11-20, [D-066](D-066-by-names-the-first-pusher.md)):**
  the `by` rule's last sentence is refined: a new or changed fact check's
  `by` must name the agent (and its person) that first pushed the commit
  introducing it, not whoever pushes to `main`. Agent B may merge agent A's
  already-pushed branch into `main`; A's fact checks must still name A.
- The push log's records, events and the security log's refusals are proposed
  in the [plan §2.6 and §2.14](../build-plan-git-catalog.md#26-the-push-log-and-events).
- `/git/` accepts the agent token as the password of HTTP Basic
  authentication, because Git's credential helpers supply credentials that
  way ([plan §2.2](../build-plan-git-catalog.md#22-how-shinan-serves-git));
  owned afterwards by [identity](../identity.md) §7.4.
- The `by` rule, what counts as a new or changed fact check, and its tests
  are in the [plan §2.5](../build-plan-git-catalog.md#25-checks-on-push),
  check 6, as refined by D-066 (until 2026-11-20 this said that an agent
  could not land another agent's new fact checks by merging its branch). The
  `by` written form is
  [identity §8.7](../identity.md#87-how-an-actor-is-written-in-text)'s.
- `web` passes the authenticated agent and person to the Git container,
  which trusts them because of the service token
  ([D-065](D-065-git-container-and-service-token.md)).

## Alternatives considered

- **Implied:** trusting commit authors, or requiring signed commits. Not
  chosen: the owner made the token the only proof of who pushed.
- **Recorded:** `by` checked only as a written actor, not matched to the
  pusher (the plan's recommendation for GQ-3). Not chosen.

## Owning documents

- [Identity, agents and permissions](../identity.md): tokens, attribution and
  audit.
- [Architecture and operations](../architecture.md): the Git endpoint.
- [Agent integrations](../agent-integrations.md): the setup on a machine.

## Related open questions

None.

## History

- 2026-11-19: decided by the owner in conversation; proposed as this record in
  the Git-based catalog plan ([issue #161](https://github.com/guneet-xyz/shinan/issues/161)).
- 2026-11-19: accepted by the owner with the plan ([PR #162](https://github.com/guneet-xyz/shinan/pull/162),
  answers GQ-1 to GQ-6 [on issue #161](https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7007337638)).
- 2026-11-20: amended by [D-066](D-066-by-names-the-first-pusher.md) (the
  owner's refinement of GQ-3, [recorded on issue #161](https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7028895313)). Decision and
  Reasons unchanged; maintained sections updated.
