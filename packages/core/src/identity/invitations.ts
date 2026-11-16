import { alias, and, desc, eq, gt, isNull, or, schema, sql } from "@shinan/db"
import type { InvitationState, Role, Transaction } from "@shinan/db"

import {
  atInstallation,
  inWorkspace,
  joinWorkspaceByInvitation,
} from "../authorize.js"
import type { Context, WorkspaceScope } from "../context.js"
import { queueEmail } from "../email/queue.js"
import { invitationEmail } from "../email/templates.js"
import { NotFoundError, RuleViolationError } from "../errors.js"
import { appendEvent } from "../events.js"
import type { WriteScope } from "../events.js"
import { recordSecurityEntry } from "../security-log.js"
import { hashToken, newToken } from "../tokens.js"
import { checkRole, isId, normalizeEmail } from "../validation.js"
import { isAllowlisted, personWith } from "./allowlist.js"
import { getInstallation } from "./installation.js"
import { installationLink } from "./sign-in.js"

/** Invitation links expire after 7 days (identity §5.2, §7.1). */
export const invitationDays = 7

/** An invitation as the workspace's owners see it. */
export interface Invitation {
  id: string
  email: string
  role: Role
  /** A pending invitation past its expiry is shown as `expired`. */
  state: InvitationState
  invitedByHandle: string
  createdAt: Date
  expiresAt: Date
}

/** An invitation as the invited person sees it (identity §5.2). */
export interface InvitationForYou {
  id: string
  workspaceId: string
  workspaceName: string
  invitedByHandle: string
  role: Role
  expiresAt: Date
}

const inviter = alias(schema.members, "inviter")
const inviterPerson = alias(schema.people, "inviter_person")

/**
 * The workspace's pending, expired and declined invitations, pending first
 * (human experience, Workspace settings). Workspace owners only.
 */
export async function listInvitations(
  ctx: Context,
  workspaceId: string,
): Promise<Invitation[]> {
  return inWorkspace(ctx, workspaceId, "invitation.read", async (scope) => {
    const rows = await invitationRows(scope.tx)
      .where(
        and(
          eq(schema.invitations.workspaceId, scope.workspaceId),
          or(
            eq(schema.invitations.state, "pending"),
            eq(schema.invitations.state, "expired"),
            eq(schema.invitations.state, "declined"),
          ),
        ),
      )
      .orderBy(desc(schema.invitations.createdAt))
    const invitations = rows.map(withExpiry)
    return [
      ...invitations.filter((i) => i.state === "pending"),
      ...invitations.filter((i) => i.state !== "pending"),
    ]
  })
}

/**
 * Invites an email address to the workspace with a role, and emails the
 * link (identity §5.2). The address must be on the email allowlist; if it
 * is not, the inviter is told to ask an installation operator (O-48).
 */
export async function createInvitation(
  ctx: Context,
  input: { workspaceId: string; email: string; role: Role },
): Promise<Invitation> {
  return inWorkspace(ctx, input.workspaceId, "member.invite", async (scope) => {
    const role = checkRole(input.role)
    const email = normalizeEmail(input.email)
    await lockWorkspace(scope)
    await checkInvitable(scope, email)

    const [earlier] = await scope.tx
      .select()
      .from(schema.invitations)
      .where(
        and(
          eq(schema.invitations.workspaceId, scope.workspaceId),
          eq(schema.invitations.email, email),
          eq(schema.invitations.state, "pending"),
        ),
      )
    if (earlier) {
      if (earlier.expiresAt.getTime() > Date.now()) {
        throw new RuleViolationError(
          "already-invited",
          "That address already has a pending invitation; send it again instead",
        )
      }
      await scope.tx
        .update(schema.invitations)
        .set({ state: "expired", decidedAt: sql`now()` })
        .where(eq(schema.invitations.id, earlier.id))
    }

    const token = newToken()
    const [invitation] = await scope.tx
      .insert(schema.invitations)
      .values({
        workspaceId: scope.workspaceId,
        email,
        role,
        tokenHash: hashToken(token),
        invitedByMemberId: scope.actor.member!.id,
        expiresAt: sql`now() + make_interval(days => ${invitationDays})`,
      })
      .returning()
    await sendInvitation(scope, invitation!, token)
    await recordInvitation(scope, "invitation.created", invitation!, {
      summary: `${scope.actor.label} invited ${email} as ${roleName[role]}`,
    })
    return withExpiry({
      id: invitation!.id,
      email: invitation!.email,
      role: invitation!.role,
      state: invitation!.state,
      invitedByHandle: scope.actor.label,
      createdAt: invitation!.createdAt,
      expiresAt: invitation!.expiresAt,
    })
  })
}

