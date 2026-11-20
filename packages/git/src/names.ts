import { GitError } from "./run.js"

/**
 * The names Shinan passes to Git for revisions, paths and objects. Only
 * plain forms are taken, so that a name from a request can never be one of
 * Git's searches or option forms: a revision is a full object ID or a
 * branch (`refs/heads/<name>`), never `main~2`, `main^{tree}`, `@{1}`,
 * `:/<text>` (a search of the whole history) or anything starting with `-`.
 * Commands also put `--end-of-options` before revisions.
 */

/** A full object ID: SHA-1 or SHA-256. */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

export function isObjectId(value: string): boolean {
  return OBJECT_ID.test(value)
}

/** One part of a branch name: letters, digits, `.`, `_` and `-`. */
const BRANCH_PART = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/

/**
 * Whether `value` is `refs/heads/<name>`, with a name Git accepts as a
 * branch and of Shinan's characters only (letters, digits, `.`, `_`, `/`
 * and `-`; build plan §2.5).
 */
export function isBranchRef(value: string): boolean {
  if (!value.startsWith("refs/heads/") || value.length > 255) return false
  const parts = value.slice("refs/heads/".length).split("/")
  return parts.every(
    (part) =>
      BRANCH_PART.test(part) &&
      !part.includes("..") &&
      !part.endsWith(".lock") &&
      !part.endsWith("."),
  )
}

/** Whether `value` holds a control character (a line break, NUL and the like). */
function hasControl(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/** A revision: a full object ID or `refs/heads/<name>`. */
export function revision(value: string): string {
  if (!isObjectId(value) && !isBranchRef(value)) {
    throw new GitError(
      "start",
      "git",
      "A revision must be a full object ID or refs/heads/<name>",
    )
  }
  return value
}

/**
 * A path in a tree, for limiting a listing or a history to it or naming an
 * object; a folder may end with `/`. Git reads it literally
 * (`GIT_LITERAL_PATHSPECS`), never as a pattern.
 */
export function treePath(value: string): string {
  const parts = value.replace(/\/$/, "").split("/")
  if (
    value.startsWith("/") ||
    parts.some((part) => part === "" || part === "." || part === "..") ||
    hasControl(value)
  ) {
    throw new GitError("start", "git", "Not a path in a repository")
  }
  return value
}

/** The object at `path` in `rev`'s tree, as `cat-file` names it. */
export function objectName(rev: string, path: string): string {
  return `${revision(rev)}:${treePath(path)}`
}

/**
 * Checks a name given to `cat-file`: a {@link revision}, or
 * {@link objectName}'s `<revision>:<path>`. A branch name cannot hold `:`.
 */
export function checkObjectName(name: string): string {
  const colon = name.indexOf(":")
  return colon < 0
    ? revision(name)
    : objectName(name.slice(0, colon), name.slice(colon + 1))
}
