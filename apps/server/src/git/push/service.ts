import { randomBytes } from "node:crypto"
import { lstatSync, readdirSync, realpathSync } from "node:fs"
import { basename, dirname, isAbsolute, join, relative } from "node:path"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"

import { findPushSecrets, pushLimits } from "@shinan/core"
import type {
  GitRequestContext,
  PushCheckedData,
  PushConfirmedData,
  RepositoryRefs,
} from "@shinan/core"
import { createLimitedLog, errorSummary } from "@shinan/db"
import type { LimitedLog } from "@shinan/db"
import { diffTreesPage } from "@shinan/git"

import type { Journal } from "../journal.js"
import type { RepositoryStore } from "../store.js"
import { checkPush, TooSlowError } from "./checks.js"
import type { CheckResult, Problem, PushLimits, RefUpdate } from "./checks.js"
import { createPushLocks } from "./lock.js"
import type { PushLocks } from "./lock.js"
import type { MainGroup } from "./main/checks.js"
import {
  createMainChecker,
  MainCheckMemoryError,
  MainCheckTimeoutError,
} from "./main/pool.js"
import type { MainChecker } from "./main/pool.js"
import { verdictLines } from "./output.js"
import type { FirstPush, Records } from "./records.js"

/** The environment variable that carries a push's nonce to its hooks. */
export const nonceVariable = "SHINAN_PUSH_NONCE"
/** The environment variable that tells the hooks where the Git role listens. */
export const hookUrlVariable = "SHINAN_HOOK_URL"
/** The header the hooks send the nonce in. */
export const nonceHeader = "shinan-push-nonce"

/** One `git-receive-pack` request, from its start to its Git's end. */
export interface PushSession {
  nonce: string
  /** Call when the request's Git process has ended, however it ended. */
  end(): Promise<void>
}

export interface PushService {
  /** A session for a push `web` forwarded, with the context it sent. */
  begin(context: GitRequestContext): PushSession
  /** The loopback listener the hooks call (`pre-receive`, `post-receive`). */
  readonly hookApp: Hono
  /** Where `hookApp` listens, once it does: `http://127.0.0.1:<port>`. */
  hookUrl: string | undefined
  /** A repository's branches, unless a push to it is being checked. */
  refs(workspaceId: string): Promise<RepositoryRefs>
  /** Records a new repository's first commit, first pushed by Shinan. */
  repositoryCreated(workspaceId: string, commit: string): Promise<void>
  /**
   * Takes the repository's push lock for work that is not a push, such as
   * a purge's rewrite (plan §2.9): its release, or null if a push held it
   * for `waitMs`. Pushes meanwhile wait, then are refused as busy.
   */
  exclusive(
    workspaceId: string,
    waitMs: number,
    holder?: "purge",
  ): Promise<(() => void) | null>
  /**
   * Marks the repository's history rewritten (a purge swapped it): a push
   * that started before is refused once it reaches its checks, since what
   * it sent was against the old history.
   */
  rewritten(workspaceId: string): void
  /**
   * After a restart: puts the first pushes of journal entries not
   * acknowledged yet into the record (a stop between the two writes), and
   * records the first commit of any repository with no record at all.
   */
  recover(): Promise<void>
}

type Phase = "new" | "checking" | "checked" | "done"

interface State {
  context: GitRequestContext
  /** The repository's rewrites when the push started. */
  generation: number
  phase: Phase
  checking?: Promise<void>
  release?: () => void
  updates: RefUpdate[]
  result?: CheckResult
  /** The fact check groups of the new `main`, recorded once it is applied. */
  mainGroups?: MainGroup[]
  confirming?: Promise<void>
}

const objectId = /^[0-9a-f]{40}$/
const zero = /^0{40}$/

/**
 * The push checks' service in the `git` role (Git-based catalog plan
 * §2.5, §2.6): when `git http-backend` starts for a push, `begin` gives a
 * one-time nonce, which Git passes to the hooks in their environment. The
 * hooks are thin clients: `pre-receive` sends the ref lines, the
 * quarantine variables and the push options to `hookApp` on loopback; the
 * service finds the request's context by the nonce, takes the
 * repository's lock (waiting up to 30 seconds, then `busy`), runs the
 * checks, appends the verdict to the journal (`push.checked`) and answers
 * with the lines to print. After Git updated the refs, `post-receive` (or,
 * if Git updated none, the end of the request) has it confirm which refs
 * moved, record the commits they first brought (`push.confirmed`, then the
 * first-pusher record) and release the lock. A hook without a nonce, or
 * with one used already, is refused.
 */
