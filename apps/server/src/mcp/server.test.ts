import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createAgentToken, createWorkspace } from "@shinan/core"
import type { IssuedToken, JobQueue, Person } from "@shinan/core"
import { eq, schema } from "@shinan/db"
import { connectTestDatabase } from "@shinan/db/testing"

import { insertPerson } from "../../test/people.js"
import { noSignIn } from "../api/sign-in.js"
import { createApp } from "../app.js"
import { protocolVersions } from "./server.js"

// The MCP endpoint after the Git-based catalog (plan §2.13): one tool,
// `workspace_context`, with no catalog content; the endpoint's
// authentication, limits and caps are unchanged (`in-flight.test.ts` for
// the caps).

const { db, pool } = connectTestDatabase()

afterAll(async () => {
  await pool.end()
})

const installationUrl = "http://shinan.test"
const jobs: JobQueue = { send: () => Promise.resolve(null) }
const app = createApp({
  db,
  signIn: noSignIn,
  jobs,
  installationUrl,
  rateLimit: false,
})

let owner: Person
let workspaceId: string
let full: IssuedToken
let readOnly: IssuedToken
let token: string

async function issue(machine: string, access: "full" | "read-only") {
  return createAgentToken(
    {
      db,
      jobs,
      installationUrl,
      actor: { kind: "person", personId: owner.id, reauthenticated: true },
    },
    { workspaceId, codingTool: "opencode", machine, access },
  )
}

beforeAll(async () => {
  owner = await insertPerson(db, "owner")
  // Tokens work only for people the installation still lets in.
  await db.insert(schema.emailAllowlist).values({ email: owner.email })
  workspaceId = (
    await createWorkspace(
      { db, actor: { kind: "person", personId: owner.id } },
      { name: "Team" },
    )
  ).workspace.id
  full = await issue("daedalus", "full")
  readOnly = await issue("laptop", "read-only")
  token = full.token
})

/** Sends the client's requests to the app in this process. */
const fetchApp = (url: string | URL, init?: RequestInit) =>
  Promise.resolve(app.request(url.toString(), init))

