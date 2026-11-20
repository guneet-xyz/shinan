import { createHash, timingSafeEqual } from "node:crypto"
import type { ServerResponse } from "node:http"
import { Hono } from "hono"
import type { Context, MiddlewareHandler } from "hono"
import { bodyLimit } from "hono/body-limit"

import {
  decodeGitContext,
  GitContextError,
  gitContextHeader,
  gitContextMaxLength,
  InvalidInputError,
  maxConcurrentReads,
  maxDocumentsPerRead,
  maxFileBytes,
  maxQueuedReads,
  maxRequestBodyBytes,
  RuleViolationError,
} from "@shinan/core"
import type {
  DocumentRead,
  GitRequestContext,
  RepositoryFile,
} from "@shinan/core"
import { createLimitedLog, errorSummary } from "@shinan/db"
import type { LimitedLog } from "@shinan/db"
import { GitError } from "@shinan/git"

import type { Journal } from "./journal.js"
import { JournalDamagedError, JournalError } from "./journal.js"
import type { RepositoryGate } from "./prune.js"
import type { Purges } from "./purge.js"
import type { PushService } from "./push/service.js"
import { createSmartHttp } from "./smart-http.js"
import type { GitProcessLimits } from "./smart-http.js"
import type { RepositoryStore } from "./store.js"
import { StoreError } from "./store.js"

export type GitAppEnv = {
  /** The Node.js response, when served by `@hono/node-server`. */
  Bindings: { outgoing?: ServerResponse }
  Variables: { gitContext: GitRequestContext | undefined }
}

/** Compares a request's bearer token with the service token in constant time. */
export function serviceTokenCheck(
  serviceToken: string,
): (authorization: string | undefined) => boolean {
  const expected = createHash("sha256").update(serviceToken).digest()
  return (authorization) => {
    const match = /^Bearer ([^\s]+)$/.exec(authorization ?? "")
    const given = createHash("sha256")
      .update(match?.[1] ?? "")
      .digest()
    // Both sides hashed, so the comparison takes the same time whatever the
    // length of what was sent.
    return timingSafeEqual(expected, given) && match !== null
  }
}

function fail(
  c: Context,
  status: 400 | 401 | 404 | 409 | 413 | 422 | 500 | 503,
  error: string,
  message: string,
) {
  return c.json({ error, message }, status)
}

function bad(message: string): never {
  throw new StoreError(400, "invalid-request", message)
}

function whole(
  value: string | undefined,
  what: string,
  fallback?: number,
): number {
  if (value === undefined && fallback !== undefined) return fallback
  if (value === undefined || !/^\d{1,15}$/.test(value))
    bad(`${what} must be a whole number`)
  return Number(value)
}

async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null)
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    bad("The body must be a JSON object")
  }
  return body as Record<string, unknown>
}

/**
 * Lets at most `running` of the reads that hold repository data (trees,
 * diffs, documents, history) run at once, and holds each one's place until
 * its answer has been sent or its client has gone: an answer waiting on a
 * slow reader still holds its memory. Up to `queued` more wait their turn,
 * and leave the queue if their client goes; past that, 503 with
 * `Retry-After`. An answer not sent within `sendDeadlineMs` (a client that
 * took the headers and stopped reading, or an answer whose reading failed
 * while it waited) is cut off: its connection is closed, which gives up its
 * place.
 */
export function readGate(
  limits: { running: number; queued: number; sendDeadlineMs?: number } = {
    running: maxConcurrentReads,
    queued: maxQueuedReads,
  },
): MiddlewareHandler<GitAppEnv> {
  const sendDeadlineMs = limits.sendDeadlineMs ?? answerSendSeconds * 1000
  let running = 0
  const waiting: (() => void)[] = []
  const release = () => {
    const next = waiting.shift()
    // The place passes straight to the next in line.
    if (next) next()
    else running--
  }
  return async (c, next) => {
    // Without Node's response (tests calling the app directly), a read's
    // place is given up once its answer is made.
    const outgoing = c.env?.outgoing
    if (running >= limits.running) {
      if (waiting.length >= limits.queued) {
        c.header("retry-after", "5")
        return fail(
          c,
          503,
          "busy",
          "The Git container is busy; try again shortly",
        )
      }
      const started = await new Promise<boolean>((resolve) => {
        const start = () => {
          outgoing?.off("close", gone)
          resolve(true)
        }
        const gone = () => {
          const at = waiting.indexOf(start)
          if (at >= 0) waiting.splice(at, 1)
          resolve(false)
        }
        waiting.push(start)
        outgoing?.once("close", gone)
      })
      // The client went while it waited: nothing is read for it.
      if (!started) return fail(c, 503, "gone", "The client went away")
    } else {
      running++
    }
    let held = true
    const done = () => {
      if (!held) return
      held = false
      release()
    }
    if (outgoing?.destroyed) {
      done()
      return fail(c, 503, "gone", "The client went away")
    }
    try {
      await next()
    } catch (error) {
      done()
      throw error
    }
    if (outgoing && !outgoing.writableFinished && !outgoing.destroyed) {
      const deadline = setTimeout(() => outgoing.destroy(), sendDeadlineMs)
      outgoing.once("close", () => {
        clearTimeout(deadline)
        done()
      })
    } else {
      done()
    }
  }
}

