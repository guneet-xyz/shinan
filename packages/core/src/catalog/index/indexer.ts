import { createHash } from "node:crypto"

import { and, asc, eq, getTableColumns, inArray, schema, sql } from "@shinan/db"
import type { IndexCheckDifference, Transaction } from "@shinan/db"

import {
  buildTypeRegistry,
  maxDocumentBytes,
  parseCatalogDocument,
  parserVersion,
  utf8Length,
} from "../document/index.js"
import type {
  CatalogDocument,
  SchemaDocument,
  Section,
  TypeRegistry,
} from "../document/index.js"
import { splitFrontmatter } from "../document/parse.js"
import { attributeSections } from "./attribution.js"
import type { AttributedSection, RevisionAuthor } from "./attribution.js"
import { deriveDocumentRows } from "./derive.js"
import type { DocumentRows } from "./derive.js"
import {
  latestRevision,
  latestTexts,
  revisionAuthors,
  textHistory,
} from "./store.js"
import type { StoredText } from "./store.js"

/**
 * The indexer: the only code that writes the agent index (architecture
 * §5.2, rule 6). It builds rows only from stored text (rule 3), either for
 * the documents one revision changed, inside the transaction that applies
 * it (rule 4), or for a whole workspace from its history (a rebuild, and the
 * daily round-trip check, rule 5).
 */

export type IndexState = typeof schema.catalogIndexState.$inferSelect

/**
 * Takes the workspace's index lock: the state row, created if missing.
 * Applying a revision and rebuilding the index both hold it, so a rebuild
 * never overwrites a revision applied while it ran, and revision numbers
 * are handed out one at a time.
 */
export async function lockIndexState(
  tx: Transaction,
  workspaceId: string,
): Promise<IndexState> {
  await tx
    .insert(schema.catalogIndexState)
    .values({ workspaceId, parserVersion })
    .onConflictDoNothing()
  const [state] = await tx
    .select()
    .from(schema.catalogIndexState)
    .where(eq(schema.catalogIndexState.workspaceId, workspaceId))
    .for("update")
  return state!
}

/** A document a revision changed, with its new text and, if the caller has it, the text already parsed. */
export interface ChangedDocument {
  documentId: string
  text: string
  /** `parseCatalogDocument(text)`, so a text already read is not read again. */
  parsed?: CatalogDocument
}

/**
 * Indexes the documents a revision changed, inside the transaction that
 * applies it, with the index lock held (`lockIndexState`) and the
 * revision's text already stored. Re-reads only what the change affects:
 * the changed documents, the type schema documents, and, when a type schema
 * document changed, the entities of the types it describes or described
 * (catalog §3.9: changing a schema re-indexes that type's entities).
 */
export async function indexRevision(
  tx: Transaction,
  workspaceId: string,
  change: RevisionAuthor,
  documents: readonly ChangedDocument[],
): Promise<void> {
  const changed = new Map(
    documents.map((d) => [
      d.documentId,
      {
        revision: change.revision,
        document: d.parsed ?? parseCatalogDocument(d.text),
      },
    ]),
  )
  const t = schema.catalogIndexDocuments
  const columns = {
    documentId: t.documentId,
    kind: t.kind,
    type: t.type,
    parserVersion: t.parserVersion,
  }
  const indexed = await tx
    .select(columns)
    .from(t)
    .where(
      and(
        eq(t.workspaceId, workspaceId),
        sql`(${t.kind} = 'schema' or ${inArray(t.documentId, [...changed.keys()])})`,
      ),
    )
    .then((rows) => new Map(rows.map((r) => [r.documentId, r])))

  const { registry, stored: storedSchemas } = await registryFor(
    tx,
    workspaceId,
    indexed,
    changed,
  )

  // When a type schema document changes, the entities of the types it
  // describes or described are read again, and so is every other type
  // schema document: which document defines a type can move from one to
  // another (a type with two schema documents).
  const types = new Set<string>()
  let schemasChanged = false
  for (const [documentId, { document }] of changed) {
    const before = indexed.get(documentId)
    if (before?.kind === "schema") {
      schemasChanged = true
      if (before.type !== null) types.add(before.type)
    }
    if (document.kind === "schema") {
      schemasChanged = true
      if (document.describes !== null) types.add(document.describes)
    }
  }
  const affectedRows =
    types.size === 0
      ? []
      : await tx
          .select(columns)
          .from(t)
          .where(
            and(
              eq(t.workspaceId, workspaceId),
              eq(t.kind, "entity"),
              inArray(t.type, [...types]),
            ),
          )
  for (const row of affectedRows) indexed.set(row.documentId, row)
  const affected = affectedRows
    .map((row) => row.documentId)
    .filter((id) => !changed.has(id))
  const unchanged = new Map(
    (await latestTexts(tx, workspaceId, affected)).map((s) => [
      s.documentId,
      { revision: s.revision, document: parseCatalogDocument(s.text) },
    ]),
  )
  if (schemasChanged)
    for (const [documentId, schemaDocument] of storedSchemas)
      unchanged.set(documentId, schemaDocument)

  const all = [...changed.keys(), ...unchanged.keys()]
  const credits = await storedCredits(
    tx,
    all.filter((id) => indexed.get(id)?.parserVersion === parserVersion),
  )
  // A document with no earlier revision starts with no credits.
  const earlier = await documentsWithEarlierText(
    tx,
    workspaceId,
    [...changed.keys()].filter((id) => !credits.has(id)),
    change.revision,
  )
  for (const id of changed.keys())
    if (!credits.has(id) && !earlier.has(id)) credits.set(id, [])
  const rows: DocumentRows[] = []
  for (const [documentId, { revision, document }] of [
    ...changed,
    ...unchanged,
  ]) {
    const sections = document.body.sections
    const previous = credits.get(documentId)
    let attribution: AttributedSection[]
    if (changed.has(documentId) && previous) {
      attribution = attributeSections(previous, sections, change)
    } else if (
      !changed.has(documentId) &&
      previous &&
      same(previous, sections)
    ) {
      attribution = previous
    } else {
      attribution = await replayDocument(tx, workspaceId, documentId, revision)
    }
    rows.push(
      deriveDocumentRows({
        workspaceId,
        documentId,
        revision,
        document,
        registry,
        attribution,
      }),
    )
  }
  await replaceRows(tx, workspaceId, rows)
  await tx
    .update(schema.catalogIndexState)
    .set({ revision: change.revision })
    .where(eq(schema.catalogIndexState.workspaceId, workspaceId))
}

