---
id: D-066
title: A fact check's by names the agent that first pushed the commit introducing it
status: accepted
date: 2026-11-20
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7028895313 (GQ-3, refined)"
supersedes: []
superseded_by: []
amends: [D-061]
amended_by: []
---

# D-066: A fact check's `by` names the agent that first pushed the commit introducing it

Status: **Accepted** by the owner on 2026-11-20, in conversation, refining
the answer GQ-3 to the [Git-based catalog plan](../build-plan-git-catalog.md#102-owner-answers-to-the-questions)
(recorded on [issue #161](https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7028895313)).

## Context

- [D-061](D-061-push-authentication-and-push-log.md) decided that a new or
  changed fact check's `by` must name the pusher (GQ-3, 2026-11-19). As
  designed, that refused a merge into `main` of another agent's branch that
  adds fact checks, because the fact checks name the agent that wrote them,
  not the one merging.
- Shinan's push log records, for every commit, the push that first brought
  it to Shinan, on any branch
  ([plan §2.6](../build-plan-git-catalog.md#26-the-push-log-and-events)).

## Decision

A new or changed fact check's `by` must name the agent (and its person) that
first pushed the commit introducing it, not whoever pushes to `main`. Shinan
knows the first pusher of each commit from the push log. So agent B may merge
agent A's already-pushed branch into `main`; A's fact checks must still name
A, and nobody can write another agent's name on a fact check in a commit they
push first.

## Reasons

Owner's choice; no reason recorded beyond the decision's own: another
agent's already-pushed work can be merged, while nobody can put another
agent's name on a fact check.

## Consequences

- This amends D-061's last sentence ("A new or changed fact check's `by`
  must name the pusher"); the rest of D-061 stands.
- The push log records each commit's first pusher
  (`catalog_commit_first_pushes`); pushes to any branch count; pushes to one
  repository are serialized; a commit that arrives on two branches in one
  push names that push; commits Shinan makes (a repository's first commit,
  the migration's first commit) are first pushed by `shinan`; commits a
  purge rewrites inherit the first pusher of the commits they replace. Which
  commit introduces a fact check, and why a revert does not, are defined in
  the [plan §2.5, check 6](../build-plan-git-catalog.md#25-checks-on-push),
  built by GC-3 ([#165](https://github.com/guneet-xyz/shinan/issues/165)).
- **Decided (owner, 2026-11-20, [recorded on issue #161](https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7029076422)):**
  `git revert` may restore another agent's fact check exactly as it was on
  `main` before, and it keeps its original first pusher; restoring is not
  introducing ([plan §2.5, check 6](../build-plan-git-catalog.md#25-checks-on-push)).
- Rebasing, cherry-picking or squashing another agent's commits that add
  fact checks makes new commits first pushed by the agent doing it, so such
  a push is refused; the skill says so (GC-9).

## Alternatives considered

- **Recorded:** `by` must name the pusher to `main` (D-061 as accepted on
  2026-11-19). Replaced by this refinement.
- **Recorded:** `by` checked only as a written actor (the plan's first
  recommendation for GQ-3). Not chosen.

## Owning documents

- [Git-based catalog plan](../build-plan-git-catalog.md) §2.5, §2.6; then the
  [catalog](../catalog.md) §4.5, §8 and [identity](../identity.md) §8.7, §11.

## Related open questions

None.

## History

- 2026-11-20: decided by the owner in conversation; recorded with the plan's
  updates ([#165](https://github.com/guneet-xyz/shinan/issues/165)).
- 2026-11-20: the owner confirmed that a revert restoring another agent's
  fact check exactly as it was on `main` keeps its original first pusher
  ([recorded on issue #161](https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7029076422)). Decision and Reasons unchanged;
  Consequences updated.
