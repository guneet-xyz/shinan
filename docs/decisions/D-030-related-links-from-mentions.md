---
id: D-030
title: Members' mentions of a task ID in git host comments create a related link
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (O-25)"
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-030: Members' mentions of a task ID in git host comments create a `related` link

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 4](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6911557353):
O-25, not as recommended).

## Context

- Work on git hosts is linked to tasks by task ID
  ([D-002](D-002-host-neutral-task-id.md)).
- Tasks and work recommended that git host comments create no links.

## Decision

When a workspace member mentions a task ID in a git host comment, Shinan
creates a `related` link to that task. It is shown on the task page and never
affects task status. Mentions by accounts outside the workspace are ignored.

## Reasons

Owner's choice; no reason recorded.

## Consequences

- How members' accounts are recognised and how links are shown: see
  [tasks and work](../tasks.md) and [git host integrations](../git-hosts.md).

## Alternatives considered

- **Recorded:** no links from git host comments (O-25's recommendation). Not
  chosen.

## Owning documents

- [Tasks and work](../tasks.md): link roles.
- [Git host integrations](../git-hosts.md): reading comments.

## Related open questions

None.

## History

- 2026-11-16: accepted by the owner on issue #25. Recorded in the decision
  log's pull request as part of the issue #25 batch (see
  [README, history](README.md#history)).
