import type { schema } from "@shinan/db"

import { atInstallation, createWorkspaceAsOwner } from "../authorize.js"
import type { Context } from "../context.js"
import { appendEvent } from "../events.js"
import { recordSecurityEntry } from "../security-log.js"
import { checkName } from "../validation.js"
import type { Member } from "./members.js"

export type Workspace = typeof schema.workspaces.$inferSelect

/**
 * Creates a workspace. Any person on the installation can, and becomes its
 * first workspace owner (identity §4).
 */
export async function createWorkspace(
  ctx: Context,
  input: { name: string },
): Promise<{ workspace: Workspace; member: Member }> {
  const name = checkName(input.name, "The workspace name")

  return atInstallation(ctx, "workspace.create", async (installation) => {
    const { workspace, member, scope } = await createWorkspaceAsOwner(
      installation,
      name,
    )
    await appendEvent(scope, {
      kind: "workspace.created",
      subjects: [{ type: "member", id: member.id }],
      summary: `${scope.actor.label} created the workspace ${name}`,
      data: { name },
    })
    await recordSecurityEntry(scope.tx, {
      workspaceId: scope.workspaceId,
      action: "workspace.created",
      outcome: "succeeded",
      actor: scope.actor,
      request: scope.request,
      details: { name, memberId: member.id, role: "owner" },
    })
    return { workspace, member }
  })
}
