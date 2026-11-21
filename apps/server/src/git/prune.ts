import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { createLimitedLog, errorSummary } from "@shinan/db"
import type { LimitedLog } from "@shinan/db"

import type { PushService } from "./push/service.js"
import type { RepositoryStore } from "./store.js"

/**
 * Who is using each repository's files: the Git processes serving agents'
 * fetches and pushes (`enter`), and the pruner, which needs none of them
 * running (`whenIdle`). A Git process that would start while a repository
 * is pruned waits for it.
 */
export interface RepositoryGate {
  /**
   * Before a Git process starts on the repository; call the result when it
   * has ended. `kill` ends the process, for `drain`.
   */
  enter(workspaceId: string, kill?: () => void): Promise<() => void>
  /**
   * Runs `work` while no Git process runs on the repository and none
   * starts; null, without running it, if one is running.
   */
  whenIdle<T>(workspaceId: string, work: () => Promise<T>): Promise<T | null>
  /**
   * Holds back new Git processes on the repository, ends the running ones
   * (a clone or fetch of what is about to be removed) and waits up to
   * `waitMs` for them to be gone, for a purge's swap. Call the result to
   * let processes start again.
   */
  drain(workspaceId: string, waitMs: number): Promise<() => void>
}

export function createRepositoryGate(): RepositoryGate {
  const running = new Map<string, Set<() => void>>()
  const busy = new Map<string, Promise<unknown>>()
  const idle = new Map<string, (() => void)[]>()
  const count = (workspaceId: string) => running.get(workspaceId)?.size ?? 0
  return {
    async enter(workspaceId, kill = () => {}) {
      for (let held = busy.get(workspaceId); held; held = busy.get(workspaceId))
        await held.catch(() => {})
      const handles = running.get(workspaceId) ?? new Set()
      running.set(workspaceId, handles)
      const handle = () => kill()
      handles.add(handle)
      let left = false
      return () => {
        if (left) return
        left = true
        handles.delete(handle)
        if (handles.size === 0) {
          running.delete(workspaceId)
          for (const wake of idle.get(workspaceId)?.splice(0) ?? []) wake()
        }
      }
    },
    async whenIdle(workspaceId, work) {
      if (count(workspaceId) > 0 || busy.has(workspaceId)) return null
      const done = work()
      busy.set(workspaceId, done)
      try {
        return await done
      } finally {
        busy.delete(workspaceId)
      }
    },
    async drain(workspaceId, waitMs) {
      for (let held = busy.get(workspaceId); held; held = busy.get(workspaceId))
        await held.catch(() => {})
      let open!: () => void
      busy.set(workspaceId, new Promise<void>((resolve) => (open = resolve)))
      for (const kill of running.get(workspaceId) ?? []) kill()
      if (count(workspaceId) > 0)
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, waitMs)
          const list = idle.get(workspaceId) ?? []
          idle.set(workspaceId, list)
          list.push(() => {
            clearTimeout(timer)
            resolve()
          })
        })
      let released = false
      return () => {
        if (released) return
        released = true
        busy.delete(workspaceId)
        open()
      }
    },
  }
}

/**
 * Removes the objects no branch reaches from repositories that accepted a
 * push (review notes of GC-1b and GC-3a; plan §2.9): a pushed pack may hold
 * objects no pushed commit points to, which the push checks never read,
 * and a deleted branch leaves its commits behind, while the Git API reads
 * any object by its full ID. Every `intervalMs` (a minute), each such
 * repository is looked at once no push has reached it for `quietMs` (or
 * it has waited `longestWaitMs`), with its push lock held:
 *
 * - Whether any object is unreachable is counted first, while fetches go
 *   on: every object the repository holds against those its branches reach
 *   (`rev-list --objects --all`, by the reachability bitmap, so in
 *   milliseconds; a repository without a bitmap counts as having some).
 * - None: the packs pushes added are joined (`git repack -d
 *   --geometric=2`), which takes milliseconds, and loose objects no branch
 *   reaches are removed (`git prune --expire=now`).
 * - Some (a branch deleted or rewound, or a pack with more than its
 *   commits): the whole repository is repacked (`git repack -a -d`, which
 *   keeps only what the branches reach, and writes the bitmap) and pruned.
 *
 * The repacking runs with no Git process on the repository; one that is
 * busy is tried again the next time (review of #197: a whole repack of a
 * large repository after every push held fetches for seconds).
 */
