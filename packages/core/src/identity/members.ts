import { alias, and, asc, eq, isNull, schema, sql } from "@shinan/db"
import type { Role } from "@shinan/db"

import { inWorkspace } from "../authorize.js"
import type { Context, WorkspaceScope } from "../context.js"
import { NotFoundError, RuleViolationError } from "../errors.js"
import { appendEvent } from "../events.js"
import type { WriteScope } from "../events.js"
import { recordSecurityEntry } from "../security-log.js"
import { checkRole, isId } from "../validation.js"
import { agentLabelsByMember, endAgentsOfMember } from "./agents.js"
import type { AgentLabel } from "./agents.js"

export type Member = typeof schema.members.$inferSelect

export interface MemberSummary {
  id: string
  personId: string
  handle: string
  name: string
  role: Role
  joinedAt: Date
  /** The handle of the person who invited them, if anyone did. */
  invitedByHandle: string | null
  /** The agents of this membership, enabled or not (identity §6.1). */
  agents: AgentLabel[]
}

/** Current members of the workspace, oldest first. */
export async function listMembers(
  ctx: Context,
  workspaceId: string,
): Promise<MemberSummary[]> {
  return inWorkspace(ctx, workspaceId, "workspace.read", async (scope) => {
    const members = await currentMembers(scope)
      .where(currentIn(scope))
      .orderBy(asc(schema.members.joinedAt), asc(schema.members.id))
    const agents = await agentLabelsByMember(scope.tx, scope.workspaceId)
    return members.map((member) => ({
      ...member,
      agents: agents.get(member.id) ?? [],
    }))
  })
}

/**
 * Adds a person to the workspace with a role. Joining needs an invitation
 * (D-034): invitations (M1-4) call this when one is accepted, and there is no
 * separate way to add someone.
 */
export async function addMember(
  ctx: Context,
  input: { workspaceId: string; personId: string; role: Role },
): Promise<MemberSummary> {
  return inWorkspace(ctx, input.workspaceId, "member.add", async (scope) => {
    const role = checkRole(input.role)
    if (!isId(input.personId)) throw new NotFoundError()
    await lockMemberships(scope)
    const [person] = await scope.tx
      .select({ handle: schema.people.handle, name: schema.people.name })
      .from(schema.people)
      .where(eq(schema.people.id, input.personId))
    if (!person) throw new NotFoundError()

    const [current] = await scope.tx
      .select({ id: schema.members.id })
      .from(schema.members)
      .where(and(currentIn(scope), eq(schema.members.personId, input.personId)))
    if (current) {
      throw new RuleViolationError(
        "already-member",
        "That person is already a member",
      )
    }

    const [member] = await scope.tx
      .insert(schema.members)
      .values({
        workspaceId: scope.workspaceId,
        personId: input.personId,
        role,
        invitedByMemberId: scope.actor.member!.id,
      })
      .returning()
    await record(scope, {
      kind: "member.added",
      memberId: member!.id,
      personId: input.personId,
      summary: `${scope.actor.label} added ${person.handle} as ${roleName[role]}`,
      data: { role },
    })
    return {
      id: member!.id,
      personId: member!.personId,
      handle: person.handle,
      name: person.name,
      role: member!.role,
      joinedAt: member!.joinedAt,
      invitedByHandle: scope.actor.label,
      agents: [],
    }
  })
}

/**
 * Changes a member's role. The last workspace owner cannot be lowered
 * (identity §4); the change applies from the next request (identity §5.3).
 */
export async function changeRole(
  ctx: Context,
  input: { workspaceId: string; memberId: string; role: Role },
): Promise<MemberSummary> {
  return inWorkspace(
    ctx,
    input.workspaceId,
    "member.change-role",
    async (scope) => {
      const role = checkRole(input.role)
      const member = await findCurrentMember(scope, input.memberId)
      if (member.role === role) return member
      if (member.role === "owner") await keepAnOwner(scope)

      await scope.tx
        .update(schema.members)
        .set({ role })
        .where(and(currentIn(scope), eq(schema.members.id, member.id)))
      await record(scope, {
        kind: "member.role-changed",
        memberId: member.id,
        personId: member.personId,
        summary: `${scope.actor.label} changed ${member.handle}'s role to ${roleName[role]}`,
        data: { from: member.role, to: role },
      })
      return { ...member, role }
    },
  )
}

/**
 * Removes a member. They lose access on their next request; their past
 * records stay credited to them (identity §5.3).
 */
export async function removeMember(
  ctx: Context,
  input: { workspaceId: string; memberId: string },
): Promise<void> {
  await inWorkspace(ctx, input.workspaceId, "member.remove", async (scope) => {
    const member = await findCurrentMember(scope, input.memberId)
    await endMembership(scope, member, {
      kind: "member.removed",
      summary: `${scope.actor.label} removed ${member.handle}`,
    })
  })
}

