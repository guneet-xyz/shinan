import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { and, eq, schema, sql } from "@shinan/db"

import {
  asAgent,
  asPerson,
  asShinan,
  newPerson,
  testDatabase,
} from "../../../test/helpers.js"
import type { AgentActor } from "../../actor.js"
import type { Context } from "../../context.js"
import { ForbiddenError, NotFoundError } from "../../errors.js"
import { addMember } from "../../identity/members.js"
import type { Person } from "../../identity/people.js"
import { createWorkspace } from "../../identity/workspaces.js"
import { decide, rules } from "../../permissions.js"
import { rateLimits } from "../../rate-limits.js"
import { authorizeGitRequest, summarizeCatalogFetches } from "./access.js"
import type { GitRequestInput } from "./access.js"

const { db, pool } = testDatabase()

afterAll(async () => {
  await pool.end()
})

let owner: Person
let contributor: Person
let workspaceId: string

beforeEach(async () => {
  owner = await newPerson(db, "owner")
  contributor = await newPerson(db, "contributor")
  workspaceId = (await createWorkspace(asPerson(db, owner), { name: "Team" }))
    .workspace.id
  await addMember(asPerson(db, owner), {
    workspaceId,
    personId: contributor.id,
    role: "contributor",
  })
})

const fetchInfo = (id = workspaceId): GitRequestInput => ({
  workspaceId: id,
  service: "git-upload-pack",
  advertisement: true,
  requestId: "req-1",
})
const pushPost = (id = workspaceId): GitRequestInput => ({
  workspaceId: id,
  service: "git-receive-pack",
  advertisement: false,
  requestId: "req-2",
})

const tokenOf = (ctx: Context) => (ctx.actor as AgentActor).tokenId

async function token(ctx: Context) {
  const [row] = await db
    .select()
    .from(schema.agentTokens)
    .where(eq(schema.agentTokens.id, tokenOf(ctx)))
  return row!
}

describe("catalog.fetch and catalog.push", () => {
  it("are agents' only: catalog:read to fetch, catalog:write to push", () => {
    for (const role of ["owner", "contributor"] as const) {
      expect(decide(rules["catalog.fetch"], { kind: "person", role })).toEqual({
        allowed: false,
        reason: "actor",
      })
      expect(decide(rules["catalog.push"], { kind: "person", role })).toEqual({
        allowed: false,
        reason: "actor",
      })
      const readOnly = {
        kind: "agent" as const,
        role,
        scopes: ["catalog:read", "tasks:read"] as const,
      }
      expect(decide(rules["catalog.fetch"], readOnly).allowed).toBe(true)
      expect(decide(rules["catalog.push"], readOnly)).toEqual({
        allowed: false,
        reason: "scope",
      })
      expect(
        decide(rules["catalog.push"], {
          kind: "agent",
          role,
          scopes: ["catalog:write"],
        }).allowed,
      ).toBe(true)
    }
  })
})

