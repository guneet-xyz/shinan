import { accessSync, constants } from "node:fs"
import { serve } from "@hono/node-server"

import {
  changeEmailOf,
  checkCatalogIndexes,
  createGitClient,
  endSessionsOf,
  NotFoundError,
  prepareSetupLink,
  productName,
  rebuildCatalogIndex,
  RuleViolationError,
  setUpInstallation,
  setupLinkHours,
  shinan,
  syncOperators,
  watchCatalogPurges,
} from "@shinan/core"
import {
  checkDatabase,
  createDatabase,
  migrateDatabase,
  withMigrationLock,
} from "@shinan/db"
import { createSesSender, createSmtpSender } from "@shinan/email"
import type { EmailSender } from "@shinan/email"
import { createGit } from "@shinan/git"
import { loadSkillCatalog } from "@shinan/skill"

import type { SignIn } from "./api/sign-in.js"
import { createApp, createInternalApp } from "./app.js"
import {
  readDatabaseUrl,
  readEmailConfig,
  readGitClientConfig,
  readWebConfig,
} from "./config.js"
import type { EmailConfig, Env } from "./config.js"
import { createGitApp, createGitInternalApp } from "./git/app.js"
import { openJournal } from "./git/journal.js"
import { checkGitRole, readGitRoleConfig } from "./git/startup.js"
import { cleanTemporary, createRepositoryStore } from "./git/store.js"
import { checkHealth } from "./health.js"
import { listenerOptions } from "./in-flight.js"
import { connectJobQueue, migrateJobQueue, startWorker } from "./jobs.js"
import { createBetterAuthSignIn } from "./sign-in/better-auth.js"

export const usage = `Usage: shinan <command>

Commands:
  web       Serve the API and, in production, the web app
  worker    Run background jobs
  migrate   Prepare the database (migrations, job queue, installation), then exit
  git       Serve the catalog's Git repositories to web, worker and migrate,
            on an internal network only (needs SHINAN_GIT_SERVICE_TOKEN)
  health    Exit 0 if the web role on this machine is ready (for container
            health checks; asks its internal listener's /readyz)

Recovery, for installation operators (recorded in the security log):
  account end-sessions <handle>          End all of a person's sign-in sessions
  account change-email <handle> <email>  Change a person's email address and
                                         add it to the allowlist; remove the
                                         old address from the allowlist,
                                         withdraw invitations pending for it
                                         and end their sign-in sessions

The agent index, for installation operators:
  catalog-index rebuild <workspace-id>...  Rebuild workspaces' agent indexes
                                         from main of their catalog
                                         repositories now
  catalog-index check [<workspace-id>...]  Run the round-trip check now (all
                                         workspaces if none are named)`

/** Runs one CLI command and resolves to the process exit code. */
export async function runCommand(
  args: readonly string[],
  env: Env,
): Promise<number> {
  const [command, ...rest] = args
  if (command === "account") return runAccountCommand(rest, env)
  if (command === "catalog-index") return runCatalogIndexCommand(rest, env)
  if (rest.length > 0) {
    console.error(`Unexpected arguments: ${rest.join(" ")}\n\n${usage}`)
    return 1
  }

  switch (command) {
    case "web":
      await runWeb(env)
      return 0
    case "worker":
      await runWorker(env)
      return 0
    case "migrate":
      await runMigrate(env)
      return 0
    case "git":
      await runGit(env)
      return 0
    case "health":
      return checkHealth(env)
    case "help":
    case "--help":
    case "-h":
      console.info(usage)
      return 0
    default:
      console.error(
        `${command ? `Unknown command: ${command}` : "No command given"}\n\n${usage}`,
      )
      return 1
  }
}

async function runWeb(env: Env): Promise<void> {
  const config = readWebConfig(env)
  const databaseUrl = readDatabaseUrl(env)
  const { db, pool } = createDatabase(databaseUrl)
  const jobs = await connectJobQueue(databaseUrl)
  let signIn: SignIn | undefined
  // This process keeps catalog text parsed; it forgets it after a purge
  // in another process (catalog §9).
  const stopWatchingPurges = watchCatalogPurges({ db, actor: shinan })
  try {
    await syncOperators({ db, actor: shinan }, { emails: config.operators })
    await announceSetupLink(db, config)
    signIn = createBetterAuthSignIn({
      db,
      jobs,
      installationUrl: config.installationUrl,
      secret: config.sessionSecret,
      github: config.github,
      sessions: config.sessions,
    })
    const app = createApp({
      db,
      signIn,
      jobs,
      installationUrl: config.installationUrl,
      trustedProxies: config.trustedProxies,
      webDistDir: config.webDistDir,
      skills: await loadSkillCatalog(),
    })
    const internal = createInternalApp({
      checkDatabase: () => checkDatabase(pool),
    })
    await serveUntilShutdown([
      { name: "web", fetch: app.fetch, ...config },
      {
        name: "internal (health checks)",
        fetch: internal.fetch,
        ...config.internal,
      },
    ])
  } finally {
    stopWatchingPurges()
    await closeWeb({ signIn, jobs, pool })
  }
  console.info(`${productName} web stopped`)
}

