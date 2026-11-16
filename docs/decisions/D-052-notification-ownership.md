---
id: D-052
title: Architecture owns sending notifications; human experience owns what is sent and personal settings
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/26 (NO-3)"
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-052: Architecture owns sending notifications; human experience owns what is sent and personal settings

Status: **Accepted** by the owner on 2026-11-16
([issue #26](https://github.com/guneet-xyz/shinan/issues/26#issuecomment-6918513933):
NO-3 accepted as recommended).

## Context

- Notifications by email or chat are not in the first version
  ([plan, section 5](../plan.md#5-integration-points)); the roadmap puts them
  in phase 2.
- The plan's list of documents ([section 8](../plan.md#8-documents-to-write-next))
  gives notifications no owner. The integration review (I-54) found that no
  document sends them; human experience specifies only the person's side.
- Shinan already sends email through the AWS SES API
  ([D-044](D-044-sign-in-magic-link-or-github.md)).

## Decision

Architecture and operations owns sending notifications: channels, delivery,
retries and failures, with email first, through SES. Human experience owns what
is sent and each person's notification settings. A note is added to plan
section 8.

## Reasons

Owner's choice; no reason recorded.

## Consequences

- **Decided:** the plan's [section 8](../plan.md#8-documents-to-write-next)
  names these owners (owner's answer; added on the plan).
- Details: see [architecture and operations](../architecture.md) and
  [human experience](../human-experience.md).

## Alternatives considered

- **Not recorded.**

## Owning documents

- [Architecture and operations](../architecture.md): sending.
- [Human experience](../human-experience.md): content and settings.

## Related open questions

None.

## History

- 2026-11-16: accepted by the owner on issue #26 (integration review). Recorded
  in the decision log's integration-fix pull request (see
  [README, history](README.md#history)).
- 2026-11-16: noted that plan section 8 now names the notification owners (integration review I-78, [issue #26](https://github.com/guneet-xyz/shinan/issues/26#issuecomment-6918785395)).
