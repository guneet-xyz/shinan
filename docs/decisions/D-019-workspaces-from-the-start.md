---
id: D-019
title: One user at first, but workspaces and invitations are designed in from the start
status: accepted
date: 2026-11-16
decided_by: owner
evidence: https://github.com/guneet-xyz/shinan/issues/1
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-019: One user at first, but workspaces and invitations are designed in from the start

Status: **Accepted** by the owner on 2026-11-16, with the plan
([issue #1](https://github.com/guneet-xyz/shinan/issues/1),
[PR #2](https://github.com/guneet-xyz/shinan/pull/2)).

## Context

- The first user is the owner alone, with several agents; small teams are a
  possible later audience ([plan, section 2](../plan.md#2-who-it-is-for)).

## Decision

One user at first, but workspaces and invitations are part of the design from
the start.

## Reasons

Adding multi-user support later would mean reworking data, permissions and
sign-in.

## Consequences

- **Decided:** a workspace holds a team's catalog, tasks, connections to git
  hosts and members, and people are invited to it
  ([plan, section 4](../plan.md#4-product-pillars)).
- **Decided:** identity covers sign-in, workspace membership and invitations
  ([plan, section 5](../plan.md#5-integration-points)).
- Proposed refinements: see the domain model's
  [workspace](../domain-model.md#workspace),
  [member and role](../domain-model.md#member-and-role) and
  [invitation](../domain-model.md#invitation) entries.
- **Open:** permissions when a member can see a task but not a private
  repository it links to ([plan, question 3](../plan.md#7-open-questions)).
  Owned by [identity, agents and permissions](../identity.md).

## Alternatives considered

- **Recorded:** single-user first, multi-user added later. The first plan draft
  listed only the owner as the current user, with no workspaces or invitations
  (commit `5c3330c`). Replaced by this decision for the reasons above.

## Owning documents

- [Identity, agents and permissions](../identity.md): workspaces, members,
  invitations and access rules.
- [Human experience](../human-experience.md): workspace and member management.

## Related open questions

- Permissions for private repositories
  ([plan, question 3](../plan.md#7-open-questions)).

## History

- First plan draft: "Now: us", with no mention of workspaces or invitations
  (commit `5c3330c`, 2026-11-16).
- Recorded as accepted from the owner's answers (commit `e46c560`, 2026-11-16)
  and approved with the plan on 2026-11-16 (merge commit `248a2c5`).
