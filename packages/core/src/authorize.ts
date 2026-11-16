import { and, eq, isNull, schema } from "@shinan/db"
import type { Transaction } from "@shinan/db"

import type { Actor, ResolvedActor } from "./actor.js"
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
 * answer as for a workspace that does not exist.
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
    } as WorkspaceScope<"workspace.create">,
  }
}

function scopeFields(ctx: Context, tx: Transaction, actor: ResolvedActor) {
  return {
    tx,
    actor,
    origin: ctx.origin ?? "shinan_action",
    request: ctx.request ?? {},
    jobs: ctx.jobs,
  }
}

function requesterFor(actor: Actor, resolved: ResolvedActor): Requester {
  return {
    kind: actor.kind,
    role: resolved.member?.role,
    scopes: actor.kind === "agent" ? actor.scopes : undefined,
    reauthenticated: actor.kind === "person" ? actor.reauthenticated : false,
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

/** Adds the person's current membership in the workspace, if any. */
async function withMembership(
  tx: Transaction,
  actor: ResolvedActor,
  workspaceId: string,
): Promise<ResolvedActor> {
  if (!actor.personId) return actor
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
      (actor.agentSessionId !== undefined && !isId(actor.agentSessionId)))
  ) {
    return null
  }
  const [person] = await tx
    .select({ handle: schema.people.handle })
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
  }
}
