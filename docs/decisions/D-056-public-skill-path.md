---
id: D-056
title: The skill is served without sign-in on a public path, /skills/
status: accepted
date: 2026-11-17
decided_by: owner
evidence: "Owner's answer M2-Q2 to the M2 build plan, recorded on https://github.com/guneet-xyz/shinan/issues/79"
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-056: The skill is served without sign-in on a public path, `/skills/`

Status: **Accepted** by the owner on 2026-11-17, answering M2-Q2 of the
[M2 build plan](../build-plan-m2.md#7-owner-answers) (recorded on
[issue #79](https://github.com/guneet-xyz/shinan/issues/79)).

## Context

- The Shinan installation serves the skill, and OpenCode loads it as an HTTP
  skill catalog ([agent integrations, the skill](../agent-integrations.md#the-skill)).
- An OpenCode HTTP skill catalog is a base URL with an `index.json` file;
  OpenCode downloads each listed file from that URL. Its documentation
  describes no way to send credentials with these requests
  ([OpenCode skills](https://opencode.ai/docs/skills), checked 2026-11-17).
- The web app is on the public internet and requires sign-in
  ([D-015](D-015-public-web-app-with-sign-in.md)). Identity proposed that
  nothing is served without sign-in except the sign-in pages, the invitation
  acceptance page and a minimal health check
  ([identity §10](../identity.md#10-protections-for-a-public-installation)).
  The web app's own static files are already served without sign-in.
- The skill holds only product conventions, the same in every workspace.
  Each workspace's own rules reach agents through the agents' start-here
  path, which agents read through the MCP server with their token
  ([catalog §11](../catalog.md#11-start-here)).
- The M2 build plan recommended a public path; the alternative was copying
  the skill to each machine by hand, as the `workspace` repository's skills
  are today.

## Decision

The installation serves the skill's files, and only those, without sign-in
at the public path `/skills/` (with its `index.json`).

## Reasons

Owner's choice, as recommended in the M2 build plan; no further reason
recorded.

## Consequences

- **Decided:** `/skills/` is an exception to "nothing without sign-in". It
  serves only the built skill files, never workspace content; anyone can read
  Shinan's agent conventions, while the source repository stays private
  ([D-011](D-011-private-repository-and-brand.md)).
- **Decided:** the [identity](../identity.md#10-protections-for-a-public-installation),
  [architecture](../architecture.md#102-web-hardening) and
  [agent integrations](../agent-integrations.md#the-skill) documents list the
  path. The package that builds it (M2-9) adds it to the public routes test
  and to [security checklist](../security-checklist.md) item 1.12.

## Alternatives considered

- **Recorded:** copying the skill to each machine by hand (M2 build plan,
  question M2-Q2). Not chosen.
- **Implied:** serving the skill behind a token. Not possible for OpenCode's
  HTTP skill catalogs as documented.

## Owning documents

- [Agent integrations](../agent-integrations.md#the-skill): the skill.
- [Identity, agents and permissions](../identity.md#10-protections-for-a-public-installation):
  what is served without sign-in.
- [Architecture and operations](../architecture.md#102-web-hardening): public
  routes.
- [M2 build plan](../build-plan-m2.md): package M2-9.

## Related open questions

None.

## History

- 2026-11-17: accepted by the owner with the M2 build plan; recorded on
  [issue #79](https://github.com/guneet-xyz/shinan/issues/79).
