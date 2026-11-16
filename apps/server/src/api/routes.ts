import { Hono } from "hono"
import type { Context as HonoContext } from "hono"

import type * as Api from "@shinan/api-client"
import {
  changeRole,
  getAccount,
  getInstallation,
  getWorkspace,
  leaveWorkspace,
  listEvents,
  listMembers,
  listSecurityLog,
  pageSize,
  productName,
  removeMember,
  renameWorkspace,
} from "@shinan/core"
import type {
  Context,
  Event,
  MemberSummary,
  Page,
  SecurityLogEntry,
  WorkspaceDetails,
} from "@shinan/core"
import type { Database } from "@shinan/db"

import { BadRequestError, errorResponse, handleError } from "./errors.js"
import { requirePerson } from "./sign-in.js"
import type { SignedInEnv, SignIn } from "./sign-in.js"

export interface ApiOptions {
  db: Database
  signIn: SignIn
}

/**
 * The REST API under `/api`. Handlers only translate: they read the request,
 * call one core operation, and shape the answer. Permissions and rules are
 * core's (architecture §2.1).
 */
export function createApi({ db, signIn }: ApiOptions) {
  const api = new Hono()
  api.onError(handleError)

  api.get("/status", (c) => c.json({ status: "ok" } satisfies Api.Status))

  // Public: the sign-in and invitation pages show the installation's name
  // before sign-in (identity §5.2).
  api.get("/installation", async (c) => {
    const installation = await getInstallation(db)
    return c.json({
      name: installation?.name ?? productName,
    } satisfies Api.Installation)
  })

  if (signIn.handle) {
    const handle = signIn.handle.bind(signIn)
    api.all("/auth/*", (c) => handle(c.req.raw))
  }

  const signedIn = new Hono<SignedInEnv>()
  signedIn.onError(handleError)
  const signInRequired = requirePerson(signIn)
  signedIn.use("/account", signInRequired)
  signedIn.use("/workspaces/*", signInRequired)

  const ctx = (c: HonoContext<SignedInEnv>): Context => ({
    db,
    actor: c.var.person,
    origin: "shinan_action",
    request: requestInfo(c),
  })

  signedIn.get("/account", async (c) => {
    const account = await getAccount(ctx(c))
    return c.json({
      person: { ...account.person, createdAt: iso(account.person.createdAt) },
      workspaces: account.workspaces.map((w) => ({
        ...w,
        joinedAt: iso(w.joinedAt),
      })),
    } satisfies Api.Account)
  })

  signedIn.get("/workspaces/:workspaceId", async (c) => {
    const workspace = await getWorkspace(ctx(c), c.req.param("workspaceId"))
    return c.json(workspaceJson(workspace))
  })

  signedIn.patch("/workspaces/:workspaceId", async (c) => {
    const body = await readBody(c)
    const workspace = await renameWorkspace(ctx(c), {
      workspaceId: c.req.param("workspaceId"),
      name: stringField(body, "name"),
    })
    return c.json(workspaceJson(workspace))
  })

  signedIn.post("/workspaces/:workspaceId/leave", async (c) => {
    await leaveWorkspace(ctx(c), { workspaceId: c.req.param("workspaceId") })
    return c.body(null, 204)
  })

  signedIn.get("/workspaces/:workspaceId/members", async (c) => {
    const members = await listMembers(ctx(c), c.req.param("workspaceId"))
    return c.json(members.map(memberJson))
  })

  signedIn.patch("/workspaces/:workspaceId/members/:memberId", async (c) => {
    const body = await readBody(c)
    const member = await changeRole(ctx(c), {
      workspaceId: c.req.param("workspaceId"),
      memberId: c.req.param("memberId"),
      // Core checks that the role exists.
      role: stringField(body, "role") as Api.Role,
    })
    return c.json(memberJson(member))
  })

  signedIn.delete("/workspaces/:workspaceId/members/:memberId", async (c) => {
    await removeMember(ctx(c), {
      workspaceId: c.req.param("workspaceId"),
      memberId: c.req.param("memberId"),
    })
    return c.body(null, 204)
  })

  signedIn.get("/workspaces/:workspaceId/events", async (c) => {
    const page = readPage(c)
    const events = await listEvents(ctx(c), c.req.param("workspaceId"), page)
    return c.json(pageJson(events, page, eventJson))
  })

  signedIn.get("/workspaces/:workspaceId/security-log", async (c) => {
    const page = readPage(c)
    const entries = await listSecurityLog(
      ctx(c),
      c.req.param("workspaceId"),
      page,
    )
    return c.json(pageJson(entries, page, securityLogEntryJson))
  })

  // Invitations belong to sign-in and accounts (M1-4), which replaces these.
  // Until then the routes exist so the web app can say so plainly.
  signedIn.all("/workspaces/:workspaceId/invitations", notImplemented)
  signedIn.all("/workspaces/:workspaceId/invitations/*", notImplemented)

  api.route("/", signedIn)
  api.all("*", (c) =>
    errorResponse(c, 404, { error: "not-found", message: "Not found" }),
  )
  return api
}

