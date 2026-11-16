import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { rateLimits } from "@shinan/core"
import { and, eq, schema, sql } from "@shinan/db"
import { connectTestDatabase } from "@shinan/db/testing"

import {
  Browser,
  emailsTo,
  latestLink,
  startInstallation,
} from "../test/installation.js"
import type { Installation } from "../test/installation.js"
import { as, testSignIn } from "../test/sign-in.js"
import type { SignIn } from "./api/sign-in.js"
import { createApp } from "./app.js"
import { contentSecurityPolicy } from "./security.js"

const { db, pool } = connectTestDatabase()

afterAll(async () => {
  await pool.end()
})

const someone = { id: "00000000-0000-4000-8000-000000000001" }

describe("security headers", () => {
  let webDistDir: string

  beforeAll(async () => {
    webDistDir = await mkdtemp(join(tmpdir(), "shinan-web-"))
    await mkdir(join(webDistDir, "assets"))
    await writeFile(join(webDistDir, "index.html"), "<h1>Shinan</h1>")
    await writeFile(join(webDistDir, "assets", "app.js"), "console.log(1)")
  })

  afterAll(async () => {
    await rm(webDistDir, { recursive: true, force: true })
  })

  function app(installationUrl: string) {
    const handle = () => Promise.resolve(Response.json({ handled: true }))
    return createApp({
      db,
      signIn: { ...testSignIn, handle },
      installationUrl,
      webDistDir,
      rateLimit: false,
    })
  }

  it("are on every answer: pages, files, the API, sign-in routes and errors", async () => {
    const https = app("https://shinan.test")
    for (const path of [
      "/",
      "/settings/members",
      "/assets/app.js",
      "/assets/missing.js",
      "/api/status",
      "/api/nope",
      "/api/account",
      "/api/auth/sign-in/social",
    ]) {
      const response = await https.request(`https://shinan.test${path}`)
      const headers = Object.fromEntries(response.headers)
      expect(headers, path).toMatchObject({
        "content-security-policy": `${contentSecurityPolicy}; upgrade-insecure-requests`,
        "strict-transport-security": "max-age=63072000; includeSubDomains",
        "x-frame-options": "DENY",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-resource-policy": "same-origin",
      })
      expect(headers["permissions-policy"], path).toContain("camera=()")
    }
  })

  it("allow no inline script or style, and no framing", () => {
    const directives = new Map(
      contentSecurityPolicy.split("; ").map((d) => {
        const [name, ...values] = d.split(" ")
        return [name!, values]
      }),
    )
    expect(directives.get("default-src")).toEqual(["'none'"])
    expect(directives.get("script-src")).toEqual(["'self'"])
    expect(directives.get("style-src")).toEqual(["'self'"])
    expect(directives.get("frame-ancestors")).toEqual(["'none'"])
    expect(directives.get("base-uri")).toEqual(["'none'"])
    expect(contentSecurityPolicy).not.toMatch(/unsafe|data:|\*/)
  })

  it("leave out HSTS and the upgrade when the installation is not HTTPS", async () => {
    const response = await app("http://localhost:5173").request("/api/status")
    expect(response.headers.get("strict-transport-security")).toBeNull()
    expect(response.headers.get("content-security-policy")).toBe(
      contentSecurityPolicy,
    )
  })

  it("keep API answers out of caches, but not the web app's files", async () => {
    const http = app("http://shinan.test")
    const api = await http.request("/api/account", { headers: as(someone) })
    expect(api.headers.get("cache-control")).toBe("no-store")
    const file = await http.request("/assets/app.js")
    expect(file.headers.get("cache-control")).not.toBe("no-store")
  })
})

