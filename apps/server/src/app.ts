import { extname } from "node:path"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"

export interface AppOptions {
  /** Directory of the built web app. When set, its files are served. */
  webDistDir?: string
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono()

  // Container health check, separate from the public API.
  app.get("/healthz", (c) => c.json({ status: "ok" }))

  const api = new Hono()
  api.get("/status", (c) => c.json({ status: "ok" }))
  api.all("*", (c) => c.json({ error: "Not found" }, 404))
  app.route("/api", api)

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
