import { createHmac, timingSafeEqual } from "node:crypto"

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
  /** The workspace's ID as stored (lower case), for the Git container. */
  workspaceId: string
  path: string | null
  title: string | null
}> {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.read",
    async (scope) => {
      const answer = await answerFor(scope.tx, scope.workspaceId)
      const found = { answer, workspaceId: scope.workspaceId }
      if (id === null) return { ...found, path: null, title: null }
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
      return { ...found, path: row.path, title: row.title }
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
  /** The commit message's first line, cut at `changeSubjectLimit`. */
  subject: string
  /** The start of the rest of the message, cut at `changeBodyLimit`. */
  body: string
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
/** The most characters of a change's first line a history answer holds. */
export const changeSubjectLimit = 500
/** The most characters of the rest of a change's message it holds. */
export const changeBodyLimit = 1000

/** Text cut to `limit` characters (not inside a pair), with "…" if cut. */
function cut(text: string, limit: number): string {
  if (text.length <= limit) return text
  let end = limit
  const code = text.charCodeAt(end - 1)
  if (code >= 0xd800 && code <= 0xdbff) end--
  return `${text.slice(0, end).trimEnd()}…`
}

function changeJson(commit: CommitInfo): CatalogChangeJson {
  const time = commit.committer?.time ?? commit.author?.time
  const message = commit.message.replace(/\r\n?/g, "\n").trim()
  const newline = message.indexOf("\n")
  const subject = newline < 0 ? message : message.slice(0, newline)
  const body = newline < 0 ? "" : message.slice(newline + 1).trim()
  return {
    commit: commit.oid,
    subject: cut(subject, changeSubjectLimit),
    body: cut(body, changeBodyLimit),
    time: time === undefined ? null : new Date(time * 1000).toISOString(),
    merge: commit.parents.length > 1,
    pushed_by: null,
  }
}

/**
 * The cursors of a page's history: the last commit of a page, signed by
 * `web` for that workspace and file, so a cursor can only be one Shinan
 * gave out from the index's `main` (review of #192). A commit ID of the
 * browser's choosing could otherwise start the history on another branch,
 * whose content the browser never shows (plan §2.8).
 */
export interface HistoryCursors {
  issue(input: { workspaceId: string; path: string; commit: string }): string
  /** The commit a cursor names, or null if Shinan didn't issue it so. */
  read(
    cursor: string,
    input: { workspaceId: string; path: string },
  ): string | null
}

const objectId = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

/** History cursors signed with `key` (HMAC-SHA-256). */
export function historyCursors(key: string | Uint8Array): HistoryCursors {
  const sign = (workspaceId: string, path: string, commit: string) =>
    createHmac("sha256", key)
      .update(`shinan history cursor\n${workspaceId}\n${path}\n${commit}`)
      .digest("base64url")
  return {
    issue: ({ workspaceId, path, commit }) =>
      `${commit}.${sign(workspaceId, path, commit)}`,
    read(cursor, { workspaceId, path }) {
      const [commit, signature, ...rest] = cursor.split(".")
      if (rest.length > 0 || !commit || !signature || !objectId.test(commit))
        return null
      const expected = Buffer.from(sign(workspaceId, path, commit))
      const given = Buffer.from(signature)
      return given.length === expected.length &&
        timingSafeEqual(given, expected)
        ? commit
        : null
    },
  }
}

/**
 * A page's history (Git-based catalog plan §3): the commits of `main` that
 * changed its file, newest first, from the commit the index is at. Paged by
 * a cursor naming the last commit of the page before, not by a count to
 * skip, which on a long history gets slower with every page (review of
 * GC-1b). Shinan signs its cursors (`historyCursors`), so a page of
 * history only ever starts on a commit it listed from the index's `main`.
 * Each change carries its message's first line and the start of the rest.
 */
export async function getCatalogPageHistory(
  ctx: Context,
  git: GitClient | undefined,
  workspaceId: string,
  input: { id: string; after?: string; limit?: number },
  cursors: HistoryCursors,
): Promise<CatalogHistoryAnswer> {
  const id = idText(input.id, "id")
  const limit = input.limit ?? historyPageLimit
  if (!Number.isInteger(limit) || limit < 1 || limit > historyPageLimit)
    throw new InvalidInputError(
      "limit",
      `A page of history holds 1 to ${historyPageLimit} changes`,
    )
  if (input.after !== undefined && input.after.length > 200)
    throw new InvalidInputError("after", staleCursor)
  const located = await locate(ctx, workspaceId, id)
  const { answer, title } = located
  const path = located.path!
  let after: string | undefined
  if (input.after !== undefined) {
    after =
      cursors.read(input.after, { workspaceId: located.workspaceId, path }) ??
      undefined
    if (after === undefined) throw new InvalidInputError("after", staleCursor)
  }
  const empty = { ...answer, path, title, changes: [], next_after: null }
  if (answer.catalog_commit === null) return empty
  const client = requireGit(git)
  // One more than asked, to know whether there are older ones; and the
  // cursor itself, which the history from it starts with.
  const extra = after === undefined ? 1 : 2
  const { commits } = await fromGit(() =>
    client.history(located.workspaceId, {
      commit: after ?? answer.catalog_commit!,
      path,
      limit: limit + extra,
    }),
  )
  const older =
    after !== undefined && commits[0]?.oid === after
      ? commits.slice(1)
      : commits.slice(0, limit + 1)
  const page = older.slice(0, limit)
  return {
    ...empty,
    changes: page.map(changeJson),
    next_after:
      older.length > limit
        ? cursors.issue({
            workspaceId: located.workspaceId,
            path,
            commit: page[page.length - 1]!.oid,
          })
        : null,
  }
}

/** Why a cursor was refused: it isn't one Shinan gave out for this page. */
const staleCursor =
  "That list of changes is out of date: open History again to see older changes"

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
  const located = await locate(ctx, workspaceId, id)
  const { answer, path, title } = located
  if (answer.catalog_commit === null) throw new NotFoundError()
  const client = requireGit(git)
  const read = await fromGit(() =>
    client.readDocuments(located.workspaceId, {
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
  const located = await locate(ctx, workspaceId, null)
  const { answer } = located
  if (answer.catalog_commit === null) return { ...answer, readme: null }
  const client = requireGit(git)
  const read = await fromGit(() =>
    client.readDocuments(located.workspaceId, {
      commit: answer.catalog_commit!,
      paths: ["README.md"],
    }),
  )
  return { ...answer, readme: sourceOf(read.documents) }
}
