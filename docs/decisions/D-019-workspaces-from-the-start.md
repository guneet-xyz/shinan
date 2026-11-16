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
amended_by: [D-036]
---

# D-019: One user at first, but workspaces and invitations are designed in from the start

Status: **Accepted** by the owner on 2026-11-16, with the plan
([issue #1](https://github.com/guneet-xyz/shinan/issues/1),
[PR #2](https://github.com/guneet-xyz/shinan/pull/2)).
Amended by [D-036](D-036-design-now-build-before-second-member.md).

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
- **Decided (owner, [D-036](D-036-design-now-build-before-second-member.md)):**
  this decision means "design now, build before the second member".
- **Decided (owner, [D-023](D-023-workspace-wide-visibility-no-secrets.md)):**
  every member sees everything in a workspace, including private repository
  work (plan question 3).
- **Decided (owner, [D-034](D-034-sign-in-and-accounts.md)):** an email
  allowlist decides who can have an account; joining a workspace needs an
  invitation.

## Alternatives considered

- **Recorded:** single-user first, multi-user added later. The first plan draft
  listed only the owner as the current user, with no workspaces or invitations
  (commit `5c3330c`). Replaced by this decision for the reasons above.

## Owning documents

- [Identity, agents and permissions](../identity.md): workspaces, members,
  invitations and access rules.
- [Human experience](../human-experience.md): workspace and member management.

## Related open questions

- Plan question 3 (private repositories) is answered for now by
  [D-023](D-023-workspace-wide-visibility-no-secrets.md).

## History

- First plan draft: "Now: us", with no mention of workspaces or invitations
  (commit `5c3330c`, 2026-11-16).
- Recorded as accepted from the owner's answers (commit `e46c560`, 2026-11-16)
  and approved with the plan on 2026-11-16 (merge commit `248a2c5`).
- 2026-11-16: amended by [D-036](D-036-design-now-build-before-second-member.md) (owner answers on [issue #25](https://github.com/guneet-xyz/shinan/issues/25)). Decision and Reasons unchanged; maintained sections updated.
