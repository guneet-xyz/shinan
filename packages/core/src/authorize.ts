import { and, eq, isNull, schema, sql } from "@shinan/db"
import type { Role, Transaction } from "@shinan/db"

import type { Actor, AgentActor, ResolvedActor } from "./actor.js"
import { writtenActor } from "./actor.js"
import type { Context, InstallationScope, WorkspaceScope } from "./context.js"
import {
  ForbiddenError,
  NotFoundError,
  ReauthenticationRequiredError,
} from "./errors.js"
import type { RefusalReason } from "./errors.js"
import { decide, rules } from "./permissions.js"
import type {
  Action,
  InstallationAction,
  Requester,
  WorkspaceAction,
} from "./permissions.js"
import { recordSecurityEntry } from "./security-log.js"
import { isId } from "./validation.js"

/**
 * Runs one workspace operation: in a transaction, checks that the actor may
 * take `action` in the workspace, then runs `work` with a scope for that
 * action. Every workspace operation goes through here, so there is one check
 * path whichever way the request arrived (identity §9.1).
 *
 * Refusals are recorded in the security log after the transaction has rolled
 * back, so the record survives (identity §11). A non-member gets the same
 * answer as for a workspace that does not exist. Operations check their input
 * inside `work`, after permission, so a refused request is always recorded
 * whatever its input (identity §9.1 order).
 */
export async function inWorkspace<A extends WorkspaceAction, T>(
  ctx: Context,
  workspaceId: string,
  action: A,
  work: (scope: WorkspaceScope<A>) => Promise<T>,
): Promise<T> {
  if (!isId(workspaceId)) throw new NotFoundError()
  const id = workspaceId.toLowerCase()
  return withRefusalsRecorded(ctx, () =>
    ctx.db.transaction(async (tx) => {
      const resolved = await resolveActor(tx, ctx.actor)
      if (!resolved) throw new NotFoundError()
      // An agent belongs to one workspace; anywhere else it is not a member,
      // even where its person is (identity §4).
      const foreignAgent =
        ctx.actor.kind === "agent" && ctx.actor.workspaceId.toLowerCase() !== id
      const actor = foreignAgent
        ? resolved
        : await withMembership(tx, resolved, id)
      check(
        action,
        actor,
        requesterFor(ctx.actor, actor),
        id,
        foreignAgent && ctx.actor.kind === "agent"
          ? { agentWorkspaceId: ctx.actor.workspaceId.toLowerCase() }
          : {},
      )
      return work({
        ...scopeFields(ctx, tx, actor),
        action,
        workspaceId: id,
      } as WorkspaceScope<A>)
    }),
  )
}

/** Like `inWorkspace`, for actions outside any workspace. */
export async function atInstallation<A extends InstallationAction, T>(
  ctx: Context,
  action: A,
  work: (scope: InstallationScope<A>) => Promise<T>,
): Promise<T> {
  return withRefusalsRecorded(ctx, () =>
    ctx.db.transaction(async (tx) => {
      const actor = await resolveActor(tx, ctx.actor)
      if (!actor) throw new NotFoundError()
      check(action, actor, requesterFor(ctx.actor, actor), null, {})
      return work({
        ...scopeFields(ctx, tx, actor),
        action,
      } as InstallationScope<A>)
    }),
  )
}

/**
 * Creates a workspace with the actor as its first workspace owner, and
 * returns a scope in it for recording the creation. This is the only way to
 * get a workspace scope without the membership check, and it works only for
 * a workspace it has just created.
 */
