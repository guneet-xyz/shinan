import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import type * as Api from "@shinan/api-client"
import { hashToken } from "@shinan/core"
import { and, eq, schema, sql } from "@shinan/db"

import {
  Browser,
  emailsTo,
  latestEmail,
  latestLink,
  mockGitHub,
  signInWithGitHub,
  startInstallation,
} from "../../test/installation.js"
import type { Installation } from "../../test/installation.js"

let installation: Installation
let db: Installation["db"]
let counter = 0

beforeAll(async () => {
  installation = await startInstallation()
  db = installation.db
})

afterAll(async () => {
  await installation?.stop()
})

/** A fresh allowlisted address. */
async function allowlisted(prefix = "person"): Promise<string> {
  const email = `${prefix}-${counter++}@example.com`
  await db.insert(schema.emailAllowlist).values({ email: email.toLowerCase() })
  return email
}

function browser(userAgent?: string) {
  return new Browser(installation, userAgent)
}

async function account(b: Browser): Promise<Api.Account> {
  const response = await b.account()
  expect(response.status).toBe(200)
  return (await response.json()) as Api.Account
}

async function securityLog(personId: string | null, action: string) {
  return db
    .select()
    .from(schema.securityLog)
    .where(
      and(
        eq(schema.securityLog.action, action),
        personId === null
          ? sql`true`
          : eq(schema.securityLog.subjectPersonId, personId),
      ),
    )
}

function sessionToken(b: Browser): string {
  const cookie = [...b.cookies].find(([name]) => name.includes("session_token"))
  return decodeURIComponent(cookie![1]).split(".")[0]!
}

/** Moves a browser's sign-in session back in time. */
async function ageSession(b: Browser, minutes: number) {
  await db
    .update(schema.signInSessions)
    .set({ createdAt: sql`now() - make_interval(mins => ${minutes})` })
    .where(eq(schema.signInSessions.tokenHash, hashToken(sessionToken(b))))
}