describe("cross-site request forgery protection", () => {
  const installationUrl = "https://shinan.test"
  const handle = vi.fn(() => Promise.resolve(Response.json({})))
  const openLink = vi.fn()
  const sendSetupLink = vi.fn()
  const signIn: SignIn = {
    ...testSignIn,
    methods: { github: true },
    handle,
    openLink,
    startGitHubLink: vi.fn(),
    sendSetupLink,
  }
  const app = createApp({ db, signIn, installationUrl, rateLimit: false })

  /** Every state-changing route the API serves, with sample parameters. */
  const writes = app.routes
    .filter((r) => ["POST", "PUT", "PATCH", "DELETE"].includes(r.method))
    .map((r) => ({
      method: r.method,
      path: r.path.replace(/:[A-Za-z]+/g, crypto.randomUUID()),
    }))
  // The sign-in layer's routes are served through one catch-all.
  writes.push(
    { method: "POST", path: "/api/auth/sign-in/magic-link" },
    { method: "POST", path: "/api/auth/sign-in/social" },
    { method: "POST", path: "/api/auth/sign-out" },
  )

  const crossSite: [string, Record<string, string>][] = [
    ["another site", { origin: "https://evil.example" }],
    [
      "another site under the same domain",
      { origin: "https://other.shinan.test", "sec-fetch-site": "same-site" },
    ],
    ["an opaque origin", { origin: "null" }],
    ["no origin at all", {}],
    ["a cross-site fetch without Origin", { "sec-fetch-site": "cross-site" }],
    [
      "a forged Origin with the browser's own marker",
      { origin: installationUrl, "sec-fetch-site": "cross-site" },
    ],
    ["the right host over plain HTTP", { origin: "http://shinan.test" }],
  ]

  it("covers the routes it should", () => {
    const paths = writes.map((w) => `${w.method} ${w.path}`).join("\n")
    for (const expected of [
      "POST /api/setup",
      "POST /api/sign-in/link",
      "POST /api/account/sessions/end-all",
      "DELETE /api/account/github",
      "POST /api/invitations/accept",
      "POST /api/installation/allowlist",
      "POST /api/workspaces",
      "PATCH /api/workspaces/",
    ]) {
      expect(paths).toContain(expected)
    }
  })

  it.each(crossSite)(
    "refuses every state-changing request from %s",
    async (_, headers) => {
      for (const { method, path } of writes) {
        const response = await app.request(`${installationUrl}${path}`, {
          method,
          headers: {
            "content-type": "text/plain",
            ...as(someone),
            ...headers,
          },
          body: JSON.stringify({ email: "a@example.com", token: "x" }),
        })
        expect(response.status, `${method} ${path}`).toBe(403)
        expect(await response.json()).toEqual({
          error: "forbidden",
          message: "Requests from other sites are refused",
          reason: "cross-site",
        })
      }
      expect(handle).not.toHaveBeenCalled()
      expect(openLink).not.toHaveBeenCalled()
      expect(sendSetupLink).not.toHaveBeenCalled()
    },
  )

  it("lets the web app's own requests through", async () => {
    for (const headers of [
      { origin: installationUrl, "sec-fetch-site": "same-origin" },
      { origin: installationUrl },
      { "sec-fetch-site": "same-origin" },
    ]) {
      for (const { method, path } of writes) {
        const response = await app.request(`${installationUrl}${path}`, {
          method,
          headers: {
            "content-type": "application/json",
            ...as(someone),
            ...headers,
          },
          body: "{}",
        })
        const body = (await response.json()) as { reason?: string }
        expect(body.reason, `${method} ${path}`).not.toBe("cross-site")
      }
    }
  })

  it("lets reads through from anywhere, since they change nothing", async () => {
    const response = await app.request(`${installationUrl}/api/status`, {
      headers: {
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      },
    })
    expect(response.status).toBe(200)
  })
})

describe("sign-in cookies on an HTTPS installation", () => {
  let installation: Installation

  beforeAll(async () => {
    installation = await startInstallation({ url: "https://shinan.test" })
  })

  afterAll(async () => {
    await installation?.stop()
  })

  it("are HttpOnly, Secure, SameSite=Lax and limited to this host", async () => {
    const email = "cookies@example.com"
    await installation.db.insert(schema.emailAllowlist).values({ email })
    const b = new Browser(installation)
    await b.requestLink(email)
    const link = new URL((await latestLink(installation.db, email))!)
    const response = await b.request("/api/sign-in/link", {
      body: {
        token: new URLSearchParams(link.hash.slice(1)).get("token"),
        next: "/",
      },
    })
    const cookies = response.headers.getSetCookie()
    const session = cookies.find((c) => c.includes("session_token="))
    const browser = cookies.find((c) => c.includes("shinan.browser="))
    // `__Secure-` and `__Host-` make browsers refuse the cookie unless it is
    // Secure (and, for `__Host-`, set by this host for every path).
    expect(session).toMatch(/^__Secure-shinan\.session_token=/)
    expect(browser).toMatch(/^__Host-shinan\.browser=/)
    for (const cookie of [session!, browser!]) {
      const attributes = cookie.split(/;\s*/).map((a) => a.toLowerCase())
      expect(attributes).toEqual(
        expect.arrayContaining([
          "httponly",
          "secure",
          "samesite=lax",
          "path=/",
        ]),
      )
      expect(attributes.some((a) => a.startsWith("domain="))).toBe(false)
    }
    expect((await b.account()).status).toBe(200)
  })
})

