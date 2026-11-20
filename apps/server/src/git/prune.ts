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
 * repository is repacked (`git repack -a -d`, which keeps only what the
 * branches reach) and pruned (`git prune --expire=now`), with its push lock
 * held and no Git process running on it; one that is busy is tried again
 * the next time.
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
  log?: LimitedLog
}): Pruner {
  const { store, push, gate } = options
  const log = options.log ?? createLimitedLog()
  const due = new Set<string>()
  let round: Promise<string[]> | undefined

  const prune = async (workspaceId: string) => {
    const release = await push.exclusive(workspaceId, 0)
    if (!release) return false
    try {
      const pruned = await gate.whenIdle(workspaceId, async () => {
        const gitDir = store.pathOf(workspaceId)
        await store.git.run(["repack", "-a", "-d", "-q"], {
          gitDir,
          timeoutMs: pruneMs,
        })
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
      due.add(workspaceId)
    },
    run() {
      round ??= (async () => {
        const pruned: string[] = []
        for (const workspaceId of [...due]) {
          due.delete(workspaceId)
          try {
            if (!store.exists(workspaceId)) continue
            if (await prune(workspaceId)) pruned.push(workspaceId)
            else due.add(workspaceId)
          } catch (error) {
            due.add(workspaceId)
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
