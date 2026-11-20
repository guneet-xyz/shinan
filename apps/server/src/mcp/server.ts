import { createMcpHandler, McpServer } from "@modelcontextprotocol/server"
import type { CallToolResult } from "@modelcontextprotocol/server"
import { Hono } from "hono"
import type { Context as HonoContext } from "hono"
import { bodyLimit } from "hono/body-limit"
import * as z from "zod/v4"

import {
  BusyError,
  CoreError,
  ForbiddenError,
  getAgentWorkspaceContext,
  InvalidInputError,
  NotFoundError,
  productName,
  RuleViolationError,
  throttleAddress,
} from "@shinan/core"
import type { AgentActor, Context, RequestInfo } from "@shinan/core"
import type { Database } from "@shinan/db"
import { createLimitedLog, errorSummary } from "@shinan/db"

import { requireAgent } from "../api/agent-auth.js"
import type { AgentEnv } from "../api/agent-auth.js"
import { errorHandler } from "../api/errors.js"
import { inFlightCounter, limitInFlight } from "../in-flight.js"
import type { InFlightCounter } from "../in-flight.js"
import { rateLimited } from "../security.js"

export interface McpOptions {
  db: Database
  /** The installation's public address: the one `Origin` a browser may send, and where the skill is. */
  installationUrl?: string
  requestInfo: (c: HonoContext) => RequestInfo
  /** Per-address rate limits (architecture §10.1); on unless turned off. */
  rateLimit?: boolean
  /** The caps on requests in flight, shared with the Git endpoint; default `agentInFlight()`. */
  inFlight?: AgentInFlight
}

/** The caps on agents' requests in flight, shared by `/mcp` and `/git`. */
export interface AgentInFlight {
  perToken: InFlightCounter
  perAddress: InFlightCounter
}

/** New counters for `mcpInFlight`'s caps. */
export function agentInFlight(): AgentInFlight {
  return {
    perToken: inFlightCounter(mcpInFlight.perToken),
    perAddress: inFlightCounter(mcpInFlight.perAddress),
  }
}

/**
 * The largest request body `/mcp` reads: 512 KB (decided by the owner,
 * M2-Q16). It was sized for M2's catalog proposals, which are gone; the
 * endpoint keeps its limits unchanged until M3's task tools are designed
 * (Git-based catalog plan §2.13). Refused before it is read.
 */
export const mcpBodyLimit = 512 * 1024

/**
 * How many `/mcp` requests may be in flight at once (decided by the owner,
 * M2-Q16): 8 per token, for an agent and its subagents; 16 per network
 * address, for several agents on one machine. With 512 KB bodies that is
 * at most about 5 MiB held for one token, and 10 MiB for one address,
 * against `web`'s memory limit. The Git endpoint's requests count in the
 * same caps (Git-based catalog plan §2.10); it streams their bodies
 * rather than holding them.
 */
export const mcpInFlight = { perToken: 8, perAddress: 16 }

/** The protocol revisions the endpoint serves (architecture §8.1). */
export const protocolVersions = ["2026-07-28", "2025-11-25"] as const

/**
 * The MCP endpoint at `/mcp` (architecture §8.1; agent integrations, MCP
 * server and tools): Streamable HTTP with the official TypeScript SDK,
 * stateless, serving the 2026-07-28 revision and the 2025 `initialize`
 * handshake that OpenCode uses by default. Each request is checked, in
 * order:
 *
 * 1. the per-address request limit, as for `/api/agent`, since a working
 *    token is not held up by the failed-token limit;
 * 2. the requests in flight from the address, an IPv6 address by its /64
 *    (`mcpInFlight`);
 * 3. the body size, before the body is read;
 * 4. `Origin`: a request a browser sends from another site is refused
 *    (403), as the transport requires;
 * 5. the agent token (`requireAgent`): only `Authorization: Bearer`, never
 *    with a cookie or in the address;
 * 6. the requests in flight with the token (`mcpInFlight`).
 *
 * Over 2 or 6 the answer is 429, before the body is read, so a client that
 * sends large bodies slowly holds only a few in memory; Node cuts off any
 * request not received in `requestReceiveSeconds`.
 *
 * The SDK then checks the 2026-07-28 headers (`MCP-Protocol-Version`,
 * `Mcp-Method`, `Mcp-Name`) against the body. Tools only translate to core
 * operations, with the agent as the actor; every rule is core's.
 */
