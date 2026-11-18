import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import type * as Api from "@shinan/api-client"
import {
  addMember,
  agentTokenPrefix,
  createWorkspace,
  rateLimits,
} from "@shinan/core"
import type { JobQueue, Person } from "@shinan/core"
import { eq, schema } from "@shinan/db"
import { connectTestDatabase } from "@shinan/db/testing"

import { insertPerson } from "../../test/people.js"
import { as, testSignIn } from "../../test/sign-in.js"
import { createApi } from "./routes.js"

const { db, pool } = connectTestDatabase()

afterAll(async () => {
  await pool.end()
})

const jobs: JobQueue = { send: () => Promise.resolve(null) }
const installationUrl = "http://shinan.test"
const options = { db, signIn: testSignIn, jobs, installationUrl }
const api = createApi({ ...options, rateLimit: false })
const limitedApi = createApi({ ...options, rateLimit: true })

let owner: Person
let contributor: Person
let workspaceId: string
let contributorMemberId: string
let addressCounter = 0

/** A network address no other test in this run uses. */
function freshAddress(): string {
  addressCounter++
  return `198.18.${Math.floor(addressCounter / 250)}.${(addressCounter % 250) + 1}`
}

beforeEach(async () => {
  owner = await insertPerson(db, "owner")
  contributor = await insertPerson(db, "contributor")
  await db
    .insert(schema.emailAllowlist)
    .values([{ email: owner.email }, { email: contributor.email }])
  const created = await createWorkspace(
    { db, actor: { kind: "person", personId: owner.id } },
    { name: "Team" },
  )
  workspaceId = created.workspace.id
  const member = await addMember(
    {
      db,
      actor: { kind: "person", personId: owner.id, reauthenticated: true },
    },
    { workspaceId, personId: contributor.id, role: "contributor" },
  )
  contributorMemberId = member.id
})

interface Call {
  method?: string
  body?: unknown
  headers?: Record<string, string>
  from?: string
  app?: typeof api
}

