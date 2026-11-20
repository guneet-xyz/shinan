import {
  closeSync,
  existsSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeSync,
} from "node:fs"
import { join } from "node:path"

/** One commit's first pusher (Git-based catalog plan §2.6, D-066). */
export interface FirstPush {
  commit: string
  /** The push that first brought it; null for a commit Shinan made. */
  push: string | null
  /** The first of that push's refs that carried it. */
  ref: string | null
  /** The written form of the pusher (identity §8.7), or `shinan`. */
  by: string
  /** When, as ISO 8601. */
  at: string
}

/**
 * What the Git container keeps beside each repository, outside it, so a
 * purge's swap of the repository folder keeps it (plan §2.6, §2.9):
 * `records/<workspace ID>/`.
 *
 * - `first-pushes.jsonl`: the first pusher of every commit it received,
 *   one line each, inserted once and never changed. Its checks read it
 *   (the `by` rule, GC-3b), and `web` copies it from the journal.
 * - `purged-commits`: commits a purge removed (GC-8), one per line; a push
 *   bringing one back is refused.
 */
export interface Records {
  /** The commit's first push, or undefined if Shinan never received it. */
  firstPush(workspaceId: string, commit: string): FirstPush | undefined
  /**
   * Records first pushes, leaving out commits already recorded, synced to
   * disk before it returns. Returns those it recorded.
   */
  addFirstPushes(workspaceId: string, rows: FirstPush[]): FirstPush[]
  /** The commits a purge removed from the repository. */
  purgedCommits(workspaceId: string): ReadonlySet<string>
}

const workspacePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function openRecords(root: string): Records {
  const folder = join(root, "records")
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  const loaded = new Map<string, Map<string, FirstPush>>()

  const folderOf = (workspaceId: string) => {
    if (!workspacePattern.test(workspaceId))
      throw new Error("Not a workspace ID")
    return join(folder, workspaceId)
  }
  const fileOf = (workspaceId: string) =>
    join(folderOf(workspaceId), "first-pushes.jsonl")

  /** The workspace's first pushes, read once; a torn last line is dropped. */
  const load = (workspaceId: string) => {
    let rows = loaded.get(workspaceId)
    if (rows) return rows
    rows = new Map()
    const file = fileOf(workspaceId)
    if (existsSync(file)) {
      const text = readFileSync(file, "utf8")
      const end = text.lastIndexOf("\n") + 1
      if (end < text.length) {
        // A write that never finished: its line was not recorded.
        const fd = openSync(file, "r+")
        try {
          ftruncateSync(fd, Buffer.byteLength(text.slice(0, end)))
          fsyncSync(fd)
        } finally {
          closeSync(fd)
        }
      }
      for (const line of text.slice(0, end).split("\n")) {
        if (line === "") continue
        const row = JSON.parse(line) as FirstPush
        if (!rows.has(row.commit)) rows.set(row.commit, row)
      }
    }
    loaded.set(workspaceId, rows)
    return rows
  }

  return {
    firstPush: (workspaceId, commit) => load(workspaceId).get(commit),
    addFirstPushes(workspaceId, rows) {
      const known = load(workspaceId)
      const fresh: FirstPush[] = []
      for (const row of rows) {
        if (known.has(row.commit) || fresh.some((f) => f.commit === row.commit))
          continue
        fresh.push(row)
      }
      if (fresh.length === 0) return fresh
      const created = !existsSync(fileOf(workspaceId))
      mkdirSync(folderOf(workspaceId), { recursive: true, mode: 0o700 })
      const fd = openSync(fileOf(workspaceId), "a", 0o600)
      try {
        writeSync(fd, fresh.map((row) => `${JSON.stringify(row)}\n`).join(""))
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      // A new file is on disk only once its folder is.
      if (created) syncFolder(folderOf(workspaceId))
      for (const row of fresh) known.set(row.commit, row)
      return fresh
    },
    purgedCommits(workspaceId) {
      const file = join(folderOf(workspaceId), "purged-commits")
      if (!existsSync(file)) return new Set()
      return new Set(
        readFileSync(file, "utf8")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean),
      )
    },
  }
}

function syncFolder(path: string): void {
  const fd = openSync(path, "r")
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}
