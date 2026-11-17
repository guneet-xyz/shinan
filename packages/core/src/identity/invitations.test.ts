import type { PgBoss } from "pg-boss"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { and, eq, schema, sql } from "@shinan/db"

import {
  asAgent,
  newPerson,
  startTestJobQueue,
  testDatabase,
} from "../../test/helpers.js"
import type { Context } from "../context.js"
import {
  ForbiddenError,
  NotFoundError,
  ReauthenticationRequiredError,
} from "../errors.js"
import { listEvents } from "../events.js"
import { listSecurityLog } from "../security-log-read.js"
import { hashToken } from "../tokens.js"
import {
  acceptInvitation,
  createInvitation,
  declineInvitation,
  findInvitation,
  listInvitations,
  listInvitationsForYou,
  resendInvitation,
  withdrawInvitation,
} from "./invitations.js"
import { addMember, listMembers, removeMember } from "./members.js"
import type { Person } from "./people.js"
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
  options: { reauthenticated?: boolean } = {},
): Context {
  return {
    db,
    actor: {
      kind: "person",
      personId: person.id,
      reauthenticated: options.reauthenticated ?? true,
    },
    jobs: boss,
    installationUrl: "https://shinan.test",
    request: { networkAddress: "192.0.2.30", client: "test" },
  }
}

let owner: Person
let contributor: Person
let invitee: Person
let workspaceId: string

beforeEach(async () => {
  owner = await newPerson(db, "owner")
  contributor = await newPerson(db, "contributor")
  invitee = await newPerson(db, "invitee")
  const created = await createWorkspace(as(owner), { name: "Team" })
  workspaceId = created.workspace.id
  await addMember(as(owner), {
    workspaceId,
    personId: contributor.id,
    role: "contributor",
  })
  await db
    .insert(schema.emailAllowlist)
    .values({ email: invitee.email })
    .onConflictDoNothing()
})

/** Invites the invitee and returns the invitation and its link's token. */
async function invite(role: "owner" | "contributor" = "contributor") {
  const invitation = await createInvitation(as(owner), {
    workspaceId,
    email: invitee.email,
    role,
  })
  return { invitation, token: await latestToken(invitee.email) }
}

async function latestToken(email: string): Promise<string> {
  const deliveries = await db
    .select()
    .from(schema.emailDeliveries)
    .where(
      and(
        eq(schema.emailDeliveries.recipient, email),
        eq(schema.emailDeliveries.kind, "invitation"),
      ),
    )
    .orderBy(schema.emailDeliveries.createdAt)
  return /\/invitation#(\S+)/.exec(deliveries.at(-1)!.message!.text)![1]!
}

