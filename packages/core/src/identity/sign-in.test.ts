import type { PgBoss } from "pg-boss"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { and, createDatabase, eq, schema, sql } from "@shinan/db"
import { createTestDatabase } from "@shinan/db/testing"
import type { TestDatabase } from "@shinan/db/testing"

import { startTestJobQueue } from "../../test/helpers.js"
import type { PersonActor } from "../actor.js"
import { shinan } from "../actor.js"
import type { Context } from "../context.js"
import {
  ForbiddenError,
  NotFoundError,
  ReauthenticationRequiredError,
} from "../errors.js"
import { hashToken } from "../tokens.js"
import { getAccount } from "./account.js"
import {
  addToAllowlist,
  listAllowlist,
  removeFromAllowlist,
  syncOperators,
} from "./allowlist.js"
import { setUpInstallation } from "./installation.js"
import {
  checkAddGitHub,
  describeClient,
  endAllSignInSessions,
  endSignInSession,
  listSignInSessions,
  maySignIn,
  openSignInLink,
  prepareSetupLink,
  pruneSignInRecords,
  recordGitHubAdded,
  recordSignIn,
  removeGitHub,
  sendSignInLink,
  startGitHubSignIn,
  startSetup,
} from "./sign-in.js"

// The installation record (claimed or not) is shared state, so these tests
// get a database of their own.
let database: TestDatabase
let db: Context["db"]
let pool: ReturnType<typeof createDatabase>["pool"]
let boss: PgBoss
let counter = 0

beforeAll(async () => {
  database = await createTestDatabase()
  ;({ db, pool } = createDatabase(database.url))
  boss = await startTestJobQueue(database.url)
  await setUpInstallation(asShinan(), { name: "Test" })
})

afterAll(async () => {
  await boss?.stop({ graceful: false })
  await pool?.end()
  await database?.drop()
})

function asShinan(): Context {
  return {
    db,
    actor: shinan,
    jobs: boss,
    installationUrl: "https://shinan.test",
    request: { networkAddress: "192.0.2.20", client: "Firefox/140.0 Linux" },
  }
}

function asPerson(
  personId: string,
  options: Partial<Omit<PersonActor, "kind" | "personId">> = {},
): Context {
  return {
    ...asShinan(),
    actor: { kind: "person", personId, reauthenticated: true, ...options },
  }
}

async function claim() {
  await db
    .update(schema.installation)
    .set({ claimedAt: sql`coalesce(claimed_at, now())` })
}

async function allowlisted(local = "person"): Promise<string> {
  const email = `${local}-${counter++}@example.com`.toLowerCase()
  await db.insert(schema.emailAllowlist).values({ email })
  return email
}

async function emails(to: string, kind = "magic_link") {
  return db
    .select()
    .from(schema.emailDeliveries)
    .where(
      and(
        eq(schema.emailDeliveries.recipient, to),
        eq(schema.emailDeliveries.kind, kind as "magic_link"),
      ),
    )
}

async function log(action: string, personId?: string) {
  return db
    .select()
    .from(schema.securityLog)
    .where(
      and(
        eq(schema.securityLog.action, action),
        personId ? eq(schema.securityLog.subjectPersonId, personId) : undefined,
      ),
    )
}

async function newAccount(local = "person") {
  const email = await allowlisted(local)
  const opened = await openSignInLink(asShinan(), { email })
  if (!opened.allowed) throw new Error("not allowed")
  return { email, personId: opened.personId }
}

const link = "https://shinan.test/api/auth/magic-link/verify?token=abc"
const inFifteen = () => new Date(Date.now() + 15 * 60_000)

