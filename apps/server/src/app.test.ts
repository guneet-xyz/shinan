import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { findSecrets } from "@shinan/core"
import { checkDatabase } from "@shinan/db"
import { connectTestDatabase } from "@shinan/db/testing"
import { loadSkillCatalog, skillDirectory } from "@shinan/skill"
import type { SkillCatalog } from "@shinan/skill"

import { noSignIn } from "./api/sign-in.js"
import { createApp as createAppWith, createInternalApp } from "./app.js"
import type { AppOptions } from "./app.js"

const { db, pool } = connectTestDatabase()

afterAll(async () => {
  await pool.end()
})

function createApp(options: Partial<AppOptions> = {}) {
  return createAppWith({ db, signIn: noSignIn, ...options })
}

describe("createApp", () => {
  it("does not serve health checks publicly", async () => {
    const response = await createApp().request("/healthz")

    expect(response.status).toBe(404)
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
    })

    it("does not answer health checks with the app's page", async () => {
      const app = createApp({ webDistDir })

      for (const path of [
        "/healthz",
        "/readyz",
        "/healthz/",
        "/readyz/live",
        "/HEALTHZ",
        "/ReadyZ",
        "//readyz",
      ]) {
        expect((await app.request(path)).status, path).toBe(404)
      }
      // Paths that only start with the same letters are the app's.
      expect((await app.request("/healthzone")).status).toBe(200)
    })
  })
})

