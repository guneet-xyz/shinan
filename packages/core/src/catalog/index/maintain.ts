import { and, eq, inArray, isNotNull, schema, sql } from "@shinan/db"
import type { IndexCheckDifference, Transaction } from "@shinan/db"

import { atInstallation } from "../../authorize.js"
import type { Context } from "../../context.js"
import { NotFoundError } from "../../errors.js"
import { addJob } from "../../jobs.js"
import type { JobQueue, QueueDefinition } from "../../jobs.js"
import { isId } from "../../validation.js"
import { parserVersion } from "../document/index.js"
import type { GitClient } from "../git/client.js"
import { indexRulesVersion } from "./derive.js"
import {
  compareWorkspaceIndex,
  hasStaleRows,
  stateBehind,
  updateWorkspaceIndex,
} from "./indexer.js"
import type { IndexUpdate } from "./indexer.js"
import { listDocuments, readTexts } from "./source.js"

/**
 * Keeping the agent index in step with `main` (Git-based catalog plan
 * §2.7; architecture §5.3, §7): an update after each accepted update of
 * `main`, catch-up when the worker starts, rebuilds when the parser changes
 * or an operator asks, and the daily round-trip check.
 */

/**
 * The queue of index updates, at most one waiting and one running per
 * workspace (`stately`, keyed by workspace): however many updates of
 * `main` arrive meanwhile, the next job brings the index up to `main` as it
 * then is. A job that fails is retried; until one succeeds, answers keep
 * saying the index is behind.
 */
export const catalogIndexQueue = {
  name: "catalog-index-update",
  options: {
    policy: "stately",
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 60 * 60,
  },
} as const satisfies QueueDefinition

/** What an index job carries. */
export interface CatalogIndexJob {
  workspaceId: string
}

async function queueUpdate(
  target: { tx: Transaction; jobs: JobQueue | undefined },
  workspaceId: string,
): Promise<void> {
  await addJob(
    target,
    catalogIndexQueue,
    { workspaceId } satisfies CatalogIndexJob,
    { singletonKey: workspaceId },
  )
}

/**
 * Records that `main` of a workspace's repository moved to `commit`, and
 * queues the index job, in the caller's transaction: the one that stores an
 * accepted update of `main` from the Git container's journal (plan §2.6,
 * GC-3). Answers say the index is behind from then until the job has run.
 */
export async function recordCatalogMain(target: {
  tx: Transaction
  jobs: JobQueue | undefined
  workspaceId: string
  commit: string
}): Promise<void> {
  if (!/^([0-9a-f]{40}|[0-9a-f]{64})$/.test(target.commit))
    throw new Error("A commit of main is a full Git object ID")
  await target.tx
    .insert(schema.catalogIndexState)
    .values({
      workspaceId: target.workspaceId,
      mainCommit: target.commit,
      parserVersion,
      rulesVersion: indexRulesVersion,
    })
    .onConflictDoUpdate({
      target: schema.catalogIndexState.workspaceId,
      set: { mainCommit: target.commit },
    })
  await queueUpdate(target, target.workspaceId)
}

/**
 * Asks the worker to rebuild workspaces' indexes from `main`: the given
 * ones, or every workspace with a repository whose index (or any of its
 * rows) another parser or index rules version built, after a release
 * changed them or a rollback, or that was never built. Answers say the
 * index is behind from now until the rebuild finishes. Returns the
 * workspaces asked for.
 */
export async function requestCatalogIndexRebuilds(
  ctx: Context,
  input: { workspaceIds?: string[] } = {},
): Promise<string[]> {
  return atInstallation(ctx, "catalog-index.maintain", async (scope) => {
    let workspaceIds: string[]
    if (input.workspaceIds) {
      workspaceIds = await existingWorkspaces(scope.tx, input.workspaceIds)
    } else {
      const r = schema.catalogRepositories
      const s = schema.catalogIndexState
      const rows = await scope.tx
        .select({ workspaceId: r.workspaceId })
        .from(r)
        .leftJoin(s, eq(s.workspaceId, r.workspaceId))
        .where(
          and(
            isNotNull(r.firstCommit),
            sql`(${s.workspaceId} is null or ${s.commit} is null or ${s.parserVersion} <> ${parserVersion} or ${s.rulesVersion} <> ${indexRulesVersion} or ${s.rebuildRequestedAt} is not null or exists (select 1 from ${schema.catalogIndexDocuments} d where d.workspace_id = ${r.workspaceId} and (d.parser_version <> ${parserVersion} or d.rules_version <> ${indexRulesVersion})))`,
          ),
        )
      workspaceIds = rows.map((r) => r.workspaceId)
    }
    // In one order everywhere, so two requests at once cannot deadlock.
    workspaceIds.sort()
    for (const workspaceId of workspaceIds) {
      await markRebuild(scope.tx, workspaceId)
      await queueUpdate(scope, workspaceId)
    }
    return workspaceIds
  })
}

