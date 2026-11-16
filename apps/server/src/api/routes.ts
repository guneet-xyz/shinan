import { Hono } from "hono"
import type { Context as HonoContext } from "hono"

import type * as Api from "@shinan/api-client"
import {
  acceptInvitation,
  addToAllowlist,
  changeRole,
  checkAddGitHub,
  createInvitation,
  declineInvitation,
  endAllSignInSessions,
  endSignInSession,
  findInvitation,
  getAccount,
  getInstallation,
  getWorkspace,
  leaveWorkspace,
  listAllowlist,
  listEvents,
  listInvitations,
  listInvitationsForYou,
  listMembers,
  listSecurityLog,
  listSignInSessions,
  pageSize,
  productName,
  removeFromAllowlist,
  removeGitHub,
  removeMember,
  renameWorkspace,
  resendInvitation,
  shinan,
  startSetup,
  withdrawInvitation,
} from "@shinan/core"
import type {
  Context,
  Event,
  Invitation,
  InvitationForYou,
  JobQueue,
  MemberSummary,
  Page,
  RequestInfo,
  SecurityLogEntry,
  SignInSession,
  WorkspaceDetails,
} from "@shinan/core"
import type { Database } from "@shinan/db"

import { BadRequestError, errorResponse, handleError } from "./errors.js"
import { appendHeaders, requirePerson } from "./sign-in.js"
import type { SignedInEnv, SignIn } from "./sign-in.js"

export interface ApiOptions {
  db: Database
  signIn: SignIn
  /** The job queue, for operations that send email. */
  jobs?: JobQueue
  /** The installation's public address, for links in emails. */
  installationUrl?: string
}

/**
 * The REST API under `/api`. Handlers only translate: they read the request,
 * call one core operation, and shape the answer. Permissions and rules are
 * core's (architecture §2.1).
 */