describe("with sign-in", () => {
  let installation: Installation
  let counter = 0

  beforeAll(async () => {
    installation = await startInstallation({ trustedProxies: "172.20.0.2" })
  })

  afterAll(async () => {
    await installation?.stop()
  })

  async function allowlisted(): Promise<string> {
    const email = `csrf-${counter++}@example.com`
    await installation.db.insert(schema.emailAllowlist).values({ email })
    return email
  }

  describe("cross-site requests", () => {
    const evil = {
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    }

    it("cannot ask for a sign-in link", async () => {
      const email = await allowlisted()
      const b = new Browser(installation)
      const response = await b.request("/api/auth/sign-in/magic-link", {
        body: { email, callbackURL: "/" },
        headers: evil,
      })
      await b.idle()
      expect(response.status).toBe(403)
      expect(await emailsTo(installation.db, email)).toBe(0)
    })

    it("cannot open a sign-in link, sign out or end sessions", async () => {
      const email = await allowlisted()
      const b = new Browser(installation)
      await b.requestLink(email)
      const link = new URL((await latestLink(installation.db, email))!)
      const token = new URLSearchParams(link.hash.slice(1)).get("token")
      const opened = await b.request("/api/sign-in/link", {
        body: { token, next: "/" },
        headers: evil,
      })
      expect(opened.status).toBe(403)
      expect((await b.account()).status).toBe(401)

      await b.open(link.href)
      expect((await b.account()).status).toBe(200)
      for (const path of [
        "/api/auth/sign-out",
        "/api/account/sessions/end-all",
      ]) {
        const response = await b.request(path, { body: {}, headers: evil })
        expect(response.status, path).toBe(403)
      }
      expect((await b.account()).status).toBe(200)
    })
  })

  describe("the client's address behind a proxy", () => {
    async function signInFrom(
      socket: string,
      forwardedFor: string | undefined,
    ): Promise<string> {
      const email = await allowlisted()
      const b = new Browser(installation)
      b.networkAddress = socket
      const headers: Record<string, string> = forwardedFor
        ? { "x-forwarded-for": forwardedFor }
        : {}
      await b.request("/api/auth/sign-in/magic-link", {
        body: { email, callbackURL: "/" },
        headers,
      })
      await b.idle()
      const link = new URL((await latestLink(installation.db, email))!)
      await b.request("/api/sign-in/link", {
        body: {
          token: new URLSearchParams(link.hash.slice(1)).get("token"),
          next: "/",
        },
        headers,
      })
      await b.idle()
      return email
    }

    async function recorded(email: string) {
      const [person] = await installation.db
        .select()
        .from(schema.people)
        .where(eq(schema.people.email, email))
      const [entry] = await installation.db
        .select()
        .from(schema.securityLog)
        .where(
          and(
            eq(schema.securityLog.action, "sign-in.succeeded"),
            eq(schema.securityLog.subjectPersonId, person!.id),
          ),
        )
      const [session] = await installation.db
        .select()
        .from(schema.signInSessions)
        .where(eq(schema.signInSessions.personId, person!.id))
      const [delivery] = await installation.db
        .select()
        .from(schema.emailDeliveries)
        .where(eq(schema.emailDeliveries.recipient, email))
      return {
        log: entry?.networkAddress,
        session: session?.ipAddress,
        throttledBy: delivery?.networkAddress,
      }
    }

    it("is the forwarded address when the request came through the trusted proxy", async () => {
      const email = await signInFrom("172.20.0.2", "10.0.0.66, 203.0.113.50")
      expect(await recorded(email)).toEqual({
        log: "203.0.113.50",
        session: "203.0.113.50",
        throttledBy: "203.0.113.50",
      })
    })

    it("is the socket's address when the request came from anywhere else", async () => {
      const email = await signInFrom("198.51.100.20", "203.0.113.50")
      expect(await recorded(email)).toEqual({
        log: "198.51.100.20",
        session: "198.51.100.20",
        throttledBy: "198.51.100.20",
      })
    })
  })
})

