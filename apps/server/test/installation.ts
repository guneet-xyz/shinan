import { inject, vi } from "vitest"

import { setUpInstallation, shinan, syncOperators } from "@shinan/core"
import { and, createDatabase, desc, eq, schema } from "@shinan/db"
import type { Database } from "@shinan/db"
import { createTestDatabase } from "@shinan/db/testing"

import { createApp } from "../src/app.js"
import { parseTrustedProxies } from "../src/client-address.js"
import { connectJobQueue, migrateJobQueue } from "../src/jobs.js"
import { createBetterAuthSignIn } from "../src/sign-in/better-auth.js"

export const installationUrl = "http://shinan.test"

/**
 * A whole installation for sign-in tests, on its own fresh database: the
 * installation record is shared state (whether it has been claimed), so
 * these tests do not share a database with others.
 */
export async function startInstallation(
  options: {
    operators?: string[]
    claimed?: boolean
    /** Shinan's per-address rate limits; off unless asked for. */
    rateLimit?: boolean
    /** Proxies whose `X-Forwarded-For` header is believed. */
    trustedProxies?: string
    /** The installation's address; `http://shinan.test` by default. */
    url?: string
  } = {},
) {
  const database = await createTestDatabase(
    {},
    process.env.DATABASE_URL ?? inject("databaseUrl"),
  )
  const { db, pool } = createDatabase(database.url, { refuseNested: true })
  await migrateJobQueue(database.url)
  const jobs = await connectJobQueue(database.url)
  await setUpInstallation({ db, actor: shinan }, { name: "Test Shinan" })
  await syncOperators(
    { db, actor: shinan },
    { emails: options.operators ?? ["operator@example.com"] },
  )
  if (options.claimed !== false) {
    await db
      .update(schema.installation)
      .set({ claimedAt: new Date() })
      .where(eq(schema.installation.id, 1))
  }
  const url = options.url ?? installationUrl
  const signIn = createBetterAuthSignIn({
    db,
    jobs,
    installationUrl: url,
    secret: "a-test-secret-that-is-long-enough-to-use",
    github: { clientId: "test-client", clientSecret: "test-client-secret" },
    sessions: { idleMinutes: 60, maxHours: 24 },
  })
  const app = createApp({
    db,
    signIn,
    jobs,
    installationUrl: url,
    rateLimit: options.rateLimit ?? false,
    trustedProxies: parseTrustedProxies(options.trustedProxies ?? ""),
  })
  return {
    db,
    pool,
    app,
    signIn,
    url,
    async stop() {
      await jobs.stop({ graceful: false })
      await pool.end()
      await database.drop()
    },
  }
}

export type Installation = Awaited<ReturnType<typeof startInstallation>>

/**
 * A browser: keeps cookies, sends the site's Origin and
 * `Sec-Fetch-Site: same-origin` as browsers do for the web app's requests,
 * and follows nothing. `networkAddress` is the address its requests come
 * from, as the server's socket sees it.
 */
export class Browser {
  readonly cookies = new Map<string, string>()
  networkAddress: string | undefined

  constructor(
    private readonly installation: Pick<Installation, "app" | "signIn"> & {
      url?: string
    },
    readonly userAgent = "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/140.0",
  ) {}

  async request(
    path: string,
    init: {
      method?: string
      body?: unknown
      headers?: Record<string, string>
    } = {},
  ): Promise<Response> {
    const site = this.installation.url ?? installationUrl
    const url = new URL(path, site)
    const headers = new Headers({
      origin: site,
      "sec-fetch-site": "same-origin",
      "user-agent": this.userAgent,
      ...init.headers,
    })
    if (this.cookies.size > 0) {
      headers.set(
        "cookie",
        [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      )
    }
    if (init.body !== undefined) headers.set("content-type", "application/json")
    const response = await this.installation.app.request(
      url.href,
      {
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      },
      { incoming: { socket: { remoteAddress: this.networkAddress } } },
    )
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";")
      const index = pair!.indexOf("=")
      const name = pair!.slice(0, index)
      const value = pair!.slice(index + 1)
      if (/max-age=0/i.test(cookie) || value === "") this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
    return response
  }

  /**
   * Asks for a sign-in link, as the sign-in page does, and waits for the
   * work the reply does not wait for.
   */
  async requestLink(
    email: string,
    callbackURL = "/",
    metadata?: { github: true },
  ) {
    const response = await this.request("/api/auth/sign-in/magic-link", {
      body: { email, callbackURL, ...(metadata ? { metadata } : {}) },
    })
    await this.installation.signIn.idle()
    return response
  }

