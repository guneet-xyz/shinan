import type { ServerResponse } from "node:http"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"
import type { Context } from "hono"

import {
  gitProcessSeconds,
  gitProcessWaitSeconds,
  maxFetchBodyBytes,
  maxGitProcesses,
  maxPushBodyBytes,
  maxQueuedGitProcesses,
  smartHttpRequest,
} from "@shinan/core"
import type { LimitedLog } from "@shinan/db"

import { gitText } from "../git-text.js"
import type { GitAppEnv } from "./app.js"
import type { RepositoryStore } from "./store.js"
import { repositoryConfiguration } from "./store.js"

export interface GitProcessLimits {
  /** Git processes at once. */
  running: number
  /** Requests that may wait for one. */
  queued: number
  /** How long a request waits, in milliseconds. */
  waitMs: number
}

export const defaultGitProcessLimits: GitProcessLimits = {
  running: maxGitProcesses,
  queued: maxQueuedGitProcesses,
  waitMs: gitProcessWaitSeconds * 1000,
}

/** The longest block of CGI headers `git http-backend` may write. */
const maxCgiHeaderBytes = 64 * 1024

/**
 * Lets `running` Git processes run at once. Up to `queued` more requests
 * wait their turn, each at most `waitMs`, and leave the queue if their
 * client goes; past that, `acquire` answers null.
 */
export function gitProcessGate(limits: GitProcessLimits) {
  let running = 0
  const waiting: ((granted: boolean) => void)[] = []
  const release = () => {
    const next = waiting.shift()
    if (next) next(true)
    else running--
  }
  const place = () => {
    let held = true
    return () => {
      if (!held) return
      held = false
      release()
    }
  }
  return {
    async acquire(
      outgoing: ServerResponse | undefined,
    ): Promise<(() => void) | null> {
      if (running < limits.running) {
        running++
        return place()
      }
      if (waiting.length >= limits.queued) return null
      const granted = await new Promise<boolean>((resolve) => {
        const settle = (value: boolean) => {
          clearTimeout(timer)
          outgoing?.off("close", gone)
          const at = waiting.indexOf(settle)
          if (at >= 0) waiting.splice(at, 1)
          resolve(value)
        }
        const gone = () => settle(false)
        const timer = setTimeout(() => settle(false), limits.waitMs)
        waiting.push(settle)
        outgoing?.once("close", gone)
      })
      return granted ? place() : null
    },
  }
}

/** The headers of `git http-backend`'s answer that are passed on. */
const answerHeaders = new Set([
  "content-type",
  "cache-control",
  "expires",
  "pragma",
])

class BodyTooLargeError extends Error {
  override name = "BodyTooLargeError"
}

/**
 * The smart HTTP paths of the Git container (Git-based catalog plan §2.2,
 * step 6): the same path checks as `web` (defence in depth), the context
 * `web` sent (it must be for this workspace, and allow pushing for
 * `git-receive-pack`), the body limits, a cap on Git processes, then a CGI
 * bridge to `git http-backend`:
 *
 * - **Its environment is built here,** from nothing: Git's clean
 *   environment (`@shinan/git`) and the CGI variables (`GIT_PROJECT_ROOT`,
 *   `PATH_INFO`, `REQUEST_METHOD`, `QUERY_STRING`, `CONTENT_TYPE`,
 *   `CONTENT_LENGTH`, `GIT_PROTOCOL` from `Git-Protocol`, `REMOTE_USER` (the
 *   agent's handle), `GIT_HTTP_EXPORT_ALL`, and `HTTP_CONTENT_ENCODING` for
 *   a gzip body). Not the service token, nor anything else of this process.
 * - **Shinan's repository settings are on its command line** (`-c`, which
 *   overrides the repository's `config`), with `core.hooksPath` first, so a
 *   repository whose `config` lost a setting still runs the hooks; dumb
 *   HTTP is off (`http.getanyfile`), and `http.receivepack` follows the
 *   context.
 * - **Streams both ways:** the body goes to Git as it arrives, counted
 *   against the limit; Git's answer goes back as Git writes it.
 * - **Ends Git** at its time limit, or when the client goes; an answer cut
 *   short closes the connection, so the client cannot take it for whole.
 */
