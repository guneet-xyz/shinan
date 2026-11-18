import type { PgBoss } from "pg-boss"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { and, eq, schema, sql } from "@shinan/db"

import {
  asAgent,
  newPerson,
  startTestJobQueue,
  testDatabase,
} from "../../test/helpers.js"
import { shinan } from "../actor.js"
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
  expireInvitations,
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
    ]) // Its expiry is recorded as the job would, credited to Shinan.
    const expired = (await listEvents(as(owner), workspaceId)).filter(
      (e) => e.kind === "invitation.expired",
    )
    expect(expired).toMatchObject([
      { actorKind: "shinan", subjects: [{ id: invitation.id }] },
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

describe("expireInvitations", () => {
  async function pastExpiry(id: string, minutes = 5) {
    await db
      .update(schema.invitations)
      .set({ expiresAt: sql`now() - make_interval(mins => ${minutes})` })
      .where(eq(schema.invitations.id, id))
  }

  it("records pending invitations past their expiry once, as Shinan", async () => {
    const { invitation } = await invite()
    await pastExpiry(invitation.id)
    const other = await newPerson(db, "other")
    await db
      .insert(schema.emailAllowlist)
      .values({ email: other.email })
      .onConflictDoNothing()
    const current = await createInvitation(as(owner), {
      workspaceId,
      email: other.email,
      role: "contributor",
    })

    expect(await expireInvitations({ db, actor: shinan })).toBeGreaterThan(0)
    const [stored] = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, invitation.id))
    expect(stored).toMatchObject({ state: "expired" })
    // As of its expiry, not of the job's run.
    expect(stored!.decidedAt).toEqual(stored!.expiresAt)
    const [still] = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, current.id))
    expect(still).toMatchObject({ state: "pending", decidedAt: null })

    const events = (await listEvents(as(owner), workspaceId)).filter(
      (e) => e.kind === "invitation.expired",
    )
    expect(events).toMatchObject([
      {
        actorKind: "shinan",
        actorLabel: "shinan",
        subjects: [{ type: "invitation", id: invitation.id }],
        data: { email: invitee.email, role: "contributor" },
      },
    ])
    const entries = (await listSecurityLog(as(owner), workspaceId)).filter(
      (e) => e.action === "invitation.expired",
    )
    expect(entries).toMatchObject([
      {
        actorKind: "shinan",
        outcome: "succeeded",
        subjectPersonId: invitee.id,
        details: { invitationId: invitation.id },
      },
    ])

    // A second run finds nothing more to record for it.
    await expireInvitations({ db, actor: shinan })
    expect(
      (await listEvents(as(owner), workspaceId)).filter(
        (e) => e.kind === "invitation.expired",
      ),
    ).toHaveLength(1)
    // And the owners' list shows it as expired, as before.
    expect(
      (await listInvitations(as(owner), workspaceId)).find(
        (i) => i.id === invitation.id,
      ),
    ).toMatchObject({ state: "expired" })
  })

  it("leaves answered and withdrawn invitations alone", async () => {
    const { invitation } = await invite()
    await withdrawInvitation(as(owner), {
      workspaceId,
      invitationId: invitation.id,
    })
    await pastExpiry(invitation.id)
    await expireInvitations({ db, actor: shinan })
    const [stored] = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, invitation.id))
    expect(stored).toMatchObject({ state: "withdrawn" })
  })

  it("lets an owner send a recorded-expired invitation again, reopening it", async () => {
    const { invitation } = await invite()
    await pastExpiry(invitation.id)
    await expireInvitations({ db, actor: shinan })
    const resent = await resendInvitation(as(owner), {
      workspaceId,
      invitationId: invitation.id,
    })
    expect(resent).toMatchObject({ id: invitation.id, state: "pending" })
    const [stored] = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, invitation.id))
    expect(stored).toMatchObject({ state: "pending", decidedAt: null })
    // The new link works.
    const token = await latestToken(invitee.email)
    await acceptInvitation(as(invitee), { token })
  })

  it("refuses to reopen an expired invitation that a newer one replaced", async () => {
    const { invitation } = await invite()
    await pastExpiry(invitation.id)
    const { invitation: newer } = await invite()
    await expect(
      resendInvitation(as(owner), {
        workspaceId,
        invitationId: invitation.id,
      }),
    ).rejects.toMatchObject({ rule: "already-invited" })
    // The newer one can be sent again as usual.
    await resendInvitation(as(owner), {
      workspaceId,
      invitationId: newer.id,
    })
  })

  it("never deadlocks with an owner changing the workspace's invitations", async () => {
    const { invitation } = await invite()
    await pastExpiry(invitation.id)
    // An owner inviting the address again: the workspace is locked first,
    // then the old invitation is updated.
    const owner_ = await pool.connect()
    try {
      await owner_.query("begin")
      await owner_.query("select id from workspaces where id = $1 for update", [
        workspaceId,
      ])
      const job = expireInvitations({ db, actor: shinan })
      // Let the job reach this workspace while the owner holds it.
      await new Promise((resolve) => setTimeout(resolve, 300))
      await owner_.query(
        "update invitations set state = 'expired', decided_at = expires_at where id = $1",
        [invitation.id],
      )
      await owner_.query("commit")
      // The job leaves the busy workspace for its next run.
      await expect(job).resolves.toEqual(expect.any(Number))
    } finally {
      owner_.release()
    }
    const events = (await listEvents(as(owner), workspaceId)).filter(
      (e) => e.kind === "invitation.expired",
    )
    expect(events).toEqual([])
  })

  it("records the expiry of a replaced invitation as Shinan's, with no request", async () => {
    const { invitation } = await invite()
    await pastExpiry(invitation.id)
    await invite()
    const [event] = (await listEvents(as(owner), workspaceId)).filter(
      (e) => e.kind === "invitation.expired",
    )
    expect(event).toMatchObject({
      actorKind: "shinan",
      origin: "shinan_action",
    })
    const [entry] = (await listSecurityLog(as(owner), workspaceId)).filter(
      (e) => e.action === "invitation.expired",
    )
    expect(entry).toMatchObject({
      actorKind: "shinan",
      networkAddress: null,
      client: null,
    })
  })

  it("never waits on an invitation that a withdrawal or acceptance holds", async () => {
    const { invitation } = await invite()
    await pastExpiry(invitation.id)
    // Withdrawing or accepting: the invitation first, then (through the
    // events and members foreign keys) a share lock on the workspace.
    const other = await pool.connect()
    try {
      await other.query("begin")
      await other.query("select id from invitations where id = $1 for update", [
        invitation.id,
      ])
      const job = expireInvitations({ db, actor: shinan })
      await new Promise((resolve) => setTimeout(resolve, 300))
      await other.query(
        "update invitations set state = 'withdrawn', decided_at = now() where id = $1",
        [invitation.id],
      )
      await other.query(
        "select id from workspaces where id = $1 for key share",
        [workspaceId],
      )
      await other.query("commit")
      await expect(job).resolves.toEqual(expect.any(Number))
    } finally {
      other.release()
    }
    const [stored] = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, invitation.id))
    expect(stored!.state).toBe("withdrawn")
  })

  it("records the expiry first when an invitation past it is sent again", async () => {
    const { invitation } = await invite()
    await pastExpiry(invitation.id)
    await resendInvitation(as(owner), {
      workspaceId,
      invitationId: invitation.id,
    })
    const kinds = (await listEvents(as(owner), workspaceId))
      .filter((e) => e.subjects.some((x) => x.id === invitation.id))
      .map((e) => e.kind)
    // Newest first.
    expect(kinds.slice(0, 2)).toEqual([
      "invitation.resent",
      "invitation.expired",
    ])
  })

  it("is Shinan's own job", async () => {
    await expect(expireInvitations(as(owner))).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })
})
