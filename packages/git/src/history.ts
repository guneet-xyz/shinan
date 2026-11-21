import { existsSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import type { Readable, Writable } from "node:stream"

import type { Git, GitProcess } from "./run.js"
import { GitError, MAX_STDERR_BYTES } from "./run.js"

/**
 * A repository's whole history as `git fast-export --all` writes it, read
 * one item at a time, and written into another repository with
 * `git fast-import`, for a history rewrite such as a purge (Git-based
 * catalog plan §2.9). Nothing here knows what is removed: callers change
 * the items on the way.
 */

/** A file's content, once in the stream. */
export interface HistoryBlob {
  kind: "blob"
  mark: number
  /** Its ID in the repository read. */
  oid: string
  data: Buffer
}

/** One change of a commit's tree. */
export type HistoryChange =
  | { op: "M"; mode: string; dataref: string; path: Buffer }
  | { op: "D"; path: Buffer }
  | { op: "deleteall" }

/** A commit; `ref` is the branch fast-export moves with it. */
export interface HistoryCommit {
  kind: "commit"
  ref: string
  mark: number
  /** Its ID in the repository read. */
  oid: string
  /** `<name> <<email>> <when>`, as the commit holds it; null without one. */
  author: Buffer | null
  committer: Buffer
  /** The commit's `encoding` header, when it has one. */
  encoding: Buffer | null
  message: Buffer
  /** The first parent, as `:<mark>` or a commit ID; null for a root commit. */
  from: string | null
  merges: string[]
  changes: HistoryChange[]
}

/** A branch set to a commit (`from`), or made ready for a root commit. */
export interface HistoryReset {
  kind: "reset"
  ref: string
  from: string | null
}

export type HistoryItem = HistoryBlob | HistoryCommit | HistoryReset

/** An identity of a commit, split: the parts a rewrite may change, and the time. */
export interface IdentityParts {
  name: Buffer
  email: Buffer
  when: Buffer
}

/** Splits `Name <email> 1790000000 +0000`. */
export function splitIdentity(value: Buffer): IdentityParts {
  const open = value.indexOf(0x3c)
  const close = open < 0 ? -1 : value.indexOf(0x3e, open)
  if (open < 0 || close < 0)
    throw new GitError("exit", "fast-export", "A commit identity has no email")
  let nameEnd = open
  if (nameEnd > 0 && value[nameEnd - 1] === 0x20) nameEnd--
  return {
    name: value.subarray(0, nameEnd),
    email: value.subarray(open + 1, close),
    when: value.subarray(close + 2),
  }
}

/** The identity `splitIdentity` split, written again. */
export function joinIdentity(parts: IdentityParts): Buffer {
  return Buffer.concat([
    parts.name,
    parts.name.length > 0 ? Buffer.from(" <") : Buffer.from("<"),
    parts.email,
    Buffer.from("> "),
    parts.when,
  ])
}

/** Reads a stream as lines and length-counted data. */
class StreamReader {
  private chunks: Buffer[] = []
  private size = 0
  private ended = false
  private readonly iterator: AsyncIterator<Buffer>

  constructor(stream: Readable) {
    this.iterator = (stream as AsyncIterable<Buffer>)[Symbol.asyncIterator]()
  }

  private async fill(): Promise<boolean> {
    if (this.ended) return false
    const next = await this.iterator.next()
    if (next.done) {
      this.ended = true
      return false
    }
    this.chunks.push(next.value)
    this.size += next.value.length
    return true
  }

  private take(n: number): Buffer {
    const all =
      this.chunks.length === 1 ? this.chunks[0]! : Buffer.concat(this.chunks)
    const taken = all.subarray(0, n)
    const rest = all.subarray(n)
    this.chunks = rest.length > 0 ? [rest] : []
    this.size = rest.length
    return taken
  }

  /** The next line without its LF, or null at the end. */
  async line(): Promise<Buffer | null> {
    for (;;) {
      let offset = 0
      for (const chunk of this.chunks) {
        const at = chunk.indexOf(0x0a)
        if (at >= 0) {
          const line = this.take(offset + at + 1)
          return line.subarray(0, line.length - 1)
        }
        offset += chunk.length
      }
      if (this.size > 1024 * 1024)
        throw new GitError("exit", "fast-export", "A line is too long")
      if (!(await this.fill())) {
        if (this.size === 0) return null
        return this.take(this.size)
      }
    }
  }

  async bytes(n: number): Promise<Buffer> {
    while (this.size < n) {
      if (!(await this.fill()))
        throw new GitError("exit", "fast-export", "The history ended early")
    }
    return Buffer.from(this.take(n))
  }

  /** Takes one LF if it comes next (the optional LF after data). */
  async optionalLineFeed(): Promise<void> {
    if (this.size === 0 && !(await this.fill())) return
    const first = this.chunks[0]!
    if (first[0] === 0x0a) this.take(1)
  }
}

const text = (b: Buffer) => b.toString("utf8")

function startsWith(line: Buffer, prefix: string): boolean {
  return (
    line.length >= prefix.length &&
    line.subarray(0, prefix.length).toString("latin1") === prefix
  )
}

/** A path as fast-export writes it: as is, or in C-style quotes. */
export function unquotePath(value: Buffer): Buffer {
  if (value[0] !== 0x22) return value
  const out: number[] = []
  for (let i = 1; i < value.length; i++) {
    const c = value[i]!
    if (c === 0x22) {
      if (i !== value.length - 1)
        throw new GitError(
          "exit",
          "fast-export",
          "A quoted path has more after it",
        )
      return Buffer.from(out)
    }
    if (c !== 0x5c) {
      out.push(c)
      continue
    }
    const e = value[++i]
    const simple: Record<number, number> = {
      0x61: 7,
      0x62: 8,
      0x66: 12,
      0x6e: 10,
      0x72: 13,
      0x74: 9,
      0x76: 11,
      0x5c: 0x5c,
      0x22: 0x22,
    }
    if (e !== undefined && simple[e] !== undefined) out.push(simple[e])
    else if (e !== undefined && e >= 0x30 && e <= 0x33) {
      const digits = value.subarray(i, i + 3).toString("latin1")
      if (!/^[0-3][0-7]{2}$/.test(digits))
        throw new GitError("exit", "fast-export", "A quoted path is malformed")
      out.push(parseInt(digits, 8))
      i += 2
    } else
      throw new GitError("exit", "fast-export", "A quoted path is malformed")
  }
  throw new GitError("exit", "fast-export", "A quoted path is not closed")
}

/** A path in C-style quotes, every byte outside printable ASCII escaped. */
export function quotePath(path: Buffer): string {
  let out = '"'
  for (const c of path) {
    if (c === 0x22 || c === 0x5c) out += `\\${String.fromCharCode(c)}`
    else if (c >= 0x20 && c < 0x7f) out += String.fromCharCode(c)
    else out += `\\${c.toString(8).padStart(3, "0")}`
  }
  return `${out}"`
}

/** Reads the stream's next `data <n>` and its bytes. */
async function readData(reader: StreamReader, line: Buffer | null) {
  const match = line && /^data (\d{1,12})$/.exec(text(line))
  if (!match)
    throw new GitError("exit", "fast-export", "Expected data in the history")
  const data = await reader.bytes(Number(match[1]))
  await reader.optionalLineFeed()
  return data
}

function markOf(line: Buffer | null): number {
  const match = line && /^mark :(\d{1,10})$/.exec(text(line))
  if (!match)
    throw new GitError("exit", "fast-export", "Expected a mark in the history")
  return Number(match[1])
}

function originalOf(line: Buffer | null): string {
  const match =
    line && /^original-oid ([0-9a-f]{40}|[0-9a-f]{64})$/.exec(text(line))
  if (!match)
    throw new GitError(
      "exit",
      "fast-export",
      "Expected an original object ID in the history",
    )
  return match[1]!
}

/** Parses fast-export's output, calling `onItem` for each item, in order. */
async function parse(
  stream: Readable,
  onItem: (item: HistoryItem) => Promise<void> | void,
): Promise<void> {
  const reader = new StreamReader(stream)
  let pending: Buffer | null = null
  const next = async () => {
    if (pending !== null) {
      const line = pending
      pending = null
      return line
    }
    return reader.line()
  }
  let done = false
  for (;;) {
    const line = await next()
    if (line === null) break
    const command = text(line)
    if (command === "" || command === "feature done") continue
    if (command === "done") {
      done = true
      break
    }
    if (command === "blob") {
      const mark = markOf(await next())
      const oid = originalOf(await next())
      const data = await readData(reader, await next())
      await onItem({ kind: "blob", mark, oid, data })
    } else if (command.startsWith("reset ")) {
      const ref = command.slice("reset ".length)
      const after = await next()
      let from: string | null = null
      if (after !== null && startsWith(after, "from "))
        from = text(after).slice(5)
      else pending = after
      await onItem({ kind: "reset", ref, from })
    } else if (command.startsWith("commit ")) {
      const ref = command.slice("commit ".length)
      const mark = markOf(await next())
      const oid = originalOf(await next())
      let field = await next()
      let author: Buffer | null = null
      if (field && startsWith(field, "author ")) {
        author = field.subarray(7)
        field = await next()
      }
      if (!field || !startsWith(field, "committer "))
        throw new GitError("exit", "fast-export", "A commit has no committer")
      const committer = field.subarray(10)
      field = await next()
      let encoding: Buffer | null = null
      if (field && startsWith(field, "encoding ")) {
        encoding = field.subarray(9)
        field = await next()
      }
      const message = await readData(reader, field)
      const commit: HistoryCommit = {
        kind: "commit",
        ref,
        mark,
        oid,
        author,
        committer,
        encoding,
        message,
        from: null,
        merges: [],
        changes: [],
      }
      for (;;) {
        const sub = await next()
        if (sub === null || sub.length === 0) break
        const s = text(sub)
        if (s.startsWith("from ")) commit.from = s.slice(5)
        else if (s.startsWith("merge ")) commit.merges.push(s.slice(6))
        else if (s === "deleteall") commit.changes.push({ op: "deleteall" })
        else if (startsWith(sub, "M ")) {
          const first = sub.indexOf(0x20, 2)
          const second = first < 0 ? -1 : sub.indexOf(0x20, first + 1)
          if (second < 0)
            throw new GitError(
              "exit",
              "fast-export",
              "A file change is malformed",
            )
          commit.changes.push({
            op: "M",
            mode: sub.subarray(2, first).toString("latin1"),
            dataref: sub.subarray(first + 1, second).toString("latin1"),
            path: unquotePath(sub.subarray(second + 1)),
          })
        } else if (startsWith(sub, "D ")) {
          commit.changes.push({ op: "D", path: unquotePath(sub.subarray(2)) })
        } else {
          // The commit ended without its empty line: the LF after its
          // message was taken as data's optional LF.
          pending = sub
          break
        }
      }
      await onItem(commit)
    } else {
      throw new GitError(
        "exit",
        "fast-export",
        `The history holds something Shinan does not rewrite (${command.split(" ")[0]!.slice(0, 20)})`,
      )
    }
  }
  if (!done)
    throw new GitError("exit", "fast-export", "The history ended early")
}

/** An item as fast-import reads it. */
function serialize(item: HistoryItem): Buffer[] {
  const data = (bytes: Buffer) => [
    Buffer.from(`data ${bytes.length}\n`),
    bytes,
    Buffer.from("\n"),
  ]
  switch (item.kind) {
    case "blob":
      return [Buffer.from(`blob\nmark :${item.mark}\n`), ...data(item.data)]
    case "reset":
      return [
        Buffer.from(
          `reset ${item.ref}\n${item.from === null ? "" : `from ${item.from}\n`}\n`,
        ),
      ]
    case "commit": {
      const parts: Buffer[] = [
        Buffer.from(`commit ${item.ref}\nmark :${item.mark}\n`),
      ]
      if (item.author)
        parts.push(Buffer.from("author "), item.author, Buffer.from("\n"))
      parts.push(Buffer.from("committer "), item.committer, Buffer.from("\n"))
      if (item.encoding)
        parts.push(Buffer.from("encoding "), item.encoding, Buffer.from("\n"))
      parts.push(...data(item.message))
      if (item.from !== null) parts.push(Buffer.from(`from ${item.from}\n`))
      for (const merge of item.merges)
        parts.push(Buffer.from(`merge ${merge}\n`))
      for (const change of item.changes) {
        if (change.op === "deleteall") parts.push(Buffer.from("deleteall\n"))
        else if (change.op === "D")
          parts.push(Buffer.from(`D ${quotePath(change.path)}\n`))
        else
          parts.push(
            Buffer.from(
              `M ${change.mode} ${change.dataref} ${quotePath(change.path)}\n`,
            ),
          )
      }
      parts.push(Buffer.from("\n"))
      return parts
    }
  }
}

/** Collects a process's standard error, up to a limit, for its failure message. */
function errorsOf(proc: GitProcess): () => string {
  const kept: Buffer[] = []
  let size = 0
  proc.child.stderr.on("data", (chunk: Buffer) => {
    if (size >= MAX_STDERR_BYTES) return
    kept.push(chunk.subarray(0, MAX_STDERR_BYTES - size))
    size += chunk.length
  })
  return () => Buffer.concat(kept).toString("utf8")
}

async function ended(
  proc: GitProcess,
  command: string,
  stderr: () => string,
): Promise<void> {
  const { code, signal, timedOut } = await proc.ended
  if (timedOut)
    throw new GitError(
      "timeout",
      command,
      `git ${command} took too long and was stopped`,
    )
  if (code !== 0) {
    const first = stderr().split("\n", 1)[0]?.slice(0, 200) ?? ""
    throw new GitError(
      "exit",
      command,
      `git ${command} failed (${signal ? `signal ${signal}` : `exit code ${code}`})${first ? `: ${first}` : ""}`,
      code,
      stderr(),
    )
  }
}

/** Which part of a history to read, and the marks of an earlier read. */
export interface HistoryRange {
  /**
   * Revisions to read instead of every ref (`--all`), such as new tips and
   * `^<an old tip>`: what is new since.
   */
  revisions?: string[]
  /**
   * fast-export's marks file: read first when it exists, so what it marks
   * is not read again, and written after.
   */
  marksFile?: string
}

function exportProcess(
  git: Git,
  gitDir: string,
  timeoutMs?: number,
  range: HistoryRange = {},
) {
  for (const revision of range.revisions ?? [])
    if (
      !/^\^?(?:[0-9a-f]{40}|[0-9a-f]{64}|refs\/heads\/[^\s]+)$/.test(revision)
    )
      throw new Error("A history read was given a revision that is not one")
  const marks = range.marksFile
    ? [
        ...(existsSync(range.marksFile)
          ? [`--import-marks=${range.marksFile}`]
          : []),
        `--export-marks=${range.marksFile}`,
      ]
    : []
  // Every ref, with each object's ID; commit messages as they are stored
  // (`--reencode=no` keeps an `encoding` header), so commits nothing
  // changes keep their IDs.
  return git.spawn(
    [
      "fast-export",
      ...marks,
      "--show-original-ids",
      "--reencode=no",
      "--use-done-feature",
      "--signed-tags=strip",
      "--tag-of-filtered-object=drop",
      ...(range.revisions ?? ["--all"]),
    ],
    { gitDir, timeoutMs },
  )
}

/**
 * Reads a repository's whole history (every ref), one item at a time, in
 * the order fast-export writes it: each blob before the first commit that
 * uses it, each commit after its parents.
 */
export async function readHistory(
  git: Git,
  gitDir: string,
  onItem: (item: HistoryItem) => Promise<void> | void,
  options: { timeoutMs?: number } & HistoryRange = {},
): Promise<void> {
  const proc = exportProcess(git, gitDir, options.timeoutMs, options)
  const stderr = errorsOf(proc)
  try {
    await parse(proc.child.stdout, onItem)
  } catch (error) {
    proc.kill()
    await proc.ended
    throw error
  }
  await ended(proc, "fast-export", stderr)
}

/** Writes `parts`, waiting for the reader; fails if it ends (`closed`) first. */
async function write(
  stream: Writable,
  parts: Buffer[],
  closed: Promise<unknown>,
): Promise<void> {
  for (const part of parts) {
    if (stream.write(part)) continue
    await Promise.race([
      new Promise<void>((resolve) => stream.once("drain", resolve)),
      closed.then(() => {
        throw new GitError(
          "exit",
          "fast-import",
          "git fast-import stopped early",
        )
      }),
    ])
  }
}

/** What `rewriteHistory` wrote. */
export interface RewrittenHistory {
  /** Every commit, by its ID in the repository read, with its new ID. */
  commits: Map<string, string>
  /** Each ref of the new repository, with the name it had in the one read. */
  refs: { ref: string; was: string; commit: string }[]
}

/**
 * Rewrites a repository's whole history into `target`, an empty repository:
 * `git fast-export --all` of `source`, each item passed through `change`
 * (which may change blobs' data, commits' messages, identities and paths,
 * and refs' names), into `git fast-import`. A commit `change` leaves alone,
 * with parents that kept theirs, keeps its ID. Returns each commit's new ID,
 * from fast-import's marks, and the new refs.
 *
 * Both sides' marks are kept in `temporaryDir`, so a second call with
 * `again` rewrites only what the source gained since (review of #197): the
 * commits it returns are those, and the refs of `target` are left for the
 * caller to set.
 *
 * `change` must give each ref the same new name every time, and different
 * refs different names.
 */
export async function rewriteHistory(
  git: Git,
  source: string,
  target: string,
  change: (item: HistoryItem) => Promise<HistoryItem> | HistoryItem,
  options: { timeoutMs?: number; temporaryDir: string; again?: boolean },
): Promise<RewrittenHistory> {
  const marksFile = join(options.temporaryDir, "marks")
  const sourceMarks = join(options.temporaryDir, "source-marks")
  if (!options.again) rmSync(sourceMarks, { force: true })
  const importer = git.spawn(
    [
      "fast-import",
      "--quiet",
      "--done",
      ...(options.again ? [`--import-marks=${marksFile}`] : []),
      `--export-marks=${marksFile}`,
    ],
    { gitDir: target, timeoutMs: options.timeoutMs },
  )
  const importErrors = errorsOf(importer)
  const commitMarks = new Map<number, string>()
  const renamed = new Map<string, string>()
  let failure: unknown
  try {
    await readHistory(
      git,
      source,
      async (item) => {
        const changed = await change(item)
        if (changed.kind !== item.kind)
          throw new Error("A history rewrite changed an item's kind")
        if (item.kind === "commit") commitMarks.set(item.mark, item.oid)
        if (item.kind !== "blob" && changed.kind !== "blob") {
          const known = renamed.get(item.ref)
          if (known !== undefined && known !== changed.ref)
            throw new Error("A history rewrite renamed a ref two ways")
          renamed.set(item.ref, changed.ref)
        }
        await write(importer.child.stdin, serialize(changed), importer.ended)
      },
      { timeoutMs: options.timeoutMs, marksFile: sourceMarks },
    )
    await write(importer.child.stdin, [Buffer.from("done\n")], importer.ended)
  } catch (error) {
    failure = error
    importer.kill()
  }
  importer.child.stdin.end()
  try {
    await ended(importer, "fast-import", importErrors)
  } catch (error) {
    failure ??= error
  }
  if (failure) throw failure as Error

  const marks = new Map<number, string>()
  for (const line of readFileSync(marksFile, "utf8").split("\n")) {
    const match = /^:(\d+) ([0-9a-f]{40}|[0-9a-f]{64})$/.exec(line)
    if (match) marks.set(Number(match[1]), match[2]!)
  }
  const commits = new Map<string, string>()
  for (const [mark, oid] of commitMarks) {
    const now = marks.get(mark)
    if (!now) throw new Error("fast-import gave a commit no ID")
    commits.set(oid, now)
  }
  const { stdout } = await git.run(
    ["for-each-ref", "--format=%(objectname) %(refname)"],
    { gitDir: target },
  )
  const was = new Map([...renamed].map(([from, to]) => [to, from]))
  const refs = stdout
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const space = line.indexOf(" ")
      const ref = line.slice(space + 1)
      return { ref, was: was.get(ref) ?? ref, commit: line.slice(0, space) }
    })
  return { commits, refs }
}

