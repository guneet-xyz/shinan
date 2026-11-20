import type { CatFile } from "./cat-file.js"
import { GitError } from "./run.js"

/**
 * Comparing two trees by reading their tree objects through a `cat-file`
 * reader, one object at a time, rather than with `git diff-tree`, which
 * builds its whole list of changes before printing any of it (50,000 paths
 * of 4 KiB are 200 MiB inside Git). The walk holds only the tree objects
 * on its current path, as their bytes (entries are read from them one at a
 * time, never all made into objects), skips subtrees whose IDs are equal,
 * and stops whenever its caller has enough or its work budget runs out.
 */

/** Git's limit on how deep trees nest (`core.maxTreeDepth`). */
export const MAX_TREE_DEPTH = 2048
/** The largest single tree object read: about 500,000 entries in one folder. */
export const MAX_TREE_OBJECT_BYTES = 16 * 1024 * 1024
/** The most bytes of tree objects held at once, along one path. */
export const MAX_HELD_TREE_BYTES = 64 * 1024 * 1024

/**
 * How much one request's walks may do: tree objects read and tree entries
 * visited, shared by every walk of the request. Past either, the walks stop
 * early, as if their caller had enough; they never fail for it. A catalog
 * at its limits (20,000 documents) needs a small part of it for one diff,
 * and a history page of 100 such commits fits too.
 */
export interface WalkBudget {
  objects: number
  entries: number
}

/** A new budget with the default sizes. */
export function walkBudget(): WalkBudget {
  return { objects: 20_000, entries: 5_000_000 }
}

/** A change between two trees, as `git diff-tree --raw -r` reports it. */
export interface WalkChange {
  status: "added" | "deleted" | "modified" | "type-changed"
  path: string
  oldMode: string | null
  oldOid: string | null
  newMode: string | null
  newOid: string | null
}

/** How a walk ended. */
export interface WalkEnd {
  /** Its caller asked it to stop. */
  stopped: boolean
  /** Its work budget ran out: changes after that were not found. */
  exhausted: boolean
}

/**
 * Reads a tree object's entries one at a time, as views into its bytes:
 * an entry costs nothing until it is looked at.
 */
class TreeCursor {
  private at = 0
  /** The current entry's mode, name (a view) and ID bytes (a view). */
  mode = ""
  name: Buffer = Buffer.alloc(0)
  id: Buffer = Buffer.alloc(0)
  done = false

  constructor(
    private readonly content: Buffer,
    private readonly oidBytes: number,
  ) {
    this.next()
  }

  /** Moves to the next entry, or sets `done`. */
  next(): void {
    if (this.at >= this.content.length) {
      this.done = true
      return
    }
    const space = this.content.indexOf(0x20, this.at)
    const nul = space < 0 ? -1 : this.content.indexOf(0, space + 1)
    if (space < 0 || nul < 0 || nul + 1 + this.oidBytes > this.content.length) {
      throw new GitError("exit", "cat-file", "A tree object Shinan cannot read")
    }
    this.mode = this.content
      .subarray(this.at, space)
      .toString("latin1")
      .padStart(6, "0")
    this.name = this.content.subarray(space + 1, nul)
    this.id = this.content.subarray(nul + 1, nul + 1 + this.oidBytes)
    this.at = nul + 1 + this.oidBytes
  }

  get isTree(): boolean {
    return this.mode === "040000"
  }

  get oid(): string {
    return this.id.toString("hex")
  }
}

/** The kind of a non-tree entry: a file, a symbolic link or a submodule. */
const kind = (mode: string) =>
  mode === "120000" ? "link" : mode === "160000" ? "submodule" : "file"

/**
 * Git's order of tree entries: by name, byte for byte, as if each tree's
 * name ended with `/`.
 */
function compare(a: TreeCursor, b: TreeCursor): number {
  const length = Math.min(a.name.length, b.name.length)
  const common = Buffer.compare(
    a.name.subarray(0, length),
    b.name.subarray(0, length),
  )
  if (common !== 0) return common
  const next = (e: TreeCursor) =>
    e.name.length > length ? e.name[length]! : e.isTree ? 0x2f : 0
  return next(a) - next(b)
}

/** A snapshot of the entry a cursor is on, for a change. */
function entryOf(c: TreeCursor) {
  return { mode: c.mode, oid: c.oid }
}

/**
 * Walks the differences between two trees (`from` `null`: the empty tree)
 * in Git's order, handing each to `onChange`; `onChange` returns `false` to
 * stop. `budget` is shared by every walk of one request and spent as the
 * walk reads tree objects and visits entries.
 */
