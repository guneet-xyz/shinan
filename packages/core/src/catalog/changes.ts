import { and, eq, inArray, schema } from "@shinan/db"

import { inWorkspace, snapshotRead } from "../authorize.js"
import type { Context } from "../context.js"
import { InvalidInputError } from "../errors.js"
import type { CommitInfo } from "./git/api.js"
import type { GitClient } from "./git/client.js"
import type { CatalogAnswer } from "./index/format.js"
import {
  changeJson,
  fromGit,
  locate,
  requireGit,
  staleCursor,
} from "./pages.js"
import type { CatalogChangeJson, HistoryCursors } from "./pages.js"

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
  /** The first few files it changed, pages by title. */
  pages: ChangedPageJson[]
  /** How many files it changed in all. */
  page_count: number
  /** Whether `page_count` is a lower bound. */
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
 * The files a commit changed itself. A commit with one parent changed what
 * it changed from it. A merge changed itself only the files that differ
 * from every parent (a conflict resolved, say): the others came with the
 * merged commits, which are listed themselves (product brief on #169). Each
 * further parent costs a diff, read one at a time.
 */
export async function ownChanges(
  git: GitClient,
  workspaceId: string,
  commit: CommitInfo,
): Promise<{ paths: string[]; count: number; atLeast: boolean }> {
  const paths = commit.changes.map((c) => c.path)
  if (commit.parents.length <= 1)
    return {
      paths,
      count: commit.changeCount,
      atLeast: commit.changeCountAtLeast,
    }
  let own = new Set(paths)
  let atLeast = false
  for (const parent of commit.parents.slice(1)) {
    if (own.size === 0) break
    const diff = await fromGit(() =>
      git.diff(workspaceId, { from: parent, to: commit.oid }),
    )
    // A diff cut short can't rule a path out: keep it.
    if (diff.truncated) {
      atLeast = true
      continue
    }
    const differs = new Set(diff.changes.map((c) => c.path))
    own = new Set([...own].filter((path) => differs.has(path)))
  }
  // Paths past the first 50 of the first parent's diff aren't known.
  atLeast ||= commit.changesTruncated || commit.changeCountAtLeast
  return { paths: [...own], count: own.size, atLeast: own.size > 0 && atLeast }
}

/**
 * Recent changes: a page of `main`'s commits from the commit the index is
 * at, newest first, merges that changed nothing themselves left out. Each
 * names up to `changedPagesShown` files it changed, pages by their titles
 * in the index. Paged by a cursor Shinan signs, as a page's history is.
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
  if (input.after !== undefined && input.after.length > 200)
    throw new InvalidInputError("after", staleCursor)
  const located = await locate(ctx, workspaceId, null)
  const { answer } = located
  const repository = located.workspaceId
  let after: string | undefined
  if (input.after !== undefined) {
    after =
      cursors.read(input.after, {
        workspaceId: repository,
        path: recentChangesPath,
      }) ?? undefined
    if (after === undefined) throw new InvalidInputError("after", staleCursor)
  }
  const empty = { ...answer, changes: [], next_after: null }
  if (answer.catalog_commit === null) return empty
  const client = requireGit(git)

  const extra = after === undefined ? 1 : 2
  const { commits } = await fromGit(() =>
    client.history(repository, {
      commit: after ?? answer.catalog_commit!,
      limit: limit + extra,
    }),
  )
  const older =
    after !== undefined && commits[0]?.oid === after
      ? commits.slice(1)
      : commits.slice(0, limit + 1)
  const scanned = older.slice(0, limit)

  const listed: {
    commit: CommitInfo
    paths: string[]
    count: number
    atLeast: boolean
  }[] = []
  for (const commit of scanned) {
    const own = await ownChanges(client, repository, commit)
    // A merge that changed nothing itself: its commits are listed.
    if (commit.parents.length > 1 && own.count === 0) continue
    listed.push({ commit, ...own })
  }

  const shown = [
    ...new Set(listed.flatMap((l) => l.paths.slice(0, changedPagesShown))),
  ]
  const pages = await pagesAt(ctx, repository, shown)
  return {
    ...empty,
    changes: listed.map(({ commit, paths, count, atLeast }) => ({
      ...changeJson(commit),
      pages: paths
        .slice(0, changedPagesShown)
        .map((path) => pages.get(path) ?? { path, id: null, title: null }),
      page_count: count,
      page_count_at_least: atLeast,
    })),
    next_after:
      older.length > limit
        ? cursors.issue({
            workspaceId: repository,
            path: recentChangesPath,
            commit: scanned[scanned.length - 1]!.oid,
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
