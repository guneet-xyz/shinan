---
id: D-015
title: The web app is on the public internet and requires sign-in
status: accepted
date: 2026-11-16
decided_by: owner
evidence: https://github.com/guneet-xyz/shinan/issues/1
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-015: The web app is on the public internet and requires sign-in

Status: **Accepted** by the owner on 2026-11-16, with the plan
([issue #1](https://github.com/guneet-xyz/shinan/issues/1),
[PR #2](https://github.com/guneet-xyz/shinan/pull/2)).

## Context

- People use a web app at `shinan.guneet.dev` to browse the catalog, follow
  tasks and the timeline, comment and nudge
  ([plan, section 5](../plan.md#5-integration-points)).
- The catalog holds infrastructure details such as machines and services
  ([plan, section 1](../plan.md#1-what-shinan-is)).

## Decision

The web app is on the public internet and requires sign-in.

## Reasons

The owner wants to reach it from anywhere. Because it holds infrastructure
details, sign-in, access rules and security get extra attention in the identity
and architecture documents.

## Consequences

- **Decided:** the identity and architecture documents give sign-in, access
  rules and security extra attention.
- **Decided (owner):** sign-in methods and accounts are set by
  [D-034](D-034-sign-in-and-accounts.md); agent tokens, the security log and
  purge rights by [D-035](D-035-tokens-security-log-purge.md); visibility by
  [D-023](D-023-workspace-wide-visibility-no-secrets.md).
- **Open:** the remaining protections for a public web app
  holding infrastructure details ([plan, question 7](../plan.md#7-open-questions)).
  Owned by [identity, agents and permissions](../identity.md) and
  [architecture and operations](../architecture.md).
- **Open:** what, if anything, is reachable before sign-in (such as the sign-in
  page and accepting an invitation), and whether the endpoints agents use
  follow the same exposure. Owned by [identity, agents and permissions](../identity.md)
  and [architecture and operations](../architecture.md).

## Alternatives considered

- **Not recorded.**

## Owning documents

- [Identity, agents and permissions](../identity.md): sign-in, tokens and
  access rules.
- [Architecture and operations](../architecture.md): security for a public
  sign-in app.
- [Human experience](../human-experience.md): sign-in and workspace screens.

## Related open questions

- Sign-in method and protections
  ([plan, question 7](../plan.md#7-open-questions)).
- Permissions when a user can see a task but not a private repository it links
  to ([plan, question 3](../plan.md#7-open-questions)).

## History

- The first plan draft placed the web app at `shinan.guneet.dev` without saying
  how it is reached (commit `5c3330c`).
- Recorded as accepted from the owner's answers (commit `e46c560`, 2026-11-16)
  and approved with the plan on 2026-11-16 (merge commit `248a2c5`).
- 2026-11-16: related decisions [D-023](D-023-workspace-wide-visibility-no-secrets.md), [D-034](D-034-sign-in-and-accounts.md), [D-035](D-035-tokens-security-log-purge.md) recorded from [issue #25](https://github.com/guneet-xyz/shinan/issues/25); maintained sections updated.
