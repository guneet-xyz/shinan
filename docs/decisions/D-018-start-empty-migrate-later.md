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
amended_by: []
---

# D-018: Shinan starts empty; the `workspace` repository moves over only when Shinan is ready

Status: **Accepted** by the owner on 2026-11-16, with the plan
([issue #1](https://github.com/guneet-xyz/shinan/issues/1),
[PR #2](https://github.com/guneet-xyz/shinan/pull/2)).

## Context

- Today the `workspace` repository holds the owner's hand-made catalog and its
  cross-project coordination issues. Shinan is meant to replace both
  ([plan, section 1](../plan.md#1-what-shinan-is)).
- The `workspace` repository is a Git repository; a Shinan workspace is a
  different thing ([domain model](../domain-model.md#two-meanings-of-workspace)).

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
- **Decided:** where a fact appears both in Shinan and in the `workspace`
  repository before the move, the `workspace` repository is the one to trust.
- **Open:** which projects the proof of concept uses, what counts as "ready",
  and how the `workspace` repository is then moved over
  ([plan, question 8](../plan.md#7-open-questions)). Owned by
  [roadmap and migration](../roadmap.md).
- **Proposed** (in the [domain model](../domain-model.md#two-meanings-of-workspace)):
  strict naming to keep the `workspace` repository and a Shinan workspace
  apart. Reason given there: both will be discussed side by side until the
  move.

## Alternatives considered

- **Move the `workspace` repository into Shinan from the start.** The first
  plan draft said only that Shinan "should replace the `workspace` repository's
  catalog and its cross-project coordination issues", without a trial. Replaced
  by this decision: a small trial limits risk and avoids two sources of truth
  while Shinan changes quickly.

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
