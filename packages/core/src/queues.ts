import { emailQueue } from "./email/queue.js"
import type { QueueDefinition } from "./jobs.js"

/**
 * Every job queue core adds jobs to. `migrate` creates them, so the `web`
 * role can add jobs before a worker has ever started.
 */
export const jobQueues: readonly QueueDefinition[] = [emailQueue]
