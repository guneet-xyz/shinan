import { and, eq, ne, schema, sql } from "@shinan/db"
import type { Transaction } from "@shinan/db"

import type { ResolvedActor } from "../actor.js"
import type { RequestInfo } from "../context.js"
import { violatedUniqueConstraint } from "../database-errors.js"
import { RuleViolationError } from "../errors.js"
import { recordSecurityEntry } from "../security-log.js"

/** What moving an address needs: a transaction, an actor and a request. */
interface MoveScope {
  tx: Transaction
  actor: ResolvedActor
  request: RequestInfo
}

/**
 * Moves a person to a new email address (identity §3.4), the one step both
 * the operator's recovery command and the person's own confirmed change
 * take. In the caller's transaction:
 *
 * - the person's address becomes `email`, which no other person may have;
 * - the old address leaves the allowlist, so whoever holds the old mailbox
 *   cannot sign in with it or create a new account with it;
 * - invitations still pending for the old address are withdrawn, so nobody
 *   can accept them with it, and a GitHub sign-in waiting for it is
 *   dropped;
 * - the person's sign-in sessions end, all of them or all but `keepSession`;
 * - each of these is recorded in the security log, with `by`.
 *
 * Withdrawn invitations are not moved to the new address: they were sent to
 * a mailbox that may be in someone else's hands, so a workspace owner
 * invites the new address again. The caller checks who may move the
 * address, and whether the new one is allowed.
 */
export async function moveEmailAddress(
  scope: MoveScope,
  person: { id: string; email: string },
  email: string,
  options: {
    /** Recorded with each entry, such as `operator command`. */
    by: string
    /** Also adds the new address to the allowlist (the operator's command). */
    addToAllowlist: boolean
    /** A sign-in session to keep: the one the person confirmed from. */
    keepSession?: string
  },
): Promise<{ sessionsEnded: number; invitationsWithdrawn: number }> {
  const { tx } = scope
  await tx
    .update(schema.people)
    .set({ email, updatedAt: sql`now()` })
    .where(eq(schema.people.id, person.id))
    .catch((error: unknown) => {
      if (violatedUniqueConstraint(error))
        throw new RuleViolationError(
          "email-taken",
          "That email address has another account",
        )
      throw error
    })
  const added = options.addToAllowlist
    ? await tx
        .insert(schema.emailAllowlist)
        .values({ email })
        .onConflictDoNothing()
        .returning()
    : []
  const removed = await tx
    .delete(schema.emailAllowlist)
    .where(eq(schema.emailAllowlist.email, person.email))
    .returning()
  // The workspaces of those invitations first, in a fixed order, as inviting
  // and the expiry job lock a workspace before its invitations: today only
  // security-log entries follow, which do not lock the workspace, but an
  // event about the withdrawal would, and must not deadlock with them.
  const affected = await tx
    .selectDistinct({ workspaceId: schema.invitations.workspaceId })
    .from(schema.invitations)
    .where(
      and(
        eq(schema.invitations.email, person.email),
        eq(schema.invitations.state, "pending"),
      ),
    )
    .orderBy(schema.invitations.workspaceId)
  for (const { workspaceId } of affected)
    await tx
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId))
      .for("update")
  const withdrawn = await tx
    .update(schema.invitations)
    .set({ state: "withdrawn", decidedAt: sql`now()` })
    .where(
      and(
        eq(schema.invitations.email, person.email),
        eq(schema.invitations.state, "pending"),
      ),
    )
    .returning()
  // A GitHub sign-in waiting for the old address must not complete either.
  await tx
    .delete(schema.pendingGitHubSignIns)
    .where(eq(schema.pendingGitHubSignIns.email, person.email))
  // Nor a change to an address someone else asked for: it is taken now.
  await tx
    .delete(schema.emailChanges)
    .where(
      and(
        eq(schema.emailChanges.email, email),
        ne(schema.emailChanges.personId, person.id),
      ),
    )
  const ended = await tx
    .delete(schema.signInSessions)
    .where(
      and(
        eq(schema.signInSessions.personId, person.id),
        options.keepSession === undefined
          ? undefined
          : ne(schema.signInSessions.id, options.keepSession),
      ),
    )
    .returning({ id: schema.signInSessions.id })

  const entry = {
    workspaceId: null,
    outcome: "succeeded" as const,
    actor: scope.actor,
    subjectPersonId: person.id,
    request: scope.request,
  }
  if (added.length > 0)
    await recordSecurityEntry(tx, {
      ...entry,
      action: "allowlist.added",
      details: { email, by: options.by },
    })
  if (removed.length > 0)
    await recordSecurityEntry(tx, {
      ...entry,
      action: "allowlist.removed",
      details: { email: person.email, by: options.by },
    })
  for (const invitation of withdrawn)
    await recordSecurityEntry(tx, {
      ...entry,
      workspaceId: invitation.workspaceId,
      action: "invitation.withdrawn",
      details: {
        invitationId: invitation.id,
        email: invitation.email,
        role: invitation.role,
        reason: "email-changed",
        by: options.by,
      },
    })
  await recordSecurityEntry(tx, {
    ...entry,
    action: "account.email-changed",
    details: {
      from: person.email,
      to: email,
      sessionsEnded: ended.length,
      invitationsWithdrawn: withdrawn.length,
      by: options.by,
    },
  })
  return { sessionsEnded: ended.length, invitationsWithdrawn: withdrawn.length }
}
