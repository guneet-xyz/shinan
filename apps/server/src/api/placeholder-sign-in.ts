// PLACEHOLDER until sign-in (M1-4) exists. Remove this file then.
//
// Development needs a signed-in person to use the web app before there is a
// way to sign in. This makes every request the same person, picked by the
// SHINAN_PLACEHOLDER_PERSON setting, and refuses to run in production.

import {
  createPerson,
  createWorkspace,
  getAccount,
  RuleViolationError,
  shinan,
} from "@shinan/core"
import type { PersonActor } from "@shinan/core"
import { eq, schema } from "@shinan/db"
import type { Database } from "@shinan/db"

import type { SignIn } from "./sign-in.js"

/**
 * Signs every request in as the person with `handle`, creating them (and a
 * first workspace, so there is something to look at) if needed. They always
 * count as recently re-authenticated.
 */
export async function placeholderSignIn(
  db: Database,
  handle: string,
  env: { NODE_ENV?: string },
): Promise<SignIn> {
  if (env.NODE_ENV === "production") {
    throw new Error(
      "SHINAN_PLACEHOLDER_PERSON is for development only and cannot be used in production",
    )
  }

  const personId = await findOrCreatePerson(db, handle)
  const person: PersonActor = {
    kind: "person",
    personId,
    reauthenticated: true,
  }
  const account = await getAccount({ db, actor: person })
  if (account.workspaces.length === 0) {
    await createWorkspace({ db, actor: person }, { name: "Development" })
  }

  console.warn(
    `Placeholder sign-in: every request is signed in as "${handle}" (development only)`,
  )
  return { currentPerson: () => Promise.resolve(person) }
}

async function findOrCreatePerson(db: Database, handle: string) {
  try {
    const person = await createPerson(
      { db, actor: shinan },
      { handle, name: handle, email: `${handle}@localhost` },
    )
    return person.id
  } catch (error) {
    if (!(error instanceof RuleViolationError)) throw error
    // Reads the person directly: core has no lookup by handle, and the sign-in
    // layer that replaces this finds people its own way.
    const [person] = await db
      .select({ id: schema.people.id })
      .from(schema.people)
      .where(eq(schema.people.handle, handle))
    if (!person) throw error
    return person.id
  }
}
