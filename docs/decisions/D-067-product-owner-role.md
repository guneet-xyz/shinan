---
id: D-067
title: A product owner role puts the experience of people using Shinan first
status: accepted
date: 2026-11-20
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/183#issuecomment-7029722159"
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-067: A product owner role puts the experience of people using Shinan first

Status: **Accepted** by the owner on 2026-11-20, in conversation (recorded on
[issue #183](https://github.com/guneet-xyz/shinan/issues/183#issuecomment-7029722159)).

## Context

- Work is reviewed by a reviewer agent against the documents it implements,
  for correctness, permissions, tests and scope; the owner reviews each
  milestone as a whole, not every PR
  ([build plan §4](../build-plan.md#4-how-the-work-is-done-proposed),
  [§8](../build-plan.md#8-owner-answers)).
- M2's catalog screens, as built in v0.3.0, are dense: rows of labels and
  badges above each page, raw fact keys, two rows of tabs, revision and
  proposal numbers in the list of changes
  ([human experience, the catalog](../human-experience.md#the-catalog)).
- On 2026-11-19 the owner said of the catalog: "I as a human don't want to
  see and search by 'types'. We want to make this platform simple and easy
  on the eyes… navigation on the left side…", with navigation and polish in
  a later improvement cycle (GD-9, [D-064](D-064-catalog-not-wiki.md)).

## Decision

The owner, on 2026-11-20: "Can we have like a product owner or something
role that prioritizes the user experience. Simple easy to understand and use
features and human facing web design than complex and information dense
designs and flows."

## Reasons

Owner's choice; no reason recorded beyond the request's own: simple, easy to
understand and use features and human-facing design, rather than complex and
information-dense designs and flows.

## Notes

- **Sourced fact:** how the role works was set by the coordinating agent in
  response, not in the owner's words: a product owner agent writes a product
  brief before each user-facing work package is built, reviews each
  user-facing PR alongside the code review, keeps the product principles, and
  the owner has the final say
  ([recorded on issue #183](https://github.com/guneet-xyz/shinan/issues/183#issuecomment-7029722159)).
  Those mechanics are **proposed** in the
  [build plan §4](../build-plan.md#4-how-the-work-is-done-proposed).

## Consequences

- The [product principles](../product-principles.md) are the yardstick for
  user-facing work; the build plan's process gains a product review
  ([§4](../build-plan.md#4-how-the-work-is-done-proposed)).
- The reviewer agent keeps checking correctness, security, accessibility and
  the Content Security Policy; the product owner judges the experience and
  writes no production code.
- Anything a simpler design would change in a decided behaviour goes to the
  owner with a recommendation; this record decides no screen by itself.
- **Open:** the later navigation and polish cycle (GD-9) is where most of the
  principles' examples land; its scope is the owner's to set
  ([Git-based catalog plan §1.4](../build-plan-git-catalog.md#14-not-in-this-plan)).

## Alternatives considered

- **Implied:** the reviewer agent also judges the experience (the process
  before this record). Not chosen: the owner asked for a separate role.
- **Implied:** the owner reviews every user-facing PR. Not chosen: the owner
  reviews milestones, not every PR ([build plan §8](../build-plan.md#8-owner-answers),
  answer 3); the owner keeps the final say on disagreements.

## Owning documents

- [Product principles](../product-principles.md).
- [Build plan §4](../build-plan.md#4-how-the-work-is-done-proposed): the
  product review step.
- [Human experience](../human-experience.md): the screens the principles are
  applied to.

## Related open questions

None.

## History

- 2026-11-20: decided by the owner in conversation; recorded with the
  product principles ([#183](https://github.com/guneet-xyz/shinan/issues/183)).