/** An object of a repository, as `readAllObjects` gives it. */
export interface StoredObject {
  oid: string
  type: "blob" | "tree" | "commit" | "tag"
  content: Buffer
}

/**
 * Reads every object a repository holds, reachable or not, packed or loose
 * (`git cat-file --batch-all-objects --batch`), one at a time: what any
 * reader of the repository could ask for by its ID. Objects larger than
 * `maxObjectBytes` are given with their content cut there.
 */
export async function readAllObjects(
  git: Git,
  gitDir: string,
  onObject: (object: StoredObject) => Promise<void> | void,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const proc = git.spawn(
    ["cat-file", "--batch-all-objects", "--unordered", "--batch"],
    { gitDir, timeoutMs: options.timeoutMs },
  )
  proc.child.stdin.end()
  const stderr = errorsOf(proc)
  const reader = new StreamReader(proc.child.stdout)
  try {
    for (;;) {
      const header = await reader.line()
      if (header === null || header.length === 0) break
      const match =
        /^([0-9a-f]{40}|[0-9a-f]{64}) (blob|tree|commit|tag) (\d+)$/.exec(
          header.toString("latin1"),
        )
      if (!match)
        throw new GitError(
          "exit",
          "cat-file",
          "cat-file wrote an unexpected line",
        )
      const content = await reader.bytes(Number(match[3]))
      await reader.bytes(1)
      await onObject({
        oid: match[1]!,
        type: match[2] as StoredObject["type"],
        content,
      })
    }
  } catch (error) {
    proc.kill()
    await proc.ended
    throw error
  }
  await ended(proc, "cat-file", stderr)
}

