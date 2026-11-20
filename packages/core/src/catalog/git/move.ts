import { createHash } from "node:crypto"

import { and, eq, isNull, schema, sql } from "@shinan/db"
import type {
  CatalogMoveProblem,
  CatalogMoveWaitingProposal,
  Transaction,
} from "@shinan/db"

import { atInstallation } from "../../authorize.js"
import type { Context, InstallationScope } from "../../context.js"
import {
  isEntityId,
  parseCatalogDocument,
  readCatalog,
  slugPattern,
  typeNamePattern,
  validateCatalog,
} from "../document/index.js"
import { readDocumentId } from "../document/parse.js"
import { recordCatalogMain } from "../index/maintain.js"
import type { GitClient } from "./client.js"
import {
  repositoryFirstCommitMessage,
  repositoryReadme,
} from "./repositories.js"

/**
 * The move of M2's catalog into Git (Git-based catalog plan §4.1, GC-6):
 * a step of `migrate`, between the migrations that add the new tables and
 * the one that drops M2's (§4.2). For each workspace without a repository
 * (no `catalog_repositories` row: one that existed before v0.4.0), it asks
 * the Git container to make the repository with one commit by Shinan
 * holding every document's current text byte for byte, at its current ID
 * plus `.md` (retired documents included), and `README.md`; reads the
 * commit back and compares every file by SHA-256; validates the moved
 * catalog, reporting its problems rather than refusing them (it is the
 * existing catalog); reports the proposals left waiting (GD-12: they are
 * not applied); and records the verified move (`catalog_moves`), which the
 * drop requires. Any mismatch stops `migrate` before anything is dropped.
 *
 * The first commit is first pushed by `shinan` (the Git container records
 * it), so the moved fact checks, which name the agents that checked them
 * in M2, stay valid until a push changes them (D-066). Idempotent: a
 * workspace with a repository is skipped.
 */

/** The move found something it cannot carry over, or the commit read back differs. */
export class CatalogMoveError extends Error {
  override name = "CatalogMoveError"
}

/** What the move did for one workspace. */
export interface CatalogMoveReport {
  workspaceId: string
  /** M2's latest revision; 0 for a workspace without M2 documents. */
  revision: number
  documents: number
  firstCommit: string
  /** Whether the Git container made the repository now, or had it from an earlier run. */
  created: boolean
  waitingProposals: CatalogMoveWaitingProposal[]
  problems: CatalogMoveProblem[]
}

/** The first commit's message for a moved catalog (plan §4.1). */
export function catalogMoveMessage(revision: number): string {
  return `Import the catalog from PostgreSQL (revision ${revision})\n`
}

/** A document of M2, as the move carries it. */
interface MovedDocument {
  path: string
  /** Its current text, as stored. */
  content: Uint8Array
}

/**
 * Moves the catalog of every workspace without a repository into Git.
 * Returns what it did; an empty list when there was nothing to move.
 */
export async function moveCatalogsIntoGit(
  ctx: Context,
  git: GitClient | undefined,
  options: { now?: number } = {},
): Promise<CatalogMoveReport[]> {
  const workspaces = await atInstallation(ctx, "catalog.move", (scope) =>
    workspacesWithoutRepository(scope.tx),
  )
  if (workspaces.length === 0) return []
  if (!git) {
    throw new CatalogMoveError(
      `${workspaces.length === 1 ? "A workspace has" : `${workspaces.length} workspaces have`} no catalog repository yet: migrate needs the Git container (SHINAN_GIT_URL and SHINAN_GIT_SERVICE_TOKEN) to move the catalog into Git`,
    )
  }
  const reports: CatalogMoveReport[] = []
  for (const workspaceId of workspaces) {
    reports.push(
      await moveOne(ctx, git, workspaceId, options.now ?? Date.now()),
    )
  }
  return reports
}

async function moveOne(
  ctx: Context,
  git: GitClient,
  workspaceId: string,
  now: number,
): Promise<CatalogMoveReport> {
  const m2 = await atInstallation(ctx, "catalog.move", (scope) =>
    readM2(scope, workspaceId),
  )
  const files: MovedDocument[] = [
    { path: "README.md", content: new TextEncoder().encode(repositoryReadme) },
    ...m2.documents,
  ]
  const message =
    m2.documents.length === 0
      ? repositoryFirstCommitMessage
      : catalogMoveMessage(m2.revision)

  // Outside any transaction: the Git container may take a while.
  const made = await git.createRepository(workspaceId, { files, message })
  await verify(git, workspaceId, made.main, files, message, made.created)
  const problems = validationReport(
    m2.documents.map((d) => new TextDecoder().decode(d.content)),
    { now, memberHandles: new Set(m2.memberHandles) },
  )

  await atInstallation(ctx, "catalog.move", async (scope) => {
    const r = schema.catalogRepositories
    await scope.tx
      .insert(r)
      .values({ workspaceId, createdAt: sql`now()`, firstCommit: made.main })
      .onConflictDoUpdate({
        target: r.workspaceId,
        set: { createdAt: sql`now()`, firstCommit: made.main },
        where: isNull(r.firstCommit),
      })
    await scope.tx.insert(schema.catalogMoves).values({
      workspaceId,
      revision: m2.revision,
      documents: m2.documents.length,
      firstCommit: made.main,
      waitingProposals: m2.waiting,
      problems,
    })
    // The agent index is built from the new `main` (GC-4): queued here
    // when there is a job queue, and in any case by the worker's catch-up
    // when it starts (`migrate` has none).
    if (scope.jobs)
      await recordCatalogMain({
        tx: scope.tx,
        jobs: scope.jobs,
        workspaceId,
        commit: made.main,
      })
  })
  return {
    workspaceId,
    revision: m2.revision,
    documents: m2.documents.length,
    firstCommit: made.main,
    created: made.created,
    waitingProposals: m2.waiting,
    problems,
  }
}

