import { PgBoss } from "pg-boss"
import type { ConstructorOptions } from "pg-boss"

import { getInstallation } from "@shinan/core"
import type { Database } from "@shinan/db"

/**
 * The job queue (pg-boss) keeps its tables in their own schema. `migrate`
 * installs and upgrades them; the worker never does, so a new release's
 * schema changes are applied before new code starts (architecture §3.2).
 */
const schema = "pgboss"

export const queues = {
  /** A trivial scheduled job that shows the worker is running. */
  heartbeat: "heartbeat",
} as const

/** Installs or upgrades the job queue's tables, then disconnects. */
export async function migrateJobQueue(databaseUrl: string): Promise<void> {
  const boss = new PgBoss({
    connectionString: databaseUrl,
    schema,
    migrate: true,
    supervise: false,
    schedule: false,
    max: 1,
  })
  boss.on("error", logError)
  await boss.start()
  await boss.stop({ graceful: false })
}

export interface WorkerOptions {
  databaseUrl: string
  db: Database
  /** Seconds between checks for new jobs; pg-boss's default is 2. */
  pollingIntervalSeconds?: number
}

export interface Worker {
  /** The queue, for sending jobs. */
  boss: PgBoss
  /** Stops taking jobs, waits for running ones to finish, and disconnects. */
  stop(): Promise<void>
}

/** Starts the worker role: registers the jobs and starts working them. */
export async function startWorker(options: WorkerOptions): Promise<Worker> {
  const config: ConstructorOptions = {
    connectionString: options.databaseUrl,
    schema,
    application_name: "shinan-worker",
    migrate: false,
  }
  const boss = new PgBoss(config)
  boss.on("error", logError)
  await boss.start()

  await boss.createQueue(queues.heartbeat)
  await boss.schedule(queues.heartbeat, "0 * * * *")
  await boss.work(
    queues.heartbeat,
    options.pollingIntervalSeconds === undefined
      ? {}
      : { pollingIntervalSeconds: options.pollingIntervalSeconds },
    async () => heartbeat(options.db),
  )

  return {
    boss,
    stop: () => boss.stop({ graceful: true, timeout: 30_000 }),
  }
}

/** Reads the installation through core, proving the worker reaches it. */
async function heartbeat(db: Database) {
  const installation = await getInstallation(db)
  console.info(
    `Worker heartbeat: installation ${installation ? "ready" : "not set up"}`,
  )
  return { installation: installation !== null }
}

function logError(error: Error) {
  console.error("Job queue error:", error)
}