/**
 * Sends a pending (or expired) invitation again with a new link, valid for
 * another 7 days; the old link stops working. The address must still be on
 * the allowlist.
 */
export async function resendInvitation(
  ctx: Context,
  input: { workspaceId: string; invitationId: string },
): Promise<Invitation> {
  return inWorkspace(ctx, input.workspaceId, "member.invite", async (scope) => {
    const invitation = await pendingInvitation(scope, input.invitationId)
    await checkInvitable(scope, invitation.email)
    const token = newToken()
    const [updated] = await scope.tx
      .update(schema.invitations)
      .set({
        tokenHash: hashToken(token),
        expiresAt: sql`now() + make_interval(days => ${invitationDays})`,
      })
      .where(eq(schema.invitations.id, invitation.id))
      .returning()
    await sendInvitation(scope, updated!, token)
    await recordInvitation(scope, "invitation.resent", updated!, {
      summary: `${scope.actor.label} sent the invitation for ${invitation.email} again`,
    })
    const [row] = await invitationRows(scope.tx).where(
      eq(schema.invitations.id, invitation.id),
    )
    return withExpiry(row!)
  })
}

/** Withdraws a pending invitation; its link stops working (identity §5.2). */
export async function withdrawInvitation(
  ctx: Context,
  input: { workspaceId: string; invitationId: string },
): Promise<void> {
  await inWorkspace(
    ctx,
    input.workspaceId,
    "invitation.withdraw",
    async (scope) => {
      const invitation = await pendingInvitation(scope, input.invitationId)
      await scope.tx
        .update(schema.invitations)
        .set({ state: "withdrawn", decidedAt: sql`now()` })
        .where(eq(schema.invitations.id, invitation.id))
      await recordInvitation(scope, "invitation.withdrawn", invitation, {
        summary: `${scope.actor.label} withdrew the invitation for ${invitation.email}`,
      })
    },
  )
}

/**
 * The signed-in person's pending invitations: those to their own address
 * that have not expired (human experience, Your account).
 */
export async function listInvitationsForYou(
  ctx: Context,
): Promise<InvitationForYou[]> {
  return atInstallation(ctx, "account.read", async (scope) => {
    const email = await emailOf(scope.tx, scope.actor.personId!)
    return invitationsForYou(scope.tx)
      .where(
        and(
          eq(schema.invitations.email, email),
          eq(schema.invitations.state, "pending"),
          gt(schema.invitations.expiresAt, sql`now()`),
        ),
      )
      .orderBy(desc(schema.invitations.createdAt))
  })
}

/**
 * The invitation behind an emailed link, for the signed-in person it was
 * sent to. A link that is unknown, used, withdrawn, expired or for another
 * address answers not found (identity §5.2: a leaked link alone is useless).
 */
export async function findInvitation(
  ctx: Context,
  input: { token: string },
): Promise<InvitationForYou> {
  return atInstallation(ctx, "account.read", async (scope) => {
    const email = await emailOf(scope.tx, scope.actor.personId!)
    const [invitation] = await invitationsForYou(scope.tx).where(
      and(
        eq(schema.invitations.tokenHash, hashToken(input.token)),
        eq(schema.invitations.email, email),
        eq(schema.invitations.state, "pending"),
        gt(schema.invitations.expiresAt, sql`now()`),
      ),
    )
    if (!invitation) throw new NotFoundError()
    return invitation
  })
}

export type InvitationKey = { token: string } | { invitationId: string }

/**
 * Accepts an invitation to the signed-in person's own verified address: they
 * become a member with the invitation's role (identity §5.2, D-034).
 */
