import type {
  CatalogEntityAnswer,
  CatalogList,
  CatalogListAnswer,
  CatalogSearchAnswer,
  CatalogTypeIndexAnswer,
  CatalogTypeSchemaAnswer,
  CatalogTypeSchemasAnswer,
  EntityStatus,
  StartHereAnswer,
} from "./catalog.js"

export { sameSitePath } from "./paths.js"
export * from "./catalog.js"

// The REST API's contract, shared by the web app, CLI and plugin. Times are
// ISO 8601 strings; IDs of records are UUIDs, except event and security-log
// IDs, which are numbers used as page cursors.

export interface Status {
  status: "ok"
}

/** Workspace roles (D-045): there is no viewer role. */
export type Role = "owner" | "contributor"

export const roles: readonly Role[] = ["owner", "contributor"]

/** The installation's public details, shown before sign-in. */
export interface Installation {
  name: string
  /** Sign-in methods offered besides email magic links. */
  signInMethods: { github: boolean }
}

export interface Account {
  person: {
    id: string
    handle: string
    name: string
    email: string
    createdAt: string
  }
  /** The workspaces the person belongs to, with their role in each. */
  workspaces: AccountWorkspace[]
  /** How the person signs in (identity §3.1). */
  signInMethods: {
    /** Magic links go to this address. */
    email: string
    /** The linked GitHub account, if any. */
    github: { accountId: string; login: string | null; addedAt: string } | null
    /** Whether this installation offers GitHub sign-in at all. */
    githubAvailable: boolean
  }
  /** Whether the person is an installation operator. */
  operator: boolean
  /** A change of address waiting for its link (identity §3.4), if any. */
  pendingEmailChange: PendingEmailChange | null
}

/** A change of email address waiting for the link sent to the new address. */
export interface PendingEmailChange {
  email: string
  expiresAt: string
}

/** One of the person's sign-in sessions (identity §3.3). */
export interface SignInSession {
  id: string
  createdAt: string
  lastActiveAt: string
  expiresAt: string
  networkAddress: string | null
  /** The user agent the session started with. */
  client: string | null
  /** A short description of the browser, such as "Firefox on Linux". */
  browser: string
  /** The session of this browser. */
  current: boolean
}

/** A GitHub sign-in waiting for its email address (identity §3.2). */
export interface PendingGitHubSignIn {
  login: string | null
}

/** A sign-in link was opened: where to go next. */
export interface SignInLinkOpened {
  /** A path on this site, such as `/w/1` or `/sign-in?error=…`. */
  location: string
}

/** Where to send the browser next. */
export interface Redirect {
  url: string
}

/**
 * The agent index's health, for installation operators (architecture §5.3):
 * per workspace, the commit of `main` its index stands at, whether it is
 * behind, and the last round-trip check. IDs and counts only, never
 * catalog content.
 */
export interface CatalogIndexHealth {
  /** The parser version of this release. */
  parserVersion: number
  workspaces: {
    workspaceId: string
    /** The commit of `main` the index stands at; null before its first build. */
    commit: string | null
    /** The latest commit of `main` Shinan knows of. */
    mainCommit: string | null
    parserVersion: number
    behind: boolean
    rebuildRequestedAt: string | null
    rebuiltAt: string | null
    checkedAt: string | null
    checkedCommit: string | null
    /** Documents whose stored index differed from their text at the last check. */
    checkDifferences: number | null
    /**
     * Why the last build or check failed, as a fixed code (such as
     * `tree-too-large` or `git-busy`), if it did since one succeeded.
     */
    failure: string | null
    failedAt: string | null
  }[]
}

/** An address on the installation's email allowlist (identity §3.2). */
export interface AllowlistEntry {
  email: string
  addedAt: string
  /** Named as an operator in the installation's configuration. */
  operator: boolean
  /** The handle of the person with this address, once they have an account. */
  handle: string | null
}

export interface AccountWorkspace {
  id: string
  name: string
  role: Role
  memberId: string
  joinedAt: string
}

