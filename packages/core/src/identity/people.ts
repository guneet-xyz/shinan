import { eq, or, schema, sql } from "@shinan/db"
import type { Transaction } from "@shinan/db"

import type { ResolvedActor } from "../actor.js"
import { atInstallation } from "../authorize.js"
import type { Context, RequestInfo } from "../context.js"
import { violatedUniqueConstraint } from "../database-errors.js"
import { RuleViolationError } from "../errors.js"
import { recordSecurityEntry } from "../security-log.js"
import { checkHandle, checkName, normalizeEmail } from "../validation.js"

export type Person = typeof schema.people.$inferSelect

export interface NewPerson {
  /** Chosen once and never changed (identity §8.7). */
  handle: string
  name: string
  email: string
}

/**
 * Creates a person's account with a given handle. Internal to core: the only
 * way an account is created on a running installation is `openSignInLink`
 * (identity §3.2), which calls `createAccount`. Tests use this to set up
 * people directly.
 */
export async function createPerson(
  ctx: Context,
  input: NewPerson,
): Promise<Person> {
  return atInstallation(ctx, "person.create", async (scope) => {
    const handle = checkHandle(input.handle)
    const name = checkName(input.name, "A person's name")
    const email = normalizeEmail(input.email)
    return insertPerson(scope, { handle, name, email })
  })
}

/**
 * Creates the account for an email address that has just been confirmed by
 * a magic link (identity §3.2). The handle is made from the address's local
 * part, with a number added if it is taken; the name starts as the handle
 * and the person can change it. Handles never change (identity §8.7).
 */
export async function createAccount(
  scope: {
    tx: Transaction
    actor: ResolvedActor
    request: RequestInfo
  },
  input: { email: string },
): Promise<Person> {
  const email = normalizeEmail(input.email)
  const base = handleFrom(email)
  const taken = await scope.tx
    .select({ handle: schema.people.handle })
    .from(schema.people)
    .where(sql`${schema.people.handle} ~ ${`^${base}(-[0-9]+)?$`}`)
  const used = new Set(taken.map((row) => row.handle))
  let handle = base
  for (let n = 2; used.has(handle); n++) handle = `${base}-${n}`
  return insertPerson(scope, { handle, name: handle, email })
}

/** Lowercase letters, digits and single hyphens from the local part. */
function handleFrom(email: string): string {
  const local = email.slice(0, email.lastIndexOf("@"))
  const handle = local
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "")
  return handle || "person"
}

async function insertPerson(
  scope: { tx: Transaction; actor: ResolvedActor; request: RequestInfo },
  input: NewPerson,
): Promise<Person> {
  const { handle, name, email } = input
  const [existing] = await scope.tx
    .select({ handle: schema.people.handle })
    .from(schema.people)
    .where(or(eq(schema.people.handle, handle), eq(schema.people.email, email)))
  if (existing) throw taken(existing.handle === handle ? "handle" : "email")

  // A concurrent request can still take the handle or address first; the
  // database's unique constraints catch that.
  const [person] = await scope.tx
    .insert(schema.people)
    .values({ handle, name, email })
    .returning()
    .catch((error: unknown) => {
      const constraint = violatedUniqueConstraint(error)
      if (constraint === "people_handle_unique") throw taken("handle")
      if (constraint === "people_email_unique") throw taken("email")
      throw error
    })
  await recordSecurityEntry(scope.tx, {
    workspaceId: null,
    action: "account.created",
    outcome: "succeeded",
    actor: scope.actor,
    subjectPersonId: person!.id,
    request: scope.request,
    details: { handle },
  })
  return person!
}

function taken(what: "handle" | "email"): RuleViolationError {
  return what === "handle"
    ? new RuleViolationError("handle-taken", "That handle is taken")
    : new RuleViolationError("email-taken", "That email address has an account")
}
