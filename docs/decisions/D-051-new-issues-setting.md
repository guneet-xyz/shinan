---
id: D-051
title: Each repository has a "turn new issues into tasks" setting, on by default
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/26 (NO-2)"
supersedes: []
superseded_by: []
amends: [D-003]
amended_by: []
---

# D-051: Each repository has a "turn new issues into tasks" setting, on by default

Status: **Accepted** by the owner on 2026-11-16
([issue #26](https://github.com/guneet-xyz/shinan/issues/26#issuecomment-6918513933):
NO-2 accepted as recommended).

## Context

- [D-003](D-003-task-starts-with-intent.md) says outside issues become tasks
  automatically.
- Git host integrations and the roadmap proposed turning this off for shared
  repositories such as `infra/musashi`, `infra/anzen`, `guneet/terraform` and
  the `workspace` repository. The integration review (I-15, I-58) noted that
  this narrows D-003. Its recommendation gave this reason: without it, every
  unrelated rollout issue in a shared repository becomes a task.

## Decision

Each repository has a "turn new issues into tasks" setting. It is on by
default and turned off for shared repositories. Git host integrations holds the
setting; tasks and work defines what it does. Markers and mentions in
repositories with the setting off are still read.

## Reasons

Owner's choice; no reason recorded.

## Consequences

- **Decided:** D-003's automatic tasks from outside issues apply only where
  the setting is on.
- Details: see [tasks and work](../tasks.md),
  [git host integrations](../git-hosts.md) and
  [roadmap and migration](../roadmap.md).

## Alternatives considered

- **Implied** by the wording (not recorded as discussed): every outside issue
  in every connected repository becomes a task, as D-003 alone says.

## Owning documents

- [Tasks and work](../tasks.md): what the setting does.
- [Git host integrations](../git-hosts.md): where the setting is held.
- [Roadmap and migration](../roadmap.md): which trial repositories turn it off.

## Related open questions

None.

## History

- 2026-11-16: accepted by the owner on issue #26 (integration review). Recorded
  in the decision log's integration-fix pull request (see
  [README, history](README.md#history)).
