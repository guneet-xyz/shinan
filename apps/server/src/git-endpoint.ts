import { randomUUID } from "node:crypto"
import type { ClientRequest, IncomingMessage } from "node:http"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"
import { Hono } from "hono"
import type { Context as HonoContext } from "hono"

import {
  authorizeGitRequest,
  encodeGitContext,
  ForbiddenError,
  gitContextHeader,
  gitProcessSeconds,
  maxFetchBodyBytes,
  maxPushBodyBytes,
  NotFoundError,
  rateLimits,
  shinan,
  smartHttpRequest,
  takeRateLimit,
  throttleAddress,
} from "@shinan/core"
import type {
  GitRequestContext,
  RequestInfo,
  SmartHttpRequest,
} from "@shinan/core"
import type { Database } from "@shinan/db"
import { createLimitedLog, errorSummary } from "@shinan/db"

import { checkAgentRequest } from "./api/agent-auth.js"
import { gitText } from "./git-text.js"
import type { InFlightCounter, NodeBindings } from "./in-flight.js"

export interface GitEndpointOptions {
  db: Database
  /** The installation's public address; tokens it did not issue fail. */
  installationUrl?: string
  requestInfo: (c: HonoContext) => RequestInfo
  /** Per-address rate limits (architecture §10.1); on unless turned off. */
  rateLimit?: boolean
  /**
   * The client of the Git container (`SHINAN_GIT_URL` and the service
   * token), shared with the catalog's reads; without it, every fetch and
   * push gets 503.
   */
  git?: GitClient
  /** The caps on requests in flight, shared with `/mcp`. */
  inFlight: { perToken: InFlightCounter; perAddress: InFlightCounter }
}

const log = createLimitedLog()

/** The headers of an agent's request that the Git container is given. */
const forwardedHeaders = [
  "content-type",
  "content-length",
  "content-encoding",
  "git-protocol",
]
/** The headers of the Git container's answer that the agent is given. */
const answerHeaders = [
  "content-type",
  "cache-control",
  "expires",
  "pragma",
  "retry-after",
]

class BodyTooLargeError extends Error {
  override name = "BodyTooLargeError"
}

/**
 * The Git endpoint (architecture §8.5; Git-based catalog plan §2.2): agents
 * clone, fetch and push a workspace's catalog over HTTPS at
 * `/git/<workspace ID>.git`, and `web` forwards each request to the Git
 * container. Each request is checked, in order, before its body is read:
 *
 * 1. **The path:** only the four smart HTTP requests
 *    (`smartHttpRequest`); anything else, Git's dumb HTTP paths included,
 *    is `404` and reads nothing else.
 * 2. **The per-address request limit,** as for `/api` and `/mcp`.
 * 3. **The requests in flight** from the address, shared with `/mcp`.
 * 4. **The declared body size:** 64 MiB for a push, 4 MiB for a fetch.
 * 5. **The agent token** (`checkAgentRequest`): as the password of HTTP
 *    Basic authentication (the user name is ignored), which is how Git
 *    sends what its credential helper gives, or as `Bearer`; never with a
 *    cookie or in the address. Without one, `401` with
 *    `WWW-Authenticate: Basic realm="Shinan"`, which makes Git ask its
 *    credential helper. The per-token request limit is counted there.
 * 6. **The requests in flight** with the token, shared with `/mcp`.
 * 7. **Permission in core** (`authorizeGitRequest`): `catalog.fetch` or
 *    `catalog.push`; another workspace's token gets the same `404` as an
 *    unknown workspace, a read-only token pushing `403`. Each push counts
 *    against its agent's push rate.
 *
 * Then the request streams to the Git container with the service token
 * and the context header, never the agent's own `Authorization` header; a
 * body over its limit is cut off with `413`. The answer streams back.
 * Every refusal is plain text, which Git shows.
 */
