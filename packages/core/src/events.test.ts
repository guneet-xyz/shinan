import { afterAll, describe, expect, it } from "vitest"

import { asPerson, asShinan, newPerson, testDatabase } from "../test/helpers.js"
import { inWorkspace } from "./authorize.js"
import { RuleViolationError } from "./errors.js"
import { appendEvent, listEvents } from "./events.js"
import { getInstallation, setUpInstallation } from "./identity/installation.js"
import { createPerson } from "./identity/people.js"
import { createWorkspace } from "./identity/workspaces.js"

const { db, pool } = testDatabase()

afterAll(async () => {
  await pool.end()
})

describe("events", () => {
  it("are credited to the actor and stored once per idempotency key", async () => {
    const person = await newPerson(db)
    const ctx = { ...asPerson(db, person), origin: "plugin_report" as const }
    const { workspace } = await createWorkspace(ctx, { name: "Events" })

    const [first, repeat] = await inWorkspace(
      ctx,
      workspace.id,
      "workspace.read",
      async (scope) => [
        await appendEvent(scope, {
          kind: "test.happened",
          summary: "It happened",
          idempotencyKey: "delivery-1",
          link: "https://example.com/1",
        }),
        await appendEvent(scope, {
          kind: "test.happened",
          summary: "It happened again",
          idempotencyKey: "delivery-1",
        }),
      ],
    )

    expect(first).toMatchObject({
      workspaceId: workspace.id,
      origin: "plugin_report",
      actorKind: "person",
      actorLabel: person.handle,
      link: "https://example.com/1",
    })
    expect(repeat).toBeNull()
  })

  it("are listed newest first, a page at a time", async () => {
    const person = await newPerson(db)
    const ctx = asPerson(db, person)
    const { workspace } = await createWorkspace(ctx, { name: "Pages" })
    await inWorkspace(ctx, workspace.id, "workspace.read", async (scope) => {
      for (const n of [1, 2, 3]) {
        await appendEvent(scope, { kind: "test.n", summary: `${n}` })
      }
    })

    const firstPage = await listEvents(ctx, workspace.id, { limit: 2 })
    expect(firstPage.map((e) => e.summary)).toEqual(["3", "2"])
    const secondPage = await listEvents(ctx, workspace.id, {
      limit: 2,
      before: firstPage[1]!.id,
    })
    expect(secondPage.map((e) => e.summary)).toEqual([
      "1",
      `${person.handle} created the workspace Pages`,
    ])
  })
})

describe("setUpInstallation", () => {
  it("creates the installation once", async () => {
    const first = await setUpInstallation(asShinan(db), { name: "Shinan" })
    const again = await setUpInstallation(asShinan(db), { name: "Renamed" })

    expect(again).toEqual(first)
    expect(await getInstallation(db)).toEqual(first)
  })

  it("is for Shinan only", async () => {
    const person = await newPerson(db)
    await expect(
      setUpInstallation(asPerson(db, person), { name: "Mine" }),
    ).rejects.toMatchObject({ reason: "actor" })
  })
})

describe("createPerson", () => {
  it("normalises the email address and refuses duplicates", async () => {
    const person = await newPerson(db, "dup")
    expect(person.email).toBe(`${person.handle}@example.com`)

    await expect(
      createPerson(asShinan(db), {
        handle: `${person.handle}-2`,
        name: "Other",
        email: person.email.toUpperCase(),
      }),
    ).rejects.toMatchObject({ rule: "email-taken" })
    await expect(
      createPerson(asShinan(db), {
        handle: person.handle,
        name: "Other",
        email: "other@example.com",
      }),
    ).rejects.toMatchObject({ rule: "handle-taken" })
  })

  it("checks the handle", async () => {
    await expect(
      createPerson(asShinan(db), {
        handle: "Not Valid",
        name: "Person",
        email: "valid@example.com",
      }),
    ).rejects.toBeInstanceOf(RuleViolationError)
  })
})
