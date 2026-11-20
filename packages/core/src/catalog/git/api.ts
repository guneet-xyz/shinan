/**
 * The Git container's internal API (Git-based catalog plan §2.2, D-065): what
 * `web`, `worker` and `migrate` may ask of it, and the context `web` passes
 * with a request. The `git` role (`apps/server/src/git/`) answers it; the
 * typed client (`client.ts`) calls it. Every request carries the service
 * token; the Git container accepts nothing else.
 */
import { isIP } from "node:net"

import { isId } from "../../validation.js"

/** The header that carries the service token: `Authorization: Bearer <token>`. */
export const serviceTokenMinLength = 32

/** The header that carries the authenticated request's context, base64url JSON. */
export const gitContextHeader = "Shinan-Git-Context"
/** The context header's largest value, in characters (plan §2.10). */
export const gitContextMaxLength = 64 * 1024
/** The most "not a secret" values a workspace may allow (owner, GQ-2). */
export const maxAllowedValues = 100
/** The most member handles a context lists. */
export const maxContextMemberHandles = 1000

/** The largest file a request may write or read, in bytes (plan §2.10). */
export const maxFileBytes = 1024 * 1024
/** The most documents one read asks for. */
export const maxDocumentsPerRead = 1000
/**
 * The most document bytes one read returns, 32 MiB: documents past it come
 * back `deferred`, for the caller to ask for again. Keeps one response well
 * inside the Git container's memory, whatever a commit holds.
 */
export const maxDocumentsResponseBytes = 32 * 1024 * 1024
/** The most changed paths a history page lists for one commit. */
export const maxChangesPerCommit = 50
/**
 * The most entries one tree listing or diff returns: 50,000, with
 * `truncated` set when there were more. A branch can hold far more paths
 * than `main`'s 20,000 documents.
 */
export const maxTreeEntries = 50_000
/**
 * The most path bytes one tree listing or diff returns: 8 MiB, with
 * `truncated` set when there were more. A path may be up to 4 KiB (Git's
 * own limit), so the entry cap alone would allow about 200 MiB. With the
 * other fields, one answer stays under about 16 MiB of JSON, and four at
 * once beside a streamed documents read fit the Git container's memory.
 */
export const maxTreePathBytes = 8 * 1024 * 1024
/** The most path bytes a history page lists, across its commits' changes. */
export const maxChangedPathBytes = 2 * 1024 * 1024
/** How many reads that hold document, tree or commit data run at once. */
export const maxConcurrentReads = 4
/** How many more wait their turn; past that, `503` with `Retry-After`. */
export const maxQueuedReads = 64
/** The most commits a history page may skip. */
export const maxHistorySkip = 1_000_000
/** The most commits one history page holds. */
export const maxHistoryPage = 100
/** The most journal entries one read returns. */
export const maxJournalPage = 1000
/** The largest request body the Git container reads (plan §2.10's push body). */
export const maxRequestBodyBytes = 64 * 1024 * 1024

/**
 * The largest push body (plan §2.10): `POST git-receive-pack`, 64 MiB. A
 * catalog at its 50 MiB text limit pushed at once, compressed, with room
 * to spare; the same as the repositories' `receive.maxInputSize`.
 */
export const maxPushBodyBytes = 64 * 1024 * 1024
/**
 * The largest fetch body (plan §2.10): `POST git-upload-pack`, 4 MiB. Only
 * negotiation lines: a fetch says which commits it wants and has, about 50
 * bytes each, so this is room for some 80,000 of them.
 */
export const maxFetchBodyBytes = 4 * 1024 * 1024
/**
 * How many Git processes (`git http-backend` and what it starts) serve
 * agents' fetches and pushes at once in the Git container (plan §2.10):
 * Musashi has two cores, and `pack-objects` uses one each.
 */
export const maxGitProcesses = 4
/**
 * How many of them one agent may hold or wait for at once: a single token,
 * even a read-only one, cannot take them all (review of GC-2).
 */
export const maxGitProcessesPerAgent = 2
/**
 * How many the agents of one person may hold or wait for at once: a
 * person can make agents freely, so they share a cap of their own
 * (review of GC-2).
 */
export const maxGitProcessesPerPerson = 3
/** How many more requests wait for a Git process, at most `gitProcessWaitSeconds`. */
export const maxQueuedGitProcesses = 16
/**
 * How long a request waits for a Git process before `429`: well inside the
 * 30 seconds a fetch's body has to arrive at `web`.
 */
export const gitProcessWaitSeconds = 10
/** How long one Git process may run (plan §2.10): a full clone on a slow link. */
export const gitProcessSeconds = 600

