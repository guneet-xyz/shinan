import { createHmac, randomBytes } from "node:crypto"
import {
  closeSync,
  existsSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs"
import { join } from "node:path"

import type { MainGroup } from "./main/checks.js"

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
  /** For a commit a purge rewrote, the commit it replaces (D-066). */
  replaces?: string
}

/**
 * A purge's own record beside the repository (plan §2.9): what its rewrite
 * did, by commit and branch, and a keyed hash of its text (`textHash`),
 * never the text. Written before the old repository is swapped out
 * (`swapping`), marked `swapped` right after the swap, and `done` once
 * everything that follows is written. While a record is `swapping` or
 * `swapped` every push is refused, so no removed commit comes back before
 * `purged-commits` holds it (review of #197).
 */
export interface PurgeRecord {
  purgeId: string
  phase: "swapping" | "swapped" | "done" | "abandoned"
  at: string
  /** HMAC-SHA256 of the text under the volume's purge key (`Records.textHash`). */
  textHash: string
  /** Commits whose ID changed: the old ID and the new one. */
  rewritten: [string, string][]
  /** Commits the old repository held that the new one does not. */
  removed: string[]
  /** Every branch after the rewrite. */
  refs: { ref: string; commit: string }[]
  /** Branches renamed: the old name, already purged, is never kept. */
  renamedBranches: number
  counts: {
    commits: number
    files: number
    messages: number
    journalEntries: number
  }
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
 * - `purges/<purge ID>.json`: each purge's record (`PurgeRecord`).
 */
export interface Records {
  /** The commit's first push, or undefined if Shinan never received it. */
  firstPush(workspaceId: string, commit: string): FirstPush | undefined
  /** Whether any first push of the repository is on record. */
  hasAny(workspaceId: string): boolean
  /**
   * Records first pushes, leaving out commits already recorded, synced to
   * disk before it returns. Returns those it recorded.
   */
  addFirstPushes(workspaceId: string, rows: FirstPush[]): FirstPush[]
  /** The commits a purge removed from the repository. */
  purgedCommits(workspaceId: string): ReadonlySet<string>
  /**
   * The fact check groups ever on `main` (the revert rule, plan §2.5
   * check 6), from `main-groups.jsonl`: rebuilt from `main` from the next
   * push to `main` on if lost.
   */
  mainGroups(workspaceId: string): MainGroup[]
  /** Records groups now on `main`, leaving out those recorded already. */
  addMainGroups(workspaceId: string, groups: MainGroup[]): void
  /** Adds commits to `purged-commits`, synced to disk before it returns. */
  addPurgedCommits(workspaceId: string, commits: readonly string[]): void
  /**
   * Replaces a purge text in the branch names of the first-pusher record
   * and of earlier purges' records (`rename` gives a branch's new name, or
   * the same one), rewriting the files in place; returns how many rows of
   * the first-pusher record changed. The only change ever made to a row.
   */
  renameRefs(workspaceId: string, rename: (ref: string) => string): number
  /**
   * Replaces a purge text in the record of groups ever on `main` as the
   * purge replaced it in `main` (`replace`), rewriting the file in place.
   * A group that still holds the text afterwards (`holds`), such as one
   * where it spans the record's own quoting, is dropped: the record only
   * lets a revert restore a group, and a dropped one is recorded again
   * from `main` by the next push to it. Returns how many groups changed.
   */
  purgeMainGroups(
    workspaceId: string,
    replace: (text: string) => string,
    holds: (text: string) => boolean,
  ): number
  /** A purge's record, if the Git container has one. */
  purge(workspaceId: string, purgeId: string): PurgeRecord | undefined
  /** Every purge record of a workspace. */
  purges(workspaceId: string): PurgeRecord[]
  /** The workspaces with any purge record. */
  purgedWorkspaces(): string[]
  /** Whether a purge of the workspace has swapped, or is swapping, and is not done. */
  unfinishedPurge(workspaceId: string): boolean
  /**
   * A keyed hash of a purge text (HMAC-SHA256 under a random key made on
   * the volume once, `records/purge-key`, which never leaves it): how a
   * purge's text is recognized again without being kept.
   */
  textHash(text: string): string
  /** Writes a purge's record, synced to disk before it returns. */
  writePurge(workspaceId: string, record: PurgeRecord): void
}

const groupKey = (group: MainGroup) =>
  JSON.stringify([group.document, group.check, group.facts])

const workspacePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function openRecords(root: string): Records {
  const groupsLoaded = new Map<string, Map<string, MainGroup>>()
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

  const groupsFile = (workspaceId: string) =>
    join(folderOf(workspaceId), "main-groups.jsonl")
  const loadGroups = (workspaceId: string) => {
    let groups = groupsLoaded.get(workspaceId)
    if (groups) return groups
    groups = new Map()
    const file = groupsFile(workspaceId)
    if (existsSync(file)) {
      const text = readFileSync(file, "utf8")
      // A line a stop cut short is dropped: the next push to main records
      // its group again.
      for (const line of text
        .slice(0, text.lastIndexOf("\n") + 1)
        .split("\n")) {
        if (line === "") continue
        const group = JSON.parse(line) as MainGroup
        groups.set(groupKey(group), group)
      }
    }
    groupsLoaded.set(workspaceId, groups)
    return groups
  }

  let key: Buffer | undefined
  const purgeKey = () => {
    if (key) return key
    const file = join(folder, "purge-key")
    if (!existsSync(file))
      writeDurably(folder, "purge-key", randomBytes(32).toString("hex"))
    key = Buffer.from(readFileSync(file, "utf8").trim(), "hex")
    return key
  }

  const purgedCommits = (workspaceId: string): ReadonlySet<string> => {
    const file = join(folderOf(workspaceId), "purged-commits")
    if (!existsSync(file)) return new Set()
    return new Set(
      readFileSync(file, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    )
  }

  return {
    firstPush: (workspaceId, commit) => load(workspaceId).get(commit),
    hasAny: (workspaceId) => load(workspaceId).size > 0,
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
    mainGroups: (workspaceId) => [...loadGroups(workspaceId).values()],
    addMainGroups(workspaceId, groups) {
      const known = loadGroups(workspaceId)
      const fresh = groups.filter((g) => !known.has(groupKey(g)))
      if (fresh.length === 0) return
      mkdirSync(folderOf(workspaceId), { recursive: true, mode: 0o700 })
      const fd = openSync(groupsFile(workspaceId), "a", 0o600)
      try {
        writeSync(fd, fresh.map((g) => `${JSON.stringify(g)}\n`).join(""))
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      for (const group of fresh) known.set(groupKey(group), group)
    },
    purgedCommits,
    addPurgedCommits(workspaceId, commits) {
      const known = purgedCommits(workspaceId)
      const fresh = [...new Set(commits)].filter((c) => !known.has(c))
      if (fresh.length === 0) return
      mkdirSync(folderOf(workspaceId), { recursive: true, mode: 0o700 })
      const file = join(folderOf(workspaceId), "purged-commits")
      const created = !existsSync(file)
      const fd = openSync(file, "a", 0o600)
      try {
        writeSync(fd, fresh.map((c) => `${c}\n`).join(""))
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      if (created) syncFolder(folderOf(workspaceId))
    },
    renameRefs(workspaceId, rename) {
      const purges = join(folderOf(workspaceId), "purges")
      if (existsSync(purges))
        for (const name of readdirSync(purges)) {
          if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue
          const record = JSON.parse(
            readFileSync(join(purges, name), "utf8"),
          ) as PurgeRecord
          const refs = record.refs.map((r) => ({ ...r, ref: rename(r.ref) }))
          if (refs.every((r, i) => r.ref === record.refs[i]!.ref)) continue
          writeDurably(purges, name, JSON.stringify({ ...record, refs }))
        }
      const rows = load(workspaceId)
      let changed = 0
      for (const [commit, row] of rows) {
        if (row.ref === null) continue
        const ref = rename(row.ref)
        if (ref === row.ref) continue
        rows.set(commit, { ...row, ref })
        changed++
      }
      if (changed === 0) return 0
      writeDurably(
        folderOf(workspaceId),
        "first-pushes.jsonl",
        [...rows.values()].map((row) => `${JSON.stringify(row)}\n`).join(""),
      )
      return changed
    },
    purgeMainGroups(workspaceId, replace, holds) {
      const groups = loadGroups(workspaceId)
      let changed = 0
      const kept = new Map<string, MainGroup>()
      for (const group of groups.values()) {
        const line = JSON.stringify(group)
        if (!holds(line)) {
          kept.set(groupKey(group), group)
          continue
        }
        changed++
        let check: string
        try {
          check = JSON.stringify(
            (JSON.parse(group.check) as unknown[]).map((v) =>
              typeof v === "string" ? replace(v) : v,
            ),
          )
        } catch {
          check = replace(group.check)
        }
        const purged: MainGroup = {
          document: replace(group.document),
          check,
          facts: group.facts.map(replace).sort(),
        }
        if (!holds(JSON.stringify(purged))) kept.set(groupKey(purged), purged)
      }
      if (changed === 0) return 0
      mkdirSync(folderOf(workspaceId), { recursive: true, mode: 0o700 })
      writeDurably(
        folderOf(workspaceId),
        "main-groups.jsonl",
        [...kept.values()].map((g) => `${JSON.stringify(g)}\n`).join(""),
      )
      groupsLoaded.set(workspaceId, kept)
      return changed
    },
    purge(workspaceId, purgeId) {
      const file = join(
        folderOf(workspaceId),
        "purges",
        `${purgeName(purgeId)}.json`,
      )
      if (!existsSync(file)) return undefined
      return JSON.parse(readFileSync(file, "utf8")) as PurgeRecord
    },
    purges(workspaceId) {
      const folder = join(folderOf(workspaceId), "purges")
      if (!existsSync(folder)) return []
      return readdirSync(folder)
        .filter((name) => /^[0-9a-f-]{36}\.json$/.test(name))
        .map(
          (name) =>
            JSON.parse(readFileSync(join(folder, name), "utf8")) as PurgeRecord,
        )
    },
    unfinishedPurge(workspaceId) {
      const folder = join(folderOf(workspaceId), "purges")
      if (!existsSync(folder)) return false
      return readdirSync(folder).some((name) => {
        if (!/^[0-9a-f-]{36}\.json$/.test(name)) return false
        const { phase } = JSON.parse(
          readFileSync(join(folder, name), "utf8"),
        ) as PurgeRecord
        return phase === "swapping" || phase === "swapped"
      })
    },
    textHash(text) {
      return createHmac("sha256", purgeKey()).update(text).digest("hex")
    },
    purgedWorkspaces() {
      return readdirSync(folder).filter(
        (name) =>
          workspacePattern.test(name) &&
          existsSync(join(folder, name, "purges")),
      )
    },
    writePurge(workspaceId, record) {
      const folder = join(folderOf(workspaceId), "purges")
      mkdirSync(folder, { recursive: true, mode: 0o700 })
      writeDurably(
        folder,
        `${purgeName(record.purgeId)}.json`,
        JSON.stringify(record),
      )
    },
  }
}

function purgeName(purgeId: string): string {
  if (!workspacePattern.test(purgeId)) throw new Error("Not a purge ID")
  return purgeId
}

/** Writes a file through a temporary one, synced, then renamed into place. */
function writeDurably(folder: string, name: string, content: string): void {
  const temporary = join(folder, `.${name}.tmp`)
  const fd = openSync(temporary, "w", 0o600)
  try {
    writeSync(fd, content)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(temporary, join(folder, name))
  syncFolder(folder)
}

function syncFolder(path: string): void {
  const fd = openSync(path, "r")
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}
