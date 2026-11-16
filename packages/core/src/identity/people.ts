import { eq, or, schema } from "@shinan/db"

import { atInstallation } from "../authorize.js"
import type { Context } from "../context.js"
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
 * Creates a person's account. Shinan does this when an allowlisted person
 * first signs in (identity §3.2); the sign-in flow arrives in M1-4.
 */
export async function createPerson(
  ctx: Context,
  input: NewPerson,
): Promise<Person> {
  const handle = checkHandle(input.handle)
  const name = checkName(input.name, "A person's name")
  const email = normalizeEmail(input.email)

  return atInstallation(ctx, "person.create", async (scope) => {
    const [existing] = await scope.tx
      .select({ handle: schema.people.handle })
      .from(schema.people)
      .where(
        or(eq(schema.people.handle, handle), eq(schema.people.email, email)),
      )
    if (existing) {
      throw existing.handle === handle
        ? new RuleViolationError("handle-taken", "That handle is taken")
        : new RuleViolationError(
            "email-taken",
            "That email address has an account",
          )
    }

    const [person] = await scope.tx
      .insert(schema.people)
      .values({ handle, name, email })
      .returning()
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
  })
}