/** The names of a tree object's entries, as bytes. */
export function treeEntryNames(tree: Buffer, oidBytes = 20): Buffer[] {
  const names: Buffer[] = []
  let at = 0
  while (at < tree.length) {
    const space = tree.indexOf(0x20, at)
    const nul = tree.indexOf(0, space)
    if (space < 0 || nul < 0)
      throw new GitError("exit", "cat-file", "A tree is malformed")
    names.push(tree.subarray(space + 1, nul))
    at = nul + 1 + oidBytes
  }
  return names
}

/**
 * The parts of a commit object that hold text people or agents wrote: the
 * names and emails of its identities, the values of headers other than its
 * tree, parents and identities, and its message. Object IDs and times are
 * left out, so a text that looks like part of one is not taken for a copy.
 */
export function commitTexts(commit: Buffer): Buffer[] {
  const end = commit.indexOf("\n\n")
  const head = end < 0 ? commit : commit.subarray(0, end)
  const texts: Buffer[] = []
  for (let at = 0; at < head.length;) {
    let next = head.indexOf(0x0a, at)
    if (next < 0) next = head.length
    const line = head.subarray(at, next)
    at = next + 1
    const space = line.indexOf(0x20)
    const key = line.subarray(0, Math.max(space, 0)).toString("latin1")
    const value = line.subarray(space + 1)
    if (key === "tree" || key === "parent") continue
    if (key === "author" || key === "committer") {
      const { name, email } = splitIdentity(value)
      texts.push(name, email)
    } else texts.push(value)
  }
  if (end >= 0) texts.push(commit.subarray(end + 2))
  return texts
}

