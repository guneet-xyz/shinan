---
id: D-053
title: Deployment approval requests and answers are always recorded as task events
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/26 (NO-4)"
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-053: Deployment approval requests and answers are always recorded as task events

Status: **Accepted** by the owner on 2026-11-16
([issue #26](https://github.com/guneet-xyz/shinan/issues/26#issuecomment-6918513933):
NO-4 accepted as recommended).

## Context

- Every deployment of `shinan.guneet.dev` needs the owner's approval
  ([D-016](D-016-musashi-and-deployment-approval.md)); approval is given in
  Shinan, or in the conversation and recorded by the agent (O-20).
- Task flags are managed per workspace, and built-in flags such as
  `awaiting deployment approval` are defaults that can be removed
  ([D-028](D-028-task-flags.md)).
- The integration review (I-18) found that tasks and work concluded that
  removing the flag removes the record of deployment approvals in Shinan.

## Decision

Deployment approval requests and answers are always recorded as task events,
whether or not the `awaiting deployment approval` flag exists. The flag can be
removed like any other.

## Reasons

Owner's choice; no reason recorded.

## Consequences

- **Decided:** removing the flag does not remove the record of approval
  requests and answers.
- Details: see [tasks and work](../tasks.md),
  [identity, agents and permissions](../identity.md) and
  [agent integrations](../agent-integrations.md).

## Alternatives considered

- **Recorded:** make the built-in `awaiting deployment approval` flag
  impossible to remove (the review's second option). Not chosen.

## Owning documents

- [Tasks and work](../tasks.md): task flags and events.
- [Agent integrations](../agent-integrations.md): recording an approval given
  in the conversation.

## Related open questions

None.

## History

- 2026-11-16: accepted by the owner on issue #26 (integration review). Recorded
  in the decision log's integration-fix pull request (see
  [README, history](README.md#history)).
