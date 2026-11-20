import { openCatFile } from "./cat-file.js"
import { isObjectId, revision, treePath } from "./names.js"
import type { Git, RunOptions } from "./run.js"
import { GitError } from "./run.js"

/** Options every read takes: the repository, and a push's quarantine. */
export type ReadOptions = Pick<
  RunOptions,
  "env" | "timeoutMs" | "maxOutputBytes"
>

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
  /** The message, decoded as UTF-8; only its start when `truncated`. */
  message: string
  /**
   * Whether the commit was larger than the reader's limit, so only its
   * start was read: its headers and the start of its message.
   */
  truncated: boolean
}

/** The most of one commit object {@link history} reads: 256 KiB. */
export const DEFAULT_MAX_COMMIT_BYTES = 256 * 1024

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
    truncated: false,
  }
}

/**
 * The first `maxBytes` of a commit object, without reading the rest: Git
 * is stopped once that much has arrived.
 */
async function readCommitStart(
  git: Git,
  gitDir: string,
  oid: string,
  maxBytes: number,
  options: ReadOptions,
): Promise<Buffer> {
  const proc = git.spawn(["cat-file", "commit", oid], {
    gitDir,
    env: options.env,
    timeoutMs: options.timeoutMs,
  })
  const chunks: Buffer[] = []
  let size = 0
  proc.child.stdout.on("data", (chunk: Buffer) => {
    if (size >= maxBytes) return
    const part = chunk.subarray(0, maxBytes - size)
    chunks.push(part)
    size += part.length
    if (size >= maxBytes) proc.kill()
  })
  proc.child.stdin.end()
  await proc.ended
  return Buffer.concat(chunks)
}

/** What one commit changed, as {@link changedPaths} lists it. */
export interface CommitChanges {
  /** At most the limit asked for, in Git's order. */
  changes: { status: ChangeStatus; path: string }[]
  /** How many paths it changed in all. */
  count: number
  /** Whether `changes` lists fewer than `count`. */
  truncated: boolean
}

/** The most changed paths {@link history} lists for one commit: 50. */
export const DEFAULT_MAX_CHANGES_PER_COMMIT = 50

/**
 * The paths each commit changed, against its first parent (a root commit
 * against the empty tree), without rename detection: Git's
 * `--name-status`. Git compares the commits' trees, never parsing a whole
 * commit (a commit's message may be many megabytes), and its output is read
 * as it comes, keeping only the first `maxPerCommit` paths of each commit:
 * a commit that changed many thousands of files costs time, not memory.
 */
