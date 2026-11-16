import { lt, schema, sql } from "@shinan/db"

import { atInstallation } from "../authorize.js"
import type { Context } from "../context.js"

/**
 * Email records are kept for 7 days, like other job records (architecture
 * §4.2): long enough to debug recent failures, and far longer than the
 * hour that throttling looks back over.
 */
export const emailRecordRetentionDays = 7

/**
 * Deletes email records older than the retention period, counted from when
 * the email finished. An email still queued that long ago was lost by the
 * job queue (it retries for an hour at most), so it goes too, with its
 * message. Returns how many were deleted.
 */
export async function pruneEmailDeliveries(ctx: Context): Promise<number> {
  return atInstallation(ctx, "email.prune", async (scope) => {
    const t = schema.emailDeliveries
    const result = await scope.tx
      .delete(t)
      .where(
        lt(
          sql`coalesce(${t.finishedAt}, ${t.createdAt})`,
          sql`now() - make_interval(days => ${emailRecordRetentionDays})`,
        ),
      )
    return result.rowCount ?? 0
  })
}