async function workspacesWithoutRepository(tx: Transaction): Promise<string[]> {
  const w = schema.workspaces
  const r = schema.catalogRepositories
  const rows = await tx
    .select({ id: w.id })
    .from(w)
    .leftJoin(r, eq(r.workspaceId, w.id))
    .where(isNull(r.workspaceId))
    .orderBy(w.createdAt, w.id)
  return rows.map((row) => row.id)
}

/**
 * The workspace's M2 catalog: every document's current text at the path
 * of its current ID, its latest revision, and the proposals left waiting.
 * M2's tables have no Drizzle definitions any more (they are dropped right
 * after this step), so they are read by name, and only while they exist.
 */
async function readM2(
  scope: InstallationScope<"catalog.move">,
  workspaceId: string,
): Promise<{
  documents: MovedDocument[]
  revision: number
  waiting: CatalogMoveWaitingProposal[]
  memberHandles: string[]
}> {
  const { tx } = scope
  const handles = await tx
    .select({ handle: schema.people.handle })
    .from(schema.members)
    .innerJoin(schema.people, eq(schema.people.id, schema.members.personId))
    .where(
      and(
        eq(schema.members.workspaceId, workspaceId),
        isNull(schema.members.removedAt),
      ),
    )
  const memberHandles = handles.map((h) => h.handle)
  const present = await tx.execute<{ present: boolean }>(
    sql`select to_regclass('public.catalog_documents') is not null as present`,
  )
  if (!present.rows[0]?.present)
    return { documents: [], revision: 0, waiting: [], memberHandles }

  const texts = await tx.execute<{ id: string; text: string }>(sql`
    select d.id, rd.text
    from catalog_documents d
    join catalog_revision_documents rd
      on rd.workspace_id = d.workspace_id
      and rd.document_id = d.id
      and rd.revision = d.current_revision
    where d.workspace_id = ${workspaceId}
    order by d.created_at, d.id`)
  const revision = await tx.execute<{ revision: number }>(sql`
    select coalesce(max(number), 0)::int as revision
    from catalog_revisions where workspace_id = ${workspaceId}`)
  const waiting = await tx.execute<{ number: number; touches: string[] }>(sql`
    select number, touches from catalog_proposals
    where workspace_id = ${workspaceId} and state = 'pending'
    order by number`)

  const byPath = new Map<string, MovedDocument>()
  for (const row of texts.rows) {
    const id = readDocumentId(row.text)
    // Never the text itself, nor an ID that would not be a path: M2 kept
    // them valid, so this is a damaged catalog to look at first.
    if (id === null || !isPath(`${id}.md`)) {
      throw new CatalogMoveError(
        `Workspace ${workspaceId}: catalog document ${row.id} has no ID usable as a path, so it cannot be moved; repair it in v0.3.0 first`,
      )
    }
    const path = `${id}.md`
    if (byPath.has(path)) {
      throw new CatalogMoveError(
        `Workspace ${workspaceId}: two catalog documents have the ID ${id}, so they cannot both be moved; repair them in v0.3.0 first`,
      )
    }
    byPath.set(path, { path, content: new TextEncoder().encode(row.text) })
  }
  return {
    documents: [...byPath.values()].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    ),
    revision: revision.rows[0]?.revision ?? 0,
    waiting: waiting.rows.map((p) => ({
      number: p.number,
      touches: [...p.touches].sort(),
    })),
    memberHandles,
  }
}

/** A document's path on `main`: `<type>/<slug>.md`, `schema/<type>.md` or `start-here.md`. */
function isPath(path: string): boolean {
  if (path === "start-here.md") return true
  const match = /^([^/]+)\/([^/]+)\.md$/.exec(path)
  if (!match) return false
  const [, folder, name] = match
  return folder === "schema"
    ? typeNamePattern.test(name!)
    : typeNamePattern.test(folder!) &&
        slugPattern.test(name!) &&
        isEntityId(`${folder}/${name}`)
}