/**
 * Stops the `web` role's resources in order: first the sign-in layer's
 * background work (such as a sign-in link being queued as the request that
 * asked for it was answered), then the job queue, then the database.
 */
export async function closeWeb(parts: {
  signIn: Pick<SignIn, "idle"> | undefined
  jobs: { stop(options: { graceful: boolean }): Promise<void> }
  pool: { end(): Promise<void> }
}): Promise<void> {
  try {
    await parts.signIn?.idle?.()
  } finally {
    await parts.jobs.stop({ graceful: false })
    await parts.pool.end()
  }
}

/**
 * Until the first operator account exists, prints a one-time setup link to
 * this process's log, and nowhere else (architecture §12). Each start
 * replaces the previous link. This is the one link Shinan ever logs.
 */
export async function announceSetupLink(
  db: Parameters<typeof prepareSetupLink>[0]["db"],
  config: { installationUrl: string; operators: string[] },
): Promise<void> {
  if (config.operators.length === 0) {
    console.warn(
      "SHINAN_OPERATORS is empty: nobody can claim this installation until it names an operator",
    )
    return
  }
  const token = await prepareSetupLink({ db, actor: shinan })
  if (!token) return
  console.info(
    `First start: to create the first operator account, open this one-time setup link within ${setupLinkHours} hours (restart to get a new one):\n\n  ${config.installationUrl}/setup#${token}\n`,
  )
}

/** The operator's recovery commands (identity §3.4). */
async function runAccountCommand(args: string[], env: Env): Promise<number> {
  const [action, handle, email, ...rest] = args
  const valid =
    rest.length === 0 &&
    ((action === "end-sessions" && handle && !email) ||
      (action === "change-email" && handle && email))
  if (!valid) {
    console.error(`Unexpected arguments: account ${args.join(" ")}\n\n${usage}`)
    return 1
  }
  const { db, pool } = createDatabase(readDatabaseUrl(env))
  const ctx = {
    db,
    actor: shinan,
    request: { client: "shinan account command" },
  }
  try {
    if (action === "end-sessions") {
      const ended = await endSessionsOf(ctx, { handle: handle })
      console.info(`Ended ${ended} sign-in sessions of ${handle}`)
    } else {
      await changeEmailOf(ctx, { handle: handle, email: email! })
      console.info(
        `Changed ${handle}'s email address to ${email}; their sign-in sessions have ended`,
      )
    }
    return 0
  } catch (error) {
    // A refusal says what to do, such as changing SHINAN_OPERATORS first.
    if (error instanceof RuleViolationError) {
      console.error(error.message)
      return 1
    }
    if (error instanceof NotFoundError) {
      console.error(`No person has the handle ${handle}`)
      return 1
    }
    throw error
  } finally {
    await pool.end()
  }
}

/**
 * The agent index's upkeep, run at once (architecture §5.3): the worker
 * does the same on its own after each update of `main`, after releases and
 * daily. Reads `main` through the Git container.
 */
async function runCatalogIndexCommand(
  args: string[],
  env: Env,
): Promise<number> {
  const [action, ...workspaceIds] = args
  if (
    !(action === "rebuild" && workspaceIds.length > 0) &&
    action !== "check"
  ) {
    console.error(
      `Unexpected arguments: catalog-index ${args.join(" ")}\n\n${usage}`,
    )
    return 1
  }
  const gitConfig = readGitClientConfig(env)
  if (!gitConfig) {
    console.error(
      "Set SHINAN_GIT_URL and SHINAN_GIT_SERVICE_TOKEN: the agent index is built from the Git container's repositories",
    )
    return 1
  }
  const git = createGitClient(gitConfig)
  const { db, pool } = createDatabase(readDatabaseUrl(env))
  const ctx = { db, actor: shinan }
  try {
    if (action === "rebuild") {
      for (const workspaceId of workspaceIds) {
        const rebuilt = await rebuildCatalogIndex(ctx, { workspaceId }, git)
        console.info(
          rebuilt.outcome === "no-repository"
            ? `Workspace ${workspaceId} has no catalog repository yet: nothing to index`
            : `Rebuilt the agent index of workspace ${workspaceId} at ${rebuilt.commit} (${rebuilt.documents} documents)`,
        )
      }
      return 0
    }
    const results = await checkCatalogIndexes(
      ctx,
      git,
      workspaceIds.length > 0 ? { workspaceIds } : {},
    )
    for (const r of results) {
      const detail =
        r.outcome === "differs"
          ? `: ${r.differenceCount} documents differ (${r.differences
              .map((d) => `${d.path}: ${d.tables.join(", ")}`)
              .join("; ")})`
          : ""
      console.info(`Workspace ${r.workspaceId}: ${r.outcome}${detail}`)
    }
    return results.some((r) => r.outcome !== "matched") ? 1 : 0
  } catch (error) {
    if (error instanceof NotFoundError) {
      console.error("No workspace has that ID")
      return 1
    }
    throw error
  } finally {
    await pool.end()
  }
}