/** A workspace as one of its members sees it. */
export interface Workspace {
  id: string
  name: string
  createdAt: string
  /** The reader's own role in the workspace. */
  role: Role
}

export interface Member {
  id: string
  personId: string
  handle: string
  name: string
  role: Role
  joinedAt: string
  invitedByHandle: string | null
  /** The agents of this membership, enabled or not. */
  agents: AgentLabel[]
}

/**
 * The scopes a token is issued with (identity §7.2): all five, or only the
 * two `read` scopes.
 */
export type TokenAccess = "full" | "read-only"

/** An agent's working token: never the token itself, only its use. */
export interface AgentToken {
  id: string
  access: TokenAccess
  scopes: string[]
  createdAt: string
  firstUsedAt: string | null
  lastUsedAt: string | null
  lastNetworkAddress: string | null
  requestCount: number
  /** Not used for 30 days (identity §7.3). */
  unused: boolean
}

/** One member's coding tool on one machine (identity §6.1). */
export interface Agent {
  id: string
  workspaceId: string
  workspaceName: string
  memberId: string
  personId: string
  personHandle: string
  personName: string
  codingTool: string
  machine: string
  /** `<coding tool>-<machine>`; never changes. */
  handle: string
  name: string
  machineEntityId: string | null
  enabled: boolean
  createdAt: string
  disabledAt: string | null
  /** The token that works now, if any. */
  token: AgentToken | null
}

/** An agent as shown beside its member. */
export interface AgentLabel {
  id: string
  handle: string
  name: string
  enabled: boolean
}

/** A token made by hand: shown in this answer only, never again. */
export interface IssuedAgentToken {
  agent: Agent
  token: string
  /** Whether the agent was registered for this token. */
  agentCreated: boolean
  /** Whether the agent's earlier token was revoked by this one. */
  replacedToken: boolean
}

/** What `GET /api/agent` tells an agent about itself. */
export interface ConnectedAgent {
  agent: {
    id: string
    handle: string
    name: string
    codingTool: string
    machine: string
  }
  person: { handle: string; name: string }
  workspace: { id: string; name: string }
  role: Role
  access: TokenAccess
  scopes: string[]
}

export interface NewAgentToken {
  codingTool: string
  machine: string
  name?: string
  access: TokenAccess
  /** A `machine` catalog entity, such as `machine/daedalus`. */
  machineEntityId?: string
}

export type ActorKind = "person" | "agent" | "shinan" | "outside" | "unknown"
export type Confidence = "recorded" | "marked" | "inferred" | "unknown"

/** Who did something, as events and the security log record it. */
export interface ActorFields {
  actorKind: ActorKind
  actorPersonId: string | null
  actorAgentId: string | null
  actorAgentSessionId: string | null
  /** The actor's written form at the time (identity §8.7). */
  actorLabel: string
  confidence: Confidence
}

export interface Event extends ActorFields {
  id: number
  occurredAt: string
  kind: string
  origin:
    | "shinan_action"
    | "webhook"
    | "reconciliation"
    | "plugin_report"
    | "mcp_call"
  subjects: { type: string; id: string }[]
  summary: string
  data: Record<string, unknown>
  link: string | null
}

export interface SecurityLogEntry extends ActorFields {
  id: number
  occurredAt: string
  action: string
  outcome: "succeeded" | "refused" | "failed"
  subjectPersonId: string | null
  subjectHandle: string | null
  /** Hidden (null) on other people's entries shown to a contributor. */
  networkAddress: string | null
  client: string | null
  details: Record<string, unknown>
}

/** How many records a catalog purge changed, by kind (catalog §9). */
export interface CatalogPurgeCounts {
  revisionTexts: number
  documents: number
  latestDocuments: number
  proposals: number
  rejectedProposals: number
  events: number
  comments: number
}

