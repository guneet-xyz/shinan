---
id: D-065
title: Git runs in its own internal container; web forwards authenticated requests to it with a shared service token
status: accepted
date: 2026-11-19
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7007337638 (GQ-1)"
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-065: Git runs in its own internal container; `web` forwards authenticated requests to it with a shared service token

Status: **Accepted** by the owner on 2026-11-19, in conversation, as the
answer GQ-1 to the [Git-based catalog plan](../build-plan-git-catalog.md#102-owner-answers-to-the-questions)
(recorded on [issue #161](https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7007337638)).

## Context

- The catalog is stored in Git, hosted by Shinan
  ([D-059](D-059-catalog-in-git-hosted-by-shinan.md)), which needs the `git`
  programs, C code that parses what agents push
  ([plan §2.3](../build-plan-git-catalog.md#23-git-in-a-distroless-image)).
- `web` faces the internet behind Caddy and holds the session secret, the
  GitHub client secret and database access
  ([architecture §11.2](../architecture.md#112-shinan-stack)).
- The plan recommended running Git inside `web` for now and a separate
  container before a second member joins.

## Decision

Git runs in its own container from the start. `web` stays the only public
front door and authenticates agents with their tokens as now; it forwards
Git's smart HTTP requests to the Git container over an internal network,
authenticated with a simple shared service token, a secret the owner types
(in Obscuro on Musashi). The Git container has no public network and accepts
only requests carrying the service token. `web` passes the authenticated
agent and person to it, which the Git container trusts only because of the
service token, for the push log and the `by` rule.

## Reasons

The owner: "Separate container, and we can have simple token based auth to
authenticate our web container right, what's so complicated?"

## Consequences

- The design (the same image with a `git` role, no database access and no
  other secret, the internal network, the context header, the journal `web`
  reads, the read API for the index and the UI) is in the
  [plan §2.2 and §2.4](../build-plan-git-catalog.md#22-how-shinan-serves-git);
  owned afterwards by [architecture and operations](../architecture.md).
- On Musashi: a new container, its volume, a new internal network and one new
  secret, each needing the owner's deployment approval
  ([plan §4.3](../build-plan-git-catalog.md#43-deployment-changes-on-musashi);
  [D-016](D-016-musashi-and-deployment-approval.md)).
- Self-hosters run a fourth service and keep its volume
  ([D-012](D-012-self-hostable.md); operator guide).

## Alternatives considered

- **Recorded:** Git inside `web`, with a clean environment and limits (the
  plan's recommendation for now). Not chosen.
- **Recorded:** a separate container reaching the database through `web`'s
  internal interface. Replaced by the owner's simpler service token, with
  `web` passing identity in and reading results out.

## Owning documents

- [Architecture and operations](../architecture.md): process roles, the Git
  endpoint, networks and secrets.
- [Security checklist](../security-checklist.md): the Git container's
  isolation.
- [Operator guide](../operator-guide.md): running it.

## Related open questions

None.

## History

- 2026-11-19: decided by the owner in conversation, answering GQ-1 of the
  Git-based catalog plan; recorded in the plan's pull request
  ([PR #162](https://github.com/guneet-xyz/shinan/pull/162)).