export async function walkTreeDiff(
  reader: CatFile,
  from: string | null,
  to: string,
  onChange: (change: WalkChange) => boolean | void,
  budget: WalkBudget = walkBudget(),
): Promise<WalkEnd> {
  const oidBytes = to.length / 2
  let held = 0
  let stopped = false
  let exhausted = false
  const done = () => stopped || exhausted

  const spend = (objects: number, entries: number) => {
    budget.objects -= objects
    budget.entries -= entries
    if (budget.objects < 0 || budget.entries < 0) exhausted = true
  }

  /** A tree object's bytes, counted as held until `release`. */
  const read = async (oid: string, depth: number): Promise<Buffer | null> => {
    if (depth > MAX_TREE_DEPTH) {
      throw new GitError(
        "exit",
        "diff",
        "exceeded maximum allowed tree depth",
        null,
        "exceeded maximum allowed tree depth",
      )
    }
    spend(1, 0)
    if (exhausted) return null
    const object = await reader.read(oid)
    if (object === "too-large") {
      throw new GitError(
        "exit",
        "diff",
        "tree object too large",
        null,
        "tree object too large",
      )
    }
    if (typeof object === "string" || object.type !== "tree") {
      throw new GitError("exit", "diff", `Tree ${oid} could not be read`)
    }
    held += object.content.length
    if (held > MAX_HELD_TREE_BYTES) {
      throw new GitError(
        "exit",
        "diff",
        "tree objects too large",
        null,
        "tree object too large",
      )
    }
    return object.content
  }
  const release = (content: Buffer | null) => {
    if (content) held -= content.length
  }

  const emit = (change: WalkChange) => {
    if (onChange(change) === false) stopped = true
  }

  /** A path that is not a tree on whichever sides it is on. */
  const one = (
    path: string,
    old: { mode: string; oid: string } | null,
    now: { mode: string; oid: string } | null,
  ) => {
    if (old && now) {
      emit({
        status: kind(old.mode) === kind(now.mode) ? "modified" : "type-changed",
        path,
        oldMode: old.mode,
        oldOid: old.oid,
        newMode: now.mode,
        newOid: now.oid,
      })
    } else if (old) {
      emit({
        status: "deleted",
        path,
        oldMode: old.mode,
        oldOid: old.oid,
        newMode: null,
        newOid: null,
      })
    } else if (now) {
      emit({
        status: "added",
        path,
        oldMode: null,
        oldOid: null,
        newMode: now.mode,
        newOid: now.oid,
      })
    }
  }

  /** Every file under a tree that is only on one side. */
  const all = async (
    oid: string,
    prefix: string,
    depth: number,
    side: "added" | "deleted",
  ): Promise<void> => {
    const content = await read(oid, depth)
    if (!content) return
    try {
      for (
        const c = new TreeCursor(content, oidBytes);
        !c.done && !done();
        c.next()
      ) {
        spend(0, 1)
        if (exhausted) return
        const path = prefix + c.name.toString("utf8")
        if (c.isTree) await all(c.oid, `${path}/`, depth + 1, side)
        else if (side === "deleted") one(path, entryOf(c), null)
        else one(path, null, entryOf(c))
      }
    } finally {
      release(content)
    }
  }

  const walk = async (
    oldOid: string | null,
    newOid: string,
    prefix: string,
    depth: number,
  ): Promise<void> => {
    if (oldOid === newOid) return
    const olds = oldOid === null ? Buffer.alloc(0) : await read(oldOid, depth)
    if (!olds) return
    try {
      const news = await read(newOid, depth)
      if (!news) return
      try {
        const o = new TreeCursor(olds, oidBytes)
        const n = new TreeCursor(news, oidBytes)
        while ((!o.done || !n.done) && !done()) {
          spend(0, 1)
          if (exhausted) return
          const order = o.done ? 1 : n.done ? -1 : compare(o, n)
          if (order < 0) {
            const path = prefix + o.name.toString("utf8")
            if (o.isTree) {
              const oid = o.oid
              o.next()
              await all(oid, `${path}/`, depth + 1, "deleted")
            } else {
              const old = entryOf(o)
              o.next()
              one(path, old, null)
            }
          } else if (order > 0) {
            const path = prefix + n.name.toString("utf8")
            if (n.isTree) {
              const oid = n.oid
              n.next()
              await all(oid, `${path}/`, depth + 1, "added")
            } else {
              const now = entryOf(n)
              n.next()
              one(path, null, now)
            }
          } else {
            if (o.mode === n.mode && o.id.equals(n.id)) {
              o.next()
              n.next()
              continue
            }
            const path = prefix + n.name.toString("utf8")
            const old = entryOf(o)
            const now = entryOf(n)
            const trees = o.isTree
            o.next()
            n.next()
            if (trees) await walk(old.oid, now.oid, `${path}/`, depth + 1)
            else one(path, old, now)
          }
        }
      } finally {
        release(news)
      }
    } finally {
      release(olds)
    }
  }

  await walk(from, to, "", 1)
  return { stopped, exhausted }
}
