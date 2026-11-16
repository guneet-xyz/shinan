import { eq, schema, sql } from "@shinan/db"
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
 * operator changes their address with a server command. The new address
 * is added to the allowlist, and their sign-in sessions end, so the next
 * sign-in goes through the new address.
 */
export async function changeEmailOf(
  ctx: Context,
  input: { handle: string; email: string },
): Promise<void> {
  await atInstallation(ctx, "account.recover", async (scope) => {
    const person = await personByHandle(scope.tx, input.handle)
    const email = normalizeEmail(input.email)
    if (email === person.email) return
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
    await recordSecurityEntry(scope.tx, {
      ...entry,
      action: "account.email-changed",
      details: {
        from: person.email,
        to: email,
        sessionsEnded: ended.length,
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