/** Where a text is in a workspace's catalog, before purging it. */
export interface CatalogPurgePreview {
  /** Stored document texts that hold it, counting each revision. */
  revisionTexts: number
  documents: number
  /** Catalog IDs of documents whose latest text holds it. */
  latestDocuments: string[]
  proposals: number
  /** Waiting catalog proposals that hold it: the purge rejects them. */
  waitingProposals: number
  events: number
  /** Comments on catalog proposals that hold it. */
  comments: number
  /** Stored texts (and current pages) where a match crosses a line break. */
  acrossLines: { revisionTexts: number; latestDocuments: string[] }
  /** Copies in encoded forms the purge does not reach; `text` is the form to purge. */
  alsoWrittenAs: {
    form: "url" | "percent" | "html" | "escaped"
    text: string
    revisionTexts: number
    proposals: number
    events: number
    comments: number
  }[]
  /** Where purging would change a document's structure. */
  structure: { id: string; where: "id" | "alias" | "key" | "frontmatter" }[]
}

/** A catalog purge: who, when, why and how much, never the purged text. */
export interface CatalogPurge {
  id: string
  number: number
  createdAt: string
  purgedBy: string
  reason: string
  /** The catalog revision that stored the cleaned latest text, if any. */
  revision: number | null
  counts: CatalogPurgeCounts
  /** Documents the purge left reading with new problems: only in the purge's own answer. */
  newProblems?: { id: string; problems: string[] }[]
}

export type InvitationState =
  "pending" | "accepted" | "declined" | "expired" | "withdrawn"

/** An invitation to join a workspace, as its owners see it (§5.2). */
export interface Invitation {
  id: string
  email: string
  role: Role
  state: InvitationState
  invitedByHandle: string
  createdAt: string
  expiresAt: string
}

/** An invitation as the invited person sees it (identity §5.2). */
export interface InvitationForYou {
  id: string
  workspaceId: string
  workspaceName: string
  invitedByHandle: string
  role: Role
  expiresAt: string
}

export interface AcceptedInvitation {
  workspaceId: string
  memberId: string
}

/** One page of a list that is read newest first. */
export interface Page<T> {
  entries: T[]
  /** Pass as `before` to read the next (older) page; null on the last. */
  next: number | null
}

export interface PageRequest {
  before?: number
  limit?: number
}

/**
 * Error codes in API error bodies (`{ error, message, rule?, reason? }`):
 * - `sign-in-required` (401): nobody is signed in;
 * - `invalid-token` (401): an agent endpoint got no working agent token, the
 *   same answer whatever was wrong with it;
 * - `reauthentication-required` (403): the action needs a recent sign-in;
 * - `forbidden` (403): the role or kind of actor does not allow it (`reason`);
 * - `not-found` (404): it does not exist, or the requester may not know it does;
 * - `conflict` (409): it breaks a rule given the current state (`rule`);
 * - `invalid-input` (422): the input itself is malformed (`rule`);
 * - `payload-too-large` (413): the request body is over the limit;
 * - `too-many-requests` (429): too many attempts; wait and try again;
 * - `not-implemented` (501): the server does not offer this;
 * - `internal` (500): anything else; details are only in the server's log.
 */
export type ErrorCode =
  | "sign-in-required"
  | "invalid-token"
  | "reauthentication-required"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "invalid-input"
  | "too-many-requests"
  | "payload-too-large"
  | "length-required"
  | "not-implemented"
  | "internal"

export interface ErrorBody {
  error: ErrorCode
  message: string
  rule?: string
  reason?: string
}

export interface ApiClientOptions {
  /** Base URL of the Shinan server. Defaults to the current origin. */
  baseUrl?: string
  fetch?: typeof globalThis.fetch
}

export class ApiError extends Error {
  readonly code: ErrorCode | undefined
  readonly rule: string | undefined
  readonly reason: string | undefined

  constructor(
    readonly status: number,
    message: string,
    body?: Partial<ErrorBody>,
  ) {
    super(body?.message ?? message)
    this.name = "ApiError"
    this.code = body?.error
    this.rule = body?.rule
    this.reason = body?.reason
  }
}

type Method = "GET" | "POST" | "PATCH" | "DELETE"

