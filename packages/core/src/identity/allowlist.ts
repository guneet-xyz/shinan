import { asc, eq, inArray, schema, sql } from "@shinan/db"
import type { Transaction } from "@shinan/db"

import { atInstallation } from "../authorize.js"
import type { Context } from "../context.js"
import { RuleViolationError } from "../errors.js"
import { recordSecurityEntry } from "../security-log.js"
import { normalizeEmail } from "../validation.js"

export interface AllowlistEntry {
  email: string
  addedAt: Date
  /** Named in the installation's configuration as an operator. */
  operator: boolean
  /** The handle of the person with this address, if they have an account. */
  handle: string | null
}

/** Whether an address may have an account (identity §3.2). */
export async function isAllowlisted(
  tx: Pick<Transaction, "select">,
  email: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ email: schema.emailAllowlist.email })
    .from(schema.emailAllowlist)
    .where(eq(schema.emailAllowlist.email, email))
  return row !== undefined
}

/** The email allowlist, for operators (identity §3.2). */
export async function listAllowlist(ctx: Context): Promise<AllowlistEntry[]> {
  return atInstallation(ctx, "allowlist.read", async (scope) => {
    return scope.tx
      .select({
        email: schema.emailAllowlist.email,
        addedAt: schema.emailAllowlist.addedAt,
        operator: sql<boolean>`${schema.installationOperators.email} is not null`,
        handle: schema.people.handle,
      })
      .from(schema.emailAllowlist)
      .leftJoin(
        schema.installationOperators,
        eq(schema.installationOperators.email, schema.emailAllowlist.email),
      )
      .leftJoin(
        schema.people,
        eq(schema.people.email, schema.emailAllowlist.email),
      )
      .orderBy(asc(schema.emailAllowlist.email))
  })
}

/**
 * Adds an address to the allowlist. Being on it grants nothing in any
 * workspace (identity §3.2).
 */
export async function addToAllowlist(
  ctx: Context,
  input: { email: string },
): Promise<void> {
  await atInstallation(ctx, "allowlist.change", async (scope) => {
    const email = normalizeEmail(input.email)
    const added = await scope.tx
      .insert(schema.emailAllowlist)
      .values({ email })
      .onConflictDoNothing()
      .returning()
    if (added.length === 0) return
    await recordSecurityEntry(scope.tx, {
      workspaceId: null,
      action: "allowlist.added",
      outcome: "succeeded",
      actor: scope.actor,
      subjectPersonId: await personWith(scope.tx, email),
      request: scope.request,
      details: { email },
    })
  })
}

/**
 * Removes an address from the allowlist. Its person's sign-in sessions end
 * at once, and neither sign-in method works for them any more; agent tokens
 * are revoked too once agents exist (identity §3.2). Operators' own
 * addresses come from configuration and cannot be removed here.
 */
export async function removeFromAllowlist(
  ctx: Context,
  input: { email: string },
): Promise<void> {
  await atInstallation(ctx, "allowlist.change", async (scope) => {
    const email = normalizeEmail(input.email)
    const [operator] = await scope.tx
      .select()
      .from(schema.installationOperators)
      .where(eq(schema.installationOperators.email, email))
    if (operator) {
      throw new RuleViolationError(
        "operator-address",
        "Operators' addresses come from the installation's configuration; change it there",
      )
    }
    const removed = await scope.tx
      .delete(schema.emailAllowlist)
      .where(eq(schema.emailAllowlist.email, email))
      .returning()
    if (removed.length === 0) return
    const personId = await personWith(scope.tx, email)
    const ended = personId
      ? await scope.tx
          .delete(schema.signInSessions)
          .where(eq(schema.signInSessions.personId, personId))
          .returning({ id: schema.signInSessions.id })
      : []
    // Revoking the person's agent tokens in every workspace joins this when
    // agents exist (M2).
    await recordSecurityEntry(scope.tx, {
      workspaceId: null,
      action: "allowlist.removed",
      outcome: "succeeded",
      actor: scope.actor,
      subjectPersonId: personId,
      request: scope.request,
      details: { email, signInSessionsEnded: ended.length },
    })
  })
}

/**
 * Records the operators the installation's configuration names, and adds
 * their addresses to the allowlist (identity §3.2, §12). The `web` role
 * calls this on every start, so a configuration change takes effect then.
 * Every change is recorded in the installation-level security log.
 */
export async function syncOperators(
  ctx: Context,
  input: { emails: readonly string[] },
): Promise<void> {
  await atInstallation(ctx, "sign-in", async (scope) => {
    const emails = [...new Set(input.emails.map(normalizeEmail))].sort()
    const current = await scope.tx.select().from(schema.installationOperators)
    const before = new Set(current.map((row) => row.email))
    const gone = [...before].filter((email) => !emails.includes(email))
    if (gone.length > 0) {
      await scope.tx
        .delete(schema.installationOperators)
        .where(inArray(schema.installationOperators.email, gone))
    }
    for (const email of gone) {
      await recordSecurityEntry(scope.tx, {
        workspaceId: null,
        action: "operator.removed",
        outcome: "succeeded",
        actor: scope.actor,
        subjectPersonId: await personWith(scope.tx, email),
        request: scope.request,
        details: { email },
      })
    }
    for (const email of emails) {
      if (!before.has(email)) {
        await scope.tx.insert(schema.installationOperators).values({ email })
        await recordSecurityEntry(scope.tx, {
          workspaceId: null,
          action: "operator.added",
          outcome: "succeeded",
          actor: scope.actor,
          subjectPersonId: await personWith(scope.tx, email),
          request: scope.request,
          details: { email },
        })
      }
      const added = await scope.tx
        .insert(schema.emailAllowlist)
        .values({ email })
        .onConflictDoNothing()
        .returning()
      if (added.length > 0) {
        await recordSecurityEntry(scope.tx, {
          workspaceId: null,
          action: "allowlist.added",
          outcome: "succeeded",
          actor: scope.actor,
          subjectPersonId: await personWith(scope.tx, email),
          request: scope.request,
          details: { email, reason: "operator" },
        })
      }
    }
  })
}

export async function personWith(
  tx: Pick<Transaction, "select">,
  email: string,
): Promise<string | null> {
  const [person] = await tx
    .select({ id: schema.people.id })
    .from(schema.people)
    .where(eq(schema.people.email, email))
  return person?.id ?? null
}