describe("the skill at /skills/, without sign-in", () => {
  let skills: SkillCatalog
  let webDistDir: string
  let app: ReturnType<typeof createApp>

  beforeAll(async () => {
    skills = await loadSkillCatalog()
    webDistDir = await mkdtemp(join(tmpdir(), "shinan-web-"))
    await writeFile(join(webDistDir, "index.html"), "<h1>Shinan</h1>")
    app = createApp({
      webDistDir,
      skills,
      installationUrl: "https://x.example",
    })
  })

  afterAll(async () => {
    await rm(webDistDir, { recursive: true, force: true })
  })

  it("serves index.json and each file it lists, with their headers", async () => {
    const response = await app.request("/skills/index.json")
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    )
    const index = (await response.json()) as {
      skills: { name: string; version: string; files: string[] }[]
    }
    expect(index.skills).toEqual([
      {
        name: "shinan",
        version: skills.version,
        files: expect.arrayContaining(["SKILL.md"]) as unknown,
      },
    ])
    for (const file of index.skills[0]!.files) {
      const served = await app.request(`/skills/shinan/${file}`)
      expect(served.status, file).toBe(200)
      expect(await served.text()).toBe(
        await readFile(join(skillDirectory, file), "utf8"),
      )
      const headers = served.headers
      expect(headers.get("content-type")).toBe("text/markdown; charset=utf-8")
      expect(headers.get("cache-control")).toBe("public, max-age=300")
      expect(headers.get("etag")).toMatch(/^"[A-Za-z0-9_-]+"$/)
      expect(headers.get("x-robots-tag")).toBe("noindex")
      // The global security headers apply here too.
      expect(headers.get("x-content-type-options")).toBe("nosniff")
      expect(headers.get("content-security-policy")).toContain(
        "default-src 'none'",
      )
      expect(headers.get("strict-transport-security")).not.toBeNull()
      expect(headers.get("set-cookie")).toBeNull()
    }
  })

  it("answers HEAD and a matching If-None-Match without the body", async () => {
    const head = await app.request("/skills/shinan/SKILL.md", {
      method: "HEAD",
    })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe("")
    const etag = head.headers.get("etag")!
    const again = await app.request("/skills/shinan/SKILL.md", {
      headers: { "if-none-match": `"other", ${etag}` },
    })
    expect(again.status).toBe(304)
    expect(await again.text()).toBe("")
    expect(again.headers.get("etag")).toBe(etag)
    const changed = await app.request("/skills/shinan/SKILL.md", {
      headers: { "if-none-match": '"other"' },
    })
    expect(changed.status).toBe(200)
    // Weak comparison: a tag a proxy weakened still matches, and so does *.
    for (const header of [`W/${etag}`, `"x", W/${etag}`, "*"]) {
      const weak = await app.request("/skills/shinan/SKILL.md", {
        headers: { "if-none-match": header },
      })
      expect(weak.status, header).toBe(304)
    }
    const otherWeak = await app.request("/skills/shinan/SKILL.md", {
      headers: { "if-none-match": 'W/"other"' },
    })
    expect(otherWeak.status).toBe(200)
  })

  it("serves nothing else: no listing, no other path, no other method", async () => {
    // Dot segments, even encoded (`%2e%2e`), are resolved when the URL is
    // read, before routing, so they reach only paths listed here; an
    // encoded slash stays part of one name and matches no file.
    for (const path of [
      "/skills",
      "/skills/",
      "/skills/shinan",
      "/skills/shinan/",
      "/skills/shinan/references",
      "/skills/shinan/references/",
      "/skills/index.json/",
      "/skills//index.json",
      "/skills/shinan//SKILL.md",
      "/skills/shinan/skill.md",
      "/skills/SHINAN/SKILL.md",
      "/skills/shinan/SKILL.md.bak",
      "/skills/shinan/index.json",
      "/skills/SKILL.md",
      "/skills/package.json",
      "/skills/src/index.ts",
      "/skills/shinan/..%2findex.json",
      "/skills/shinan/%2e%2e%2f%2e%2e%2fpackage.json",
      "/skills/nope",
    ]) {
      const response = await app.request(path)
      expect(response.status, path).toBe(404)
      expect(await response.json(), path).toEqual(notFound)
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const response = await app.request("/skills/index.json", { method })
      expect(response.status, method).toBe(404)
    }
  })

  it("holds only product conventions: no secrets, no addresses", () => {
    for (const [path, file] of skills.files) {
      const text = new TextDecoder().decode(file.body)
      expect(findSecrets(text), path).toEqual([])
      // Example addresses only, never a real installation or machine.
      for (const [url] of text.matchAll(/\bhttps?:\/\/[^\s)"`]+/g))
        expect(new URL(url).hostname, `${path}: ${url}`).toMatch(
          /(^|\.)example$/,
        )
    }
  })
})

describe("createInternalApp", () => {
  const ready = { reachable: true, migrationsCurrent: true }

  it("answers the liveness check", async () => {
    const app = createInternalApp({
      checkDatabase: () => Promise.resolve(ready),
    })
    const response = await app.request("/healthz")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "ok" })
  })

  it("is ready when the database is reachable and migrated", async () => {
    const app = createInternalApp({ checkDatabase: () => checkDatabase(pool) })
    const response = await app.request("/readyz")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "ok", database: ready })
  })

  it("is not ready otherwise", async () => {
    for (const database of [
      { reachable: true, migrationsCurrent: false },
      { reachable: false, migrationsCurrent: false },
    ]) {
      const app = createInternalApp({
        checkDatabase: () => Promise.resolve(database),
      })
      const response = await app.request("/readyz")
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ status: "unavailable", database })
    }
    const failing = createInternalApp({
      checkDatabase: () => Promise.reject(new Error("down")),
    })
    expect((await failing.request("/readyz")).status).toBe(503)
  })

  it("gives up on a database that does not answer", async () => {
    vi.useFakeTimers()
    try {
      const app = createInternalApp({
        checkDatabase: () => new Promise(() => {}),
      })
      const answer = app.request("/readyz")
      await vi.advanceTimersByTimeAsync(2000)
      expect((await answer).status).toBe(503)
    } finally {
      vi.useRealTimers()
    }
  })

  it("serves nothing else", async () => {
    const app = createInternalApp({
      checkDatabase: () => Promise.resolve(ready),
    })
    expect((await app.request("/api/status")).status).toBe(404)
  })
})

const notFound = { error: "not-found", message: "Not found" }
