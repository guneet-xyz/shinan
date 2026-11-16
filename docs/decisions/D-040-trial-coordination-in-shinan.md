---
id: D-040
title: Cross-project coordination for trial projects moves into Shinan during the trial
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (O-73)"
supersedes: []
superseded_by: []
amends: [D-018]
amended_by: []
---

# D-040: Cross-project coordination for trial projects moves into Shinan during the trial

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 9](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6912465988):
O-73, not as recommended).

## Context

- [D-018](D-018-start-empty-migrate-later.md) says the `workspace` repository
  moves into Shinan only when Shinan is judged ready, and stays the source of
  truth until then.
- The roadmap recommended keeping coordination for trial projects in
  `workspace` repository issues, with a trial label and task IDs in branch
  names. In the same batch, O-74 (mon and easyshell keep repository issues in
  phase 1) was accepted as recommended.

## Decision

Cross-project coordination for trial projects moves into Shinan during the
trial, instead of staying in `workspace` repository issues. Repository issues
for mon and easyshell still stay (O-74).

## Reasons

Owner's choice; no reason recorded.

## Consequences

- **Decided:** for trial projects' cross-project coordination, Shinan is the
  home during the trial; the rest of the `workspace` repository stays the
  source of truth until the move.
- **Decided:** the `workspace` repository's collaboration rules need a note
  for trial projects at trial start, through a separate pull request in that
  repository (owner's answer).
- Details: see [roadmap and migration](../roadmap.md) and
  [tasks and work](../tasks.md).

## Alternatives considered

- **Recorded:** keep coordination for trial projects in `workspace`
  repository issues during the trial (O-73's recommendation). Not chosen.

## Owning documents

- [Roadmap and migration](../roadmap.md): the trial.
- [Tasks and work](../tasks.md): tasks for trial projects.

## Related open questions

- Proof-of-concept projects, readiness and the move
  ([plan, question 8](../plan.md#7-open-questions)).

## History

- 2026-11-16: accepted by the owner on issue #25. Recorded in the decision
  log's pull request as part of the issue #25 batch (see
  [README, history](README.md#history)).
