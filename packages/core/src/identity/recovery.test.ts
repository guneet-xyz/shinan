import { afterAll, describe, expect, it } from "vitest"

import { eq, schema } from "@shinan/db"

import {
  asPerson,
  asShinan,
  newPerson,
  testDatabase,
} from "../../test/helpers.js"
import { ForbiddenError, NotFoundError } from "../errors.js"
import { hashToken } from "../tokens.js"
import { changeEmailOf, endSessionsOf } from "./recovery.js"

const { db, pool } = testDatabase()

afterAll(async () => {
  await pool.end()
})

async function addSession(personId: string) {
  await db.insert(schema.signInSessions).values({
    personId,
    tokenHash: hashToken(crypto.randomUUID()),
    expiresAt: new Date(Date.now() + 3_600_000),
  })
}

async function sessionsOf(personId: string) {
  return db
    .select()
    .from(schema.signInSessions)
    .where(eq(schema.signInSessions.personId, personId))
}

describe("operator recovery commands", () => {
  it("end a person's sign-in sessions, recorded as an operator command", async () => {
    const person = await newPerson(db)
    await addSession(person.id)
    await addSession(person.id)
    expect(await endSessionsOf(asShinan(db), { handle: person.handle })).toBe(2)
    expect(await sessionsOf(person.id)).toEqual([])
    const [entry] = await db
      .select()
      .from(schema.securityLog)
      .where(eq(schema.securityLog.subjectPersonId, person.id))
      .orderBy(schema.securityLog.id)
      .then((rows) => rows.filter((r) => r.action === "account.sessions-ended"))
    expect(entry).toMatchObject({
      actorKind: "shinan",
      details: { sessionsEnded: 2, by: "operator command" },
    })
  })

  it("change a person's address, allowlist it and end their sessions", async () => {
    const person = await newPerson(db)
    const other = await newPerson(db)
    await addSession(person.id)
    const email = `${person.handle}-new@example.com`
    await expect(
      changeEmailOf(asShinan(db), {
        handle: person.handle,
        email: other.email,
      }),
    ).rejects.toMatchObject({ rule: "email-taken" })
    await changeEmailOf(asShinan(db), {
      handle: person.handle,
      email: email.toUpperCase(),
    })
    const [updated] = await db
      .select()
      .from(schema.people)
      .where(eq(schema.people.id, person.id))
    expect(updated!.email).toBe(email)
    expect(await sessionsOf(person.id)).toEqual([])
    const [allowed] = await db
      .select()
      .from(schema.emailAllowlist)
      .where(eq(schema.emailAllowlist.email, email))
    expect(allowed).toBeDefined()
    const entries = await db
      .select()
      .from(schema.securityLog)
      .where(eq(schema.securityLog.subjectPersonId, person.id))
    expect(
      entries.find((e) => e.action === "account.email-changed")?.details,
    ).toEqual({
      from: person.email,
      to: email,
      sessionsEnded: 1,
      by: "operator command",
    })
  })

  it("are for the server only, and need a person who exists", async () => {
    const person = await newPerson(db)
    await expect(
      endSessionsOf(asPerson(db, person), { handle: person.handle }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      endSessionsOf(asShinan(db), { handle: "nobody-here" }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