describe("email magic links", () => {
  it("creates the account when an allowlisted address first opens a link", async () => {
    const typed = await allowlisted("Grace.Hopper")
    const email = typed.toLowerCase()
    const b = browser()
    // Addresses are compared without regard to case.
    const response = await b.requestLink(typed, "/account")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: true })

    const link = await latestLink(db, email)
    // The link leads to a confirm page, with the token in the fragment.
    expect(link).toMatch(
      /^http:\/\/shinan\.test\/sign-in\/link#token=[^&]+&next=%2Faccount$/,
    )
    const opened = await b.open(link!)
    expect(opened).toMatchObject({ status: 200, location: "/account" })
    // The answer carries only where to go; the session is only in a cookie.
    expect(opened.body).not.toContain(sessionToken(b))

    const me = await account(b)
    expect(me.person).toMatchObject({ email, name: me.person.handle })
    expect(me.person.handle).toMatch(/^grace-hopper-\d+$/)
    expect(me.signInMethods).toEqual({
      email,
      github: null,
      githubAvailable: true,
    })
    expect(me.operator).toBe(false)
    const [created] = await securityLog(me.person.id, "account.created")
    expect(created).toMatchObject({ actorKind: "shinan" })
    const [signedIn] = await securityLog(me.person.id, "sign-in.succeeded")
    expect(signedIn).toMatchObject({ details: { method: "email" } })
    // No alert for the browser that created the account.
    expect(await emailsTo(db, email, "security_alert")).toBe(0)
  })

  it("answers the same for an address that is not allowlisted, and sends nothing", async () => {
    const b = browser()
    const response = await b.requestLink("stranger@example.com")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: true })
    expect(await emailsTo(db, "stranger@example.com")).toBe(0)
  })

  it("stores session and link tokens only as hashes", async () => {
    const email = await allowlisted()
    const b = browser()
    await b.requestLink(email)
    const link = new URL((await latestLink(db, email))!)
    const token = new URLSearchParams(link.hash.slice(1)).get("token")!
    const verifications = await db.select().from(schema.signInVerifications)
    for (const row of verifications) {
      expect(row.identifier).not.toContain(token)
      expect(row.value).not.toContain(token)
    }
    await b.open(link.href)
    const [session] = await db
      .select()
      .from(schema.signInSessions)
      .where(eq(schema.signInSessions.tokenHash, hashToken(sessionToken(b))))
    expect(session).toBeDefined()
    const all = await db.select().from(schema.signInSessions)
    expect(all.some((s) => s.tokenHash === sessionToken(b))).toBe(false)
  })

  it("works once", async () => {
    const email = await allowlisted()
    const b = browser()
    await b.requestLink(email)
    const link = (await latestLink(db, email))!
    await b.open(link)
    const again = await browser().open(link)
    expect(again.status).toBe(200)
    expect(again.location).toMatch(/\/sign-in\?error=/)
    const [failed] = await securityLog(null, "sign-in.failed")
    expect(failed).toBeDefined()
  })

  it("expires after 15 minutes", async () => {
    const email = await allowlisted()
    const b = browser()
    await b.requestLink(email, "/w/x")
    await db
      .update(schema.signInVerifications)
      .set({ expiresAt: sql`now() - interval '1 second'` })
    const opened = await b.open((await latestLink(db, email))!)
    expect(opened.location).toMatch(/\/sign-in\?next=%2Fw%2Fx&error=/)
    expect((await b.account()).status).toBe(401)
  })

  it("refuses an address removed from the allowlist since the link was sent", async () => {
    const email = await allowlisted()
    const b = browser()
    await b.requestLink(email)
    await db
      .delete(schema.emailAllowlist)
      .where(eq(schema.emailAllowlist.email, email))
    const opened = await b.open((await latestLink(db, email))!)
    expect(opened.location).toMatch(/\/sign-in\?error=sign_in_refused/)
    expect((await b.account()).status).toBe(401)
    const [person] = await db
      .select()
      .from(schema.people)
      .where(eq(schema.people.email, email))
    expect(person).toBeUndefined()
  })

  it("only returns to paths on this site", async () => {
    const email = await allowlisted()
    const b = browser()
    for (const callbackURL of [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example/",
      "/\tevil",
      "javascript:alert(1)",
      // Resolves to //evil.example/x, another host to a browser.
      "/.//evil.example/x",
    ]) {
      const response = await b.requestLink(email, callbackURL)
      // Refused by Better Auth's own check (403) or Shinan's (400).
      expect([400, 403], callbackURL).toContain(response.status)
    }
    expect((await b.requestLink(email, "/w/1")).status).toBe(200)
    const link = (await latestLink(db, email))!
    for (const next of ["//evil.example", "/.//evil.example/x"]) {
      const tampered = await b.open(link, { next })
      expect(tampered.status, next).toBe(422)
    }
    // An encoded slash is a same-site path, checked as received.
    expect((await b.open(link, { next: "/%2f/evil.example" })).location).toBe(
      "/%2f/evil.example",
    )
  })

  it("answers before deciding, so the reply cannot tell addresses apart by time", async () => {
    const email = await allowlisted()
    const b = browser()
    // Hold the installation record, which deciding reads, from another
    // connection: if the reply waited for the decision, it would hang.
    const holder = await installation.pool.connect()
    try {
      await holder.query("begin")
      await holder.query("lock table installation in access exclusive mode")
      for (const address of [email, "stranger-timing@example.com"]) {
        const response = await b.request("/api/auth/sign-in/magic-link", {
          body: { email: address, callbackURL: "/" },
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ status: true })
      }
      expect(await emailsTo(db, email)).toBe(0)
    } finally {
      await holder.query("rollback")
      holder.release()
    }
    await b.idle()
    expect(await emailsTo(db, email)).toBe(1)
    expect(await emailsTo(db, "stranger-timing@example.com")).toBe(0)
  })

  it("keeps the client address Shinan saw, not one the client claims", async () => {
    const email = await allowlisted()
    const b = browser()
    await b.request("/api/auth/sign-in/magic-link", {
      body: { email, callbackURL: "/" },
      headers: { "x-shinan-client-address": "203.0.113.9" },
    })
    await b.idle()
    const link = (await latestLink(db, email))!
    const fragment = new URLSearchParams(new URL(link).hash.slice(1))
    await b.request("/api/sign-in/link", {
      body: { token: fragment.get("token"), next: "/" },
      headers: { "x-shinan-client-address": "203.0.113.9" },
    })
    const [session] = await db
      .select()
      .from(schema.signInSessions)
      .where(eq(schema.signInSessions.tokenHash, hashToken(sessionToken(b))))
    expect(session!.ipAddress).not.toBe("203.0.113.9")
  })

  it("keeps at most 512 characters of a user agent", async () => {
    const email = await allowlisted()
    const b = browser(`Mozilla/5.0 ${"x".repeat(5000)}`)
    await b.signIn(db, email)
    const me = await account(b)
    const [session] = await db
      .select()
      .from(schema.signInSessions)
      .where(eq(schema.signInSessions.personId, me.person.id))
    expect(session!.userAgent).toHaveLength(512)
    for (const entry of await securityLog(me.person.id, "sign-in.succeeded")) {
      expect(entry.client).toHaveLength(512)
    }
  })

  it("never lets a request write its own lines into the log", async () => {
    const lines: string[] = []
    const capture = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "))
    }
    const spies = [
      vi.spyOn(console, "error").mockImplementation(capture),
      vi.spyOn(console, "warn").mockImplementation(capture),
      vi.spyOn(console, "info").mockImplementation(capture),
      vi.spyOn(console, "log").mockImplementation(capture),
    ]
    try {
      const b = browser()
      // A cookie makes Better Auth check the origin and callback itself,
      // and its message would include the value.
      b.cookies.set("other", "1")
      const forged =
        "https://evil.example/\nShinan web listening on http://127.0.0.1:3000 FORGED"
      const response = await b.request("/api/auth/sign-in/magic-link", {
        body: { email: "a@example.com", callbackURL: forged },
      })
      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(lines.join("\n")).not.toContain("FORGED")
      for (const line of lines) expect(line).not.toContain("\n")
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })

  it("refuses fields the sign-in page never sends", async () => {
    const b = browser()
    const response = await b.request("/api/auth/sign-in/magic-link", {
      body: {
        email: "x@example.com",
        callbackURL: "/",
        newUserCallbackURL: "https://evil.example",
      },
    })
    expect([400, 403]).toContain(response.status)
  })

  it("serves only the sign-in routes the web app uses", async () => {
    const b = browser()
    for (const [method, path] of [
      ["POST", "/api/auth/sign-up/email"],
      ["GET", "/api/auth/list-sessions"],
      ["POST", "/api/auth/link-social"],
      ["POST", "/api/auth/update-user"],
      ["GET", "/api/auth/get-session"],
      ["GET", "/api/auth/magic-link/verify?token=x&callbackURL=%2F"],
      ["GET", "/api/auth/sign-in/magic-link"],
    ] as const) {
      const response = await b.request(path, {
        method,
        body: method === "POST" ? {} : undefined,
      })
      expect(response.status, path).toBe(404)
    }
  })
})