async function markRebuild(tx: Transaction, workspaceId: string) {
  await tx
    .insert(schema.catalogIndexState)
    .values({
      workspaceId,
      parserVersion,
      rulesVersion: indexRulesVersion,
      rebuildRequestedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: schema.catalogIndexState.workspaceId,
      set: {
        rebuildRequestedAt: sql`coalesce(${schema.catalogIndexState.rebuildRequestedAt}, now())`,
      },
    })
}

/**
 * Catch-up when the worker starts (plan §2.7): asks for the rebuilds
 * `requestCatalogIndexRebuilds` finds, and queues an index job for every
 * workspace with a repository, so `main` moving while no worker ran (a
 * lost job, a push stored while the worker was down) never leaves an index
 * silently behind. A job whose index already stands at `main` only asks
 * the Git container for `main`. Returns the workspaces queued.
 */
export async function catchUpCatalogIndexes(ctx: Context): Promise<string[]> {
  await requestCatalogIndexRebuilds(ctx)
  return atInstallation(ctx, "catalog-index.maintain", async (scope) => {
    const r = schema.catalogRepositories
    const rows = await scope.tx
      .select({ workspaceId: r.workspaceId })
      .from(r)
      .where(isNotNull(r.firstCommit))
      .orderBy(r.workspaceId)
    for (const { workspaceId } of rows) await queueUpdate(scope, workspaceId)
    return rows.map((r) => r.workspaceId)
  })
}

async function existingWorkspaces(
  tx: Transaction,
  ids: readonly string[],
): Promise<string[]> {
  const wanted = new Set(ids.map((id) => id.toLowerCase()))
  if ([...wanted].some((id) => !isId(id))) throw new NotFoundError()
  const rows =
    wanted.size === 0
      ? []
      : await tx
          .select({ id: schema.workspaces.id })
          .from(schema.workspaces)
          .where(inArray(schema.workspaces.id, [...wanted]))
  if (rows.length !== wanted.size) throw new NotFoundError()
  return rows.map((r) => r.id).sort()
}

/**
 * The index job: brings one workspace's index up to `main` (an update, or
 * the rebuild its state asks for). Reads `main` through the Git container.
 */
export async function updateCatalogIndex(
  ctx: Context,
  input: CatalogIndexJob,
  git: GitClient,
): Promise<IndexUpdate> {
  const [workspaceId] = await atInstallation(
    ctx,
    "catalog-index.maintain",
    (scope) => existingWorkspaces(scope.tx, [input.workspaceId]),
  )
  return updateWorkspaceIndex(ctx.db, git, workspaceId!)
}

/**
 * Rebuilds one workspace's index from `main` now (an operator's server
 * command). First records that a rebuild is running, so answers say the
 * index is behind, then rebuilds: readers see the old rows until it
 * commits.
 */
export async function rebuildCatalogIndex(
  ctx: Context,
  input: CatalogIndexJob,
  git: GitClient,
): Promise<IndexUpdate> {
  const [workspaceId] = await atInstallation(
    ctx,
    "catalog-index.maintain",
    async (scope) => {
      const found = await existingWorkspaces(scope.tx, [input.workspaceId])
      await markRebuild(scope.tx, found[0]!)
      return found
    },
  )
  return updateWorkspaceIndex(ctx.db, git, workspaceId!, { rebuild: true })
}

/** The outcome of the round-trip check for one workspace. */
export interface WorkspaceIndexCheck {
  workspaceId: string
  /**
   * `behind`: not at `main`, built (wholly or partly) by another parser or
   * index rules version, or being rebuilt, so not compared; an update or a
   * rebuild is asked for.
   */
  outcome: "matched" | "differs" | "behind"
  /** The commit of `main` compared, or the one the index stands at when behind. */
  commit: string | null
  documents: number
  /** How many documents differ; the first 50 are listed. */
  differenceCount: number
  differences: IndexCheckDifference[]
}

/** How many differing documents a check keeps, by path. */
const keptDifferences = 50

/**
 * The daily round-trip check (architecture §5.3): for each workspace with a
 * repository, the text on `main` → parse → index, compared with the stored
 * index in one snapshot. Records the outcome on the workspace's index
 * state, where installation health reads it; the worker logs it. A
 * workspace whose index is not at `main`, or was built by another parser
 * or rules version or is being rebuilt, is not compared: an update or
 * rebuild is queued instead, if a job queue is at hand (one waiting job per
 * workspace, so one already waiting is not repeated).
 */
