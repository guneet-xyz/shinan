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
 * take `action` in the workspace, then runs `work` with the resulting scope.
 * Every workspace operation goes through here, so there is one check path
 * whichever way the request arrived (identity §9.1).
 *
 * Refusals are recorded in the security log after the transaction has rolled
 * back, so the record survives (identity §11). A non-member gets the same
 * answer as for a workspace that does not exist.
 */
export async function inWorkspace<T>(
  ctx: Context,
  workspaceId: string,
  action: WorkspaceAction,
  work: (scope: WorkspaceScope) => Promise<T>,
): Promise<T> {
  if (!isId(workspaceId)) throw new NotFoundError()
  return withRefusalsRecorded(ctx, () =>
    ctx.db.transaction(async (tx) => {
      const actor = await resolveWorkspaceActor(tx, ctx.actor, workspaceId)
      if (!actor) throw new NotFoundError()
      check(action, actor, requesterFor(ctx.actor, actor), workspaceId)
      return work(workspaceScope(tx, ctx, workspaceId, actor))
    }),
  )
}

/** Like `inWorkspace`, for actions outside any workspace. */
export async function atInstallation<T>(
  ctx: Context,
  action: InstallationAction,
  work: (scope: InstallationScope) => Promise<T>,
): Promise<T> {
  return withRefusalsRecorded(ctx, () =>
    ctx.db.transaction(async (tx) => {
      const actor = await resolveActor(tx, ctx.actor)
      if (!actor) throw new NotFoundError()
      check(action, actor, requesterFor(ctx.actor, actor), null)
      return work({
        tx,
        actor,
        origin: ctx.origin ?? "shinan_action",
        request: ctx.request ?? {},
      } as InstallationScope)
    }),
  )
}

/**
 * A scope for a workspace created in this transaction, whose first owner is
 * the actor. Only workspace creation uses it.
 */
export function newWorkspaceScope(
  scope: InstallationScope,
  workspaceId: string,
  member: { id: string; role: "owner" },
): WorkspaceScope {
  return {
    tx: scope.tx,
    workspaceId,
    actor: { ...scope.actor, member },
    origin: scope.origin,
    request: scope.request,
  } as WorkspaceScope
}

function workspaceScope(
  tx: Transaction,
  ctx: Context,
  workspaceId: string,
  actor: ResolvedActor,
): WorkspaceScope {
  return {
    tx,
    workspaceId,
    actor,
    origin: ctx.origin ?? "shinan_action",
    request: ctx.request ?? {},
  } as WorkspaceScope
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
): void {
  const decision = decide(rules[action], requester)
  if (!decision.allowed) {
    throw new Refusal(action, decision.reason, actor, workspaceId)
  }
}

/** Raised inside the transaction; turned into a public error outside it. */
class Refusal extends Error {
  constructor(
    readonly action: Action,
    readonly reason: RefusalReason,
    readonly actor: ResolvedActor,
    readonly workspaceId: string | null,
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
 * Resolves the actor for a workspace: the person (or the agent's person) and
 * their current membership. Returns null when the actor's person does not
 * exist, or when an agent is used outside its own workspace.
 */
async function resolveWorkspaceActor(
  tx: Transaction,
  actor: Actor,
  workspaceId: string,
): Promise<ResolvedActor | null> {
  if (actor.kind === "agent" && actor.workspaceId !== workspaceId) return null
  const resolved = await resolveActor(tx, actor)
  if (!resolved?.personId) return resolved

  const [member] = await tx
    .select({ id: schema.members.id, role: schema.members.role })
    .from(schema.members)
    .where(
      and(
        eq(schema.members.workspaceId, workspaceId),
        eq(schema.members.personId, resolved.personId),
        isNull(schema.members.removedAt),
      ),
    )
  return { ...resolved, member: member ?? null }
}

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
