import { and, asc, eq, getTableColumns, inArray, schema, sql } from "@shinan/db"
import type { Database, IndexCheckDifference, Transaction } from "@shinan/db"

import { schemaIdPrefix } from "../document/ids.js"
import {
  buildTypeRegistry,
  maxDocumentBytes,
  parseCatalogDocument,
  parserVersion,
} from "../document/index.js"
import type {
  CatalogDocument,
  SchemaDocument,
  TypeRegistry,
} from "../document/index.js"
import { readDocumentId, unread } from "../document/parse.js"
import { GitServiceError } from "../git/client.js"
import type { GitClient } from "../git/client.js"
import { deriveDocumentRows, indexRulesVersion } from "./derive.js"
import type { DocumentRows } from "./derive.js"
import { pauser } from "./pause.js"
import {
  compare,
  isDocumentPath,
  isReadablePath,
  listDocuments,
  readTexts,
} from "./source.js"
import type { DocumentText, TreeDocument } from "./source.js"

/**
 * The indexer: the only code that writes the agent index (architecture
 * §5.3). It builds rows only from the documents on `main` of the
 * workspace's catalog repository, read through the Git container's API
 * (D-006; Git-based catalog plan §2.7): after an update of `main`, for the
 * documents the update changed and what depends on them, or for the whole
 * tree (a rebuild, and the daily round-trip check). The Git container is
 * never asked anything inside a database transaction.
 */

export type IndexState = typeof schema.catalogIndexState.$inferSelect

/**
 * Takes the workspace's index lock: the state row, created if missing.
 * Every write of the index holds it, so two builds never interleave.
 */
export async function lockIndexState(
  tx: Transaction,
  workspaceId: string,
): Promise<IndexState> {
  await tx
    .insert(schema.catalogIndexState)
    .values({ workspaceId, parserVersion, rulesVersion: indexRulesVersion })
    .onConflictDoNothing()
  const [state] = await tx
    .select()
    .from(schema.catalogIndexState)
    .where(eq(schema.catalogIndexState.workspaceId, workspaceId))
    .for("update")
  return state!
}

/**
 * A document's text, read: a file larger than the Git container reads, or
 * one whose name it cannot read, is a document with one problem.
 */
function parse(text: DocumentText): CatalogDocument {
  if ("text" in text) return parseCatalogDocument(text.text)
  if ("unreadablePath" in text)
    return unread(
      "",
      "unreadable-path",
      "Shinan cannot read a file by this name: it holds a control character or bytes that are not UTF-8. Rename the file to the document's ID plus .md",
    )
  return unread(
    "",
    "too-large",
    `The document is ${text.tooLarge} bytes long; a catalog document holds at most ${maxDocumentBytes} bytes (64 KiB)`,
  )
}

/** Whether a text is a type schema document's, from its frontmatter alone. */
function maybeSchema(text: DocumentText): boolean {
  return (
    "text" in text && !!readDocumentId(text.text)?.startsWith(schemaIdPrefix)
  )
}

/**
 * The type schemas the documents of one commit are read with, from that
 * commit's type schema documents (architecture §5.2: one parser reads
 * schemas and entities from the same text), and those documents, read.
 *
 * Kept between builds by each document's path and Git blob ID: the same
 * blob ID is always the same text, so nothing stale can come back.
 */
interface SchemaSet {
  registry: TypeRegistry
  documents: Map<string, CatalogDocument>
}

const registryCache = new Map<string, SchemaSet>()
const registryCacheSize = 32

function schemaKey(schemas: readonly { path: string; blob: string }[]): string {
  return [...schemas]
    .sort((a, b) => compare(a.path, b.path))
    .map((s) => `${s.path}:${s.blob}`)
    .join(",")
}

function cachedSchemas(key: string): SchemaSet | undefined {
  const entry = registryCache.get(key)
  if (entry) {
    registryCache.delete(key)
    registryCache.set(key, entry)
  }
  return entry
}

function schemaSet(
  key: string,
  documents: readonly { path: string; document: CatalogDocument }[],
): SchemaSet {
  const sorted = [...documents].sort((a, b) => compare(a.path, b.path))
  const entry: SchemaSet = {
    registry: buildTypeRegistry(
      sorted
        .map((d) => d.document)
        .filter((d): d is SchemaDocument => d.kind === "schema"),
    ),
    documents: new Map(sorted.map((d) => [d.path, d.document])),
  }
  registryCache.set(key, entry)
  if (registryCache.size > registryCacheSize)
    registryCache.delete(registryCache.keys().next().value!)
  return entry
}

