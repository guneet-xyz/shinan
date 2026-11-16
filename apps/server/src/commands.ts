import { serve } from "@hono/node-server"

import {
  changeEmailOf,
  endSessionsOf,
  prepareSetupLink,
  productName,
  setUpInstallation,
  setupLinkHours,
  shinan,
  syncOperators,
} from "@shinan/core"
import { createDatabase, migrateDatabase, withMigrationLock } from "@shinan/db"
import { createSesSender, createSmtpSender } from "@shinan/email"
import type { EmailSender } from "@shinan/email"

import { createApp } from "./app.js"
import { readDatabaseUrl, readEmailConfig, readWebConfig } from "./config.js"
import type { EmailConfig, Env } from "./config.js"
import { connectJobQueue, migrateJobQueue, startWorker } from "./jobs.js"
import { createBetterAuthSignIn } from "./sign-in/better-auth.js"

export const usage = `Usage: shinan <command>

Commands:
  web       Serve the API and, in production, the web app
  worker    Run background jobs
  migrate   Prepare the database (migrations, job queue, installation), then exit

Recovery, for installation operators (recorded in the security log):
  account end-sessions <handle>          End all of a person's sign-in sessions
  account change-email <handle> <email>  Change a person's email address and
                                         add it to the allowlist; remove the
                                         old address from the allowlist,
                                         withdraw invitations pending for it
                                         and end their sign-in sessions`

/** Runs one CLI command and resolves to the process exit code. */
export async function runCommand(
  args: readonly string[],
  env: Env,
): Promise<number> {
  const [command, ...rest] = args
  if (command === "account") return runAccountCommand(rest, env)
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
  try {
    await syncOperators({ db, actor: shinan }, { emails: config.operators })
    await announceSetupLink(db, config)
    const signIn = createBetterAuthSignIn({
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
      webDistDir: config.webDistDir,
    })
    await serveUntilShutdown(app.fetch, config)
  } finally {
    await jobs.stop({ graceful: false })
    await pool.end()
  }
  console.info(`${productName} web stopped`)
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
  } finally {
    await pool.end()
  }
}

async function serveUntilShutdown(
  fetch: (request: Request) => Response | Promise<Response>,
  config: { host: string; port: number },
): Promise<void> {
  const server = serve(
    { fetch, hostname: config.host, port: config.port },
    (info) => {
      console.info(
        `${productName} web listening on http://${info.address}:${info.port}`,
      )
    },
  )

  await waitForShutdown()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

async function runWorker(env: Env): Promise<void> {
  const databaseUrl = readDatabaseUrl(env)
  const emailConfig = readEmailConfig(env)
  const emailSender = createEmailSender(emailConfig)
  const { db, pool } = createDatabase(databaseUrl)
  try {
    const worker = await startWorker({ databaseUrl, db, emailSender })
    console.info(
      `${productName} worker started, sending email through ${emailConfig.transport}`,
    )
    await waitForShutdown()
    await worker.stop()
  } finally {
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
