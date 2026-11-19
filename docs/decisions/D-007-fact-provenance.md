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
  verified, what was checked and where the evidence came from
  (`last_verified`, `verification_scope`, `verification_source`)
  ([`workspace` repository maintenance practice](https://git.guneet.dev/guneet/workspace/src/branch/main/docs/maintenance.md)).
- Agents keep the catalog accurate as part of their work
  ([plan, section 1](../plan.md#1-what-shinan-is)).

## Decision

Every catalog fact records its state, source and last-checked time.

## Reasons

Trust in the catalog is the main differentiator.

## Consequences

- **Decided (owner, 2026-11-19, [D-061](D-061-push-authentication-and-push-log.md)):** fact checks are written by agents in the text and pushed; a new or changed fact check's `by` must name the pusher.
- **Decided:** fact states are intended, observed, proposed and unknown
  ([plan, section 4](../plan.md#4-product-pillars)).
- **Decided:** every fact shows how fresh it is and where it came from
  ([plan, section 1](../plan.md#1-what-shinan-is)).
- Proposed refinements: see the domain model's [fact](../domain-model.md#fact),
  [fact state](../domain-model.md#fact-state) and
  [fact check, source and freshness](../domain-model.md#fact-check-source-and-freshness)
  entries.
- **Decided (owner, [D-025](D-025-fact-state-planned.md)):** the fact state
  `proposed` is renamed `planned`.
- **Open:** how freshness is shown ([plan, question 4](../plan.md#7-open-questions)).
  Owned by [human experience](../human-experience.md).

## Alternatives considered

- **Not recorded.**

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
- 2026-11-16: related decisions [D-025](D-025-fact-state-planned.md) recorded from [issue #25](https://github.com/guneet-xyz/shinan/issues/25); maintained sections updated.
- 2026-11-16: fixed the link to the glossary's "Fact check, source and freshness" section (integration review I-60, [issue #26](https://github.com/guneet-xyz/shinan/issues/26)).
- 2026-11-19: related decisions D-059 to D-065 recorded ([Git-based catalog plan](../build-plan-git-catalog.md), accepted by the owner, [issue #161](https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7007337638)). Decision and Reasons unchanged; maintained sections updated.