/**
 * Empties the cache of parsed type schemas, so that no text parsed before a
 * purge stays in this process's memory (catalog §9).
 */
export function clearTypeSchemaCache(): void {
  registryCache.clear()
}

/**
 * Derives the index rows of every document of a tree from its texts alone:
 * the type schema documents first (found by their frontmatter), then every
 * document read with them. Calls `sink` with the rows of each batch of
 * documents, so the rows of a large catalog are never held at once, and
 * gives the event loop back between documents (#135); what it derives does
 * not depend on when it yields.
 */
export async function deriveTexts(
  workspaceId: string,
  texts: readonly DocumentText[],
  sink: (rows: DocumentRows[]) => Promise<void>,
  options: { batchSize?: number; pause?: () => Promise<void> } = {},
): Promise<number> {
  const batchSize = options.batchSize ?? 200
  const pause = options.pause ?? pauser()
  const schemas: { path: string; blob: string; document: CatalogDocument }[] =
    []
  for (const text of texts) {
    await pause()
    if (maybeSchema(text))
      schemas.push({ path: text.path, blob: text.blob, document: parse(text) })
  }
  const key = schemaKey(schemas)
  const { registry, documents } = cachedSchemas(key) ?? schemaSet(key, schemas)
  for (let i = 0; i < texts.length; i += batchSize) {
    const rows: DocumentRows[] = []
    for (const text of texts.slice(i, i + batchSize)) {
      await pause()
      const document = documents.get(text.path) ?? parse(text)
      if (document.kind === "schema" && !documents.has(text.path))
        throw new Error(
          `${text.path} is a type schema document that reading its frontmatter missed`,
        )
      rows.push(
        deriveDocumentRows({
          workspaceId,
          path: text.path,
          blob: text.blob,
          document,
          registry,
        }),
      )
    }
    await sink(rows)
  }
  return texts.length
}

/** What bringing a workspace's index up to `main` did. */
export interface IndexUpdate {
  /**
   * `unchanged`: the index already stood at `main`; `updated`: the
   * documents an update of `main` changed were indexed again; `rebuilt`:
   * every row was derived again from `main`; `no-repository`: the
   * workspace has no repository yet.
   */
  outcome: "unchanged" | "updated" | "rebuilt" | "no-repository"
  /** The commit the index now stands at. */
  commit: string | null
  /** How many documents' rows were derived. */
  documents: number
}

/**
 * Above this many changed documents (and a quarter of the catalog), an
 * update rebuilds instead: reading the whole tree is then about as quick.
 */
const updateLimit = 50

/** How often a build that finds the index moved under it starts again. */
const attempts = 3

/**
 * Brings a workspace's index up to its `main` (plan §2.7): a full rebuild
 * when the index was never built, was built by another parser or rules
 * version, or a rebuild is asked for (or `rebuild` is set), and otherwise
 * the documents changed between the commit the index stands at and `main`,
 * with what depends on them: when a type schema document changes, every
 * type schema document and the entities of the types it describes or
 * described (catalog §3.9). Either way the outcome is what a rebuild from
 * `main` gives (D-006).
 *
 * Reads `main` through the Git container first, then writes in one
 * transaction holding the index lock; if another build moved the index
 * meanwhile, it starts again. Readers see the old rows until it commits.
 */
export async function updateWorkspaceIndex(
  db: Database,
  git: GitClient,
  workspaceId: string,
  options: { rebuild?: boolean } = {},
): Promise<IndexUpdate> {
  for (let attempt = 1; ; attempt++) {
    const done = await updateOnce(db, git, workspaceId, options)
    if (done) return done
    if (attempt >= attempts)
      throw new Error(
        `The index of workspace ${workspaceId} kept moving while it was built`,
      )
  }
}

