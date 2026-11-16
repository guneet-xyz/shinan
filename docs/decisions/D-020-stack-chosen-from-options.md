---
id: D-020
title: The technology stack is chosen by the owner from options with trade-offs
status: accepted
date: 2026-11-16
decided_by: owner
evidence: https://github.com/guneet-xyz/shinan/issues/1
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-020: The technology stack is chosen by the owner from options with trade-offs

Status: **Accepted** by the owner on 2026-11-16, with the plan
([issue #1](https://github.com/guneet-xyz/shinan/issues/1),
[PR #2](https://github.com/guneet-xyz/shinan/pull/2)).

## Context

- Shinan has no application code yet ([AGENTS.md](../../AGENTS.md)).
- The architecture document owns technology stack options, storage and sync
  ([plan, section 8](../plan.md#8-documents-to-write-next)).

## Decision

The technology stack is chosen from options that the architecture document
proposes, with trade-offs, for the owner to decide.

## Reasons

The owner has no fixed preference; options with reasons give a better decision
than a single pick.

## Consequences

- **Decided:** the architecture document presents several stack options with
  their trade-offs, and the owner makes the choice.
- **Open:** the options themselves, storage, and how the catalog's Markdown and
  its agent index stay in sync ([plan, question 1](../plan.md#7-open-questions)).
  Owned by [architecture and operations](../architecture.md). Recording the
  owner's choice follows the decision log's
  [process for new decisions](README.md#how-documents-propose-new-decisions).

## Alternatives considered

- **Implied** by the reasons (not recorded as discussed): the architecture
  document picks a single stack. The first plan draft listed the stack only as
  an open question (commit `5c3330c`).

## Owning documents

- [Architecture and operations](../architecture.md): stack options and
  trade-offs.

## Related open questions

- Technology stack, storage and sync
  ([plan, question 1](../plan.md#7-open-questions)).

## History

- First plan draft: "Technology stack, storage and how the catalog's Markdown
  and its index stay in sync" was an open question (commit `5c3330c`,
  2026-11-16).
- Recorded as accepted from the owner's answers (commit `e46c560`, 2026-11-16)
  and approved with the plan on 2026-11-16 (merge commit `248a2c5`).
