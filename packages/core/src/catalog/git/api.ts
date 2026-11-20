/**
 * The Git container's internal API (Git-based catalog plan §2.2, D-065): what
 * `web`, `worker` and `migrate` may ask of it, and the context `web` passes
 * with a request. The `git` role (`apps/server/src/git/`) answers it; the
 * typed client (`client.ts`) calls it. Every request carries the service
 * token; the Git container accepts nothing else.
 */
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
  }
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
   * nothing), at most `maxChangesPerCommit`, in Git's order.
   */
  changes: { status: TreeChange["status"]; path: string }[]
  /** How many paths it changed in all. */
  changeCount: number
  /** Whether `changes` lists fewer than `changeCount`. */
  changesTruncated: boolean
}

/** One journal entry: what the Git container recorded for `web` to store. */
export interface JournalEntry {
  /** Numbered from 1, never reused: `web` stores each number once. */
  number: number
  recordedAt: string
  kind: string
  data: Record<string, unknown>
}
