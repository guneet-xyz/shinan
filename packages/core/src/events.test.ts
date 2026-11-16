import { afterAll, describe, expect, it, vi } from "vitest"

import { sql } from "@shinan/db"

import {
  asPerson,
  asShinan,
  newPerson,
  testDatabase,
  uniqueHandle,
} from "../test/helpers.js"
import { inWorkspace } from "./authorize.js"
import { RuleViolationError } from "./errors.js"
import { appendEvent, listEvents } from "./events.js"
import type { WriteScope } from "./events.js"
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
      "member.add",
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

  it("are appended only under a write action", async () => {
    const person = await newPerson(db)
    const ctx = asPerson(db, person)
    const { workspace } = await createWorkspace(ctx, { name: "Reads" })

    await expect(
      inWorkspace(ctx, workspace.id, "workspace.read", (scope) =>
        // A read scope does not type-check here; check the runtime guard too.
        appendEvent(scope as unknown as WriteScope, {
          kind: "test.read",
          summary: "A read",
        }),
      ),
    ).rejects.toThrow(/not a write action/)
  })

  it("are listed newest first, a page at a time", async () => {
    const person = await newPerson(db)
    const ctx = asPerson(db, person)
    const { workspace } = await createWorkspace(ctx, { name: "Pages" })
    await inWorkspace(ctx, workspace.id, "member.add", async (scope) => {
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

  it("refuses a duplicate committed while it waits with a rule error", async () => {
    const handle = uniqueHandle("race")
    // Another connection inserts the same handle and has not committed, so
    // createPerson's own check passes and its insert waits on the row.
    const other = await pool.connect()
    try {
      await other.query("begin")
      await other.query(
        "insert into people (handle, name, email) values ($1, 'First', $2)",
        [handle, `${handle}@example.com`],
      )
      const attempt = createPerson(asShinan(db), {
        handle,
        name: "Second",
        email: `${handle}-2@example.com`,
      })
      await vi.waitFor(
        async () => {
          const { rows } = await db.execute<{ count: number }>(
            sql`select count(*)::int as count from pg_stat_activity
                where wait_event_type = 'Lock' and datname = current_database()
                and query ilike '%insert into "people"%'`,
          )
          expect(rows[0]!.count).toBe(1)
        },
        { timeout: 3_000, interval: 20 },
      )
      await other.query("commit")
      await expect(attempt).rejects.toMatchObject({ rule: "handle-taken" })
    } finally {
      await other.query("rollback").catch(() => {})
      other.release()
    }
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
