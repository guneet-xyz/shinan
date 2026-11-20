import { Hono } from "hono"
import type { Context as HonoContext } from "hono"
import { bodyLimit } from "hono/body-limit"

import type * as Api from "@shinan/api-client"
import {
  acceptInvitation,
  addToAllowlist,
  cancelEmailChange,
  changeRole,
  checkAddGitHub,
  clientDescription,
  confirmEmailChange,
  createAgentToken,
  createInvitation,
  createWorkspace,
  declineInvitation,
  disableAgent,
  enableAgent,
  endAllSignInSessions,
  endSignInSession,
  findInvitation,
  getAccount,
  getCatalogIndexHealth,
  getConnectedAgent,
  getEmailChange,
  getInstallation,
  getWorkspace,
  issueAgentToken,
  leaveWorkspace,
  listAgents,
  listAllowlist,
  listEvents,
  listInvitations,
  listInvitationsForYou,
  listMembers,
  listSecurityLog,
  listSignInSessions,
  listYourAgents,
  pageSize,
  productName,
  removeFromAllowlist,
  removeGitHub,
  removeMember,
  renameAgent,
  renameWorkspace,
  requestEmailChange,
  resendInvitation,
  revokeAgentToken,
  shinan,
  startSetup,
  withdrawInvitation,
} from "@shinan/core"
import type {
  Agent,
  Context,
  Event,
  Invitation,
  InvitationForYou,
  IssuedToken,
  JobQueue,
  MemberSummary,
  Page,
  RequestInfo,
  SecurityLogEntry,
  SignInSession,
  WorkspaceDetails,
} from "@shinan/core"
import type { Database } from "@shinan/db"

import { clientAddress, noTrustedProxies } from "../client-address.js"
import type { TrustedProxies } from "../client-address.js"
import { rateLimited, sameOriginOnly } from "../security.js"
import { isSafeReturnPath } from "../sign-in/paths.js"
import { requireAgent } from "./agent-auth.js"
import type { AgentEnv } from "./agent-auth.js"
import { catalogRoutes } from "./catalog.js"
import { BadRequestError, errorHandler, errorResponse } from "./errors.js"
import { appendHeaders, requirePerson } from "./sign-in.js"
import type { SignedInEnv, SignIn } from "./sign-in.js"

/** The largest request body the API reads: 64 KB. */
export const requestBodyLimit = 64 * 1024

export interface ApiOptions {
  db: Database
  signIn: SignIn
  /** The job queue, for operations that send email. */
  jobs?: JobQueue
  /**
   * The installation's public address, for links in emails. State-changing
   * requests must come from this origin (or, without it, the request's own).
   */
  installationUrl?: string
  /** Proxies whose `X-Forwarded-For` gives the client's address. */
  trustedProxies?: TrustedProxies
  /** Per-address rate limits (architecture §10.1); on unless turned off. */
  rateLimit?: boolean
}

/**
 * Reads what the security log records about a request (identity §11): the
 * client's network address, through trusted proxies only, and its client.
 */
export function requestInfoFor(
  trustedProxies: TrustedProxies,
): (c: HonoContext) => RequestInfo {
  return (c) => {
    const env = c.env as
      { incoming?: { socket?: { remoteAddress?: string } } } | undefined
    const client = c.req.header("user-agent")
    return {
      networkAddress: clientAddress(
        env?.incoming?.socket?.remoteAddress,
        c.req.header("x-forwarded-for"),
        trustedProxies,
      ),
      client:
        client === undefined
          ? undefined
          : (clientDescription(client) ?? undefined),
    }
  }
}

/**
 * The REST API under `/api`. Handlers only translate: they read the request,
 * call one core operation, and shape the answer. Permissions and rules are
 * core's (architecture §2.1).
 */
