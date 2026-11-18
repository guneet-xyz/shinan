import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import type * as Api from "@shinan/api-client"
import { prepareSetupLink, shinan } from "@shinan/core"
import { eq, schema } from "@shinan/db"

import {
  Browser,
  emailsTo,
  installationUrl,
  latestLink,
  startInstallation,
} from "../../test/installation.js"
import type { Installation } from "../../test/installation.js"
import { announceSetupLink } from "../commands.js"

let installation: Installation
let db: Installation["db"]
const operator = "operator@example.com"

beforeAll(async () => {
  installation = await startInstallation({
    operators: [operator, "second-operator@example.com"],
    claimed: false,
  })
  db = installation.db
})

afterAll(async () => {
  await installation?.stop()
})

const browser = () => new Browser(installation)

async function installationRow() {
  const [row] = await db.select().from(schema.installation)
  return row!
}

describe("first start", () => {
  it("prints the setup link once to the log, and a restart replaces it", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    try {
      await announceSetupLink(db, { installationUrl, operators: [operator] })
      const printed = String(info.mock.calls[0]?.[0])
      const token = /\/setup#(\S+)/.exec(printed)?.[1]
      expect(token).toBeDefined()
      const [stored] = await db.select().from(schema.setupLinks)
      expect(stored!.tokenHash).not.toContain(token!)

      await announceSetupLink(db, { installationUrl, operators: [operator] })
      const response = await browser().request("/api/setup", {
        body: { token, email: operator },
      })
      expect(response.status).toBe(404)
    } finally {
      info.mockRestore()
    }
  })

  it("sends no sign-in links, even to operators, before the installation is claimed", async () => {
    await browser().requestLink(operator)
    expect(await emailsTo(db, operator)).toBe(0)
  })

  it("accepts only a configured operator address", async () => {
    const token = await prepareSetupLink({ db, actor: shinan })
    const response = await browser().request("/api/setup", {
      body: { token, email: "someone@example.com" },
    })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ rule: "not-operator" })
    // An address no sign-in link could go to is refused plainly, not a 500.
    const local = await browser().request("/api/setup", {
      body: { token, email: "you@localhost" },
    })
    expect(local.status).toBe(422)
    expect(await local.json()).toMatchObject({ rule: "email-format" })
  })

  it("works once", async () => {
    const token = await prepareSetupLink({ db, actor: shinan })
    const first = await browser().request("/api/setup", {
      body: { token, email: operator },
    })
    expect(first.status).toBe(204)
    const again = await browser().request("/api/setup", {
      body: { token, email: "second-operator@example.com" },
    })
    expect(again.status).toBe(404)
  })

  it("claims the installation once the operator opens the link sent to them", async () => {
    const token = await prepareSetupLink({ db, actor: shinan })
    const b = browser()
    const started = await b.request("/api/setup", {
      body: { token, email: operator },
    })
    expect(started.status).toBe(204)
    expect((await installationRow()).claimedAt).toBeNull()

    // Another operator address cannot use the link meanwhile.
    await browser().requestLink("second-operator@example.com")
    expect(await emailsTo(db, "second-operator@example.com")).toBe(0)

    // A double click: both openings at once leave exactly one signed in.
    const link = (await latestLink(db, operator))!
    const other = browser()
    const [opened, raced] = await Promise.all([b.open(link), other.open(link)])
    expect([opened.location, raced.location].sort()).toEqual([
      "/",
      "/sign-in?error=INVALID_TOKEN",
    ])
    const signedIn = opened.location === "/" ? b : other
    expect((await installationRow()).claimedAt).toBeInstanceOf(Date)
    expect(await db.select().from(schema.setupLinks)).toHaveLength(0)

    const account = (await (await signedIn.account()).json()) as Api.Account
    expect(account.person.handle).toBe("operator")
    expect(account.operator).toBe(true)
    const actions = (
      await db
        .select({ action: schema.securityLog.action })
        .from(schema.securityLog)
        .where(eq(schema.securityLog.subjectPersonId, account.person.id))
    ).map((e) => e.action)
    expect(actions).toEqual(
      expect.arrayContaining([
        "installation.claimed",
        "account.created",
        "sign-in.succeeded",
      ]),
    )

    // The setup link is gone for good, and no new one is made.
    const again = await browser().request("/api/setup", {
      body: { token, email: operator },
    })
    expect(again.status).toBe(404)
    expect(await prepareSetupLink({ db, actor: shinan })).toBeNull()
  })

  it("lets operators keep the allowlist, with re-authentication", async () => {
    const op = browser()
    await op.signIn(db, operator)
    const added = await op.request("/api/installation/allowlist", {
      body: { email: "New.Person@Example.com" },
    })
    expect(added.status).toBe(204)
    const list = (await (
      await op.request("/api/installation/allowlist")
    ).json()) as Api.AllowlistEntry[]
    expect(list.map((e) => [e.email, e.operator])).toEqual([
      ["new.person@example.com", false],
      [operator, true],
      ["second-operator@example.com", true],
    ])

    // The new person can now sign in.
    const person = browser()
    await person.signIn(db, "new.person@example.com")
    expect((await person.account()).status).toBe(200)
    // But cannot see or change the allowlist.
    expect((await person.request("/api/installation/allowlist")).status).toBe(
      403,
    )

    // Operators' own addresses come from configuration.
    const own = await op.request("/api/installation/allowlist/remove", {
      body: { email: operator },
    })
    expect(own.status).toBe(409)

    // Removing an address ends its sign-in sessions at once.
    const removed = await op.request("/api/installation/allowlist/remove", {
      body: { email: "new.person@example.com" },
    })
    expect(removed.status).toBe(204)
    expect((await person.account()).status).toBe(401)
    await person.requestLink("new.person@example.com")
    expect(await emailsTo(db, "new.person@example.com")).toBe(1)
  })

  it("lets only operators see the agent index's health", async () => {
    const op = browser()
    await op.signIn(db, operator)
    const response = await op.request("/api/installation/catalog-index")
    expect(response.status).toBe(200)
    const health = (await response.json()) as Api.CatalogIndexHealth
    expect(health.parserVersion).toBe(1)
    expect(Array.isArray(health.workspaces)).toBe(true)

    await op.request("/api/installation/allowlist", {
      body: { email: "reader@example.com" },
    })
    const person = browser()
    await person.signIn(db, "reader@example.com")
    expect(
      (await person.request("/api/installation/catalog-index")).status,
    ).toBe(403)
  })
})