export function createPushService(options: {
  store: RepositoryStore
  journal: Journal
  records: Records
  log?: LimitedLog
  locks?: PushLocks
  /** The worker that runs the checks of `main`; one is started if not given. */
  mainChecker?: MainChecker
  /** Other limits than `pushLimits`, for tests; read at each push. */
  limits?: Partial<PushLimits>
  /** Called after Git updated any ref of a push, such as to prune the repository. */
  onUpdated?: (workspaceId: string) => void
}): PushService {
  const { store, journal, records } = options
  const log = options.log ?? createLimitedLog()
  const locks = options.locks ?? createPushLocks()
  const sessions = new Map<string, State>()
  const generations = new Map<string, number>()
  /** Repositories whose lock a purge holds. */
  const purging = new Set<string>()
  /** Whether a purge holds the repository, or left it unfinished (`Records.unfinishedPurge`). */
  const removing = (workspaceId: string) =>
    purging.has(workspaceId) || records.unfinishedPurge(workspaceId)
  const git = store.git

  const service: PushService = {
    hookUrl: undefined,
    hookApp: new Hono(),
    begin(context) {
      const nonce = randomBytes(32).toString("hex")
      const state: State = {
        context,
        generation: generations.get(context.workspaceId) ?? 0,
        phase: "new",
        updates: [],
      }
      sessions.set(nonce, state)
      return {
        nonce,
        async end() {
          try {
            await state.checking
            if (state.phase === "checked") await confirm(state)
          } catch (error) {
            log(`Push ${context.requestId}: ${errorSummary(error)}`)
          } finally {
            state.release?.()
            state.phase = "done"
            sessions.delete(nonce)
          }
        },
      }
    },
    async refs(workspaceId) {
      const release = removing(workspaceId)
        ? null
        : await locks.acquire(workspaceId, 0)
      if (!release) {
        return {
          workspaceId,
          busy: true,
          refs: [],
          journalId: journal.id,
          journalLast: journal.last(),
        }
      }
      try {
        const { stdout } = await git.run(
          ["for-each-ref", "--format=%(objectname) %(refname)", "refs/heads/"],
          { gitDir: store.pathOf(workspaceId) },
        )
        const refs = stdout
          .toString("utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const space = line.indexOf(" ")
            return { ref: line.slice(space + 1), commit: line.slice(0, space) }
          })
        return {
          workspaceId,
          busy: false,
          refs,
          journalId: journal.id,
          journalLast: journal.last(),
        }
      } finally {
        release()
      }
    },
    async exclusive(workspaceId, waitMs, holder) {
      const release = await locks.acquire(workspaceId, waitMs)
      if (!release || holder !== "purge") return release
      purging.add(workspaceId)
      return () => {
        purging.delete(workspaceId)
        release()
      }
    },
    rewritten(workspaceId) {
      generations.set(workspaceId, (generations.get(workspaceId) ?? 0) + 1)
    },
    async repositoryCreated(workspaceId, commit) {
      const entry = await journal.append("repository.created", {
        workspaceId,
        commit,
      })
      records.addFirstPushes(workspaceId, [
        { commit, push: null, ref: null, by: "shinan", at: entry.recordedAt },
      ])
    },
    async recover() {
      const repositories = readdirSync(store.root)
        .map((name) => /^([0-9a-f-]{36})\.git$/.exec(name)?.[1])
        .filter((id) => id !== undefined)
      // Judged before the journal is replayed into the record.
      const unrecorded = repositories.filter((id) => !records.hasAny(id))
      for (let after = 0; ;) {
        const entries = journal.read(after, 1000)
        if (entries.length === 0) break
        for (const entry of entries) {
          if (entry.kind === "push.confirmed") {
            const data = entry.data as unknown as PushConfirmedData & {
              by: string
            }
            records.addFirstPushes(
              data.workspaceId,
              data.firstPushes.map((f) => ({
                commit: f.commit,
                push: data.push,
                ref: f.ref,
                by: data.by,
                at: entry.recordedAt,
              })),
            )
          } else if (entry.kind === "repository.created") {
            const data = entry.data as { workspaceId: string; commit: string }
            records.addFirstPushes(data.workspaceId, [
              {
                commit: data.commit,
                push: null,
                ref: null,
                by: "shinan",
                at: entry.recordedAt,
              },
            ])
          } else if (entry.kind === "repository.rewritten") {
            // A purge's rewritten commits inherit their first pushers.
            const data = entry.data as {
              workspaceId: string
              commits: {
                commit: string
                replaces: string
                ref: string | null
              }[]
            }
            records.addFirstPushes(
              data.workspaceId,
              data.commits.map((c) => {
                const first = records.firstPush(data.workspaceId, c.replaces)
                return {
                  commit: c.commit,
                  push: first?.push ?? null,
                  ref: c.ref,
                  by: first?.by ?? "shinan",
                  at: first?.at ?? entry.recordedAt,
                  replaces: c.replaces,
                }
              }),
            )
          }
          after = entry.number
        }
      }
      // A repository with no record at all was made before the push log
      // (GC-2), or a stop came between making it and recording it: its
      // first commit is Shinan's. One with records whose root is not among
      // them had `main` rewritten outside Shinan; nothing can attribute
      // that, so it is left alone (review of GC-3a).
      for (const id of unrecorded) {
        const first = (
          await git.run(["rev-list", "--max-parents=0", "refs/heads/main"], {
            gitDir: store.pathOf(id),
            okExitCodes: [0, 128],
          })
        ).stdout
          .toString("utf8")
          .split("\n")
          .filter(Boolean)
          .at(-1)
        if (first && !records.firstPush(id, first))
          await service.repositoryCreated(id, first)
      }
    },
  }

  /** Which refs Git moved as the push asked, the commits they first brought, and `main`'s update. */
  const confirm = (state: State) =>
    (state.confirming ??= (async () => {
      const { context, updates, result } = state
      const gitDir = store.pathOf(context.workspaceId)
      const confirmed: number[] = []
      for (const [i, update] of updates.entries()) {
        const now = (
          await git.run(["rev-parse", "--verify", "--quiet", update.ref], {
            gitDir,
            okExitCodes: [0, 1],
          })
        ).stdout
          .toString("utf8")
          .trim()
        if ((now || null) === update.new) confirmed.push(i)
      }
      const firstPushes: { commit: string; ref: string }[] = []
      const seen = new Set<string>()
      for (const i of confirmed) {
        for (const commit of result!.commitsByRef[i] ?? []) {
          if (seen.has(commit)) continue
          seen.add(commit)
          if (!records.firstPush(context.workspaceId, commit)) {
            firstPushes.push({ commit, ref: updates[i]!.ref })
          }
        }
      }
      let main: PushConfirmedData["main"] = null
      const mainAt = updates.findIndex((u) => u.ref === "refs/heads/main")
      if (mainAt >= 0 && confirmed.includes(mainAt)) {
        const update = updates[mainAt]!
        main = await mainUpdate(gitDir, update.old!, update.new!)
      }
      const mainApplied = main !== null
      const data: PushConfirmedData & { by: string } = {
        push: context.requestId,
        workspaceId: context.workspaceId,
        by: context.by,
        confirmed,
        firstPushes,
        main,
      }
      const entry = await journal.append(
        "push.confirmed",
        data as unknown as Record<string, unknown>,
      )
      // At once after the journal, before any other request is handled, so
      // nothing can acknowledge the entry before the record holds it.
      records.addFirstPushes(
        context.workspaceId,
        firstPushes.map((f): FirstPush => ({
          commit: f.commit,
          push: context.requestId,
          ref: f.ref,
          by: context.by,
          at: entry.recordedAt,
        })),
      )
      // The revert rule's record of fact check groups ever on main.
      if (mainApplied && state.mainGroups)
        records.addMainGroups(context.workspaceId, state.mainGroups)
      state.phase = "done"
      state.release?.()
      if (confirmed.length > 0) options.onUpdated?.(context.workspaceId)
    })())

  const mainUpdate = async (
    gitDir: string,
    from: string,
    to: string,
  ): Promise<PushConfirmedData["main"]> => {
    const commits = Number(
      (
        await git.run(["rev-list", "--count", `${from}..${to}`], { gitDir })
      ).stdout
        .toString("utf8")
        .trim(),
    )
    // The commits this update made reachable from `main`, for the record
    // of when each reached it (GC-7): at most the checks' limit on commits
    // added to `main`, which an accepted push can't exceed.
    const added =
      commits <= pushLimits.mainCommits
        ? (await git.run(["rev-list", `${from}..${to}`], { gitDir })).stdout
            .toString("utf8")
            .split("\n")
            .filter(Boolean)
        : []
    const diff = await diffTreesPage(git, gitDir, from, to, { limit: 1000 })
    const documents = [
      ...new Set(
        diff.changes
          .map((c) => c.path)
          .filter((p) => p.endsWith(".md") && p !== "README.md")
          .map((p) => p.slice(0, -3)),
      ),
    ]
    return {
      from,
      to,
      commits,
      added,
      documents,
      documentsTruncated: diff.truncated,
    }
  }

  const mainChecker = options.mainChecker ?? createMainChecker()

  /**
   * The checks of `main` (checks 4 to 7), in the worker thread: first the
   * limit on commits added to `main`, then the first pusher of each of
   * them for the `by` rule (this push's for commits it brings that Shinan
   * never received).
   */
  const checkMain = async (
    state: State,
    result: CheckResult,
    run: {
      gitDir: string
      env: Record<string, string>
      limits: PushLimits
      deadline: number
    },
  ): Promise<{
    problems: Problem[]
    warnings: Problem[]
    groups: MainGroup[]
  }> => {
    const { context } = state
    const update = state.updates.find((u) => u.ref === "refs/heads/main")!
    const added = (
      await git.run(
        [
          "rev-list",
          `--max-count=${run.limits.mainCommits + 1}`,
          `${update.old}..${update.new}`,
        ],
        { gitDir: run.gitDir, env: run.env },
      )
    ).stdout
      .toString("utf8")
      .split("\n")
      .filter(Boolean)
    if (added.length > run.limits.mainCommits) {
      return {
        problems: [
          {
            code: "main-too-many-commits",
            where: "ref refs/heads/main",
            message: `this push adds more than ${run.limits.mainCommits.toLocaleString("en")} commits to main: merge in parts`,
          },
        ],
        warnings: [],
        groups: [],
      }
    }
    const fresh = new Set(result.commitsByRef.flat())
    const firstPushers: Record<string, string | null> = {}
    for (const commit of added) {
      firstPushers[commit] =
        records.firstPush(context.workspaceId, commit)?.by ??
        (fresh.has(commit) ? context.by : null)
    }
    return mainChecker.check(
      {
        gitBinary: git.binary,
        gitHome: git.environment().HOME!,
        gitDir: run.gitDir,
        env: run.env,
        from: update.old!,
        to: update.new!,
        now: Date.now(),
        memberHandles: context.memberHandles,
        firstPushers,
        groupsEver: records.mainGroups(context.workspaceId),
        limits: {
          documents: run.limits.mainDocuments,
          textBytes: run.limits.mainTextBytes,
        },
      },
      run.deadline,
    )
  }

  /** The verdict of `pre-receive`, appended to the journal; the lock is kept only if accepted. */
  const check = async (
    state: State,
    body: PreReceiveBody,
  ): Promise<{ accepted: boolean; lines: string[] }> => {
    const { context } = state
    const gitDir = store.pathOf(context.workspaceId)
    const pushOptions = body.options ?? []
    const checkOnly = pushOptions.includes("check-only")
    const problems: Problem[] = []
    let result: CheckResult | undefined
    for (const option of pushOptions) {
      if (option !== "check-only") {
        problems.push({
          code: "push-option-unknown",
          where: "",
          message: `Shinan knows one push option, -o check-only; remove -o ${JSON.stringify(option.slice(0, 40))}`,
        })
      }
    }
    const limits: PushLimits = { ...pushLimits, ...options.limits }
    let mainWarnings: Problem[] = []
    // While text is being removed from the history, pushes are refused at
    // once, with how long to wait (review of #197).
    const release = removing(context.workspaceId)
      ? null
      : await locks.acquire(context.workspaceId, limits.lockWaitSeconds * 1000)
    if (!release && removing(context.workspaceId)) {
      problems.push({
        code: "busy",
        where: "",
        message:
          "Shinan is removing text from this catalog's history: push again in a few minutes",
      })
    } else if (!release) {
      problems.push({
        code: "busy",
        where: "",
        message:
          "another push to this repository is being checked: push again in 30 seconds",
      })
    } else if (
      (generations.get(context.workspaceId) ?? 0) !== state.generation
    ) {
      state.release = release
      problems.push({
        code: "busy",
        where: "",
        message:
          "the catalog's history was rewritten while this push was sent: fetch, reset your branch onto the new history, then push again",
      })
    } else {
      state.release = release
      const mainAt = state.updates.findIndex(
        (u) => u.ref === "refs/heads/main" && u.new !== null,
      )
      const deadline =
        Date.now() +
        (mainAt >= 0 ? limits.mainCheckSeconds : limits.checkSeconds) * 1000
      try {
        const env = quarantineEnv(gitDir, body.quarantine)
        result = await checkPush({
          git,
          gitDir,
          env,
          updates: state.updates,
          allowedValues: new Set(context.allowedValues),
          purged: records.purgedCommits(context.workspaceId),
          deadline,
          limits,
        })
        problems.push(...result.problems)
        if (
          mainAt >= 0 &&
          result.kinds[mainAt] === "update" &&
          !problems.some((p) => p.code === "too-many-commits")
        ) {
          const main = await checkMain(state, result, {
            gitDir,
            env,
            limits,
            deadline,
          })
          const allowed = new Set(context.allowedValues)
          problems.push(...main.problems.map((p) => unquoted(p, allowed)))
          mainWarnings = main.warnings.map((p) => unquoted(p, allowed))
          state.mainGroups = main.groups
        }
      } catch (error) {
        if (
          error instanceof TooSlowError ||
          error instanceof MainCheckTimeoutError
        ) {
          problems.push({
            code: "too-slow",
            where: "",
            message:
              "checking this push took longer than Shinan allows: push smaller changes",
          })
        } else if (error instanceof MainCheckMemoryError) {
          problems.push({
            code: "catalog-too-large",
            where: "",
            message: "the catalog is too large to check: tell your person",
          })
        } else {
          log(
            `Push ${context.requestId} could not be checked: ${errorSummary(error)}`,
          )
          problems.push({
            code: "check-failed",
            where: "",
            message:
              "Shinan could not check this push: try again, and tell your person if it happens again",
          })
        }
      }
    }
    state.result = result
    const warnings = [...(result?.warnings ?? []), ...mainWarnings]
    const blocking = problems.length > 0 || checkOnly
    const data: PushCheckedData = {
      push: context.requestId,
      workspaceId: context.workspaceId,
      agent: context.agent,
      person: context.person,
      memberId: context.memberId,
      ...(context.tokenId ? { tokenId: context.tokenId } : {}),
      ...(context.networkAddress
        ? { networkAddress: context.networkAddress }
        : {}),
      by: context.by,
      outcome:
        problems.length > 0 ? "refused" : checkOnly ? "check-only" : "accepted",
      codes: [
        ...new Set([
          ...problems.map((p) => p.code),
          ...(checkOnly ? ["check-only"] : []),
        ]),
      ],
      warnings: warnings.length,
      secrets: result?.secrets ?? 0,
      refs: state.updates.map((u, i) => ({
        // A branch name that holds a secret is not kept anywhere.
        ref: result?.secretNames.includes(i)
          ? "refs/heads/(withheld: the name held a secret)"
          : u.ref,
        old: u.old,
        new: u.new,
        kind:
          result?.kinds[i] ??
          (u.old === null ? "create" : u.new === null ? "delete" : "update"),
      })),
      receivedBytes: quarantineBytes(body.quarantine),
      receivedObjects: result?.newObjects ?? 0,
      newCommits: result?.newCommits ?? 0,
    }
    await journal.append(
      "push.checked",
      data as unknown as Record<string, unknown>,
    )
    if (blocking) {
      state.release?.()
      state.release = undefined
      state.phase = "done"
    } else {
      state.phase = "checked"
    }
    return {
      accepted: !blocking,
      lines: verdictLines({ problems, warnings, checkOnly }),
    }
  }

  const hooks = service.hookApp
  hooks.use(
    "*",
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: (c) => c.json({ error: "too-large" }, 413),
    }),
  )
  hooks.post("/pre-receive", async (c) => {
    const state = sessions.get(c.req.header(nonceHeader) ?? "")
    if (!state || state.phase !== "new") {
      return c.json({ exitCode: 1, lines: refusedWithout }, 403)
    }
    state.phase = "checking"
    const body = (await c.req.json().catch(() => null)) as PreReceiveBody | null
    const updates = body ? parseUpdates(body.updates) : null
    if (!body || !updates) {
      state.phase = "done"
      return c.json({ exitCode: 1, lines: refusedWithout }, 400)
    }
    state.updates = updates
    let answer!: { accepted: boolean; lines: string[] }
    state.checking = (async () => {
      answer = await check(state, body)
    })()
    try {
      await state.checking
    } catch (error) {
      log(`Push ${state.context.requestId}: ${errorSummary(error)}`)
      state.release?.()
      state.phase = "done"
      return c.json({ exitCode: 1, lines: refusedWithout }, 500)
    }
    return c.json({ exitCode: answer.accepted ? 0 : 1, lines: answer.lines })
  })
  hooks.post("/post-receive", async (c) => {
    const state = sessions.get(c.req.header(nonceHeader) ?? "")
    if (!state || state.phase !== "checked") {
      return c.json({ lines: [] }, 403)
    }
    try {
      await confirm(state)
    } catch (error) {
      log(`Push ${state.context.requestId}: ${errorSummary(error)}`)
    }
    return c.json({ lines: [] })
  })
  hooks.all("*", (c) => c.json({ error: "not-found" }, 404))
  return service
}