/** Every object a repository holds, reachable or not, by ID and type (`cat-file --batch-check`). */
export async function listObjects(
  git: Git,
  gitDir: string,
  options: { timeoutMs?: number } = {},
): Promise<Map<string, StoredObject["type"]>> {
  const { stdout } = await git.run(
    [
      "cat-file",
      "--batch-all-objects",
      "--unordered",
      "--batch-check=%(objectname) %(objecttype)",
    ],
    {
      gitDir,
      timeoutMs: options.timeoutMs,
      maxOutputBytes: 1024 * 1024 * 1024,
    },
  )
  const objects = new Map<string, StoredObject["type"]>()
  for (const line of stdout.toString("latin1").split("\n")) {
    const space = line.indexOf(" ")
    if (space > 0)
      objects.set(
        line.slice(0, space),
        line.slice(space + 1) as StoredObject["type"],
      )
  }
  return objects
}

/** The objects the repository's refs reach (`rev-list --objects --all`). */
export async function reachableObjects(
  git: Git,
  gitDir: string,
  options: { timeoutMs?: number } = {},
): Promise<Set<string>> {
  const { stdout } = await git.run(["rev-list", "--objects", "--all"], {
    gitDir,
    timeoutMs: options.timeoutMs,
    maxOutputBytes: 1024 * 1024 * 1024,
  })
  const reached = new Set<string>()
  for (const line of stdout.toString("latin1").split("\n"))
    if (line.length >= 40)
      reached.add(
        line.slice(0, line.indexOf(" ") < 0 ? line.length : line.indexOf(" ")),
      )
  return reached
}

