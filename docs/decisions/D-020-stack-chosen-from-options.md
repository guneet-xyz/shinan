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
- **Decided (owner, [D-037](D-037-typescript-node-react.md)):** TypeScript, a
  plain Node.js server and a React single-page app. Storage is PostgreSQL
  ([D-022](D-022-catalog-storage-and-git-mirror.md)).

## Alternatives considered

- **Implied** by the reasons (not recorded as discussed): the architecture
  document picks a single stack. The first plan draft listed the stack only as
  an open question (commit `5c3330c`).

## Owning documents

- [Architecture and operations](../architecture.md): stack options and
  trade-offs.

## Related open questions

- How the catalog's Markdown and its agent index stay in sync
  ([plan, question 1](../plan.md#7-open-questions)); stack and storage are
  answered by [D-037](D-037-typescript-node-react.md) and
  [D-022](D-022-catalog-storage-and-git-mirror.md).

## History

- First plan draft: "Technology stack, storage and how the catalog's Markdown
  and its index stay in sync" was an open question (commit `5c3330c`,
  2026-11-16).
- Recorded as accepted from the owner's answers (commit `e46c560`, 2026-11-16)
  and approved with the plan on 2026-11-16 (merge commit `248a2c5`).
- 2026-11-16: related decisions [D-037](D-037-typescript-node-react.md) recorded from [issue #25](https://github.com/guneet-xyz/shinan/issues/25); maintained sections updated.
