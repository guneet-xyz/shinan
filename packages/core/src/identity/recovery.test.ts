import type { PgBoss } from "pg-boss"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { eq, schema } from "@shinan/db"

import {
  asPerson,
  asShinan,
  newPerson,
  startTestJobQueue,
  testDatabase,
} from "../../test/helpers.js"
import { ForbiddenError, NotFoundError } from "../errors.js"
import { hashToken } from "../tokens.js"
import { acceptInvitation, createInvitation } from "./invitations.js"
import { changeEmailOf, endSessionsOf } from "./recovery.js"
import { openSignInLink } from "./sign-in.js"
import { createWorkspace } from "./workspaces.js"

const { db, pool } = testDatabase()
let boss: PgBoss

beforeAll(async () => {
  boss = await startTestJobQueue()
})

afterAll(async () => {
  await boss?.stop({ graceful: false })
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
      invitationsWithdrawn: 0,
      by: "operator command",
    })
  })

  it("leave the lost address unable to sign in or take the person's invitations", async () => {
    const owner = await newPerson(db, "owner")
    const person = await newPerson(db, "lost")
    const oldAddress = person.email
    await db
      .insert(schema.emailAllowlist)
      .values({ email: oldAddress })
      .onConflictDoNothing()
    const ownerCtx = {
      ...asPerson(db, owner),
      jobs: boss,
      installationUrl: "https://shinan.test",
    }
    const { workspace } = await createWorkspace(ownerCtx, { name: "Team" })
    const invitation = await createInvitation(ownerCtx, {
      workspaceId: workspace.id,
      email: oldAddress,
      role: "owner",
    })

    await changeEmailOf(asShinan(db), {
      handle: person.handle,
      email: `${person.handle}-recovered@example.com`,
    })

    // Off the allowlist: a link to the old address no longer opens, so no
    // new account can be made with it.
    const [listed] = await db
      .select()
      .from(schema.emailAllowlist)
      .where(eq(schema.emailAllowlist.email, oldAddress))
    expect(listed).toBeUndefined()
    expect(await openSignInLink(asShinan(db), { email: oldAddress })).toEqual({
      allowed: false,
    })
    // The invitation is withdrawn, recorded in the workspace's log.
    const [row] = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, invitation.id))
    expect(row!.state).toBe("withdrawn")
    await expect(
      acceptInvitation(asPerson(db, person), { invitationId: invitation.id }),
    ).rejects.toBeInstanceOf(NotFoundError)
    const entries = await db
      .select()
      .from(schema.securityLog)
      .where(eq(schema.securityLog.subjectPersonId, person.id))
    expect(
      entries.find((e) => e.action === "invitation.withdrawn"),
    ).toMatchObject({
      workspaceId: workspace.id,
      details: { reason: "email-changed" },
    })
    expect(
      entries.find((e) => e.action === "allowlist.removed")?.details,
    ).toMatchObject({ email: oldAddress })
  })

  it("keep an operator's old address on the allowlist", async () => {
    const person = await newPerson(db, "op")
    await db
      .insert(schema.installationOperators)
      .values({ email: person.email })
    await db.insert(schema.emailAllowlist).values({ email: person.email })
    await changeEmailOf(asShinan(db), {
      handle: person.handle,
      email: `${person.handle}-new@example.com`,
    })
    const [listed] = await db
      .select()
      .from(schema.emailAllowlist)
      .where(eq(schema.emailAllowlist.email, person.email))
    expect(listed).toBeDefined()
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