export async function checkCatalogIndexes(
  ctx: Context,
  git: GitClient,
  input: { workspaceIds?: string[] } = {},
): Promise<WorkspaceIndexCheck[]> {
  const workspaceIds = await atInstallation(
    ctx,
    "catalog-index.maintain",
    async (scope) => {
      if (input.workspaceIds)
        return existingWorkspaces(scope.tx, input.workspaceIds)
      const r = schema.catalogRepositories
      const rows = await scope.tx
        .select({ workspaceId: r.workspaceId })
        .from(r)
        .where(isNotNull(r.firstCommit))
        .orderBy(r.workspaceId)
      return rows.map((r) => r.workspaceId)
    },
  )
  const results: WorkspaceIndexCheck[] = []
  const stale: string[] = []
  const lagging: string[] = []
  for (const workspaceId of workspaceIds) {
    const result = await checkWorkspace(ctx, git, workspaceId)
    if (result.outcome === "behind") {
      if (result.rebuild) stale.push(workspaceId)
      else lagging.push(workspaceId)
    } else {
      await ctx.db
        .update(schema.catalogIndexState)
        .set({
          checkedAt: sql`now()`,
          checkedCommit: result.commit,
          checkDifferences: result.differenceCount,
          checkDetails: result.differences,
        })
        .where(eq(schema.catalogIndexState.workspaceId, workspaceId))
    }
    results.push({
      workspaceId: result.workspaceId,
      outcome: result.outcome,
      commit: result.commit,
      documents: result.documents,
      differenceCount: result.differenceCount,
      differences: result.differences,
    })
  }
  if (ctx.jobs) {
    if (stale.length > 0)
      await requestCatalogIndexRebuilds(ctx, { workspaceIds: stale })
    if (lagging.length > 0)
      await atInstallation(ctx, "catalog-index.maintain", async (scope) => {
        for (const workspaceId of lagging.sort())
          await queueUpdate(scope, workspaceId)
      })
  }
  return results
}

async function checkWorkspace(
  ctx: Context,
  git: GitClient,
  workspaceId: string,
): Promise<WorkspaceIndexCheck & { rebuild: boolean }> {
  const behind = (commit: string | null, rebuild: boolean) => ({
    workspaceId,
    outcome: "behind" as const,
    commit,
    documents: 0,
    differenceCount: 0,
    differences: [],
    rebuild,
  })
  const repository = await git.getRepository(workspaceId)
  const [state] = await ctx.db
    .select()
    .from(schema.catalogIndexState)
    .where(eq(schema.catalogIndexState.workspaceId, workspaceId))
  if (!repository) return behind(state?.commit ?? null, false)
  if (!state || state.commit === null || stateBehind(state))
    return behind(state?.commit ?? null, true)
  if (state.commit !== repository.main) return behind(state.commit, false)

  // Read outside any transaction: the Git container may take a while.
  const commit = state.commit
  const texts = await readTexts(
    git,
    workspaceId,
    commit,
    await listDocuments(git, workspaceId, commit),
  )
  return ctx.db.transaction(
    async (tx) => {
      const [now] = await tx
        .select()
        .from(schema.catalogIndexState)
        .where(eq(schema.catalogIndexState.workspaceId, workspaceId))
      if (now?.commit !== commit) return behind(now?.commit ?? null, false)
      if (stateBehind(now) || (await hasStaleRows(tx, workspaceId)))
        return behind(commit, true)
      const { documents, differences } = await compareWorkspaceIndex(
        tx,
        workspaceId,
        texts,
      )
      return {
        workspaceId,
        outcome: differences.length === 0 ? "matched" : "differs",
        commit,
        documents,
        differenceCount: differences.length,
        differences: differences.slice(0, keptDifferences),
        rebuild: false,
      }
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  )
}

/** One workspace's agent index, for installation health: IDs and counts, never content. */
export interface CatalogIndexWorkspaceHealth {
  workspaceId: string
  /** The commit of `main` the index stands at; null before its first build. */
  commit: string | null
  /** The latest commit of `main` Shinan knows of. */
  mainCommit: string | null
  parserVersion: number
  /** Behind `main` or the parser, or being rebuilt: answers say so. */
  behind: boolean
  rebuildRequestedAt: string | null
  rebuiltAt: string | null
  checkedAt: string | null
  checkedCommit: string | null
  /** Documents whose stored index differed from their text at the last check. */
  checkDifferences: number | null
}

export interface CatalogIndexHealth {
  parserVersion: number
  workspaces: CatalogIndexWorkspaceHealth[]
}

/**
 * The agent index's health for installation operators (architecture §5.3,
 * §13 in-app status): where each workspace's index stands, whether it is
 * behind, and the last round-trip check.
 */
export async function getCatalogIndexHealth(
  ctx: Context,
): Promise<CatalogIndexHealth> {
  return atInstallation(ctx, "catalog-index.read-health", async (scope) => {
    const s = schema.catalogIndexState
    const rows = await scope.tx.select().from(s).orderBy(s.workspaceId)
    const iso = (d: Date | null) => (d === null ? null : d.toISOString())
    return {
      parserVersion,
      workspaces: rows.map((state) => ({
        workspaceId: state.workspaceId,
        commit: state.commit,
        mainCommit: state.mainCommit,
        parserVersion: state.parserVersion,
        behind:
          state.commit === null ||
          state.commit !== state.mainCommit ||
          stateBehind(state),
        rebuildRequestedAt: iso(state.rebuildRequestedAt),
        rebuiltAt: iso(state.rebuiltAt),
        checkedAt: iso(state.checkedAt),
        checkedCommit: state.checkedCommit,
        checkDifferences: state.checkDifferences,
      })),
    }
  })
}