describe("authorizeGitRequest", () => {
  it("gives the context the Git container needs", async () => {
    const agent = await asAgent(db, contributor, workspaceId)
    const access = await authorizeGitRequest(agent, fetchInfo())
    if (!access.allowed) throw new Error("Refused")
    const [member] = await db
      .select({ id: schema.members.id })
      .from(schema.members)
      .where(
        and(
          eq(schema.members.workspaceId, workspaceId),
          eq(schema.members.personId, contributor.id),
        ),
      )
    const actor = agent.actor as AgentActor
    expect(access.context).toEqual({
      requestId: "req-1",
      workspaceId,
      agent: { id: actor.agentId, handle: actor.agentHandle },
      memberId: member!.id,
      person: { id: contributor.id, handle: contributor.handle },
      by: `${contributor.handle} via ${actor.agentHandle}`,
      mayPush: true,
      memberHandles: [contributor.handle, owner.handle].sort(),
      allowedValues: [],
    })
  })

  it("lets a read-only token fetch but not push, and records the refusal", async () => {
    const agent = await asAgent(db, contributor, workspaceId, [
      "catalog:read",
      "tasks:read",
    ])
    const access = await authorizeGitRequest(agent, fetchInfo())
    expect(access).toMatchObject({ allowed: true, context: { mayPush: false } })
    for (const input of [{ ...pushPost(), advertisement: true }, pushPost()]) {
      await expect(authorizeGitRequest(agent, input)).rejects.toEqual(
        new ForbiddenError("scope"),
      )
    }
    const refusals = await db
      .select()
      .from(schema.securityLog)
      .where(
        and(
          eq(schema.securityLog.action, "request.refused"),
          eq(schema.securityLog.workspaceId, workspaceId),
        ),
      )
    expect(refusals.map((r) => r.details)).toEqual([
      expect.objectContaining({ action: "catalog.push", reason: "scope" }),
      expect.objectContaining({ action: "catalog.push", reason: "scope" }),
    ])
  })

  it("answers another workspace, an unknown one and a member who left as not found", async () => {
    const other = (
      await createWorkspace(asPerson(db, owner), { name: "Other" })
    ).workspace.id
    const agent = await asAgent(db, contributor, workspaceId)
    for (const id of [other, "9b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d", "x"]) {
      await expect(
        authorizeGitRequest(agent, fetchInfo(id)),
      ).rejects.toBeInstanceOf(NotFoundError)
    }
    await db
      .update(schema.members)
      .set({ removedAt: sql`now()` })
      .where(
        and(
          eq(schema.members.workspaceId, workspaceId),
          eq(schema.members.personId, contributor.id),
        ),
      )
    await expect(
      authorizeGitRequest(agent, fetchInfo()),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it("refuses people and Shinan", async () => {
    await expect(
      authorizeGitRequest(asPerson(db, owner), fetchInfo()),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      authorizeGitRequest(asShinan(db), fetchInfo()),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it("counts each push against its agent's rate, and only the push's POST", async () => {
    const agent = await asAgent(db, contributor, workspaceId)
    const { max } = rateLimits["catalog-push"]
    for (let i = 0; i < max; i++) {
      expect(await authorizeGitRequest(agent, pushPost())).toMatchObject({
        allowed: true,
      })
    }
    const limited = await authorizeGitRequest(agent, pushPost())
    expect(limited.allowed).toBe(false)
    expect(!limited.allowed && limited.retryAfterSeconds).toBeGreaterThan(0)
    // Fetching, and the start of a push, still go through.
    expect(
      await authorizeGitRequest(agent, { ...pushPost(), advertisement: true }),
    ).toMatchObject({ allowed: true })
    expect(await authorizeGitRequest(agent, fetchInfo())).toMatchObject({
      allowed: true,
    })
    // Another agent of the same person has its own rate.
    const second = await asAgent(db, contributor, workspaceId)
    expect(await authorizeGitRequest(second, pushPost())).toMatchObject({
      allowed: true,
    })
  })
})

describe("summarizeCatalogFetches", () => {
  it("counts each fetch's first request and records them hourly per token", async () => {
    const agent = await asAgent(db, contributor, workspaceId)
    await authorizeGitRequest(agent, fetchInfo())
    // The fetch's POST and a push are not fetches.
    await authorizeGitRequest(agent, { ...fetchInfo(), advertisement: false })
    await authorizeGitRequest(agent, { ...pushPost(), advertisement: true })
    await authorizeGitRequest(agent, fetchInfo())
    const counted = await token(agent)
    expect(counted.fetchCount).toBe(2)
    expect(counted.lastFetchedAt).toBeInstanceOf(Date)
    expect(await summarizeCatalogFetches(asShinan(db))).toBeGreaterThanOrEqual(
      1,
    )
    await authorizeGitRequest(agent, fetchInfo())
    await summarizeCatalogFetches(asShinan(db))
    await summarizeCatalogFetches(asShinan(db))
    const entries = await db
      .select()
      .from(schema.securityLog)
      .where(
        and(
          eq(schema.securityLog.action, "catalog.fetched"),
          sql`${schema.securityLog.details}->>'tokenId' = ${tokenOf(agent)}`,
        ),
      )
      .orderBy(schema.securityLog.id)
    expect(
      entries.map((e) => [e.details.fetches, e.details.totalFetches]),
    ).toEqual([
      [2, 2],
      [1, 3],
    ])
    expect(entries[0]).toMatchObject({
      workspaceId,
      actorKind: "shinan",
      outcome: "succeeded",
      subjectPersonId: contributor.id,
      details: { agentId: (agent.actor as AgentActor).agentId },
    })
  })

  it("is Shinan's to run", async () => {
    await expect(
      summarizeCatalogFetches(asPerson(db, owner)),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})