export async function changedPaths(
  git: Git,
  gitDir: string,
  commits: readonly string[],
  options: ReadOptions & {
    maxPerCommit?: number
    maxCommitBytes?: number
  } = {},
): Promise<Map<string, CommitChanges>> {
  if (!commits.every(isObjectId)) {
    throw new GitError(
      "start",
      "diff-tree",
      "Changed paths are asked for by object ID",
    )
  }
  const max = options.maxPerCommit ?? DEFAULT_MAX_CHANGES_PER_COMMIT
  const result = new Map<string, CommitChanges>()
  if (commits.length === 0) return result

  // Each commit's tree and its first parent's, read within the limit.
  const heads = new Map(
    (await readCommits(git, gitDir, [...new Set(commits)], options)).map(
      (c) => [c.oid, c],
    ),
  )
  const outside = [
    ...new Set(
      [...heads.values()]
        .map((c) => c.parents[0])
        .filter((p): p is string => p !== undefined && !heads.has(p)),
    ),
  ]
  for (const parent of await readCommits(git, gitDir, outside, options)) {
    heads.set(parent.oid, parent)
  }
  const empty = await emptyTree(git, gitDir, options)
  const lines = commits.map((oid) => {
    const commit = heads.get(oid)!
    const parent = commit.parents[0]
    return `${parent ? heads.get(parent)!.tree : empty} ${commit.tree}`
  })

  // Every pair gets a header line (`--always`), in the order sent, so the
  // n-th header is the n-th commit's.
  const proc = git.spawn(
    [
      "diff-tree",
      "--stdin",
      "--always",
      "-r",
      "-z",
      "--no-renames",
      "--name-status",
    ],
    { gitDir, env: options.env, timeoutMs: options.timeoutMs },
  )
  let index = -1
  let current: CommitChanges | undefined
  let status: ChangeStatus | undefined
  let rest: Buffer = Buffer.alloc(0)
  let failure: Error | undefined
  const fail = (message: string) => {
    failure ??= new GitError("exit", "diff-tree", message)
    proc.kill()
  }
  const header = /^[0-9a-f]{40,64} [0-9a-f]{40,64}$/
  // One NUL-ended field: a path, or headers and a status joined by line
  // breaks (`<old> <new>\nM`), or the end of the output.
  const field = (text: string) => {
    if (status !== undefined) {
      if (current) {
        current.count++
        if (current.changes.length < max)
          current.changes.push({ status, path: text })
        else current.truncated = true
      }
      status = undefined
      return
    }
    const segments = text.split("\n")
    const last = segments.pop()!
    for (const segment of segments) {
      if (!header.test(segment))
        return fail("git diff-tree gave a line Shinan cannot read")
      index++
      const oid = commits[index]
      if (oid === undefined)
        return fail("git diff-tree answered a pair nobody sent")
      current = { changes: [], count: 0, truncated: false }
      result.set(oid, current)
    }
    if (last === "") return
    const next = STATUS[last]
    if (!next) return fail("git diff-tree gave a line Shinan cannot read")
    status = next
  }
  proc.child.stdout.on("data", (chunk: Buffer) => {
    let data = rest.length ? Buffer.concat([rest, chunk]) : chunk
    for (let end = data.indexOf(0); end >= 0; end = data.indexOf(0)) {
      field(data.subarray(0, end).toString("utf8"))
      data = data.subarray(end + 1)
    }
    // A path is at most 4 KiB; anything longer is not Git's output.
    if (data.length > 64 * 1024)
      fail("git diff-tree gave a field too long to read")
    rest = data
  })
  proc.child.stdin.end(`${lines.join("\n")}\n`)
  const ended = await proc.ended
  if (rest.length) field(`${rest.toString("utf8")}`)
  if (failure) throw failure
  if (ended.timedOut) {
    throw new GitError(
      "timeout",
      "diff-tree",
      "git diff-tree took too long and was stopped",
    )
  }
  if (ended.code !== 0) {
    throw new GitError(
      "exit",
      "diff-tree",
      `git diff-tree failed (exit code ${ended.code ?? "none"})`,
      ended.code,
    )
  }
  if (result.size !== new Set(commits).size) {
    throw new GitError("exit", "diff-tree", "git diff-tree left out a commit")
  }
  return result
}

/**
 * Commits from `rev` (a full object ID or `refs/heads/<name>`) back, newest first, as `git log` orders them; with
 * `path`, only those that changed it (Git's default history simplification).
 */
export async function history(
  git: Git,
  gitDir: string,
  rev: string,
  options: ReadOptions & {
    limit: number
    skip?: number
    path?: string
    /** Commits larger than this are read only this far. Default 256 KiB. */
    maxCommitBytes?: number
  },
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
  return readCommits(git, gitDir, oids, options)
}

/**
 * Reads commits by full ID, each only up to `maxCommitBytes` (default
 * 256 KiB): a larger one comes back with its headers and the start of its
 * message, `truncated`. However large the commits, this holds at most that
 * much of each.
 */
export async function readCommits(
  git: Git,
  gitDir: string,
  oids: readonly string[],
  options: ReadOptions & { maxCommitBytes?: number } = {},
): Promise<Commit[]> {
  if (!oids.every(isObjectId)) {
    throw new GitError("start", "cat-file", "Commits are read by object ID")
  }
  if (oids.length === 0) return []
  const maxCommitBytes = options.maxCommitBytes ?? DEFAULT_MAX_COMMIT_BYTES
  const reader = openCatFile(git, gitDir, {
    ...options,
    maxObjectBytes: maxCommitBytes,
  })
  try {
    const commits: Commit[] = []
    for (const oid of oids) {
      const object = await reader.read(oid)
      if (object === "too-large") {
        const start = await readCommitStart(
          git,
          gitDir,
          oid,
          maxCommitBytes,
          options,
        )
        const commit = parseCommit(oid, start)
        commits.push({
          ...commit,
          // A character cut in two at the limit is dropped.
          message: commit.message.replace(/\uFFFD$/, ""),
          truncated: true,
        })
        continue
      }
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
