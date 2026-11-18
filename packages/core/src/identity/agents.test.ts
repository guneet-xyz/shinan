import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { and, eq, schema, sql } from "@shinan/db"

import {
  asPerson,
  asShinan,
  newPerson,
  testDatabase,
} from "../../test/helpers.js"
import type { AgentActor } from "../actor.js"
import { shinan } from "../actor.js"
import type { Context } from "../context.js"
import {
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  ReauthenticationRequiredError,
  RuleViolationError,
} from "../errors.js"
import type { JobQueue } from "../jobs.js"
import { rateLimits } from "../rate-limits.js"
import { agentTokenPrefix } from "../tokens.js"
import {
  authenticateAgent,
  createAgentToken,
  disableAgent,
  enableAgent,
  getConnectedAgent,
  issueAgentToken,
  listAgents,
  listYourAgents,
  renameAgent,
  revokeAgentToken,
  summarizeAgentTokenUse,
} from "./agents.js"
import { addToAllowlist, removeFromAllowlist } from "./allowlist.js"
import {
  addMember,
  leaveWorkspace,
  listMembers,
  removeMember,
} from "./members.js"
import type { Person } from "./people.js"
import { endAllSignInSessions } from "./sign-in.js"
import { createWorkspace } from "./workspaces.js"

const { db, pool } = testDatabase()

afterAll(async () => {
  await pool.end()
})

// Emails stay queued in email_deliveries; no worker sends them here.
const jobs: JobQueue = { send: () => Promise.resolve(null) }
const installationUrl = "http://shinan.test"

let owner: Person
let contributor: Person
let workspaceId: string
let contributorMemberId: string

/** A person in the web app, signed in again recently unless said. */
function as(person: Person, options: { reauthenticated?: boolean } = {}) {
  return { ...asPerson(db, person, options), jobs, installationUrl }
}

let addressCounter = 0

/** A network address no other test in this run uses. */
function freshAddress(): string {
  addressCounter++
  return `203.0.113.${addressCounter}`
}

/** Shinan checking a token on a request from `networkAddress`. */
function request(networkAddress = freshAddress()): Context {
  return {
    db,
    actor: shinan,
    request: { networkAddress, client: "opencode/1.0" },
    installationUrl,
  }
}

async function agentFor(token: string, from?: string): Promise<Context> {
  const result = await authenticateAgent(request(from), { token })
  if (!result.authenticated) throw new Error("The token was refused")
  return { db, actor: result.actor, origin: "mcp_call" }
}

async function works(token: string): Promise<boolean> {
  return (await authenticateAgent(request(), { token })).authenticated
}

async function makeToken(
  person: Person,
  input: Partial<Parameters<typeof createAgentToken>[1]> = {},
) {
  return createAgentToken(as(person), {
    workspaceId,
    codingTool: "opencode",
    machine: "daedalus",
    access: "full",
    ...input,
  })
}

async function logEntries(action: string, agentId: string) {
  return db
    .select()
    .from(schema.securityLog)
    .where(
      and(
        eq(schema.securityLog.action, action),
        sql`${schema.securityLog.details}->>'agentId' = ${agentId}`,
      ),
    )
    .orderBy(schema.securityLog.id)
}

beforeEach(async () => {
  owner = await newPerson(db, "owner")
  contributor = await newPerson(db, "contributor")
  // Tokens work only for people on the allowlist (identity §3.2).
  await db
    .insert(schema.emailAllowlist)
    .values([{ email: owner.email }, { email: contributor.email }])
  const created = await createWorkspace(asPerson(db, owner), { name: "Team" })
  workspaceId = created.workspace.id
  const member = await addMember(asPerson(db, owner), {
    workspaceId,
    personId: contributor.id,
    role: "contributor",
  })
  contributorMemberId = member.id
})