async function updateOnce(
  db: Database,
  git: GitClient,
  workspaceId: string,
  options: { rebuild?: boolean },
): Promise<IndexUpdate | null> {
  // The state first, then `main`: an update of `main` recorded in between
  // is then newer than the `main` read, and is kept (`nextMain`).
  const before = await db.transaction(async (tx) => {
    const [state] = await tx
      .select()
      .from(schema.catalogIndexState)
      .where(eq(schema.catalogIndexState.workspaceId, workspaceId))
    return {
      state,
      stale: state ? await hasStaleRows(tx, workspaceId) : false,
    }
  })
  const state = before.state
  const repository = await git.getRepository(workspaceId)
  if (!repository)
    return { outcome: "no-repository", commit: null, documents: 0 }
  const main = repository.main
  const full =
    options.rebuild === true ||
    !state ||
    state.commit === null ||
    stateBehind(state) ||
    before.stale

  if (!full && state.commit === main) {
    if (state.mainCommit !== main)
      await db
        .update(schema.catalogIndexState)
        .set({ mainCommit: main })
        .where(
          and(
            eq(schema.catalogIndexState.workspaceId, workspaceId),
            eq(schema.catalogIndexState.commit, main),
            mainCommitIs(state.mainCommit),
          ),
        )
    return { outcome: "unchanged", commit: main, documents: 0 }
  }

  if (!full) {
    const update = await planUpdate(db, git, workspaceId, state.commit!, main)
    if (update !== "rebuild") {
      const written = await db.transaction(async (tx) => {
        if (!(await stillAt(tx, workspaceId, state))) return false
        await deletePaths(tx, workspaceId, update.removed)
        await replaceRows(tx, workspaceId, update.rows)
        await tx
          .update(schema.catalogIndexState)
          .set({ commit: main, mainCommit: nextMain(state, main) })
          .where(eq(schema.catalogIndexState.workspaceId, workspaceId))
        return true
      })
      return written
        ? { outcome: "updated", commit: main, documents: update.rows.length }
        : null
    }
  }

  const texts = await readTexts(
    git,
    workspaceId,
    main,
    await listDocuments(git, workspaceId, main),
  )
  const written = await db.transaction(async (tx) => {
    if (!(await stillAt(tx, workspaceId, state))) return false
    // Each table by workspace, children first: much faster than cascading
    // from every document row.
    for (const table of [
      tables.facts,
      tables.relations,
      tables.discrepancies,
      tables.sections,
      tables.documents,
    ])
      await tx.delete(table).where(eq(table.workspaceId, workspaceId))
    await deriveTexts(workspaceId, texts, (rows) => insertRows(tx, rows))
    await tx
      .update(schema.catalogIndexState)
      .set({
        commit: main,
        mainCommit: nextMain(state, main),
        parserVersion,
        rulesVersion: indexRulesVersion,
        rebuildRequestedAt: null,
        rebuiltAt: sql`now()`,
      })
      .where(eq(schema.catalogIndexState.workspaceId, workspaceId))
    return true
  })
  return written
    ? { outcome: "rebuilt", commit: main, documents: texts.length }
    : null
}

/**
 * Inside the write transaction: takes the index lock, and says whether the
 * index still stands where it did when the build read it.
 */
async function stillAt(
  tx: Transaction,
  workspaceId: string,
  read: IndexState | undefined,
): Promise<boolean> {
  const now = await lockIndexState(tx, workspaceId)
  return (read?.commit ?? null) === now.commit
}

/**
 * The `main` to record once the index stands at `main`: the one read, unless
 * a newer update of `main` was recorded meanwhile, whose own job follows.
 */
function nextMain(read: IndexState | undefined, main: string) {
  return sql`case when ${mainCommitIs(read?.mainCommit ?? null)} then ${main} else ${schema.catalogIndexState.mainCommit} end`
}

function mainCommitIs(value: string | null) {
  return value === null
    ? sql`${schema.catalogIndexState.mainCommit} is null`
    : sql`${schema.catalogIndexState.mainCommit} = ${value}`
}

/** The rows an update of `main` writes. */
interface UpdatePlan {
  /** Paths that no longer hold a document. */
  removed: string[]
  /** The rows of the documents derived again. */
  rows: DocumentRows[]
}

/**
 * Works out an update from `from` to `main` and derives its rows, or says
 * to rebuild: when the Git container no longer has `from` (a purge
 * rewrote history), or the update changes more than `updateLimit`
 * documents and a quarter of the catalog.
 */
