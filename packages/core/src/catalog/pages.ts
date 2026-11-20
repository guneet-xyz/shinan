import { and, asc, eq, schema } from "@shinan/db"

import { inWorkspace, snapshotRead } from "../authorize.js"
import type { Context } from "../context.js"
import {
  InvalidInputError,
  NotFoundError,
  UnavailableError,
} from "../errors.js"
import type { CommitInfo } from "./git/api.js"
import { GitServiceError } from "./git/client.js"
import type { GitClient } from "./git/client.js"
import { sectionJson } from "./index/format.js"
import type { CatalogAnswer, SectionJson } from "./index/format.js"
import { answerFor } from "./index/queries.js"
import { idText } from "./wiki.js"

/**
 * What a catalog page reads besides its index rows (Git-based catalog plan
 * §3, GC-7): the start-here and type schema documents as pages, and from
 * the repository, a page's changes, its source and the README. Each read
 * checks membership in one snapshot of the index first, and only then asks
 * the Git container, at the commit the index stands at, so a page and its
 * footer agree.
 */

const documents = schema.catalogIndexDocuments
const sections = schema.catalogIndexSections

/** A document of `main` that is not an entity: start-here or a type schema. */
export interface CatalogDocumentJson {
  id: string
  kind: string
  path: string
  blob: string
  title: string | null
  summary: string | null
  status: string | null
  owner: string | null
  body: SectionJson[]
  problems: { code: string; message: string }[]
}

/**
 * The start-here document or a type schema document by its catalog ID
 * (`start-here`, `schema/machine`), as a page: its title, summary and
 * body. Entities have their own, fuller answer (`getCatalogEntity`).
 */
export async function getCatalogDocument(
  ctx: Context,
  workspaceId: string,
  input: { id: string },
): Promise<CatalogAnswer & { document: CatalogDocumentJson }> {
  const id = idText(input.id, "id")
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.read",
    async (scope) => {
      const tx = scope.tx
      const answer = await answerFor(tx, scope.workspaceId)
      const [row] = await tx
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.workspaceId, scope.workspaceId),
            eq(documents.catalogId, id),
          ),
        )
        .orderBy(asc(documents.path))
        .limit(1)
      if (!row || (row.kind !== "start-here" && row.kind !== "schema"))
        throw new NotFoundError()
      const body = await tx
        .select()
        .from(sections)
        .where(
          and(
            eq(sections.workspaceId, scope.workspaceId),
            eq(sections.path, row.path),
          ),
        )
        .orderBy(asc(sections.position))
      return {
        ...answer,
        document: {
          id,
          kind: row.kind,
          path: row.path,
          blob: row.blob,
          title: row.title,
          summary: row.summary,
          status: row.status,
          owner: row.owner,
          body: body.map(sectionJson),
          problems: row.problems,
        },
      }
    },
    snapshotRead,
  )
}

/** Where a page is in the index: its path and the commit the index is at. */
async function locate(
  ctx: Context,
  workspaceId: string,
  id: string | null,
): Promise<{
  answer: CatalogAnswer
  path: string | null
  title: string | null
}> {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.read",
    async (scope) => {
      const answer = await answerFor(scope.tx, scope.workspaceId)
      if (id === null) return { answer, path: null, title: null }
      const [row] = await scope.tx
        .select({ path: documents.path, title: documents.title })
        .from(documents)
        .where(
          and(
            eq(documents.workspaceId, scope.workspaceId),
            eq(documents.catalogId, id),
          ),
        )
        .orderBy(asc(documents.path))
        .limit(1)
      if (!row) throw new NotFoundError()
      return { answer, path: row.path, title: row.title }
    },
    snapshotRead,
  )
}

/** The Git container, or why it can't be asked. */
function requireGit(git: GitClient | undefined): GitClient {
  if (!git)
    throw new UnavailableError(
      "The catalog's repository can't be read right now",
    )
  return git
}

/**
 * A Git container's refusal as core's errors: an unknown commit is not
 * found, a bad request is invalid input, and the rest means the repository
 * can't be read right now.
 */
async function fromGit<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    if (!(error instanceof GitServiceError)) throw error
    if (error.status === 404) throw new NotFoundError()
    if (error.status === 400)
      throw new InvalidInputError("after", "That change is not in the catalog")
    throw new UnavailableError(
      "The catalog's repository can't be read right now",
      { cause: error },
    )
  }
}

/** One change of a page's history: a commit of `main` that changed it. */
export interface CatalogChangeJson {
  commit: string
  /** The commit message, hidden characters as they are; its start if long. */
  message: string
  /** When it was committed (ISO 8601), as the commit says. */
  time: string | null
  /** Whether it merged other changes (it has more than one parent). */
  merge: boolean
  /**
   * Who pushed it to Shinan: from the push log (GC-3a). Null until then;
   * a commit's author is not trusted (D-061).
   */
  pushed_by: null
}

