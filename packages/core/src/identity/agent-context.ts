import type { Context } from "../context.js"
import { NotFoundError } from "../errors.js"
import { decide, rules } from "../permissions.js"
import { getConnectedAgent } from "./agents.js"
import type { ConnectedAgent } from "./agents.js"

/**
 * What MCP's `workspace_context` answers (Git-based catalog plan §2.13):
 * the agent, the member it acts for, the workspace, what the token allows,
 * and where the workspace's catalog repository is. No catalog content: the
 * catalog is changed and read through Git, and the tool lets a person check
 * an agent's connection until M3 adds the task tools.
 */
export interface AgentWorkspaceContextAnswer extends ConnectedAgent {
  /**
   * The catalog repository's address, for `git clone`; null when the token
   * or the member may not read the catalog.
   */
  catalog: { repository: string } | null
}

/** The catalog repository of a workspace (plan §2.2). */
export function catalogRepositoryUrl(
  installationUrl: string,
  workspaceId: string,
): string {
  return `${installationUrl.replace(/\/+$/, "")}/git/${workspaceId}.git`
}

/** The `workspace_context` tool, for the agent the request is from. */
export async function getAgentWorkspaceContext(
  ctx: Context,
): Promise<AgentWorkspaceContextAnswer> {
  if (ctx.actor.kind !== "agent") throw new NotFoundError()
  const connected = await getConnectedAgent(ctx)
  const mayRead = decide(rules["catalog.read"], {
    kind: "agent",
    role: connected.role,
    scopes: connected.scopes,
  }).allowed
  return {
    ...connected,
    catalog:
      mayRead && ctx.installationUrl
        ? {
            repository: catalogRepositoryUrl(
              ctx.installationUrl,
              connected.workspace.id,
            ),
          }
        : null,
  }
}
