import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createApp } from "./app.js"

describe("createApp", () => {
  it("reports health", async () => {
    const response = await createApp().request("/healthz")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "ok" })
  })

  it("does not serve the web app unless configured", async () => {
    const response = await createApp().request("/")

    expect(response.status).toBe(404)
  })

  describe("with a built web app", () => {
    let webDistDir: string

    beforeAll(async () => {
      webDistDir = await mkdtemp(join(tmpdir(), "shinan-web-"))
      await writeFile(join(webDistDir, "index.html"), "<h1>Shinan</h1>")
      await writeFile(join(webDistDir, "app.js"), "console.log('app')")
    })

    afterAll(async () => {
      await rm(webDistDir, { recursive: true, force: true })
    })

    it("serves static files", async () => {
      const response = await createApp({ webDistDir }).request("/app.js")

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

    it("keeps API routes ahead of the web app", async () => {
      const response = await createApp({ webDistDir }).request("/healthz")

      expect(await response.json()).toEqual({ status: "ok" })
    })
  })
})