export function createApi({ db, signIn, jobs, installationUrl }: ApiOptions) {
  const api = new Hono()
  api.onError(handleError)

  api.get("/status", (c) => c.json({ status: "ok" } satisfies Api.Status))

  // Public: the sign-in and invitation pages show the installation's name
  // before sign-in (identity §5.2).
  api.get("/installation", async (c) => {
    const installation = await getInstallation(db)
    return c.json({
      name: installation?.name ?? productName,
      signInMethods: { github: signIn.methods.github },
    } satisfies Api.Installation)
  })

  if (signIn.handle) {
    const handle = signIn.handle.bind(signIn)
    api.all("/auth/*", (c) => handle(c.req.raw, requestInfo(c)))
  }

  const asShinan = (c: HonoContext): Context => ({
    db,
    actor: shinan,
    request: requestInfo(c),
    jobs,
    installationUrl,
  })

  // First start (architecture §12): whoever has the setup link printed to
  // the server's log chooses an operator address, and a sign-in link is sent
  // there. An unknown, used or expired setup link answers 404.
  api.post("/setup", async (c) => {
    const body = await readBody(c)
    const email = stringField(body, "email")
    await startSetup(asShinan(c), {
      token: stringField(body, "token"),
      email,
    })
    if (!signIn.sendSetupLink)
      throw new BadRequestError("Sign-in is not set up")
    await signIn.sendSetupLink(c.req.raw, { email })
    return c.body(null, 204)
  })

  // The GitHub sign-in waiting in this browser for an email address.
  api.get("/sign-in/github", async (c) => {
    const pending = await signIn.pendingGitHub?.(c.req.raw)
    if (!pending) {
      return errorResponse(c, 404, { error: "not-found", message: "Not found" })
    }
    return c.json({ login: pending.login } satisfies Api.PendingGitHubSignIn)
  })

  const signedIn = new Hono<SignedInEnv>()
  signedIn.onError(handleError)
  const signInRequired = requirePerson(signIn)
  signedIn.use("/account", signInRequired)
  signedIn.use("/account/*", signInRequired)
  signedIn.use("/invitations/*", signInRequired)
  signedIn.use("/installation/*", signInRequired)
  signedIn.use("/workspaces/*", signInRequired)

  const ctx = (c: HonoContext<SignedInEnv>): Context => ({
    db,
    actor: c.var.person,
    origin: "shinan_action",
    request: requestInfo(c),
    jobs,
    installationUrl,
  })

  signedIn.get("/account", async (c) => {
    const account = await getAccount(ctx(c))
    const github = account.signInMethods.github
    return c.json({
      person: { ...account.person, createdAt: iso(account.person.createdAt) },
      workspaces: account.workspaces.map((w) => ({
        ...w,
        joinedAt: iso(w.joinedAt),
      })),
      signInMethods: {
        email: account.signInMethods.email,
        github: github && { ...github, addedAt: iso(github.addedAt) },
        githubAvailable: signIn.methods.github,
      },
      operator: account.operator,
    } satisfies Api.Account)
  })

  signedIn.get("/account/sessions", async (c) => {
    const sessions = await listSignInSessions(ctx(c))
    return c.json(sessions.map(signInSessionJson))
  })

  // "Sign out everywhere" ends this session too (identity §3.3).
  signedIn.post("/account/sessions/end-all", async (c) => {
    await endAllSignInSessions(ctx(c))
    return c.body(null, 204)
  })

  signedIn.delete("/account/sessions/:sessionId", async (c) => {
    await endSignInSession(ctx(c), { sessionId: c.req.param("sessionId") })
    return c.body(null, 204)
  })

  // Adding GitHub as a sign-in method: core checks first (re-authentication),
  // then the sign-in layer sends the person to GitHub.
  signedIn.post("/account/github", async (c) => {
    const body = await readBody(c)
    const callbackURL = stringField(body, "callbackURL")
    await checkAddGitHub(ctx(c))
    if (!signIn.startGitHubLink) {
      return errorResponse(c, 404, { error: "not-found", message: "Not found" })
    }
    const { url, headers } = await signIn.startGitHubLink(c.req.raw, {
      callbackURL,
    })
    const response = c.json({ url } satisfies Api.Redirect)
    appendHeaders(response.headers, headers)
    return response
  })

  signedIn.delete("/account/github", async (c) => {
    await removeGitHub(ctx(c))
    return c.body(null, 204)
  })

  signedIn.get("/account/invitations", async (c) => {
    const invitations = await listInvitationsForYou(ctx(c))
    return c.json(invitations.map(invitationForYouJson))
  })

  signedIn.post("/account/invitations/:invitationId/accept", async (c) => {
    const accepted = await acceptInvitation(ctx(c), {
      invitationId: c.req.param("invitationId"),
    })
    return c.json(accepted satisfies Api.AcceptedInvitation)
  })

  signedIn.post("/account/invitations/:invitationId/decline", async (c) => {
    await declineInvitation(ctx(c), {
      invitationId: c.req.param("invitationId"),
    })
    return c.body(null, 204)
  })

  // The invitation acceptance page reads and answers an emailed link. The
  // token comes in the body, never in an address (architecture §10.2).
  signedIn.post("/invitations/find", async (c) => {
    const token = stringField(await readBody(c), "token")
    return c.json(invitationForYouJson(await findInvitation(ctx(c), { token })))
  })

  signedIn.post("/invitations/accept", async (c) => {
    const token = stringField(await readBody(c), "token")
    const accepted = await acceptInvitation(ctx(c), { token })
    return c.json(accepted satisfies Api.AcceptedInvitation)
  })

  signedIn.post("/invitations/decline", async (c) => {
    const token = stringField(await readBody(c), "token")
    await declineInvitation(ctx(c), { token })
    return c.body(null, 204)
  })

  signedIn.get("/installation/allowlist", async (c) => {
    const entries = await listAllowlist(ctx(c))
    return c.json(
      entries.map((e) => ({
        ...e,
        addedAt: iso(e.addedAt),
      })) satisfies Api.AllowlistEntry[],
    )
  })

  signedIn.post("/installation/allowlist", async (c) => {
    const email = stringField(await readBody(c), "email")
    await addToAllowlist(ctx(c), { email })
    return c.body(null, 204)
  })

  signedIn.post("/installation/allowlist/remove", async (c) => {
    const email = stringField(await readBody(c), "email")
    await removeFromAllowlist(ctx(c), { email })
    return c.body(null, 204)
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

  signedIn.get("/workspaces/:workspaceId/invitations", async (c) => {
    const invitations = await listInvitations(
      ctx(c),
      c.req.param("workspaceId"),
    )
    return c.json(invitations.map(invitationJson))
  })

  signedIn.post("/workspaces/:workspaceId/invitations", async (c) => {
    const body = await readBody(c)
    const invitation = await createInvitation(ctx(c), {
      workspaceId: c.req.param("workspaceId"),
      email: stringField(body, "email"),
      // Core checks that the role exists.
      role: stringField(body, "role") as Api.Role,
    })
    return c.json(invitationJson(invitation), 201)
  })

  signedIn.post(
    "/workspaces/:workspaceId/invitations/:invitationId/resend",
    async (c) => {
      const invitation = await resendInvitation(ctx(c), {
        workspaceId: c.req.param("workspaceId"),
        invitationId: c.req.param("invitationId"),
      })
      return c.json(invitationJson(invitation))
    },
  )

  signedIn.delete(
    "/workspaces/:workspaceId/invitations/:invitationId",
    async (c) => {
      await withdrawInvitation(ctx(c), {
        workspaceId: c.req.param("workspaceId"),
        invitationId: c.req.param("invitationId"),
      })
      return c.body(null, 204)
    },
  )

  api.route("/", signedIn)
  api.all("*", (c) =>
    errorResponse(c, 404, { error: "not-found", message: "Not found" }),
  )
  return api
}

/**
 * The client's network address and user agent, for the security log. The
 * address is the connecting socket's; reading it from a reverse proxy's
 * headers needs the proxy to be trusted, which deployment configures (M1-6).
 */
function requestInfo(c: HonoContext): RequestInfo {
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

function invitationJson(invitation: Invitation): Api.Invitation {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    state: invitation.state,
    invitedByHandle: invitation.invitedByHandle,
    createdAt: iso(invitation.createdAt),
    expiresAt: iso(invitation.expiresAt),
  }
}

function invitationForYouJson(
  invitation: InvitationForYou,
): Api.InvitationForYou {
  return { ...invitation, expiresAt: iso(invitation.expiresAt) }
}

function signInSessionJson(session: SignInSession): Api.SignInSession {
  return {
    ...session,
    createdAt: iso(session.createdAt),
    lastActiveAt: iso(session.lastActiveAt),
    expiresAt: iso(session.expiresAt),
  }
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