/**
 * How long an answer may take to be sent once it has started: 120 seconds,
 * like a push's request body (plan §2.10). A 32 MiB answer needs a reader
 * of under 300 KB/s to miss it.
 */
export const answerSendSeconds = 120

/**
 * The Git container's API (Git-based catalog plan §2.2, D-065), on its own
 * listener in the `git` role, reachable only on the internal `git`
 * network. Every request must carry `Authorization: Bearer <service
 * token>`; any other gets 401 and nothing else: not even the context
 * header is read. The smart HTTP paths under `/git/` are agents' fetches
 * and pushes, which `web` forwards (`smart-http.ts`).
 */
export function createGitApp(options: {
  serviceToken: string
  store: RepositoryStore
  journal: Journal
  log?: LimitedLog
  /** How many reads run and wait at once, and how long an answer may take to send; default `readGate()`'s. */
  readLimits?: { running: number; queued: number; sendDeadlineMs?: number }
  /** How many Git processes serve fetches and pushes at once; default `defaultGitProcessLimits`. */
  gitProcesses?: GitProcessLimits
  /** How long one Git process may run, in seconds; default `gitProcessSeconds`. */
  gitProcessSeconds?: number
  /** How long a client may take none of an answer, in seconds; default `answerStallSeconds`. */
  answerStallSeconds?: number
  /** Opens a push's spool file; tests give one that fails. */
  openSpool?: (path: string) => NodeJS.WritableStream
  /** The push checks (Git-based catalog plan §2.5); without them, the hooks refuse every push. */
  push?: PushService
  /** Purges as history rewrites (plan §2.9). */
  purges?: Purges
  /** Who uses each repository, for the pruner. */
  gate?: RepositoryGate
}) {
  const log = options.log ?? createLimitedLog()
  const authorized = serviceTokenCheck(options.serviceToken)
  const app = new Hono<GitAppEnv>()

  app.onError((error, c) => {
    if (error instanceof StoreError)
      return fail(c, error.status, error.code, error.message)
    if (error instanceof JournalDamagedError) {
      log(`Git API ${c.req.method}: ${error.message}`)
      return fail(c, 500, "journal-damaged", error.message)
    }
    if (error instanceof JournalError)
      return fail(c, 400, "invalid-request", error.message)
    if (error instanceof GitContextError)
      return fail(c, 400, "invalid-context", error.message)
    // A purge text the rules refuse, or one that takes too long to find.
    if (error instanceof InvalidInputError)
      return fail(c, 400, error.rule, error.message)
    if (error instanceof RuleViolationError)
      return fail(c, 422, error.rule, error.message)
    if (error instanceof GitError && error.kind === "start") {
      return fail(c, 400, "invalid-request", error.message)
    }
    log(`Git API ${c.req.method} failed: ${errorSummary(error)}`)
    return fail(c, 500, "failed", "The Git container could not do that")
  })

  const requireServiceToken: MiddlewareHandler<GitAppEnv> = async (c, next) => {
    if (!authorized(c.req.header("authorization"))) {
      return fail(c, 401, "unauthorized", "This needs the service token")
    }
    await next()
  }
  app.use("*", requireServiceToken)

  // The context `web` sends with an agent's request. Read only once the
  // service token has been checked.
  app.use("*", async (c, next) => {
    const value = c.req.header(gitContextHeader)
    if (value !== undefined && value.length > gitContextMaxLength) {
      return c.json(
        {
          error: "context-too-large",
          message: "The context header is too large",
        },
        413,
      )
    }
    c.set(
      "gitContext",
      value === undefined ? undefined : decodeGitContext(value),
    )
    await next()
  })

  const limit = (maxSize: number) =>
    bodyLimit({
      maxSize,
      onError: (c) =>
        fail(c, 413, "too-large", "The request body is too large"),
    })

  const workspace = (c: Context) => c.req.param("workspaceId") ?? ""

  // The minute check of the push log reads a repository's branches.
  app.get("/repositories/:workspaceId/refs", async (c) => {
    const id = workspace(c)
    if (!options.store.exists(id)) return fail(c, 404, "not-found", "Not found")
    if (options.push) return c.json(await options.push.refs(id))
    return fail(c, 404, "not-found", "Not found")
  })

  app.get("/repositories/:workspaceId", async (c) => {
    const main = await options.store.main(workspace(c))
    if (!main) return fail(c, 404, "not-found", "Not found")
    return c.json({ workspaceId: workspace(c), main })
  })

  app.put(
    "/repositories/:workspaceId",
    limit(maxRequestBodyBytes),
    async (c) => {
      const body = await jsonBody(c)
      if (typeof body.message !== "string" || body.message.trim() === "") {
        bad("A first commit needs a message")
      }
      if (!Array.isArray(body.files) || body.files.length > 50_000)
        bad("files must be a list")
      const files: RepositoryFile[] = (body.files as unknown[]).map((file) => {
        const f = file as Record<string, unknown> | null
        if (typeof f?.path !== "string" || typeof f.content !== "string") {
          bad("Each file has a path and base64 content")
        }
        const content = Buffer.from(f.content, "base64")
        if (content.length > maxFileBytes)
          bad(`A file is larger than ${maxFileBytes} bytes`)
        return { path: f.path, content: new Uint8Array(content) }
      })
      const created = await options.store.create(workspace(c), {
        files,
        message: body.message,
      })
      // Its first commit is first pushed by Shinan (plan §2.6).
      if (created.created)
        await options.push?.repositoryCreated(workspace(c), created.main)
      return c.json(
        { workspaceId: workspace(c), ...created },
        created.created ? 201 : 200,
      )
    },
  )

  // The reads that hold repository data take turns.
  const gate = readGate(options.readLimits)
  for (const route of ["tree", "documents", "diff", "history"]) {
    app.use(`/repositories/:workspaceId/${route}`, gate)
  }

  app.get("/repositories/:workspaceId/tree", async (c) => {
    const recursive = c.req.query("recursive")
    if (recursive !== undefined && recursive !== "false")
      bad("recursive is false or absent")
    return c.json(
      await options.store.listTree(workspace(c), {
        commit: c.req.query("commit") ?? "main",
        path: c.req.query("path"),
        recursive: recursive !== "false",
      }),
    )
  })

  app.post(
    "/repositories/:workspaceId/documents",
    limit(1024 * 1024),
    async (c) => {
      const body = await jsonBody(c)
      const paths = body.paths
      if (
        !Array.isArray(paths) ||
        paths.length > maxDocumentsPerRead ||
        !paths.every((p) => typeof p === "string")
      ) {
        bad(`paths must be a list of at most ${maxDocumentsPerRead} paths`)
      }
      const read = await options.store.openDocuments(workspace(c), {
        commit: typeof body.commit === "string" ? body.commit : "main",
        paths,
      })
      // Streamed: each document is read when the answer is ready for it,
      // so a slow reader holds one document's memory, not the response's.
      const encoder = new TextEncoder()
      let first = true
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `{"commit":${JSON.stringify(read.commit)},"documents":[`,
            ),
          )
        },
        async pull(controller) {
          let next: IteratorResult<DocumentRead>
          try {
            next = await read.documents.next()
          } catch (error) {
            // Headers are sent: the only way to say so is to cut the answer
            // off, which also gives up its place in the read gate.
            log(`Git API documents read failed: ${errorSummary(error)}`)
            c.env?.outgoing?.destroy()
            controller.error(new Error("The documents could not be read"))
            return
          }
          if (next.done) {
            controller.enqueue(encoder.encode("]}"))
            controller.close()
            return
          }
          const d = next.value
          const json = JSON.stringify(
            "content" in d
              ? { ...d, content: Buffer.from(d.content).toString("base64") }
              : d,
          )
          controller.enqueue(encoder.encode(first ? json : `,${json}`))
          first = false
        },
        async cancel() {
          await read.documents.return(undefined)
        },
      })
      return c.body(stream, 200, { "content-type": "application/json" })
    },
  )

  app.get("/repositories/:workspaceId/diff", async (c) => {
    const to = c.req.query("to")
    if (!to) bad("to is needed")
    return c.json(
      await options.store.diff(workspace(c), {
        from: c.req.query("from") ?? null,
        to,
      }),
    )
  })

  app.get("/repositories/:workspaceId/history", async (c) => {
    return c.json(
      await options.store.history(workspace(c), {
        commit: c.req.query("commit") ?? "main",
        path: c.req.query("path"),
        limit: whole(c.req.query("limit"), "limit", 50),
        skip: whole(c.req.query("skip"), "skip", 0),
        combined: c.req.query("combined") === "true",
      }),
    )
  })

  // A purge (plan §2.9): its preview reads, the purge rewrites. The text
  // comes in the body and no answer or log line repeats it.
  app.post(
    "/repositories/:workspaceId/purge/preview",
    limit(64 * 1024),
    async (c) => {
      if (!options.purges) return fail(c, 404, "not-found", "Not found")
      const body = await jsonBody(c)
      if (typeof body.text !== "string") bad("text must be a string")
      return c.json(await options.purges.preview(workspace(c), body.text))
    },
  )
  // A purge runs as a job (review of #197): started here, then followed.
  const purgeId = (value: unknown) => {
    if (
      typeof value !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        value,
      )
    )
      bad("purgeId must be a UUID")
    return value
  }
  app.post("/repositories/:workspaceId/purges", limit(64 * 1024), async (c) => {
    if (!options.purges) return fail(c, 404, "not-found", "Not found")
    const body = await jsonBody(c)
    if (typeof body.text !== "string") bad("text must be a string")
    return c.json(
      options.purges.start(workspace(c), {
        purgeId: purgeId(body.purgeId),
        text: body.text,
      }),
      202,
    )
  })
  app.get("/repositories/:workspaceId/purges/:purgeId", (c) => {
    if (!options.purges) return fail(c, 404, "not-found", "Not found")
    return c.json(
      options.purges.status(workspace(c), purgeId(c.req.param("purgeId"))),
    )
  })
  app.post(
    "/repositories/:workspaceId/purges/:purgeId/text",
    limit(64 * 1024),
    async (c) => {
      if (!options.purges) return fail(c, 404, "not-found", "Not found")
      const body = await jsonBody(c)
      if (typeof body.text !== "string") bad("text must be a string")
      return c.json({
        matches: options.purges.isText(
          workspace(c),
          purgeId(c.req.param("purgeId")),
          body.text,
        ),
      })
    },
  )

  app.get("/journal", (c) =>
    c.json({
      journalId: options.journal.id,
      entries: options.journal.read(
        whole(c.req.query("after"), "after", 0),
        whole(c.req.query("limit"), "limit", 100),
      ),
      last: options.journal.last(),
    }),
  )

  app.post("/journal/acknowledge", limit(1024), async (c) => {
    const body = await jsonBody(c)
    if (typeof body.through !== "number") bad("through must be a whole number")
    // Acknowledging another journal's numbers would delete entries never
    // stored.
    if (body.journalId !== undefined && body.journalId !== options.journal.id) {
      return fail(c, 409, "other-journal", "That is not this journal")
    }
    return c.json(options.journal.acknowledge(body.through))
  })

  // Agents' fetches and pushes, forwarded by `web` (plan §2.2, step 6).
  app.all(
    "/git/*",
    createSmartHttp({
      store: options.store,
      log,
      processes: options.gitProcesses,
      processSeconds: options.gitProcessSeconds,
      answerStallSeconds: options.answerStallSeconds,
      openSpool: options.openSpool,
      push: options.push,
      gate: options.gate,
    }),
  )

  app.all("*", (c) => fail(c, 404, "not-found", "Not found"))
  return app
}

/**
 * The `git` role's internal listener for the container's health check
 * (architecture §13): on loopback, never published. Ready when the volume
 * is writable.
 */
export function createGitInternalApp(options: { ready: () => boolean }) {
  const app = new Hono()
  app.get("/healthz", (c) => c.json({ status: "ok" }))
  app.get("/readyz", (c) =>
    options.ready()
      ? c.json({ status: "ok" })
      : c.json({ status: "unavailable" }, 503),
  )
  app.all("*", (c) => c.json({ error: "not-found", message: "Not found" }, 404))
  return app
}
