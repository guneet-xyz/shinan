---
id: D-060
title: Catalog changes need no approval; Shinan's checks on push are the only gate
status: accepted
date: 2026-11-19
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7007337638"
supersedes: [D-024]
superseded_by: []
amends: []
amended_by: []
---

# D-060: Catalog changes need no approval; Shinan's checks on push are the only gate

Status: **Accepted** by the owner on 2026-11-19, in conversation, with the
[Git-based catalog plan](../build-plan-git-catalog.md) ("Approve and start";
recorded on [issue #161](https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7007337638)).

## Context

- [D-024](D-024-gated-catalog-approval.md) made gated classes of catalog
  change need a person's catalog approval, with a strict setting as the
  remedy when accuracy slips, and let the only member approve their own
  agents' proposals.
- M2 built approval classes, the strict setting, bulk approval, comments and
  revert by proposal ([catalog §8.2](../catalog.md#82-no-catalog-approval)).
- The plan's Catalog pillar says "Agents propose changes; people approve where
  needed" ([plan §4](../plan.md#4-product-pillars)).
- With the catalog in Git ([D-059](D-059-catalog-in-git-hosted-by-shinan.md)),
  agents push changes themselves.

## Decision

There are no human approvals for catalog changes. On every push, to any
branch, Shinan checks for secret-looking values; on pushes to `main` it also
runs full validation. Blocking problems refuse the push, with the reason
shown in `git push`'s output; warnings do not block. Undo is `git revert`.

## Reasons

Owner's choice; no reason recorded. The checks on push and undo by revert
were proposed by the coordinating agent and agreed by the owner
([issue #161](https://github.com/guneet-xyz/shinan/issues/161)).

## Consequences

- Catalog proposals, approval classes, the strict setting, bulk approval,
  comments on proposals and revert by proposal are removed
  ([plan §1.2](../build-plan-git-catalog.md#12-what-is-removed-from-m2)).
- D-024's remedy ("switch to strict approval if accuracy slips") no longer
  exists; the roadmap's R6 keeps measuring accuracy
  ([roadmap §5](../roadmap.md#5-readiness-criteria)).
- Rules that relied on a person's approval (accepting a discrepancy, changing
  the start-here document, owner answers O-3, O-18's approval part, O-46,
  M2-Q7, M2-Q8, M2-Q13) lapse; the checks on push are proposed in the
  [plan §2.5](../build-plan-git-catalog.md#25-checks-on-push).
- **Decided (owner, GQ-2, [plan §10.2](../build-plan-git-catalog.md#102-owner-answers-to-the-questions)):** a workspace owner can allow
  one exact value as "not a secret" in workspace settings, stored as its
  hash and recorded in the security log, so a false positive of the secret
  check does not block a correct push.
- **Decided (owner, GQ-6):** review after the fact is `main`'s commit
  history, with the pusher beside each commit
  ([D-064](D-064-catalog-not-wiki.md)).

## Alternatives considered

- **Recorded:** gated catalog approval with a strict setting
  ([D-024](D-024-gated-catalog-approval.md), as built in M2). Replaced.
- **Implied:** protected `main` with merge requests reviewed by people.
  Excluded by "no human approvals".

## Owning documents

- [Catalog](../catalog.md): changing the catalog and validation.
- [Roadmap and migration](../roadmap.md): trial measures.

## Related open questions

None.

## History

- 2026-11-19: decided by the owner in conversation; proposed as this record in
  the Git-based catalog plan ([issue #161](https://github.com/guneet-xyz/shinan/issues/161)).
- 2026-11-19: accepted by the owner with the plan ([PR #162](https://github.com/guneet-xyz/shinan/pull/162),
  answers GQ-1 to GQ-6 [on issue #161](https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7007337638)).
