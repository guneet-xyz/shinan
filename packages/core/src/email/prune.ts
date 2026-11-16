import { and, eq, lt, schema, sql } from "@shinan/db"

import { atInstallation } from "../authorize.js"
import type { Context } from "../context.js"

/**
 * Email records are kept for 7 days, like other job records (architecture
 * §4.2): long enough to debug recent failures, and far longer than the
 * hour that throttling looks back over.
 */
export const emailRecordRetentionDays = 7

/**
 * How long after its deadline a queued email counts as lost. Longer than a
 * job run may last (the email queue's 60-second expiry), so an email still
 * being sent is never swept.
 */
export const lostEmailGraceMinutes = 15

export interface PruneResult {
  /** Queued emails past their deadline, given up as lost. */
  lost: number
  /** Records deleted after the retention period. */
  deleted: number
}

/**
 * Tidies email records, in two steps:
 *
 * 1. An email still queued well past its deadline was lost by the job queue
 *    (a worker killed during its last run, or a job deleted). It is given
 *    up as `Lost` and its message removed, so a link it holds, such as a
 *    still-valid invitation, does not stay in the database.
 * 2. Records older than the retention period, counted from when the email
 *    finished, are deleted.
 */
export async function pruneEmailDeliveries(ctx: Context): Promise<PruneResult> {
  return atInstallation(ctx, "email.prune", async (scope) => {
    const t = schema.emailDeliveries
    const lost = await scope.tx
      .update(t)
      .set({
        status: "given_up",
        lastError: "Lost",
        message: null,
        finishedAt: sql`now()`,
      })
      .where(
        and(
          eq(t.status, "queued"),
          lt(
            t.notAfter,
            sql`now() - make_interval(mins => ${lostEmailGraceMinutes})`,
          ),
        ),
      )
    const deleted = await scope.tx
      .delete(t)
      .where(
        lt(
          t.finishedAt,
          sql`now() - make_interval(days => ${emailRecordRetentionDays})`,
        ),
      )
    return { lost: lost.rowCount ?? 0, deleted: deleted.rowCount ?? 0 }
  })
}
