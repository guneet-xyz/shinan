import { and, desc, eq, lt, or, schema } from "@shinan/db"

import { inWorkspace } from "./authorize.js"
import type { Context } from "./context.js"
import { pageSize } from "./events.js"
import type { Page } from "./events.js"

export type SecurityLogEntry = typeof schema.securityLog.$inferSelect

/**
 * The workspace's security log, newest first. Workspace owners see every
 * entry; contributors see only entries they made or that are about them
 * (identity §5.1, §11).
 */
export async function listSecurityLog(
  ctx: Context,
  workspaceId: string,
  page: Page = {},
): Promise<SecurityLogEntry[]> {
  return inWorkspace(ctx, workspaceId, "security-log.read", (scope) => {
    // The rule admits only people, who always have a person ID.
    const personId = scope.actor.personId!
    const ownEntriesOnly =
      scope.actor.member?.role === "owner"
        ? undefined
        : or(
            eq(schema.securityLog.actorPersonId, personId),
            eq(schema.securityLog.subjectPersonId, personId),
          )
    return scope.tx
      .select()
      .from(schema.securityLog)
      .where(
        and(
          eq(schema.securityLog.workspaceId, scope.workspaceId),
          ownEntriesOnly,
          page.before === undefined
            ? undefined
            : lt(schema.securityLog.id, page.before),
        ),
      )
      .orderBy(desc(schema.securityLog.id))
      .limit(pageSize(page))
  })
}
