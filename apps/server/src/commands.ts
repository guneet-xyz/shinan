import { serve } from "@hono/node-server"

import { productName } from "@shinan/core"
import { migrateDatabase } from "@shinan/db"

import { createApp } from "./app.js"
import { readDatabaseUrl, readWebConfig } from "./config.js"
import type { Env } from "./config.js"

export const usage = `Usage: shinan <command>

Commands:
  web       Serve the API and, in production, the web app
  worker    Run background jobs
  migrate   Apply database migrations, then exit`

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
      await runWorker()
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

async function runWorker(): Promise<void> {
  // The job queue (pg-boss) arrives with the first background jobs.
  console.info(`${productName} worker started; no jobs are defined yet`)
  await waitForShutdown()
  console.info(`${productName} worker stopped`)
}

async function runMigrate(env: Env): Promise<void> {
  console.info("Applying database migrations")
  await migrateDatabase(readDatabaseUrl(env))
  console.info("Database migrations applied")
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
