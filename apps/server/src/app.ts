import { extname } from "node:path"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"

import type { DatabaseReadiness } from "@shinan/db"

import { createApi } from "./api/routes.js"
import type { ApiOptions } from "./api/routes.js"
import { securityHeaders } from "./security.js"

export interface AppOptions extends ApiOptions {
  /** Directory of the built web app. When set, its files are served. */
  webDistDir?: string
}

/**
 * The public listener: the API and the web app, behind the reverse proxy.
 * Health checks are not here; they are on the internal listener.
 */
export function createApp(options: AppOptions) {
  const app = new Hono()

  app.use(
    "*",
    securityHeaders({
      https: options.installationUrl?.startsWith("https:") ?? false,
    }),
  )

  app.route("/api", createApi(options))
  // Not the web app either, so a health check pointed here by mistake fails
  // rather than seeing the app's page.
  app.all("/healthz", (c) => c.notFound())
  app.all("/readyz", (c) => c.notFound())

  if (options.webDistDir) {
    const root = options.webDistDir
    const serveIndex = serveStatic({ root, path: "index.html" })
    app.use("*", serveStatic({ root }))
    // Paths without a file extension are routes of the single-page app;
    // anything else that was not found above is a missing file.
    app.get("*", (c, next) =>
      extname(c.req.path) === "" ? serveIndex(c, next) : next(),
    )
  }

  return app
}

/** How long a readiness check waits for the database. */
const readinessTimeoutMs = 2000

/**
 * The internal listener (architecture §13): health checks for the container
 * runtime, on a port the reverse proxy never routes to, so they are not
 * public. Later, metrics join them here.
 *
 * - `/healthz`: liveness; the process answers.
 * - `/readyz`: readiness; the database answers and its migrations are
 *   current. 503 otherwise.
 */
export function createInternalApp(options: {
  checkDatabase: () => Promise<DatabaseReadiness>
}) {
  const app = new Hono()
  app.get("/healthz", (c) => c.json({ status: "ok" }))
  app.get("/readyz", async (c) => {
    let timer: NodeJS.Timeout | undefined
    const timedOut = new Promise<DatabaseReadiness>((resolve) => {
      timer = setTimeout(
        () => resolve({ reachable: false, migrationsCurrent: false }),
        readinessTimeoutMs,
      )
    })
    const database = await Promise.race([
      options.checkDatabase().catch(() => ({
        reachable: false,
        migrationsCurrent: false,
      })),
      timedOut,
    ]).finally(() => clearTimeout(timer))
    const ready = database.reachable && database.migrationsCurrent
    return c.json(
      { status: ready ? "ok" : "unavailable", database },
      ready ? 200 : 503,
    )
  })
  app.all("*", (c) => c.json({ error: "not-found", message: "Not found" }, 404))
  return app
}
