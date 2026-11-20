import { openCatFile } from "./cat-file.js"
import type { CatFile } from "./cat-file.js"
import { isObjectId, revision, treePath } from "./names.js"
import type { Git, RunOptions } from "./run.js"
import { GitError } from "./run.js"
import { MAX_TREE_OBJECT_BYTES, walkBudget, walkTreeDiff } from "./tree-walk.js"
import type { WalkBudget } from "./tree-walk.js"

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

/**
 * Runs Git and hands each NUL-ended field of its output to `onField` as it
 * arrives, keeping nothing else. `onField` returns `false` to stop: Git is
 * ended and what it would have written is never read. Fails like `run()`
 * on a non-zero exit, with Git's standard error.
 */
async function readFields(
  git: Git,
  gitDir: string,
  args: string[],
  options: ReadOptions,
  onField: (text: string) => boolean | void,
): Promise<void> {
  const command = args[0] ?? "git"
  const proc = git.spawn(args, {
    gitDir,
    env: options.env,
    timeoutMs: options.timeoutMs,
  })
  let rest: Buffer = Buffer.alloc(0)
  let stopped = false
  let failure: Error | undefined
  const errors: Buffer[] = []
  let errorSize = 0
  proc.child.stderr.on("data", (chunk: Buffer) => {
    if (errorSize >= 64 * 1024) return
    errors.push(chunk)
    errorSize += chunk.length
  })
  const take = (text: string) => {
    if (stopped) return
    try {
      if (onField(text) === false) {
        stopped = true
        proc.kill()
      }
    } catch (error) {
      failure ??= error as Error
      stopped = true
      proc.kill()
    }
  }
  proc.child.stdout.on("data", (chunk: Buffer) => {
    if (stopped) return
    let data = rest.length ? Buffer.concat([rest, chunk]) : chunk
    for (
      let end = data.indexOf(0);
      end >= 0 && !stopped;
      end = data.indexOf(0)
    ) {
      take(data.subarray(0, end).toString("utf8"))
      data = data.subarray(end + 1)
    }
    // A path is at most 4 KiB; anything longer is not Git's output.
    if (data.length > 64 * 1024) {
      failure ??= new GitError(
        "exit",
        command,
        `git ${command} gave a field too long to read`,
      )
      stopped = true
      proc.kill()
    }
    rest = data
  })
  proc.child.stdin.end()
  const ended = await proc.ended
  if (failure) throw failure
  if (stopped) return
  if (rest.length) take(rest.toString("utf8"))
  // `take` may have set it since.
  const late = failure as Error | undefined
  if (late) throw late
  if (ended.timedOut) {
    throw new GitError(
      "timeout",
      command,
      `git ${command} took too long and was stopped`,
    )
  }
  if (ended.code !== 0) {
    const stderr = Buffer.concat(errors).toString("utf8")
    const firstLine = stderr.split("\n", 1)[0]?.slice(0, 200) ?? ""
    throw new GitError(
      "exit",
      command,
      `git ${command} failed (exit code ${ended.code ?? "none"})${firstLine ? `: ${firstLine}` : ""}`,
      ended.code,
      stderr,
    )
  }
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
export async function listTreePage(
  git: Git,
  gitDir: string,
  treeish: string,
  options: ReadOptions & {
    path?: string
    recursive?: boolean
    /** At most this many entries. */
    limit?: number
    /** At most this many bytes of paths, together. */
    maxPathBytes?: number
  } = {},
): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
  const limit =
    options.limit === undefined ? Infinity : count(options.limit, "The limit")
  const maxPathBytes = options.maxPathBytes ?? Infinity
  let pathBytes = 0
  let truncated = false
  const entries: TreeEntry[] = []
  await readFields(
    git,
    gitDir,
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
    options,
    (record) => {
      if (record === "") return
      if (entries.length >= limit) {
        truncated = true
        return false
      }
      const tab = record.indexOf("\t")
      const [mode, type, oid, size] = record.slice(0, tab).split(/ +/)
      if (tab < 0 || !mode || !type || !oid || !isObjectId(oid)) {
        throw new GitError(
          "exit",
          "ls-tree",
          "git ls-tree gave a line Shinan cannot read",
        )
      }
      const path = record.slice(tab + 1)
      pathBytes += Buffer.byteLength(path)
      if (pathBytes > maxPathBytes) {
        truncated = true
        return false
      }
      entries.push({
        mode,
        type: type as EntryType,
        oid,
        path,
        size: size === undefined || size === "-" ? null : Number(size),
      })
    },
  )
  return { entries, truncated }
}

/**
 * The entries of a tree (or of a commit's tree). Recursive by default,
 * listing blobs, symbolic links and submodules but not folders; `path`
 * limits it to one file or folder. {@link listTreePage} stops at a limit.
 */