describe("sign-in sessions", () => {
  it("count as re-authenticated only for 10 minutes", async () => {
    const email = await allowlisted()
    const b = browser()
    await b.signIn(db, email)
    const me = await account(b)
    const created = await b.request("/api/installation/allowlist", {
      body: { email: "x@example.com" },
    })
    // Not an operator, so refused whatever the session's age.
    expect(created.status).toBe(403)

    // Any person may create a workspace; renaming it needs a recent sign-in.
    const created2 = await b.request("/api/workspaces", {
      body: { name: "Mine" },
    })
    expect(created2.status).toBe(201)
    const ws = (await created2.json()) as Api.Workspace
    expect(ws).toMatchObject({ name: "Mine", role: "owner" })
    const rename = (name: string) =>
      b.request(`/api/workspaces/${ws.id}`, { method: "PATCH", body: { name } })
    expect((await rename("Fresh")).status).toBe(200)
    await ageSession(b, 11)
    const stale = await rename("Stale")
    expect(stale.status).toBe(403)
    expect(await stale.json()).toMatchObject({
      error: "reauthentication-required",
    })

    // Signing in again replaces the session and counts as recent.
    const before = sessionToken(b)
    await b.signIn(db, email)
    expect(sessionToken(b)).not.toBe(before)
    expect((await rename("Again")).status).toBe(200)
    const sessions = await db
      .select()
      .from(schema.signInSessions)
      .where(eq(schema.signInSessions.personId, me.person.id))
    expect(sessions).toHaveLength(1)
    const entries = await securityLog(me.person.id, "sign-in.succeeded")
    expect(entries.some((e) => e.details.reauthentication === true)).toBe(true)
  })

  it("end after 24 hours whatever the activity", async () => {
    const email = await allowlisted()
    const b = browser()
    await b.signIn(db, email)
    const token = sessionToken(b)
    await ageSession(b, 24 * 60 + 1)
    const response = await b.account()
    expect(response.status).toBe(401)
    expect(
      response.headers.getSetCookie().some((c) => /session_token=;/.test(c)),
    ).toBe(true)
    expect(
      await db
        .select()
        .from(schema.signInSessions)
        .where(eq(schema.signInSessions.tokenHash, hashToken(token))),
    ).toHaveLength(0)
  })

  it("end after an hour without activity", async () => {
    const email = await allowlisted()
    const b = browser()
    await b.signIn(db, email)
    await db
      .update(schema.signInSessions)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(schema.signInSessions.tokenHash, hashToken(sessionToken(b))))
    expect((await b.account()).status).toBe(401)
  })

  it("are listed, and can be ended one at a time or everywhere", async () => {
    const email = await allowlisted()
    const laptop = browser()
    const phone = browser(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1",
    )
    await laptop.signIn(db, email)
    await phone.signIn(db, email)

    const list = await laptop.request("/api/account/sessions")
    const sessions = (await list.json()) as Api.SignInSession[]
    expect(sessions).toHaveLength(2)
    expect(sessions.filter((s) => s.current)).toHaveLength(1)
    const other = sessions.find((s) => !s.current)!
    expect(other.client).toContain("iPhone")

    const ended = await laptop.request(`/api/account/sessions/${other.id}`, {
      method: "DELETE",
    })
    expect(ended.status).toBe(204)
    expect((await phone.account()).status).toBe(401)
    expect((await laptop.account()).status).toBe(200)

    await phone.signIn(db, email)
    const everywhere = await phone.request("/api/account/sessions/end-all", {
      body: {},
    })
    expect(everywhere.status).toBe(204)
    expect((await phone.account()).status).toBe(401)
    expect((await laptop.account()).status).toBe(401)
  })

  it("cannot end someone else's session", async () => {
    const mine = browser()
    const theirs = browser()
    await mine.signIn(db, await allowlisted())
    await theirs.signIn(db, await allowlisted())
    const [their] = (await (
      await theirs.request("/api/account/sessions")
    ).json()) as Api.SignInSession[]
    const response = await mine.request(`/api/account/sessions/${their!.id}`, {
      method: "DELETE",
    })
    expect(response.status).toBe(404)
    expect((await theirs.account()).status).toBe(200)
  })

  it("end with sign-out, which is recorded", async () => {
    const email = await allowlisted()
    const b = browser()
    await b.signIn(db, email)
    const me = await account(b)
    const response = await b.request("/api/auth/sign-out", { body: {} })
    expect(response.status).toBe(200)
    expect((await b.account()).status).toBe(401)
    const [entry] = await securityLog(me.person.id, "sign-in.session-ended")
    expect(entry).toMatchObject({ details: { signedOut: true } })
  })

  it("email the person when a new browser signs in", async () => {
    const email = await allowlisted()
    await browser().signIn(db, email)
    expect(await emailsTo(db, email, "security_alert")).toBe(0)

    const known = browser()
    await known.signIn(db, email)
    expect(await emailsTo(db, email, "security_alert")).toBe(1)
    const alert = await latestEmail(db, email, "security_alert")
    expect(alert?.subject).toBe("New sign-in to Test Shinan")
    expect(alert?.text).toContain("Firefox on Linux")
    expect(alert?.text).toContain("http://shinan.test/account")

    // The same browser again is not new.
    await known.signIn(db, email)
    expect(await emailsTo(db, email, "security_alert")).toBe(1)
  })
})