function same(
  credits: readonly AttributedSection[],
  sections: readonly Section[],
): boolean {
  return (
    credits.length === sections.length &&
    credits.every(
      (c, i) =>
        c.anchor === sections[i]!.anchor && c.text === sections[i]!.text,
    )
  )
}

/** Which of the documents have text from a revision before `revision`. */
async function documentsWithEarlierText(
  tx: Transaction,
  workspaceId: string,
  documentIds: readonly string[],
  revision: number,
): Promise<Set<string>> {
  if (documentIds.length === 0) return new Set()
  const r = schema.catalogRevisionDocuments
  const rows = await tx
    .selectDistinct({ documentId: r.documentId })
    .from(r)
    .where(
      and(
        eq(r.workspaceId, workspaceId),
        inArray(r.documentId, [...documentIds]),
        sql`${r.revision} < ${revision}`,
      ),
    )
  return new Set(rows.map((row) => row.documentId))
}

/** The stored section credits of documents, by document. */
async function storedCredits(
  tx: Transaction,
  documentIds: readonly string[],
): Promise<Map<string, AttributedSection[]>> {
  const credits = new Map<string, AttributedSection[]>(
    documentIds.map((id) => [id, []]),
  )
  if (documentIds.length === 0) return credits
  const s = schema.catalogIndexSections
  const rows = await tx
    .select({
      documentId: s.documentId,
      anchor: s.anchor,
      text: s.text,
      changedRevision: s.changedRevision,
      authorKind: s.authorKind,
      author: s.author,
      leastTrustedKind: s.leastTrustedKind,
      leastTrusted: s.leastTrusted,
    })
    .from(s)
    .where(inArray(s.documentId, [...documentIds]))
    .orderBy(asc(s.documentId), asc(s.position))
  for (const { documentId, ...credit } of rows)
    credits.get(documentId)!.push(credit)
  return credits
}

/** A document's section credits from its whole history, up to `revision`. */
async function replayDocument(
  tx: Transaction,
  workspaceId: string,
  documentId: string,
  revision: number,
): Promise<AttributedSection[]> {
  const history = await textHistory(tx, workspaceId, [documentId], revision)
  const authors = await revisionAuthors(
    tx,
    workspaceId,
    history.map((h) => h.revision),
  )
  return replay(history, authors).attribution
}

/**
 * Replays one document's history: its section credits after its last
 * revision, and that revision's text, read. A revision whose body is
 * exactly the previous one's has the same sections, so it is not read
 * again; the size limit is the one thing outside the body that changes
 * what the body gives, so both texts must be within it.
 *
 * This relies on the body being read on its own, before the frontmatter,
 * with its own failures caught (`parseCatalogDocument`). Only a bug that
 * throws while reading frontmatter (`read-failed`) would empty the sections
 * of a revision this skips; the daily round-trip check would then report
 * the document.
 */
