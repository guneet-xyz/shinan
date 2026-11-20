import type { CatFile } from "./cat-file.js"
import { GitError } from "./run.js"

/**
 * Comparing two trees by reading their tree objects through a `cat-file`
 * reader, one object at a time, rather than with `git diff-tree`, which
 * builds its whole list of changes before printing any of it (50,000 paths
 * of 4 KiB are 200 MiB inside Git). This walk holds only the trees on its
 * current path, skips subtrees whose IDs are equal, and stops whenever its
 * caller has enough.
 */

/** Git's limit on how deep trees nest (`core.maxTreeDepth`). */
export const MAX_TREE_DEPTH = 2048
/** The largest single tree object read. */
export const MAX_TREE_OBJECT_BYTES = 16 * 1024 * 1024
/** The most bytes of tree objects held at once, along one path. */
export const MAX_HELD_TREE_BYTES = 64 * 1024 * 1024

/** One entry of a tree object. */
interface Entry {
  /** Git's mode, six digits: `100644`, `100755`, `120000`, `160000`, `040000`. */
  mode: string
  name: Buffer
  oid: string
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

const isTree = (entry: Entry) => entry.mode === "040000"

/** The kind of a non-tree entry: a file, a symbolic link or a submodule. */
const kind = (mode: string) =>
  mode === "120000" ? "link" : mode === "160000" ? "submodule" : "file"

/** Reads a tree object's entries. */
export function parseTree(content: Buffer, oidBytes: number): Entry[] {
  const entries: Entry[] = []
  let at = 0
  while (at < content.length) {
    const space = content.indexOf(0x20, at)
    const nul = space < 0 ? -1 : content.indexOf(0, space + 1)
    if (space < 0 || nul < 0 || nul + 1 + oidBytes > content.length) {
      throw new GitError("exit", "cat-file", "A tree object Shinan cannot read")
    }
    entries.push({
      mode: content.subarray(at, space).toString("latin1").padStart(6, "0"),
      name: content.subarray(space + 1, nul),
      oid: content.subarray(nul + 1, nul + 1 + oidBytes).toString("hex"),
    })
    at = nul + 1 + oidBytes
  }
  return entries
}

/**
 * Git's order of tree entries: by name, byte for byte, as if each tree's
 * name ended with `/`.
 */
function compare(a: Entry, b: Entry): number {
  const length = Math.min(a.name.length, b.name.length)
  const common = Buffer.compare(
    a.name.subarray(0, length),
    b.name.subarray(0, length),
  )
  if (common !== 0) return common
  const next = (e: Entry) =>
    e.name.length > length ? e.name[length]! : isTree(e) ? 0x2f : 0
  return next(a) - next(b)
}

/**
 * Walks the differences between two trees (`from` `null`: the empty tree)
 * in Git's order, handing each to `onChange`; `onChange` returns `false` to
 * stop. Answers whether it stopped.
 */
export async function walkTreeDiff(
  reader: CatFile,
  from: string | null,
  to: string,
  onChange: (change: WalkChange) => boolean | void,
): Promise<boolean> {
  const oidBytes = to.length / 2
  let held = 0
  let stopped = false

  const read = async (oid: string, depth: number): Promise<Entry[]> => {
    if (depth > MAX_TREE_DEPTH) {
      throw new GitError(
        "exit",
        "diff",
        "exceeded maximum allowed tree depth",
        null,
        "exceeded maximum allowed tree depth",
      )
    }
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
    const entries = parseTree(object.content, oidBytes)
    return Object.assign(entries, { bytes: object.content.length })
  }

  const emit = (change: WalkChange) => {
    if (onChange(change) === false) stopped = true
  }

  /** Every file under a tree that is only on one side. */
  const all = async (
    oid: string,
    prefix: string,
    depth: number,
    side: "added" | "deleted",
  ): Promise<void> => {
    const entries = await read(oid, depth)
    try {
      for (const entry of entries) {
        if (stopped) return
        const path = prefix + entry.name.toString("utf8")
        if (isTree(entry)) await all(entry.oid, `${path}/`, depth + 1, side)
        else
          one(
            path,
            side === "deleted" ? entry : null,
            side === "added" ? entry : null,
          )
      }
    } finally {
      held -= (entries as Entry[] & { bytes: number }).bytes
    }
  }

  /** A path that is not a tree on either side it is on. */
  const one = (path: string, old: Entry | null, now: Entry | null) => {
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

  const walk = async (
    oldOid: string | null,
    newOid: string,
    prefix: string,
    depth: number,
  ): Promise<void> => {
    if (oldOid === newOid) return
    const olds: Entry[] = oldOid === null ? [] : await read(oldOid, depth)
    try {
      const news = await read(newOid, depth)
      try {
        let i = 0
        let j = 0
        while ((i < olds.length || j < news.length) && !stopped) {
          const old = olds[i]
          const now = news[j]
          const order = !old ? 1 : !now ? -1 : compare(old, now)
          if (order < 0) {
            i++
            const path = prefix + old!.name.toString("utf8")
            if (isTree(old!))
              await all(old!.oid, `${path}/`, depth + 1, "deleted")
            else one(path, old!, null)
          } else if (order > 0) {
            j++
            const path = prefix + now!.name.toString("utf8")
            if (isTree(now!))
              await all(now!.oid, `${path}/`, depth + 1, "added")
            else one(path, null, now!)
          } else {
            i++
            j++
            if (old!.oid === now!.oid && old!.mode === now!.mode) continue
            const path = prefix + now!.name.toString("utf8")
            if (isTree(old!))
              await walk(old!.oid, now!.oid, `${path}/`, depth + 1)
            else one(path, old!, now!)
          }
        }
      } finally {
        held -= (news as Entry[] & { bytes?: number }).bytes ?? 0
      }
    } finally {
      held -= (olds as Entry[] & { bytes?: number }).bytes ?? 0
    }
  }

  await walk(from, to, "", 1)
  return stopped
}