const sha256 = (content: Uint8Array) =>
  createHash("sha256").update(content).digest("hex")

/**
 * Reads the first commit back: one commit by Shinan with no parent and the
 * message asked for, holding exactly the files asked for as plain files,
 * each equal to its stored text by SHA-256.
 */
async function verify(
  git: GitClient,
  workspaceId: string,
  commit: string,
  files: MovedDocument[],
  message: string,
  created: boolean,
): Promise<void> {
  const fail = (why: string): never => {
    throw new CatalogMoveError(
      `Workspace ${workspaceId}: the ${created ? "new" : "existing"} repository does not hold the catalog as stored: ${why}. Nothing was dropped.`,
    )
  }
  const { commits } = await git.history(workspaceId, { commit, limit: 2 })
  const first = commits.length === 1 ? commits[0] : undefined
  if (!first || first.parents.length > 0)
    return fail("main is not one first commit")
  if (first.author?.name !== "Shinan" || first.committer?.name !== "Shinan")
    fail("its first commit is not by Shinan")
  if (first.message !== message) fail("its first commit's message differs")

  const tree = await git.listTree(workspaceId, { commit })
  if (tree.truncated) fail("its tree is too large to list")
  const blobs = tree.entries.filter((e) => e.type !== "tree")
  const expected = new Map(files.map((f) => [f.path, sha256(f.content)]))
  for (const entry of blobs) {
    if (!expected.has(entry.path))
      fail(`it holds ${entry.path}, which is not in the catalog`)
    if (entry.type !== "blob" || entry.mode !== "100644")
      fail(`${entry.path} is not a plain file`)
  }
  if (blobs.length !== files.length)
    fail(`it holds ${blobs.length} files instead of ${files.length}`)

  let left = [...expected.keys()]
  while (left.length > 0) {
    const read = await git.readDocuments(workspaceId, { commit, paths: left })
    const deferred: string[] = []
    for (const document of read.documents) {
      if ("deferred" in document && document.deferred) {
        deferred.push(document.path)
        continue
      }
      if (!("content" in document)) fail(`${document.path} could not be read`)
      const content = (document as { content: Uint8Array }).content
      if (sha256(content) !== expected.get(document.path))
        fail(`${document.path} differs from its stored text`)
      expected.delete(document.path)
    }
    if (deferred.length === left.length) fail("its files could not be read")
    left = deferred
  }
  if (expected.size > 0)
    fail(`${[...expected.keys()][0]} could not be read back`)
}

/**
 * The problems the moved catalog reads with, by code and document ID only:
 * reported, never refused. The `by` rule does not apply: the documents
 * are in their first commit, first pushed by Shinan.
 */
function validationReport(
  texts: string[],
  context: { now: number; memberHandles: ReadonlySet<string> },
): CatalogMoveProblem[] {
  if (texts.length === 0) return []
  const documents = texts.map((text) => parseCatalogDocument(text))
  const { problems } = validateCatalog(readCatalog(documents), context)
  return problems
    .map((p) => ({
      code: p.code,
      severity: p.severity,
      document: p.documentId,
    }))
    .sort((a, b) =>
      `${a.document ?? ""} ${a.code}` < `${b.document ?? ""} ${b.code}`
        ? -1
        : 1,
    )
}

/**
 * What `migrate` writes about a move, a few lines per workspace: counts,
 * proposal numbers, catalog IDs and problem codes, never catalog text.
 */
export function catalogMoveLines(report: CatalogMoveReport): string[] {
  const lines = [
    report.documents === 0
      ? `Workspace ${report.workspaceId}: no catalog documents; its repository starts with README.md (${report.firstCommit})`
      : `Workspace ${report.workspaceId}: moved ${report.documents} catalog ${report.documents === 1 ? "document" : "documents"} at revision ${report.revision} into Git, verified file by file (first commit ${report.firstCommit})`,
  ]
  for (const proposal of report.waitingProposals) {
    lines.push(
      `Workspace ${report.workspaceId}: catalog proposal #${proposal.number} was waiting for approval and is not applied (it touched ${proposal.touches.join(", ") || "nothing"}); redo it by pushing`,
    )
  }
  if (report.problems.length > 0) {
    const byCode = new Map<string, Set<string>>()
    for (const problem of report.problems) {
      const key = `${problem.code} (${problem.severity})`
      const list = byCode.get(key) ?? new Set<string>()
      list.add(problem.document ?? "a document without an ID")
      byCode.set(key, list)
    }
    lines.push(
      `Workspace ${report.workspaceId}: the moved catalog reads with ${report.problems.length} ${report.problems.length === 1 ? "problem" : "problems"}, kept as they were: ${[...byCode].map(([code, documents]) => `${code} in ${[...documents].join(", ")}`).join("; ")}`,
    )
  }
  return lines
}
