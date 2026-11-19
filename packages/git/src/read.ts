import { openCatFile } from "./cat-file.js"
import type { Git, RunOptions } from "./run.js"
import { GitError } from "./run.js"

/** Options every read takes: the repository, and a push's quarantine. */
export type ReadOptions = Pick<
  RunOptions,
  "env" | "timeoutMs" | "maxOutputBytes"
>

/** A full object ID: SHA-1 or SHA-256. */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

export function isObjectId(value: string): boolean {
  return OBJECT_ID.test(value)
}

/** Whether `value` holds a control character (a line break, NUL and the like). */
function hasControl(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * A revision from a caller, such as `main`, an object ID or `main~2`. It
 * cannot start with `-` (Git would read it as an option) or hold control
 * characters; every command also puts `--end-of-options` before it.
 */
function revision(value: string): string {
  if (value === "" || value.startsWith("-") || hasControl(value)) {
    throw new GitError("start", "git", "Not a revision Shinan passes to Git")
  }
  return value
}

/**
 * A path in a tree, for limiting a listing or a history to it; a folder may
 * end with `/`. Git reads it literally (`GIT_LITERAL_PATHSPECS`), never as
 * a pattern.
 */
function treePath(value: string): string {
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

/** A count Shinan passes to Git. */
function count(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new GitError("start", "git", `${what} must be a whole number`)
  }
  return value
}

/** NUL-separated records, without the empty one after the last NUL. */
function records(output: Buffer): string[] {
  const parts = output.toString("utf8").split("\0")
  if (parts.at(-1) === "") parts.pop()
  return parts
}

export type EntryType = "blob" | "tree" | "commit"

export interface TreeEntry {
  /** Git's octal mode: `100644`, `100755`, `120000` (a symbolic link), `040000`, `160000` (a submodule). */
  mode: string
  type: EntryType
  oid: string
  /** From the tree's root, with `/` between folders. */
  path: string
  /** A blob's size in bytes; `null` for anything else. */
  size: number | null
}

/**
 * The entries of a tree (or of a commit's tree). Recursive by default,
 * listing blobs, symbolic links and submodules but not folders; `path`
 * limits it to one file or folder.
 */
export async function listTree(
  git: Git,
  gitDir: string,
  treeish: string,
  options: ReadOptions & { path?: string; recursive?: boolean } = {},
): Promise<TreeEntry[]> {
  const { stdout } = await git.run(
    [
      "ls-tree",
      "-z",
      "--long",
      "--full-tree",
      ...(options.recursive === false ? [] : ["-r"]),
      "--end-of-options",
      revision(treeish),
      ...(options.path === undefined ? [] : ["--", treePath(options.path)]),
    ],
    { ...options, gitDir },
  )
  return records(stdout).map((record) => {
    const tab = record.indexOf("\t")
    const [mode, type, oid, size] = record.slice(0, tab).split(/ +/)
    if (tab < 0 || !mode || !type || !oid || !isObjectId(oid)) {
      throw new GitError(
        "exit",
        "ls-tree",
        "git ls-tree gave a line Shinan cannot read",
      )
    }
    return {
      mode,
      type: type as EntryType,
      oid,
      path: record.slice(tab + 1),
      size: size === undefined || size === "-" ? null : Number(size),
    }
  })
}

export type ChangeStatus = "added" | "deleted" | "modified" | "type-changed"

export interface TreeChange {
  status: ChangeStatus
  path: string
  /** `null` when the path is added. */
  oldMode: string | null
  oldOid: string | null
  /** `null` when the path is deleted. */
  newMode: string | null
  newOid: string | null
}

const STATUS: Record<string, ChangeStatus> = {
  A: "added",
  D: "deleted",
  M: "modified",
  T: "type-changed",
}

/** The empty tree's ID in this repository's object format. */
export async function emptyTree(
  git: Git,
  gitDir: string,
  options: ReadOptions = {},
): Promise<string> {
  const { stdout } = await git.run(["hash-object", "-t", "tree", "--stdin"], {
    ...options,
    gitDir,
    input: "",
  })
  return stdout.toString("utf8").trim()
}

/**
 * Every file that differs between two trees (or commits), recursively,
 * without rename detection: a renamed file is one deletion and one
 * addition. `from` `null` compares with the empty tree.
 */
export async function diffTrees(
  git: Git,
  gitDir: string,
  from: string | null,
  to: string,
  options: ReadOptions = {},
): Promise<TreeChange[]> {
  const base =
    from === null ? await emptyTree(git, gitDir, options) : revision(from)
  const { stdout } = await git.run(
    [
      "diff-tree",
      "-r",
      "-z",
      "--raw",
      "--no-renames",
      "--no-commit-id",
      "--full-index",
      "--end-of-options",
      base,
      revision(to),
    ],
    { ...options, gitDir },
  )
  const parts = records(stdout)
  const changes: TreeChange[] = []
  for (let i = 0; i < parts.length; i += 2) {
    const [oldMode, newMode, oldOid, newOid, code] = (parts[i] ?? "")
      .replace(/^:/, "")
      .split(" ")
    const path = parts[i + 1]
    const status = STATUS[code ?? ""]
    if (
      !status ||
      path === undefined ||
      !oldMode ||
      !newMode ||
      !oldOid ||
      !newOid
    ) {
      throw new GitError(
        "exit",
        "diff-tree",
        "git diff-tree gave a line Shinan cannot read",
      )
    }
    changes.push({
      status,
      path,
      oldMode: status === "added" ? null : oldMode,
      oldOid: status === "added" ? null : oldOid,
      newMode: status === "deleted" ? null : newMode,
      newOid: status === "deleted" ? null : newOid,
    })
  }
  return changes
}

/**
 * The commits reachable from `tips` but from no ref of the repository,
 * newest first: during a push's `pre-receive`, the commits it brings.
 * At most `limit`; `truncated` says there were more.
 */
export async function newCommits(
  git: Git,
  gitDir: string,
  tips: readonly string[],
  options: ReadOptions & { limit: number },
): Promise<{ commits: string[]; truncated: boolean }> {
  if (!tips.every(isObjectId)) {
    throw new GitError(
      "start",
      "rev-list",
      "New commits are asked for by object ID",
    )
  }
  if (tips.length === 0) return { commits: [], truncated: false }
  const { stdout } = await git.run(
    [
      "rev-list",
      `--max-count=${count(options.limit, "The limit") + 1}`,
      ...tips,
      "--not",
      "--all",
    ],
    { ...options, gitDir },
  )
  const commits = stdout.toString("utf8").split("\n").filter(Boolean)
  return {
    commits: commits.slice(0, options.limit),
    truncated: commits.length > options.limit,
  }
}

export interface Identity {
  name: string
  email: string
  /** Seconds since 1970. */
  time: number
  /** As Git writes it, such as `+0530`. */
  timezone: string
}

export interface Commit {
  oid: string
  tree: string
  parents: string[]
  /** `null` when the header cannot be read as a name, address and time. */
  author: Identity | null
  committer: Identity | null
  /** The whole message, decoded as UTF-8. */
  message: string
}

function identity(value: string | undefined): Identity | null {
  const match = value?.match(/^(.*) <([^<>]*)> (\d+) ([+-]\d{4})$/)
  if (!match) return null
  return {
    name: match[1] ?? "",
    email: match[2] ?? "",
    time: Number(match[3]),
    timezone: match[4] ?? "",
  }
}

/** Reads a commit object's content (as `cat-file` gives it). */
export function parseCommit(oid: string, content: Buffer): Commit {
  const text = content.toString("utf8")
  const split = text.indexOf("\n\n")
  const head = split < 0 ? text : text.slice(0, split)
  const headers = new Map<string, string[]>()
  for (const line of head.split("\n")) {
    // A line starting with a space continues the previous header (a
    // signature); none of the headers read here have one.
    if (line.startsWith(" ") || line === "") continue
    const space = line.indexOf(" ")
    const key = space < 0 ? line : line.slice(0, space)
    const values = headers.get(key) ?? []
    values.push(space < 0 ? "" : line.slice(space + 1))
    headers.set(key, values)
  }
  const tree = headers.get("tree")?.[0]
  if (!tree || !isObjectId(tree)) {
    throw new GitError("exit", "cat-file", "A commit without a tree")
  }
  return {
    oid,
    tree,
    parents: headers.get("parent") ?? [],
    author: identity(headers.get("author")?.[0]),
    committer: identity(headers.get("committer")?.[0]),
    message: split < 0 ? "" : text.slice(split + 2),
  }
}

/**
 * Commits from `rev` back, newest first, as `git log` orders them; with
 * `path`, only those that changed it (Git's default history simplification).
 */
export async function history(
  git: Git,
  gitDir: string,
  rev: string,
  options: ReadOptions & { limit: number; skip?: number; path?: string },
): Promise<Commit[]> {
  const { stdout } = await git.run(
    [
      "rev-list",
      `--max-count=${count(options.limit, "The limit")}`,
      ...(options.skip
        ? [`--skip=${count(options.skip, "The number to skip")}`]
        : []),
      "--end-of-options",
      revision(rev),
      ...(options.path === undefined ? [] : ["--", treePath(options.path)]),
    ],
    { ...options, gitDir },
  )
  const oids = stdout.toString("utf8").split("\n").filter(Boolean)
  if (oids.length === 0) return []
  const reader = openCatFile(git, gitDir, options)
  try {
    const commits: Commit[] = []
    for (const oid of oids) {
      const object = await reader.read(oid)
      if (typeof object === "string" || object.type !== "commit") {
        throw new GitError(
          "exit",
          "cat-file",
          `Commit ${oid} could not be read`,
        )
      }
      commits.push(parseCommit(oid, object.content))
    }
    return commits
  } finally {
    await reader.close()
  }
}
