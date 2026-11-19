---
id: D-050
title: Agents get their token by a browser approval started from the plugin or CLI; one token works at every agent endpoint
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/26 (NO-1)"
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-050: Agents get their token by a browser approval started from the plugin or CLI; one token works at every agent endpoint

Status: **Accepted** by the owner on 2026-11-16
([issue #26](https://github.com/guneet-xyz/shinan/issues/26#issuecomment-6918513933):
NO-1 accepted as recommended).

## Context

- Agent tokens are long-lived and last until revoked
  ([D-035](D-035-tokens-security-log-purge.md)); an agent is per person, coding
  tool and machine ([D-031](D-031-agent-and-session-granularity.md)); agents
  connect through MCP and a skill, plugins and the CLI
  ([D-014](D-014-three-connection-levels.md)).
- The integration review (I-21, I-48) found two different flows: identity
  proposed the coding tool's own MCP OAuth sign-in with an MCP-only token;
  architecture proposed a device-style browser approval run by the plugin or
  CLI, with one token for MCP, the REST API and the plugin stream.
- The review's recommendation gave this reason: it meets agent integrations'
  "one approval per machine" and headless needs, avoids making Shinan a full
  OAuth authorization server on a public app ([D-015](D-015-public-web-app-with-sign-in.md)),
  and fits long-lived tokens. Its stated cost: a tool that supports only MCP
  OAuth, with no custom header, needs the CLI's stdio bridge.

## Decision

Agents get their long-lived token by a browser approval started from the
plugin or the CLI, with a short code for machines without a browser. A token
made by hand is the fallback. There is one token per agent, accepted at every
agent endpoint: MCP, the REST API and the plugin stream. There is no
MCP-specific OAuth sign-in in the first version.

## Reasons

Owner's choice; no reason recorded.

## Consequences

- **Decided (owner, 2026-11-19, [D-061](D-061-push-authentication-and-push-log.md)):** the one agent token also works at `/git/`, as the password of HTTP Basic authentication supplied by a Git credential helper.
- **Decided:** identity owns the flow; architecture and agent integrations
  align with it (owner's answer).
- Details: see [identity, agents and permissions](../identity.md),
  [architecture and operations](../architecture.md),
  [agent integrations](../agent-integrations.md) and
  [human experience](../human-experience.md) ("Your agents").

## Alternatives considered

- **Recorded:** the coding tool's own MCP OAuth sign-in (authorization code
  with PKCE), with an MCP-only token (identity's proposal). Not chosen for the
  first version.

## Owning documents

- [Identity, agents and permissions](../identity.md): agent registration and
  tokens.
- [Architecture and operations](../architecture.md): the approval mechanism and
  endpoints.
- [Agent integrations](../agent-integrations.md): plugin and CLI setup.
- [Human experience](../human-experience.md): the "Your agents" screen.

## Related open questions

None.

## History

- 2026-11-16: accepted by the owner on issue #26 (integration review). Recorded
  in the decision log's integration-fix pull request (see
  [README, history](README.md#history)).
- 2026-11-16: added Human experience to the owning documents (integration review I-77, [issue #26](https://github.com/guneet-xyz/shinan/issues/26#issuecomment-6918785395)).
- 2026-11-19: related decisions D-059 to D-065 recorded ([Git-based catalog plan](../build-plan-git-catalog.md), accepted by the owner, [issue #161](https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7007337638)). Decision and Reasons unchanged; maintained sections updated.
