import { serve } from "@hono/node-server"

import { productName, setUpInstallation, shinan } from "@shinan/core"
import { createDatabase, migrateDatabase } from "@shinan/db"

import { createApp } from "./app.js"
import { readDatabaseUrl, readWebConfig } from "./config.js"
import type { Env } from "./config.js"
import { migrateJobQueue, startWorker } from "./jobs.js"

export const usage = `Usage: shinan <command>

Commands:
  web       Serve the API and, in production, the web app
  worker    Run background jobs
  migrate   Prepare the database (migrations, job queue, installation), then exit`

/** Runs one CLI command and resolves to the process exit code. */
export async function runCommand(
  args: readonly string[],
  env: Env,
): Promise<number> {
  const [command, ...rest] = args
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
  const app = createApp({ webDistDir: config.webDistDir })
  const server = serve(
    { fetch: app.fetch, hostname: config.host, port: config.port },
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
  console.info(`${productName} web stopped`)
}

async function runWorker(env: Env): Promise<void> {
  const databaseUrl = readDatabaseUrl(env)
  const { db, pool } = createDatabase(databaseUrl)
  try {
    const worker = await startWorker({ databaseUrl, db })
    console.info(`${productName} worker started`)
    await waitForShutdown()
    await worker.stop()
  } finally {
    await pool.end()
  }
  console.info(`${productName} worker stopped`)
}

async function runMigrate(env: Env): Promise<void> {
  const databaseUrl = readDatabaseUrl(env)
  console.info("Applying database migrations")
  await migrateDatabase(databaseUrl)
  await migrateJobQueue(databaseUrl)

  const { db, pool } = createDatabase(databaseUrl)
  try {
    await setUpInstallation({ db, actor: shinan }, { name: productName })
  } finally {
    await pool.end()
  }
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