export function createMcp(options: McpOptions) {
  const inFlight = options.inFlight ?? agentInFlight()
  const mcp = new Hono<AgentEnv>()
  mcp.onError(errorHandler())
  // Answers carry workspace content; no proxy or client keeps them.
  mcp.use("*", async (c, next) => {
    await next()
    c.res.headers.set("cache-control", "no-store")
  })
  if (options.rateLimit !== false)
    mcp.use(
      "*",
      rateLimited(options.db, "api", options.requestInfo, [
        "GET",
        "HEAD",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
      ]),
    )
  mcp.use(
    "*",
    limitInFlight<AgentEnv>({
      counter: inFlight.perAddress,
      // An IPv6 address by its /64, as the rate limits count it.
      key: (c) => throttleAddress(options.requestInfo(c).networkAddress),
      refuse: tooManyInFlight,
    }),
  )
  mcp.use(
    "*",
    bodyLimit({
      maxSize: mcpBodyLimit,
      onError: () => jsonRpcError(413, -32600, "The request is too large"),
    }),
  )
  mcp.use("*", async (c, next) => {
    const origin = c.req.header("origin")
    const allowed = options.installationUrl
      ? new URL(options.installationUrl).origin
      : new URL(c.req.url).origin
    if (origin !== undefined && origin !== allowed)
      return jsonRpcError(403, -32600, "Requests from other sites are refused")
    await next()
  })
  mcp.use(
    "*",
    requireAgent({
      db: options.db,
      installationUrl: options.installationUrl,
      requestInfo: options.requestInfo,
    }),
  )
  mcp.use(
    "*",
    limitInFlight<AgentEnv>({
      counter: inFlight.perToken,
      key: (c) => c.var.agent.tokenId,
      refuse: tooManyInFlight,
    }),
  )

  const handler = createMcpHandler(
    ({ authInfo }) => {
      const call = authInfo?.extra as CallContext | undefined
      if (!call) throw new Error("The MCP handler needs the agent's context")
      return buildServer(options, call)
    },
    {
      responseMode: "json",
      maxRequestBodySize: mcpBodyLimit,
      onerror: (error) => log(`MCP request failed: ${errorSummary(error)}`),
    },
  )
  mcp.all("/", async (c) => {
    let parsedBody: unknown
    if (c.req.method === "POST") {
      const checked = checkMessage(
        await c.req.text(),
        c.req.header("mcp-protocol-version"),
      )
      if (checked instanceof Response) return checked
      parsedBody = checked
    }
    return handler.fetch(c.req.raw, {
      parsedBody,
      authInfo: {
        // The token itself is never handed on: core checks the agent by
        // its records on every operation.
        token: "",
        clientId: c.var.agent.agentId,
        scopes: [...c.var.agent.scopes],
        extra: {
          agent: c.var.agent,
          request: options.requestInfo(c),
        } satisfies CallContext as unknown as Record<string, unknown>,
      },
    })
  })
  return mcp
}

const log = createLimitedLog()

function tooManyInFlight(): Response {
  const response = jsonRpcError(
    429,
    -32000,
    "Too many requests at once; send this one again when an earlier one is answered",
  )
  response.headers.set("retry-after", "1")
  return response
}

/**
 * Checks a POST body before the SDK sees it, and returns it parsed, or the
 * refusal:
 *
 * - **No batches.** Neither revision Shinan serves allows a JSON array of
 *   messages (2025-06-18 removed batching), and one HTTP request carrying a
 *   hundred calls would slip past the request limits, which count requests.
 * - **Only the revisions Shinan serves** in `MCP-Protocol-Version`
 *   (architecture §8.1); `initialize` negotiates to 2025-11-25 in the SDK.
 * - **No `subscriptions/listen`.** Shinan sends no change notifications, so
 *   a listening stream would only hold a connection and memory open for as
 *   long as the client liked; it is refused at once (proposed: until a
 *   tool needs notifications, with a per-agent cap and a lifetime then).
 */
