import { eq, schema } from "@shinan/db"
import type { Database } from "@shinan/db"

import { atInstallation } from "../authorize.js"
import type { Context } from "../context.js"
import { recordSecurityEntry } from "../security-log.js"
import { checkName } from "../validation.js"

export type Installation = typeof schema.installation.$inferSelect

/**
 * Creates the installation record if it does not exist yet, and records that
 * in the installation-level security log. Safe to run on every start.
 */
export async function setUpInstallation(
  ctx: Context,
  input: { name: string },
): Promise<Installation> {
  return atInstallation(ctx, "installation.set-up", async (scope) => {
    const name = checkName(input.name, "The installation name")
    const [created] = await scope.tx
      .insert(schema.installation)
      .values({ name })
      .onConflictDoNothing()
      .returning()
    if (!created) return (await getInstallation(scope.tx))!

    await recordSecurityEntry(scope.tx, {
      workspaceId: null,
      action: "installation.created",
      outcome: "succeeded",
      actor: scope.actor,
      request: scope.request,
      details: { name },
    })
    return created
  })
}

/**
 * The installation record, or null before it is set up. Its name is public:
 * an invitation's acceptance page shows it before sign-in (identity §5.2).
 */
export async function getInstallation(
  db: Pick<Database, "select">,
): Promise<Installation | null> {
  const [row] = await db
    .select()
    .from(schema.installation)
    .where(eq(schema.installation.id, 1))
  return row ?? null
}