export async function createWorkspaceAsOwner(
  installation: InstallationScope<"workspace.create">,
  name: string,
): Promise<{
  workspace: typeof schema.workspaces.$inferSelect
  member: typeof schema.members.$inferSelect
  scope: WorkspaceScope<"workspace.create">
}> {
  const personId = installation.actor.personId
  if (installation.action !== "workspace.create" || !personId) {
    throw new Error("Only a person creating a workspace can use this")
  }
  const [workspace] = await installation.tx
    .insert(schema.workspaces)
    .values({ name })
    .returning()
  const [member] = await installation.tx
    .insert(schema.members)
    .values({ workspaceId: workspace!.id, personId, role: "owner" })
    .returning()
  const actor: ResolvedActor = {
    ...installation.actor,
    member: { id: member!.id, role: "owner" },
  }
  return {
    workspace: workspace!,
    member: member!,
    scope: {
      action: installation.action,
      tx: installation.tx,
      workspaceId: workspace!.id,
      actor,
      origin: installation.origin,
      request: installation.request,
      jobs: installation.jobs,
      installationUrl: installation.installationUrl,
    } as WorkspaceScope<"workspace.create">,
  }
}

/**
 * Makes the actor a member of a workspace through an invitation they accept
 * (identity §5.2), and returns a scope in it for recording that. Like
 * `createWorkspaceAsOwner`, it is the only way in without the membership
 * check, and only for the membership it has just created; the caller has
 * checked the invitation.
 */
export async function joinWorkspaceByInvitation(
  installation: InstallationScope<"invitation.respond">,
  input: { workspaceId: string; role: Role; invitedByMemberId: string },
): Promise<{
  member: typeof schema.members.$inferSelect
  scope: WorkspaceScope<"invitation.respond">
}> {
  const personId = installation.actor.personId
  if (installation.action !== "invitation.respond" || !personId) {
    throw new Error("Only a person accepting an invitation can use this")
  }
  const [member] = await installation.tx
    .insert(schema.members)
    .values({
      workspaceId: input.workspaceId,
      personId,
      role: input.role,
      invitedByMemberId: input.invitedByMemberId,
    })
    .returning()
  const actor: ResolvedActor = {
    ...installation.actor,
    member: { id: member!.id, role: member!.role },
  }
  return {
    member: member!,
    scope: {
      action: installation.action,
      tx: installation.tx,
      workspaceId: input.workspaceId,
      actor,
      origin: installation.origin,
      request: installation.request,
      jobs: installation.jobs,
      installationUrl: installation.installationUrl,
    } as WorkspaceScope<"invitation.respond">,
  }
}

function scopeFields(ctx: Context, tx: Transaction, actor: ResolvedActor) {
  return {
    tx,
    actor,
    origin: ctx.origin ?? "shinan_action",
    request: ctx.request ?? {},
    jobs: ctx.jobs,
    installationUrl: ctx.installationUrl,
  }
}

function requesterFor(actor: Actor, resolved: ResolvedActor): Requester {
  return {
    kind: actor.kind,
    role: resolved.member?.role,
    scopes: actor.kind === "agent" ? actor.scopes : undefined,
    reauthenticated: actor.kind === "person" ? actor.reauthenticated : false,
    operator: resolved.operator,
  }
}

function check(
  action: Action,
  actor: ResolvedActor,
  requester: Requester,
  workspaceId: string | null,
  details: Record<string, unknown>,
): void {
  const decision = decide(rules[action], requester)
  if (!decision.allowed) {
    throw new Refusal(action, decision.reason, actor, workspaceId, details)
  }
}

/** Raised inside the transaction; turned into a public error outside it. */
class Refusal extends Error {
  constructor(
    readonly action: Action,
    readonly reason: RefusalReason,
    readonly actor: ResolvedActor,
    readonly workspaceId: string | null,
    readonly details: Record<string, unknown>,
  ) {
    super(`Refused ${action}: ${reason}`)
  }
}

async function withRefusalsRecorded<T>(
  ctx: Context,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (!(error instanceof Refusal)) throw error
    // Refusals of non-members are installation-level entries, so a workspace
    // learns nothing about people outside it (identity §4).
    const member = error.actor.member !== null
    await recordSecurityEntry(ctx.db, {
      workspaceId: member ? error.workspaceId : null,
      action: "request.refused",
      outcome: "refused",
      actor: error.actor,
      request: ctx.request ?? {},
      details: {
        action: error.action,
        reason: error.reason,
        ...(member || !error.workspaceId
          ? {}
          : { workspaceId: error.workspaceId }),
        ...error.details,
      },
    })
    throw publicError(error.reason)
  }
}

