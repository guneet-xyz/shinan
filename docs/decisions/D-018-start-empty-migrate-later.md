---
id: D-018
title: Shinan starts empty; the workspace repository moves over only when Shinan is ready
status: accepted
date: 2026-11-16
decided_by: owner
evidence: https://github.com/guneet-xyz/shinan/issues/1
supersedes: []
superseded_by: []
amends: []
amended_by: [D-040]
---

# D-018: Shinan starts empty; the `workspace` repository moves over only when Shinan is ready

Status: **Accepted** by the owner on 2026-11-16, with the plan
([issue #1](https://github.com/guneet-xyz/shinan/issues/1),
[PR #2](https://github.com/guneet-xyz/shinan/pull/2)).
Amended by [D-040](D-040-trial-coordination-in-shinan.md).

## Context

- The `workspace` repository holds the owner's hand-made catalog and its
  cross-project coordination issues; Shinan is meant to replace both
  ([plan, section 1](../plan.md#1-what-shinan-is)).
- The `workspace` repository and a Shinan workspace are different things
  ([domain model](../domain-model.md#two-meanings-of-workspace)).

## Decision

Shinan starts empty. It is tried on a few projects first; the `workspace`
repository moves over only when Shinan is judged ready, and stays the source of
truth until then.

## Reasons

Testing on a small scope limits risk and avoids two sources of truth during
early changes.

## Consequences

- **Decided:** phase 1 is a proof of concept on a few projects while the
  `workspace` repository stays the source of truth; the move happens in phase 2
  once Shinan is judged ready
  ([plan, section 10](../plan.md#10-phases-after-the-documents)).
- Proposed refinements: see the domain model's
  [naming rule](../domain-model.md#two-meanings-of-workspace) and
  [supporting terms](../domain-model.md#supporting-terms) ("migration",
  "source of truth").
- **Decided (owner, [D-040](D-040-trial-coordination-in-shinan.md)):**
  cross-project coordination for trial projects moves into Shinan during the
  trial.
- **Open:** which projects the proof of concept uses, what counts as "ready",
  and how the `workspace` repository is then moved over
  ([plan, question 8](../plan.md#7-open-questions)). Owned by
  [roadmap and migration](../roadmap.md).

## Alternatives considered

- **Recorded:** move the `workspace` repository into Shinan without a trial.
  The first plan draft said only that Shinan "should replace the `workspace`
  repository's catalog and its cross-project coordination issues" (commit
  `5c3330c`). Replaced by this decision for the reasons above.

## Owning documents

- [Roadmap and migration](../roadmap.md): proof-of-concept projects, readiness
  criteria and the move.
- [Product overview](../product-overview.md): first user and rollout.

## Related open questions

- Proof-of-concept projects, readiness and the move
  ([plan, question 8](../plan.md#7-open-questions)).

## History

- First plan draft: Shinan to replace the `workspace` repository's catalog and
  coordination issues, with no staging (commit `5c3330c`, 2026-11-16).
- Recorded as accepted from the owner's answers (commit `e46c560`, 2026-11-16)
  and approved with the plan on 2026-11-16 (merge commit `248a2c5`).
- 2026-11-16: amended by [D-040](D-040-trial-coordination-in-shinan.md) (owner answers on [issue #25](https://github.com/guneet-xyz/shinan/issues/25)). Decision and Reasons unchanged; maintained sections updated.