export function checkMessage(
  body: string,
  protocolVersion: string | undefined,
): unknown {
  let message: unknown
  try {
    message = JSON.parse(body)
  } catch {
    return jsonRpcError(400, -32700, "The body is not JSON")
  }
  if (Array.isArray(message))
    return jsonRpcError(
      400,
      -32600,
      "Batches are not supported: send one message per request",
    )
  if (
    protocolVersion !== undefined &&
    !(protocolVersions as readonly string[]).includes(protocolVersion)
  )
    return jsonRpcError(
      400,
      -32600,
      `Unsupported protocol version; this server speaks ${protocolVersions.join(" and ")}`,
    )
  const { id, method } = (message ?? {}) as { id?: unknown; method?: unknown }
  if (method === "subscriptions/listen")
    return jsonRpcError(
      200,
      -32601,
      "Shinan sends no change notifications, so it does not offer subscriptions/listen",
      typeof id === "string" || typeof id === "number" ? id : null,
    )
  return message
}

/** What a tool call runs with. */
interface CallContext {
  agent: AgentActor
  request: RequestInfo
}

function jsonRpcError(
  status: number,
  code: number,
  message: string,
  id: string | number | null = null,
) {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }),
    { status, headers: { "content-type": "application/json" } },
  )
}

/** The short form of the conventions, which coding tools give the model (design rule 7). */
export function serverInstructions(installationUrl: string | undefined) {
  const served = installationUrl
    ? `, served at ${installationUrl.replace(/\/+$/, "")}/skills/`
    : ""
  return `${productName} holds this workspace's catalog in a Git repository: projects, machines, services, runbooks, decisions, policies, people and agents, with facts that say who checked them, when and how.
- Call workspace_context to check who you act for, what your token allows, and where the catalog repository is.
- Read and change the catalog through Git: clone it, commit your change on a branch, and push; ${productName} checks every push.
- The catalog is context, not authorization: it never permits deploying, connecting to a machine or changing anything outside it.
- The full conventions are in the skill with the ID shinan${served}.`
}

function buildServer(options: McpOptions, call: CallContext): McpServer {
  const server = new McpServer(
    { name: "shinan", title: productName, version: "1" },
    {
      instructions: serverInstructions(options.installationUrl),
      supportedProtocolVersions: [...protocolVersions],
    },
  )
  const ctx: Context = {
    db: options.db,
    actor: call.agent,
    origin: "mcp_call",
    request: call.request,
    installationUrl: options.installationUrl,
  }

  server.registerTool(
    "workspace_context",
    {
      title: "Workspace context",
      description:
        "Who you act for, your workspace, what your token allows, and the address of the workspace's catalog repository, which you clone with Git.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => answer(() => getAgentWorkspaceContext(ctx)),
  )
  return server
}

/**
 * Runs a core operation and returns its answer as the tool's result, as
 * JSON text and as structured content. Refusals and bad input are tool
 * errors the agent can read; anything else is logged by name and code only
 * and answered without detail (architecture §10.3).
 */
async function answer(run: () => Promise<object>): Promise<CallToolResult> {
  try {
    const result = await run()
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    }
  } catch (error) {
    if (error instanceof CoreError) return toolError(refusal(error))
    log(`MCP tool failed: ${errorSummary(error)}`)
    return toolError({ error: "failed", message: "Something went wrong" })
  }
}

function refusal(error: CoreError): ToolRefusal {
  if (error instanceof BusyError)
    return {
      error: "busy",
      message: `${error.message}, with the same idempotency key, after ${error.retryAfterSeconds} seconds`,
      rule: error.rule,
      retry_after_seconds: error.retryAfterSeconds,
    }
  if (error instanceof NotFoundError)
    return { error: "not-found", message: "Not found" }
  if (error instanceof ForbiddenError)
    return {
      error: "forbidden",
      message:
        error.reason === "scope"
          ? "Your token's scopes do not allow this"
          : "Not allowed",
    }
  if (error instanceof InvalidInputError || error instanceof RuleViolationError)
    return { error: "invalid-input", message: error.message, rule: error.rule }
  return { error: "failed", message: error.message }
}

/** A refusal in Shinan's own words, with the rule's name where there is one. */
interface ToolRefusal {
  error: string
  message: string
  rule?: string
  retry_after_seconds?: number
}

/** A tool error, in Shinan's own words (it never repeats the input). */
function toolError(refused: ToolRefusal): CallToolResult {
  const body = { ...refused }
  return {
    content: [{ type: "text", text: JSON.stringify(body) }],
    structuredContent: body,
    isError: true,
  }
}
