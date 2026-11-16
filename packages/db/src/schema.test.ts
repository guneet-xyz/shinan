import { eq, sql } from "drizzle-orm"
import { DatabaseError } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  emailDeliveries,
  events,
  installation,
  members,
  people,
  securityLog,
  workspaces,
} from "./schema.js"
import { connectTestDatabase } from "./testing.js"

const { db, pool } = connectTestDatabase()

afterAll(async () => {
  await pool.end()
})

/** Runs a statement and returns the PostgreSQL error code it fails with. */
async function errorCode(statement: Promise<unknown>): Promise<string> {
  try {
    await statement
  } catch (error) {
    const cause =
      error instanceof DatabaseError ? error : (error as Error).cause
    if (cause instanceof DatabaseError && cause.code) return cause.code
    throw error
  }
  throw new Error("Expected the statement to fail")
}

const insufficientPrivilege = "42501"

describe("the security log", () => {
  let entryId: number

  beforeAll(async () => {
    const [entry] = await db
      .insert(securityLog)
      .values({
        action: "test.entry",
        outcome: "succeeded",
        actorKind: "shinan",
        actorLabel: "shinan",
        confidence: "recorded",
        networkAddress: "192.0.2.1",
      })
      .returning({ id: securityLog.id })
    entryId = entry!.id
  })

  it("refuses updates", async () => {
    expect(
      await errorCode(
        db
          .update(securityLog)
          .set({ action: "changed" })
          .where(eq(securityLog.id, entryId)),
      ),
    ).toBe(insufficientPrivilege)
  })

  it("refuses deletes", async () => {
    expect(
      await errorCode(
        db.delete(securityLog).where(eq(securityLog.id, entryId)),
      ),
    ).toBe(insufficientPrivilege)
  })

  it("refuses truncation", async () => {
    expect(await errorCode(db.execute(sql`truncate security_log`))).toBe(
      insufficientPrivilege,
    )
  })

  it("keeps the entry unchanged", async () => {
    const rows = await db
      .select({ action: securityLog.action })
      .from(securityLog)
      .where(eq(securityLog.id, entryId))
    expect(rows).toEqual([{ action: "test.entry" }])
  })

  it("requires a person for people and agents", async () => {
    expect(
      await errorCode(
        db.insert(securityLog).values({
          action: "test.entry",
          outcome: "succeeded",
          actorKind: "agent",
          actorLabel: "someone",
          confidence: "recorded",
        }),
      ),
    ).toBe("23514")
  })
})

describe("events", () => {
  let eventId: number

  beforeAll(async () => {
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: "Events" })
      .returning()
    const [event] = await db
      .insert(events)
      .values({
        workspaceId: workspace!.id,
        kind: "test.event",
        origin: "shinan_action",
        actorKind: "shinan",
        actorLabel: "shinan",
        confidence: "recorded",
        summary: "Something happened",
      })
      .returning({ id: events.id })
    eventId = event!.id
  })

  it("refuses updates, deletes and truncation", async () => {
    expect(
      await errorCode(
        db
          .update(events)
          .set({ summary: "changed" })
          .where(eq(events.id, eventId)),
      ),
    ).toBe(insufficientPrivilege)
    expect(
      await errorCode(db.delete(events).where(eq(events.id, eventId))),
    ).toBe(insufficientPrivilege)
    expect(await errorCode(db.execute(sql`truncate events`))).toBe(
      insufficientPrivilege,
    )
  })
})

describe("constraints", () => {
  it("holds a single installation row", async () => {
    await db.insert(installation).values({ name: "Shinan" })
    expect(
      await errorCode(db.insert(installation).values({ id: 2, name: "Other" })),
    ).toBe("23514")
  })

  it("refuses a member invited by a member of another workspace", async () => {
    const [person] = await db
      .insert(people)
      .values({ handle: "cross", name: "Cross", email: "cross@example.com" })
      .returning()
    const [one, two] = await db
      .insert(workspaces)
      .values([{ name: "One" }, { name: "Two" }])
      .returning()
    const [inviter] = await db
      .insert(members)
      .values({ workspaceId: one!.id, personId: person!.id, role: "owner" })
      .returning()

    expect(
      await errorCode(
        db.insert(members).values({
          workspaceId: two!.id,
          personId: person!.id,
          role: "contributor",
          invitedByMemberId: inviter!.id,
        }),
      ),
    ).toBe("23503")
  })

  it("allows one current membership per person and workspace", async () => {
    const [person] = await db
      .insert(people)
      .values({ handle: "twice", name: "Twice", email: "twice@example.com" })
      .returning()
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: "Twice" })
      .returning()
    const member = {
      workspaceId: workspace!.id,
      personId: person!.id,
      role: "contributor" as const,
    }
    await db.insert(members).values({ ...member, removedAt: new Date() })
    await db.insert(members).values(member)

    expect(await errorCode(db.insert(members).values(member))).toBe("23505")
  })

  it("checks handles and lower-case email addresses", async () => {
    expect(
      await errorCode(
        db.insert(people).values({
          handle: "Bad Handle",
          name: "Bad",
          email: "bad@example.com",
        }),
      ),
    ).toBe("23514")
    expect(
      await errorCode(
        db.insert(people).values({
          handle: "upper",
          name: "Upper",
          email: "Upper@example.com",
        }),
      ),
    ).toBe("23514")
  })
})

describe("email deliveries", () => {
  const queued = {
    kind: "magic_link" as const,
    recipient: "someone@example.com",
    notAfter: new Date(Date.now() + 60_000),
    message: { subject: "S", text: "T", html: "<p>T</p>" },
  }

  it("keep the message only while queued", async () => {
    const [row] = await db
      .insert(emailDeliveries)
      .values(queued)
      .returning({ id: emailDeliveries.id })

    expect(
      await errorCode(
        db
          .update(emailDeliveries)
          .set({ status: "sent", finishedAt: new Date() })
          .where(eq(emailDeliveries.id, row!.id)),
      ),
    ).toBe("23514")
    expect(
      await errorCode(
        db.insert(emailDeliveries).values({ ...queued, message: null }),
      ),
    ).toBe("23514")

    await db
      .update(emailDeliveries)
      .set({ status: "sent", finishedAt: new Date(), message: null })
      .where(eq(emailDeliveries.id, row!.id))
  })

  it("are finished exactly when they are no longer queued", async () => {
    expect(
      await errorCode(
        db
          .insert(emailDeliveries)
          .values({ ...queued, finishedAt: new Date() }),
      ),
    ).toBe("23514")
    expect(
      await errorCode(
        db
          .insert(emailDeliveries)
          .values({ ...queued, status: "throttled", message: null }),
      ),
    ).toBe("23514")
  })

  it("store recipients in lower case", async () => {
    expect(
      await errorCode(
        db
          .insert(emailDeliveries)
          .values({ ...queued, recipient: "Someone@example.com" }),
      ),
    ).toBe("23514")
  })
})