interface Listener {
  name: string
  fetch: (request: Request) => Response | Promise<Response>
  host: string
  port: number
  /** Node's server options; default `listenerOptions()`. */
  serverOptions?: Record<string, unknown>
}

async function serveUntilShutdown(listeners: Listener[]): Promise<void> {
  const servers = listeners.map(({ name, fetch, host, port, serverOptions }) =>
    serve(
      {
        fetch,
        hostname: host,
        port,
        serverOptions: serverOptions ?? listenerOptions(),
      },
      (info) => {
        console.info(
          `${productName} ${name} listening on http://${info.address}:${info.port}`,
        )
      },
    ),
  )

  await waitForShutdown()
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        }),
    ),
  )
}

/**
 * The `git` role (Git-based catalog plan §2.2, D-065): the repositories and
 * Git, behind the service token, with no database and no other secret. It
 * refuses to start without its token, with a volume others can write, or
 * with a push hook that would not run.
 */
async function runGit(env: Env): Promise<void> {
  const config = readGitRoleConfig(env)
  const git = createGit()
  checkGitRole({ git, catalogDir: config.catalogDir })
  cleanTemporary(config.catalogDir)
  const store = createRepositoryStore({ root: config.catalogDir, git })
  const journal = openJournal(config.catalogDir)
  const app = createGitApp({
    serviceToken: config.serviceToken,
    store,
    journal,
  })
  const internal = createGitInternalApp({
    ready: () => {
      try {
        accessSync(config.catalogDir, constants.W_OK)
        return true
      } catch {
        return false
      }
    },
  })
  await serveUntilShutdown([
    {
      name: "git",
      fetch: app.fetch,
      host: config.host,
      port: config.port,
      serverOptions: {
        // Room for the context header (64 KiB) and the others.
        maxHeaderSize: 80 * 1024,
        // A push's body may take 120 seconds to arrive (plan §2.10).
        ...listenerOptions(120),
      },
    },
    {
      name: "internal (health checks)",
      fetch: internal.fetch,
      ...config.internal,
    },
  ])
  console.info(`${productName} git stopped`)
}

async function runWorker(env: Env): Promise<void> {
  const databaseUrl = readDatabaseUrl(env)
  const emailConfig = readEmailConfig(env)
  const gitConfig = readGitClientConfig(env)
  const emailSender = createEmailSender(emailConfig)
  const { db, pool } = createDatabase(databaseUrl)
  // Rebuilds and checks keep type schemas parsed (catalog §9).
  const stopWatchingPurges = watchCatalogPurges({ db, actor: shinan })
  try {
    const worker = await startWorker({
      databaseUrl,
      db,
      emailSender,
      git: gitConfig ? createGitClient(gitConfig) : undefined,
    })
    console.info(
      `${productName} worker started, sending email through ${emailConfig.transport}`,
    )
    await waitForShutdown()
    await worker.stop()
  } finally {
    stopWatchingPurges()
    await emailSender.close()
    await pool.end()
  }
  console.info(`${productName} worker stopped`)
}

export function createEmailSender(config: EmailConfig): EmailSender {
  return config.transport === "ses"
    ? createSesSender(config)
    : createSmtpSender(config)
}

async function runMigrate(env: Env): Promise<void> {
  const databaseUrl = readDatabaseUrl(env)
  console.info("Applying database migrations")
  await withMigrationLock(databaseUrl, async () => {
    await migrateDatabase(databaseUrl)
    await migrateJobQueue(databaseUrl)

    const { db, pool } = createDatabase(databaseUrl)
    try {
      await setUpInstallation({ db, actor: shinan }, { name: productName })
    } finally {
      await pool.end()
    }
  })
  console.info("Database ready")
}

function waitForShutdown(): Promise<NodeJS.Signals> {
  return new Promise((resolve) => {
    const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"]
    // Signal listeners alone do not keep Node.js running.
    const keepAlive = setInterval(() => {}, 2 ** 30)
    const onSignal = (signal: NodeJS.Signals) => {
      clearInterval(keepAlive)
      for (const s of signals) process.off(s, onSignal)
      console.info(`Received ${signal}, shutting down`)
      resolve(signal)
    }
    for (const s of signals) process.on(s, onSignal)
  })
}