async function planUpdate(
  db: Database,
  git: GitClient,
  workspaceId: string,
  from: string,
  main: string,
): Promise<UpdatePlan | "rebuild"> {
  let changes
  try {
    ;({ changes } = await git.diff(workspaceId, { from, to: main }))
  } catch (error) {
    if (
      error instanceof GitServiceError &&
      error.status >= 400 &&
      error.status < 500
    )
      return "rebuild"
    throw error
  }
  const removed = new Set<string>()
  const changed = new Map<string, TreeDocument>()
  for (const c of changes) {
    // A name the Git container cannot read may stand for several files
    // (`listDocuments`): only a rebuild lists them as one.
    if (
      !isReadablePath(c.path) &&
      [c.oldMode, c.newMode].some(
        (mode) => mode !== null && isDocumentPath({ path: c.path, mode }),
      )
    )
      return "rebuild"
    if (c.oldMode !== null && isDocumentPath({ path: c.path, mode: c.oldMode }))
      removed.add(c.path)
    if (
      c.newMode !== null &&
      c.newOid !== null &&
      isDocumentPath({ path: c.path, mode: c.newMode })
    ) {
      removed.delete(c.path)
      changed.set(c.path, { path: c.path, blob: c.newOid })
    }
  }

  // What the index holds of the type schema documents and the changed paths.
  const t = schema.catalogIndexDocuments
  const columns = { path: t.path, blob: t.blob, kind: t.kind, type: t.type }
  const touched = [...removed, ...changed.keys()]
  const { indexed, total } = await db.transaction(async (tx) => {
    const rows = await tx
      .select(columns)
      .from(t)
      .where(
        and(
          eq(t.workspaceId, workspaceId),
          touched.length === 0
            ? eq(t.kind, "schema")
            : sql`(${t.kind} = 'schema' or ${inArray(t.path, touched)})`,
        ),
      )
    const [count] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(t)
      .where(eq(t.workspaceId, workspaceId))
    return {
      indexed: new Map(rows.map((r) => [r.path, r])),
      total: count?.total ?? 0,
    }
  })
  if (touched.length > Math.max(total / 4, updateLimit)) return "rebuild"

  // The documents to derive again, by path: first the changed ones.
  const derive = new Map<string, { blob: string; document: CatalogDocument }>()
  for (const text of await readTexts(git, workspaceId, main, [
    ...changed.values(),
  ]))
    derive.set(text.path, { blob: text.blob, document: parse(text) })

  // A type schema document changed: its types' entities, and every other
  // type schema document (which document defines a type can move from one
  // to another), are derived again.
  const types = new Set<string>()
  let schemasChanged = false
  for (const path of touched) {
    const before = indexed.get(path)
    if (before?.kind === "schema") {
      schemasChanged = true
      if (before.type !== null) types.add(before.type)
    }
    const after = derive.get(path)?.document
    if (after?.kind === "schema") {
      schemasChanged = true
      if (after.describes !== null) types.add(after.describes)
    }
  }

  // The type schemas of `main`: the unchanged schema documents, from the
  // cache or read again, and the changed ones.
  const kept = [...indexed.values()].filter(
    (r) => r.kind === "schema" && !removed.has(r.path) && !changed.has(r.path),
  )
  const changedSchemas = [...derive]
    .filter(([, d]) => d.document.kind === "schema")
    .map(([path, d]) => ({ path, blob: d.blob, document: d.document }))
  const key = schemaKey([...kept, ...changedSchemas])
  let set = cachedSchemas(key)
  const keptDocuments = set
    ? kept.map((r) => ({ ...r, document: set!.documents.get(r.path)! }))
    : (await readTexts(git, workspaceId, main, kept)).map((text) => ({
        path: text.path,
        blob: text.blob,
        document: parse(text),
      }))
  set ??= schemaSet(key, [...keptDocuments, ...changedSchemas])
  if (schemasChanged)
    for (const k of keptDocuments)
      derive.set(k.path, { blob: k.blob, document: k.document })

  if (types.size > 0) {
    const affected = await db
      .select({ path: t.path, blob: t.blob })
      .from(t)
      .where(
        and(
          eq(t.workspaceId, workspaceId),
          eq(t.kind, "entity"),
          inArray(t.type, [...types]),
        ),
      )
    const toRead = affected.filter(
      (a) => !derive.has(a.path) && !removed.has(a.path),
    )
    if (
      removed.size + derive.size + toRead.length >
      Math.max(total / 4, updateLimit)
    )
      return "rebuild"
    for (const text of await readTexts(git, workspaceId, main, toRead))
      derive.set(text.path, { blob: text.blob, document: parse(text) })
  }

  const pause = pauser()
  const rows: DocumentRows[] = []
  for (const [path, { blob, document }] of [...derive].sort(([a], [b]) =>
    compare(a, b),
  )) {
    await pause()
    rows.push(
      deriveDocumentRows({
        workspaceId,
        path,
        blob,
        document,
        registry: set.registry,
      }),
    )
  }
  return { removed: [...removed].sort(compare), rows }
}