/** What `pre-receive` sends. */
interface PreReceiveBody {
  /** Its standard input: `<old> <new> <ref>` lines. */
  updates: string
  quarantine?: {
    GIT_QUARANTINE_PATH?: string
    GIT_OBJECT_DIRECTORY?: string
    GIT_ALTERNATE_OBJECT_DIRECTORIES?: string
  }
  /** The push options (`git push -o`), or null when none were sent. */
  options?: string[] | null
}

const refusedWithout = [
  "Shinan: this push could not be checked. Nothing was changed. Try again; tell your person if it happens again.",
]

function parseUpdates(text: unknown): RefUpdate[] | null {
  if (typeof text !== "string") return null
  const updates: RefUpdate[] = []
  for (const line of text.split("\n")) {
    if (line === "") continue
    const [old, next, ref, ...rest] = line.split(" ")
    if (!old || !next || !ref || rest.length > 0) return null
    if (!objectId.test(old) || !objectId.test(next)) return null
    updates.push({
      ref,
      old: zero.test(old) ? null : old,
      new: zero.test(next) ? null : next,
    })
  }
  return updates
}

/** Whether `path` is inside `folder`. */
function inside(path: string, folder: string): boolean {
  const r = relative(folder, path)
  return r !== "" && !r.startsWith("..") && !isAbsolute(r)
}

