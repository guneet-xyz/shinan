import { PgBoss } from "pg-boss"
import type { ConstructorOptions } from "pg-boss"

import {
  deliverEmail,
  emailQueue,
  EmailRetryError,
  getInstallation,
  jobQueues,
  pruneEmailDeliveries,
  pruneSignInRecords,
  shinan,
} from "@shinan/core"
import type { EmailJob } from "@shinan/core"
import type { Database } from "@shinan/db"
import type { EmailSender } from "@shinan/email"

/**
 * The job queue (pg-boss) keeps its tables in their own schema. `migrate`
 * installs and upgrades them; the worker never does, so a new release's
 * schema changes are applied before new code starts (architecture §3.2).
 */
const schema = "pgboss"

export const queues = {
  /** A trivial scheduled job that shows the worker is running. */
  heartbeat: "heartbeat",
  /**
   * Hourly: gives up emails the job queue lost, removing their message, and
   * deletes old email records (architecture §4.2, §7).
   */
  emailPrune: "email-prune",
  /**
   * Hourly: deletes expired sign-in sessions and GitHub sign-ins that waited
   * too long for an email address (identity §3.2, §3.3).
   */
  signInPrune: "sign-in-prune",
} as const

/**
 * Installs or upgrades the job queue's tables and creates core's queues with
 * their current retry policies, then disconnects. Core's queues exist before
 * any role starts, so `web` can add jobs before a worker has run.
 */
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
  try {
    for (const queue of jobQueues) {
      await boss.createQueue(queue.name, queue.options)
      await boss.updateQueue(queue.name, queue.options)
    }
  } finally {
    await boss.stop({ graceful: false })
  }
}

/**
 * Connects to the job queue only to add jobs, as the `web` role does: it
 * runs no jobs, schedules or maintenance. Pass it to core as `jobs` in the
 * context. Call `stop()` before closing.
 */
export async function connectJobQueue(databaseUrl: string): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: databaseUrl,
    schema,
    application_name: "shinan-web",
    migrate: false,
    supervise: false,
    schedule: false,
    max: 2,
  })
  boss.on("error", logError)
  await boss.start()
  return boss
}

export interface WorkerOptions {
  databaseUrl: string
  db: Database
  /** Sends the email jobs; the caller closes it after `stop()`. */
  emailSender: EmailSender
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
    // Picks up jobs on notify-enabled queues, such as email, at once
    // (architecture §9.2); polling stays as the fallback.
    useListenNotify: true,
  }
  const boss = new PgBoss(config)
  boss.on("error", logError)
  await boss.start()

  await boss.createQueue(queues.heartbeat)
  await boss.schedule(queues.heartbeat, "0 * * * *")
  const polling =
    options.pollingIntervalSeconds === undefined
      ? {}
      : { pollingIntervalSeconds: options.pollingIntervalSeconds }
  await boss.work(queues.heartbeat, polling, async () => heartbeat(options.db))

  await boss.createQueue(queues.signInPrune)
  await boss.schedule(queues.signInPrune, "15 * * * *")
  await boss.work(queues.signInPrune, polling, async () =>
    pruneSignInRecords({ db: options.db, actor: shinan }),
  )

  await boss.createQueue(queues.emailPrune)
  await boss.schedule(queues.emailPrune, "30 * * * *")
  await boss.work(queues.emailPrune, polling, async () =>
    pruneEmailDeliveries({ db: options.db, actor: shinan }),
  )

  await boss.work(
    emailQueue.name,
    { ...polling, includeMetadata: true },
    async ([job]) =>
      sendEmail(options.db, options.emailSender, {
        deliveryId: (job!.data as EmailJob).deliveryId,
        retryCount: job!.retryCount,
        retryLimit: job!.retryLimit,
      }),
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

/**
 * Runs one email job and logs failures by delivery ID and error code only;
 * logs never hold addresses or message content (architecture §10.3).
 */
async function sendEmail(
  db: Database,
  sender: EmailSender,
  attempt: Parameters<typeof deliverEmail>[2],
) {
  try {
    const outcome = await deliverEmail({ db, actor: shinan }, sender, attempt)
    if (outcome.status === "rejected" || outcome.status === "given_up") {
      console.error(
        `Email ${attempt.deliveryId} ${outcome.status === "rejected" ? "rejected" : "given up"}: ${outcome.code}`,
      )
    }
    return outcome
  } catch (error) {
    // The job queue stores a failed run's error, so it gets only a code: a
    // database error's details could quote the message, magic link included.
    const code =
      error instanceof EmailRetryError ? error.code : errorCode(error)
    if (error instanceof EmailRetryError) {
      console.warn(`Email ${attempt.deliveryId} will be retried: ${code}`)
    } else {
      console.error(`Email ${attempt.deliveryId} failed: ${code}`)
    }
    // eslint-disable-next-line preserve-caught-error -- the cause is left out on purpose
    throw new Error(`Email not sent: ${code}`)
  }
}

function errorCode(error: unknown): string {
  const fields = (
    typeof error === "object" && error !== null ? error : {}
  ) as Record<string, unknown>
  const cause = fields.cause as Record<string, unknown> | undefined
  const code = cause?.code ?? fields.code ?? fields.name
  return typeof code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(code)
    ? code
    : "Error"
}

function logError(error: Error) {
  console.error("Job queue error:", error)
}