export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = options.baseUrl ?? ""
  const fetchImpl = options.fetch ?? globalThis.fetch

  async function request<T>(
    method: Method,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" }
    if (body !== undefined) headers["content-type"] = "application/json"
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    })
    if (!response.ok) {
      throw new ApiError(
        response.status,
        `${method} ${path} failed with ${response.status}`,
        await readErrorBody(response),
      )
    }
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  const workspace = (id: string) => `/api/workspaces/${encodeURIComponent(id)}`
  const catalog = (id: string) => `${workspace(id)}/catalog`
  const agentPath = (workspaceId: string, agentId: string) =>
    `${workspace(workspaceId)}/agents/${encodeURIComponent(agentId)}`

  return {
    status: () => request<Status>("GET", "/api/status"),
    installation: () => request<Installation>("GET", "/api/installation"),

    // Sign-in, served by the sign-in layer under /api/auth with the routes of
    // Better Auth's magic link and social sign-in.
    requestSignInLink: (input: {
      email: string
      callbackURL: string
      /** Set by the GitHub email step, to link the waiting GitHub sign-in. */
      metadata?: { github: true }
    }) =>
      request<unknown>("POST", "/api/auth/sign-in/magic-link", input).then(
        () => undefined,
      ),
    startGitHubSignIn: (input: { callbackURL: string }) =>
      request<{ url: string }>("POST", "/api/auth/sign-in/social", {
        provider: "github",
        callbackURL: input.callbackURL,
      }),
    signOut: () =>
      request<unknown>("POST", "/api/auth/sign-out", {}).then(() => undefined),

    openSignInLink: (input: { token: string; next: string }) =>
      request<SignInLinkOpened>("POST", "/api/sign-in/link", input),
    pendingGitHubSignIn: () =>
      request<PendingGitHubSignIn>("GET", "/api/sign-in/github"),
    startSetup: (input: { token: string; email: string }) =>
      request<void>("POST", "/api/setup", input),

    account: () => request<Account>("GET", "/api/account"),
    signInSessions: () =>
      request<SignInSession[]>("GET", "/api/account/sessions"),
    endSignInSession: (sessionId: string) =>
      request<void>(
        "DELETE",
        `/api/account/sessions/${encodeURIComponent(sessionId)}`,
      ),
    signOutEverywhere: (options: { revokeAgentTokens?: boolean } = {}) =>
      request<void>("POST", "/api/account/sessions/end-all", {
        revokeAgentTokens: options.revokeAgentTokens ?? false,
      }),
    yourAgents: () => request<Agent[]>("GET", "/api/account/agents"),
    addGitHub: (input: { callbackURL: string }) =>
      request<Redirect>("POST", "/api/account/github", input),
    removeGitHub: () => request<void>("DELETE", "/api/account/github"),
    requestEmailChange: (email: string) =>
      request<PendingEmailChange>("POST", "/api/account/email-change", {
        email,
      }),
    cancelEmailChange: () =>
      request<void>("DELETE", "/api/account/email-change"),
    confirmEmailChange: (token: string) =>
      request<{ email: string }>("POST", "/api/account/email-change/confirm", {
        token,
      }),
    invitationsForYou: () =>
      request<InvitationForYou[]>("GET", "/api/account/invitations"),
    acceptInvitationById: (invitationId: string) =>
      request<AcceptedInvitation>(
        "POST",
        `/api/account/invitations/${encodeURIComponent(invitationId)}/accept`,
      ),
    declineInvitationById: (invitationId: string) =>
      request<void>(
        "POST",
        `/api/account/invitations/${encodeURIComponent(invitationId)}/decline`,
      ),
    findInvitation: (token: string) =>
      request<InvitationForYou>("POST", "/api/invitations/find", { token }),
    acceptInvitation: (token: string) =>
      request<AcceptedInvitation>("POST", "/api/invitations/accept", { token }),
    declineInvitation: (token: string) =>
      request<void>("POST", "/api/invitations/decline", { token }),

    allowlist: () =>
      request<AllowlistEntry[]>("GET", "/api/installation/allowlist"),
    addToAllowlist: (email: string) =>
      request<void>("POST", "/api/installation/allowlist", { email }),
    removeFromAllowlist: (email: string) =>
      request<void>("POST", "/api/installation/allowlist/remove", { email }),
    catalogIndexHealth: () =>
      request<CatalogIndexHealth>("GET", "/api/installation/catalog-index"),

    createWorkspace: (name: string) =>
      request<Workspace>("POST", "/api/workspaces", { name }),
    workspace: (workspaceId: string) =>
      request<Workspace>("GET", workspace(workspaceId)),
    renameWorkspace: (workspaceId: string, name: string) =>
      request<Workspace>("PATCH", workspace(workspaceId), { name }),
    leaveWorkspace: (workspaceId: string) =>
      request<void>("POST", `${workspace(workspaceId)}/leave`),

    members: (workspaceId: string) =>
      request<Member[]>("GET", `${workspace(workspaceId)}/members`),
    changeRole: (workspaceId: string, memberId: string, role: Role) =>
      request<Member>(
        "PATCH",
        `${workspace(workspaceId)}/members/${encodeURIComponent(memberId)}`,
        { role },
      ),
    removeMember: (workspaceId: string, memberId: string) =>
      request<void>(
        "DELETE",
        `${workspace(workspaceId)}/members/${encodeURIComponent(memberId)}`,
      ),

    agents: (workspaceId: string) =>
      request<Agent[]>("GET", `${workspace(workspaceId)}/agents`),
    createAgentToken: (workspaceId: string, input: NewAgentToken) =>
      request<IssuedAgentToken>(
        "POST",
        `${workspace(workspaceId)}/agents`,
        input,
      ),
    issueAgentToken: (
      workspaceId: string,
      agentId: string,
      access: TokenAccess,
    ) =>
      request<IssuedAgentToken>(
        "POST",
        `${agentPath(workspaceId, agentId)}/token`,
        { access },
      ),
    revokeAgentToken: (workspaceId: string, agentId: string) =>
      request<Agent>("DELETE", `${agentPath(workspaceId, agentId)}/token`),
    renameAgent: (workspaceId: string, agentId: string, name: string) =>
      request<Agent>("PATCH", agentPath(workspaceId, agentId), { name }),
    disableAgent: (workspaceId: string, agentId: string) =>
      request<Agent>("POST", `${agentPath(workspaceId, agentId)}/disable`),
    enableAgent: (workspaceId: string, agentId: string) =>
      request<Agent>("POST", `${agentPath(workspaceId, agentId)}/enable`),

    invitations: (workspaceId: string) =>
      request<Invitation[]>("GET", `${workspace(workspaceId)}/invitations`),
    invite: (workspaceId: string, input: { email: string; role: Role }) =>
      request<Invitation>(
        "POST",
        `${workspace(workspaceId)}/invitations`,
        input,
      ),
    resendInvitation: (workspaceId: string, invitationId: string) =>
      request<Invitation>(
        "POST",
        `${workspace(workspaceId)}/invitations/${encodeURIComponent(invitationId)}/resend`,
      ),
    withdrawInvitation: (workspaceId: string, invitationId: string) =>
      request<void>(
        "DELETE",
        `${workspace(workspaceId)}/invitations/${encodeURIComponent(invitationId)}`,
      ),

    events: (workspaceId: string, page: PageRequest = {}) =>
      request<Page<Event>>(
        "GET",
        `${workspace(workspaceId)}/events${query(page)}`,
      ),
    securityLog: (workspaceId: string, page: PageRequest = {}) =>
      request<Page<SecurityLogEntry>>(
        "GET",
        `${workspace(workspaceId)}/security-log${query(page)}`,
      ),

    // The catalog, read for the wiki (M2-7).
    catalogEntity: (workspaceId: string, id: string) =>
      request<CatalogEntityAnswer>(
        "GET",
        `${catalog(workspaceId)}/entity${search({ id })}`,
      ),
    catalogTypes: (workspaceId: string) =>
      request<CatalogTypeSchemasAnswer>("GET", `${catalog(workspaceId)}/types`),
    catalogType: (workspaceId: string, type: string) =>
      request<CatalogTypeSchemaAnswer>(
        "GET",
        `${catalog(workspaceId)}/types/${encodeURIComponent(type)}`,
      ),
    catalogTypeIndex: (
      workspaceId: string,
      type: string,
      options: { status?: EntityStatus; includeRetired?: boolean } = {},
    ) =>
      request<CatalogTypeIndexAnswer>(
        "GET",
        `${catalog(workspaceId)}/types/${encodeURIComponent(type)}/entities${search(
          {
            status: options.status,
            include_retired: options.includeRetired ? "true" : undefined,
          },
        )}`,
      ),
    catalogSearch: (
      workspaceId: string,
      input: {
        text: string
        type?: string
        includeRetired?: boolean
        limit?: number
      },
    ) =>
      request<CatalogSearchAnswer>(
        "GET",
        `${catalog(workspaceId)}/search${search({
          text: input.text,
          type: input.type,
          include_retired: input.includeRetired ? "true" : undefined,
          limit: input.limit?.toString(),
        })}`,
      ),
    catalogList: (
      workspaceId: string,
      list: CatalogList,
      options: {
        offset?: number
        limit?: number
        includeRetired?: boolean
      } = {},
    ) =>
      request<CatalogListAnswer>(
        "GET",
        `${catalog(workspaceId)}/lists/${encodeURIComponent(list)}${search({
          offset: options.offset?.toString(),
          limit: options.limit?.toString(),
          include_retired: options.includeRetired ? "true" : undefined,
        })}`,
      ),
    catalogStartHere: (workspaceId: string, path: "people" | "agents") =>
      request<StartHereAnswer>(
        "GET",
        `${catalog(workspaceId)}/start-here${search({ path })}`,
      ),

    // Catalog purge (M2-10): the text goes in request bodies only, never
    // in an address.
    previewCatalogPurge: (workspaceId: string, text: string) =>
      request<CatalogPurgePreview>(
        "POST",
        `${catalog(workspaceId)}/purge/preview`,
        { text },
      ),
    purgeCatalogText: (
      workspaceId: string,
      input: { text: string; reason: string },
    ) => request<CatalogPurge>("POST", `${catalog(workspaceId)}/purge`, input),
    catalogPurges: (workspaceId: string) =>
      request<CatalogPurge[]>("GET", `${catalog(workspaceId)}/purges`),
  }
}

