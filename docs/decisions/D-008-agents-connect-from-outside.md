---
id: D-008
title: Agents connect from outside; Shinan runs no model in the first phases
status: accepted
date: 2026-11-16
decided_by: owner
evidence: https://github.com/guneet-xyz/shinan/issues/1
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-008: Agents connect from outside; Shinan runs no model in the first phases

Status: **Accepted** by the owner on 2026-11-16, with the plan
([issue #1](https://github.com/guneet-xyz/shinan/issues/1),
[PR #2](https://github.com/guneet-xyz/shinan/pull/2)).

## Context

- People already use their own coding tools, such as OpenCode, Claude Code and
  Codex ([plan, section 1](../plan.md#1-what-shinan-is)).
- How agents connect is decided separately in
  [D-014](D-014-three-connection-levels.md).

## Decision

Agents connect from outside; Shinan runs no model in the first phases.

## Reasons

Users already pay for and choose their agents; hosting agents is costly and
offers little advantage early.

## Consequences

- **Decided:** Shinan does not run models or host agents, at least until a
  later phase ([plan, section 3](../plan.md#3-what-shinan-does-not-do)).
- Proposed refinements: see the domain model's
  [coding tool](../domain-model.md#coding-tool) and
  [agent](../domain-model.md#agent) entries.
- **Open:** whether phase 3, "Agents run by Shinan", changes this decision
  ([plan, section 10](../plan.md#10-phases-after-the-documents)). In the plan,
  phase 3 starts agent sessions from the website through a launcher on each
  machine ([D-014](D-014-three-connection-levels.md)). Owned by
  [roadmap and migration](../roadmap.md).

## Alternatives considered

- **Implied** by the reasons (not recorded as discussed): Shinan runs models
  and hosts agents itself.

## Owning documents

- [Agent integrations](../agent-integrations.md): how agents connect.
- [Product overview](../product-overview.md): scope and non-goals.
- [Roadmap and migration](../roadmap.md): what later phases may change.

## Related open questions

- How far coding tools other than OpenCode can receive messages in a running
  agent session ([plan, question 9](../plan.md#7-open-questions)).

## History

- Recorded as accepted in the first plan draft (commit `5c3330c`, 2026-11-16)
  as "Agents connect from outside through MCP and a skill; Shinan runs no model
  in the first phases."
- Narrowed to its current wording when the owner's answers were recorded
  (commit `e46c560`), because how agents connect moved to
  [D-014](D-014-three-connection-levels.md).
- Approved with the plan on 2026-11-16 (merge commit `248a2c5`).
