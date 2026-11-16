---
id: D-007
title: Every fact records its fact state, source and last-checked time
status: accepted
date: 2026-11-16
decided_by: owner
evidence: https://github.com/guneet-xyz/shinan/issues/1
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-007: Every fact records its fact state, source and last-checked time

Status: **Accepted** by the owner on 2026-11-16, with the plan
([issue #1](https://github.com/guneet-xyz/shinan/issues/1),
[PR #2](https://github.com/guneet-xyz/shinan/pull/2)).

## Context

- The `workspace` repository's catalog records, per page, when it was last
  verified, what exactly was checked and where the evidence came from
  (`last_verified`, `verification_scope`, `verification_source`)
  ([`workspace` repository maintenance practice](https://git.guneet.dev/guneet/workspace/src/branch/main/docs/maintenance.md)).
- Agents keep the catalog accurate as part of their work
  ([plan, section 1](../plan.md#1-what-shinan-is)), so readers need to see how
  far to trust each fact.

## Decision

Every catalog fact records its state, source and last-checked time.

## Reasons

Trust in the catalog is the main differentiator.

## Consequences

- **Decided:** fact states are intended, observed, proposed and unknown
  ([plan, section 4](../plan.md#4-product-pillars)).
- **Decided:** every fact shows how fresh it is and where it came from
  ([plan, section 1](../plan.md#1-what-shinan-is)).
- **Proposed** (in the [domain model](../domain-model.md#source-and-last-checked)):
  "last checked" means a real check against the source, not an edit, and
  checking one fact does not refresh others. Reason given there: it is the
  `workspace` repository's working rule.
- **Proposed** (in the [domain model](../domain-model.md#attribution)): the same
  idea is applied to attribution, which records how sure Shinan is about who
  did something. Reason given there: consistency with this decision.
- **Open:** the unit a fact is made of (for example a structured field or a
  marked statement). The [domain model](../domain-model.md#fact) proposes that a
  fact is the smallest unit carrying its own state, source and last-checked
  time, and leaves the unit to the [catalog](../catalog.md).
- **Open, awaiting the owner** (raised by the
  [domain model](../domain-model.md#decisions-needed-from-the-owner)): whether
  the fact state `proposed` is renamed `planned`, to avoid confusion with
  catalog proposals. The fact state names are part of the approved plan, so a
  rename would be recorded as a new record.
- **Open:** how freshness is shown ([plan, question 4](../plan.md#7-open-questions)).
  Owned by [human experience](../human-experience.md).

## Alternatives considered

Not recorded. (The `workspace` repository records checks per page rather than
per fact; whether Shinan follows that is the open question above, not a
rejected alternative.)

## Owning documents

- [Catalog](../catalog.md): fact states, provenance and approval.
- [Human experience](../human-experience.md): how freshness is shown.

## Related open questions

- Reconciliation and how freshness is shown
  ([plan, question 4](../plan.md#7-open-questions)).
- Catalog schema ([plan, question 5](../plan.md#7-open-questions)).

## History

- Recorded as accepted ("agreed in conversation with the owner") in the first
  plan draft (commit `5c3330c`, 2026-11-16).
- Approved with the plan on 2026-11-16 (merge commit `248a2c5`).
