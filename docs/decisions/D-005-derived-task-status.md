---
id: D-005
title: Task status is calculated from linked work
status: accepted
date: 2026-11-16
decided_by: owner
evidence: https://github.com/guneet-xyz/shinan/issues/1
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-005: Task status is calculated from linked work

Status: **Accepted** by the owner on 2026-11-16, with the plan
([issue #1](https://github.com/guneet-xyz/shinan/issues/1),
[PR #2](https://github.com/guneet-xyz/shinan/pull/2)).

## Context

- The `workspace` repository's practice keeps no Markdown status mirror: issues
  and pull requests own state, and nothing copies it by hand
  ([`workspace` repository collaboration practice](https://git.guneet.dev/guneet/workspace/src/branch/main/docs/collaboration.md)).
- A task's work items live on git hosts ([D-001](D-001-above-git-hosts.md)) and
  already show whether they are open, in review or merged.

## Decision

Task status is calculated from linked work, not copied by hand.

## Reasons

Copied status goes stale; this matches the current workspace rule.

## Consequences

- **Decided:** a few states that only a person can set, such as "needs a
  person" (today's `human-effort` label), are set by hand
  ([plan, section 4](../plan.md#4-product-pillars)).
- **Proposed** (in the [domain model](../domain-model.md#task-status-task-flags-and-manual-states)):
  task status values `triage`, `to do`, `in progress`, `in review`, `done` and
  `cancelled`; task flags `needs a person`, `awaiting deployment approval`,
  `on hold` and `blocked` shown beside the status. Reason given there: they
  follow the `workspace` repository's flow while keeping flags separate.
- **Open, awaiting the owner** (raised by the
  [domain model](../domain-model.md#decisions-needed-from-the-owner)): whether
  to read this decision as "calculated from linked work plus recorded events"
  (acceptance, agent session attachment, verification). This log does not
  assume the outcome. If the owner agrees, it is recorded as a new record that
  amends this one (see [changing a decision](README.md#changing-a-decision)).
- **Decided:** status is only as current as Shinan's view of the git hosts, so
  it depends on webhooks and reconciliation
  ([plan, section 5](../plan.md#5-integration-points)).
- **Open, awaiting the owner** (raised by the domain model): whether agents may
  set and clear `needs a person`, which the plan reserves for people, and
  whether `awaiting deployment approval` becomes its own task flag.
- **Open:** how status is calculated with several `delivers` work links, or
  when a pull request is closed without merging. Owned by
  [tasks and work](../tasks.md).

## Alternatives considered

- **Status set and maintained by hand.** Rejected: copied status goes stale.

## Owning documents

- [Tasks and work](../tasks.md): status rules, task flags and manual states.
- [Git host integrations](../git-hosts.md): the events status is calculated
  from.

## Related open questions

- Reconciliation when webhooks are missed, and how freshness is shown
  ([plan, question 4](../plan.md#7-open-questions)).

## History

- Recorded as accepted ("agreed in conversation with the owner") in the first
  plan draft (commit `5c3330c`, 2026-11-16).
- Approved with the plan on 2026-11-16 (merge commit `248a2c5`).