describe("first start", () => {
  it("lets only the operator address chosen on the setup link claim the installation", async () => {
    await syncOperators(asShinan(), { emails: ["Root@Example.com"] })
    const token = (await prepareSetupLink(asShinan()))!
    expect(token).toBeTruthy()

    // No links before the setup link is used, even to operators.
    await sendSignInLink(asShinan(), {
      email: "root@example.com",
      link,
      expiresAt: inFifteen(),
    })
    expect(await emails("root@example.com")).toHaveLength(0)
    expect(
      await openSignInLink(asShinan(), { email: "root@example.com" }),
    ).toEqual({ allowed: false })

    await expect(
      startSetup(asShinan(), { token: "wrong", email: "root@example.com" }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      startSetup(asShinan(), { token, email: "someone@example.com" }),
    ).rejects.toMatchObject({ rule: "not-operator" })

    await startSetup(asShinan(), { token, email: "ROOT@example.com" })
    // The setup link works once.
    await expect(
      startSetup(asShinan(), { token, email: "root@example.com" }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await sendSignInLink(asShinan(), {
      email: "root@example.com",
      link,
      expiresAt: inFifteen(),
    })
    expect(await emails("root@example.com")).toHaveLength(1)

    const opened = await openSignInLink(asShinan(), {
      email: "root@example.com",
    })
    expect(opened).toMatchObject({ allowed: true, accountCreated: true })
    const [installation] = await db.select().from(schema.installation)
    expect(installation!.claimedAt).toBeInstanceOf(Date)
    expect(await prepareSetupLink(asShinan())).toBeNull()
    await expect(
      startSetup(asShinan(), { token, email: "root@example.com" }),
    ).rejects.toBeInstanceOf(NotFoundError)

    const account = await getAccount(
      asPerson(opened.allowed ? opened.personId : ""),
    )
    expect(account.person.handle).toBe("root")
    expect(account.operator).toBe(true)
  })
})

describe("after the first start", () => {
  beforeAll(claim)

  describe("sign-in links", () => {
    it("go only to allowlisted addresses, and are recorded", async () => {
      await sendSignInLink(asShinan(), {
        email: "nobody@example.com",
        link,
        expiresAt: inFifteen(),
      })
      expect(await emails("nobody@example.com")).toHaveLength(0)

      const email = await allowlisted()
      await sendSignInLink(asShinan(), {
        email: email.toUpperCase(),
        link,
        expiresAt: inFifteen(),
      })
      const [delivery] = await emails(email)
      expect(delivery!.message!.text).toContain(link)
      expect(delivery!.message!.text).toContain("expires in 15 minutes")
      expect(delivery!.notAfter.getTime()).toBeLessThanOrEqual(
        inFifteen().getTime(),
      )
      const entries = await log("sign-in.link-sent")
      expect(entries.at(-1)).toMatchObject({
        details: { method: "email" },
        networkAddress: "192.0.2.20",
      })
    })

    it("ignore an address that is not one", async () => {
      await sendSignInLink(asShinan(), {
        email: "not an address",
        link,
        expiresAt: inFifteen(),
      })
    })
  })

  describe("opening a link", () => {
    it("creates the account the first time, with a handle from the address", async () => {
      await db
        .insert(schema.emailAllowlist)
        .values([
          { email: "ada.lovelace@example.com" },
          { email: "ada.lovelace@example.org" },
          { email: "+++@example.com" },
        ])
      const first = await openSignInLink(asShinan(), {
        email: "Ada.Lovelace@example.com",
      })
      const second = await openSignInLink(asShinan(), {
        email: "ada.lovelace@example.org",
      })
      const odd = await openSignInLink(asShinan(), { email: "+++@example.com" })
      const handles = await Promise.all(
        [first, second, odd].map(async (opened) => {
          if (!opened.allowed) throw new Error("refused")
          expect(opened.accountCreated).toBe(true)
          return (await getAccount(asPerson(opened.personId))).person.handle
        }),
      )
      expect(handles).toEqual(["ada-lovelace", "ada-lovelace-2", "person"])

      const again = await openSignInLink(asShinan(), {
        email: "ada.lovelace@example.com",
      })
      expect(again).toMatchObject({ allowed: true, accountCreated: false })
    })

    it("never gives a handle reserved for other actors' written forms", async () => {
      await db
        .insert(schema.emailAllowlist)
        .values([
          { email: "shinan@other.example" },
          { email: "unknown@other.example" },
        ])
      const handles = []
      for (const email of ["shinan@other.example", "unknown@other.example"]) {
        const opened = await openSignInLink(asShinan(), { email })
        if (!opened.allowed) throw new Error("refused")
        handles.push(
          (await getAccount(asPerson(opened.personId))).person.handle,
        )
      }
      expect(handles).toEqual(["shinan-2", "unknown-2"])
    })

    it("takes the next handle when a concurrent sign-in takes it first", async () => {
      await db
        .insert(schema.emailAllowlist)
        .values({ email: "race@example.com" })
      // Another connection creates "race" but has not committed, so the
      // handle looks free; the insert then waits on it and clashes.
      const holder = await pool.connect()
      try {
        await holder.query("begin")
        await holder.query(
          "insert into people (handle, name, email) values ('race', 'race', 'race@other.example')",
        )
        const { rows } = await holder.query<{ pid: number }>(
          "select pg_backend_pid() as pid",
        )
        const opening = openSignInLink(asShinan(), {
          email: "race@example.com",
        })
        // Wait until the insert is blocked behind the holder's row.
        await vi.waitFor(
          async () => {
            const waiting = await db.execute<{ count: number }>(
              sql`select count(*)::int as count from pg_stat_activity
                  where ${rows[0]!.pid}::int = any(pg_blocking_pids(pid))`,
            )
            expect(waiting.rows[0]!.count).toBe(1)
          },
          { timeout: 3_000, interval: 20 },
        )
        await holder.query("commit")
        const opened = await opening
        if (!opened.allowed) throw new Error("refused")
        expect(
          (await getAccount(asPerson(opened.personId))).person.handle,
        ).toBe("race-2")
      } finally {
        holder.release()
      }
    })

    it("refuses an address a sign-in link could not go to", async () => {
      await expect(
        openSignInLink(asShinan(), { email: "you@localhost" }),
      ).rejects.toMatchObject({ rule: "email-format" })
    })

    it("refuses an address not on the allowlist, and records it", async () => {
      expect(
        await openSignInLink(asShinan(), { email: "outsider@example.com" }),
      ).toEqual({ allowed: false })
      const [person] = await db
        .select()
        .from(schema.people)
        .where(eq(schema.people.email, "outsider@example.com"))
      expect(person).toBeUndefined()
      const failures = await log("sign-in.failed")
      expect(failures.at(-1)).toMatchObject({
        outcome: "failed",
        details: { method: "email", reason: "not-allowed" },
      })
    })
  })

  describe("starting a sign-in session", () => {
    it("needs the person's address still on the allowlist", async () => {
      const { email, personId } = await newAccount()
      expect(await maySignIn(asShinan(), { personId })).toBe(true)
      await db
        .delete(schema.emailAllowlist)
        .where(eq(schema.emailAllowlist.email, email))
      expect(await maySignIn(asShinan(), { personId })).toBe(false)
      expect(await maySignIn(asShinan(), { personId: "not-an-id" })).toBe(false)
    })
  })

  describe("recording a sign-in", () => {
    async function session(personId: string) {
      const [row] = await db
        .insert(schema.signInSessions)
        .values({
          personId,
          tokenHash: hashToken(crypto.randomUUID()),
          expiresAt: new Date(Date.now() + 3_600_000),
        })
        .returning()
      return row!.id
    }

    it("emails the person about a browser new to their account", async () => {
      const { email, personId } = await newAccount()
      const first = await recordSignIn(asShinan(), {
        personId,
        sessionId: await session(personId),
        method: "email",
        accountCreated: true,
      })
      expect(await emails(email, "security_alert")).toHaveLength(0)

      await recordSignIn(asShinan(), {
        personId,
        sessionId: await session(personId),
        method: "email",
        accountCreated: false,
        browserToken: first.browserToken,
      })
      expect(await emails(email, "security_alert")).toHaveLength(0)

      const other = await recordSignIn(asShinan(), {
        personId,
        sessionId: await session(personId),
        method: "github",
        accountCreated: false,
      })
      expect(other.browserToken).not.toBe(first.browserToken)
      const [alert] = await emails(email, "security_alert")
      expect(alert!.message!.subject).toBe("New sign-in to Test")
      expect(alert!.message!.text).toContain("Firefox on Linux")
      const known = await db
        .select()
        .from(schema.knownBrowsers)
        .where(eq(schema.knownBrowsers.personId, personId))
      expect(known.map((k) => k.browserHash).sort()).toEqual(
        [hashToken(first.browserToken), hashToken(other.browserToken)].sort(),
      )
    })

    it("ends the session it replaces, and calls it re-authentication for the same person", async () => {
      const { personId } = await newAccount()
      const previous = await session(personId)
      const next = await session(personId)
      await recordSignIn(asShinan(), {
        personId,
        sessionId: next,
        method: "email",
        accountCreated: false,
        previousSessionId: previous,
      })
      const remaining = await db
        .select({ id: schema.signInSessions.id })
        .from(schema.signInSessions)
        .where(eq(schema.signInSessions.personId, personId))
      expect(remaining.map((r) => r.id)).toEqual([next])
      const [entry] = await log("sign-in.succeeded", personId)
      expect(entry!.details).toEqual({
        method: "email",
        sessionId: next,
        reauthentication: true,
      })
    })

    it("links a pending GitHub sign-in only for the address it waited for", async () => {
      const { email, personId } = await newAccount()
      const token = await startGitHubSignIn(asShinan(), {
        githubAccountId: "77",
        login: "octo",
      })
      // A link asked for another address in this browser does not count.
      const someoneElse = await newAccount()
      await sendSignInLink(asShinan(), {
        email: someoneElse.email,
        link,
        expiresAt: inFifteen(),
        pendingGitHubToken: token,
      })
      await recordSignIn(asShinan(), {
        personId,
        sessionId: await session(personId),
        method: "email",
        accountCreated: false,
        pendingGitHubToken: token,
      })
      expect(
        (await getAccount(asPerson(personId))).signInMethods.github,
      ).toBeNull()

      const again = await startGitHubSignIn(asShinan(), {
        githubAccountId: "77",
        login: "octo",
      })
      await sendSignInLink(asShinan(), {
        email,
        link,
        expiresAt: inFifteen(),
        pendingGitHubToken: again,
      })
      await recordSignIn(asShinan(), {
        personId,
        sessionId: await session(personId),
        method: "email",
        accountCreated: false,
        pendingGitHubToken: again,
      })
      const account = await getAccount(asPerson(personId))
      expect(account.signInMethods.github).toMatchObject({
        accountId: "77",
        login: "octo",
      })
      const [added] = await log("sign-in-method.added", personId)
      expect(added!.details).toMatchObject({
        method: "github",
        githubLogin: "octo",
      })
      const alerts = await emails(email, "security_alert")
      expect(alerts.map((a) => a.message!.subject)).toContain(
        "GitHub sign-in added to your Test account",
      )
    })
  })

  describe("sign-in sessions", () => {
    it("are listed and ended only by their own person", async () => {
      const mine = await newAccount()
      const theirs = await newAccount()
      const ids: string[] = []
      for (const personId of [mine.personId, mine.personId, theirs.personId]) {
        const [row] = await db
          .insert(schema.signInSessions)
          .values({
            personId,
            tokenHash: hashToken(crypto.randomUUID()),
            expiresAt: new Date(Date.now() + 3_600_000),
            ipAddress: "192.0.2.1",
            userAgent: "Test",
          })
          .returning()
        ids.push(row!.id)
      }
      const listed = await listSignInSessions(
        asPerson(mine.personId, { signInSessionId: ids[1] }),
      )
      expect(listed.map((s) => [s.id, s.current]).sort()).toEqual(
        [
          [ids[0], false],
          [ids[1], true],
        ].sort(),
      )
      await expect(
        endSignInSession(asPerson(mine.personId), { sessionId: ids[2]! }),
      ).rejects.toBeInstanceOf(NotFoundError)
      await endSignInSession(asPerson(mine.personId), { sessionId: ids[0]! })
      expect(await endAllSignInSessions(asPerson(mine.personId))).toBe(1)
      expect(await listSignInSessions(asPerson(theirs.personId))).toHaveLength(
        1,
      )
      await expect(listSignInSessions(asShinan())).rejects.toBeInstanceOf(
        ForbiddenError,
      )
    })
  })

  describe("GitHub as a sign-in method", () => {
    it("is added and removed only with a recent sign-in", async () => {
      const { email, personId } = await newAccount()
      await expect(
        checkAddGitHub(asPerson(personId, { reauthenticated: false })),
      ).rejects.toBeInstanceOf(ReauthenticationRequiredError)
      await checkAddGitHub(asPerson(personId))

      await db.insert(schema.signInAccounts).values({
        personId,
        providerId: "github",
        accountId: "991",
      })
      await recordGitHubAdded(asShinan(), {
        personId,
        githubAccountId: "991",
        login: "linked",
      })
      expect(
        (await getAccount(asPerson(personId))).signInMethods.github?.login,
      ).toBe("linked")
      await expect(checkAddGitHub(asPerson(personId))).rejects.toMatchObject({
        rule: "github-linked",
      })

      await expect(
        removeGitHub(asPerson(personId, { reauthenticated: false })),
      ).rejects.toBeInstanceOf(ReauthenticationRequiredError)
      await removeGitHub(asPerson(personId))
      expect(
        (await getAccount(asPerson(personId))).signInMethods.github,
      ).toBeNull()
      await expect(removeGitHub(asPerson(personId))).rejects.toBeInstanceOf(
        NotFoundError,
      )
      const subjects = (await emails(email, "security_alert")).map(
        (e) => e.message!.subject,
      )
      expect(subjects).toEqual([
        "GitHub sign-in added to your Test account",
        "GitHub sign-in removed from your Test account",
      ])
    })

    it("can never keep a GitHub token", async () => {
      const { personId } = await newAccount()
      await expect(
        db.insert(schema.signInAccounts).values({
          personId,
          providerId: "github",
          accountId: "992",
          accessToken: "gho_secret",
        }),
      ).rejects.toThrow()
    })
  })

  describe("the email allowlist", () => {
    it("is kept by operators, and removing an address ends its sessions", async () => {
      const operator = await newAccount("op")
      await syncOperators(asShinan(), {
        emails: ["root@example.com", operator.email],
      })
      const person = await newAccount()
      await expect(
        listAllowlist(asPerson(person.personId)),
      ).rejects.toBeInstanceOf(ForbiddenError)
      await expect(
        addToAllowlist(
          asPerson(operator.personId, { reauthenticated: false }),
          {
            email: "new@example.com",
          },
        ),
      ).rejects.toBeInstanceOf(ReauthenticationRequiredError)

      await addToAllowlist(asPerson(operator.personId), {
        email: "New@Example.com",
      })
      const listed = await listAllowlist(asPerson(operator.personId))
      expect(listed.find((e) => e.email === "new@example.com")).toMatchObject({
        operator: false,
        handle: null,
      })
      expect(listed.find((e) => e.email === operator.email)).toMatchObject({
        operator: true,
      })

      await db.insert(schema.signInSessions).values({
        personId: person.personId,
        tokenHash: hashToken(crypto.randomUUID()),
        expiresAt: new Date(Date.now() + 3_600_000),
      })
      await expect(
        removeFromAllowlist(asPerson(operator.personId), {
          email: operator.email,
        }),
      ).rejects.toMatchObject({ rule: "operator-address" })
      await removeFromAllowlist(asPerson(operator.personId), {
        email: person.email,
      })
      expect(await listSignInSessions(asPerson(person.personId))).toEqual([])
      expect(await maySignIn(asShinan(), { personId: person.personId })).toBe(
        false,
      )
      const [removed] = await log("allowlist.removed", person.personId)
      expect(removed).toMatchObject({
        actorPersonId: operator.personId,
        details: { email: person.email, signInSessionsEnded: 1 },
      })
    })

    it("records operators the configuration adds and removes", async () => {
      await syncOperators(asShinan(), {
        emails: ["root@example.com", "extra@example.com"],
      })
      await syncOperators(asShinan(), { emails: ["root@example.com"] })
      const added = await log("operator.added")
      const removed = await log("operator.removed")
      expect(added.some((e) => e.details.email === "extra@example.com")).toBe(
        true,
      )
      expect(removed.some((e) => e.details.email === "extra@example.com")).toBe(
        true,
      )
    })
  })
})

describe("pruneSignInRecords", () => {
  it("deletes expired sign-in sessions and GitHub sign-ins, and nothing else", async () => {
    const { personId } = await newAccount()
    const live = hashToken(crypto.randomUUID())
    await db.insert(schema.signInSessions).values([
      {
        personId,
        tokenHash: live,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
      {
        personId,
        tokenHash: hashToken(crypto.randomUUID()),
        expiresAt: new Date(Date.now() - 1000),
      },
    ])
    await startGitHubSignIn(asShinan(), { githubAccountId: "1" })
    await db.insert(schema.pendingGitHubSignIns).values({
      tokenHash: hashToken(crypto.randomUUID()),
      githubAccountId: "2",
      expiresAt: new Date(Date.now() - 1000),
    })
    const pruned = await pruneSignInRecords(asShinan())
    expect(pruned.signInSessions).toBeGreaterThanOrEqual(1)
    expect(pruned.pendingGitHubSignIns).toBeGreaterThanOrEqual(1)
    const sessions = await db
      .select()
      .from(schema.signInSessions)
      .where(eq(schema.signInSessions.personId, personId))
    expect(sessions.map((row) => row.tokenHash)).toEqual([live])
    const pending = await db.select().from(schema.pendingGitHubSignIns)
    expect(pending.every((row) => row.expiresAt.getTime() > Date.now())).toBe(
      true,
    )
  })
})

describe("describeClient", () => {
  it("names the browser and system", () => {
    expect(
      describeClient(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      ),
    ).toBe("Safari on macOS")
    expect(
      describeClient(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0",
      ),
    ).toBe("Edge on Windows")
    expect(describeClient(undefined)).toBe("an unknown browser")
  })
})