  /**
   * Opens a link from an email as its confirm page does when the person
   * clicks: posts the token from the fragment. Returns where it sends the
   * browser.
   */
  async open(
    link: string,
    change: { next?: string } = {},
  ): Promise<{ status: number; location: string; body: string }> {
    const url = new URL(link)
    const fragment = new URLSearchParams(url.hash.slice(1))
    const response = await this.request("/api/sign-in/link", {
      body: {
        token: fragment.get("token"),
        next: change.next ?? fragment.get("next"),
      },
    })
    await this.installation.signIn.idle()
    const body = await response.text()
    const { location } = JSON.parse(body) as { location?: string }
    return { status: response.status, location: location ?? "", body }
  }

  /** Signs in by email link, start to finish. */
  async signIn(
    db: Database,
    email: string,
    options: { fromGitHubStep?: boolean } = {},
  ): Promise<void> {
    const response = await this.requestLink(
      email,
      "/",
      options.fromGitHubStep ? { github: true } : undefined,
    )
    if (response.status !== 200) {
      throw new Error(`Sign-in request failed: ${response.status}`)
    }
    const link = await latestLink(db, email)
    if (!link) throw new Error(`No sign-in link for ${email}`)
    await this.open(link)
  }

  async account() {
    return this.request("/api/account")
  }

  /** Waits for work started in the background, such as sending email. */
  async idle() {
    await this.installation.signIn.idle()
  }
}

/** The newest queued email of a kind to an address, as the worker would send it. */
export async function latestEmail(
  db: Database,
  email: string,
  kind: "magic_link" | "invitation" | "security_alert" = "magic_link",
) {
  const [delivery] = await db
    .select()
    .from(schema.emailDeliveries)
    .where(
      and(
        eq(schema.emailDeliveries.recipient, email),
        eq(schema.emailDeliveries.kind, kind),
        eq(schema.emailDeliveries.status, "queued"),
      ),
    )
    .orderBy(desc(schema.emailDeliveries.createdAt))
    .limit(1)
  return delivery?.message ?? null
}

/** The sign-in link in the newest magic-link email to an address. */
export async function latestLink(
  db: Database,
  email: string,
): Promise<string | null> {
  const message = await latestEmail(db, email)
  return message?.text.match(/https?:\/\/\S+/)?.[0] ?? null
}

/** How many emails of a kind went to an address. */
export async function emailsTo(
  db: Database,
  email: string,
  kind: "magic_link" | "invitation" | "security_alert" = "magic_link",
): Promise<number> {
  const rows = await db
    .select({ id: schema.emailDeliveries.id })
    .from(schema.emailDeliveries)
    .where(
      and(
        eq(schema.emailDeliveries.recipient, email),
        eq(schema.emailDeliveries.kind, kind),
      ),
    )
  return rows.length
}

/**
 * Stands in for GitHub's OAuth endpoints: the token exchange and `/user`.
 * Every other request goes through. No real GitHub App is involved.
 */
export function mockGitHub(account: { id: number; login: string }) {
  const original = globalThis.fetch
  const calls: string[] = []
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        input instanceof Request ? input.url : new URL(String(input)).href
      if (url.startsWith("https://github.com/login/oauth/access_token")) {
        calls.push("token")
        return Response.json({
          access_token: "gho_test_user_token",
          token_type: "bearer",
          scope: "",
        })
      }
      if (url === "https://api.github.com/applications/test-client/token") {
        const request = new Request(url, init)
        calls.push(
          `revoke ${request.headers.get("authorization")} ${await request.text()}`,
        )
        return new Response(null, { status: 204 })
      }
      if (url === "https://api.github.com/user") {
        calls.push("user")
        const headers = new Headers(
          input instanceof Request ? input.headers : init?.headers,
        )
        if (headers.get("authorization") !== "Bearer gho_test_user_token") {
          return new Response("unauthorized", { status: 401 })
        }
        return Response.json({ ...account, name: null })
      }
      return original(input, init)
    },
  )
  vi.stubGlobal("fetch", fetchMock)
  return {
    calls,
    set(next: { id: number; login: string }) {
      account = next
    },
    restore() {
      vi.unstubAllGlobals()
    },
  }
}

/** Runs GitHub's authorization and callback in a browser. */
export async function signInWithGitHub(
  browser: Browser,
  start: { path: string; body: unknown } = {
    path: "/api/auth/sign-in/social",
    body: { provider: "github", callbackURL: "/" },
  },
): Promise<{ status: number; location: string; authorizeUrl: URL }> {
  const response = await browser.request(start.path, { body: start.body })
  if (response.status !== 200) {
    throw new Error(
      `GitHub sign-in did not start: ${response.status} ${await response.text()}`,
    )
  }
  const { url } = (await response.json()) as { url: string }
  const authorizeUrl = new URL(url)
  const state = authorizeUrl.searchParams.get("state")!
  const callback = await browser.request(
    `/api/auth/callback/github?code=test-code&state=${encodeURIComponent(state)}`,
  )
  await browser.idle()
  return {
    status: callback.status,
    location: callback.headers.get("location") ?? "",
    authorizeUrl,
  }
}