/**
 * Whether a workspace's index must be rebuilt before it can be trusted: its
 * state says another parser or rules version built it, or a rebuild is
 * asked for.
 */
export function stateBehind(state: IndexState | undefined): boolean {
  return (
    !state ||
    state.parserVersion !== parserVersion ||
    state.rulesVersion !== indexRulesVersion ||
    state.rebuildRequestedAt !== null
  )
}

/**
 * Whether any of a workspace's index rows were built by another parser or
 * rules version, as an older release running against the same database
 * leaves them (a rollback, then a roll forward): the round-trip check then
 * reports the index as behind, not as differing from its text.
 */
export async function hasStaleRows(
  tx: Transaction,
  workspaceId: string,
): Promise<boolean> {
  const t = schema.catalogIndexDocuments
  const [row] = await tx
    .select({ path: t.path })
    .from(t)
    .where(
      and(
        eq(t.workspaceId, workspaceId),
        sql`(${t.parserVersion} <> ${parserVersion} or ${t.rulesVersion} <> ${indexRulesVersion})`,
      ),
    )
    .limit(1)
  return row !== undefined
}

/** The tables of the index, by the names the round-trip check reports. */
const tables = {
  documents: schema.catalogIndexDocuments,
  facts: schema.catalogIndexFacts,
  relations: schema.catalogIndexRelations,
  discrepancies: schema.catalogIndexDiscrepancies,
  sections: schema.catalogIndexSections,
} as const
type TableName = keyof typeof tables

export interface IndexComparison {
  documents: number
  /** Documents whose stored rows differ from what their text gives, with the tables that differ. */
  differences: IndexCheckDifference[]
}

/**
 * The round-trip check (architecture §5.3): the texts of one commit →
 * parse → index, compared with the stored index row by row. Run it in a
 * transaction that sees one snapshot (repeatable read), with `texts` read
 * at the commit the index stands at in that snapshot.
 */
export async function compareWorkspaceIndex(
  tx: Transaction,
  workspaceId: string,
  texts: readonly DocumentText[],
): Promise<IndexComparison> {
  const differences: IndexCheckDifference[] = []
  const pause = pauser()
  const documents = await deriveTexts(workspaceId, texts, async (batch) => {
    const stored = await storedRows(
      tx,
      workspaceId,
      batch.map((b) => b.document.path),
    )
    for (const derived of batch) {
      await pause()
      const path = derived.document.path
      const differing = (Object.keys(tables) as TableName[]).filter(
        (name) =>
          canonical(rowsOf(derived, name)) !==
          canonical(stored.get(path)?.[name] ?? []),
      )
      if (differing.length > 0) differences.push({ path, tables: differing })
    }
  })
  const paths = new Set(texts.map((t) => t.path))
  const extra = await tx
    .select({ path: tables.documents.path })
    .from(tables.documents)
    .where(eq(tables.documents.workspaceId, workspaceId))
    .orderBy(asc(tables.documents.path))
  for (const { path } of extra)
    if (!paths.has(path)) differences.push({ path, tables: ["documents"] })
  return { documents, differences }
}

function rowsOf(rows: DocumentRows, name: TableName): object[] {
  switch (name) {
    case "documents":
      return [rows.document]
    case "discrepancies":
      return [...rows.discrepancies].sort((a, b) => (a.key < b.key ? -1 : 1))
    default:
      return rows[name]
  }
}