describe("createAgentToken", () => {
  it("registers the agent and shows a prefixed token once", async () => {
    const issued = await makeToken(contributor, {
      codingTool: "OpenCode",
      machine: "MacBook Air",
      name: "OpenCode on the MacBook",
    })
    expect(issued.token).toMatch(/^shinan_agent_[A-Za-z0-9]{43}$/)
    expect(issued.agentCreated).toBe(true)
    expect(issued.replacedToken).toBe(false)
    expect(issued.agent).toMatchObject({
      workspaceId,
      memberId: contributorMemberId,
      personHandle: contributor.handle,
      codingTool: "opencode",
      machine: "macbook-air",
      handle: "opencode-macbook-air",
      name: "OpenCode on the MacBook",
      enabled: true,
      token: {
        access: "full",
        scopes: [
          "catalog:read",
          "catalog:propose",
          "tasks:read",
          "tasks:write",
          "presence",
        ],
        lastUsedAt: null,
        requestCount: 0,
        unused: false,
      },
    })
  })

  it("never stores or records the token itself", async () => {
    const { token, agent } = await makeToken(contributor)
    await agentFor(token)
    await revokeAgentToken(as(contributor), { workspaceId, agentId: agent.id })
    for (const table of [
      "agent_tokens",
      "agents",
      "security_log",
      "events",
      "email_deliveries",
    ]) {
      const result = await db.execute<{ found: boolean }>(
        sql`select exists (select 1 from ${sql.identifier(table)} t where t::text like ${`%${token.slice(agentTokenPrefix.length)}%`}) as found`,
      )
      expect(result.rows[0]!.found, table).toBe(false)
    }
    // The database refuses anything but a hash.
    await expect(
      db.insert(schema.agentTokens).values({
        workspaceId,
        agentId: agent.id,
        tokenHash: token,
        scopes: ["catalog:read"],
        installationUrl,
      }),
    ).rejects.toThrow()
  })

  it("emails the person and records the token in the security log", async () => {
    const { agent } = await makeToken(contributor)
    const [email] = await db
      .select()
      .from(schema.emailDeliveries)
      .where(eq(schema.emailDeliveries.recipient, contributor.email))
    expect(email).toMatchObject({ kind: "security_alert", status: "queued" })
    expect(email!.message!.subject).toBe(
      "Agent token approved for opencode-daedalus",
    )
    expect(email!.message!.text).toContain(`${installationUrl}/account/agents`)

    const [created] = await logEntries("agent.created", agent.id)
    expect(created).toMatchObject({
      workspaceId,
      actorPersonId: contributor.id,
      subjectPersonId: contributor.id,
    })
    const [issued] = await logEntries("agent-token.issued", agent.id)
    expect(issued).toMatchObject({
      workspaceId,
      outcome: "succeeded",
      networkAddress: "192.0.2.10",
      details: {
        handle: "opencode-daedalus",
        tokenId: agent.token!.id,
        access: "full",
        method: "by-hand",
        replacedTokenId: null,
      },
    })
  })

  it("needs a recent sign-in", async () => {
    await expect(
      createAgentToken(as(contributor, { reauthenticated: false }), {
        workspaceId,
        codingTool: "opencode",
        machine: "daedalus",
        access: "full",
      }),
    ).rejects.toBeInstanceOf(ReauthenticationRequiredError)
  })

  it("is for people only: an agent cannot make agents or tokens", async () => {
    const { token, agent } = await makeToken(contributor)
    const agentCtx = { ...(await agentFor(token)), jobs, installationUrl }
    await expect(
      createAgentToken(agentCtx, {
        workspaceId,
        codingTool: "opencode",
        machine: "elsewhere",
        access: "full",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      issueAgentToken(agentCtx, {
        workspaceId,
        agentId: agent.id,
        access: "full",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(listAgents(agentCtx, workspaceId)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it("refuses coding tools and machines that cannot be part of a handle", async () => {
    for (const machine of ["", "  ", "dae/dalus", "ünïcode", "x".repeat(33)]) {
      await expect(
        makeToken(contributor, { machine }),
        machine,
      ).rejects.toBeInstanceOf(InvalidInputError)
    }
    await expect(
      makeToken(contributor, { access: "admin" as "full" }),
    ).rejects.toMatchObject({ rule: "token-access" })
    await expect(
      makeToken(contributor, { machineEntityId: "service/dockyard" }),
    ).rejects.toMatchObject({ rule: "machine-entity" })
    const { agent } = await makeToken(contributor, {
      machineEntityId: "machine/daedalus",
    })
    expect(agent.machineEntityId).toBe("machine/daedalus")
  })

  it("issues a new token for the same tool and machine, revoking the old one", async () => {
    const first = await makeToken(contributor)
    const second = await makeToken(contributor, { access: "read-only" })
    expect(second.agentCreated).toBe(false)
    expect(second.replacedToken).toBe(true)
    expect(second.agent.id).toBe(first.agent.id)
    expect(second.agent.token!.access).toBe("read-only")
    expect(await works(first.token)).toBe(false)
    expect(await works(second.token)).toBe(true)
    const [revoked] = await logEntries("agent-token.revoked", first.agent.id)
    expect(revoked!.details).toMatchObject({
      tokenId: first.agent.token!.id,
      reason: "replaced",
    })
  })

  it("refuses another tool and machine that make the same handle", async () => {
    const first = await makeToken(contributor, {
      codingTool: "gemini-cli",
      machine: "daedalus",
    })
    await expect(
      makeToken(contributor, {
        codingTool: "gemini",
        machine: "cli-daedalus",
        access: "read-only",
      }),
    ).rejects.toMatchObject({ rule: "handle-taken" })
    // The existing agent keeps its full token.
    expect(await works(first.token)).toBe(true)
    const [agent] = await listAgents(as(contributor), workspaceId)
    expect(agent).toMatchObject({
      codingTool: "gemini-cli",
      machine: "daedalus",
      token: { id: first.agent.token!.id, access: "full" },
    })
  })

  it("keeps agents of different members apart, even with the same handle", async () => {
    const ours = await makeToken(contributor)
    const theirs = await makeToken(owner)
    expect(theirs.agent.id).not.toBe(ours.agent.id)
    expect(await works(ours.token)).toBe(true)
  })
})

describe("authenticateAgent", () => {
  it("builds the agent actor from the token and records its use", async () => {
    const { token, agent } = await makeToken(contributor, {
      access: "read-only",
    })
    const address = freshAddress()
    const ctx = await agentFor(token, address)
    expect(ctx.actor).toEqual({
      kind: "agent",
      agentId: agent.id,
      tokenId: agent.token!.id,
      agentHandle: "opencode-daedalus",
      personId: contributor.id,
      workspaceId,
      scopes: ["catalog:read", "tasks:read"],
    })
    // A read-only token reads the whole workspace.
    expect(await listMembers(ctx, workspaceId)).toHaveLength(2)
    await agentFor(token, address)

    const [listed] = await listAgents(as(contributor), workspaceId)
    expect(listed!.token).toMatchObject({
      requestCount: 2,
      lastNetworkAddress: address,
    })
    expect(listed!.token!.firstUsedAt).not.toBeNull()
    const firstUse = await logEntries("agent-token.first-used", agent.id)
    expect(firstUse).toHaveLength(1)
    expect(firstUse[0]).toMatchObject({
      actorKind: "agent",
      actorAgentId: agent.id,
      actorLabel: `${contributor.handle} via opencode-daedalus`,
      networkAddress: address,
      client: "opencode/1.0",
    })
  })

  it("answers the same for every bad token, and records why", async () => {
    const { token, agent } = await makeToken(contributor)
    await revokeAgentToken(as(contributor), { workspaceId, agentId: agent.id })
    const address = freshAddress()
    for (const bad of [
      token,
      `${agentTokenPrefix}${"A".repeat(43)}`,
      // The old URL-safe alphabet, or one character too many.
      `${agentTokenPrefix}${"-".repeat(43)}`,
      `${agentTokenPrefix}${"A".repeat(44)}`,
      "not-a-token",
      "",
    ]) {
      expect(await authenticateAgent(request(address), { token: bad })).toEqual(
        { authenticated: false },
      )
    }
    const failures = await db
      .select()
      .from(schema.securityLog)
      .where(
        and(
          eq(schema.securityLog.action, "agent-token.failed"),
          sql`${schema.securityLog.networkAddress} = ${address}::inet`,
        ),
      )
      .orderBy(schema.securityLog.id)
    expect(failures.map((f) => [f.workspaceId, f.details.reason])).toEqual([
      [workspaceId, "revoked"],
      [null, "unknown"],
      [null, "malformed"],
      [null, "malformed"],
      [null, "malformed"],
      [null, "malformed"],
    ])
    expect(failures[0]).toMatchObject({
      subjectPersonId: contributor.id,
      details: { agentId: agent.id, tokenId: agent.token!.id },
    })
  })

  it("throttles failed attempts per network address", async () => {
    const { token } = await makeToken(contributor)
    const address = freshAddress()
    const { max } = rateLimits["agent-token-failure"]
    for (let n = 0; n < max; n++) {
      await authenticateAgent(request(address), { token: "wrong" })
    }
    const throttled = await authenticateAgent(request(address), {
      token: "wrong",
    })
    expect(throttled).toMatchObject({ authenticated: false })
    expect(throttled).toHaveProperty("retryAfterSeconds")
    // A working token from the same address is never held up by others'
    // failures: anyone sharing the address could otherwise lock it out.
    const good = await authenticateAgent(request(address), { token })
    expect(good).toMatchObject({ authenticated: true })
    // Failing tokens from it still wait, and are no longer recorded.
    const again = await authenticateAgent(request(address), { token: "x" })
    expect(again).toHaveProperty("retryAfterSeconds")
    const recorded = await db
      .select()
      .from(schema.securityLog)
      .where(sql`${schema.securityLog.networkAddress} = ${address}::inet`)
    expect(
      recorded.filter((e) => e.action === "agent-token.failed"),
    ).toHaveLength(max)
    expect(
      recorded.filter((e) => e.action === "request.throttled"),
    ).toHaveLength(1)
  })

  it("limits the requests of one token from any address", async () => {
    const { token, agent } = await makeToken(contributor)
    await db.insert(schema.rateLimits).values({
      key: `agent-token:${agent.token!.id}`,
      windowStart: sql`now()`,
      count: rateLimits["agent-token"].max,
    })
    const limited = await authenticateAgent(request(), { token })
    expect(limited).toMatchObject({ authenticated: false })
    expect(limited).toHaveProperty("retryAfterSeconds")
    // A refused request is not a use.
    const [listed] = await listAgents(as(contributor), workspaceId)
    expect(listed!.token).toMatchObject({ requestCount: 0, lastUsedAt: null })
  })

  it("refuses tokens of a person no longer on the allowlist", async () => {
    // Removed behind Shinan's back, as by an older release after a
    // rollback: the token itself was never revoked.
    const { token, agent } = await makeToken(contributor)
    await db
      .delete(schema.emailAllowlist)
      .where(eq(schema.emailAllowlist.email, contributor.email))
    expect(await works(token)).toBe(false)
    const [failed] = await logEntries("agent-token.failed", agent.id)
    expect(failed!.details).toMatchObject({ reason: "not-allowlisted" })
  })

  it("refuses every token when the installation's address is not known", async () => {
    const { token } = await makeToken(contributor)
    const unknown = { ...request(), installationUrl: undefined }
    expect(await authenticateAgent(unknown, { token })).toEqual({
      authenticated: false,
    })
  })

  it("refuses a token another installation issued", async () => {
    const { token } = await makeToken(contributor)
    const elsewhere = {
      ...request(),
      installationUrl: "https://other.example",
    }
    expect(await authenticateAgent(elsewhere, { token })).toEqual({
      authenticated: false,
    })
  })
})

describe("revocation", () => {
  it("stops a revoked token on its next request", async () => {
    const { token, agent } = await makeToken(contributor)
    const ctx = await agentFor(token)
    await revokeAgentToken(as(contributor), { workspaceId, agentId: agent.id })
    expect(await works(token)).toBe(false)
    // Core checks again on every operation, not only when authenticating.
    await expect(listMembers(ctx, workspaceId)).rejects.toBeInstanceOf(
      NotFoundError,
    )
    const [revoked] = await logEntries("agent-token.revoked", agent.id)
    expect(revoked!.details).toMatchObject({ reason: "revoked", requests: 1 })
    await expect(
      revokeAgentToken(as(contributor), { workspaceId, agentId: agent.id }),
    ).rejects.toMatchObject({ rule: "no-token" })
  })

  it("stops a disabled agent and issues it no token until enabled", async () => {
    const { token, agent } = await makeToken(contributor)
    const ctx = await agentFor(token)
    const disabled = await disableAgent(as(contributor), {
      workspaceId,
      agentId: agent.id,
    })
    expect(disabled).toMatchObject({ enabled: false, token: null })
    expect(await works(token)).toBe(false)
    await expect(listMembers(ctx, workspaceId)).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(
      issueAgentToken(as(contributor), {
        workspaceId,
        agentId: agent.id,
        access: "full",
      }),
    ).rejects.toMatchObject({ rule: "agent-disabled" })
    await expect(makeToken(contributor)).rejects.toBeInstanceOf(
      RuleViolationError,
    )

    const enabled = await enableAgent(as(contributor), {
      workspaceId,
      agentId: agent.id,
    })
    expect(enabled).toMatchObject({ enabled: true, token: null })
    expect(await works(token)).toBe(false)
    const fresh = await issueAgentToken(as(contributor), {
      workspaceId,
      agentId: agent.id,
      access: "full",
    })
    expect(await works(fresh.token)).toBe(true)
    const [entry] = await logEntries("agent.disabled", agent.id)
    expect(entry!.details).toMatchObject({ reason: "agent-disabled" })
  })

  it("lets a workspace owner disable any agent and revoke any token", async () => {
    const one = await makeToken(contributor)
    const two = await makeToken(contributor, { machine: "musashi" })
    await revokeAgentToken(as(owner), { workspaceId, agentId: one.agent.id })
    await disableAgent(as(owner), { workspaceId, agentId: two.agent.id })
    expect(await works(one.token)).toBe(false)
    expect(await works(two.token)).toBe(false)
    // Renaming and enabling stay with the agent's own member.
    await expect(
      renameAgent(as(owner), {
        workspaceId,
        agentId: one.agent.id,
        name: "Mine",
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      enableAgent(as(owner), { workspaceId, agentId: two.agent.id }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it("keeps contributors to their own agents", async () => {
    const { agent } = await makeToken(owner)
    for (const change of [
      () => disableAgent(as(contributor), { workspaceId, agentId: agent.id }),
      () =>
        revokeAgentToken(as(contributor), { workspaceId, agentId: agent.id }),
      () =>
        renameAgent(as(contributor), {
          workspaceId,
          agentId: agent.id,
          name: "Mine",
        }),
      () =>
        issueAgentToken(as(contributor), {
          workspaceId,
          agentId: agent.id,
          access: "full",
        }),
    ]) {
      await expect(change()).rejects.toBeInstanceOf(NotFoundError)
    }
  })

  it("disables a removed member's agents", async () => {
    const { token, agent } = await makeToken(contributor)
    const ctx = await agentFor(token)
    await removeMember(as(owner), {
      workspaceId,
      memberId: contributorMemberId,
    })
    expect(await works(token)).toBe(false)
    await expect(listMembers(ctx, workspaceId)).rejects.toBeInstanceOf(
      NotFoundError,
    )
    const [disabled] = await logEntries("agent.disabled", agent.id)
    expect(disabled).toMatchObject({
      actorPersonId: owner.id,
      details: { reason: "member-removed" },
    })
    const [revoked] = await logEntries("agent-token.revoked", agent.id)
    expect(revoked!.details).toMatchObject({ reason: "member-removed" })
  })

  it("disables the agents of a member who leaves, even if they rejoin", async () => {
    const { token, agent } = await makeToken(contributor)
    const ctx = await agentFor(token)
    await leaveWorkspace(as(contributor), { workspaceId })
    expect(await works(token)).toBe(false)
    const [revoked] = await logEntries("agent-token.revoked", agent.id)
    expect(revoked!.details).toMatchObject({ reason: "member-left" })

    // Back as a new membership: the old agent does not come back with them,
    // even if its token were somehow live.
    await addMember(asPerson(db, owner), {
      workspaceId,
      personId: contributor.id,
      role: "contributor",
    })
    await db
      .update(schema.agents)
      .set({ enabled: true, disabledAt: null })
      .where(eq(schema.agents.id, agent.id))
    await db
      .update(schema.agentTokens)
      .set({ revokedAt: null, revokedReason: null })
      .where(eq(schema.agentTokens.agentId, agent.id))
    expect(await works(token)).toBe(false)
    await expect(listMembers(ctx, workspaceId)).rejects.toBeInstanceOf(
      NotFoundError,
    )
    // They can register the same tool and machine again.
    const again = await makeToken(contributor)
    expect(again.agent.id).not.toBe(agent.id)
    expect(await works(again.token)).toBe(true)
  })

  it("revokes every token of a person removed from the allowlist", async () => {
    const { token, agent } = await makeToken(contributor)
    const other = await createWorkspace(asPerson(db, contributor), {
      name: "Elsewhere",
    })
    const elsewhere = await createAgentToken(as(contributor), {
      workspaceId: other.workspace.id,
      codingTool: "opencode",
      machine: "daedalus",
      access: "full",
    })
    const operator = await newPerson(db, "operator")
    await db
      .insert(schema.installationOperators)
      .values({ email: operator.email })
    await addToAllowlist(as(operator), { email: contributor.email })
    await removeFromAllowlist(as(operator), { email: contributor.email })
    expect(await works(token)).toBe(false)
    expect(await works(elsewhere.token)).toBe(false)
    const [revoked] = await logEntries("agent-token.revoked", agent.id)
    expect(revoked).toMatchObject({
      workspaceId,
      actorPersonId: operator.id,
      details: { reason: "allowlist-removed" },
    })
    // The agents stay enabled: their member can issue new tokens once
    // allowed back.
    const [listed] = await listAgents(as(contributor), workspaceId)
    expect(listed).toMatchObject({ enabled: true, token: null })
  })

  it("revokes the person's tokens on sign out everywhere, if they choose", async () => {
    const { token } = await makeToken(contributor)
    await endAllSignInSessions(as(contributor))
    expect(await works(token)).toBe(true)
    await endAllSignInSessions(as(contributor), { revokeAgentTokens: true })
    expect(await works(token)).toBe(false)
    const [entry] = await db
      .select()
      .from(schema.securityLog)
      .where(
        and(
          eq(schema.securityLog.action, "sign-in.signed-out-everywhere"),
          eq(schema.securityLog.actorPersonId, contributor.id),
          sql`${schema.securityLog.details}->>'agentTokensRevoked' = '1'`,
        ),
      )
    expect(entry).toBeDefined()
  })
})

describe("reading and renaming agents", () => {
  it("shows owners every agent and contributors their own", async () => {
    await makeToken(owner)
    await makeToken(contributor)
    expect(
      (await listAgents(as(owner), workspaceId)).map((a) => a.personHandle),
    ).toEqual([contributor.handle, owner.handle].sort())
    expect(
      (await listAgents(as(contributor), workspaceId)).map(
        (a) => a.personHandle,
      ),
    ).toEqual([contributor.handle])
  })

  it("lists the person's own agents in every workspace", async () => {
    await makeToken(contributor)
    const other = await createWorkspace(asPerson(db, contributor), {
      name: "Another",
    })
    await createAgentToken(as(contributor), {
      workspaceId: other.workspace.id,
      codingTool: "claude-code",
      machine: "musashi",
      access: "read-only",
    })
    const agents = await listYourAgents(as(contributor))
    expect(agents.map((a) => [a.workspaceName, a.handle])).toEqual([
      ["Another", "claude-code-musashi"],
      ["Team", "opencode-daedalus"],
    ])
    expect(await listYourAgents(as(owner))).toEqual([])
  })

  it("marks tokens unused for 30 days", async () => {
    const { agent, token } = await makeToken(contributor)
    await db
      .update(schema.agentTokens)
      .set({ createdAt: sql`now() - interval '31 days'` })
      .where(eq(schema.agentTokens.agentId, agent.id))
    const [stale] = await listAgents(as(contributor), workspaceId)
    expect(stale!.token!.unused).toBe(true)
    await agentFor(token)
    const [used] = await listAgents(as(contributor), workspaceId)
    expect(used!.token!.unused).toBe(false)
  })

  it("renames an agent without changing its handle", async () => {
    const { agent } = await makeToken(contributor)
    const renamed = await renameAgent(as(contributor), {
      workspaceId,
      agentId: agent.id,
      name: "  OpenCode on Daedalus  ",
    })
    expect(renamed).toMatchObject({
      name: "OpenCode on Daedalus",
      handle: "opencode-daedalus",
    })
    const [entry] = await logEntries("agent.renamed", agent.id)
    expect(entry!.details).toMatchObject({
      from: "opencode-daedalus",
      to: "OpenCode on Daedalus",
    })
    await expect(
      renameAgent(as(contributor), {
        workspaceId,
        agentId: agent.id,
        name: " ",
      }),
    ).rejects.toBeInstanceOf(InvalidInputError)
  })

  it("shows each member's agents in the Members list", async () => {
    const { agent } = await makeToken(contributor)
    const members = await listMembers(as(owner), workspaceId)
    expect(members.find((m) => m.id === contributorMemberId)!.agents).toEqual([
      {
        id: agent.id,
        handle: "opencode-daedalus",
        name: "opencode-daedalus",
        enabled: true,
      },
    ])
  })

  it("tells an agent who it is", async () => {
    const { token, agent } = await makeToken(contributor, {
      access: "read-only",
    })
    expect(await getConnectedAgent(await agentFor(token))).toEqual({
      agent: {
        id: agent.id,
        handle: "opencode-daedalus",
        name: "opencode-daedalus",
        codingTool: "opencode",
        machine: "daedalus",
      },
      person: { handle: contributor.handle, name: contributor.name },
      workspace: { id: workspaceId, name: "Team" },
      role: "contributor",
      access: "read-only",
      scopes: ["catalog:read", "tasks:read"],
    })
    await expect(getConnectedAgent(as(contributor))).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })
})

describe("summarizeAgentTokenUse", () => {
  it("records each token's use since the last summary", async () => {
    const { token, agent } = await makeToken(contributor)
    await agentFor(token)
    await agentFor(token)
    expect(await summarizeAgentTokenUse(asShinan(db))).toBeGreaterThanOrEqual(1)
    await agentFor(token)
    await summarizeAgentTokenUse(asShinan(db))
    await summarizeAgentTokenUse(asShinan(db))
    await agentFor(token)
    await agentFor(token)
    await revokeAgentToken(as(contributor), { workspaceId, agentId: agent.id })
    await summarizeAgentTokenUse(asShinan(db))
    // The two uses after the last summary are in the revocation entry, and
    // in no later summary.
    const [revoked] = await logEntries("agent-token.revoked", agent.id)
    expect(revoked!.details).toMatchObject({ requests: 2, totalRequests: 5 })
    const summaries = await logEntries("agent-token.used", agent.id)
    expect(
      summaries.map((s) => [s.details.requests, s.details.totalRequests]),
    ).toEqual([
      [2, 2],
      [1, 3],
    ])
    expect(summaries[0]).toMatchObject({
      workspaceId,
      actorKind: "shinan",
      subjectPersonId: contributor.id,
      details: { tokenId: agent.token!.id, handle: "opencode-daedalus" },
    })
    expect(summaries[0]!.details.lastUsedAt).toEqual(expect.any(String))
  })

  it("is Shinan's to run", async () => {
    await expect(summarizeAgentTokenUse(as(owner))).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })
})

describe("agent actors", () => {
  it("are refused if the token layer's IDs do not match a live token", async () => {
    const { token } = await makeToken(contributor)
    const ctx = await agentFor(token)
    const forged = {
      ...ctx,
      actor: { ...(ctx.actor as AgentActor), tokenId: crypto.randomUUID() },
    }
    await expect(listMembers(forged, workspaceId)).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })
})
