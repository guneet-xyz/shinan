import type { Context as HonoContext, MiddlewareHandler } from "hono"

import { agentTokenPrefix, authenticateAgent, shinan } from "@shinan/core"
import type { AgentActor, RequestInfo } from "@shinan/core"
import type { Database } from "@shinan/db"

import { errorResponse } from "./errors.js"

export interface AgentEnv {
  Variables: { agent: AgentActor }
}

export interface AgentAuthOptions {
  db: Database
  /** The installation's public address; tokens it did not issue fail. */
  installationUrl?: string
  requestInfo: (c: HonoContext) => RequestInfo
}

/**
 * The authentication of every agent endpoint (identity §7.4, architecture
 * §8.1): the REST API's `/api/agent` routes, and the MCP endpoint and plugin
 * stream when they arrive. Lets a request through only with a working agent
 * token, which is then available as `c.var.agent`. Core still checks the
 * agent on every operation.
 *
 * - The token is accepted only as `Authorization: Bearer`; a token in the
 *   address is refused before it is looked at (web addresses end up in
 *   logs, and the MCP specification forbids tokens in query strings).
 * - Agent endpoints take no sign-in cookie: a request with a cookie is
 *   refused, so a browser visiting another site cannot use a person's
 *   sign-in here. That is why they, and only they, are routed ahead of the
 *   same-origin check (`sameOriginOnly`); mount this on every agent
 *   endpoint the same way.
 * - Every refused token gets the same answer, whatever the reason (identity
 *   §10); the reason is only in the security log. Rate limits answer 429.
 * - The token is never logged: nothing here writes it anywhere.
 */
export function requireAgent(
  options: AgentAuthOptions,
): MiddlewareHandler<AgentEnv> {
  return async (c, next) => {
    const result = await checkAgentRequest(options, c)
    if (!result.agent) {
      if (result.retryAfterSeconds !== undefined) {
        const response = errorResponse(c, 429, {
          error: "too-many-requests",
          message: result.message,
        })
        response.headers.set("retry-after", String(result.retryAfterSeconds))
        return response
      }
      return refuse(c, result.message)
    }
    c.set("agent", result.agent)
    await next()
  }
}

/** Why `checkAgentRequest` refused a request. */
export type AgentRefusal =
  | {
      agent?: undefined
      reason: "token-in-address" | "cookie"
      message: string
      retryAfterSeconds?: undefined
    }
  /** No token was sent at all. */
  | {
      agent?: undefined
      reason: "no-token"
      message: string
      retryAfterSeconds?: undefined
    }
  | {
      agent?: undefined
      reason: "invalid-token"
      message: string
      retryAfterSeconds?: undefined
    }
  /** A rate limit: answer 429 with `Retry-After`. */
  | {
      agent?: undefined
      reason: "rate-limited"
      message: string
      retryAfterSeconds: number
    }

/**
 * The checks of `requireAgent`, for endpoints that answer in their own
 * format (the Git endpoint): the working agent token, or why not. With
 * `basic`, the token may also be the password of HTTP Basic
 * authentication, whose user name is ignored, which is how Git sends what
 * its credential helper gives it.
 */
export async function checkAgentRequest(
  options: AgentAuthOptions & { basic?: boolean },
  c: HonoContext,
): Promise<{ agent: AgentActor } | AgentRefusal> {
  if (tokenInAddress(c.req.url)) {
    return {
      reason: "token-in-address",
      message:
        "Send the agent token in the Authorization header, never in the address",
    }
  }
  if (c.req.header("cookie") !== undefined) {
    return {
      reason: "cookie",
      message: "Agent endpoints take only an agent token; send no cookies",
    }
  }
  const header = c.req.header("authorization")
  const token =
    bearerToken(header) ?? (options.basic ? basicPassword(header) : null)
  if (token === null || token === "") {
    return {
      reason:
        header === undefined || token === "" ? "no-token" : "invalid-token",
      message: options.basic
        ? "An agent token is needed, as the password or as Authorization: Bearer <token>"
        : "An agent token is needed, as Authorization: Bearer <token>",
    }
  }
  const result = await authenticateAgent(
    {
      db: options.db,
      actor: shinan,
      request: options.requestInfo(c),
      installationUrl: options.installationUrl,
    },
    { token },
  )
  if (!result.authenticated) {
    if (result.retryAfterSeconds !== undefined) {
      return {
        reason: "rate-limited",
        message: "Too many requests. Wait a minute and try again.",
        retryAfterSeconds: result.retryAfterSeconds,
      }
    }
    return { reason: "invalid-token", message: "The agent token is not valid" }
  }
  return { agent: result.actor }
}

/**
 * The password of an `Authorization: Basic` header, or null: Git sends
 * the agent token this way. The user name is ignored.
 */
function basicPassword(header: string | undefined): string | null {
  const match =
    header === undefined ? null : /^Basic +([A-Za-z0-9+/=]+) *$/i.exec(header)
  if (!match) return null
  const decoded = Buffer.from(match[1]!, "base64").toString("utf8")
  const colon = decoded.indexOf(":")
  return colon < 0 ? null : decoded.slice(colon + 1)
}

/** The token of an `Authorization: Bearer <token>` header, or null. */
function bearerToken(header: string | undefined): string | null {
  const match = header === undefined ? null : /^Bearer +(\S+) *$/i.exec(header)
  return match ? match[1]! : null
}

/**
 * Whether the address seems to carry a token: a parameter named like one,
 * or Shinan's token prefix anywhere in it.
 */
function tokenInAddress(url: string): boolean {
  const { pathname, searchParams } = new URL(url)
  if (decodeSafely(pathname).includes(agentTokenPrefix)) return true
  for (const [name, value] of searchParams) {
    if (/^(access_token|token|auth|authorization)$/i.test(name)) return true
    if (value.includes(agentTokenPrefix)) return true
  }
  return false
}

function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function refuse(c: HonoContext, message: string) {
  const response = errorResponse(c, 401, { error: "invalid-token", message })
  response.headers.set("www-authenticate", 'Bearer realm="shinan"')
  return response
}