export interface CatalogHistoryAnswer extends CatalogAnswer {
  path: string
  title: string | null
  changes: CatalogChangeJson[]
  /** The cursor for older changes (`after`), or null at the first. */
  next_after: string | null
}

/** The most changes one page of history holds. */
export const historyPageLimit = 50

const objectId = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

function changeJson(commit: CommitInfo): CatalogChangeJson {
  const time = commit.committer?.time ?? commit.author?.time
  return {
    commit: commit.oid,
    message: commit.message,
    time: time === undefined ? null : new Date(time * 1000).toISOString(),
    merge: commit.parents.length > 1,
    pushed_by: null,
  }
}

/**
 * A page's history (Git-based catalog plan §3): the commits of `main` that
 * changed its file, newest first, from the commit the index is at. Paged by
 * commit (`after`, the last commit of the page before), not by a count to
 * skip, which on a long history gets slower with every page (review of
 * GC-1b). Any commit of the workspace's repository may be a cursor: every
 * object in it is the members' to read, since a purge builds a fresh
 * repository (plan §2.9).
 */
export async function getCatalogPageHistory(
  ctx: Context,
  git: GitClient | undefined,
  workspaceId: string,
  input: { id: string; after?: string; limit?: number },
): Promise<CatalogHistoryAnswer> {
  const id = idText(input.id, "id")
  const limit = input.limit ?? historyPageLimit
  if (!Number.isInteger(limit) || limit < 1 || limit > historyPageLimit)
    throw new InvalidInputError(
      "limit",
      `A page of history holds 1 to ${historyPageLimit} changes`,
    )
  if (input.after !== undefined && !objectId.test(input.after))
    throw new InvalidInputError("after", "after is a full commit ID")
  const { answer, path, title } = await locate(ctx, workspaceId, id)
  const empty = { ...answer, path: path!, title, changes: [], next_after: null }
  if (answer.catalog_commit === null) return empty
  const client = requireGit(git)
  // One more than asked, to know whether there are older ones; and the
  // cursor itself, which the history from it starts with.
  const extra = input.after === undefined ? 1 : 2
  const { commits } = await fromGit(() =>
    client.history(workspaceId, {
      commit: input.after ?? answer.catalog_commit!,
      path: path!,
      limit: limit + extra,
    }),
  )
  const older =
    input.after !== undefined && commits[0]?.oid === input.after
      ? commits.slice(1)
      : commits.slice(0, limit + 1)
  const page = older.slice(0, limit)
  return {
    ...empty,
    changes: page.map(changeJson),
    next_after: older.length > limit ? page[page.length - 1]!.oid : null,
  }
}

/** A file's text, or why it can't be shown. */
export interface CatalogSourceJson {
  path: string
  /** Its text as UTF-8; null when too large to show. */
  text: string | null
  size: number
}

function sourceOf(
  documents: Awaited<ReturnType<GitClient["readDocuments"]>>["documents"],
): CatalogSourceJson | null {
  const [read] = documents
  if (!read || "missing" in read) return null
  if ("content" in read)
    return {
      path: read.path,
      text: new TextDecoder("utf-8").decode(read.content),
      size: read.size,
    }
  return { path: read.path, text: null, size: read.size }
}

/** A page's source (View source): its file as it is at the index's commit. */
export async function getCatalogPageSource(
  ctx: Context,
  git: GitClient | undefined,
  workspaceId: string,
  input: { id: string },
): Promise<
  CatalogAnswer & { source: CatalogSourceJson; title: string | null }
> {
  const id = idText(input.id, "id")
  const { answer, path, title } = await locate(ctx, workspaceId, id)
  if (answer.catalog_commit === null) throw new NotFoundError()
  const client = requireGit(git)
  const read = await fromGit(() =>
    client.readDocuments(workspaceId, {
      commit: answer.catalog_commit!,
      paths: [path!],
    }),
  )
  const source = sourceOf(read.documents)
  if (!source) throw new NotFoundError()
  return { ...answer, source, title }
}

/**
 * The catalog's `README.md` at the index's commit, for Start here when there
 * is no start-here document (product brief on #169); null when it has none.
 */
export async function getCatalogReadme(
  ctx: Context,
  git: GitClient | undefined,
  workspaceId: string,
): Promise<CatalogAnswer & { readme: CatalogSourceJson | null }> {
  const { answer } = await locate(ctx, workspaceId, null)
  if (answer.catalog_commit === null) return { ...answer, readme: null }
  const client = requireGit(git)
  const read = await fromGit(() =>
    client.readDocuments(workspaceId, {
      commit: answer.catalog_commit!,
      paths: ["README.md"],
    }),
  )
  return { ...answer, readme: sourceOf(read.documents) }
}
