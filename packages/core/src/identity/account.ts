import { and, asc, eq, isNull, schema } from "@shinan/db"
import type { Role } from "@shinan/db"

import { atInstallation } from "../authorize.js"
import type { Context } from "../context.js"
import { NotFoundError } from "../errors.js"
import type { Person } from "./people.js"
import { githubMethodOf } from "./sign-in.js"
import type { GitHubSignInMethod } from "./sign-in.js"

export interface Account {
  person: Pick<Person, "id" | "handle" | "name" | "email" | "createdAt">
  /** The workspaces the person is a current member of, by name. */
  workspaces: AccountWorkspace[]
  /**
   * How the person signs in (identity §3.1): always an email magic link to
   * their address, and GitHub if they linked it.
   */
  signInMethods: { email: string; github: GitHubSignInMethod | null }
  /** Whether the person is an installation operator (identity §12). */
  operator: boolean
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
 * with their role in each, and how they sign in (human experience, Your
 * account).
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
    return {
      person,
      workspaces,
      signInMethods: {
        email: person.email,
        github: await githubMethodOf(scope.tx, personId),
      },
      operator: scope.actor.operator,
    }
  })
}
