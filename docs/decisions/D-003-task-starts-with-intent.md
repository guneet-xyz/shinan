---
id: D-003
title: A task starts where the intent starts; outside issues become tasks automatically
status: accepted
date: 2026-11-16
decided_by: owner
evidence: https://github.com/guneet-xyz/shinan/issues/1
supersedes: []
superseded_by: []
amends: []
amended_by: [D-051]
---

# D-003: A task starts where the intent starts; outside issues become tasks automatically

Status: **Accepted** by the owner on 2026-11-16, with the plan
([issue #1](https://github.com/guneet-xyz/shinan/issues/1),
[PR #2](https://github.com/guneet-xyz/shinan/pull/2)).
Amended by [D-051](D-051-new-issues-setting.md).

## Context

- A task is the story of a piece of work from intent to verified outcome
  ([plan, section 1](../plan.md#1-what-shinan-is)).
- Outside issues are issues opened directly on a git host, for example by a
  user of a public project ([domain model](../domain-model.md#outside-issue)).

## Decision

A task starts where the intent starts, not where the code lands. Outside issues
become tasks automatically.

## Reasons

Every story needs one home, even when its first chapter was written elsewhere.

## Consequences

- **Decided:** outside issues become tasks without anyone creating them by
  hand.
- **Decided (owner, [D-051](D-051-new-issues-setting.md)):** only in
  repositories whose "turn new issues into tasks" setting is on; it is on by
  default and off for shared repositories.
- **Decided:** a triage inbox is part of phase 2
  ([plan, section 10](../plan.md#10-phases-after-the-documents)).
- Proposed refinements: see the domain model's
  [outside issue](../domain-model.md#outside-issue) and
  [task status](../domain-model.md#task-status-task-flags-and-manual-states)
  entries.
- **Open:** which repositories' issues become tasks, and how noise is handled.
  Owned by [tasks and work](../tasks.md) and
  [git host integrations](../git-hosts.md).

## Alternatives considered

- **Implied** by the wording (not recorded as discussed): start the task where
  the code lands.

## Owning documents

- [Tasks and work](../tasks.md): task origin, triage and the triage inbox.
- [Git host integrations](../git-hosts.md): detecting new outside issues.
- [Human experience](../human-experience.md): the triage inbox screen.

## Related open questions

None in the plan.

## History

- Recorded as accepted ("agreed in conversation with the owner") in the first
  plan draft (commit `5c3330c`, 2026-11-16).
- Approved with the plan on 2026-11-16 (merge commit `248a2c5`).
- 2026-11-16: amended by [D-051](D-051-new-issues-setting.md) (owner answer NO-2 on [issue #26](https://github.com/guneet-xyz/shinan/issues/26#issuecomment-6918513933)). Decision and Reasons unchanged; maintained sections updated.
