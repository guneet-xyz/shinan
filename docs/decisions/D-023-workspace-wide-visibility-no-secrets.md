---
id: D-023
title: Every member sees everything in a workspace; secrets never go in the catalog
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (O-2, O-43)"
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-023: Every member sees everything in a workspace; secrets never go in the catalog

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 1](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6910985893):
O-2; [batch 6](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6912093727):
O-43).

## Context

- Workspaces have members from the start ([D-019](D-019-workspaces-from-the-start.md)),
  and the web app is public behind sign-in ([D-015](D-015-public-web-app-with-sign-in.md)).
- The plan left open what a member sees when they cannot see a private
  repository a task links to ([plan, question 3](../plan.md#7-open-questions)).
- The catalog document proposed a `restricted` level for sensitive catalog
  content. Identity proposed workspace-wide visibility now and per-member
  repository visibility later.

## Decision

There is no restricted catalog level. Every member of a workspace sees
everything in it, including work from private repositories; the titles and
summaries Shinan stores are visible to all members. Links to private
repositories stay protected by GitHub's or Forgejo's own access control.
Secrets are never stored in the catalog. Managing secrets is the user's or
team's job, with a secrets manager such as Obscuro or Infisical; the catalog
only records where a secret lives.

## Reasons

The owner's stated reasons: managing secrets is the user's or team's job, and
private repository content stays protected by the git host's own access
control. No other reason recorded.

## Consequences

- **Decided (owner, 2026-11-19, [D-060](D-060-no-catalog-approval.md)):** the check for secret-looking values runs on every push to the catalog repository, on every branch; a workspace owner may allow one exact value as "not a secret".
- **Decided:** plan question 3 is answered for now: workspace-wide visibility.
- Details: see the [catalog](../catalog.md),
  [identity, agents and permissions](../identity.md) and
  [git host integrations](../git-hosts.md).

## Alternatives considered

- **Recorded:** a `restricted` catalog level, with sensitive keys restricted by
  default and agents receiving restricted content only through a token
  permission (O-2's recommendation). Not chosen.
- **Recorded:** per-member repository visibility before members' access
  differs (O-43's recommendation, option B). Not chosen.

## Owning documents

- [Catalog](../catalog.md): what may and may not be stored.
- [Identity, agents and permissions](../identity.md): access rules.
- [Architecture and operations](../architecture.md): handling of sensitive data.

## Related open questions

None.

## History

- 2026-11-16: accepted by the owner on issue #25. Recorded in the decision
  log's pull request as part of the issue #25 batch (see
  [README, history](README.md#history)).
- 2026-11-19: related decisions D-059 to D-065 recorded ([Git-based catalog plan](../build-plan-git-catalog.md), accepted by the owner, [issue #161](https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7007337638)). Decision and Reasons unchanged; maintained sections updated.
