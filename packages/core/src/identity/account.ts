import { and, asc, eq, isNull, schema } from "@shinan/db"
import type { Role } from "@shinan/db"

import { atInstallation } from "../authorize.js"
import type { Context } from "../context.js"
import { NotFoundError } from "../errors.js"
import type { Person } from "./people.js"

export interface Account {
  person: Pick<Person, "id" | "handle" | "name" | "email" | "createdAt">
  /** The workspaces the person is a current member of, by name. */
  workspaces: AccountWorkspace[]
}

export interface AccountWorkspace {
  id: string
  name: string
  role: Role
  memberId: string
  joinedAt: Date
}

/**
 * The signed-in person's own account: their profile and their workspaces
 * with their role in each (human experience, Your account). Sign-in methods
 * and sessions belong to the sign-in layer (M1-4).
 */
export async function getAccount(ctx: Context): Promise<Account> {
  return atInstallation(ctx, "account.read", async (scope) => {
    // The rule admits only people, who always have a person ID.
    const personId = scope.actor.personId!
    const [person] = await scope.tx
      .select({
        id: schema.people.id,
        handle: schema.people.handle,
        name: schema.people.name,
        email: schema.people.email,
        createdAt: schema.people.createdAt,
      })
      .from(schema.people)
      .where(eq(schema.people.id, personId))
    if (!person) throw new NotFoundError()

    const workspaces = await scope.tx
      .select({
        id: schema.workspaces.id,
        name: schema.workspaces.name,
        role: schema.members.role,
        memberId: schema.members.id,
        joinedAt: schema.members.joinedAt,
      })
      .from(schema.members)
      .innerJoin(
        schema.workspaces,
        eq(schema.workspaces.id, schema.members.workspaceId),
      )
      .where(
        and(
          eq(schema.members.personId, personId),
          isNull(schema.members.removedAt),
        ),
      )
      .orderBy(asc(schema.workspaces.name), asc(schema.workspaces.id))
    return { person, workspaces }
  })
}
