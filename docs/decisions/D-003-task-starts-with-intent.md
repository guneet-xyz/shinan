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
amended_by: []
---

# D-003: A task starts where the intent starts; outside issues become tasks automatically

Status: **Accepted** by the owner on 2026-11-16, with the plan
([issue #1](https://github.com/guneet-xyz/shinan/issues/1),
[PR #2](https://github.com/guneet-xyz/shinan/pull/2)).

## Context

- Intent for a piece of work can start in Shinan, in a conversation, or in an
  issue someone opens directly on a git host, such as a user of a public
  project (an outside issue, see the
  [domain model](../domain-model.md#outside-issue)).
- A task is the story of a piece of work from intent to verified outcome
  ([D-002](D-002-host-neutral-task-id.md)).

## Decision

A task starts where the intent starts, not where the code lands. Outside issues
become tasks automatically.

## Reasons

Every story needs one home, even when its first chapter was written elsewhere.

## Consequences

- **Decided:** outside issues become tasks without anyone creating them by
  hand.
- **Decided:** a triage inbox lists such tasks; it is part of phase 2
  ([plan, section 10](../plan.md#10-phases-after-the-documents)).
- **Proposed** (in the [domain model](../domain-model.md#task-status-task-flags-and-manual-states)):
  the new task starts in `triage`, keeps a work link with role `origin` to the
  outside issue, and leaves triage only when a person accepts or cancels it.
  Reason: automatically created tasks have not been agreed to by anyone yet.
- **Open:** which repositories' issues are turned into tasks, and how noise
  such as spam or duplicates is handled. Owned by [tasks and work](../tasks.md)
  and [git host integrations](../git-hosts.md).

## Alternatives considered

- **Start the task where the code lands** (tie it to the repository that
  receives the change). Rejected by the decision's wording: intent often
  starts somewhere else, and the story would then be split.
- Other alternatives, such as importing outside issues only by hand: not
  recorded.

## Owning documents

- [Tasks and work](../tasks.md): task origin, triage and the triage inbox.
- [Git host integrations](../git-hosts.md): detecting new outside issues.
- [Human experience](../human-experience.md): the triage inbox screen.

## Related open questions

None in the plan beyond those listed above.

## History

- Recorded as accepted ("agreed in conversation with the owner") in the first
  plan draft (commit `5c3330c`, 2026-11-16).
- Approved with the plan on 2026-11-16 (merge commit `248a2c5`).
