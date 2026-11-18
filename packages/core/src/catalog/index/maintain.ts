import { eq, inArray, isNull, ne, or, schema, sql } from "@shinan/db"
import type { IndexCheckDifference, Transaction } from "@shinan/db"

import { atInstallation } from "../../authorize.js"
import type { Context } from "../../context.js"
import { NotFoundError } from "../../errors.js"
import { addJob } from "../../jobs.js"
import type { QueueDefinition } from "../../jobs.js"
import { isId } from "../../validation.js"
import { parserVersion } from "../document/index.js"
import { compareWorkspaceIndex, rebuildWorkspaceIndex } from "./indexer.js"
import { latestRevision } from "./store.js"

/**
 * Keeping the agent index in step with the stored text (architecture §5.2,
 * §5.3, §7): rebuilds when the parser changes or an operator asks, and the
 * daily round-trip check.
 */

/**
 * The queue of index rebuilds, at most one waiting and one running per
 * workspace (`stately`, keyed by workspace). A rebuild that fails is
 * retried; until one succeeds, answers keep saying the index is behind.
 */
export const catalogIndexRebuildQueue = {
  name: "catalog-index-rebuild",
  options: {
    policy: "stately",
    retryLimit: 5,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 60 * 60,
  },
} as const satisfies QueueDefinition

/** What a rebuild job carries. */
export interface CatalogIndexRebuildJob {
  workspaceId: string
}

/**
 * Asks the worker to rebuild workspaces' indexes: the given ones, or every
 * workspace whose index was built by another parser version (after a
 * release changed the parser) or never built. Answers say the index is
 * behind from now until the rebuild finishes. Returns the workspaces asked
 * for.
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
      const s = schema.catalogIndexState
      const rows = await scope.tx
        .selectDistinct({ workspaceId: schema.catalogRevisions.workspaceId })
        .from(schema.catalogRevisions)
        .leftJoin(s, eq(s.workspaceId, schema.catalogRevisions.workspaceId))
        .where(
          or(
            isNull(s.workspaceId),
            ne(s.parserVersion, parserVersion),
            sql`${s.rebuildRequestedAt} is not null`,
          ),
        )
      workspaceIds = rows.map((r) => r.workspaceId)
    }
    // In one order everywhere, so two requests at once cannot deadlock.
    workspaceIds.sort()
    for (const workspaceId of workspaceIds) {
      await scope.tx
        .insert(schema.catalogIndexState)
        .values({ workspaceId, parserVersion, rebuildRequestedAt: sql`now()` })
        .onConflictDoUpdate({
          target: schema.catalogIndexState.workspaceId,
          set: {
            rebuildRequestedAt: sql`coalesce(${schema.catalogIndexState.rebuildRequestedAt}, now())`,
          },
        })
      await addJob(
        scope,
        catalogIndexRebuildQueue,
        { workspaceId } satisfies CatalogIndexRebuildJob,
        { singletonKey: workspaceId },
      )
    }
    return workspaceIds
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
 * Rebuilds one workspace's index from its stored text (the rebuild job, or
 * an operator's server command). First records that a rebuild is running,
 * so answers say the index is behind, then rebuilds in one transaction:
 * readers see the old rows until it commits.
 */
export async function rebuildCatalogIndex(
  ctx: Context,
  input: CatalogIndexRebuildJob,
): Promise<{ revision: number; documents: number }> {
  const [workspaceId] = await atInstallation(
    ctx,
    "catalog-index.maintain",
    async (scope) => {
      const found = await existingWorkspaces(scope.tx, [input.workspaceId])
      await scope.tx
        .insert(schema.catalogIndexState)
        .values({
          workspaceId: found[0]!,
          parserVersion,
          rebuildRequestedAt: sql`now()`,
        })
        .onConflictDoUpdate({
          target: schema.catalogIndexState.workspaceId,
          set: {
            rebuildRequestedAt: sql`coalesce(${schema.catalogIndexState.rebuildRequestedAt}, now())`,
          },
        })
      return found
    },
  )
  return ctx.db.transaction((tx) => rebuildWorkspaceIndex(tx, workspaceId!))
}

/** The outcome of the round-trip check for one workspace. */
export interface WorkspaceIndexCheck {
  workspaceId: string
  /** `behind`: built by another parser version or being rebuilt, so not compared; a rebuild is asked for. */
  outcome: "matched" | "differs" | "behind"
  revision: number
  documents: number
  /** How many documents differ; the first 50 are listed. */
  differenceCount: number
  differences: IndexCheckDifference[]
}

/** How many differing documents a check keeps, by ID. */
const keptDifferences = 50

/**
 * The daily round-trip check (architecture §5.2, rule 5): for each
 * workspace, text → parse → index compared with the stored index, in one
 * snapshot. Records the outcome on the workspace's index state, where
 * installation health reads it; the worker logs it. Workspaces whose index
 * is behind (another parser version, or a rebuild asked for) are not
 * compared but are asked to rebuild again, if a job queue is at hand: the
 * queue keeps one waiting rebuild per workspace, so a rebuild that was lost
 * or gave up is retried and one already waiting is not repeated.
 */