/** The actor leaves the workspace themselves (identity §5.3). */
export async function leaveWorkspace(
  ctx: Context,
  input: { workspaceId: string },
): Promise<void> {
  await inWorkspace(ctx, input.workspaceId, "member.leave", async (scope) => {
    const member = await findCurrentMember(scope, scope.actor.member!.id)
    await endMembership(scope, member, {
      kind: "member.left",
      summary: `${scope.actor.label} left the workspace`,
    })
  })
}

const roleName: Record<Role, string> = {
  owner: "workspace owner",
  contributor: "contributor",
}

/** Current (not removed) memberships in the scope's workspace. */
function currentIn(scope: WorkspaceScope) {
  return and(
    eq(schema.members.workspaceId, scope.workspaceId),
    isNull(schema.members.removedAt),
  )
}

const inviter = alias(schema.members, "inviter")
const inviterPerson = alias(schema.people, "inviter_person")

function currentMembers(scope: WorkspaceScope) {
  return scope.tx
    .select({
      id: schema.members.id,
      personId: schema.members.personId,
      handle: schema.people.handle,
      name: schema.people.name,
      role: schema.members.role,
      joinedAt: schema.members.joinedAt,
      invitedByHandle: inviterPerson.handle,
    })
    .from(schema.members)
    .innerJoin(schema.people, eq(schema.people.id, schema.members.personId))
    .leftJoin(inviter, eq(inviter.id, schema.members.invitedByMemberId))
    .leftJoin(inviterPerson, eq(inviterPerson.id, inviter.personId))
}

async function findCurrentMember(
  scope: WorkspaceScope,
  memberId: string,
): Promise<MemberSummary> {
  if (!isId(memberId)) throw new NotFoundError()
  await lockMemberships(scope)
  const [member] = await currentMembers(scope).where(
    and(currentIn(scope), eq(schema.members.id, memberId)),
  )
  if (!member) throw new NotFoundError()
  const agents = await agentLabelsByMember(scope.tx, scope.workspaceId)
  return { ...member, agents: agents.get(member.id) ?? [] }
}

/**
 * Serialises membership changes in one workspace by locking its row, so two
 * owners cannot lower or remove each other at the same time and leave the
 * workspace without an owner. Then checks again that the actor's membership
 * did not change while waiting for the lock.
 */
async function lockMemberships(scope: WorkspaceScope): Promise<void> {
  await scope.tx
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, scope.workspaceId))
    .for("update")

  const actor = scope.actor.member
  if (!actor) return
  const [current] = await scope.tx
    .select({ role: schema.members.role })
    .from(schema.members)
    .where(and(currentIn(scope), eq(schema.members.id, actor.id)))
  if (!current) throw new NotFoundError()
  if (current.role !== actor.role) {
    throw new RuleViolationError(
      "role-changed",
      "Your role changed while this request was waiting; try again",
    )
  }
}

/** Refuses to take away the role of the only workspace owner. */
async function keepAnOwner(scope: WorkspaceScope): Promise<void> {
  const owners = await scope.tx
    .select({ id: schema.members.id })
    .from(schema.members)
    .where(and(currentIn(scope), eq(schema.members.role, "owner")))
  if (owners.length <= 1) {
    throw new RuleViolationError(
      "last-owner",
      "A workspace always has at least one workspace owner",
    )
  }
}

async function endMembership(
  scope: WriteScope,
  member: MemberSummary,
  event: { kind: string; summary: string },
): Promise<void> {
  if (member.role === "owner") await keepAnOwner(scope)
  await scope.tx
    .update(schema.members)
    .set({ removedAt: sql`now()` })
    .where(and(currentIn(scope), eq(schema.members.id, member.id)))
  await endAgentsOfMember(
    scope,
    member.id,
    event.kind === "member.left" ? "member-left" : "member-removed",
  )
  await record(scope, {
    ...event,
    memberId: member.id,
    personId: member.personId,
    data: { role: member.role },
  })
}

/** Records a membership change as an event and in the security log. */
async function record(
  scope: WriteScope,
  change: {
    kind: string
    memberId: string
    personId: string
    summary: string
    data: Record<string, unknown>
  },
): Promise<void> {
  await appendEvent(scope, {
    kind: change.kind,
    subjects: [{ type: "member", id: change.memberId }],
    summary: change.summary,
    data: change.data,
  })
  await recordSecurityEntry(scope.tx, {
    workspaceId: scope.workspaceId,
    action: change.kind,
    outcome: "succeeded",
    actor: scope.actor,
    subjectPersonId: change.personId,
    request: scope.request,
    details: { memberId: change.memberId, ...change.data },
  })
}
