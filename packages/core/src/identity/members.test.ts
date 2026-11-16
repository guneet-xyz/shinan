import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

import { and, eq, schema, sql } from "@shinan/db"

import {
  asAgent,
  asPerson,
  asShinan,
  newPerson,
  testDatabase,
} from "../../test/helpers.js"
import {
  ForbiddenError,
  NotFoundError,
  ReauthenticationRequiredError,
  RuleViolationError,
} from "../errors.js"
import { listEvents } from "../events.js"
import { listSecurityLog } from "../security-log-read.js"
import {
  addMember,
  changeRole,
  leaveWorkspace,
  listMembers,
  removeMember,
} from "./members.js"
import type { Person } from "./people.js"
import { createWorkspace } from "./workspaces.js"

const { db, pool } = testDatabase()

afterAll(async () => {
  await pool.end()
})

let owner: Person
let contributor: Person
let workspaceId: string
let contributorMemberId: string

beforeEach(async () => {
  owner = await newPerson(db, "owner")
  contributor = await newPerson(db, "contributor")
  const created = await createWorkspace(asPerson(db, owner), { name: "Team" })
  workspaceId = created.workspace.id
  const member = await addMember(asPerson(db, owner), {
    workspaceId,
    personId: contributor.id,
    role: "contributor",
  })
  contributorMemberId = member.id
})

async function membersOf(workspace = workspaceId) {
  const members = await listMembers(asPerson(db, owner), workspace)
  return members.map((m) => ({ handle: m.handle, role: m.role }))
}

