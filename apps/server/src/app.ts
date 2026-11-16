import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"

export interface AppOptions {
  /** Directory of the built web app. When set, its files are served. */
  webDistDir?: string
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono()

  app.get("/healthz", (c) => c.json({ status: "ok" }))

  if (options.webDistDir) {
    const root = options.webDistDir
    app.use("*", serveStatic({ root }))
    // Any other page is a route of the single-page app.
    app.get("*", serveStatic({ root, path: "index.html" }))
  }

  return app
}
