import type { PgBoss } from "pg-boss"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { and, eq, schema, sql } from "@shinan/db"

import {
  newPerson,
  startTestJobQueue,
  testDatabase,
} from "../../test/helpers.js"
import type { Context } from "../context.js"
import {
  BusyError,
  ForbiddenError,
  NotFoundError,
  ReauthenticationRequiredError,
} from "../errors.js"
import { hashToken } from "../tokens.js"
import {
  cancelEmailChange,
  confirmEmailChange,
  getEmailChange,
  requestEmailChange,
} from "./email-change.js"
import { createInvitation } from "./invitations.js"
import type { Person } from "./people.js"
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

function as(
  person: Person,
  options: { reauthenticated?: boolean; signInSessionId?: string } = {},
): Context {
  return {
    db,
    actor: {
      kind: "person",
      personId: person.id,
      reauthenticated: options.reauthenticated ?? true,
      ...(options.signInSessionId
        ? { signInSessionId: options.signInSessionId }
        : {}),
    },
    jobs: boss,
    installationUrl: "https://shinan.test",
    request: { networkAddress: "192.0.2.40", client: "test" },
  }
}

async function allowlist(email: string) {
  await db.insert(schema.emailAllowlist).values({ email }).onConflictDoNothing()
}

async function addSession(personId: string): Promise<string> {
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

async function emailsTo(email: string, kind?: string) {
  const rows = await db
    .select()
    .from(schema.emailDeliveries)
    .where(eq(schema.emailDeliveries.recipient, email))
    .orderBy(schema.emailDeliveries.createdAt)
  return kind ? rows.filter((r) => r.kind === kind) : rows
}

/** The token in the latest confirmation link sent to an address. */
async function linkTokenFor(email: string): Promise<string> {
  const [latest] = (await emailsTo(email, "email_change")).slice(-1)
  return /\/email-change#(\S+)/.exec(latest!.message!.text)![1]!
}

async function entriesFor(personId: string, action: string) {
  return (
    await db
      .select()
      .from(schema.securityLog)
      .where(eq(schema.securityLog.subjectPersonId, personId))
      .orderBy(schema.securityLog.id)
  ).filter((r) => r.action === action)
}

/** A person with an allowlisted new address to move to. */
async function withNewAddress() {
  const person = await newPerson(db, "mover")
  await allowlist(person.email)
  const email = `${person.handle}-new@example.com`
  await allowlist(email)
  return { person, email }
}

describe("requestEmailChange", () => {
  it("emails a link to the new address and alerts the old one, changing nothing yet", async () => {
    const { person, email } = await withNewAddress()
    const pending = await requestEmailChange(as(person), {
      email: email.toUpperCase(),
    })
    expect(pending.email).toBe(email)
    expect(await getEmailChange(as(person))).toEqual(pending)

    const [link] = await emailsTo(email, "email_change")
    expect(link!.message!.subject).toContain("Confirm your new email address")
    expect(link!.message!.text).toMatch(
      /https:\/\/shinan\.test\/email-change#\S+/,
    )
    const [alert] = await emailsTo(person.email, "security_alert")
    expect(alert!.message!.text).toContain(email)
    // Only the token's hash is stored.
    const token = await linkTokenFor(email)
    const [row] = await db
      .select()
      .from(schema.emailChanges)
      .where(eq(schema.emailChanges.personId, person.id))
    expect(row!.tokenHash).toBe(hashToken(token))
    expect(JSON.stringify(row)).not.toContain(token)

    const [stored] = await db
      .select()
      .from(schema.people)
      .where(eq(schema.people.id, person.id))
    expect(stored!.email).toBe(person.email)
    expect(
      await entriesFor(person.id, "account.email-change-requested"),
    ).toMatchObject([{ details: { from: person.email, to: email } }])
  })

  it("needs a recent sign-in, and is only for people", async () => {
    const { person, email } = await withNewAddress()
    await expect(
      requestEmailChange(as(person, { reauthenticated: false }), { email }),
    ).rejects.toBeInstanceOf(ReauthenticationRequiredError)
    await expect(
      requestEmailChange({ db, actor: { kind: "shinan" } }, { email }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("refuses an address off the allowlist, taken by another account, or the same one", async () => {
    const { person } = await withNewAddress()
    await expect(
      requestEmailChange(as(person), { email: "nobody-listed@example.com" }),
    ).rejects.toMatchObject({ rule: "not-allowlisted" })
    const other = await newPerson(db, "holder")
    await allowlist(other.email)
    await expect(
      requestEmailChange(as(person), { email: other.email }),
    ).rejects.toMatchObject({ rule: "email-taken" })
    await expect(
      requestEmailChange(as(person), { email: person.email }),
    ).rejects.toMatchObject({ rule: "same-email" })
    await expect(
      requestEmailChange(as(person), { email: "not an address" }),
    ).rejects.toMatchObject({ rule: "email" })
    expect(await emailsTo(other.email)).toEqual([])
  })

  it("leaves operators' addresses to the configuration", async () => {
    const { person, email } = await withNewAddress()
    await db
      .insert(schema.installationOperators)
      .values({ email })
      .onConflictDoNothing()
    await expect(
      requestEmailChange(as(person), { email }),
    ).rejects.toMatchObject({ rule: "operator-address" })
    const operator = await newPerson(db, "operator")
    await db
      .insert(schema.installationOperators)
      .values({ email: operator.email })
      .onConflictDoNothing()
    const free = `${operator.handle}-new@example.com`
    await allowlist(free)
    await expect(
      requestEmailChange(as(operator), { email: free }),
    ).rejects.toMatchObject({ rule: "operator-address" })
  })

  it("limits how often a person may ask", async () => {
    const { person, email } = await withNewAddress()
    for (let i = 0; i < 5; i++) await requestEmailChange(as(person), { email })
    await expect(
      requestEmailChange(as(person), { email }),
    ).rejects.toBeInstanceOf(BusyError)
  })
})

describe("confirmEmailChange", () => {
  it("moves the account to the new address from the link, signed in as the person who asked", async () => {
    const { person, email } = await withNewAddress()
    const kept = await addSession(person.id)
    await addSession(person.id)
    const workspace = await createWorkspace(as(person), { name: "Mine" })
    const owner = await newPerson(db, "owner")
    const team = await createWorkspace(as(owner), { name: "Team" })
    const invitation = await createInvitation(as(owner), {
      workspaceId: team.workspace.id,
      email: person.email,
      role: "contributor",
    })
    await requestEmailChange(as(person), { email })
    const token = await linkTokenFor(email)

    expect(
      await confirmEmailChange(as(person, { signInSessionId: kept }), {
        token,
      }),
    ).toEqual({ email })
    const [stored] = await db
      .select()
      .from(schema.people)
      .where(eq(schema.people.id, person.id))
    expect(stored!.email).toBe(email)
    // Still a member where they were.
    expect(workspace.workspace.id).toBeTruthy()
    const [member] = await db
      .select()
      .from(schema.members)
      .where(
        and(
          eq(schema.members.personId, person.id),
          eq(schema.members.workspaceId, workspace.workspace.id),
        ),
      )
    expect(member).toBeTruthy()
    // The old address can no longer sign in or make an account.
    const allowlisted = await db
      .select()
      .from(schema.emailAllowlist)
      .where(eq(schema.emailAllowlist.email, person.email))
    expect(allowlisted).toEqual([])
    // Its pending invitation is withdrawn, not moved.
    const [withdrawn] = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, invitation.id))
    expect(withdrawn!.state).toBe("withdrawn")
    // Every other sign-in session ended; this one stays.
    const sessions = await db
      .select()
      .from(schema.signInSessions)
      .where(eq(schema.signInSessions.personId, person.id))
    expect(sessions.map((s) => s.id)).toEqual([kept])
    // Both addresses hear about it.
    for (const address of [person.email, email]) {
      const alerts = await emailsTo(address, "security_alert")
      expect(
        alerts.some((a) =>
          a.message!.subject.includes("email address changed"),
        ),
        address,
      ).toBe(true)
    }
    expect(await entriesFor(person.id, "account.email-changed")).toMatchObject([
      {
        actorKind: "person",
        details: {
          from: person.email,
          to: email,
          sessionsEnded: 1,
          invitationsWithdrawn: 1,
          by: "self",
        },
      },
    ])
    expect(await getEmailChange(as(person))).toBeNull()
    // The link works once.
    await expect(
      confirmEmailChange(as(person), { token }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it("does nothing for anyone but the person who asked", async () => {
    const { person, email } = await withNewAddress()
    await requestEmailChange(as(person), { email })
    const token = await linkTokenFor(email)
    // Whoever reads the new mailbox, signed in as someone else.
    const stranger = await newPerson(db, "stranger")
    await expect(
      confirmEmailChange(as(stranger), { token }),
    ).rejects.toBeInstanceOf(NotFoundError)
    const [stored] = await db
      .select()
      .from(schema.people)
      .where(eq(schema.people.id, stranger.id))
    expect(stored!.email).toBe(stranger.email)
    // The request is still there for its person.
    expect(await getEmailChange(as(person))).toMatchObject({ email })
  })

  it("refuses an expired link, and checks the address again", async () => {
    const { person, email } = await withNewAddress()
    await requestEmailChange(as(person), { email })
    const token = await linkTokenFor(email)
    await db
      .update(schema.emailChanges)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(schema.emailChanges.personId, person.id))
    await expect(
      confirmEmailChange(as(person), { token }),
    ).rejects.toBeInstanceOf(NotFoundError)

    // Asked again, then the address was taken by an account meanwhile.
    await requestEmailChange(as(person), { email })
    const again = await linkTokenFor(email)
    const [taker] = await db
      .insert(schema.people)
      .values({ handle: `${person.handle}-taker`, name: "Taker", email })
      .returning()
    await expect(
      confirmEmailChange(as(person), { token: again }),
    ).rejects.toMatchObject({ rule: "email-taken" })
    expect(taker).toBeTruthy()
  })

  it("never deadlocks with an owner changing an invitation to the old address", async () => {
    const { person, email } = await withNewAddress()
    const owner = await newPerson(db, "owner")
    const team = await createWorkspace(as(owner), { name: "Team" })
    const invitation = await createInvitation(as(owner), {
      workspaceId: team.workspace.id,
      email: person.email,
      role: "contributor",
    })
    await requestEmailChange(as(person), { email })
    const token = await linkTokenFor(email)
    // An owner sending the invitation again: workspace first, then the
    // invitation.
    const client = await pool.connect()
    try {
      await client.query("begin")
      await client.query("select id from workspaces where id = $1 for update", [
        team.workspace.id,
      ])
      const confirming = confirmEmailChange(as(person), { token })
      await new Promise((resolve) => setTimeout(resolve, 300))
      await client.query(
        "update invitations set expires_at = now() + interval '7 days' where id = $1",
        [invitation.id],
      )
      await client.query("commit")
      await expect(confirming).resolves.toEqual({ email })
    } finally {
      client.release()
    }
    const [withdrawn] = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, invitation.id))
    expect(withdrawn!.state).toBe("withdrawn")
  })

  it("lets the old address make no new account afterwards", async () => {
    const { person, email } = await withNewAddress()
    await requestEmailChange(as(person), { email })
    await confirmEmailChange(as(person), { token: await linkTokenFor(email) })
    const opened = await openSignInLink(
      { db, actor: { kind: "shinan" } },
      { email: person.email },
    )
    expect(opened).toEqual({ allowed: false })
  })
})

describe("cancelEmailChange", () => {
  it("stops the link working", async () => {
    const { person, email } = await withNewAddress()
    await requestEmailChange(as(person), { email })
    const token = await linkTokenFor(email)
    await cancelEmailChange(as(person))
    expect(await getEmailChange(as(person))).toBeNull()
    await expect(
      confirmEmailChange(as(person), { token }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(cancelEmailChange(as(person))).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })
})