describe("createWorkspace", () => {
  it("makes the creator the first workspace owner", async () => {
    const person = await newPerson(db)
    const { workspace, member } = await createWorkspace(asPerson(db, person), {
      name: "  Mine  ",
    })

    expect(workspace.name).toBe("Mine")
    expect(member.role).toBe("owner")
    const [event] = await listEvents(asPerson(db, person), workspace.id)
    expect(event).toMatchObject({
      kind: "workspace.created",
      actorKind: "person",
      actorPersonId: person.id,
      actorLabel: person.handle,
      confidence: "recorded",
      origin: "shinan_action",
      subjects: [{ type: "member", id: member.id }],
    })
  })

  it("is for people only", async () => {
    await expect(
      createWorkspace(asShinan(db), { name: "Shinan's" }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      createWorkspace(asAgent(db, owner, workspaceId), { name: "Agent's" }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("refuses a blank name", async () => {
    await expect(
      createWorkspace(asPerson(db, owner), { name: " " }),
    ).rejects.toBeInstanceOf(RuleViolationError)
  })
})

describe("addMember", () => {
  it("adds a member and records who added them", async () => {
    expect(await membersOf()).toEqual([
      { handle: owner.handle, role: "owner" },
      { handle: contributor.handle, role: "contributor" },
    ])
    const [event] = await listEvents(asPerson(db, owner), workspaceId)
    expect(event).toMatchObject({
      kind: "member.added",
      summary: `${owner.handle} added ${contributor.handle} as contributor`,
      subjects: [{ type: "member", id: contributorMemberId }],
      data: { role: "contributor" },
    })
  })

  it("refuses someone who is already a member", async () => {
    await expect(
      addMember(asPerson(db, owner), {
        workspaceId,
        personId: contributor.id,
        role: "owner",
      }),
    ).rejects.toMatchObject({ rule: "already-member" })
  })

  it("answers not found for a person who does not exist", async () => {
    for (const personId of [crypto.randomUUID(), "not-an-id"]) {
      await expect(
        addMember(asPerson(db, owner), {
          workspaceId,
          personId,
          role: "contributor",
        }),
      ).rejects.toBeInstanceOf(NotFoundError)
    }
  })

  it("is not allowed for contributors", async () => {
    const someone = await newPerson(db)
    await expect(
      addMember(asPerson(db, contributor), {
        workspaceId,
        personId: someone.id,
        role: "contributor",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("needs re-authentication", async () => {
    const someone = await newPerson(db)
    await expect(
      addMember(asPerson(db, owner, { reauthenticated: false }), {
        workspaceId,
        personId: someone.id,
        role: "contributor",
      }),
    ).rejects.toBeInstanceOf(ReauthenticationRequiredError)
  })
})

describe("changeRole", () => {
  it("lets a workspace owner change a role", async () => {
    await changeRole(asPerson(db, owner), {
      workspaceId,
      memberId: contributorMemberId,
      role: "owner",
    })

    expect(await membersOf()).toContainEqual({
      handle: contributor.handle,
      role: "owner",
    })
    const [event] = await listEvents(asPerson(db, owner), workspaceId)
    expect(event).toMatchObject({
      kind: "member.role-changed",
      data: { from: "contributor", to: "owner" },
    })
  })

  it("takes effect on the next request", async () => {
    await changeRole(asPerson(db, owner), {
      workspaceId,
      memberId: contributorMemberId,
      role: "owner",
    })
    const someone = await newPerson(db)
    await addMember(asPerson(db, contributor), {
      workspaceId,
      personId: someone.id,
      role: "contributor",
    })
  })

  it("does nothing when the role is unchanged", async () => {
    const before = await listEvents(asPerson(db, owner), workspaceId)
    await changeRole(asPerson(db, owner), {
      workspaceId,
      memberId: contributorMemberId,
      role: "contributor",
    })
    expect(await listEvents(asPerson(db, owner), workspaceId)).toEqual(before)
  })

  it("keeps at least one workspace owner", async () => {
    const [ownerMember] = (
      await listMembers(asPerson(db, owner), workspaceId)
    ).filter((m) => m.role === "owner")
    await expect(
      changeRole(asPerson(db, owner), {
        workspaceId,
        memberId: ownerMember!.id,
        role: "contributor",
      }),
    ).rejects.toMatchObject({ rule: "last-owner" })
  })

  it("lets an owner lower their own role when another owner remains", async () => {
    await changeRole(asPerson(db, owner), {
      workspaceId,
      memberId: contributorMemberId,
      role: "owner",
    })
    const [ownerMember] = (
      await listMembers(asPerson(db, owner), workspaceId)
    ).filter((m) => m.personId === owner.id)
    await changeRole(asPerson(db, owner), {
      workspaceId,
      memberId: ownerMember!.id,
      role: "contributor",
    })
    expect(await membersOf()).toEqual([
      { handle: owner.handle, role: "contributor" },
      { handle: contributor.handle, role: "owner" },
    ])
  })

  it("never lets two owners leave the workspace without one", async () => {
    await changeRole(asPerson(db, owner), {
      workspaceId,
      memberId: contributorMemberId,
      role: "owner",
    })
    const members = await listMembers(asPerson(db, owner), workspaceId)
    const memberOf = (person: Person) =>
      members.find((m) => m.personId === person.id)!.id

    // Hold the workspace's lock from another connection, so both requests
    // are certain to overlap: each passes the permission check, then waits.
    const holder = await pool.connect()
    try {
      await holder.query("begin")
      await holder.query("select id from workspaces where id = $1 for update", [
        workspaceId,
      ])
      const { rows } = await holder.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      )
      const holderPid = rows[0]!.pid

      const attempts = Promise.allSettled([
        changeRole(asPerson(db, owner), {
          workspaceId,
          memberId: memberOf(contributor),
          role: "contributor",
        }),
        changeRole(asPerson(db, contributor), {
          workspaceId,
          memberId: memberOf(owner),
          role: "contributor",
        }),
      ])
      await vi.waitFor(
        async () => {
          // Asked on another connection: inside the holder's transaction,
          // pg_stat_activity would keep showing its first snapshot.
          const waiting = await db.execute<{ count: number }>(
            sql`with recursive blocked(pid) as (
                  select pid from pg_stat_activity
                  where ${holderPid}::int = any(pg_blocking_pids(pid))
                  union
                  select a.pid from pg_stat_activity a
                  join blocked b on b.pid = any(pg_blocking_pids(a.pid))
                )
                select count(*)::int as count from blocked`,
          )
          expect(waiting.rows[0]!.count).toBe(2)
        },
        { timeout: 3_000, interval: 20 },
      )
      await holder.query("commit")

      const results = await attempts
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
      const [refused] = results.filter((r) => r.status === "rejected")
      expect(refused?.reason).toMatchObject({ rule: "role-changed" })
    } finally {
      await holder.query("rollback").catch(() => {})
      holder.release()
    }

    const owners = (await listMembers(asPerson(db, owner), workspaceId)).filter(
      (m) => m.role === "owner",
    )
    expect(owners).toHaveLength(1)
  })

  it("is not allowed for contributors", async () => {
    await expect(
      changeRole(asPerson(db, contributor), {
        workspaceId,
        memberId: contributorMemberId,
        role: "owner",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("is reserved for people", async () => {
    await expect(
      changeRole(asAgent(db, owner, workspaceId), {
        workspaceId,
        memberId: contributorMemberId,
        role: "owner",
      }),
    ).rejects.toMatchObject({ reason: "people-only" })
  })
})

describe("removeMember", () => {
  it("removes a member, who loses access on the next request", async () => {
    await removeMember(asPerson(db, owner), {
      workspaceId,
      memberId: contributorMemberId,
    })

    expect(await membersOf()).toEqual([{ handle: owner.handle, role: "owner" }])
    await expect(
      listMembers(asPerson(db, contributor), workspaceId),
    ).rejects.toBeInstanceOf(NotFoundError)
    const [event] = await listEvents(asPerson(db, owner), workspaceId)
    expect(event).toMatchObject({
      kind: "member.removed",
      subjects: [{ type: "member", id: contributorMemberId }],
    })
  })

  it("keeps the membership record for history", async () => {
    await removeMember(asPerson(db, owner), {
      workspaceId,
      memberId: contributorMemberId,
    })
    const [row] = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, contributorMemberId))
    expect(row?.removedAt).toBeInstanceOf(Date)
  })

  it("lets a removed person be added again", async () => {
    await removeMember(asPerson(db, owner), {
      workspaceId,
      memberId: contributorMemberId,
    })
    const again = await addMember(asPerson(db, owner), {
      workspaceId,
      personId: contributor.id,
      role: "contributor",
    })
    expect(again.id).not.toBe(contributorMemberId)
  })

  it("does not remove the last workspace owner", async () => {
    const ownerMember = (
      await listMembers(asPerson(db, owner), workspaceId)
    ).find((m) => m.personId === owner.id)!
    await expect(
      removeMember(asPerson(db, owner), {
        workspaceId,
        memberId: ownerMember.id,
      }),
    ).rejects.toMatchObject({ rule: "last-owner" })
  })

  it("answers not found for an unknown or removed member", async () => {
    await removeMember(asPerson(db, owner), {
      workspaceId,
      memberId: contributorMemberId,
    })
    for (const memberId of [contributorMemberId, crypto.randomUUID(), "x"]) {
      await expect(
        removeMember(asPerson(db, owner), { workspaceId, memberId }),
      ).rejects.toBeInstanceOf(NotFoundError)
    }
  })
})

describe("leaveWorkspace", () => {
  it("lets a contributor leave", async () => {
    await leaveWorkspace(
      asPerson(db, contributor, { reauthenticated: false }),
      {
        workspaceId,
      },
    )
    expect(await membersOf()).toEqual([{ handle: owner.handle, role: "owner" }])
    const [event] = await listEvents(asPerson(db, owner), workspaceId)
    expect(event).toMatchObject({
      kind: "member.left",
      actorPersonId: contributor.id,
    })
  })

  it("does not let the last workspace owner leave", async () => {
    await expect(
      leaveWorkspace(asPerson(db, owner), { workspaceId }),
    ).rejects.toMatchObject({ rule: "last-owner" })
  })
})

describe("the security log", () => {
  it("records membership changes with the request's details", async () => {
    await changeRole(asPerson(db, owner), {
      workspaceId,
      memberId: contributorMemberId,
      role: "owner",
    })
    const [entry] = await listSecurityLog(asPerson(db, owner), workspaceId)
    expect(entry).toMatchObject({
      workspaceId,
      action: "member.role-changed",
      outcome: "succeeded",
      actorPersonId: owner.id,
      actorLabel: owner.handle,
      subjectPersonId: contributor.id,
      networkAddress: "192.0.2.10",
      client: "test",
      details: {
        memberId: contributorMemberId,
        from: "contributor",
        to: "owner",
      },
    })
  })

  it("records refusals in the workspace's log", async () => {
    await expect(
      removeMember(asPerson(db, contributor), {
        workspaceId,
        memberId: contributorMemberId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)

    const [entry] = await listSecurityLog(asPerson(db, owner), workspaceId)
    expect(entry).toMatchObject({
      action: "request.refused",
      outcome: "refused",
      actorPersonId: contributor.id,
      details: { action: "member.remove", reason: "role" },
    })
  })

  it("records agents attempting actions reserved for people", async () => {
    await expect(
      removeMember(asAgent(db, owner, workspaceId), {
        workspaceId,
        memberId: contributorMemberId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)

    const [entry] = await listSecurityLog(asPerson(db, owner), workspaceId)
    expect(entry).toMatchObject({
      action: "request.refused",
      actorKind: "agent",
      actorLabel: `${owner.handle} via opencode-daedalus`,
      details: { action: "member.remove", reason: "people-only" },
    })
  })

  it("shows contributors only their own entries", async () => {
    const someone = await newPerson(db)
    await addMember(asPerson(db, owner), {
      workspaceId,
      personId: someone.id,
      role: "contributor",
    })

    const entries = await listSecurityLog(
      asPerson(db, contributor),
      workspaceId,
    )
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect([entry.actorPersonId, entry.subjectPersonId]).toContain(
        contributor.id,
      )
    }
    const all = await listSecurityLog(asPerson(db, owner), workspaceId)
    expect(all.some((e) => e.subjectPersonId === someone.id)).toBe(true)
  })

  it("hides other people's network details from contributors", async () => {
    await expect(
      removeMember(asPerson(db, contributor), {
        workspaceId,
        memberId: contributorMemberId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)

    const entries = await listSecurityLog(
      asPerson(db, contributor),
      workspaceId,
    )
    const byOwner = entries.filter((e) => e.actorPersonId === owner.id)
    const own = entries.filter((e) => e.actorPersonId === contributor.id)
    expect(byOwner.length).toBeGreaterThan(0)
    expect(own.length).toBeGreaterThan(0)
    for (const entry of byOwner) {
      expect(entry).toMatchObject({ networkAddress: null, client: null })
    }
    for (const entry of own) {
      expect(entry).toMatchObject({
        networkAddress: "192.0.2.10",
        client: "test",
      })
    }

    const asOwner = await listSecurityLog(asPerson(db, owner), workspaceId)
    expect(
      asOwner.filter((e) => e.actorPersonId === owner.id).at(0),
    ).toMatchObject({ networkAddress: "192.0.2.10" })
  })

  it("drops invalid network addresses and IPv6 zone IDs", async () => {
    const ctx = asPerson(db, owner)
    ctx.request = { networkAddress: "not-an-address", client: "test" }
    await changeRole(ctx, {
      workspaceId,
      memberId: contributorMemberId,
      role: "owner",
    })
    const [entry] = await listSecurityLog(asPerson(db, owner), workspaceId)
    expect(entry).toMatchObject({
      action: "member.role-changed",
      networkAddress: null,
    })

    ctx.request = { networkAddress: "fe80::1%eth0" }
    await changeRole(ctx, {
      workspaceId,
      memberId: contributorMemberId,
      role: "contributor",
    })
    const [zoned] = await listSecurityLog(asPerson(db, owner), workspaceId)
    expect(zoned).toMatchObject({
      action: "member.role-changed",
      networkAddress: "fe80::1",
    })

    const stranger = await newPerson(db)
    await expect(
      listMembers(
        { ...asPerson(db, stranger), request: { networkAddress: "::zz" } },
        workspaceId,
      ),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it("is not readable by agents", async () => {
    await expect(
      listSecurityLog(asAgent(db, owner, workspaceId), workspaceId),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("records no change when the operation fails", async () => {
    await expect(
      leaveWorkspace(asPerson(db, owner), { workspaceId }),
    ).rejects.toBeInstanceOf(RuleViolationError)
    const rows = await db
      .select()
      .from(schema.securityLog)
      .where(
        and(
          eq(schema.securityLog.workspaceId, workspaceId),
          eq(schema.securityLog.action, "member.left"),
        ),
      )
    expect(rows).toEqual([])
  })
})

describe("agents", () => {
  it("read the workspace with a read scope", async () => {
    const members = await listMembers(
      asAgent(db, contributor, workspaceId, ["tasks:read"]),
      workspaceId,
    )
    expect(members).toHaveLength(2)
  })

  it("do not read without a read scope", async () => {
    await expect(
      listMembers(
        asAgent(db, contributor, workspaceId, ["presence"]),
        workspaceId,
      ),
    ).rejects.toMatchObject({ reason: "scope" })
  })

  it("lose access when their member is removed", async () => {
    await removeMember(asPerson(db, owner), {
      workspaceId,
      memberId: contributorMemberId,
    })
    await expect(
      listMembers(asAgent(db, contributor, workspaceId), workspaceId),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
