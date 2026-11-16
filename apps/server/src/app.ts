import { extname } from "node:path"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"

import { createApi } from "./api/routes.js"
import type { ApiOptions } from "./api/routes.js"

export interface AppOptions extends ApiOptions {
  /** Directory of the built web app. When set, its files are served. */
  webDistDir?: string
}

export function createApp(options: AppOptions) {
  const app = new Hono()

  // Container health check, separate from the public API.
  app.get("/healthz", (c) => c.json({ status: "ok" }))

  app.route("/api", createApi(options))

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
