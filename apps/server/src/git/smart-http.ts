import { randomBytes } from "node:crypto"
import { createReadStream, createWriteStream, mkdirSync, rmSync } from "node:fs"
import type { ServerResponse } from "node:http"
import { join } from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { createGunzip } from "node:zlib"
import type { Context } from "hono"

import {
  gitProcessSeconds,
  gitProcessWaitSeconds,
  maxFetchBodyBytes,
  maxGitProcesses,
  maxGitProcessesPerAgent,
  maxGitProcessesPerPerson,
  maxPushBodyBytes,
  maxQueuedGitProcesses,
  smartHttpRequest,
} from "@shinan/core"
import type { LimitedLog } from "@shinan/db"

import { gitMessages, gitText } from "../git-text.js"
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
  /**
   * Git processes one agent may hold or wait for at once, so no single
   * token (even a read-only one) can take them all.
   */
  perAgent: number
  /** Git processes the agents of one person may hold or wait for at once. */
  perPerson: number
}

export const defaultGitProcessLimits: GitProcessLimits = {
  running: maxGitProcesses,
  queued: maxQueuedGitProcesses,
  waitMs: gitProcessWaitSeconds * 1000,
  perAgent: maxGitProcessesPerAgent,
  perPerson: maxGitProcessesPerPerson,
}

/** The longest block of CGI headers `git http-backend` may write. */
const maxCgiHeaderBytes = 64 * 1024

/**
 * Lets `running` Git processes run at once. Up to `queued` more requests
 * wait their turn, each at most `waitMs`, and leave the queue if their
 * client goes; past that, `acquire` answers `busy`. One agent may hold or
 * wait for at most `perAgent` of them (past that, `agent`), and the agents
 * of one person together at most `perPerson` (past that, `person`): a
 * person can make agents freely.
 */