export interface Pruner {
  /** Marks a repository to be pruned at the next round. */
  soon(workspaceId: string): void
  /** One round now; resolves to the repositories pruned. */
  run(): Promise<string[]>
  /** Starts the rounds; returns a function that stops them. */
  start(intervalMs?: number): () => void
}

/** How long one prune's Git process may run. */
const pruneMs = 10 * 60 * 1000

export function createPruner(options: {
  store: RepositoryStore
  push: Pick<PushService, "exclusive">
  gate: RepositoryGate
  /**
   * Whether a repository must not be pruned now: a purge is reading it,
   * and its rewrite refers to the objects it read (`Purges.running`).
   * Tried again on the next round.
   */
  paused?: (workspaceId: string) => boolean
  /** How long after the last push a repository is left alone: 20 seconds. */
  quietMs?: number
  /** How long a busy repository waits at most: 10 minutes. */
  longestWaitMs?: number
  log?: LimitedLog
}): Pruner {
  const { store, push, gate } = options
  const log = options.log ?? createLimitedLog()
  const quietMs = options.quietMs ?? 20_000
  const longestWaitMs = options.longestWaitMs ?? 10 * 60_000
  /** Repositories to look at: since when, and their last push. */
  const due = new Map<string, { since: number; last: number }>()
  let round: Promise<string[]> | undefined

  const prune = async (workspaceId: string) => {
    if (options.paused?.(workspaceId)) return false
    const release = await push.exclusive(workspaceId, 0)
    if (!release) return false
    try {
      const gitDir = store.pathOf(workspaceId)
      const whole = await unreachableObjects(store, gitDir)
      const pruned = await gate.whenIdle(workspaceId, async () => {
        await store.git.run(
          whole
            ? ["repack", "-a", "-d", "-q"]
            : ["repack", "-d", "-q", "--geometric=2"],
          { gitDir, timeoutMs: pruneMs },
        )
        await store.git.run(["prune", "--expire=now"], {
          gitDir,
          timeoutMs: pruneMs,
        })
        return true
      })
      return pruned === true
    } finally {
      release()
    }
  }

  const pruner: Pruner = {
    soon(workspaceId) {
      const now = Date.now()
      due.set(workspaceId, {
        since: due.get(workspaceId)?.since ?? now,
        last: now,
      })
    },
    run() {
      round ??= (async () => {
        const pruned: string[] = []
        for (const [workspaceId, when] of [...due]) {
          const now = Date.now()
          // Pushed to just now: later, unless it has waited long enough.
          if (now - when.last < quietMs && now - when.since < longestWaitMs)
            continue
          due.delete(workspaceId)
          try {
            if (!store.exists(workspaceId)) continue
            if (await prune(workspaceId)) pruned.push(workspaceId)
            else due.set(workspaceId, due.get(workspaceId) ?? when)
          } catch (error) {
            due.set(workspaceId, due.get(workspaceId) ?? when)
            log(
              `Pruning the repository of workspace ${workspaceId} failed: ${errorSummary(error)}`,
            )
          }
        }
        return pruned
      })().finally(() => {
        round = undefined
      })
      return round
    },
    start(intervalMs = 60_000) {
      const timer = setInterval(() => void pruner.run(), intervalMs)
      timer.unref()
      return () => clearInterval(timer)
    },
  }
  return pruner
}

/**
 * Whether the repository holds any object its branches don't reach:
 * counted, every object it holds against those the branches reach, by the
 * reachability bitmap. Without a bitmap (a repository never repacked whole,
 * or one a purge just made), it counts as holding some, so the whole
 * repack that follows writes one.
 */
async function unreachableObjects(
  store: RepositoryStore,
  gitDir: string,
): Promise<boolean> {
  const packs = join(gitDir, "objects", "pack")
  if (
    !existsSync(packs) ||
    !readdirSync(packs).some((f) => f.endsWith(".bitmap"))
  )
    return true
  const all = await store.git.run(
    ["cat-file", "--batch-all-objects", "--batch-check=%(objectname)"],
    { gitDir, timeoutMs: pruneMs, maxOutputBytes: 1024 * 1024 * 1024 },
  )
  const held = all.stdout.toString("latin1").split("\n").filter(Boolean).length
  const reached = await store.git.run(
    ["rev-list", "--count", "--objects", "--all", "--use-bitmap-index"],
    { gitDir, timeoutMs: pruneMs },
  )
  return held !== Number(reached.stdout.toString("latin1").trim())
}
