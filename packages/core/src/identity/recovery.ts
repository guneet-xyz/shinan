import { and, eq, schema, sql } from "@shinan/db"
import type { Transaction } from "@shinan/db"

import { atInstallation } from "../authorize.js"
import type { Context } from "../context.js"
import { NotFoundError, RuleViolationError } from "../errors.js"
import { recordSecurityEntry } from "../security-log.js"
import { normalizeEmail } from "../validation.js"

/**
 * Recovery by the installation operator through a server command (identity
 * §3.4): ends all of a person's sign-in sessions. Recorded in the
 * installation-level security log as Shinan, by operator command.
 */
export async function endSessionsOf(
  ctx: Context,
  input: { handle: string },
): Promise<number> {
  return atInstallation(ctx, "account.recover", async (scope) => {
    const person = await personByHandle(scope.tx, input.handle)
    const ended = await scope.tx
      .delete(schema.signInSessions)
      .where(eq(schema.signInSessions.personId, person.id))
      .returning({ id: schema.signInSessions.id })
    await recordSecurityEntry(scope.tx, {
      workspaceId: null,
      action: "account.sessions-ended",
      outcome: "succeeded",
      actor: scope.actor,
      subjectPersonId: person.id,
      request: scope.request,
      details: { sessionsEnded: ended.length, by: "operator command" },
    })
    return ended.length
  })
}

/**
 * Recovery for a person who lost their email account (identity §3.4): the
 * operator changes their address with a server command. In one transaction:
 * the new address is added to the allowlist; the old one is removed from it,
 * so whoever holds the
 * lost mailbox cannot sign in with it or create a new account with it; its
 * pending invitations are withdrawn, so nobody can accept them with it; and
 * the person's sign-in sessions end, so the next sign-in goes through the new
 * address. Withdrawn invitations are not moved to the new address: they were
 * sent to a mailbox that may be in someone else's hands, so a workspace
 * owner invites the new address again.
 *
 * An address the configuration still names as an operator's is refused:
 * operator rights come from the address, so whoever holds that mailbox would
 * get them. The operator replaces it in `SHINAN_OPERATORS` and restarts
 * first, which drops it from the operators, then runs the command.
 */
export async function changeEmailOf(
  ctx: Context,
  input: { handle: string; email: string },
): Promise<void> {
  await atInstallation(ctx, "account.recover", async (scope) => {
    const person = await personByHandle(scope.tx, input.handle)
    const email = normalizeEmail(input.email)
    if (email === person.email) return
    const [operator] = await scope.tx
      .select()
      .from(schema.installationOperators)
      .where(eq(schema.installationOperators.email, person.email))
    if (operator) {
      throw new RuleViolationError(
        "operator-address",
        `${person.email} is an operator address in SHINAN_OPERATORS. Replace it there with ${email} and restart Shinan, then run this command again.`,
      )
    }
    const [other] = await scope.tx
      .select({ id: schema.people.id })
      .from(schema.people)
      .where(eq(schema.people.email, email))
    if (other) {
      throw new RuleViolationError(
        "email-taken",
        "That email address has another account",
      )
    }
    await scope.tx
      .update(schema.people)
      .set({ email, updatedAt: sql`now()` })
      .where(eq(schema.people.id, person.id))
    const added = await scope.tx
      .insert(schema.emailAllowlist)
      .values({ email })
      .onConflictDoNothing()
      .returning()
    const removed = await scope.tx
      .delete(schema.emailAllowlist)
      .where(eq(schema.emailAllowlist.email, person.email))
      .returning()
    const withdrawn = await scope.tx
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
    await scope.tx
      .delete(schema.pendingGitHubSignIns)
      .where(eq(schema.pendingGitHubSignIns.email, person.email))
    const ended = await scope.tx
      .delete(schema.signInSessions)
      .where(eq(schema.signInSessions.personId, person.id))
      .returning({ id: schema.signInSessions.id })
    const entry = {
      workspaceId: null,
      outcome: "succeeded" as const,
      actor: scope.actor,
      subjectPersonId: person.id,
      request: scope.request,
    }
    if (added.length > 0) {
      await recordSecurityEntry(scope.tx, {
        ...entry,
        action: "allowlist.added",
        details: { email, by: "operator command" },
      })
    }
    if (removed.length > 0) {
      await recordSecurityEntry(scope.tx, {
        ...entry,
        action: "allowlist.removed",
        details: { email: person.email, by: "operator command" },
      })
    }
    for (const invitation of withdrawn) {
      await recordSecurityEntry(scope.tx, {
        ...entry,
        workspaceId: invitation.workspaceId,
        action: "invitation.withdrawn",
        details: {
          invitationId: invitation.id,
          email: invitation.email,
          role: invitation.role,
          reason: "email-changed",
          by: "operator command",
        },
      })
    }
    await recordSecurityEntry(scope.tx, {
      ...entry,
      action: "account.email-changed",
      details: {
        from: person.email,
        to: email,
        sessionsEnded: ended.length,
        invitationsWithdrawn: withdrawn.length,
        by: "operator command",
      },
    })
  })
}

async function personByHandle(tx: Transaction, handle: string) {
  const [person] = await tx
    .select({ id: schema.people.id, email: schema.people.email })
    .from(schema.people)
    .where(eq(schema.people.handle, handle))
  if (!person) throw new NotFoundError()
  return person
}