export function createGitEndpoint(options: GitEndpointOptions) {
  const endpoint = new Hono()
  const auth = {
    db: options.db,
    installationUrl: options.installationUrl,
    requestInfo: options.requestInfo,
    basic: true,
  }

  endpoint.all("*", async (c) => {
    const url = new URL(c.req.url)
    const target = smartHttpRequest(c.req.method, url.pathname, url.search)
    if (!target) return gitText(404, "Not found")
    const request = options.requestInfo(c)

    if (options.rateLimit !== false) {
      const outcome = await takeRateLimit(
        { db: options.db, actor: shinan, request },
        "api",
      )
      if (!outcome.allowed) return tooManyRequests(outcome.retryAfterSeconds)
    }

    // Places in flight, held until the answer has been sent.
    const places: (() => void)[] = []
    const releasePlaces = () => {
      for (const release of places.splice(0)) release()
    }
    let handedOver = false
    try {
      const address = throttleAddress(request.networkAddress)
      if (address) {
        const place = options.inFlight.perAddress.take(address)
        if (!place) return tooManyAtOnce()
        places.push(place)
      }

      const push = target.service === "git-receive-pack"
      const limit = target.advertisement
        ? 0
        : push
          ? maxPushBodyBytes
          : maxFetchBodyBytes
      const declared = c.req.header("content-length")
      if (declared !== undefined && !/^\d{1,15}$/.test(declared)) {
        return gitText(400, "The Content-Length is not a number")
      }
      if (declared !== undefined && Number(declared) > limit) {
        return gitText(413, tooLargeMessage(push))
      }

      const checked = await checkAgentRequest(auth, c)
      if (!checked.agent) {
        if (checked.reason === "rate-limited") {
          return tooManyRequests(checked.retryAfterSeconds)
        }
        return gitText(401, `${checked.message}.`, {
          "www-authenticate": 'Basic realm="Shinan", charset="UTF-8"',
        })
      }
      const agent = checked.agent
      const tokenPlace = options.inFlight.perToken.take(agent.tokenId)
      if (!tokenPlace) return tooManyAtOnce()
      places.push(tokenPlace)

      let context: GitRequestContext
      try {
        const access = await authorizeGitRequest(
          {
            db: options.db,
            actor: agent,
            request,
            installationUrl: options.installationUrl,
          },
          {
            workspaceId: target.workspaceId,
            service: target.service,
            advertisement: target.advertisement,
            requestId: randomUUID(),
          },
        )
        if (!access.allowed) {
          return gitText(
            429,
            `Too many pushes: an agent may push ${rateLimits["catalog-push"].max} times in ${rateLimits["catalog-push"].windowSeconds / 60} minutes. Try again in ${access.retryAfterSeconds} seconds.`,
            { "retry-after": String(access.retryAfterSeconds) },
          )
        }
        context = access.context
      } catch (error) {
        if (error instanceof NotFoundError) return gitText(404, "Not found")
        if (error instanceof ForbiddenError) {
          return gitText(
            403,
            error.reason === "scope"
              ? push
                ? "This agent's token is read-only: it can fetch but not push."
                : "This agent's token does not allow reading the catalog."
              : "Not allowed.",
          )
        }
        throw error
      }

      if (!options.git) {
        return gitText(
          503,
          "The catalog's Git service is not set up on this installation.",
        )
      }
      const response = await forward(c, target, context, options.git, limit)
      const outgoing = (c.env as NodeBindings | undefined)?.outgoing
      if (outgoing && !outgoing.writableFinished && !outgoing.destroyed) {
        handedOver = true
        outgoing.once("close", releasePlaces)
      }
      return response
    } finally {
      if (!handedOver) releasePlaces()
    }
  })
  return endpoint
}

function tooManyRequests(retryAfterSeconds: number): Response {
  return gitText(429, "Too many requests. Wait a minute and try again.", {
    "retry-after": String(retryAfterSeconds),
  })
}

function tooManyAtOnce(): Response {
  return gitText(
    429,
    "Too many requests at once; try again when an earlier one is answered.",
    { "retry-after": "1" },
  )
}

function tooLargeMessage(push: boolean): string {
  return push
    ? `The push is larger than Shinan accepts (${maxPushBodyBytes / 1024 / 1024} MiB). Push fewer changes at once.`
    : `The fetch request is larger than Shinan accepts (${maxFetchBodyBytes / 1024 / 1024} MiB).`
}

function unreachable(): Response {
  return gitText(
    503,
    "The catalog's Git service did not answer; try again shortly.",
    { "retry-after": "5" },
  )
}

/**
 * Sends the request to the Git container and answers with its answer. The
 * body goes as it arrives, counted against `limit`; the answer is given
 * once the whole body has gone (Git answers a smart HTTP request only after
 * reading it, though `git http-backend` sends its headers first), so a body
 * over the limit can still be answered `413`. The answer then streams back
 * as it arrives. If either side goes, the other is ended.
 */