/** A query string from the values that are set, or nothing. */
function search(values: Record<string, string | undefined>): string {
  const params = new URLSearchParams()
  for (const [name, value] of Object.entries(values))
    if (value !== undefined) params.set(name, value)
  const text = params.toString()
  return text === "" ? "" : `?${text}`
}

export type ApiClient = ReturnType<typeof createApiClient>

/** Whether an error asks the person to sign in again before retrying. */
export function needsReauthentication(error: unknown): boolean {
  return error instanceof ApiError && error.code === "reauthentication-required"
}

async function readErrorBody(
  response: Response,
): Promise<Partial<ErrorBody> | undefined> {
  if (!response.headers.get("content-type")?.includes("application/json")) {
    return undefined
  }
  try {
    const body: unknown = await response.json()
    if (typeof body !== "object" || body === null) return undefined
    const { error, message, rule, reason } = body as Record<string, unknown>
    return {
      error: typeof error === "string" ? (error as ErrorCode) : undefined,
      message: typeof message === "string" ? message : undefined,
      rule: typeof rule === "string" ? rule : undefined,
      reason: typeof reason === "string" ? reason : undefined,
    }
  } catch {
    return undefined
  }
}

function query(page: PageRequest): string {
  const params = new URLSearchParams()
  if (page.before !== undefined) params.set("before", String(page.before))
  if (page.limit !== undefined) params.set("limit", String(page.limit))
  const text = params.toString()
  return text ? `?${text}` : ""
}
