import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { createLimitedLog, errorSummary } from "@shinan/db"
import type { LimitedLog } from "@shinan/db"
import { GitError } from "@shinan/git"

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
 * large repository after every push held fetches for seconds). One whose
 * pruning failed has the half-written pack removed and waits an hour
 * before it is tried again, a restart included (the time of the failure
 * is kept in the repository's folder) (GC-11: a whole repack of a 1,000,000-commit
 * history ran out of memory, and tried every minute it held the
 * repository for minutes each time and left a pack's worth of disk).
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

/**
 * The most objects counted, one byte each: 64 MiB. A repository within its
 * 1 GiB limit holds far fewer.
 */
const maxHeldObjects = 64 * 1024 * 1024

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
  /**
   * How long a repository whose pruning failed waits before it is tried
   * again, pushes or not: an hour.
   */
  failedWaitMs?: number
  log?: LimitedLog
}): Pruner {
  const { store, push, gate } = options
  const log = options.log ?? createLimitedLog()
  const quietMs = options.quietMs ?? 20_000
  const longestWaitMs = options.longestWaitMs ?? 10 * 60_000
  const failedWaitMs = options.failedWaitMs ?? 60 * 60_000
  /**
   * Repositories to look at: since when, their last push, and, after a
   * failed pruning, not before when.
   */
  const due = new Map<
    string,
    { since: number; last: number; notBefore?: number }
  >()
  /** Not before when a repository whose pruning failed is tried again. */
  const notBeforeOf = (workspaceId: string): number | undefined => {
    const failed = lastFailure(store.pathOf(workspaceId))
    return failed === undefined ? undefined : failed + failedWaitMs
  }
  let round: Promise<string[]> | undefined

  const prune = async (workspaceId: string) => {
    if (options.paused?.(workspaceId)) return false
    const release = await push.exclusive(workspaceId, 0)
    if (!release) return false
    try {
      const gitDir = store.pathOf(workspaceId)
      const whole = await unreachableObjects(store, gitDir)
      const pruned = await gate.whenIdle(workspaceId, async () => {
        try {
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
        } catch (error) {
          removeTemporaryPacks(gitDir)
          throw error
        }
        clearFailure(gitDir)
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
      const earlier = due.get(workspaceId)
      // A failure before a restart counts too.
      const notBefore = earlier ? earlier.notBefore : notBeforeOf(workspaceId)
      due.set(workspaceId, {
        since: earlier?.since ?? now,
        last: now,
        ...(notBefore !== undefined ? { notBefore } : {}),
      })
    },
    run() {
      round ??= (async () => {
        const pruned: string[] = []
        for (const [workspaceId, when] of [...due]) {
          const now = Date.now()
          // Failed not long ago: later, pushes or not.
          if (when.notBefore !== undefined && now < when.notBefore) continue
          // Pushed to just now: later, unless it has waited long enough.
          if (now - when.last < quietMs && now - when.since < longestWaitMs)
            continue
          due.delete(workspaceId)
          try {
            if (!store.exists(workspaceId)) continue
            if (await prune(workspaceId)) pruned.push(workspaceId)
            else due.set(workspaceId, due.get(workspaceId) ?? when)
          } catch (error) {
            const failed = Date.now()
            recordFailure(store.pathOf(workspaceId), failed)
            due.set(workspaceId, {
              ...(due.get(workspaceId) ?? when),
              notBefore: failed + failedWaitMs,
            })
            log(
              `Pruning the repository of workspace ${workspaceId} failed: ${pruneFailure(error)}; tried again in ${Math.round(failedWaitMs / 60_000)} minutes`,
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
 *
 * The objects held are counted as empty lines, one byte each, never read
 * as names: a repository of millions of objects would otherwise hold
 * hundreds of MiB of strings in this process, and leave the repack too
 * little of the container's memory (GC-11, a 1,000,000-commit history).
 */
export async function unreachableObjects(
  store: Pick<RepositoryStore, "git">,
  gitDir: string,
): Promise<boolean> {
  const packs = join(gitDir, "objects", "pack")
  if (
    !existsSync(packs) ||
    !readdirSync(packs).some((f) => f.endsWith(".bitmap"))
  )
    return true
  const all = await store.git.run(
    ["cat-file", "--batch-all-objects", "--batch-check="],
    { gitDir, timeoutMs: pruneMs, maxOutputBytes: maxHeldObjects },
  )
  let held = 0
  for (const byte of all.stdout) if (byte === 0x0a) held++
  const reached = await store.git.run(
    ["rev-list", "--count", "--objects", "--all", "--use-bitmap-index"],
    { gitDir, timeoutMs: pruneMs },
  )
  return held !== Number(reached.stdout.toString("latin1").trim())
}

/**
 * Removes what a repack that failed left in the repository's pack folder:
 * Git writes a new pack as `tmp_pack_…` (and its index as `tmp_idx_…`)
 * and renames it when done, so one stopped half-way (out of memory, at its
 * time limit) leaves a file as large as the repository (GC-11). Run only
 * while no Git process uses the repository; `git prune` removes the same
 * files after a repack that succeeded.
 */
export function removeTemporaryPacks(gitDir: string): void {
  const packs = join(gitDir, "objects", "pack")
  if (!existsSync(packs)) return
  for (const name of readdirSync(packs)) {
    if (name.startsWith("tmp_") || name.startsWith(".tmp-"))
      rmSync(join(packs, name), { force: true })
  }
}

/** Where a repository keeps the time its last pruning failed. */
const failureFile = (gitDir: string) => join(gitDir, "shinan-prune-failed")

function lastFailure(gitDir: string): number | undefined {
  try {
    const at = Number(readFileSync(failureFile(gitDir), "utf8").trim())
    return Number.isSafeInteger(at) && at > 0 ? at : undefined
  } catch {
    return undefined
  }
}

function recordFailure(gitDir: string, at: number): void {
  try {
    writeFileSync(failureFile(gitDir), `${at}\n`, { mode: 0o600 })
  } catch {
    // The repository's folder is gone or full: the wait holds until a restart.
  }
}

function clearFailure(gitDir: string): void {
  rmSync(failureFile(gitDir), { force: true })
}

/**
 * Why a pruning failed, in words that hold no catalog text: the Git
 * command and how it ended (its time limit, its output limit, a signal or
 * an exit code), and, for a repack, which of its processes Git said died
 * of which signal, so running out of memory (`SIGKILL`) can be told from
 * running out of time.
 */
export function pruneFailure(error: unknown): string {
  if (!(error instanceof GitError)) return errorSummary(error)
  const command = /^[a-z-]{1,32}$/.test(error.command) ? error.command : "git"
  if (error.kind === "timeout")
    return `git ${command} stopped at its time limit`
  if (error.kind === "output-limit")
    return `git ${command} stopped at its output limit`
  if (error.kind === "start") return `git ${command} could not start`
  const signal = /\(signal (SIG[A-Z0-9]{1,10})\)/.exec(error.message)?.[1]
  if (signal) return `git ${command} ended by ${signal}`
  const died = /([a-z-]{1,32}) died of signal (\d{1,2})/.exec(error.stderr)
  const ended = `git ${command} exited with code ${error.exitCode ?? "unknown"}`
  if (died)
    return `${ended}: ${died[1]} ended by signal ${died[2]}${died[2] === "9" ? " (SIGKILL, often out of memory)" : ""}`
  if (/out of memory/i.test(error.stderr)) return `${ended}: out of memory`
  return ended
}