/** The two Git services the Git endpoint serves (plan §2.2). */
export type GitService = "git-upload-pack" | "git-receive-pack"

/** One of the four smart HTTP requests (plan §2.2, step 1). */
export interface SmartHttpRequest {
  /** Lowercase. */
  workspaceId: string
  service: GitService
  /** `GET info/refs?service=…`; otherwise the service's `POST`. */
  advertisement: boolean
  /** The path below `/git`, as Git's `PATH_INFO`: `/<workspace ID>.git/info/refs`. */
  pathInfo: string
  /** `service=…` for `info/refs`, otherwise empty. */
  query: string
}

const smartHttpPath =
  /^\/git\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.git\/(info\/refs|git-upload-pack|git-receive-pack)$/

/**
 * Which smart HTTP request this is, or null for anything else: exactly
 * `GET /git/<workspace ID>.git/info/refs?service=git-upload-pack` (or
 * `git-receive-pack`) and `POST /git/<workspace ID>.git/git-upload-pack`
 * (or `git-receive-pack`), with nothing else in the address. Git's "dumb"
 * HTTP paths (`HEAD`, `objects/…`), other methods, other spellings and
 * other query strings are not. `web` and the Git container both check.
 */
export function smartHttpRequest(
  method: string,
  pathname: string,
  search: string,
): SmartHttpRequest | null {
  const match = smartHttpPath.exec(pathname)
  if (!match) return null
  const workspaceId = match[1]!.toLowerCase()
  const what = match[2]!
  if (what === "info/refs") {
    if (method !== "GET") return null
    const service = /^\?service=(git-upload-pack|git-receive-pack)$/.exec(
      search,
    )?.[1] as GitService | undefined
    if (!service) return null
    return {
      workspaceId,
      service,
      advertisement: true,
      pathInfo: `/${workspaceId}.git/info/refs`,
      query: `service=${service}`,
    }
  }
  if (method !== "POST" || search !== "") return null
  return {
    workspaceId,
    service: what as GitService,
    advertisement: false,
    pathInfo: `/${workspaceId}.git/${what}`,
    query: "",
  }
}

/**
 * Who and what an authenticated request through `web` is about (plan §2.2):
 * the Git container trusts it only because the request carries the service
 * token.
 */
export interface GitRequestContext {
  requestId: string
  workspaceId: string
  agent: { id: string; handle: string }
  memberId: string
  person: { id: string; handle: string }
  /** How a fact check's `by` must name this pusher (identity §8.7). */
  by: string
  /** Whether the agent's token may push (`catalog:write`). */
  mayPush: boolean
  /** The workspace's member handles, for validation's owner warnings. */
  memberHandles: string[]
  /** SHA-256 (hex) of each value the workspace's owners allowed as "not a secret". */
  allowedValues: string[]
  /** The agent token the request came with, for the push log. */
  tokenId?: string
  /** The client's network address, for the push log. */
  networkAddress?: string
}

export class GitContextError extends Error {
  override name = "GitContextError"
}

const handle = /^[a-z0-9-]{1,100}$/
const sha256 = /^[0-9a-f]{64}$/

function text(value: unknown, what: string, max = 200): string {
  if (typeof value !== "string" || value === "" || value.length > max) {
    throw new GitContextError(`The context's ${what} is missing or too long`)
  }
  return value
}

function id(value: unknown, what: string): string {
  const v = text(value, what)
  if (!isId(v)) throw new GitContextError(`The context's ${what} is not an ID`)
  return v
}

function handleOf(value: unknown, what: string): string {
  const v = text(value, what, 100)
  if (!handle.test(v))
    throw new GitContextError(`The context's ${what} is not a handle`)
  return v
}

function object(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GitContextError(`The context's ${what} is not an object`)
  }
  return value as Record<string, unknown>
}

/** Encodes a context for the header. */
export function encodeGitContext(context: GitRequestContext): string {
  const value = Buffer.from(JSON.stringify(context), "utf8").toString(
    "base64url",
  )
  if (value.length > gitContextMaxLength) {
    throw new GitContextError(
      "The context is larger than the Git container accepts",
    )
  }
  return value
}

/**
 * Reads the context header's value, refusing one over its limits or of any
 * other shape. Unknown fields are dropped.
 */
