import { randomBytes } from "node:crypto"

import type { Person } from "@shinan/core"
import { schema } from "@shinan/db"
import type { Database } from "@shinan/db"

/**
 * A person, written straight to the database. On a running installation
 * only opening a sign-in link creates accounts (core's `openSignInLink`);
 * route tests only need someone to sign in as.
 */
export async function insertPerson(
  db: Database,
  prefix = "person",
): Promise<Person> {
  const handle = `${prefix}-${randomBytes(4).toString("hex")}`
  const [person] = await db
    .insert(schema.people)
    .values({
      handle,
      name: `Person ${handle}`,
      email: `${handle}@example.com`,
    })
    .returning()
  return person!
}
