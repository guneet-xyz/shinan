import { and, eq, inArray, schema } from "@shinan/db"

import { inWorkspace, snapshotRead } from "../authorize.js"
import type { Context } from "../context.js"
import { InvalidInputError } from "../errors.js"
import type { CommitInfo } from "./git/api.js"
import type { GitClient } from "./git/client.js"
import type { CatalogAnswer } from "./index/format.js"
import { changeJson, fromGit, locate, readCursor, requireGit } from "./pages.js"
import type { CatalogChangeJson, HistoryCursors } from "./pages.js"
import { readCommitPushes } from "./pushers.js"

/*
 * Recent changes (Git-based catalog plan §3, GQ-6; product brief on #169):
 * `main`'s commits from the one the index stands at, newest first, each
 * with the pages it changed by title. It is the review after the fact now
 * that changes need no approval. Who pushed each comes from the push log
 * (GC-3a).
 */

const documents = schema.catalogIndexDocuments

/** A file a change touched: a page by its ID and title, or just a file. */
export interface ChangedPageJson {
  path: string
  /** The page's catalog ID, or null for a file that isn't a page now. */
  id: string | null
  title: string | null
}

export interface CatalogRecentChangeJson extends CatalogChangeJson {
  /** The first few files it changed (a merge: changed itself), pages by title. */
  pages: ChangedPageJson[]
  /** How many files it changed in all. */
  page_count: number
  /**
   * Whether `page_count` is a lower bound. With no `pages`, the files it
   * changed aren't known (a merge too large to work out).
   */
  page_count_at_least: boolean
}

export interface CatalogChangesAnswer extends CatalogAnswer {
  changes: CatalogRecentChangeJson[]
  /** The cursor for older changes (`after`), or null at the first. */
  next_after: string | null
}

/** How many commits one page of Recent changes reads. */
export const changesPageLimit = 30
/** How many files of a change are named; the rest are counted. */
export const changedPagesShown = 3

/**
 * What a cursor of Recent changes is signed for in place of a file's path
 * (`HistoryCursors`): a NUL, which no path in Git holds, so a cursor of
 * one list never fits the other.
 */
const recentChangesPath = "\u0000recent changes"

/**
 * How many commits one request reads at most: a page's 30, and as many
 * again, twice, when every commit read was a merge left out, so a page is
 * empty only after 90 such merges.
 */
const changesReadRounds = 3

/**
 * Recent changes: a page of `main`'s commits from the commit the index is
 * at, newest first as `git log` orders them, merges that changed nothing
 * themselves left out (product brief on #169). A merge's changes are its
 * own, as Git's combined diff gives them (the Git container works them out
 * in the same read); a merge whose own changes couldn't be worked out is
 * kept, its files "not known". Each change names up to `changedPagesShown`
 * files, pages by their titles in the index. Paged by a cursor Shinan
 * signs, holding where the walk started and how far it got, as a page's
 * history is.
 */
export async function listCatalogChanges(
  ctx: Context,
  git: GitClient | undefined,
  workspaceId: string,
  input: { after?: string; limit?: number },
  cursors: HistoryCursors,
): Promise<CatalogChangesAnswer> {
  const limit = input.limit ?? changesPageLimit
  if (!Number.isInteger(limit) || limit < 1 || limit > changesPageLimit)
    throw new InvalidInputError(
      "limit",
      `A page of changes holds 1 to ${changesPageLimit} commits`,
    )
  const located = await locate(ctx, workspaceId, null)
  const { answer } = located
  const repository = located.workspaceId
  const cursor = readCursor(cursors, input.after, {
    workspaceId: repository,
    path: recentChangesPath,
  })
  const empty = { ...answer, changes: [], next_after: null }
  if (answer.catalog_commit === null) return empty
  const client = requireGit(git)
  const start = cursor?.start ?? answer.catalog_commit
  let position = cursor?.position ?? 0

  const listed: CommitInfo[] = []
  let more = true
  for (let round = 0; round < changesReadRounds && more; round++) {
    // One more than read, to know whether there are older ones.
    const { commits } = await fromGit(() =>
      client.history(repository, {
        commit: start,
        skip: position,
        limit: limit + 1,
        combined: true,
      }),
    )
    more = commits.length > limit
    const read = commits.slice(0, limit)
    position += read.length
    for (const commit of read) {
      // A merge that changed nothing itself: its commits are listed.
      const merge = commit.parents.length > 1
      if (merge && commit.changeCount === 0 && !commit.changeCountAtLeast)
        continue
      listed.push(commit)
    }
    if (listed.length > 0) break
  }

  const shown = [
    ...new Set(
      listed.flatMap((c) =>
        c.changes.slice(0, changedPagesShown).map((p) => p.path),
      ),
    ),
  ]
  const pages = await pagesAt(ctx, repository, shown)
  const pushes = await readCommitPushes(ctx, repository, listed)
  return {
    ...empty,
    changes: listed.map((commit) => ({
      ...changeJson(commit, pushes.get(commit.oid)),
      pages: commit.changes
        .slice(0, changedPagesShown)
        .map(({ path }) => pages.get(path) ?? { path, id: null, title: null }),
      page_count: commit.changeCount,
      page_count_at_least: commit.changeCountAtLeast,
    })),
    next_after: more
      ? cursors.issue({
          workspaceId: repository,
          path: recentChangesPath,
          start,
          position,
        })
      : null,
  }
}

/** The pages at these paths in the index now, by path. */
async function pagesAt(
  ctx: Context,
  workspaceId: string,
  paths: readonly string[],
): Promise<Map<string, ChangedPageJson>> {
  if (paths.length === 0) return new Map()
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.read",
    async (scope) => {
      const rows = await scope.tx
        .select({
          path: documents.path,
          id: documents.catalogId,
          title: documents.title,
        })
        .from(documents)
        .where(
          and(
            eq(documents.workspaceId, scope.workspaceId),
            inArray(documents.path, [...paths]),
          ),
        )
      return new Map(rows.map((r) => [r.path, r]))
    },
    snapshotRead,
  )
}