/**
 * The quarantine variables Git gave the hook, checked: the push's own
 * `objects/tmp_objdir-incoming-…` folder of this repository, and the repository's
 * objects as the alternate. Anything else is refused.
 */
function quarantineEnv(
  gitDir: string,
  quarantine: PreReceiveBody["quarantine"],
): Record<string, string> {
  const objects = realpathSync(join(gitDir, "objects"))
  const env: Record<string, string> = {}
  const folder = quarantine?.GIT_OBJECT_DIRECTORY
  if (folder === undefined) return env
  const real = realpathSync(folder)
  if (
    !inside(real, objects) ||
    dirname(real) !== objects ||
    !/^(?:tmp_objdir-)?incoming-/.test(basename(real))
  ) {
    throw new Error("The push's quarantine is not this repository's")
  }
  env.GIT_OBJECT_DIRECTORY = real
  env.GIT_QUARANTINE_PATH = real
  env.GIT_ALTERNATE_OBJECT_DIRECTORIES = objects
  return env
}

function quarantineBytes(quarantine: PreReceiveBody["quarantine"]): number {
  const folder = quarantine?.GIT_OBJECT_DIRECTORY
  if (!folder) return 0
  let total = 0
  const walk = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) total += lstatSync(full).size
    }
  }
  try {
    walk(folder)
  } catch {
    return 0
  }
  return total
}

/**
 * A problem of the checks of `main` with any place or message that holds
 * something secret-looking left out: those checks quote paths, IDs and
 * validation messages, and check 3 reports the secret itself.
 */
function unquoted(problem: Problem, allowed: ReadonlySet<string>): Problem {
  const hides = (text: string) => findPushSecrets(text, allowed).length > 0
  return {
    ...problem,
    where: hides(problem.where) ? "(path not shown)" : problem.where,
    message: hides(problem.message)
      ? "(not shown: it quotes a secret-looking value)"
      : problem.message,
  }
}
