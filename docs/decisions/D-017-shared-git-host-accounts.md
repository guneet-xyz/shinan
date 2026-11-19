---
id: D-017
title: Agents use their person's git host account; Shinan attributes actions from its own records
status: accepted
date: 2026-11-16
decided_by: owner
evidence: https://github.com/guneet-xyz/shinan/issues/1
supersedes: []
superseded_by: []
amends: []
amended_by: [D-032]
---

# D-017: Agents use their person's git host account; Shinan attributes actions from its own records

Status: **Accepted** by the owner on 2026-11-16, with the plan
([issue #1](https://github.com/guneet-xyz/shinan/issues/1),
[PR #2](https://github.com/guneet-xyz/shinan/pull/2)).
Amended by [D-032](D-032-no-writes-as-a-person-on-github.md).

## Context

- The `workspace` repository's practice asks agents to announce their agent
  session identity in a comment when agents share an account
  ([`workspace` repository collaboration practice](https://git.guneet.dev/guneet/workspace/src/branch/main/docs/collaboration.md)).
- The timeline credits each action to a person or to an agent acting for a
  person ([plan, section 4](../plan.md#4-product-pillars)).

## Decision

Agents use the same git host account as the person they work for. Shinan must
tell people and agents apart from its own records (agent sessions, task links,
markers in commits and PRs), not from git host accounts.

## Reasons

Asking every user to create bot accounts is a barrier, and other adopters will
have the same setup. This is a known limitation to design around.

## Consequences

- **Decided (owner, 2026-11-19, [D-061](D-061-push-authentication-and-push-log.md)):** catalog pushes are credited from Shinan's push log (the token used), never from commit authors.
- **Decided:** a git host account alone does not say whether a person or one of
  their agents acted. Shinan tells them apart using agent sessions, task links,
  and markers in commits and pull requests.
- **Decided:** this is a known limitation to design around.
- Proposed refinements: see the domain model's
  [actor](../domain-model.md#actor) and
  [attribution](../domain-model.md#attribution) entries, which also use agent
  tokens ([plan, section 5](../plan.md#5-integration-points): scoped tokens for
  agents).
- **Decided (owner, [D-032](D-032-no-writes-as-a-person-on-github.md)):**
  Shinan never writes to GitHub as a person; what a person wants done on a git
  host is done by their own agents. Shinan makes no writes on Forgejo
  ([D-042](D-042-no-writes-on-forgejo.md)).
- **Open:** how reliable attribution can be
  ([plan, question 2](../plan.md#7-open-questions)). Owned by
  [identity, agents and permissions](../identity.md).

## Alternatives considered

The first plan draft asked how agents get an identity on git hosts and listed
three options (commit `5c3330c`):

- **Recorded:** bot accounts for agents. Rejected for the reason above.
- **Recorded:** git host app identities. Not chosen; no separate reason was
  recorded.
- **Recorded:** commit notes. Not recorded whether this was rejected; markers
  in commits and pull requests are part of this decision.

## Owning documents

- [Identity, agents and permissions](../identity.md): attribution and tokens.
- [Tasks and work](../tasks.md) and [agent integrations](../agent-integrations.md):
  markers in branch names, commits and pull requests.
- [Git host integrations](../git-hosts.md): reading those markers.

## Related open questions

- How reliable attribution can be
  ([plan, question 2](../plan.md#7-open-questions)).

## History

- First plan draft: open question "How agents get an identity on git hosts (bot
  accounts, app identities, commit notes) so their actions are not credited to
  a person" (commit `5c3330c`, 2026-11-16).
- Recorded as accepted from the owner's answers, replacing that question
  (commit `e46c560`, 2026-11-16), and approved with the plan on 2026-11-16
  (merge commit `248a2c5`).
- 2026-11-16: amended by [D-032](D-032-no-writes-as-a-person-on-github.md) (owner answers on [issue #25](https://github.com/guneet-xyz/shinan/issues/25)). Decision and Reasons unchanged; maintained sections updated.
- 2026-11-16: related decision [D-042](D-042-no-writes-on-forgejo.md) recorded from batch 12 on [issue #25](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6913152214); maintained sections updated.
- 2026-11-19: related decisions D-059 to D-065 recorded ([Git-based catalog plan](../build-plan-git-catalog.md), accepted by the owner, [issue #161](https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7007337638)). Decision and Reasons unchanged; maintained sections updated.
