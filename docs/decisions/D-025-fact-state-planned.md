---
id: D-025
title: The fact state proposed is renamed planned
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (O-5)"
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-025: The fact state `proposed` is renamed `planned`

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 2](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6911197912):
O-5 accepted as recommended).

## Context

- The plan names the fact states intended, observed, proposed and unknown
  ([plan, section 4](../plan.md#4-product-pillars)); facts carry them under
  [D-007](D-007-fact-provenance.md).
- This changes plan text that has no decision ID, so it gets a record under
  the rule accepted in O-98 ([README](README.md#relationship-to-the-plan)).
- The recommending documents (glossary, catalog) gave this reason: it avoids
  clashing with "catalog proposal" and with the "proposed" status in
  documents.

## Decision

The fact state `proposed` is renamed `planned`. The fact states are
`intended`, `observed`, `planned` and `unknown`.

## Reasons

Owner's choice; no reason recorded.

## Consequences

- **Decided:** documents use `planned` for this fact state.
- Meaning of the state: see the [catalog](../catalog.md) and the
  [domain model](../domain-model.md#fact-state).

## Alternatives considered

- **Recorded:** keep the plan's name `proposed`. Not chosen.

## Owning documents

- [Catalog](../catalog.md): fact states.
- [Domain model and glossary](../domain-model.md): the term.

## Related open questions

None.

## History

- 2026-11-16: accepted by the owner on issue #25. Recorded in the decision
  log's pull request as part of the issue #25 batch (see
  [README, history](README.md#history)).