export function createSmartHttp(options: {
  store: RepositoryStore
  log: LimitedLog
  processes?: GitProcessLimits
  /** How long one Git process may run; default `gitProcessSeconds`. */
  processSeconds?: number
}) {
  const { store, log } = options
  const gate = gitProcessGate(options.processes ?? defaultGitProcessLimits)
  const timeoutMs = (options.processSeconds ?? gitProcessSeconds) * 1000

  return async (c: Context<GitAppEnv>): Promise<Response> => {
    const url = new URL(c.req.url)
    const target = smartHttpRequest(c.req.method, url.pathname, url.search)
    if (!target) return gitText(404, "Not found")
    const context = c.var.gitContext
    if (!context) return gitText(400, "The request has no context")
    if (context.workspaceId.toLowerCase() !== target.workspaceId) {
      return gitText(400, "The context is for another workspace")
    }
    const push = target.service === "git-receive-pack"
    if (push && !context.mayPush) {
      return gitText(
        403,
        "This agent's token is read-only: it can fetch but not push.",
      )
    }

    const encoding = c.req.header("content-encoding")?.toLowerCase()
    const gzip = encoding === "gzip" || encoding === "x-gzip"
    if (encoding !== undefined && encoding !== "identity" && !gzip) {
      return gitText(
        415,
        "Shinan accepts Git requests uncompressed or with gzip.",
      )
    }
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
    const protocol = c.req.header("git-protocol")
    if (protocol !== undefined && !/^[A-Za-z0-9=:._-]{1,256}$/.test(protocol)) {
      return gitText(400, "The Git-Protocol header is not one Git sends")
    }
    if (!store.exists(target.workspaceId)) return gitText(404, "Not found")

    const outgoing = c.env?.outgoing
    const release = await gate.acquire(outgoing)
    if (!release) {
      return gitText(
        429,
        "Shinan is serving as many fetches and pushes as it can; try again in a few seconds.",
        { "retry-after": String(gitProcessWaitSeconds) },
      )
    }

    const settings: [string, string][] = [
      ...repositoryConfiguration(store.hooksDirectory),
      ["http.getanyfile", "false"],
      ["http.uploadpack", "true"],
      ["http.receivepack", String(context.mayPush)],
    ]
    const env: Record<string, string> = {
      GIT_PROJECT_ROOT: store.root,
      GIT_HTTP_EXPORT_ALL: "1",
      PATH_INFO: target.pathInfo,
      REQUEST_METHOD: c.req.method,
      QUERY_STRING: target.query,
      REMOTE_USER: context.agent.handle,
    }
    const contentType = c.req.header("content-type")
    if (contentType !== undefined) env.CONTENT_TYPE = contentType
    if (declared !== undefined) env.CONTENT_LENGTH = declared
    if (gzip) env.HTTP_CONTENT_ENCODING = "gzip"
    if (protocol !== undefined) env.GIT_PROTOCOL = protocol

    let spawned: ReturnType<RepositoryStore["git"]["spawn"]>
    try {
      spawned = store.git.spawn(
        [
          ...settings.flatMap(([key, value]) => ["-c", `${key}=${value}`]),
          "http-backend",
        ],
        { cwd: store.root, env, timeoutMs },
      )
    } catch (error) {
      release()
      throw error
    }
    const { child, kill } = spawned
    let tooLarge = false
    const ended = spawned.ended.then((end) => {
      release()
      return end
    })
    // The client went before the answer was whole: Git stops too.
    outgoing?.once("close", () => {
      if (!outgoing.writableFinished) kill()
    })

    const errors: Buffer[] = []
    let errorBytes = 0
    child.stderr.on("data", (chunk: Buffer) => {
      if (errorBytes >= 4096) return
      errors.push(chunk.subarray(0, 4096 - errorBytes))
      errorBytes += chunk.length
    })
    void ended.then(({ code, signal, timedOut }) => {
      if (code === 0) return
      const first = Buffer.concat(errors).toString("utf8").split("\n", 1)[0]
      log(
        `git http-backend ${target.service} ended ${timedOut ? "at its time limit" : signal ? `by ${signal}` : `with exit code ${code}`}${first ? `: ${first.slice(0, 200)}` : ""}`,
      )
    })

    const body = c.req.raw.body
    if (target.advertisement || !body) {
      child.stdin.end()
    } else {
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
        child.stdin,
      ).catch((error: unknown) => {
        if (error instanceof BodyTooLargeError) {
          tooLarge = true
          kill()
        }
        // Otherwise Git stopped reading (it answered already), or the
        // client went; Git's own end says which.
      })
    }

    const head = await readCgiHeaders(child.stdout)
    if (!head) {
      kill()
      await ended
      if (tooLarge) return gitText(413, tooLargeMessage(push))
      return gitText(
        500,
        "Git could not answer this request; try again shortly.",
      )
    }
    const headers = new Headers({ "cache-control": "no-store" })
    let status = 200
    for (const line of head.split("\r\n")) {
      const colon = line.indexOf(":")
      if (colon <= 0) continue
      const name = line.slice(0, colon).trim().toLowerCase()
      const value = line.slice(colon + 1).trim()
      if (name === "status") status = Number(/^\d{3}/.exec(value)?.[0] ?? 500)
      else if (answerHeaders.has(name)) headers.set(name, value)
    }

    const stdout = child.stdout
    let done = false
    const answer = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          stdout.on("data", (chunk: Buffer) => {
            if (done) return
            controller.enqueue(new Uint8Array(chunk))
            if ((controller.desiredSize ?? 0) <= 0) stdout.pause()
          })
          // After "end", or without it when Git was stopped.
          stdout.once("close", () => {
            const whole = stdout.readableEnded
            void ended.then(({ timedOut, signal }) => {
              if (done) return
              done = true
              if (!whole || timedOut || tooLarge || signal === "SIGKILL") {
                // Cut short: the connection is closed rather than the
                // answer ended, so the client sees it is incomplete.
                outgoing?.destroy()
                controller.error(new Error("Git was stopped"))
              } else {
                controller.close()
              }
            })
          })
          stdout.once("error", (error) => {
            if (done) return
            done = true
            controller.error(error)
          })
        },
        pull() {
          stdout.resume()
        },
        cancel() {
          done = true
          kill()
        },
      },
      { highWaterMark: 64 * 1024, size: (chunk) => chunk.byteLength },
    )
    return new Response(answer, { status, headers })
  }
}