async function call(path: string, call: Call = {}) {
  const { method, body, headers, from, app = api } = call
  return app.request(
    path,
    {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    { incoming: { socket: { remoteAddress: from ?? freshAddress() } } },
  )
}

/** What the web app's requests carry. */
const webApp = { origin: installationUrl, "sec-fetch-site": "same-origin" }

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

const ws = (path = "") => `/workspaces/${workspaceId}${path}`

async function makeToken(
  person: Person,
  input: Partial<Api.NewAgentToken> = {},
): Promise<Api.IssuedAgentToken> {
  const response = await call(ws("/agents"), {
    headers: { ...webApp, ...as(person) },
    body: {
      codingTool: "opencode",
      machine: "Daedalus",
      access: "full",
      ...input,
    },
  })
  expect(response.status).toBe(201)
  return json<Api.IssuedAgentToken>(response)
}

/** A request from an agent, with its token in the header only. */
function asAgent(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` }
}

describe("making tokens by hand", () => {
  it("shows the token once, with the agent", async () => {
    const issued = await makeToken(contributor, { name: "OpenCode" })
    expect(issued.token.startsWith(agentTokenPrefix)).toBe(true)
    expect(issued).toMatchObject({
      agentCreated: true,
      replacedToken: false,
      agent: {
        handle: "opencode-daedalus",
        name: "OpenCode",
        memberId: contributorMemberId,
        token: { access: "full", lastUsedAt: null, requestCount: 0 },
      },
    })
    const listed = await call("/account/agents", { headers: as(contributor) })
    const agents = await json<Api.Agent[]>(listed)
    expect(agents).toHaveLength(1)
    expect(JSON.stringify(agents)).not.toContain(issued.token)
    expect(listed.headers.get("cache-control")).toBe("no-store")
  })

  it("asks the person to sign in again first", async () => {
    const response = await call(ws("/agents"), {
      headers: { ...webApp, ...as(contributor, { reauthenticated: false }) },
      body: { codingTool: "opencode", machine: "daedalus", access: "full" },
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: "reauthentication-required",
    })
  })

  it("refuses bad input", async () => {
    for (const body of [
      { codingTool: "opencode", machine: "a/b", access: "full" },
      { codingTool: "opencode", machine: "daedalus", access: "everything" },
      { codingTool: "opencode", machine: "daedalus" },
      { codingTool: "opencode", machine: 3, access: "full" },
    ]) {
      const response = await call(ws("/agents"), {
        headers: { ...webApp, ...as(contributor) },
        body,
      })
      expect(response.status, JSON.stringify(body)).toBe(422)
    }
  })

  it("issues a new token for an agent, revoking the old one", async () => {
    const first = await makeToken(contributor)
    const response = await call(ws(`/agents/${first.agent.id}/token`), {
      headers: { ...webApp, ...as(contributor) },
      body: { access: "read-only" },
    })
    expect(response.status).toBe(201)
    const second = await json<Api.IssuedAgentToken>(response)
    expect(second.replacedToken).toBe(true)
    expect(second.agent.token!.access).toBe("read-only")
    expect(
      (await call("/agent", { headers: asAgent(first.token) })).status,
    ).toBe(401)
    expect(
      (await call("/agent", { headers: asAgent(second.token) })).status,
    ).toBe(200)
  })
})

describe("managing agents", () => {
  it("renames, disables, enables and revokes", async () => {
    const { agent, token } = await makeToken(contributor)
    const path = ws(`/agents/${agent.id}`)
    const headers = { ...webApp, ...as(contributor) }

    const renamed = await call(path, {
      method: "PATCH",
      headers,
      body: { name: "OpenCode on Daedalus" },
    })
    expect(await json<Api.Agent>(renamed)).toMatchObject({
      name: "OpenCode on Daedalus",
      handle: "opencode-daedalus",
    })

    const revoked = await call(`${path}/token`, { method: "DELETE", headers })
    expect(await json<Api.Agent>(revoked)).toMatchObject({ token: null })
    expect((await call("/agent", { headers: asAgent(token) })).status).toBe(401)

    const disabled = await call(`${path}/disable`, { method: "POST", headers })
    expect(await json<Api.Agent>(disabled)).toMatchObject({ enabled: false })
    const refused = await call(`${path}/token`, {
      headers,
      body: { access: "full" },
    })
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ rule: "agent-disabled" })

    const enabled = await call(`${path}/enable`, { method: "POST", headers })
    expect(await json<Api.Agent>(enabled)).toMatchObject({ enabled: true })
  })

  it("lists every agent for owners and only their own for contributors", async () => {
    await makeToken(owner)
    await makeToken(contributor)
    const forOwner = await json<Api.Agent[]>(
      await call(ws("/agents"), { headers: as(owner) }),
    )
    const forContributor = await json<Api.Agent[]>(
      await call(ws("/agents"), { headers: as(contributor) }),
    )
    expect(forOwner).toHaveLength(2)
    expect(forContributor.map((a) => a.personId)).toEqual([contributor.id])
  })

  it("lets a workspace owner disable another member's agent", async () => {
    const { agent, token } = await makeToken(contributor)
    const response = await call(ws(`/agents/${agent.id}/disable`), {
      method: "POST",
      headers: { ...webApp, ...as(owner) },
    })
    expect(response.status).toBe(200)
    expect((await call("/agent", { headers: asAgent(token) })).status).toBe(401)
    const back = await call(ws(`/agents/${agent.id}/enable`), {
      method: "POST",
      headers: { ...webApp, ...as(owner) },
    })
    expect(back.status).toBe(404)
  })

  it("shows each member's agents in the Members list", async () => {
    const { agent } = await makeToken(contributor)
    const members = await json<Api.Member[]>(
      await call(ws("/members"), { headers: as(owner) }),
    )
    expect(members.find((m) => m.id === contributorMemberId)!.agents).toEqual([
      {
        id: agent.id,
        handle: "opencode-daedalus",
        name: "opencode-daedalus",
        enabled: true,
      },
    ])
  })

  it("stops a removed member's agents on their next request", async () => {
    const { token } = await makeToken(contributor)
    expect((await call("/agent", { headers: asAgent(token) })).status).toBe(200)
    await call(ws(`/members/${contributorMemberId}`), {
      method: "DELETE",
      headers: { ...webApp, ...as(owner) },
    })
    expect((await call("/agent", { headers: asAgent(token) })).status).toBe(401)
  })

  it("revokes tokens on sign out everywhere when asked", async () => {
    const { token } = await makeToken(contributor)
    const kept = await call("/account/sessions/end-all", {
      method: "POST",
      headers: { ...webApp, ...as(contributor) },
    })
    expect(kept.status).toBe(204)
    expect((await call("/agent", { headers: asAgent(token) })).status).toBe(200)
    const revoked = await call("/account/sessions/end-all", {
      headers: { ...webApp, ...as(contributor) },
      body: { revokeAgentTokens: true },
    })
    expect(revoked.status).toBe(204)
    expect((await call("/agent", { headers: asAgent(token) })).status).toBe(401)
    const bad = await call("/account/sessions/end-all", {
      headers: { ...webApp, ...as(contributor) },
      body: { revokeAgentTokens: "yes" },
    })
    expect(bad.status).toBe(422)
  })
})

describe("GET /api/agent", () => {
  it("tells the agent who it is", async () => {
    const { token, agent } = await makeToken(contributor, {
      access: "read-only",
    })
    const response = await call("/agent", { headers: asAgent(token) })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
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
    } satisfies Api.ConnectedAgent)
  })

  it("answers every refused token the same way", async () => {
    const { token, agent } = await makeToken(contributor)
    await call(ws(`/agents/${agent.id}/token`), {
      method: "DELETE",
      headers: { ...webApp, ...as(contributor) },
    })
    const answers = []
    for (const headers of [
      asAgent(token),
      asAgent(`${agentTokenPrefix}${"x".repeat(43)}`),
      asAgent("nonsense"),
    ]) {
      const response = await call("/agent", { headers })
      expect(response.status).toBe(401)
      expect(response.headers.get("www-authenticate")).toBe(
        'Bearer realm="shinan"',
      )
      answers.push(await response.json())
    }
    expect(answers).toEqual(
      Array(3).fill({
        error: "invalid-token",
        message: "The agent token is not valid",
      }),
    )
  })

  it("takes the token only from the Authorization header", async () => {
    const { token } = await makeToken(contributor)
    for (const [path, headers] of [
      ["/agent", {}],
      ["/agent", { authorization: token }],
      ["/agent", { authorization: `Basic ${token}` }],
      [`/agent?access_token=${token}`, {}],
      [`/agent?token=${token}`, asAgent(token)],
      [`/agent?q=${token}`, asAgent(token)],
    ] as const) {
      const response = await call(path, { headers })
      expect(response.status, path).toBe(401)
      expect(await response.json(), path).toMatchObject({
        error: "invalid-token",
      })
    }
    expect((await call("/agent", { headers: asAgent(token) })).status).toBe(200)
  })

  it("refuses sign-in cookies, alone or with a token", async () => {
    const { token } = await makeToken(contributor)
    for (const headers of [
      { cookie: "__Host-shinan.session_token=abc" },
      { ...asAgent(token), cookie: "anything=1" },
      // A signed-in person is not an agent.
      as(contributor),
    ]) {
      const response = await call("/agent", { headers })
      expect(response.status).toBe(401)
    }
  })

  it("skips the same-origin check only at agent endpoints", async () => {
    const { token } = await makeToken(contributor)
    // No Origin or Sec-Fetch-Site, as an agent's own client sends.
    const tokenOnly = await call("/agent", {
      method: "POST",
      headers: asAgent(token),
    })
    expect(tokenOnly.status).toBe(404)
    // With a cookie, the agent endpoint refuses it outright.
    const withCookie = await call("/agent/anything", {
      method: "POST",
      headers: { ...asAgent(token), cookie: "anything=1" },
    })
    expect(withCookie.status).toBe(401)
    // Everywhere else a token changes nothing: the check still applies.
    for (const path of ["/workspaces", "/setup", "/sign-in/link"]) {
      const elsewhere = await call(path, {
        headers: asAgent(token),
        body: { name: "x" },
      })
      expect(elsewhere.status, path).toBe(403)
      expect(await elsewhere.json()).toMatchObject({ reason: "cross-site" })
    }
  })

  it("throttles failed token use per network address", async () => {
    const { token } = await makeToken(contributor)
    const from = freshAddress()
    const { max } = rateLimits["agent-token-failure"]
    for (let n = 0; n < max; n++) {
      const response = await call("/agent", {
        headers: asAgent("wrong"),
        from,
        app: limitedApi,
      })
      expect(response.status).toBe(401)
    }
    const throttled = await call("/agent", {
      headers: asAgent("wrong"),
      from,
      app: limitedApi,
    })
    expect(throttled.status).toBe(429)
    expect(Number(throttled.headers.get("retry-after"))).toBeGreaterThan(0)
    // A working token from the same address is not held up.
    const sameAddress = await call("/agent", {
      headers: asAgent(token),
      from,
      app: limitedApi,
    })
    expect(sameAddress.status).toBe(200)
  })
})

describe("logging", () => {
  const output: string[] = []
  beforeEach(() => {
    output.length = 0
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        output.push(args.map(String).join(" "))
      })
    }
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("never writes a token, even when the request fails", async () => {
    const { token, agent } = await makeToken(contributor)
    await call("/agent", { headers: asAgent(token) })
    await call(`/agent?token=${token}`, {})
    // Break the database lookup: the error is logged without the request.
    await db
      .update(schema.agents)
      .set({ enabled: false, disabledAt: new Date() })
      .where(eq(schema.agents.id, agent.id))
    await call("/agent", { headers: asAgent(token) })
    const broken = createApi({
      ...options,
      rateLimit: false,
      db: {
        ...db,
        transaction: () => Promise.reject(new Error(`boom ${token}`)),
      } as unknown as typeof db,
    })
    const failed = await call("/agent", {
      headers: asAgent(token),
      app: broken,
    })
    expect(failed.status).toBe(500)
    expect(JSON.stringify(await failed.json())).not.toContain(token)
    expect(output.length).toBeGreaterThan(0)
    expect(output.join("\n")).not.toContain(
      token.slice(agentTokenPrefix.length),
    )
  })
})