export async function checkCatalogIndexes(
  ctx: Context,
  input: { workspaceIds?: string[] } = {},
): Promise<WorkspaceIndexCheck[]> {
  const workspaceIds = await atInstallation(
    ctx,
    "catalog-index.maintain",
    async (scope) => {
      if (input.workspaceIds)
        return existingWorkspaces(scope.tx, input.workspaceIds)
      const rows = await scope.tx
        .selectDistinct({ workspaceId: schema.catalogRevisions.workspaceId })
        .from(schema.catalogRevisions)
      return rows.map((r) => r.workspaceId)
    },
  )
  const results: WorkspaceIndexCheck[] = []
  const stale: string[] = []
  for (const workspaceId of workspaceIds) {
    const result = await ctx.db.transaction(
      async (tx): Promise<WorkspaceIndexCheck> => {
        const [state] = await tx
          .select()
          .from(schema.catalogIndexState)
          .where(eq(schema.catalogIndexState.workspaceId, workspaceId))
        const latest = await latestRevision(tx, workspaceId)
        if (
          !state ||
          state.parserVersion !== parserVersion ||
          state.rebuildRequestedAt !== null
        ) {
          return {
            workspaceId,
            outcome: "behind",
            revision: state?.revision ?? 0,
            documents: 0,
            differenceCount: 0,
            differences: [],
          }
        }
        const { documents, differences } = await compareWorkspaceIndex(
          tx,
          workspaceId,
        )
        if (state.revision !== latest)
          differences.unshift({ documentId: "*", tables: ["state"] })
        return {
          workspaceId,
          outcome: differences.length === 0 ? "matched" : "differs",
          revision: latest,
          documents,
          differenceCount: differences.length,
          differences: differences.slice(0, keptDifferences),
        }
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    )
    if (result.outcome === "behind") {
      stale.push(workspaceId)
    } else {
      await ctx.db
        .update(schema.catalogIndexState)
        .set({
          checkedAt: sql`now()`,
          checkedRevision: result.revision,
          checkDifferences: result.differenceCount,
          checkDetails: result.differences,
        })
        .where(eq(schema.catalogIndexState.workspaceId, workspaceId))
    }
    results.push(result)
  }
  if (stale.length > 0 && ctx.jobs)
    await requestCatalogIndexRebuilds(ctx, { workspaceIds: stale })
  return results
}

/** One workspace's agent index, for installation health: IDs and counts, never content. */
export interface CatalogIndexWorkspaceHealth {
  workspaceId: string
  revision: number
  latestRevision: number
  parserVersion: number
  /** Behind the latest revision or the parser, or being rebuilt: answers say so. */
  behind: boolean
  rebuildRequestedAt: string | null
  rebuiltAt: string | null
  checkedAt: string | null
  checkedRevision: number | null
  /** Documents whose stored index differed from their text at the last check. */
  checkDifferences: number | null
}

export interface CatalogIndexHealth {
  parserVersion: number
  workspaces: CatalogIndexWorkspaceHealth[]
}

/**
 * The agent index's health for installation operators (architecture §5.2,
 * rule 5; §13 in-app status): each workspace's index revision, whether it
 * is behind, and the last round-trip check.
 */
export async function getCatalogIndexHealth(
  ctx: Context,
): Promise<CatalogIndexHealth> {
  return atInstallation(ctx, "catalog-index.read-health", async (scope) => {
    const s = schema.catalogIndexState
    const r = schema.catalogRevisions
    const latest = scope.tx
      .select({
        workspaceId: r.workspaceId,
        latest: sql<number>`max(${r.number})::int`.as("latest"),
      })
      .from(r)
      .groupBy(r.workspaceId)
      .as("latest")
    const rows = await scope.tx
      .select({ state: s, latest: latest.latest })
      .from(s)
      .leftJoin(latest, eq(latest.workspaceId, s.workspaceId))
      .orderBy(s.workspaceId)
    const iso = (d: Date | null) => (d === null ? null : d.toISOString())
    return {
      parserVersion,
      workspaces: rows.map(({ state, latest }) => ({
        workspaceId: state.workspaceId,
        revision: state.revision,
        latestRevision: latest ?? 0,
        parserVersion: state.parserVersion,
        behind:
          state.revision < (latest ?? 0) ||
          state.parserVersion !== parserVersion ||
          state.rebuildRequestedAt !== null,
        rebuildRequestedAt: iso(state.rebuildRequestedAt),
        rebuiltAt: iso(state.rebuiltAt),
        checkedAt: iso(state.checkedAt),
        checkedRevision: state.checkedRevision,
        checkDifferences: state.checkDifferences,
      })),
    }
  })
}