export async function listTree(
  git: Git,
  gitDir: string,
  treeish: string,
  options: ReadOptions & { path?: string; recursive?: boolean } = {},
): Promise<TreeEntry[]> {
  return (await listTreePage(git, gitDir, treeish, options)).entries
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
export async function diffTreesPage(
  git: Git,
  gitDir: string,
  from: string | null,
  to: string,
  options: ReadOptions & {
    /** At most this many changes. */
    limit?: number
    /** At most this many bytes of paths, together. */
    maxPathBytes?: number
    /** The work budget, shared by a request's walks (`walkBudget()`). */
    budget?: WalkBudget
  } = {},
): Promise<{ changes: TreeChange[]; truncated: boolean }> {
  const limit =
    options.limit === undefined ? Infinity : count(options.limit, "The limit")
  const maxPathBytes = options.maxPathBytes ?? Infinity
  const fromName = from === null ? null : revision(from)
  const toName = revision(to)
  let pathBytes = 0
  const changes: TreeChange[] = []
  const reader = openCatFile(git, gitDir, {
    env: options.env,
    timeoutMs: options.timeoutMs,
    maxObjectBytes: MAX_TREE_OBJECT_BYTES,
  })
  try {
    const fromTree =
      fromName === null
        ? null
        : await treeOf(git, gitDir, reader, fromName, options)
    const toTree = await treeOf(git, gitDir, reader, toName, options)
    const end = await walkTreeDiff(
      reader,
      fromTree,
      toTree,
      (change) => {
        pathBytes += Buffer.byteLength(change.path)
        if (changes.length >= limit || pathBytes > maxPathBytes) return false
        changes.push(change)
      },
      options.budget,
    )
    return { changes, truncated: end.stopped || end.exhausted }
  } finally {
    await reader.close()
  }
}

/** The tree of a commit or tree named by a full object ID or a branch. */
async function treeOf(
  git: Git,
  gitDir: string,
  reader: CatFile,
  name: string,
  options: ReadOptions,
): Promise<string> {
  const info = await reader.info(name)
  if (info?.type === "tree") return info.oid
  if (info?.type === "commit") {
    const [commit] = await readCommits(git, gitDir, [info.oid], options)
    return commit!.tree
  }
  throw new GitError("exit", "diff", `${name} is not a commit or a tree`)
}

/**
 * Every file that differs between two trees (or commits), recursively,
 * without rename detection: a renamed file is one deletion and one
 * addition. `from` `null` compares with the empty tree.
 * {@link diffTreesPage} stops at a limit.
 */
export async function diffTrees(
  git: Git,
  gitDir: string,
  from: string | null,
  to: string,
  options: ReadOptions = {},
): Promise<TreeChange[]> {
  return (await diffTreesPage(git, gitDir, from, to, options)).changes
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
  /**
   * Whether `count` is a lower bound: the request's work budget ran out
   * before every change was found.
   */
  countAtLeast: boolean
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
    /**
     * At most this many bytes of paths across every commit's list: past
     * it, paths are still counted but not listed.
     */
    maxPathBytes?: number
    /** The work budget, shared by a request's walks (`walkBudget()`). */
    budget?: WalkBudget
  } = {},
): Promise<Map<string, CommitChanges>> {
  if (!commits.every(isObjectId)) {
    throw new GitError(
      "start",
      "diff",
      "Changed paths are asked for by object ID",
    )
  }
  const max = options.maxPerCommit ?? DEFAULT_MAX_CHANGES_PER_COMMIT
  const maxPathBytes = options.maxPathBytes ?? Infinity
  const budget = options.budget ?? walkBudget()
  let pathBytes = 0
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
  const reader = openCatFile(git, gitDir, {
    env: options.env,
    timeoutMs: options.timeoutMs,
    maxObjectBytes: MAX_TREE_OBJECT_BYTES,
  })
  try {
    for (const oid of commits) {
      if (result.has(oid)) continue
      const commit = heads.get(oid)!
      const parent = commit.parents[0]
      const current: CommitChanges = {
        changes: [],
        count: 0,
        truncated: false,
        countAtLeast: false,
      }
      result.set(oid, current)
      if (budget.objects <= 0 || budget.entries <= 0) {
        // The request's budget is spent: this commit's changes are unknown.
        current.truncated = true
        current.countAtLeast = true
        continue
      }
      // Every change is counted; only the first, within the budgets, kept.
      const end = await walkTreeDiff(
        reader,
        parent ? heads.get(parent)!.tree : null,
        commit.tree,
        ({ status, path }) => {
          current.count++
          const bytes = Buffer.byteLength(path)
          if (
            current.changes.length < max &&
            pathBytes + bytes <= maxPathBytes
          ) {
            pathBytes += bytes
            current.changes.push({ status, path })
          } else current.truncated = true
        },
        budget,
      )
      if (end.exhausted) {
        current.truncated = true
        current.countAtLeast = true
      }
    }
    return result
  } finally {
    await reader.close()
  }
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
