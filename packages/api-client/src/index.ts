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

export type InvitationState =
  "pending" | "accepted" | "declined" | "expired" | "withdrawn"

/** An invitation to join a workspace (identity §5.2). Served by M1-4. */
export interface Invitation {
  id: string
  email: string
  role: Role
  state: InvitationState
  invitedByHandle: string
  createdAt: string
  expiresAt: string
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
 * - `reauthentication-required` (403): the action needs a recent sign-in;
 * - `forbidden` (403): the role or kind of actor does not allow it (`reason`);
 * - `not-found` (404): it does not exist, or the requester may not know it does;
 * - `conflict` (409): it breaks a rule given the current state (`rule`);
 * - `invalid-input` (422): the input itself is malformed (`rule`);
 * - `not-implemented` (501): the server does not offer this yet;
 * - `internal` (500): anything else; details are only in the server's log.
 */
export type ErrorCode =
  | "sign-in-required"
  | "reauthentication-required"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "invalid-input"
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

  return {
    status: () => request<Status>("GET", "/api/status"),
    installation: () => request<Installation>("GET", "/api/installation"),

    // Sign-in. These are served by the sign-in layer (M1-4) under /api/auth,
    // with the routes of Better Auth's magic link and social sign-in.
    requestSignInLink: (input: { email: string; callbackURL: string }) =>
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

    account: () => request<Account>("GET", "/api/account"),

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
  }
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