export function decodeGitContext(value: string): GitRequestContext {
  if (value.length > gitContextMaxLength) {
    throw new GitContextError("The context is too large")
  }
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new GitContextError("The context is not base64url")
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
  } catch {
    throw new GitContextError("The context is not JSON")
  }
  const c = object(parsed, "value")
  const agent = object(c.agent, "agent")
  const person = object(c.person, "person")
  if (typeof c.mayPush !== "boolean") {
    throw new GitContextError("The context's mayPush is not true or false")
  }
  const list = (v: unknown, what: string, max: number): unknown[] => {
    if (!Array.isArray(v))
      throw new GitContextError(`The context's ${what} is not a list`)
    if (v.length > max) {
      throw new GitContextError(`The context has more than ${max} ${what}`)
    }
    return v
  }
  const allowedValues = list(
    c.allowedValues,
    "allowed values",
    maxAllowedValues,
  ).map((h) => {
    if (typeof h !== "string" || !sha256.test(h)) {
      throw new GitContextError("An allowed value is not a SHA-256 hash")
    }
    return h
  })
  return {
    requestId: text(c.requestId, "request ID", 100),
    workspaceId: id(c.workspaceId, "workspace"),
    agent: {
      id: id(agent.id, "agent ID"),
      handle: handleOf(agent.handle, "agent handle"),
    },
    memberId: id(c.memberId, "member ID"),
    person: {
      id: id(person.id, "person ID"),
      handle: handleOf(person.handle, "person handle"),
    },
    by: text(c.by, "by", 200),
    mayPush: c.mayPush,
    memberHandles: list(
      c.memberHandles,
      "member handles",
      maxContextMemberHandles,
    ).map((h) => handleOf(h, "member handle")),
    allowedValues,
    ...(c.tokenId === undefined ? {} : { tokenId: id(c.tokenId, "token ID") }),
    ...(c.networkAddress === undefined
      ? {}
      : { networkAddress: address(c.networkAddress) }),
  }
}

function address(value: unknown): string {
  const v = text(value, "network address", 64)
  if (isIP(v) === 0) {
    throw new GitContextError("The context's network address is not one")
  }
  return v
}

/** Which commit a read is of: `main` (the branch's current commit) or a full commit ID. */
export type CommitRef = "main" | (string & {})

/** A file of a repository's first commit. */
export interface RepositoryFile {
  path: string
  /** The file's bytes. */
  content: Uint8Array
}

export interface RepositoryInfo {
  workspaceId: string
  /** `main`'s current commit. */
  main: string
}

export interface TreeEntry {
  path: string
  /** Git's mode, such as `100644`. */
  mode: string
  type: "blob" | "tree" | "commit"
  oid: string
  /** A blob's size in bytes, `null` otherwise. */
  size: number | null
}

/**
 * One document of a read: its content; or missing (no file there); or too
 * large (above `maxFileBytes`); or deferred (past the response's
 * `maxDocumentsResponseBytes`: ask for it again).
 */
export type DocumentRead =
  | { path: string; oid: string; size: number; content: Uint8Array }
  | { path: string; missing: true }
  | { path: string; tooLarge: true; size: number }
  | { path: string; deferred: true; size: number }

export interface TreeChange {
  status: "added" | "deleted" | "modified" | "type-changed"
  path: string
  oldMode: string | null
  oldOid: string | null
  newMode: string | null
  newOid: string | null
}

export interface CommitIdentityInfo {
  name: string
  email: string
  /** Seconds since 1970. */
  time: number
  timezone: string
}

export interface CommitInfo {
  oid: string
  parents: string[]
  author: CommitIdentityInfo | null
  committer: CommitIdentityInfo | null
  /** Only its start when `truncated`. */
  message: string
  /** Whether the commit was too large to read whole (over 256 KiB). */
  truncated: boolean
  /**
   * The paths it changed against its first parent (a root commit: against
   * nothing), at most `maxChangesPerCommit`, in Git's order. For a merge in
   * a history asked for `combined`: only those that differ from every
   * parent.
   */
  changes: { status: TreeChange["status"]; path: string }[]
  /** How many paths it changed in all. */
  changeCount: number
  /** Whether `changes` lists fewer than `changeCount`. */
  changesTruncated: boolean
  /**
   * Whether `changeCount` is a lower bound ("at least"): the request's work
   * budget ran out before every change was found.
   */
  changeCountAtLeast: boolean
}

/** A repository's branches, as the minute check of the push log reads them. */
export interface RepositoryRefs {
  workspaceId: string
  /** A push to the repository is being checked: its refs are read later. */
  busy: boolean
  /** Each branch (`refs/heads/…`) and its commit; empty when busy. */
  refs: { ref: string; commit: string }[]
  /** The journal and its last number when the refs were read. */
  journalId: string
  journalLast: number
}

/** One journal entry: what the Git container recorded for `web` to store. */
export interface JournalEntry {
  /** Numbered from 1, never reused: `web` stores each number once. */
  number: number
  recordedAt: string
  kind: string
  data: Record<string, unknown>
}
