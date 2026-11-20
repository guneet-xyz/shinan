import { PgBoss } from "pg-boss"
import type { ConstructorOptions } from "pg-boss"

import {
  catalogIndexRebuildQueue,
  catalogRepositoryQueue,
  checkCatalogIndexes,
  createCatalogRepository,
  deliverEmail,
  emailQueue,
  EmailRetryError,
  expireInvitations,
  getInstallation,
  jobQueues,
  pruneEmailDeliveries,
  pruneRateLimits,
  pruneSignInRecords,
  rebuildCatalogIndex,
  requestCatalogIndexRebuilds,
  requestPendingCatalogRepositories,
  shinan,
  summarizeAgentTokenUse,
} from "@shinan/core"
import type {
  CatalogIndexRebuildJob,
  CatalogRepositoryJob,
  EmailJob,
  GitClient,
  WorkspaceIndexCheck,
} from "@shinan/core"
import { createLimitedLog, errorSummary } from "@shinan/db"
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
  /** Hourly: deletes rate-limit counts whose windows have ended. */
  rateLimitPrune: "rate-limit-prune",
  /**
   * Hourly: records each agent token's use since the last summary in the
   * security log (identity §11).
   */
  agentTokenUse: "agent-token-use",
  /**
   * Hourly: records pending invitations past their expiry as expired, with
   * the event (identity §5.2).
   */
  invitationExpiry: "invitation-expiry",
  /**
   * Daily: the agent index's round-trip check, text → parse → index
   * compared with the stored index (architecture §5.2, rule 5), and rebuilds
   * for workspaces whose index is behind.
   */
  catalogIndexCheck: "catalog-index-check",
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
      // A queue's policy is fixed when it is created.
      const changeable = Object.fromEntries(
        Object.entries(queue.options).filter(([key]) => key !== "policy"),
      )
      await boss.updateQueue(queue.name, changeable)
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
  /**
   * The Git container, for making workspaces' repositories. Without it
   * (development only), their jobs wait.
   */
  git?: GitClient
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
  await boss.work(queues.heartbeat, polling, () =>
    safely(queues.heartbeat, () => heartbeat(options.db)),
  )

  await boss.createQueue(queues.signInPrune)
  await boss.schedule(queues.signInPrune, "15 * * * *")
  await boss.work(queues.signInPrune, polling, () =>
    safely(queues.signInPrune, () =>
      pruneSignInRecords({ db: options.db, actor: shinan }),
    ),
  )

  await boss.createQueue(queues.rateLimitPrune)
  await boss.schedule(queues.rateLimitPrune, "20 * * * *")
  await boss.work(queues.rateLimitPrune, polling, () =>
    safely(queues.rateLimitPrune, async () => ({
      deleted: await pruneRateLimits({ db: options.db, actor: shinan }),
    })),
  )

  await boss.createQueue(queues.agentTokenUse)
  await boss.schedule(queues.agentTokenUse, "25 * * * *")
  await boss.work(queues.agentTokenUse, polling, () =>
    safely(queues.agentTokenUse, async () => ({
      summarized: await summarizeAgentTokenUse({
        db: options.db,
        actor: shinan,
      }),
    })),
  )

  await boss.createQueue(queues.invitationExpiry)
  await boss.schedule(queues.invitationExpiry, "35 * * * *")
  await boss.work(queues.invitationExpiry, polling, () =>
    safely(queues.invitationExpiry, async () => ({
      expired: await expireInvitations({ db: options.db, actor: shinan }),
    })),
  )

  await boss.createQueue(queues.emailPrune)
  await boss.schedule(queues.emailPrune, "30 * * * *")
  await boss.work(queues.emailPrune, polling, () =>
    safely(queues.emailPrune, () =>
      pruneEmailDeliveries({ db: options.db, actor: shinan }),
    ),
  )

  await boss.createQueue(queues.catalogIndexCheck)
  await boss.schedule(queues.catalogIndexCheck, "40 3 * * *")
  await boss.work(queues.catalogIndexCheck, polling, () =>
    safely(queues.catalogIndexCheck, () => checkIndexes(options.db, boss)),
  )

  await boss.work(catalogIndexRebuildQueue.name, polling, async ([job]) => {
    const { workspaceId } = job!.data as CatalogIndexRebuildJob
    const rebuilt = await safely(catalogIndexRebuildQueue.name, () =>
      rebuildCatalogIndex({ db: options.db, actor: shinan }, { workspaceId }),
    )
    console.info(
      `Catalog index of workspace ${workspaceId} rebuilt at revision ${rebuilt.revision} (${rebuilt.documents} documents)`,
    )
    return rebuilt
  })

  // After a release that changed the parser, every index built by the
  // previous one is rebuilt; answers say it is behind until then. Rebuilds
  // asked for before a restart and never finished are asked for again.
  // A failure is logged; the daily check asks again.
  await safely("catalog-index-rebuilds", () =>
    requestCatalogIndexRebuilds({ db: options.db, actor: shinan, jobs: boss }),
  ).catch(() => {})

  const git = options.git
  if (git) {
    await boss.work(catalogRepositoryQueue.name, polling, async ([job]) => {
      const { workspaceId } = job!.data as CatalogRepositoryJob
      const made = await safely(catalogRepositoryQueue.name, () =>
        createCatalogRepository(
          { db: options.db, actor: shinan },
          { workspaceId },
          git,
        ),
      )
      console.info(
        `Catalog repository of workspace ${workspaceId} ${made.created ? "created" : "already there"} at ${made.firstCommit}`,
      )
      return made
    })
    // Repositories asked for whose jobs were lost or ran out of retries.
    await safely("catalog-repositories", () =>
      requestPendingCatalogRepositories({
        db: options.db,
        actor: shinan,
        jobs: boss,
      }),
    ).catch(() => {})
  } else {
    console.warn(
      "SHINAN_GIT_URL is not set: workspaces' catalog repositories wait until a worker has it",
    )
  }

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

