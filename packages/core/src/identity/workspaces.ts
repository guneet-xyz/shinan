import { and, eq, gt, schema, sql } from "@shinan/db"
import type { Role, Transaction } from "@shinan/db"

import {
  atInstallation,
  createWorkspaceAsOwner,
  inWorkspace,
} from "../authorize.js"
import type { Context, WorkspaceScope } from "../context.js"
import { NotFoundError, RuleViolationError } from "../errors.js"
import { appendEvent } from "../events.js"
import { recordSecurityEntry } from "../security-log.js"
import { checkName } from "../validation.js"
import type { Member } from "./members.js"

export type Workspace = typeof schema.workspaces.$inferSelect

/** A workspace as one of its members sees it. */
export interface WorkspaceDetails extends Workspace {
  /** The role of the member reading it (for an agent, its member's role). */
  role: Role
}

/**
 * How many workspaces one person may create in a day. Proposed: a modest
 * limit, so one account cannot fill the installation (and its security log,
 * which is kept forever) with workspaces.
 */
export const workspacesPerPersonPerDay = 10

/**
 * Creates a workspace. Any person on the installation can, and becomes its
 * first workspace owner (identity §4), up to `workspacesPerPersonPerDay`.
 */
export async function createWorkspace(
  ctx: Context,
  input: { name: string },
): Promise<{ workspace: Workspace; member: Member }> {
  return atInstallation(ctx, "workspace.create", async (installation) => {
    const name = checkName(input.name, "The workspace name")
    await checkCreationLimit(installation.tx, installation.actor.personId!)
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

/** The workspace's general details, for any member. */
export async function getWorkspace(
  ctx: Context,
  workspaceId: string,
): Promise<WorkspaceDetails> {
  return inWorkspace(ctx, workspaceId, "workspace.read", async (scope) => ({
    ...(await findWorkspace(scope)),
    role: scope.actor.member!.role,
  }))
}

/**
 * Renames the workspace. A workspace setting, so only workspace owners may,
 * after signing in again (identity §3.3, §5.1).
 */
export async function renameWorkspace(
  ctx: Context,
  input: { workspaceId: string; name: string },
): Promise<WorkspaceDetails> {
  return inWorkspace(
    ctx,
    input.workspaceId,
    "workspace.change-settings",
    async (scope) => {
      const name = checkName(input.name, "The workspace name")
      const workspace = await findWorkspace(scope, { lock: true })
      const role = scope.actor.member!.role
      if (workspace.name === name) return { ...workspace, role }

      const [renamed] = await scope.tx
        .update(schema.workspaces)
        .set({ name })
        .where(eq(schema.workspaces.id, scope.workspaceId))
        .returning()
      const change = { from: workspace.name, to: name }
      await appendEvent(scope, {
        kind: "workspace.renamed",
        summary: `${scope.actor.label} renamed the workspace to ${name}`,
        data: change,
      })
      await recordSecurityEntry(scope.tx, {
        workspaceId: scope.workspaceId,
        action: "workspace.renamed",
        outcome: "succeeded",
        actor: scope.actor,
        request: scope.request,
        details: change,
      })
      return { ...renamed!, role }
    },
  )
}

async function findWorkspace(
  scope: WorkspaceScope,
  options: { lock?: boolean } = {},
): Promise<Workspace> {
  const query = scope.tx
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, scope.workspaceId))
  const [workspace] = await (options.lock ? query.for("update") : query)
  if (!workspace) throw new NotFoundError()
  return workspace
}

async function checkCreationLimit(
  tx: Transaction,
  personId: string,
): Promise<void> {
  // One person's creations take turns, so the count cannot be raced.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`shinan:workspace-create:${personId}`}, 0))`,
  )
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.securityLog)
    .where(
      and(
        eq(schema.securityLog.action, "workspace.created"),
        eq(schema.securityLog.actorPersonId, personId),
        gt(schema.securityLog.occurredAt, sql`now() - interval '1 day'`),
      ),
    )
  if (row!.count >= workspacesPerPersonPerDay) {
    throw new RuleViolationError(
      "workspace-limit",
      `You can create at most ${workspacesPerPersonPerDay} workspaces a day`,
    )
  }
}
