import { extname } from "node:path"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"

import { createGitClient, shinan, storeCatalogJournal } from "@shinan/core"
import type { GitClient, JobQueue } from "@shinan/core"
import { createLimitedLog, errorSummary } from "@shinan/db"
import type { Database, DatabaseReadiness } from "@shinan/db"
import type { SkillCatalog } from "@shinan/skill"

import { errorHandler } from "./api/errors.js"
import { createApi, requestInfoFor } from "./api/routes.js"
import type { ApiOptions } from "./api/routes.js"
import { noTrustedProxies } from "./client-address.js"
import { createGitEndpoint } from "./git-endpoint.js"
import { receiveDeadline, requestReceiveSeconds } from "./in-flight.js"
import { agentInFlight, createMcp } from "./mcp/server.js"
import { securityHeaders } from "./security.js"
import { createSkills } from "./skills.js"

export interface AppOptions extends ApiOptions {
  /** Directory of the built web app. When set, its files are served. */
  webDistDir?: string
  /** The skill's files, served at `/skills/`; none when not given. */
  skills?: SkillCatalog
  /**
   * How long a request other than a push has to arrive, in seconds;
   * default `requestReceiveSeconds`. The listener's own limit is the
   * push's (`pushReceiveSeconds`).
   */
  receiveSeconds?: number
}

/**
 * The public listener: the API and the web app, behind the reverse proxy.
 * Health checks are not here; they are on the internal listener.
 */
export function createApp(options: AppOptions) {
  const app = new Hono()
  app.onError(errorHandler())

  app.use(
    "*",
    securityHeaders({
      https: options.installationUrl?.startsWith("https:") ?? false,
    }),
  )

  // Only a push's body may take the listener's longer time to arrive.
  app.use(
    "*",
    receiveDeadline(
      options.receiveSeconds ?? requestReceiveSeconds,
      (c) =>
        c.req.method === "POST" &&
        /^\/git\/[^/]+\/git-receive-pack$/.test(c.req.path),
    ),
  )

  const requestInfo = requestInfoFor(options.trustedProxies ?? noTrustedProxies)
  const inFlight = agentInFlight()
  app.route("/api", createApi(options))
  // The MCP endpoint (architecture §8.1): an agent endpoint, so like
  // `/api/agent` it takes only an agent token and has no same-origin check.
  app.route(
    "/mcp",
    createMcp({
      db: options.db,
      installationUrl: options.installationUrl,
      requestInfo,
      rateLimit: options.rateLimit,
      inFlight,
    }),
  )
  // The Git endpoint (architecture §8.5): agents' clones, fetches and
  // pushes, forwarded to the Git container. An agent endpoint like `/mcp`:
  // only agent tokens, no cookies, no same-origin check.
  app.route(
    "/git",
    createGitEndpoint({
      db: options.db,
      installationUrl: options.installationUrl,
      requestInfo,
      rateLimit: options.rateLimit,
      // One client of the Git container for the catalog's reads and this.
      git: options.gitClient,
      inFlight,
      afterPush: options.git
        ? journalStorer({
            db: options.db,
            jobs: options.jobs,
            git: createGitClient(options.git),
          })
        : undefined,
    }),
  )
  // The skill (D-056): public, and only its own files. Every other path
  // under `/skills` is 404 here, never the web app's page.
  app.route(
    "/skills",
    createSkills(options.skills ?? { version: "", files: new Map() }),
  )
  // Not the web app either, so a health check pointed here by mistake, by
  // any spelling of these paths, fails rather than seeing the app's page.
  app.use("*", async (c, next) => {
    if (/^\/+(healthz|readyz)(\/|$)/i.test(c.req.path)) return c.notFound()
    await next()
  })

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

/**
 * Stores the Git container's journal after a push (plan §2.6): at most one
 * run at a time in this process, and one more after it if pushes ended
 * meanwhile. The worker's minute job stores whatever this misses.
 */
function journalStorer(options: {
  db: Database
  jobs: JobQueue | undefined
  git: GitClient
}): () => void {
  let running: Promise<void> | null = null
  let again = false
  const run = (): Promise<void> =>
    storeCatalogJournal(
      { db: options.db, actor: shinan, jobs: options.jobs, origin: "git_push" },
      options.git,
    ).then(
      () => undefined,
      (error: unknown) =>
        log(`Storing the Git journal failed: ${errorSummary(error)}`),
    )
  return () => {
    if (running) {
      again = true
      return
    }
    running = run().finally(async () => {
      while (again) {
        again = false
        await run()
      }
      running = null
    })
  }
}

const log = createLimitedLog()

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
  app.onError(errorHandler())
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
