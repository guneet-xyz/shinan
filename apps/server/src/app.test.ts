import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { connectTestDatabase } from "@shinan/db/testing"

import { noSignIn } from "./api/sign-in.js"
import { createApp as createAppWith } from "./app.js"
import type { AppOptions } from "./app.js"

const { db, pool } = connectTestDatabase()

afterAll(async () => {
  await pool.end()
})

function createApp(options: Partial<AppOptions> = {}) {
  return createAppWith({ db, signIn: noSignIn, ...options })
}

describe("createApp", () => {
  it("answers the container health check", async () => {
    const response = await createApp().request("/healthz")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "ok" })
  })

  it("reports status through the API", async () => {
    const response = await createApp().request("/api/status")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "ok" })
  })

  it("answers unknown API paths with a JSON 404", async () => {
    const app = createApp()

    for (const path of ["/api", "/api/nope", "/api/nope.json"]) {
      const response = await app.request(path)
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual(notFound)
    }
  })

  it("does not serve the web app unless configured", async () => {
    const response = await createApp().request("/")

    expect(response.status).toBe(404)
  })

  describe("with a built web app", () => {
    let webDistDir: string

    beforeAll(async () => {
      webDistDir = await mkdtemp(join(tmpdir(), "shinan-web-"))
      await mkdir(join(webDistDir, "assets"))
      await writeFile(join(webDistDir, "index.html"), "<h1>Shinan</h1>")
      await writeFile(
        join(webDistDir, "assets", "app.js"),
        "console.log('app')",
      )
    })

    afterAll(async () => {
      await rm(webDistDir, { recursive: true, force: true })
    })

    it("serves static files", async () => {
      const response = await createApp({ webDistDir }).request("/assets/app.js")

      expect(response.status).toBe(200)
      expect(await response.text()).toBe("console.log('app')")
    })

    it("serves index.html for app routes", async () => {
      const app = createApp({ webDistDir })

      for (const path of ["/", "/settings/members"]) {
        const response = await app.request(path)
        expect(response.status).toBe(200)
        expect(await response.text()).toBe("<h1>Shinan</h1>")
      }
    })

    it("answers missing files with a 404", async () => {
      const app = createApp({ webDistDir })

      for (const path of ["/assets/missing.js", "/favicon.ico"]) {
        const response = await app.request(path)
        expect(response.status).toBe(404)
      }
    })

    it("keeps the API ahead of the web app", async () => {
      const app = createApp({ webDistDir })

      const status = await app.request("/api/status")
      expect(await status.json()).toEqual({ status: "ok" })

      const missing = await app.request("/api/nope")
      expect(missing.status).toBe(404)
      expect(await missing.json()).toEqual(notFound)

      const health = await app.request("/healthz")
      expect(await health.json()).toEqual({ status: "ok" })
    })
  })
})

const notFound = { error: "not-found", message: "Not found" }