function publicError(reason: RefusalReason): Error {
  switch (reason) {
    case "not-member":
      return new NotFoundError()
    case "reauthentication":
      return new ReauthenticationRequiredError()
    default:
      return new ForbiddenError(reason)
  }
}

/**
 * Adds the actor's current membership in the workspace, if any. An agent
 * acts only through the membership it was created with, not its person's
 * current one: an agent of a person who left and rejoined stays outside
 * (identity §5.3).
 */
async function withMembership(
  tx: Transaction,
  actor: ResolvedActor,
  workspaceId: string,
): Promise<ResolvedActor> {
  if (!actor.personId) return actor
  if (actor.agentId) {
    const [member] = await tx
      .select({ id: schema.members.id, role: schema.members.role })
      .from(schema.agents)
      .innerJoin(schema.members, eq(schema.members.id, schema.agents.memberId))
      .where(
        and(
          eq(schema.agents.id, actor.agentId),
          eq(schema.agents.workspaceId, workspaceId),
          eq(schema.members.workspaceId, workspaceId),
          isNull(schema.members.removedAt),
        ),
      )
    return { ...actor, member: member ?? null }
  }
  const [member] = await tx
    .select({ id: schema.members.id, role: schema.members.role })
    .from(schema.members)
    .where(
      and(
        eq(schema.members.workspaceId, workspaceId),
        eq(schema.members.personId, actor.personId),
        isNull(schema.members.removedAt),
      ),
    )
  return { ...actor, member: member ?? null }
}

/**
 * Checks the actor against the database. Returns null when the actor's
 * person does not exist or an ID is malformed.
 */
async function resolveActor(
  tx: Transaction,
  actor: Actor,
): Promise<ResolvedActor | null> {
  const base = {
    agentId: null,
    agentSessionId: null,
    confidence: "recorded" as const,
    member: null,
    operator: false,
  }
  if (actor.kind === "shinan") {
    return {
      ...base,
      kind: "shinan",
      personId: null,
      label: writtenActor(actor, undefined),
    }
  }

  if (!isId(actor.personId)) return null
  if (
    actor.kind === "agent" &&
    (!isId(actor.agentId) ||
      !isId(actor.tokenId) ||
      (actor.agentSessionId !== undefined && !isId(actor.agentSessionId)))
  ) {
    return null
  }
  // An agent counts only while it is enabled and the token the request
  // used is not revoked, checked again here on every operation (identity
  // §7.5), whatever the token layer found earlier in the request.
  if (actor.kind === "agent" && !(await agentIsLive(tx, actor))) return null
  const [person] = await tx
    .select({
      handle: schema.people.handle,
      // Written out in full: Drizzle leaves column names unqualified here,
      // and "email" would then mean the operators' column on both sides.
      operator: sql<boolean>`exists (select 1 from installation_operators o where o.email = people.email)`,
    })
    .from(schema.people)
    .where(eq(schema.people.id, actor.personId))
  if (!person) return null

  return {
    ...base,
    kind: actor.kind,
    personId: actor.personId,
    agentId: actor.kind === "agent" ? actor.agentId : null,
    agentSessionId:
      actor.kind === "agent" ? (actor.agentSessionId ?? null) : null,
    label: writtenActor(actor, person.handle),
    // Only a person's own requests count as an operator's; never an agent's.
    operator: actor.kind === "person" && person.operator,
  }
}

async function agentIsLive(
  tx: Transaction,
  actor: AgentActor,
): Promise<boolean> {
  const [live] = await tx
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .innerJoin(
      schema.agentTokens,
      eq(schema.agentTokens.agentId, schema.agents.id),
    )
    .where(
      and(
        eq(schema.agents.id, actor.agentId),
        eq(schema.agents.personId, actor.personId),
        eq(schema.agents.enabled, true),
        eq(schema.agentTokens.id, actor.tokenId),
        isNull(schema.agentTokens.revokedAt),
      ),
    )
  return live !== undefined
}