describe("createInvitation", () => {
  it("emails a link to an allowlisted address, storing only its hash", async () => {
    const { invitation, token } = await invite("owner")
    expect(invitation).toMatchObject({
      email: invitee.email,
      role: "owner",
      state: "pending",
      invitedByHandle: owner.handle,
    })
    expect(invitation.expiresAt.getTime() - Date.now()).toBeGreaterThan(
      6.9 * 24 * 3_600_000,
    )
    const [row] = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, invitation.id))
    expect(row!.tokenHash).toBe(hashToken(token))

    const [delivery] = await db
      .select()
      .from(schema.emailDeliveries)
      .where(eq(schema.emailDeliveries.recipient, invitee.email))
    expect(delivery!.message!.subject).toBe(
      `${owner.handle} invited you to Team on Shinan`,
    )
    const [event] = await listEvents(as(owner), workspaceId)
    expect(event).toMatchObject({
      kind: "invitation.created",
      subjects: [{ type: "invitation", id: invitation.id }],
    })
    const [entry] = await listSecurityLog(as(owner), workspaceId)
    expect(entry).toMatchObject({
      action: "invitation.created",
      subjectPersonId: invitee.id,
      details: { email: invitee.email, role: "owner" },
    })
  })

  it("refuses an address that is not on the allowlist", async () => {
    await expect(
      createInvitation(as(owner), {
        workspaceId,
        email: "outsider@example.com",
        role: "contributor",
      }),
    ).rejects.toThrow(/installation operator/)
    await expect(
      createInvitation(as(owner), {
        workspaceId,
        email: "outsider@example.com",
        role: "contributor",
      }),
    ).rejects.toMatchObject({ rule: "not-allowlisted" })
  })

  it("refuses members and addresses with a pending invitation", async () => {
    await db
      .insert(schema.emailAllowlist)
      .values({ email: contributor.email })
      .onConflictDoNothing()
    await expect(
      createInvitation(as(owner), {
        workspaceId,
        email: contributor.email,
        role: "owner",
      }),
    ).rejects.toMatchObject({ rule: "already-member" })
    await invite()
    await expect(invite()).rejects.toMatchObject({ rule: "already-invited" })
  })

  it("replaces an expired invitation", async () => {
    const { invitation } = await invite()
    await db
      .update(schema.invitations)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(schema.invitations.id, invitation.id))
    expect((await listInvitations(as(owner), workspaceId))[0]!.state).toBe(
      "expired",
    )
    const { invitation: again } = await invite()
    const states = (await listInvitations(as(owner), workspaceId)).map((i) => [
      i.id,
      i.state,
    ])
    expect(states).toEqual([
      [again.id, "pending"],
      [invitation.id, "expired"],
    ])
  })

  it("is for workspace owners, people only, with re-authentication", async () => {
    const input = {
      workspaceId,
      email: invitee.email,
      role: "contributor" as const,
    }
    await expect(
      createInvitation(as(contributor), input),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      createInvitation(as(owner, { reauthenticated: false }), input),
    ).rejects.toBeInstanceOf(ReauthenticationRequiredError)
    await expect(
      createInvitation(await asAgent(db, owner, workspaceId), input),
    ).rejects.toMatchObject({ reason: "people-only" })
    await expect(
      listInvitations(as(contributor), workspaceId),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      listInvitations(as(invitee), workspaceId),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe("resendInvitation and withdrawInvitation", () => {
  it("send a new link, or stop the link working", async () => {
    const { invitation, token } = await invite()
    await resendInvitation(as(owner), {
      workspaceId,
      invitationId: invitation.id,
    })
    const newer = await latestToken(invitee.email)
    expect(newer).not.toBe(token)
    await expect(findInvitation(as(invitee), { token })).rejects.toBeInstanceOf(
      NotFoundError,
    )
    expect((await findInvitation(as(invitee), { token: newer })).id).toBe(
      invitation.id,
    )

    await withdrawInvitation(as(owner, { reauthenticated: false }), {
      workspaceId,
      invitationId: invitation.id,
    })
    await expect(
      findInvitation(as(invitee), { token: newer }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      withdrawInvitation(as(owner), {
        workspaceId,
        invitationId: invitation.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    const [entry] = await listSecurityLog(as(owner), workspaceId)
    expect(entry!.action).toBe("invitation.withdrawn")
  })

  it("answer not found for another workspace's invitation", async () => {
    const { invitation } = await invite()
    const other = await createWorkspace(as(contributor), { name: "Other" })
    await expect(
      withdrawInvitation(as(contributor), {
        workspaceId: other.workspace.id,
        invitationId: invitation.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe("acceptInvitation", () => {
  it("makes the invited person a member with the invitation's role", async () => {
    const { invitation, token } = await invite("owner")
    const yours = await listInvitationsForYou(as(invitee))
    expect(yours).toEqual([
      {
        id: invitation.id,
        workspaceId,
        workspaceName: "Team",
        invitedByHandle: owner.handle,
        role: "owner",
        expiresAt: invitation.expiresAt,
      },
    ])
    const accepted = await acceptInvitation(
      as(invitee, { reauthenticated: false }),
      { token },
    )
    expect(accepted.workspaceId).toBe(workspaceId)
    const members = await listMembers(as(invitee), workspaceId)
    expect(members.find((m) => m.personId === invitee.id)).toMatchObject({
      role: "owner",
      invitedByHandle: owner.handle,
    })
    const [event] = await listEvents(as(owner), workspaceId)
    expect(event).toMatchObject({
      kind: "member.joined",
      actorPersonId: invitee.id,
      summary: `${invitee.handle} joined as workspace owner, invited by ${owner.handle}`,
    })
    const [entry] = await listSecurityLog(as(owner), workspaceId)
    expect(entry).toMatchObject({
      action: "invitation.accepted",
      actorPersonId: invitee.id,
    })
    expect(await listInvitationsForYou(as(invitee))).toEqual([])
    await expect(
      acceptInvitation(as(invitee), { token }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it("is only for the person with the invited address", async () => {
    const { invitation, token } = await invite()
    for (const key of [{ token }, { invitationId: invitation.id }]) {
      await expect(
        acceptInvitation(as(contributor), key),
      ).rejects.toBeInstanceOf(NotFoundError)
    }
    // Agents never answer invitations, not even for an address their
    // person could accept (an agent of a non-member cannot exist).
    await expect(
      acceptInvitation(await asAgent(db, contributor, workspaceId), { token }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("refuses an expired invitation", async () => {
    const { invitation, token } = await invite()
    await db
      .update(schema.invitations)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(schema.invitations.id, invitation.id))
    await expect(
      acceptInvitation(as(invitee), { token }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it("lets a removed member rejoin through a new invitation", async () => {
    const first = await invite()
    await acceptInvitation(as(invitee), { token: first.token })
    const member = (await listMembers(as(owner), workspaceId)).find(
      (m) => m.personId === invitee.id,
    )!
    await removeMember(as(owner), { workspaceId, memberId: member.id })
    const second = await invite()
    const again = await acceptInvitation(as(invitee), { token: second.token })
    expect(again.memberId).not.toBe(member.id)
  })
})

describe("declineInvitation", () => {
  it("records the answer in the workspace's log", async () => {
    const { invitation } = await invite()
    await declineInvitation(as(invitee), { invitationId: invitation.id })
    expect(
      (await listInvitations(as(owner), workspaceId)).map((i) => i.state),
    ).toEqual(["declined"])
    const [entry] = await listSecurityLog(as(owner), workspaceId)
    expect(entry).toMatchObject({
      action: "invitation.declined",
      actorPersonId: invitee.id,
    })
    await expect(
      declineInvitation(as(invitee), { invitationId: invitation.id }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
