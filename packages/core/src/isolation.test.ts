import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { and, eq, isNull, schema } from "@shinan/db"

import { asAgent, asPerson, newPerson, testDatabase } from "../test/helpers.js"
import type { AgentActor } from "./actor.js"
import { NotFoundError } from "./errors.js"
import { listEvents } from "./events.js"
import {
  addMember,
  changeRole,
  listMembers,
  removeMember,
} from "./identity/members.js"
import type { MemberSummary } from "./identity/members.js"
import type { Person } from "./identity/people.js"
import { createWorkspace } from "./identity/workspaces.js"
import { listSecurityLog } from "./security-log-read.js"

// Nothing crosses between workspaces (architecture §3.4, identity §4).
const { db, pool } = testDatabase()

afterAll(async () => {
  await pool.end()
})

let alice: Person
let bob: Person
let both: Person
let one: string
let two: string
let twoMembers: MemberSummary[]

beforeAll(async () => {
  alice = await newPerson(db, "alice")
  bob = await newPerson(db, "bob")
  both = await newPerson(db, "both")
  one = (await createWorkspace(asPerson(db, alice), { name: "One" })).workspace
    .id
  two = (await createWorkspace(asPerson(db, bob), { name: "Two" })).workspace.id
  await addMember(asPerson(db, alice), {
    workspaceId: one,
    personId: both.id,
    role: "owner",
  })
  await addMember(asPerson(db, bob), {
    workspaceId: two,
    personId: both.id,
    role: "contributor",
  })
  twoMembers = await listMembers(asPerson(db, bob), two)
})

const missing = crypto.randomUUID()

describe("a member of one workspace", () => {
  it("cannot read another's members, timeline or security log", async () => {
    const ctx = asPerson(db, alice)
    await expect(listMembers(ctx, two)).rejects.toBeInstanceOf(NotFoundError)
    await expect(listEvents(ctx, two)).rejects.toBeInstanceOf(NotFoundError)
    await expect(listSecurityLog(ctx, two)).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it("gets the same answer as for a workspace that does not exist", async () => {
    const ctx = asPerson(db, alice)
    for (const workspaceId of [missing, "not-an-id"]) {
      await expect(listMembers(ctx, workspaceId)).rejects.toBeInstanceOf(
        NotFoundError,
      )
    }
  })

  it("cannot change another workspace's members", async () => {
    const ctx = asPerson(db, alice)
    const target = twoMembers.find((m) => m.personId === bob.id)!
    await expect(
      changeRole(ctx, {
        workspaceId: two,
        memberId: target.id,
        role: "contributor",
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      addMember(ctx, { workspaceId: two, personId: alice.id, role: "owner" }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it("cannot reach another workspace's member through their own workspace", async () => {
    const target = twoMembers.find((m) => m.personId === bob.id)!
    await expect(
      removeMember(asPerson(db, alice), {
        workspaceId: one,
        memberId: target.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(await listMembers(asPerson(db, bob), two)).toEqual(twoMembers)
  })

  it("leaves a refusal only in the installation-level log", async () => {
    await expect(listMembers(asPerson(db, alice), two)).rejects.toBeInstanceOf(
      NotFoundError,
    )

    const entries = await listSecurityLog(asPerson(db, bob), two)
    expect(entries.some((e) => e.actorPersonId === alice.id)).toBe(false)
    const installationLevel = await db
      .select()
      .from(schema.securityLog)
      .where(
        and(
          isNull(schema.securityLog.workspaceId),
          eq(schema.securityLog.actorPersonId, alice.id),
          eq(schema.securityLog.action, "request.refused"),
        ),
      )
    expect(installationLevel.at(-1)?.details).toEqual({
      action: "workspace.read",
      reason: "not-member",
      workspaceId: two,
    })
  })
})

describe("a person in two workspaces", () => {
  it("has a separate role in each", async () => {
    const roleIn = async (workspaceId: string) =>
      (await listMembers(asPerson(db, both), workspaceId)).find(
        (m) => m.personId === both.id,
      )?.role
    expect(await roleIn(one)).toBe("owner")
    expect(await roleIn(two)).toBe("contributor")
  })

  it("sees only each workspace's own events", async () => {
    const ctx = asPerson(db, both)
    const oneEvents = await listEvents(ctx, one)
    const twoEvents = await listEvents(ctx, two)
    expect(oneEvents.every((e) => e.workspaceId === one)).toBe(true)
    expect(twoEvents.every((e) => e.workspaceId === two)).toBe(true)
    expect(oneEvents.map((e) => e.summary)).toContain(
      `${alice.handle} created the workspace One`,
    )
    expect(twoEvents.map((e) => e.summary)).not.toContain(
      `${alice.handle} created the workspace One`,
    )
  })

  it("has agents that work only in their own workspace", async () => {
    const agentOfOne = asAgent(db, both, one)
    expect(await listMembers(agentOfOne, one)).toHaveLength(2)
    await expect(listMembers(agentOfOne, two)).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it("has agents whose attempts elsewhere are recorded at installation level", async () => {
    const agentOfOne = asAgent(db, both, one)
    const { agentId } = agentOfOne.actor as AgentActor
    await expect(listMembers(agentOfOne, two)).rejects.toBeInstanceOf(
      NotFoundError,
    )

    const entries = await db
      .select()
      .from(schema.securityLog)
      .where(
        and(
          eq(schema.securityLog.actorAgentId, agentId),
          eq(schema.securityLog.action, "request.refused"),
        ),
      )
    expect(entries).toEqual([
      expect.objectContaining({
        workspaceId: null,
        actorKind: "agent",
        actorPersonId: both.id,
        actorLabel: `${both.handle} via opencode-daedalus`,
        details: {
          action: "workspace.read",
          reason: "not-member",
          workspaceId: two,
          agentWorkspaceId: one,
        },
      }),
    ])
    const twoLog = await listSecurityLog(asPerson(db, bob), two)
    expect(twoLog.some((e) => e.actorAgentId === agentId)).toBe(false)
  })

  it("is found whatever the case of the workspace ID", async () => {
    expect(
      await listMembers(asPerson(db, both), two.toUpperCase()),
    ).toHaveLength(2)
    expect(
      await listMembers(asAgent(db, both, one.toUpperCase()), one),
    ).toHaveLength(2)
  })

  it("is not an owner in the workspace where they contribute", async () => {
    const target = twoMembers.find((m) => m.personId === bob.id)!
    await expect(
      removeMember(asPerson(db, both), {
        workspaceId: two,
        memberId: target.id,
      }),
    ).rejects.toMatchObject({ reason: "role" })
  })
})