export function gitProcessGate(limits: GitProcessLimits) {
  let running = 0
  const waiting: ((granted: boolean) => void)[] = []
  const agents = new Map<string, number>()
  const people = new Map<string, number>()
  const add = (counts: Map<string, number>, key: string, by: number) => {
    const next = (counts.get(key) ?? 0) + by
    if (next === 0) counts.delete(key)
    else counts.set(key, next)
  }
  const leave = (agent: string, person: string) => {
    add(agents, agent, -1)
    add(people, person, -1)
  }
  const release = () => {
    const next = waiting.shift()
    if (next) next(true)
    else running--
  }
  const place = (agent: string, person: string) => {
    let held = true
    return () => {
      if (!held) return
      held = false
      leave(agent, person)
      release()
    }
  }
  return {
    async acquire(
      outgoing: ServerResponse | undefined,
      agent: string,
      person: string,
    ): Promise<(() => void) | "busy" | "agent" | "person"> {
      if ((agents.get(agent) ?? 0) >= limits.perAgent) return "agent"
      if ((people.get(person) ?? 0) >= limits.perPerson) return "person"
      if (running < limits.running) {
        running++
        add(agents, agent, 1)
        add(people, person, 1)
        return place(agent, person)
      }
      if (waiting.length >= limits.queued) return "busy"
      add(agents, agent, 1)
      add(people, person, 1)
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
      if (!granted) {
        leave(agent, person)
        return "busy"
      }
      return place(agent, person)
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
 * `git-receive-pack`), the body limits, then a CGI bridge to
 * `git http-backend`:
 *
 * - **The whole body arrives before Git starts** (review of GC-2): a
 *   fetch's in memory, at most 4 MiB, a push's in a file in `.tmp/` on the
 *   volume, at most 64 MiB and 8 at once, both counted after inflating a
 *   gzip body. A client that sends slowly holds no Git process.
 * - **Git processes are capped:** 4 at once, 16 more waiting up to 10
 *   seconds, and at most 2 running or waiting per agent, so no single
 *   token, even a read-only one, can take them all.
 * - **Its environment is built here,** from nothing: Git's clean
 *   environment (`@shinan/git`) and the CGI variables (`GIT_PROJECT_ROOT`,
 *   `PATH_INFO`, `REQUEST_METHOD`, `QUERY_STRING`, `CONTENT_TYPE`,
 *   `CONTENT_LENGTH` of the body as received, `GIT_PROTOCOL` from
 *   `Git-Protocol`, `REMOTE_USER` (the agent's handle),
 *   `GIT_HTTP_EXPORT_ALL`). Not the service token, nor anything else of
 *   this process.
 * - **Shinan's repository settings are on its command line** (`-c`, which
 *   overrides the repository's `config`), with `core.hooksPath` first, so a
 *   repository whose `config` lost a setting still runs the hooks; dumb
 *   HTTP is off (`http.getanyfile`), and `http.receivepack` follows the
 *   context.
 * - **Ends Git** at its time limit, when the client goes, or when the
 *   client takes none of the answer for 30 seconds; an answer cut short
 *   closes the connection, so the client cannot take it for whole.
 */
export function createSmartHttp(options: {
  store: RepositoryStore
  log: LimitedLog
  processes?: GitProcessLimits
  /** How long one Git process may run; default `gitProcessSeconds`. */
  processSeconds?: number
  /**
   * How long a client may take none of an answer before Git is ended;
   * default `answerStallSeconds`.
   */
  answerStallSeconds?: number
  /** Opens a push's spool file; tests give one that fails. */
  openSpool?: (path: string) => NodeJS.WritableStream
}) {
  const { store, log } = options
  const processLimits = options.processes ?? defaultGitProcessLimits
  const gate = gitProcessGate(processLimits)
  const timeoutMs = (options.processSeconds ?? gitProcessSeconds) * 1000
  const answerStallMs =
    (options.answerStallSeconds ?? answerStallSeconds) * 1000
  let spooling = 0
  const openSpool =
    options.openSpool ??
    ((path: string) => createWriteStream(path, { flags: "wx", mode: 0o600 }))
  const spoolingBy = new Map<string, number>()

  return async (c: Context<GitAppEnv>): Promise<Response> => {
    const url = new URL(c.req.url)
    const target = smartHttpRequest(c.req.method, url.pathname, url.search)
    if (!target) return gitText(404, gitMessages.noSuchPath)
    const context = c.var.gitContext
    if (!context) return gitText(400, gitMessages.noContext)
    if (context.workspaceId.toLowerCase() !== target.workspaceId) {
      return gitText(400, gitMessages.otherContext)
    }
    const push = target.service === "git-receive-pack"
    if (push && !context.mayPush) {
      return gitText(403, gitMessages.readOnly)
    }

    const encoding = c.req.header("content-encoding")?.toLowerCase()
    const gzip = encoding === "gzip" || encoding === "x-gzip"
    if (encoding !== undefined && encoding !== "identity" && !gzip) {
      return gitText(415, gitMessages.badEncoding)
    }
    const limit = target.advertisement
      ? 0
      : push
        ? maxPushBodyBytes
        : maxFetchBodyBytes
    const declared = c.req.header("content-length")
    if (declared !== undefined && !/^\d{1,15}$/.test(declared)) {
      return gitText(400, gitMessages.badLength)
    }
    if (declared !== undefined && Number(declared) > limit) {
      return gitText(413, tooLargeMessage(push))
    }
    const protocol = c.req.header("git-protocol")
    if (protocol !== undefined && !/^[A-Za-z0-9=:._-]{1,256}$/.test(protocol)) {
      return gitText(400, gitMessages.badProtocol)
    }
    // As web's answer for a workspace the token cannot reach.
    if (!store.exists(target.workspaceId))
      return gitText(404, gitMessages.notFound)

    const outgoing = c.env?.outgoing
    // The whole body arrives before Git starts, so a client that sends
    // slowly holds no Git process: a fetch's in memory (at most 4 MiB), a
    // push's in a file on the volume (at most 64 MiB), counted after
    // inflating a gzip body.
    let body: ReceivedBody
    if (target.advertisement || !c.req.raw.body) {
      body = { size: 0 }
    } else {
      // Push bodies take places in the spool, counted per agent before a
      // byte is read, so one agent cannot fill it.
      const agent = context.agent.id
      if (push && (spoolingBy.get(agent) ?? 0) >= maxSpoolingPerAgent) {
        return gitText(
          429,
          gitMessages.agentSpooling(maxSpoolingPerAgent, gitProcessWaitSeconds),
          { "retry-after": String(gitProcessWaitSeconds) },
        )
      }
      if (push && spooling >= maxSpooling) {
        return gitText(429, gitMessages.busy, {
          "retry-after": String(gitProcessWaitSeconds),
        })
      }
      if (push) {
        spooling++
        spoolingBy.set(agent, (spoolingBy.get(agent) ?? 0) + 1)
      }
      try {
        body = await receiveBody(c.req.raw.body, {
          limit,
          gzip,
          spool: push ? join(store.root, ".tmp") : null,
          openSpool,
        })
      } catch (error) {
        if (error instanceof BodyTooLargeError)
          return gitText(413, tooLargeMessage(push))
        if (error instanceof BadGzipError)
          return gitText(400, gitMessages.badGzip)
        const code = (error as { code?: string }).code
        if (code === "ENOSPC" || code === "EDQUOT") {
          // The Git service's own failure, not the client's.
          log(
            `The catalog volume is full: a push could not be received (${code})`,
          )
          return gitText(507, gitMessages.diskFull)
        }
        // The client went, or stopped sending: there is no one to answer.
        return gitText(400, gitMessages.bodyCutShort)
      } finally {
        if (push) {
          spooling--
          const left = (spoolingBy.get(agent) ?? 1) - 1
          if (left === 0) spoolingBy.delete(agent)
          else spoolingBy.set(agent, left)
        }
      }
    }
    const removeSpool = () => {
      if (body.file) rmSync(body.file, { force: true })
    }

    const place = await gate.acquire(
      outgoing,
      context.agent.id,
      context.person.id,
    )
    if (typeof place === "string") {
      removeSpool()
      return gitText(
        429,
        place === "agent"
          ? gitMessages.agentBusy(processLimits.perAgent, gitProcessWaitSeconds)
          : place === "person"
            ? gitMessages.personBusy(
                processLimits.perPerson,
                gitProcessWaitSeconds,
              )
            : gitMessages.busy,
        { "retry-after": String(gitProcessWaitSeconds) },
      )
    }
    const release = place

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
    // Git gets the body as it was received, inflated: its length is known.
    if (!target.advertisement) env.CONTENT_LENGTH = String(body.size)
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
      removeSpool()
      throw error
    }
    const { child, kill } = spawned
    const ended = spawned.ended.then((end) => {
      release()
      removeSpool()
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

    if (body.data) child.stdin.end(body.data)
    else if (body.file) {
      // Git stopping early (it answered already) only ends this copy.
      pipeline(createReadStream(body.file), child.stdin).catch(() => {})
    } else child.stdin.end()

    const head = await readCgiHeaders(child.stdout)
    if (!head) {
      kill()
      await ended
      return gitText(500, gitMessages.gitFailed)
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
    let stall: NodeJS.Timeout | undefined
    void ended.then(() => {
      if (stall) clearTimeout(stall)
    })
    const answer = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          stdout.on("data", (chunk: Buffer) => {
            if (done) return
            controller.enqueue(new Uint8Array(chunk))
            if ((controller.desiredSize ?? 0) <= 0) {
              stdout.pause()
              // The client must keep taking the answer: one that takes
              // nothing for `answerStallMs` holds a Git process for
              // nothing, so Git is ended and the connection closed.
              stall ??= setTimeout(() => {
                if (done) return
                done = true
                kill()
                outgoing?.destroy()
                controller.error(quietError("The client stopped reading"))
              }, answerStallMs)
            }
          })
          // After "end", or without it when Git was stopped.
          stdout.once("close", () => {
            const whole = stdout.readableEnded
            void ended.then(({ timedOut, signal }) => {
              if (done) return
              done = true
              if (!whole || timedOut || signal === "SIGKILL") {
                // Cut short: the connection is closed rather than the
                // answer ended, so the client sees it is incomplete.
                outgoing?.destroy()
                controller.error(quietError("Git was stopped"))
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
          if (stall) clearTimeout(stall)
          stall = undefined
          stdout.resume()
        },
        cancel() {
          done = true
          if (stall) clearTimeout(stall)
          kill()
        },
      },
      { highWaterMark: 64 * 1024, size: (chunk) => chunk.byteLength },
    )
    return new Response(answer, { status, headers })
  }
}

/**
 * How long a client may take none of an answer before its Git process is
 * ended: 30 seconds. A slow reader that keeps reading keeps going.
 */
export const answerStallSeconds = 30

/** Push bodies being received into files at once, at most 64 MiB each. */
const maxSpooling = 8
/** Of those, how many one agent may be sending (review of GC-2). */
export const maxSpoolingPerAgent = 2

class BadGzipError extends Error {
  override name = "BadGzipError"
}

/** A request body received whole: in memory, in a file, or none. */
interface ReceivedBody {
  size: number
  data?: Buffer
  file?: string
}

/**
 * Receives a request body whole before Git starts: inflated if it was sent
 * with gzip, counted against `limit` after inflating (a small gzip body can
 * hold far more), in memory, or in a new file in `spool`.
 */
async function receiveBody(
  stream: ReadableStream<Uint8Array>,
  options: {
    limit: number
    gzip: boolean
    spool: string | null
    openSpool: (path: string) => NodeJS.WritableStream
  },
): Promise<ReceivedBody> {
  let size = 0
  const chunks: Buffer[] = []
  const counted = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length
      if (size > options.limit) done(new BodyTooLargeError())
      else done(null, chunk)
    },
  })
  const source = Readable.fromWeb(stream)
  const inflate = createGunzip()
  inflate.once("error", () => {})
  const stages: NodeJS.ReadWriteStream[] = options.gzip
    ? [inflate, counted]
    : [counted]
  if (options.spool) mkdirSync(options.spool, { recursive: true, mode: 0o700 })
  const file = options.spool
    ? join(options.spool, `push-${randomBytes(12).toString("hex")}`)
    : null
  try {
    if (file) {
      await pipeline(source, ...stages, options.openSpool(file))
      return { size, file }
    }
    await pipeline(source, ...stages, async (input: AsyncIterable<Buffer>) => {
      for await (const chunk of input) chunks.push(chunk)
    })
    return { size, data: Buffer.concat(chunks) }
  } catch (error) {
    if (file) rmSync(file, { force: true })
    if (error instanceof BodyTooLargeError) throw error
    if ((error as { code?: string }).code?.startsWith("Z_"))
      throw new BadGzipError()
    throw error
  }
}

/**
 * An error that ends an answer on purpose: `@hono/node-server` logs any
 * other as a failure, but takes this code as the client's going (one
 * `info` line), which is what it is or what Shinan did to it.
 */
function quietError(message: string): Error {
  return Object.assign(new Error(message), {
    code: "ERR_STREAM_PREMATURE_CLOSE",
  })
}

function tooLargeMessage(push: boolean): string {
  return push
    ? gitMessages.pushTooLarge(maxPushBodyBytes / 1024 / 1024)
    : gitMessages.fetchTooLarge(maxFetchBodyBytes / 1024 / 1024)
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