describe("rate limits", () => {
  let installation: Installation

  beforeAll(async () => {
    installation = await startInstallation({
      rateLimit: true,
      trustedProxies: "172.20.0.2",
    })
  })

  afterAll(async () => {
    await installation?.stop()
  })

  function browserAt(address: string) {
    const b = new Browser(installation)
    b.networkAddress = address
    return b
  }

  async function throttled(address: string) {
    return installation.db
      .select()
      .from(schema.securityLog)
      .where(
        and(
          eq(schema.securityLog.action, "sign-in.failed"),
          sql`${schema.securityLog.networkAddress} = ${address}::inet`,
          sql`${schema.securityLog.details}->>'reason' = 'throttled'`,
        ),
      )
  }

  it("limit asking for sign-in links per address, recording one entry per flood", async () => {
    const b = browserAt("192.0.2.1")
    const ask = () => b.requestLink("nobody@example.com")
    const { max, windowSeconds } = rateLimits["sign-in-link"]
    for (let n = 0; n < max; n++) expect((await ask()).status).toBe(200)

    const refused = await ask()
    expect(refused.status).toBe(429)
    expect(refused.headers.get("retry-after")).toBe(String(windowSeconds))
    expect(await refused.json()).toMatchObject({ error: "too-many-requests" })
    for (let n = 0; n < 5; n++) expect((await ask()).status).toBe(429)
    expect(await throttled("192.0.2.1")).toHaveLength(1)

    // Someone else is not held up.
    expect(
      (await browserAt("192.0.2.2").requestLink("x@example.com")).status,
    ).toBe(200)
  })

  it("limit opening sign-in links", async () => {
    const b = browserAt("192.0.2.3")
    const open = () =>
      b.request("/api/sign-in/link", {
        body: { token: "not-a-real-token", next: "/" },
      })
    for (let n = 0; n < rateLimits["sign-in-link-open"].max; n++) {
      expect((await open()).status).toBe(200)
    }
    expect((await open()).status).toBe(429)
    expect(await throttled("192.0.2.3")).toHaveLength(1)
  })

  it("count each client behind the trusted proxy separately", async () => {
    const proxy = browserAt("172.20.0.2")
    const ask = (client: string) =>
      proxy.request("/api/auth/sign-in/magic-link", {
        body: { email: "nobody@example.com", callbackURL: "/" },
        headers: { "x-forwarded-for": client },
      })
    for (let n = 0; n < rateLimits["sign-in-link"].max; n++) {
      expect((await ask("203.0.113.1")).status).toBe(200)
    }
    expect((await ask("203.0.113.1")).status).toBe(429)
    expect((await ask("203.0.113.2")).status).toBe(200)
    await installation.signIn.idle()
  })

  it("are shared by every web process", async () => {
    // A second process: its own app, on the same database.
    const other = createApp({
      db: installation.db,
      signIn: installation.signIn,
      installationUrl: "http://shinan.test",
    })
    const first = browserAt("192.0.2.4")
    const second = new Browser({ app: other, signIn: installation.signIn })
    second.networkAddress = "192.0.2.4"
    const ask = (b: Browser) => b.requestLink("nobody@example.com")
    const { max } = rateLimits["sign-in-link"]
    for (let n = 0; n < max; n++) {
      expect((await ask(n % 2 === 0 ? first : second)).status).toBe(200)
    }
    expect((await ask(second)).status).toBe(429)
    expect((await ask(first)).status).toBe(429)
  })

  it("put a ceiling on every API request", async () => {
    const b = browserAt("192.0.2.5")
    const { max } = rateLimits.api
    const answers = await Promise.all(
      Array.from({ length: max + 1 }, () => b.request("/api/status")),
    )
    expect(answers.filter((r) => r.status === 200)).toHaveLength(max)
    expect(answers.filter((r) => r.status === 429)).toHaveLength(1)
    // Not recorded: a flood from many addresses would fill the log.
    const entries = await installation.db
      .select()
      .from(schema.securityLog)
      .where(sql`${schema.securityLog.networkAddress} = '192.0.2.5'::inet`)
    expect(entries).toHaveLength(0)
  })
})
