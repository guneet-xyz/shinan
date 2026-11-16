---
id: D-044
title: Sign-in is by email magic link or GitHub only; Forgejo is only for connecting; email is sent through the AWS SES API
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (N-7, N-6)"
supersedes: []
superseded_by: []
amends: [D-034]
amended_by: []
---

# D-044: Sign-in is by email magic link or GitHub only; Forgejo is only for connecting; email is sent through the AWS SES API

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 12](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6913152214):
N-7 and N-6).

## Context

- [D-034](D-034-sign-in-and-accounts.md) (O-41, O-48) allowed sign-in by
  GitHub, Forgejo (any self-hosted instance), email magic link or password, and
  had Shinan send email from the first version.
- Identity asked which Forgejo instances could be used for sign-in, and
  recommended any instance, added by an installation operator. Architecture
  asked how email is sent.

## Decision

Sign-in to Shinan is by email magic link or GitHub only. There is no password
sign-in and no Forgejo sign-in. Forgejo is used only to connect accounts and
repositories, and anyone can enter any Forgejo URL to connect. Email is sent
through the AWS SES SDK (its API), not SMTP. The email allowlist and
invitations from D-034 stand.

## Reasons

Owner's choice; no reason recorded.

## Consequences

- **Decided:** password sign-in and Forgejo sign-in are not built.
- **Decided:** Shinan still sends email from the first version (magic links),
  now through the AWS SES API.
- Details: see [identity, agents and permissions](../identity.md),
  [architecture and operations](../architecture.md),
  [git host integrations](../git-hosts.md) and
  [human experience](../human-experience.md).

## Alternatives considered

- **Recorded:** GitHub, Forgejo, magic link and password sign-in
  ([D-034](D-034-sign-in-and-accounts.md), O-41). Narrowed.
- **Recorded:** Forgejo sign-in on any instance, added by an installation
  operator (identity's recommendation). Not chosen.
- **Recorded:** sending email over SMTP. Not chosen (N-6).

## Owning documents

- [Identity, agents and permissions](../identity.md): sign-in methods.
- [Architecture and operations](../architecture.md): email sending.
- [Git host integrations](../git-hosts.md): connecting Forgejo by URL.

## Related open questions

- Protections for a public web app
  ([plan, question 7](../plan.md#7-open-questions)).

## History

- 2026-11-16: accepted by the owner on issue #25 (batch 12). Recorded in the
  decision log's pull request with the rest of the issue #25 answers (see
  [README, history](README.md#history)).