function forward(
  c: HonoContext,
  target: SmartHttpRequest,
  context: GitRequestContext,
  git: GitClient,
  limit: number,
): Promise<Response> {
  // Built from nothing: the agent's own Authorization header, cookies and
  // anything else it sent stay here. The client adds the service token.
  const headers: Record<string, string> = {
    [gitContextHeader]: encodeGitContext(context),
  }
  for (const name of forwardedHeaders) {
    const value = c.req.header(name)
    if (value !== undefined) headers[name] = value
  }
  const outgoing = (c.env as NodeBindings | undefined)?.outgoing

  return new Promise<Response>((resolve) => {
    let settled = false
    const settle = (response: Response) => {
      if (settled) return
      settled = true
      resolve(response)
    }
    const upstream: ClientRequest = git.smartHttp(
      `/git${target.pathInfo}${target.query ? `?${target.query}` : ""}`,
      {
        method: c.req.method,
        headers,
        // Longer than an API call: the Git container ends a Git process
        // at its own limit first.
        timeoutMs: (gitProcessSeconds + 60) * 1000,
      },
    )
    // The Git container sees the request at once, before any of its body:
    // it can refuse it, or start Git, without waiting.
    upstream.flushHeaders()
    // The agent went: the Git container's request, and its Git, end too.
    outgoing?.once("close", () => {
      if (!outgoing.writableFinished) upstream.destroy()
    })

    let answer: IncomingMessage | undefined
    let bodySent = target.advertisement || !c.req.raw.body
    const answerWhenReady = () => {
      if (!answer || settled) return
      // A refusal is passed on at once; an answer once the body is sent.
      if (!bodySent && answer.statusCode! < 300) return
      settle(streamed(answer, outgoing))
    }
    upstream.once("response", (response) => {
      answer = response
      answerWhenReady()
    })
    upstream.on("error", (error) => {
      if (answer || settled) return
      log(`Git endpoint: the Git container failed: ${errorSummary(error)}`)
      settle(unreachable())
    })

    const body = c.req.raw.body
    if (bodySent || !body) {
      upstream.end()
      return
    }
    let received = 0
    const counted = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        received += chunk.length
        if (received > limit) done(new BodyTooLargeError())
        else done(null, chunk)
      },
    })
    pipeline(
      Readable.fromWeb(body as unknown as NodeReadableStream<Uint8Array>),
      counted,
      upstream,
    ).then(
      () => {
        bodySent = true
        answerWhenReady()
      },
      (error: unknown) => {
        // A refusal the Git container gave before reading the body has
        // been passed on already.
        if (settled) return
        if (error instanceof BodyTooLargeError) {
          upstream.destroy()
          answer?.destroy()
          settle(
            gitText(
              413,
              tooLargeMessage(target.service === "git-receive-pack"),
            ),
          )
        } else if (answer) {
          // Git stopped reading before the body ended (it refused what it
          // had read): its answer says why.
          settle(streamed(answer, outgoing))
        } else {
          // The agent stopped sending, or the Git container went.
          upstream.destroy()
          settle(unreachable())
        }
      },
    )
  })
}

/** The Git container's answer, streamed; cut short, it closes the connection. */
function streamed(
  answer: IncomingMessage,
  outgoing: NodeBindings["outgoing"],
): Response {
  const headers = new Headers({ "cache-control": "no-store" })
  for (const name of answerHeaders) {
    const value = answer.headers[name]
    if (typeof value === "string") headers.set(name, value)
  }
  let done = false
  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        // A cut-short answer also shows as "close", below.
        answer.on("error", () => {})
        answer.on("data", (chunk: Buffer) => {
          if (done) return
          controller.enqueue(new Uint8Array(chunk))
          if ((controller.desiredSize ?? 0) <= 0) answer.pause()
        })
        answer.once("end", () => {
          if (done) return
          done = true
          controller.close()
        })
        answer.once("close", () => {
          if (done) return
          // The Git container's answer ended without finishing: the
          // agent's connection is closed, so Git sees it is incomplete.
          done = true
          outgoing?.destroy()
          controller.error(
            new Error("The Git container's answer was cut short"),
          )
        })
      },
      pull() {
        answer.resume()
      },
      cancel() {
        done = true
        answer.destroy()
      },
    },
    { highWaterMark: 64 * 1024, size: (chunk) => chunk.byteLength },
  )
  return new Response(stream, { status: answer.statusCode ?? 502, headers })
}
