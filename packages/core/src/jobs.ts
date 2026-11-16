import { fromDrizzle } from "pg-boss"
import type { PgBoss, Queue } from "pg-boss"

import { sql } from "@shinan/db"
import type { Transaction } from "@shinan/db"

/**
 * The job queue (pg-boss), as operations use it: to add jobs. The `web` and
 * `worker` roles each start one and pass it in the context.
 */
export type JobQueue = Pick<PgBoss, "send">

/** A queue core defines, with the retry policy its jobs get. */
export interface QueueDefinition {
  name: string
  options: Omit<Queue, "name">
}

/**
 * Adds a job in the same transaction as the change that needs it
 * (architecture §7): if the transaction rolls back, the job is never added.
 */
export async function addJob(
  target: { tx: Transaction; jobs: JobQueue | undefined },
  queue: QueueDefinition,
  data: object,
  options: { id?: string } = {},
): Promise<void> {
  if (!target.jobs) {
    throw new Error(`The job queue is needed to add a "${queue.name}" job`)
  }
  await target.jobs.send(queue.name, data, {
    ...options,
    db: fromDrizzle(target.tx, sql),
  })
}