export function createApi({
  db,
  signIn,
  jobs,
  installationUrl,
  trustedProxies = noTrustedProxies,
  rateLimit = true,
}: ApiOptions) {
  const api = new Hono()
  const onError = errorHandler()
  api.onError(onError)

  const requestInfo = requestInfoFor(trustedProxies)

  // Answers carry personal data; no browser or proxy keeps them.
  api.use("*", async (c, next) => {
    await next()
    if (!c.res.headers.has("cache-control")) {
      c.res.headers.set("cache-control", "no-store")
    }
  })
  // The minimal public health check (identity §10): a constant answer,
  // ahead of the rate limits, so it reads and writes nothing and says
  // nothing about the database.
  api.get("/status", (c) => c.json({ status: "ok" } satisfies Api.Status))

  // Every API request body is small (forms of a few fields); a larger one is
  // refused before it is read in full.
  const limitBody = bodyLimit({
    maxSize: requestBodyLimit,
    onError: (c) =>
      errorResponse(c, 413, {
        error: "payload-too-large",
        message: "The request is too large",
      }),
  })
  const allMethods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]

  // Agent endpoints (identity §7.4): an agent token in the Authorization
  // header, never a sign-in cookie. They come before the same-origin check
  // and answer every path under them, so only they skip it: a request with
  // a cookie is refused here instead, so a browser's sign-in can never
  // reach them. `GET /api/agent` tells an agent, and the person setting it
  // up, whether its token works and what it allows.
  const agentApi = new Hono<AgentEnv>()
  agentApi.onError(onError)
  if (rateLimit) {
    agentApi.use("*", rateLimited(db, "api", requestInfo, allMethods))
  }
  agentApi.use("*", limitBody)
  agentApi.use("*", requireAgent({ db, installationUrl, requestInfo }))
  agentApi.get("/", async (c) => {
    const connected = await getConnectedAgent({
      db,
      actor: c.var.agent,
      origin: "shinan_action",
      request: requestInfo(c),
    })
    return c.json(connected satisfies Api.ConnectedAgent)
  })
  agentApi.all("*", (c) =>
    errorResponse(c, 404, { error: "not-found", message: "Not found" }),
  )
  api.route("/agent", agentApi)

  api.use("*", sameOriginOnly(installationUrl))
  if (rateLimit) {
    const limit = (
      path: string,
      name: Parameters<typeof rateLimited>[1],
      methods?: readonly string[],
    ) => api.use(path, rateLimited(db, name, requestInfo, methods))
    limit("*", "api", allMethods)
    limit("/auth/sign-in/magic-link", "sign-in-link")
    limit("/setup", "sign-in-link")
    limit("/sign-in/link", "sign-in-link-open")
    limit("/auth/sign-in/social", "github-sign-in")
    limit("/auth/callback/github", "github-sign-in", ["GET"])
    limit("/account/github", "github-sign-in")
    limit("/invitations/find", "invitation-token")
    limit("/invitations/accept", "invitation-token")
    limit("/invitations/decline", "invitation-token")
    limit("/account/email-change/confirm", "sign-in-link-open")
  }
  api.use("*", limitBody)

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
    await signIn.sendSetupLink(c.req.raw, requestInfo(c), { email })
    return c.body(null, 204)
  })

  // The confirm page of an emailed sign-in link: one click opens it. The
  // token comes in the body, so it is in no address (architecture §10.2).
  api.post("/sign-in/link", async (c) => {
    const body = await readBody(c)
    const token = stringField(body, "token")
    const callbackURL = returnPath(stringField(body, "next"))
    if (!signIn.openLink) {
      return errorResponse(c, 404, { error: "not-found", message: "Not found" })
    }
    const { location, headers } = await signIn.openLink(
      c.req.raw,
      requestInfo(c),
      { token, callbackURL },
    )
    const response = c.json({ location } satisfies Api.SignInLinkOpened)
    appendHeaders(response.headers, headers)
    return response
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
  signedIn.onError(onError)
  const signInRequired = requirePerson(signIn)
  signedIn.use("/account", signInRequired)
  signedIn.use("/account/*", signInRequired)
  signedIn.use("/invitations/*", signInRequired)
  signedIn.use("/installation/*", signInRequired)
  signedIn.use("/workspaces", signInRequired)
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
    const pendingEmailChange = await getEmailChange(ctx(c))
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
      pendingEmailChange: pendingEmailChange && {
        email: pendingEmailChange.email,
        expiresAt: iso(pendingEmailChange.expiresAt),
      },
    } satisfies Api.Account)
  })

  // Changing one's email address (identity §3.4): asked for with
  // re-authentication, confirmed from the link sent to the new address,
  // whose token comes in the body, never in an address.
  signedIn.post("/account/email-change", async (c) => {
    const email = stringField(await readBody(c), "email")
    const pending = await requestEmailChange(ctx(c), { email })
    return c.json({
      email: pending.email,
      expiresAt: iso(pending.expiresAt),
    } satisfies Api.PendingEmailChange)
  })

  signedIn.delete("/account/email-change", async (c) => {
    await cancelEmailChange(ctx(c))
    return c.body(null, 204)
  })

  signedIn.post("/account/email-change/confirm", async (c) => {
    const token = stringField(await readBody(c), "token")
    return c.json(await confirmEmailChange(ctx(c), { token }))
  })

  signedIn.get("/account/sessions", async (c) => {
    const sessions = await listSignInSessions(ctx(c))
    return c.json(sessions.map(signInSessionJson))
  })

  // "Sign out everywhere" ends this session too (identity §3.3), and
  // revokes the person's agent tokens if they ask (§7.5).
  signedIn.post("/account/sessions/end-all", async (c) => {
    const body = await readOptionalBody(c)
    await endAllSignInSessions(ctx(c), {
      revokeAgentTokens: booleanField(body, "revokeAgentTokens"),
    })
    return c.body(null, 204)
  })

  signedIn.get("/account/agents", async (c) => {
    const agents = await listYourAgents(ctx(c))
    return c.json(agents.map(agentJson))
  })

  signedIn.delete("/account/sessions/:sessionId", async (c) => {
    await endSignInSession(ctx(c), { sessionId: c.req.param("sessionId") })
    return c.body(null, 204)
  })

  // Adding GitHub as a sign-in method: core checks first (re-authentication),
  // then the sign-in layer sends the person to GitHub.
  signedIn.post("/account/github", async (c) => {
    const body = await readBody(c)
    const callbackURL = returnPath(stringField(body, "callbackURL"))
    await checkAddGitHub(ctx(c))
    if (!signIn.startGitHubLink) {
      return errorResponse(c, 404, { error: "not-found", message: "Not found" })
    }
    const { url, headers } = await signIn.startGitHubLink(
      c.req.raw,
      requestInfo(c),
      { callbackURL },
    )
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

  signedIn.get("/installation/catalog-index", async (c) => {
    const health = await getCatalogIndexHealth(ctx(c))
    return c.json(health satisfies Api.CatalogIndexHealth)
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

  // Any person may create a workspace and becomes its first workspace owner
  // (identity §4).
  signedIn.post("/workspaces", async (c) => {
    const body = await readBody(c)
    const { workspace } = await createWorkspace(ctx(c), {
      name: stringField(body, "name"),
    })
    return c.json(workspaceJson(await getWorkspace(ctx(c), workspace.id)), 201)
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

  signedIn.get("/workspaces/:workspaceId/agents", async (c) => {
    const agents = await listAgents(ctx(c), c.req.param("workspaceId"))
    return c.json(agents.map(agentJson))
  })

  // A token made by hand (identity §6.2), shown in this answer only.
  signedIn.post("/workspaces/:workspaceId/agents", async (c) => {
    const body = await readBody(c)
    const issued = await createAgentToken(ctx(c), {
      workspaceId: c.req.param("workspaceId"),
      codingTool: stringField(body, "codingTool"),
      machine: stringField(body, "machine"),
      name: optionalStringField(body, "name"),
      // Core checks the access and the entity ID.
      access: stringField(body, "access") as Api.TokenAccess,
      machineEntityId: optionalStringField(body, "machineEntityId"),
    })
    return c.json(issuedTokenJson(issued), 201)
  })

  signedIn.patch("/workspaces/:workspaceId/agents/:agentId", async (c) => {
    const body = await readBody(c)
    const agent = await renameAgent(ctx(c), {
      workspaceId: c.req.param("workspaceId"),
      agentId: c.req.param("agentId"),
      name: stringField(body, "name"),
    })
    return c.json(agentJson(agent))
  })

  signedIn.post("/workspaces/:workspaceId/agents/:agentId/token", async (c) => {
    const body = await readBody(c)
    const issued = await issueAgentToken(ctx(c), {
      workspaceId: c.req.param("workspaceId"),
      agentId: c.req.param("agentId"),
      access: stringField(body, "access") as Api.TokenAccess,
    })
    return c.json(issuedTokenJson(issued), 201)
  })

  signedIn.delete(
    "/workspaces/:workspaceId/agents/:agentId/token",
    async (c) => {
      const agent = await revokeAgentToken(ctx(c), {
        workspaceId: c.req.param("workspaceId"),
        agentId: c.req.param("agentId"),
      })
      return c.json(agentJson(agent))
    },
  )

  signedIn.post(
    "/workspaces/:workspaceId/agents/:agentId/disable",
    async (c) => {
      const agent = await disableAgent(ctx(c), {
        workspaceId: c.req.param("workspaceId"),
        agentId: c.req.param("agentId"),
      })
      return c.json(agentJson(agent))
    },
  )

  signedIn.post(
    "/workspaces/:workspaceId/agents/:agentId/enable",
    async (c) => {
      const agent = await enableAgent(ctx(c), {
        workspaceId: c.req.param("workspaceId"),
        agentId: c.req.param("agentId"),
      })
      return c.json(agentJson(agent))
    },
  )

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

  catalogRoutes(signedIn, ctx)

  api.route("/", signedIn)
  api.all("*", (c) =>
    errorResponse(c, 404, { error: "not-found", message: "Not found" }),
  )
  return api
}

/** A path on this site to return to, as received; anything else is 422. */
function returnPath(value: string): string {
  if (!isSafeReturnPath(value, "http://localhost")) {
    throw new BadRequestError("The return path must be a path on this site")
  }
  return value
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

/** A JSON object body, or an empty one when the request has no body. */
async function readOptionalBody(
  c: HonoContext,
): Promise<Record<string, unknown>> {
  const text = await c.req.text()
  if (text.trim() === "") return {}
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new BadRequestError("The request body must be JSON")
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("The request body must be a JSON object")
  }
  return body as Record<string, unknown>
}

function optionalStringField(
  body: Record<string, unknown>,
  field: string,
): string | undefined {
  return body[field] === undefined || body[field] === null
    ? undefined
    : stringField(body, field)
}

function booleanField(body: Record<string, unknown>, field: string): boolean {
  const value = body[field] ?? false
  if (typeof value !== "boolean") {
    throw new BadRequestError(`"${field}" must be true or false`)
  }
  return value
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

function agentJson(agent: Agent): Api.Agent {
  const { token } = agent
  return {
    ...agent,
    createdAt: iso(agent.createdAt),
    disabledAt: agent.disabledAt && iso(agent.disabledAt),
    token: token && {
      ...token,
      createdAt: iso(token.createdAt),
      firstUsedAt: token.firstUsedAt && iso(token.firstUsedAt),
      lastUsedAt: token.lastUsedAt && iso(token.lastUsedAt),
    },
  }
}

function issuedTokenJson(issued: IssuedToken): Api.IssuedAgentToken {
  return { ...issued, agent: agentJson(issued.agent) }
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