async function connect(
  options: { token?: string; modern?: boolean } = {},
): Promise<Client> {
  const client = new Client(
    { name: "test", version: "1" },
    options.modern
      ? { versionNegotiation: { mode: { pin: "2026-07-28" } } }
      : {},
  )
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${installationUrl}/mcp`), {
      fetch: fetchApp,
      requestInit: {
        headers: { authorization: `Bearer ${options.token ?? token}` },
      },
    }),
  )
  return client
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
) {
  const result = await client.callTool({ name, arguments: args })
  return result as {
    isError?: boolean
    structuredContent: Record<string, unknown>
    content: { type: string; text: string }[]
  }
}

describe("the MCP endpoint", () => {
  it.each([
    ["2025-11-25, with initialize", false],
    ["2026-07-28", true],
  ])("serves only workspace_context over %s", async (_, modern) => {
    const client = await connect({ modern })
    try {
      expect(client.getProtocolEra()).toBe(modern ? "modern" : "legacy")
      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name)).toEqual(["workspace_context"])
      expect(tools[0]!.annotations).toMatchObject({ readOnlyHint: true })
      const instructions = client.getInstructions() ?? ""
      expect(instructions).toContain(`${installationUrl}/skills/`)
      expect(instructions).toContain("Git")

      const context = await callTool(client, "workspace_context")
      expect(context.isError).toBeFalsy()
      expect(context.structuredContent).toEqual({
        agent: {
          id: full.agent.id,
          handle: "opencode-daedalus",
          name: full.agent.name,
          codingTool: "opencode",
          machine: "daedalus",
        },
        person: { handle: owner.handle, name: owner.name },
        workspace: { id: workspaceId, name: "Team" },
        role: "owner",
        access: "full",
        scopes: [
          "catalog:read",
          "catalog:write",
          "tasks:read",
          "tasks:write",
          "presence",
        ],
        catalog: {
          repository: `${installationUrl}/git/${workspaceId}.git`,
        },
      })
      expect(JSON.parse(context.content[0]!.text)).toEqual(
        context.structuredContent,
      )
    } finally {
      await client.close()
    }
  })

  it("supports exactly the protocol revisions it names", () => {
    expect(protocolVersions).toEqual(["2026-07-28", "2025-11-25"])
  })

  it("no longer offers M2's catalog tools", async () => {
    const client = await connect()
    try {
      for (const name of [
        "search_catalog",
        "get_entity",
        "catalog_lists",
        "propose_catalog_change",
        "record_fact_check",
        "get_catalog_proposal",
        "comment_on_catalog_proposal",
        "withdraw_catalog_proposal",
      ])
        await expect(
          callTool(client, name, { id: "machine/musashi" }),
          name,
        ).rejects.toThrow(`Tool ${name} not found`)
    } finally {
      await client.close()
    }
  })

  it("serves a read-only token", async () => {
    const client = await connect({ token: readOnly.token })
    try {
      const context = await callTool(client, "workspace_context")
      expect(context.structuredContent).toMatchObject({
        access: "read-only",
        scopes: ["catalog:read", "tasks:read"],
        catalog: {
          repository: `${installationUrl}/git/${workspaceId}.git`,
        },
      })
    } finally {
      await client.close()
    }
  })
})

describe("a token without catalog:read", () => {
  it("gets the context without the catalog repository", async () => {
    const issued = await issue("ci", "read-only")
    // Only tasks:read: a scope set no screen offers yet, but the rules allow.
    await db
      .update(schema.agentTokens)
      .set({ scopes: ["tasks:read"] })
      .where(eq(schema.agentTokens.agentId, issued.agent.id))
    const client = await connect({ token: issued.token })
    try {
      const context = await callTool(client, "workspace_context")
      expect(context.structuredContent).toMatchObject({
        scopes: ["tasks:read"],
        catalog: null,
      })
    } finally {
      await client.close()
    }
  })
})

describe("refusals at /mcp", () => {
  const initialize = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    },
  }

  async function post(
    headers: Record<string, string>,
    body: unknown = initialize,
  ) {
    return app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  }

  it("answers a token's request", async () => {
    const response = await post({ authorization: `Bearer ${token}` })
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
  })

  it("refuses a request without a token", async () => {
    const response = await post({})
    expect(response.status).toBe(401)
    expect(response.headers.get("www-authenticate")).toContain("Bearer")
  })

  it("refuses a sign-in cookie, alone or with a token", async () => {
    expect((await post({ cookie: "shinan.session=x" })).status).toBe(401)
    expect(
      (
        await post({
          cookie: "shinan.session=x",
          authorization: `Bearer ${token}`,
        })
      ).status,
    ).toBe(401)
  })

  it("refuses a token in the address", async () => {
    const response = await app.request(
      `/mcp?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(initialize),
      },
    )
    expect(response.status).toBe(401)
  })

  it("refuses a request a browser sends from another site", async () => {
    const response = await post({
      authorization: `Bearer ${token}`,
      origin: "https://evil.example",
    })
    expect(response.status).toBe(403)
    expect(
      (
        await post({
          authorization: `Bearer ${token}`,
          origin: installationUrl,
        })
      ).status,
    ).toBe(200)
  })

  it("refuses batches, which would multiply the request limits", async () => {
    const response = await post({ authorization: `Bearer ${token}` }, [
      initialize,
      { ...initialize, id: 2 },
    ])
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: {
        code: -32600,
        message: expect.stringMatching(/Batches/) as unknown,
      },
    })
  })

  it("speaks only 2025-11-25 and 2026-07-28", async () => {
    const old = await post({
      authorization: `Bearer ${token}`,
      "mcp-protocol-version": "2024-11-05",
    })
    expect(old.status).toBe(400)
    // An initialize asking for an older revision is offered 2025-11-25.
    const offered = await post(
      { authorization: `Bearer ${token}` },
      {
        ...initialize,
        params: { ...initialize.params, protocolVersion: "2024-11-05" },
      },
    )
    expect(offered.status).toBe(200)
    expect(await offered.text()).toContain('"protocolVersion":"2025-11-25"')
  })

  it("does not hold subscriptions/listen streams open", async () => {
    const response = await post(
      {
        authorization: `Bearer ${token}`,
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "subscriptions/listen",
      },
      { jsonrpc: "2.0", id: 7, method: "subscriptions/listen", params: {} },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("application/json")
    expect(await response.json()).toMatchObject({
      id: 7,
      error: { code: -32601 },
    })
  })

  it("reads a body up to 512 KB, and refuses a larger one before reading it", async () => {
    // 300 KB is read...
    const large = await post(
      { authorization: `Bearer ${token}` },
      JSON.stringify({
        ...initialize,
        params: {
          ...initialize.params,
          _meta: { padding: "x".repeat(300 * 1024) },
        },
      }),
    )
    expect(large.status).toBe(200)
    // ...and anything over 512 KB is not.
    const response = await post(
      { authorization: `Bearer ${token}` },
      JSON.stringify({ ...initialize, padding: "x".repeat(513 * 1024) }),
    )
    expect(response.status).toBe(413)
  })

  it("refuses 2026-07-28 headers that disagree with the body", async () => {
    const call = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "workspace_context",
        arguments: {},
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }
    const headers = {
      authorization: `Bearer ${token}`,
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/call",
    }
    const right = await post(
      { ...headers, "mcp-name": "workspace_context" },
      call,
    )
    expect(right.status).toBe(200)
    const wrongName = await post({ ...headers, "mcp-name": "get_entity" }, call)
    expect(wrongName.status).toBe(400)
    const wrongMethod = await post(
      {
        ...headers,
        "mcp-method": "tools/list",
        "mcp-name": "workspace_context",
      },
      call,
    )
    expect(wrongMethod.status).toBe(400)
  })
})