/** The given objects' contents, one at a time (`cat-file --batch`), streamed. */
export async function readObjects(
  git: Git,
  gitDir: string,
  oids: Iterable<string>,
  onObject: (object: StoredObject) => Promise<void> | void,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const proc = git.spawn(["cat-file", "--batch"], {
    gitDir,
    timeoutMs: options.timeoutMs,
  })
  const stderr = errorsOf(proc)
  const list = [...oids]
  // Written while it is read, so neither side waits on a full pipe.
  const writing = (async () => {
    for (const oid of list)
      if (!proc.child.stdin.write(`${oid}\n`))
        await new Promise<void>((resolve) =>
          proc.child.stdin.once("drain", resolve),
        )
    proc.child.stdin.end()
  })().catch(() => {})
  const reader = new StreamReader(proc.child.stdout)
  try {
    for (let i = 0; i < list.length; i++) {
      const header = await reader.line()
      if (header === null) break
      const match =
        /^([0-9a-f]{40}|[0-9a-f]{64}) (blob|tree|commit|tag) (\d+)$/.exec(
          header.toString("latin1"),
        )
      if (!match) continue
      const content = await reader.bytes(Number(match[3]))
      await reader.bytes(1)
      await onObject({
        oid: match[1]!,
        type: match[2] as StoredObject["type"],
        content,
      })
    }
  } catch (error) {
    proc.kill()
    await proc.ended
    throw error
  }
  await writing
  await ended(proc, "cat-file", stderr)
}