export async function acceptInvitation(
  ctx: Context,
  input: InvitationKey,
): Promise<{ workspaceId: string; memberId: string }> {
  return atInstallation(ctx, "invitation.respond", async (installation) => {
    const invitation = await invitationToRespondTo(installation, input)
    const [current] = await installation.tx
      .select({ id: schema.members.id })
      .from(schema.members)
      .where(
        and(
          eq(schema.members.workspaceId, invitation.workspaceId),
          eq(schema.members.personId, installation.actor.personId!),
          isNull(schema.members.removedAt),
        ),
      )
    if (current) {
      throw new RuleViolationError(
        "already-member",
        "You are already a member of that workspace",
      )
    }
    const { member, scope } = await joinWorkspaceByInvitation(installation, {
      workspaceId: invitation.workspaceId,
      role: invitation.role,
      invitedByMemberId: invitation.invitedByMemberId,
    })
    await scope.tx
      .update(schema.invitations)
      .set({ state: "accepted", decidedAt: sql`now()`, memberId: member.id })
      .where(eq(schema.invitations.id, invitation.id))
    const [by] = await scope.tx
      .select({ handle: schema.people.handle })
      .from(schema.members)
      .innerJoin(schema.people, eq(schema.people.id, schema.members.personId))
      .where(eq(schema.members.id, invitation.invitedByMemberId))
    await appendEvent(scope, {
      kind: "member.joined",
      subjects: [
        { type: "member", id: member.id },
        { type: "invitation", id: invitation.id },
      ],
      summary: `${scope.actor.label} joined as ${roleName[member.role]}, invited by ${by?.handle ?? "a former member"}`,
      data: { role: member.role, invitationId: invitation.id },
    })
    await recordSecurityEntry(scope.tx, {
      workspaceId: scope.workspaceId,
      action: "invitation.accepted",
      outcome: "succeeded",
      actor: scope.actor,
      request: scope.request,
      details: {
        invitationId: invitation.id,
        memberId: member.id,
        role: member.role,
      },
    })
    return { workspaceId: invitation.workspaceId, memberId: member.id }
  })
}

/** Declines an invitation to the signed-in person's own address. */
export async function declineInvitation(
  ctx: Context,
  input: InvitationKey,
): Promise<void> {
  await atInstallation(ctx, "invitation.respond", async (scope) => {
    const invitation = await invitationToRespondTo(scope, input)
    await scope.tx
      .update(schema.invitations)
      .set({ state: "declined", decidedAt: sql`now()` })
      .where(eq(schema.invitations.id, invitation.id))
    // The workspace's log: it invited this address, so it learns nothing new.
    await recordSecurityEntry(scope.tx, {
      workspaceId: invitation.workspaceId,
      action: "invitation.declined",
      outcome: "succeeded",
      actor: scope.actor,
      request: scope.request,
      details: { invitationId: invitation.id, role: invitation.role },
    })
  })
}

const roleName: Record<Role, string> = {
  owner: "workspace owner",
  contributor: "contributor",
}

function invitationRows(tx: Transaction) {
  return tx
    .select({
      id: schema.invitations.id,
      email: schema.invitations.email,
      role: schema.invitations.role,
      state: schema.invitations.state,
      invitedByHandle: inviterPerson.handle,
      createdAt: schema.invitations.createdAt,
      expiresAt: schema.invitations.expiresAt,
    })
    .from(schema.invitations)
    .innerJoin(inviter, eq(inviter.id, schema.invitations.invitedByMemberId))
    .innerJoin(inviterPerson, eq(inviterPerson.id, inviter.personId))
}

function invitationsForYou(tx: Transaction) {
  return tx
    .select({
      id: schema.invitations.id,
      workspaceId: schema.invitations.workspaceId,
      workspaceName: schema.workspaces.name,
      invitedByHandle: inviterPerson.handle,
      role: schema.invitations.role,
      expiresAt: schema.invitations.expiresAt,
    })
    .from(schema.invitations)
    .innerJoin(
      schema.workspaces,
      eq(schema.workspaces.id, schema.invitations.workspaceId),
    )
    .innerJoin(inviter, eq(inviter.id, schema.invitations.invitedByMemberId))
    .innerJoin(inviterPerson, eq(inviterPerson.id, inviter.personId))
}

function withExpiry<T extends { state: InvitationState; expiresAt: Date }>(
  row: T,
): T {
  return row.state === "pending" && row.expiresAt.getTime() <= Date.now()
    ? { ...row, state: "expired" }
    : row
}