async function storedRows(
  tx: Transaction,
  workspaceId: string,
  paths: readonly string[],
): Promise<Map<string, Record<TableName, object[]>>> {
  const of = (table: (typeof tables)[TableName]) =>
    and(eq(table.workspaceId, workspaceId), inArray(table.path, [...paths]))
  const d = tables.documents
  const f = tables.facts
  const r = tables.relations
  const x = tables.discrepancies
  const s = tables.sections
  const found: Record<TableName, { path: string }[]> = {
    documents: await tx.select().from(d).where(of(d)),
    facts: await tx
      .select()
      .from(f)
      .where(of(f))
      .orderBy(asc(f.path), asc(f.position)),
    relations: await tx
      .select()
      .from(r)
      .where(of(r))
      .orderBy(asc(r.path), asc(r.position)),
    discrepancies: await tx
      .select()
      .from(x)
      .where(of(x))
      .orderBy(asc(x.path), asc(x.key)),
    sections: await tx
      .select()
      .from(s)
      .where(of(s))
      .orderBy(asc(s.path), asc(s.position)),
  }
  const byPath = new Map<string, Record<TableName, object[]>>()
  for (const name of Object.keys(found) as TableName[]) {
    for (const row of found[name]) {
      // The search columns are generated by PostgreSQL from the others.
      const stored: Record<string, unknown> = { ...row }
      delete stored.search
      delete stored.searchSimple
      let entry = byPath.get(row.path)
      if (!entry) {
        entry = {
          documents: [],
          facts: [],
          relations: [],
          discrepancies: [],
          sections: [],
        }
        byPath.set(row.path, entry)
      }
      entry[name].push(stored)
    }
  }
  return byPath
}

/** A stable text form of rows: keys sorted, times as ISO text, absent values left out. */
function canonical(value: unknown): string {
  return JSON.stringify(value, function (this: unknown, key, v: unknown) {
    if (v instanceof Date) return v.toISOString()
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {}
      for (const k of Object.keys(v).sort())
        sorted[k] = (v as Record<string, unknown>)[k]
      return sorted
    }
    return v
  })
}

/** Deletes the index rows of the given paths. */
async function deletePaths(
  tx: Transaction,
  workspaceId: string,
  paths: readonly string[],
): Promise<void> {
  if (paths.length === 0) return
  await tx
    .delete(tables.documents)
    .where(
      and(
        eq(tables.documents.workspaceId, workspaceId),
        inArray(tables.documents.path, [...paths]),
      ),
    )
}

/** Replaces the index rows of the given documents. */
async function replaceRows(
  tx: Transaction,
  workspaceId: string,
  rows: readonly DocumentRows[],
): Promise<void> {
  if (rows.length === 0) return
  await deletePaths(
    tx,
    workspaceId,
    rows.map((r) => r.document.path),
  )
  await insertRows(tx, rows)
}

/** Rows per insert statement: well under PostgreSQL's 65,535 parameters for the widest table. */
const chunkSize = 2000

async function insertRows(
  tx: Transaction,
  rows: readonly DocumentRows[],
): Promise<void> {
  await insertJson(
    tx,
    tables.documents,
    rows.map((r) => r.document),
  )
  await insertJson(
    tx,
    tables.facts,
    rows.flatMap((r) => r.facts),
  )
  await insertJson(
    tx,
    tables.relations,
    rows.flatMap((r) => r.relations),
  )
  await insertJson(
    tx,
    tables.discrepancies,
    rows.flatMap((r) => r.discrepancies),
  )
  await insertJson(
    tx,
    tables.sections,
    rows.flatMap((r) => r.sections),
  )
}

/**
 * Inserts rows as one JSON parameter that PostgreSQL turns into records,
 * which is several times faster for a rebuild's thousands of rows than a
 * statement with a parameter per value. Generated columns are left out.
 */
async function insertJson(
  tx: Transaction,
  table: (typeof tables)[TableName],
  rows: readonly object[],
): Promise<void> {
  if (rows.length === 0) return
  const columns = Object.entries(
    getTableColumns(table) as Record<
      string,
      { name: string; generated: unknown }
    >,
  ).filter(([, column]) => !column.generated)
  const records = rows.map((row) => {
    const record: Record<string, unknown> = {}
    for (const [key, column] of columns)
      record[column.name] = (row as Record<string, unknown>)[key] ?? null
    return record
  })
  const names = sql.join(
    columns.map(([, column]) => sql.identifier(column.name)),
    sql`, `,
  )
  for (let i = 0; i < records.length; i += chunkSize)
    await tx.execute(
      sql`insert into ${table} (${names}) select ${names} from jsonb_populate_recordset(null::${table}, ${JSON.stringify(records.slice(i, i + chunkSize))}::jsonb)`,
    )
}