function tooLargeMessage(push: boolean): string {
  return push
    ? `The push is larger than Shinan accepts (${maxPushBodyBytes / 1024 / 1024} MiB). Push fewer changes at once.`
    : `The fetch request is larger than Shinan accepts (${maxFetchBodyBytes / 1024 / 1024} MiB).`
}

/**
 * Reads the CGI headers at the start of `git http-backend`'s output, up to
 * the empty line, and leaves the rest in the stream; null if the output
 * ends first or the headers are too long.
 */
function readCgiHeaders(stream: Readable): Promise<string | null> {
  return new Promise((resolve) => {
    let buffered = Buffer.alloc(0)
    const finish = (value: string | null) => {
      stream.off("readable", onReadable)
      stream.off("end", onEnd)
      stream.off("error", onEnd)
      resolve(value)
    }
    const onReadable = () => {
      let chunk: Buffer | null
      while ((chunk = stream.read() as Buffer | null) !== null) {
        buffered = Buffer.concat([buffered, chunk])
        const end = buffered.indexOf("\r\n\r\n")
        if (end >= 0) {
          const rest = buffered.subarray(end + 4)
          finish(buffered.subarray(0, end).toString("latin1"))
          if (rest.length > 0) stream.unshift(rest)
          return
        }
        if (buffered.length > maxCgiHeaderBytes) return finish(null)
      }
    }
    const onEnd = () => finish(null)
    stream.on("readable", onReadable)
    stream.once("end", onEnd)
    stream.once("error", onEnd)
  })
}
