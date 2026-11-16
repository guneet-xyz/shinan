---
id: D-034
title: Sign-in by GitHub, Forgejo, email magic link or password; an email allowlist decides who can have an account
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (O-41, O-48)"
supersedes: []
superseded_by: []
amends: []
amended_by: [D-044]
---

# D-034: Sign-in by GitHub, Forgejo, email magic link or password; an email allowlist decides who can have an account

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 6](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6912093727):
O-41 and O-48, not as recommended).
Amended by [D-044](D-044-sign-in-magic-link-or-github.md).

## Context

- The web app is public and requires sign-in
  ([D-015](D-015-public-web-app-with-sign-in.md)); people are invited to
  workspaces ([D-019](D-019-workspaces-from-the-start.md)).
- The sign-in method was open ([plan, question 7](../plan.md#7-open-questions)).
- Identity recommended passkeys only, with git host sign-in used only to link
  accounts and accept invitations, and invitations bound to a git host
  account and shared by hand. O-42 (accounts by invitation only) was accepted
  as recommended in the same batch.

## Decision

Sign-in methods in the first version: GitHub sign-in; Forgejo sign-in,
including any self-hosted Forgejo instance; email magic link; and password,
with no second factor required. No passkeys. Shinan sends email from the first
version. An allowlist of email addresses decides who can have an account;
joining a specific workspace still needs an invitation.

## Reasons

Owner's choice; no reason recorded.

## Consequences

- **Decided (owner, [D-044](D-044-sign-in-magic-link-or-github.md)):** sign-in
  is narrowed to email magic link or GitHub; no password or Forgejo sign-in.
  Email is sent through the AWS SES API.
- **Decided:** "no email in the first version" no longer holds; magic links
  need outgoing email.
- **Decided:** plan question 7's sign-in method is answered; the protections
  remain for the owning documents.
- Details: see [identity, agents and permissions](../identity.md),
  [architecture and operations](../architecture.md),
  [human experience](../human-experience.md) and
  [git host integrations](../git-hosts.md) (connecting Forgejo by URL).

## Alternatives considered

- **Recorded:** passkeys only (O-41's recommendation). Not chosen.
- **Recorded:** invitations bound to a git host account's stable number and
  shared by hand as a single-use link (O-48's recommendation). Not chosen.

## Owning documents

- [Identity, agents and permissions](../identity.md): sign-in, accounts and
  invitations.
- [Architecture and operations](../architecture.md): sending email.
- [Human experience](../human-experience.md): sign-in screens.

## Related open questions

- Protections for a public web app
  ([plan, question 7](../plan.md#7-open-questions)).

## History

- 2026-11-16: accepted by the owner on issue #25. Recorded in the decision
  log's pull request as part of the issue #25 batch (see
  [README, history](README.md#history)).
- 2026-11-16: amended by [D-044](D-044-sign-in-magic-link-or-github.md) (owner answers, batch 12, on [issue #25](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6913152214)). Decision and Reasons unchanged; maintained sections updated.