/**
 * Runs the round-trip check and logs its outcome by workspace and document
 * IDs only, never catalog text (architecture §13). Installation operators
 * see the same outcome as installation health.
 */
async function checkIndexes(db: Database, boss: PgBoss) {
  const results = await checkCatalogIndexes({ db, actor: shinan, jobs: boss })
  for (const result of results) {
    if (result.outcome !== "differs") continue
    console.error(
      `Catalog index check: workspace ${result.workspaceId} at revision ${result.revision}: ${result.differenceCount} documents differ from their text (${describeDifferences(result)}); rebuild it with \`shinan catalog-index rebuild ${result.workspaceId}\``,
    )
  }
  const count = (outcome: WorkspaceIndexCheck["outcome"]) =>
    results.filter((r) => r.outcome === outcome).length
  console.info(
    `Catalog index check: ${results.length} workspaces, ${count("matched")} matched, ${count("differs")} differ, ${count("behind")} behind (rebuild asked for)`,
  )
  return {
    matched: count("matched"),
    differs: count("differs"),
    behind: count("behind"),
  }
}

function describeDifferences(result: WorkspaceIndexCheck): string {
  return result.differences
    .slice(0, 5)
    .map((d) => `${d.documentId}: ${d.tables.join(", ")}`)
    .join("; ")
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

const jobLog = createLimitedLog()

/**
 * Runs a job, and if it fails, logs and hands the job queue (which stores
 * it) only the error's name and code: a database error's message can quote
 * a query's values (architecture §10.3).
 */
export async function safely<T>(
  job: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run()
  } catch (error) {
    const summary = errorSummary(error)
    jobLog(`Job ${job} failed: ${summary}`)
    // eslint-disable-next-line preserve-caught-error -- the cause is left out on purpose
    throw new Error(`Job failed: ${summary}`)
  }
}

/**
 * The job queue's own errors, such as a lost database connection, by name
 * and code only, at most once a minute each. pg-boss reconnects by itself.
 */
function logError(error: Error) {
  jobLog(`Job queue error: ${errorSummary(error)}`)
}