function replay(
  history: readonly StoredText[],
  authors: ReadonlyMap<number, RevisionAuthor>,
): { attribution: AttributedSection[]; document: CatalogDocument | null } {
  let attribution: AttributedSection[] = []
  let document: CatalogDocument | null = null
  let previousBody: string | null = null
  let previousFits = false
  for (const [i, { revision, text }] of history.entries()) {
    const last = i === history.length - 1
    const fits = utf8Length(text) <= maxDocumentBytes
    const body = text.slice(splitFrontmatter(text).bodyStart)
    const unchanged = fits && previousFits && body === previousBody
    previousBody = body
    previousFits = fits
    if (unchanged && !last) continue
    const read = parseCatalogDocument(text)
    if (last) document = read
    const author = authors.get(revision)
    if (!author) throw new Error(`Catalog revision ${revision} has no record`)
    attribution = attributeSections(attribution, read.body.sections, author)
  }
  return { attribution, document }
}

/**
 * The type schemas the documents of a revision are read with: the stored
 * type schema documents, with any the revision changed in their new form
 * (architecture §5.2: one parser reads schemas and entities from the same
 * revision). Also returns the stored ones, read.
 *
 * The parsed schemas are kept between revisions, keyed by each document's
 * ID and a hash of its exact text, never by revision number: a revision
 * rolled back leaves its number free for the next one, and purge rewrites a
 * revision's text in place, so neither can bring back a stale schema.
 */
async function registryFor(
  tx: Transaction,
  workspaceId: string,
  indexed: ReadonlyMap<string, { kind: string }>,
  changed: ReadonlyMap<string, { revision: number; document: CatalogDocument }>,
): Promise<{
  registry: TypeRegistry
  stored: Map<string, { revision: number; document: CatalogDocument }>
}> {
  const storedIds = [...indexed]
    .filter(([id, row]) => row.kind === "schema" && !changed.has(id))
    .map(([id]) => id)
  const texts = await latestTexts(tx, workspaceId, storedIds)
  const versions = [
    ...texts.map((t) => ({
      documentId: t.documentId,
      text: t.text,
      revision: t.revision,
      parsed: undefined as CatalogDocument | undefined,
    })),
    ...[...changed]
      .filter(([, c]) => c.document.kind === "schema")
      .map(([documentId, c]) => ({
        documentId,
        text: c.document.text,
        revision: c.revision,
        parsed: c.document,
      })),
  ].sort((a, b) => (a.documentId < b.documentId ? -1 : 1))

  const key = versions
    .map(
      (v) =>
        `${v.documentId}:${createHash("sha256").update(v.text).digest("base64")}`,
    )
    .join(",")
  let entry = registryCache.get(key)
  if (entry) {
    registryCache.delete(key)
  } else {
    const documents = versions.map(
      (v) => v.parsed ?? parseCatalogDocument(v.text),
    )
    entry = {
      registry: buildTypeRegistry(
        documents.filter((d): d is SchemaDocument => d.kind === "schema"),
      ),
      documents: new Map(versions.map((v, i) => [v.documentId, documents[i]!])),
    }
  }
  registryCache.set(key, entry)
  if (registryCache.size > registryCacheSize)
    registryCache.delete(registryCache.keys().next().value!)

  const stored = new Map<
    string,
    { revision: number; document: CatalogDocument }
  >()
  for (const t of texts)
    stored.set(t.documentId, {
      revision: t.revision,
      document: entry.documents.get(t.documentId)!,
    })
  return { registry: entry.registry, stored }
}

/** Recently used type schemas, by schema documents' IDs and text hashes. */
const registryCache = new Map<
  string,
  { registry: TypeRegistry; documents: Map<string, CatalogDocument> }
>()
const registryCacheSize = 32

/**
 * Derives a whole workspace's index from its stored text alone: the latest
 * text of every document, read with the type schemas of the same revision,
 * and each document's history for its section credits. Calls `sink` with
 * the rows of each batch of documents, so a large catalog is never held in
 * memory at once.
 */
export async function deriveWorkspace(
  tx: Transaction,
  workspaceId: string,
  sink: (rows: DocumentRows[]) => Promise<void>,
  batchSize = 200,
): Promise<number> {
  const latest = await latestTexts(tx, workspaceId)
  const schemas: SchemaDocument[] = []
  for (const { text } of latest) {
    const document = parseCatalogDocument(text)
    if (document.kind === "schema") schemas.push(document)
  }
  const registry = buildTypeRegistry(schemas)
  const authors = await revisionAuthors(tx, workspaceId)
  const ids = latest.map((l) => l.documentId)
  latest.length = 0

  for (let i = 0; i < ids.length; i += batchSize) {
    const history = await textHistory(
      tx,
      workspaceId,
      ids.slice(i, i + batchSize),
    )
    const rows: DocumentRows[] = []
    let start = 0
    while (start < history.length) {
      const documentId = history[start]!.documentId
      let end = start
      while (end < history.length && history[end]!.documentId === documentId)
        end++
      const own = history.slice(start, end)
      const { attribution, document } = replay(own, authors)
      rows.push(
        deriveDocumentRows({
          workspaceId,
          documentId,
          revision: own[own.length - 1]!.revision,
          document: document!,
          registry,
          attribution,
        }),
      )
      start = end
    }
    await sink(rows)
  }
  return ids.length
}

