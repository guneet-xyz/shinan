---
id: D-063
title: Agents read and change the catalog through Git and the skill, not MCP; MCP stays for tasks
status: accepted
date: 2026-11-19
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7007337638"
supersedes: []
superseded_by: []
amends: [D-014, D-006]
amended_by: []
---

# D-063: Agents read and change the catalog through Git and the skill, not MCP; MCP stays for tasks

Status: **Accepted** by the owner on 2026-11-19, in conversation, with the
[Git-based catalog plan](../build-plan-git-catalog.md) ("Approve and start";
recorded on [issue #161](https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7007337638)).

## Context

- [D-014](D-014-three-connection-levels.md): agents connect at three levels,
  the first being "MCP and a skill for actions (any agent)".
- [D-006](D-006-document-first-catalog.md): "an index for agents is generated"
  from the Markdown. M2 served it through MCP catalog tools
  ([agent integrations, tool set](../agent-integrations.md#tool-set)).
- With the catalog in Git ([D-059](D-059-catalog-in-git-hosted-by-shinan.md)),
  agents have the documents in their own clone.

## Decision

MCP is not used for the catalog. The catalog MCP tools are removed. The MCP
endpoint, with its authentication, limits and caps, stays for M3's tasks.

## Reasons

Owner's choice; no reason recorded.

## Consequences

- D-014's first level becomes, for the catalog, Git and the skill; MCP and the
  skill remain the level for tasks (M3). The plugin and launcher levels are
  unchanged.
- D-006's generated index stays, for search, the catalog pages and later task
  features; agents read the documents directly
  ([plan §2.7](../build-plan-git-catalog.md#27-the-index-after-a-push)).
- `/mcp` keeps one tool, `workspace_context`, without catalog content
  (proposed, [plan §2.13](../build-plan-git-catalog.md#213-mcp-after-this-change)).
- The plan's §5 ("Read the catalog, propose catalog changes" through MCP)
  changes ([O-98](README.md#relationship-to-the-plan)).

## Alternatives considered

- **Recorded:** catalog read and propose tools over MCP (M2-6, as built).
  Replaced.

## Owning documents

- [Agent integrations](../agent-integrations.md): tools and the skill.
- [Architecture and operations](../architecture.md): the MCP endpoint.

## Related open questions

None.

## History

- 2026-11-19: decided by the owner in conversation; proposed as this record in
  the Git-based catalog plan ([issue #161](https://github.com/guneet-xyz/shinan/issues/161)).
- 2026-11-19: accepted by the owner with the plan ([PR #162](https://github.com/guneet-xyz/shinan/pull/162),
  answers GQ-1 to GQ-6 [on issue #161](https://github.com/guneet-xyz/shinan/issues/161#issuecomment-7007337638)).