function notImplemented(c: HonoContext) {
  return errorResponse(c, 501, {
    error: "not-implemented",
    message: "Invitations are not available yet",
  })
}

/**
 * The client's network address and user agent, for the security log. The
 * address is the connecting socket's; reading it from a reverse proxy's
 * headers needs the proxy to be trusted, which deployment configures (M1-6).
 */
function requestInfo(c: HonoContext): Context["request"] {
  const env = c.env as
    { incoming?: { socket?: { remoteAddress?: string } } } | undefined
  return {
    networkAddress: env?.incoming?.socket?.remoteAddress,
    client: c.req.header("user-agent"),
  }
}

async function readBody(c: HonoContext): Promise<Record<string, unknown>> {
  const body = (await c.req.json().catch(() => {
    throw new BadRequestError("The request body must be JSON")
  })) as unknown
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("The request body must be a JSON object")
  }
  return body as Record<string, unknown>
}

function stringField(body: Record<string, unknown>, field: string): string {
  const value = body[field]
  if (typeof value !== "string") {
    throw new BadRequestError(`"${field}" must be a string`)
  }
  return value
}

function readPage(c: HonoContext): Page {
  return {
    before: integerQuery(c, "before"),
    limit: integerQuery(c, "limit"),
  }
}

function integerQuery(c: HonoContext, name: string): number | undefined {
  const value = c.req.query(name)
  if (value === undefined) return undefined
  const number = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number)) {
    throw new BadRequestError(`"${name}" must be a whole number`)
  }
  return number
}

/** A full page means there may be older entries. */
function pageJson<T extends { id: number }, J>(
  rows: T[],
  page: Page,
  toJson: (row: T) => J,
): Api.Page<J> {
  return {
    entries: rows.map(toJson),
    next: rows.length === pageSize(page) ? rows[rows.length - 1]!.id : null,
  }
}

function iso(date: Date): string {
  return date.toISOString()
}

function workspaceJson(workspace: WorkspaceDetails): Api.Workspace {
  return {
    id: workspace.id,
    name: workspace.name,
    createdAt: iso(workspace.createdAt),
    role: workspace.role,
  }
}

function memberJson(member: MemberSummary): Api.Member {
  return { ...member, joinedAt: iso(member.joinedAt) }
}

function eventJson(event: Event): Api.Event {
  return {
    id: event.id,
    occurredAt: iso(event.occurredAt),
    kind: event.kind,
    origin: event.origin,
    actorKind: event.actorKind,
    actorPersonId: event.actorPersonId,
    actorAgentId: event.actorAgentId,
    actorAgentSessionId: event.actorAgentSessionId,
    actorLabel: event.actorLabel,
    confidence: event.confidence,
    subjects: event.subjects,
    summary: event.summary,
    data: event.data,
    link: event.link,
  }
}

function securityLogEntryJson(entry: SecurityLogEntry): Api.SecurityLogEntry {
  return {
    id: entry.id,
    occurredAt: iso(entry.occurredAt),
    action: entry.action,
    outcome: entry.outcome,
    actorKind: entry.actorKind,
    actorPersonId: entry.actorPersonId,
    actorAgentId: entry.actorAgentId,
    actorAgentSessionId: entry.actorAgentSessionId,
    actorLabel: entry.actorLabel,
    confidence: entry.confidence,
    subjectPersonId: entry.subjectPersonId,
    subjectHandle: entry.subjectHandle,
    networkAddress: entry.networkAddress,
    client: entry.client,
    details: entry.details,
  }
}