async function emailOf(tx: Transaction, personId: string): Promise<string> {
  const [person] = await tx
    .select({ email: schema.people.email })
    .from(schema.people)
    .where(eq(schema.people.id, personId))
  if (!person) throw new NotFoundError()
  return person.email
}

/** Serialises invitations and membership changes in one workspace. */
async function lockWorkspace(scope: WorkspaceScope): Promise<void> {
  await scope.tx
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, scope.workspaceId))
    .for("update")
}

/** The address must be allowlisted and not already belong to a member. */
async function checkInvitable(
  scope: WorkspaceScope,
  email: string,
): Promise<void> {
  if (!(await isAllowlisted(scope.tx, email))) {
    throw new RuleViolationError(
      "not-allowlisted",
      "That address is not on the installation's email allowlist. Ask an installation operator to add it, then invite it again.",
    )
  }
  const [member] = await scope.tx
    .select({ id: schema.members.id })
    .from(schema.members)
    .innerJoin(schema.people, eq(schema.people.id, schema.members.personId))
    .where(
      and(
        eq(schema.members.workspaceId, scope.workspaceId),
        eq(schema.people.email, email),
        isNull(schema.members.removedAt),
      ),
    )
  if (member) {
    throw new RuleViolationError(
      "already-member",
      "Someone with that address is already a member",
    )
  }
}

async function pendingInvitation(scope: WorkspaceScope, invitationId: string) {
  if (!isId(invitationId)) throw new NotFoundError()
  const [invitation] = await scope.tx
    .select()
    .from(schema.invitations)
    .where(
      and(
        eq(schema.invitations.id, invitationId),
        eq(schema.invitations.workspaceId, scope.workspaceId),
        eq(schema.invitations.state, "pending"),
      ),
    )
    .for("update")
  if (!invitation) throw new NotFoundError()
  return invitation
}

async function invitationToRespondTo(
  scope: { tx: Transaction; actor: { personId: string | null } },
  input: InvitationKey,
) {
  const email = await emailOf(scope.tx, scope.actor.personId!)
  const key =
    "token" in input
      ? eq(schema.invitations.tokenHash, hashToken(input.token))
      : isId(input.invitationId)
        ? eq(schema.invitations.id, input.invitationId)
        : undefined
  if (!key) throw new NotFoundError()
  const [invitation] = await scope.tx
    .select()
    .from(schema.invitations)
    .where(
      and(
        key,
        eq(schema.invitations.email, email),
        eq(schema.invitations.state, "pending"),
      ),
    )
    .for("update")
  if (!invitation || invitation.expiresAt.getTime() <= Date.now()) {
    throw new NotFoundError()
  }
  return invitation
}

async function sendInvitation(
  scope: WorkspaceScope,
  invitation: typeof schema.invitations.$inferSelect,
  token: string,
): Promise<void> {
  const installation = await getInstallation(scope.tx)
  const [workspace] = await scope.tx
    .select({ name: schema.workspaces.name })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, scope.workspaceId))
  // The token goes in the fragment, which browsers never send to servers,
  // so it stays out of logs and Referer headers.
  const link = `${installationLink(scope, "/invitation")}#${token}`
  await queueEmail(scope, {
    kind: "invitation",
    to: invitation.email,
    content: invitationEmail({
      installationName: installation?.name ?? "Shinan",
      workspaceName: workspace!.name,
      invitedBy: scope.actor.label,
      role: invitation.role,
      link,
      expiresAt: invitation.expiresAt,
    }),
  })
}

async function recordInvitation(
  scope: WriteScope,
  kind: string,
  invitation: typeof schema.invitations.$inferSelect,
  event: { summary: string },
): Promise<void> {
  await appendEvent(scope, {
    kind,
    subjects: [{ type: "invitation", id: invitation.id }],
    summary: event.summary,
    data: { email: invitation.email, role: invitation.role },
  })
  await recordSecurityEntry(scope.tx, {
    workspaceId: scope.workspaceId,
    action: kind,
    outcome: "succeeded",
    actor: scope.actor,
    subjectPersonId: await personWith(scope.tx, invitation.email),
    request: scope.request,
    details: {
      invitationId: invitation.id,
      email: invitation.email,
      role: invitation.role,
    },
  })
}
