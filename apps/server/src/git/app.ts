import { createHash, timingSafeEqual } from "node:crypto"
import { Hono } from "hono"
import type { Context, MiddlewareHandler } from "hono"
import { bodyLimit } from "hono/body-limit"

import {
  decodeGitContext,
  GitContextError,
  gitContextHeader,
  gitContextMaxLength,
  maxDocumentsPerRead,
  maxFileBytes,
  maxRequestBodyBytes,
} from "@shinan/core"
import type { GitRequestContext, RepositoryFile } from "@shinan/core"
import { createLimitedLog, errorSummary } from "@shinan/db"
import type { LimitedLog } from "@shinan/db"
import { GitError } from "@shinan/git"

import type { Journal } from "./journal.js"
import { JournalDamagedError, JournalError } from "./journal.js"
import type { RepositoryStore } from "./store.js"
import { StoreError } from "./store.js"

export type GitAppEnv = {
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
  status: 400 | 401 | 404 | 413 | 500,
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
 * The Git container's API (Git-based catalog plan §2.2, D-065), on its own
 * listener in the `git` role, reachable only on the internal `git`
 * network. Every request must carry `Authorization: Bearer <service
 * token>`; any other gets 401 and nothing else: not even the context
 * header is read. The smart HTTP paths join this in GC-2.
 */
export function createGitApp(options: {
  serviceToken: string
  store: RepositoryStore
  journal: Journal
  log?: LimitedLog
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
      return c.json(
        { workspaceId: workspace(c), ...created },
        created.created ? 201 : 200,
      )
    },
  )

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
      const read = await options.store.readDocuments(workspace(c), {
        commit: typeof body.commit === "string" ? body.commit : "main",
        paths,
      })
      return c.json({
        commit: read.commit,
        documents: read.documents.map((d) =>
          "content" in d
            ? { ...d, content: Buffer.from(d.content).toString("base64") }
            : d,
        ),
      })
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
      }),
    )
  })

  app.get("/journal", (c) =>
    c.json({
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
    return c.json(options.journal.acknowledge(body.through))
  })

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