/**
 * Rebuilds a workspace's index from its stored text: deletes every index
 * row and derives them again (catalog §2.1, rule 3; architecture §5.3).
 * Holds the index lock, so revisions applied meanwhile wait and are then
 * indexed on top.
 */
export async function rebuildWorkspaceIndex(
  tx: Transaction,
  workspaceId: string,
): Promise<{ revision: number; documents: number }> {
  await lockIndexState(tx, workspaceId)
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
  const documents = await deriveWorkspace(tx, workspaceId, (rows) =>
    insertRows(tx, rows),
  )
  const revision = await latestRevision(tx, workspaceId)
  await tx
    .update(schema.catalogIndexState)
    .set({
      revision,
      parserVersion,
      rebuildRequestedAt: null,
      rebuiltAt: sql`now()`,
    })
    .where(eq(schema.catalogIndexState.workspaceId, workspaceId))
  return { revision, documents }
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
 * The round-trip check (architecture §5.2, rule 5): text → parse → index,
 * compared with the stored index, row by row. Run it in a transaction that
 * sees one snapshot (repeatable read), so revisions applied meanwhile
 * cannot show up as differences.
 */
export async function compareWorkspaceIndex(
  tx: Transaction,
  workspaceId: string,
): Promise<IndexComparison> {
  const differences: IndexCheckDifference[] = []
  const documents = await deriveWorkspace(tx, workspaceId, async (batch) => {
    const stored = await storedRows(
      tx,
      batch.map((b) => b.document.documentId),
    )
    for (const derived of batch) {
      const id = derived.document.documentId
      const differing = (Object.keys(tables) as TableName[]).filter(
        (name) =>
          canonical(rowsOf(derived, name)) !==
          canonical(stored.get(id)?.[name] ?? []),
      )
      if (differing.length > 0)
        differences.push({ documentId: id, tables: differing })
    }
  })
  const [extra] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.catalogIndexDocuments)
    .where(eq(schema.catalogIndexDocuments.workspaceId, workspaceId))
  if ((extra?.count ?? 0) !== documents)
    differences.push({ documentId: "*", tables: ["documents"] })
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
  documentIds: readonly string[],
): Promise<Map<string, Record<TableName, object[]>>> {
  const ids = [...documentIds]
  const d = tables.documents
  const f = tables.facts
  const r = tables.relations
  const x = tables.discrepancies
  const s = tables.sections
  const found: Record<TableName, { documentId: string; search?: unknown }[]> = {
    documents: await tx.select().from(d).where(inArray(d.documentId, ids)),
    facts: await tx
      .select()
      .from(f)
      .where(inArray(f.documentId, ids))
      .orderBy(asc(f.documentId), asc(f.position)),
    relations: await tx
      .select()
      .from(r)
      .where(inArray(r.documentId, ids))
      .orderBy(asc(r.documentId), asc(r.position)),
    discrepancies: await tx
      .select()
      .from(x)
      .where(inArray(x.documentId, ids))
      .orderBy(asc(x.documentId), asc(x.key)),
    sections: await tx
      .select()
      .from(s)
      .where(inArray(s.documentId, ids))
      .orderBy(asc(s.documentId), asc(s.position)),
  }
  const byDocument = new Map<string, Record<TableName, object[]>>()
  for (const name of Object.keys(found) as TableName[]) {
    for (const row of found[name]) {
      // The search columns are generated by PostgreSQL from the others.
      const stored: Record<string, unknown> = { ...row }
      delete stored.search
      delete stored.searchSimple
      let entry = byDocument.get(row.documentId)
      if (!entry) {
        entry = {
          documents: [],
          facts: [],
          relations: [],
          discrepancies: [],
          sections: [],
        }
        byDocument.set(row.documentId, entry)
      }
      entry[name].push(stored)
    }
  }
  return byDocument
}

/** A stable text form of rows: keys sorted, times as ISO text, absent values left out. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
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

/** Replaces the index rows of the given documents. */
async function replaceRows(
  tx: Transaction,
  workspaceId: string,
  rows: readonly DocumentRows[],
): Promise<void> {
  if (rows.length === 0) return
  await tx.delete(schema.catalogIndexDocuments).where(
    and(
      eq(schema.catalogIndexDocuments.workspaceId, workspaceId),
      inArray(
        schema.catalogIndexDocuments.documentId,
        rows.map((r) => r.document.documentId),
      ),
    ),
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