describe("GitHub sign-in", () => {
  let github: ReturnType<typeof mockGitHub>
  let nextId = 1000

  beforeAll(() => {
    github = mockGitHub({ id: nextId, login: "octo" })
  })

  afterEach(() => {
    github.set({ id: ++nextId, login: `octo-${nextId}` })
  })

  afterAll(() => {
    github.restore()
  })

  it("asks a new GitHub account for an email address, and links it once a link confirms it", async () => {
    const email = await allowlisted()
    const b = browser()
    const started = await signInWithGitHub(b, {
      path: "/api/auth/sign-in/social",
      body: { provider: "github", callbackURL: "/w/1" },
    })
    expect(started.authorizeUrl.origin).toBe("https://github.com")
    expect(started.authorizeUrl.searchParams.get("client_id")).toBe(
      "test-client",
    )
    expect(started.authorizeUrl.searchParams.get("redirect_uri")).toBe(
      "http://shinan.test/api/auth/callback/github",
    )
    expect(started.status).toBe(302)
    expect(started.location).toBe("/sign-in/github?next=%2Fw%2F1")
    expect((await b.account()).status).toBe(401)

    const pending = await b.request("/api/sign-in/github")
    expect(await pending.json()).toEqual({ login: "octo" })

    await b.requestLink(email, "/w/1", { github: true })
    const opened = await b.open((await latestLink(db, email))!)
    expect(opened.location).toBe("/w/1")
    const me = await account(b)
    expect(me.signInMethods.github).toMatchObject({
      accountId: String(nextId),
    })
    // No GitHub token is kept, and the pending sign-in is gone.
    const [row] = await db
      .select()
      .from(schema.signInAccounts)
      .where(eq(schema.signInAccounts.personId, me.person.id))
    expect(row).toMatchObject({
      accessToken: null,
      refreshToken: null,
      idToken: null,
    })
    expect(await db.select().from(schema.pendingGitHubSignIns)).toHaveLength(0)
    expect((await b.request("/api/sign-in/github")).status).toBe(404)
  })

  it("signs a linked GitHub account straight in", async () => {
    const email = await allowlisted()
    const first = browser()
    await signInWithGitHub(first)
    await first.signIn(db, email, { fromGitHubStep: true })
    const me = await account(first)
    expect(me.signInMethods.github).not.toBeNull()

    const other = browser("Mozilla/5.0 (Macintosh; Mac OS X 15_0) Chrome/140.0")
    const result = await signInWithGitHub(other, {
      path: "/api/auth/sign-in/social",
      body: { provider: "github", callbackURL: "/account" },
    })
    expect(result.location).toBe("/account")
    expect((await account(other)).person.id).toBe(me.person.id)
    const entries = await securityLog(me.person.id, "sign-in.succeeded")
    expect(entries.some((e) => e.details.method === "github")).toBe(true)
    // A new browser: an alert.
    const alert = await latestEmail(db, email, "security_alert")
    expect(alert?.text).toContain("Chrome on macOS")
  })

  it("forgets an unfinished GitHub sign-in when someone signs in by email in the same browser", async () => {
    const shared = browser()
    await signInWithGitHub(shared)
    expect((await shared.request("/api/sign-in/github")).status).toBe(200)
    // Someone else uses the plain sign-in page on the same computer.
    const email = await allowlisted()
    await shared.signIn(db, email)
    expect((await account(shared)).signInMethods.github).toBeNull()
    expect((await shared.request("/api/sign-in/github")).status).toBe(404)
  })

  it("revokes GitHub's user token once it has read who signed in", async () => {
    const b = browser()
    github.calls.length = 0
    await signInWithGitHub(b)
    const credentials = Buffer.from("test-client:test-client-secret").toString(
      "base64",
    )
    expect(github.calls).toEqual([
      "token",
      "user",
      `revoke Basic ${credentials} {"access_token":"gho_test_user_token"}`,
    ])
  })

  it("never links GitHub to someone else's account through their link", async () => {
    const victim = await allowlisted("victim")
    const attacker = browser()
    await signInWithGitHub(attacker)
    // The attacker asks for a link to the victim's address; the victim opens
    // it in their own browser.
    await attacker.requestLink(victim, "/", { github: true })
    const victimBrowser = browser()
    await victimBrowser.open((await latestLink(db, victim))!)
    const me = await account(victimBrowser)
    expect(me.signInMethods.github).toBeNull()
  })

  it("refuses people no longer on the allowlist", async () => {
    const email = await allowlisted()
    const b = browser()
    await signInWithGitHub(b)
    await b.signIn(db, email, { fromGitHubStep: true })
    await db
      .delete(schema.emailAllowlist)
      .where(eq(schema.emailAllowlist.email, email))
    await db.delete(schema.signInSessions)
    const again = browser()
    const result = await signInWithGitHub(again)
    expect(result.location).toMatch(/\/sign-in\?error=/)
    expect((await again.account()).status).toBe(401)
  })

  it("is added while signed in, with re-authentication, and can be removed", async () => {
    const email = await allowlisted()
    const b = browser()
    await b.signIn(db, email)

    await ageSession(b, 11)
    const stale = await b.request("/api/account/github", {
      body: { callbackURL: "/account" },
    })
    expect(stale.status).toBe(403)
    expect(await stale.json()).toMatchObject({
      error: "reauthentication-required",
    })

    await b.signIn(db, email)
    const result = await signInWithGitHub(b, {
      path: "/api/account/github",
      body: { callbackURL: "/account" },
    })
    expect(result.location).toBe("/account")
    const me = await account(b)
    expect(me.signInMethods.github).toMatchObject({
      accountId: String(nextId),
      login: `octo-${nextId}`,
    })
    const added = await latestEmail(db, email, "security_alert")
    expect(added?.subject).toBe(
      "GitHub sign-in added to your Test Shinan account",
    )

    const outside = await b.request("/api/account/github", {
      body: { callbackURL: "https://evil.example/" },
    })
    expect(outside.status).toBe(422)

    const twice = await b.request("/api/account/github", {
      body: { callbackURL: "/account" },
    })
    expect(twice.status).toBe(409)

    const removed = await b.request("/api/account/github", { method: "DELETE" })
    expect(removed.status).toBe(204)
    expect((await account(b)).signInMethods.github).toBeNull()
    expect((await latestEmail(db, email, "security_alert"))?.subject).toBe(
      "GitHub sign-in removed from your Test Shinan account",
    )
    const entries = await securityLog(me.person.id, "sign-in-method.removed")
    expect(entries).toHaveLength(1)
  })

  it("refuses a GitHub account already linked to someone else", async () => {
    const first = browser()
    await signInWithGitHub(first)
    await first.signIn(db, await allowlisted(), { fromGitHubStep: true })
    const takenId = nextId

    const second = browser()
    await second.signIn(db, await allowlisted())
    github.set({ id: takenId, login: "taken" })
    const result = await signInWithGitHub(second, {
      path: "/api/account/github",
      body: { callbackURL: "/account" },
    })
    expect(result.location).toMatch(/\/account\?error=/)
    expect((await account(second)).signInMethods.github).toBeNull()
  })
})
