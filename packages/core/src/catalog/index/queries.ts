import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  ne,
  schema,
  sql,
} from "@shinan/db"
import type { Column, SQL, Transaction } from "@shinan/db"

import { inWorkspace, snapshotRead } from "../../authorize.js"
import type { Context } from "../../context.js"
import { InvalidInputError, NotFoundError } from "../../errors.js"
import {
  builtInSchemas,
  entityStatuses,
  schemaId,
  workspaceTarget,
} from "../document/index.js"
import type { EntityStatus, FactState } from "../document/index.js"
import { factJson, sectionJson, summaryJson, typeSchemaJson } from "./format.js"
import type {
  AppliesJson,
  CatalogAnswer,
  DiscrepancyJson,
  EntityJson,
  EntitySummaryJson,
  FactJson,
  IncomingRelationJson,
  OutgoingRelationJson,
  ResolvedStepJson,
  SectionJson,
  StepJson,
  TypeSchemaAnswerJson,
  TypeSchemaJson,
} from "./format.js"
import { hasStaleRows, stateBehind } from "./indexer.js"

/**
 * Reading the agent index (catalog §12.2): the queries the catalog pages
 * use. Every answer names the commit of `main` it was built from and says
 * when the index is behind; each is read from one snapshot, so the commit
 * and the rows agree. Freshness is computed here, when read, never stored.
 */

const documents = schema.catalogIndexDocuments
const facts = schema.catalogIndexFacts
const relations = schema.catalogIndexRelations
const sections = schema.catalogIndexSections

type DocumentRecord = typeof documents.$inferSelect

/**
 * The commit of `main` the index stands at, and whether it is behind: not
 * yet built while the workspace has a repository, behind the latest
 * recorded `main`, built by another parser or rules version, or being
 * rebuilt.
 */
export async function answerFor(
  tx: Transaction,
  workspaceId: string,
): Promise<CatalogAnswer> {
  const [state] = await tx
    .select()
    .from(schema.catalogIndexState)
    .where(eq(schema.catalogIndexState.workspaceId, workspaceId))
  if (!state || state.commit === null) {
    const [repository] = await tx
      .select({ workspaceId: schema.catalogRepositories.workspaceId })
      .from(schema.catalogRepositories)
      .where(
        and(
          eq(schema.catalogRepositories.workspaceId, workspaceId),
          isNotNull(schema.catalogRepositories.firstCommit),
        ),
      )
    return { catalog_commit: null, index_behind: repository !== undefined }
  }
  return {
    catalog_commit: state.commit,
    index_behind:
      state.commit !== state.mainCommit ||
      stateBehind(state) ||
      (await hasStaleRows(tx, workspaceId)),
  }
}

/** A page of a list: at most `limit` items, from `offset`. */
export interface ListInput {
  offset?: number
  /** 50 by default, at most 500. */
  limit?: number
}

export interface ListAnswer<T> extends CatalogAnswer {
  items: T[]
  /** The offset of the next page, or null on the last one. */
  next_offset: number | null
}

function page(input: ListInput): { offset: number; limit: number } {
  const offset = input.offset ?? 0
  const limit = input.limit ?? 50
  if (!Number.isInteger(offset) || offset < 0)
    throw new InvalidInputError("offset", "The offset is a whole number from 0")
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw new InvalidInputError(
      "limit",
      "The limit is a whole number from 1 to 500",
    )
  return { offset, limit }
}

/** Reads one more than a page, to tell whether another page follows. */
function paged<T>(
  rows: T[],
  { offset, limit }: { offset: number; limit: number },
): { items: T[]; next_offset: number | null } {
  return {
    items: rows.slice(0, limit),
    next_offset: rows.length > limit ? offset + limit : null,
  }
}

/**
 * Text a query takes: 1 to `max` characters with no control characters,
 * which never appear in IDs, types or search words, and which PostgreSQL
 * refuses (a NUL byte) or which would only hide what was asked.
 */
function catalogText(value: unknown, name: string, max = 500): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > max ||
    // eslint-disable-next-line no-control-regex -- control characters are what it looks for
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new InvalidInputError(
      name,
      `The ${name} is text of 1 to ${max} characters, without control characters`,
    )
  return value
}

/** Entities only, which have an ID. */
const isEntity = and(
  eq(documents.kind, "entity"),
  sql`${documents.catalogId} is not null`,
)

/** Retired entities are left out unless asked for (catalog §9). */
function statusFilter(input: {
  status?: EntityStatus
  includeRetired?: boolean
}): SQL | undefined {
  if (input.status !== undefined) {
    if (!entityStatuses.includes(input.status))
      throw new InvalidInputError(
        "status",
        `The status is one of ${entityStatuses.join(", ")}`,
      )
    return eq(documents.status, input.status)
  }
  return input.includeRetired
    ? undefined
    : sql`${documents.status} is distinct from 'retired'`
}

/** The entity with this ID, or with it as an alias (catalog §2.4). */
async function findEntity(
  tx: Transaction,
  workspaceId: string,
  id: string,
): Promise<DocumentRecord | null> {
  const [row] = await tx
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.workspaceId, workspaceId),
        isEntity,
        sql`(${documents.catalogId} = ${id} or ${documents.aliases} @> array[${id}]::text[])`,
      ),
    )
    .orderBy(sql`${documents.catalogId} = ${id} desc`, asc(documents.path))
    .limit(1)
  return row ?? null
}

async function requireEntity(
  tx: Transaction,
  workspaceId: string,
  id: unknown,
): Promise<DocumentRecord> {
  const row = await findEntity(tx, workspaceId, catalogText(id, "id"))
  if (!row) throw new NotFoundError()
  return row
}

/** Entities by ID or alias, with an ID winning over an alias. */
async function summaries(
  tx: Transaction,
  workspaceId: string,
  references: readonly string[],
): Promise<Map<string, EntitySummaryJson>> {
  const found = new Map<string, EntitySummaryJson>()
  const wanted = [...new Set(references)]
  if (wanted.length === 0) return found
  const rows = await tx
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.workspaceId, workspaceId),
        isEntity,
        sql`(${inArray(documents.catalogId, wanted)} or ${documents.aliases} && ${sql`array[${sql.join(
          wanted.map((w) => sql`${w}`),
          sql`, `,
        )}]::text[]`})`,
      ),
    )
    .orderBy(asc(documents.path))
  for (const row of rows)
    if (!found.has(row.catalogId!)) found.set(row.catalogId!, summaryJson(row))
  const want = new Set(wanted)
  for (const row of rows)
    for (const alias of row.aliases)
      if (want.has(alias) && !found.has(alias))
        found.set(alias, summaryJson(row))
  return found
}

export interface CatalogEntityAnswer extends CatalogAnswer {
  entity: EntityJson
}

/** One entity by ID or alias, in the agent index's format (catalog §12.1, §12.4). */
export async function getCatalogEntity(
  ctx: Context,
  workspaceId: string,
  input: { id: string },
): Promise<CatalogEntityAnswer> {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.read",
    (scope) => readCatalogEntity(scope.tx, scope.workspaceId, input),
    snapshotRead,
  )
}

/** `getCatalogEntity` inside a transaction the caller has checked for `catalog.read`. */
export async function readCatalogEntity(
  tx: Transaction,
  workspaceId: string,
  input: { id: string },
): Promise<CatalogEntityAnswer> {
  const answer = await answerFor(tx, workspaceId)
  const row = await requireEntity(tx, workspaceId, input.id)
  return {
    ...answer,
    entity: await entityJson(tx, workspaceId, row, Date.now()),
  }
}

async function entityJson(
  tx: Transaction,
  workspaceId: string,
  row: DocumentRecord,
  now: number,
): Promise<EntityJson> {
  const factRows = await tx
    .select()
    .from(facts)
    .where(ofDocument(facts, row))
    .orderBy(asc(facts.position))
  const discrepancyRows = await tx
    .select()
    .from(schema.catalogIndexDiscrepancies)
    .where(ofDocument(schema.catalogIndexDiscrepancies, row))
    .orderBy(asc(schema.catalogIndexDiscrepancies.key))
  const sectionRows = await tx
    .select()
    .from(sections)
    .where(ofDocument(sections, row))
    .orderBy(asc(sections.position))
  const links = await relationsOf(tx, workspaceId, row)

  const json: EntityJson = {
    ...summaryJson(row),
    replaced_by: row.replacedBy,
    aliases: row.aliases,
    imported_from: row.importedFrom,
    path: row.path,
    blob: row.blob,
    facts: factRows.map((f) => factJson(f, now)),
    relations: { outgoing: links.outgoing, incoming: links.incoming },
    discrepancies: discrepancyRows.map((d): DiscrepancyJson => ({
      key: d.key,
      values: d.values,
      accepted: d.accepted,
      facts: d.identities,
    })),
    known_unknowns: factRows
      .filter((f) => f.state === "unknown")
      .map((f) => f.identity),
    not_yet_recorded: {
      missing_keys: row.missingKeys,
      not_checked: factRows
        .filter((f) => f.hasCheck && f.checked === null)
        .map((f) => f.identity),
    },
    applies: await appliesTo(tx, workspaceId, row),
    body: sectionRows.map(sectionJson),
    problems: row.problems,
  }
  if (row.type === "decision") {
    json.decision_state = row.decisionState
    json.decided_on = row.decidedOn
    json.decided_by = row.decidedBy
  }
  return json
}

/** The rows of one table that belong to a document. */
function ofDocument(
  table: { workspaceId: Column; path: Column },
  row: Pick<DocumentRecord, "workspaceId" | "path">,
): SQL {
  return and(eq(table.workspaceId, row.workspaceId), eq(table.path, row.path))!
}

/** Joins a table's rows to their document. */
function joinDocument(table: { workspaceId: Column; path: Column }): SQL {
  return and(
    eq(documents.workspaceId, table.workspaceId),
    eq(documents.path, table.path),
  )!
}

/** The IDs a relation may name this entity by: its ID and its aliases. */
function namesOf(row: DocumentRecord): string[] {
  return [row.catalogId!, ...row.aliases]
}

async function relationsOf(
  tx: Transaction,
  workspaceId: string,
  row: DocumentRecord,
): Promise<{
  outgoing: OutgoingRelationJson[]
  incoming: IncomingRelationJson[]
}> {
  const written = await tx
    .select()
    .from(relations)
    .where(and(ofDocument(relations, row), eq(relations.field, false)))
    .orderBy(asc(relations.position))
  const targets = await summaries(
    tx,
    workspaceId,
    written.map((r) => r.toId),
  )
  const incoming = await tx
    .select({ relation: relations, from: documents })
    .from(relations)
    .innerJoin(documents, joinDocument(relations))
    .where(
      and(
        eq(relations.workspaceId, workspaceId),
        inArray(relations.toId, namesOf(row)),
      ),
    )
    .orderBy(asc(relations.fromId), asc(relations.position))
  return {
    outgoing: written.map((r) => ({
      key: r.key,
      to: r.toId,
      state: r.state as FactState,
      identity: r.identity!,
      attributes: r.attributes,
      entity: targets.get(r.toId) ?? null,
    })),
    incoming: incoming.map(({ relation: r, from }) => ({
      key: r.key,
      inverse: r.inverse,
      from: summaryJson(from),
      state: r.state as FactState | null,
      identity: r.identity,
      attributes: r.attributes,
    })),
  }
}

/**
 * The policies and runbooks that apply to an entity through `applies-to`:
 * those naming it, its type (`schema/<type>`) or the whole workspace
 * (catalog §5, §12.1). Retired ones no longer apply.
 */
async function appliesTo(
  tx: Transaction,
  workspaceId: string,
  row: DocumentRecord,
): Promise<EntityJson["applies"]> {
  const names = namesOf(row)
  const targets = [
    ...names,
    workspaceTarget,
    ...(row.type ? [schemaId(row.type)] : []),
  ]
  const rows = await tx
    .select({ relation: relations, from: documents })
    .from(relations)
    .innerJoin(documents, joinDocument(relations))
    .where(
      and(
        eq(relations.workspaceId, workspaceId),
        eq(relations.key, "applies-to"),
        eq(relations.field, false),
        inArray(relations.toId, targets),
        inArray(documents.type, ["policy", "runbook"]),
        sql`${documents.status} is distinct from 'retired'`,
      ),
    )
    .orderBy(asc(relations.fromId), asc(relations.position))
  const applies: EntityJson["applies"] = { policies: [], runbooks: [] }
  for (const { relation, from } of rows) {
    const item: AppliesJson = {
      entity: summaryJson(from),
      through:
        relation.toId === workspaceTarget
          ? "workspace"
          : names.includes(relation.toId)
            ? "entity"
            : "type",
      state: relation.state as FactState | null,
      identity: relation.identity,
    }
    if (from.type === "policy") applies.policies.push(item)
    else applies.runbooks.push(item)
  }
  return applies
}

export interface CatalogNeighboursAnswer extends CatalogAnswer {
  entity: EntitySummaryJson
  outgoing: OutgoingRelationJson[]
  incoming: IncomingRelationJson[]
}

/** An entity's neighbours through relations, in both directions (catalog §5). */
export async function getCatalogNeighbours(
  ctx: Context,
  workspaceId: string,
  input: { id: string },
): Promise<CatalogNeighboursAnswer> {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.read",
    (scope) => readCatalogNeighbours(scope.tx, scope.workspaceId, input),
    snapshotRead,
  )
}

/** `getCatalogNeighbours` inside a transaction the caller has checked for `catalog.read`. */
export async function readCatalogNeighbours(
  tx: Transaction,
  workspaceId: string,
  input: { id: string },
): Promise<CatalogNeighboursAnswer> {
  const answer = await answerFor(tx, workspaceId)
  const row = await requireEntity(tx, workspaceId, input.id)
  return {
    ...answer,
    entity: summaryJson(row),
    ...(await relationsOf(tx, workspaceId, row)),
  }
}

export interface CatalogAppliesAnswer extends CatalogAnswer {
  entity: EntitySummaryJson
  policies: AppliesJson[]
  runbooks: AppliesJson[]
}

/** The policies and runbooks that apply to an entity. */
export async function getCatalogPoliciesFor(
  ctx: Context,
  workspaceId: string,
  input: { id: string },
): Promise<CatalogAppliesAnswer> {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.read",
    (scope) => readCatalogPoliciesFor(scope.tx, scope.workspaceId, input),
    snapshotRead,
  )
}

/** `getCatalogPoliciesFor` inside a transaction the caller has checked for `catalog.read`. */
export async function readCatalogPoliciesFor(
  tx: Transaction,
  workspaceId: string,
  input: { id: string },
): Promise<CatalogAppliesAnswer> {
  const answer = await answerFor(tx, workspaceId)
  const row = await requireEntity(tx, workspaceId, input.id)
  return {
    ...answer,
    entity: summaryJson(row),
    ...(await appliesTo(tx, workspaceId, row)),
  }
}

export interface ListEntitiesInput extends ListInput {
  type?: string
  status?: EntityStatus
  includeRetired?: boolean
}

/** Entities by type and status, by ID (catalog §10 index pages). */
export async function listCatalogEntities(
  ctx: Context,
  workspaceId: string,
  input: ListEntitiesInput = {},
): Promise<ListAnswer<EntitySummaryJson>> {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.read",
    (scope) => readCatalogEntities(scope.tx, scope.workspaceId, input),
    snapshotRead,
  )
}

/** `listCatalogEntities` inside a transaction the caller has checked for `catalog.read`. */
export async function readCatalogEntities(
  tx: Transaction,
  workspaceId: string,
  input: ListEntitiesInput = {},
): Promise<ListAnswer<EntitySummaryJson>> {
  const range = page(input)
  const answer = await answerFor(tx, workspaceId)
  const rows = await tx
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.workspaceId, workspaceId),
        isEntity,
        input.type === undefined
          ? undefined
          : eq(documents.type, catalogText(input.type, "type", 100)),
        statusFilter(input),
      ),
    )
    .orderBy(asc(documents.catalogId), asc(documents.path))
    .offset(range.offset)
    .limit(range.limit + 1)
  return { ...answer, ...paged(rows.map(summaryJson), range) }
}

export interface SearchInput {
  /** Words to look for, as in a web search: `"exact phrase"`, `or`, `-word`. */
  text: string
  type?: string
  status?: EntityStatus
  includeRetired?: boolean
  /** 20 by default, at most 100. */
  limit?: number
}

export interface SearchResultJson {
  entity: EntitySummaryJson
  rank: number
  /** The body sections that match, best first, at most three. */
  sections: SectionJson[]
}

/**
 * Full-text search across titles, summaries, facts and body sections
 * (catalog §12.2; PostgreSQL full-text search, architecture §4.1). Retired
 * entities are left out unless asked for (catalog §9).
 */
export async function searchCatalog(
  ctx: Context,
  workspaceId: string,
  input: SearchInput,
): Promise<CatalogAnswer & { items: SearchResultJson[] }> {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.read",
    (scope) => readCatalogSearch(scope.tx, scope.workspaceId, input),
    snapshotRead,
  )
}

/** `searchCatalog` inside a transaction the caller has checked for `catalog.read`. */
export async function readCatalogSearch(
  tx: Transaction,
  workspaceId: string,
  input: SearchInput,
): Promise<CatalogAnswer & { items: SearchResultJson[] }> {
  const text = catalogText(input.text, "text")
  const limit = input.limit ?? 20
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new InvalidInputError(
      "limit",
      "The limit is a whole number from 1 to 100",
    )
  const answer = await answerFor(tx, workspaceId)
  // Each configuration is matched against its own vector over the same
  // fields, so `-word` excludes the word wherever it appears.
  const english = sql`websearch_to_tsquery('english', ${text})`
  const simple = sql`websearch_to_tsquery('simple', ${text})`
  const matches = (table: typeof documents | typeof sections): [SQL, SQL] => [
    sql`(${table.search} @@ ${english} or ${table.searchSimple} @@ ${simple})`,
    sql`greatest(ts_rank(${table.search}, ${english}), ts_rank(${table.searchSimple}, ${simple}))`,
  ]
  const [documentMatch, documentRank] = matches(documents)
  const [sectionMatch, sectionRank] = matches(sections)
  const filters = and(
    eq(documents.workspaceId, workspaceId),
    isEntity,
    input.type === undefined
      ? undefined
      : eq(documents.type, catalogText(input.type, "type", 100)),
    statusFilter(input),
  )
  // An entity matches as a whole (its fields, facts and body), so a
  // word after a minus leaves it out wherever the word is; its best
  // matching section can lift its rank.
  const bestSection = sql`coalesce((select max(${sectionRank}) from ${sections} where ${sections.workspaceId} = ${documents.workspaceId} and ${sections.path} = ${documents.path} and ${sectionMatch}), 0)`
  const rank = sql<number>`greatest(${documentRank}, ${bestSection})::float8`
  const ranked = await tx
    .select({ path: documents.path, rank })
    .from(documents)
    .where(and(filters, documentMatch))
    .orderBy(desc(rank), asc(documents.path))
    .limit(limit)
  if (ranked.length === 0) return { ...answer, items: [] }

  const paths = ranked.map((r) => r.path)
  const rows = new Map(
    (
      await tx
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.workspaceId, workspaceId),
            inArray(documents.path, paths),
          ),
        )
    ).map((r) => [r.path, r]),
  )
  const sectionRows = await tx
    .select({
      section: sections,
      rank: sql<number>`${sectionRank}`,
    })
    .from(sections)
    .where(
      and(
        eq(sections.workspaceId, workspaceId),
        inArray(sections.path, paths),
        sectionMatch,
      ),
    )
    .orderBy(desc(sectionRank), asc(sections.position))
  return {
    ...answer,
    items: ranked.map((r) => ({
      entity: summaryJson(rows.get(r.path)!),
      rank: r.rank,
      sections: sectionRows
        .filter((s) => s.section.path === r.path)
        .slice(0, 3)
        .map((s) => sectionJson(s.section)),
    })),
  }
}

export interface CatalogTypeSchemaAnswer extends CatalogAnswer {
  schema: TypeSchemaAnswerJson
}

/**
 * A type schema (catalog §3, §3.9): a built-in type, with any workspace
 * extension, or a custom type, with its schema document's text.
 */
export async function getCatalogTypeSchema(
  ctx: Context,
  workspaceId: string,
  input: { type: string },
): Promise<CatalogTypeSchemaAnswer> {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.read",
    (scope) => readCatalogTypeSchema(scope.tx, scope.workspaceId, input),
    snapshotRead,
  )
}

/** `getCatalogTypeSchema` inside a transaction the caller has checked for `catalog.read`. */
export async function readCatalogTypeSchema(
  tx: Transaction,
  workspaceId: string,
  input: { type: string },
): Promise<CatalogTypeSchemaAnswer> {
  const type = catalogText(input.type, "type", 100)
  const answer = await answerFor(tx, workspaceId)
  const [row] = await tx
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.workspaceId, workspaceId),
        eq(documents.kind, "schema"),
        eq(documents.type, type),
        sql`${documents.data} is not null`,
      ),
    )
    .orderBy(asc(documents.path))
    .limit(1)
  if (row) {
    const body = await tx
      .select()
      .from(sections)
      .where(ofDocument(sections, row))
      .orderBy(asc(sections.position))
    return {
      ...answer,
      schema: {
        ...(row.data as { schema: TypeSchemaJson }).schema,
        title: row.title,
        summary: row.summary,
        body: body.map(sectionJson),
      },
    }
  }
  const builtIn = builtInSchemas.get(type)
  if (!builtIn) throw new NotFoundError()
  return {
    ...answer,
    schema: {
      ...typeSchemaJson(builtIn),
      title: null,
      summary: null,
      body: [],
    },
  }
}

/** Every type schema, built-in and custom, by type name (catalog §12.1). */
export async function listCatalogTypeSchemas(
  ctx: Context,
  workspaceId: string,
): Promise<CatalogAnswer & { items: TypeSchemaJson[] }> {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.read",
    (scope) => readCatalogTypeSchemas(scope.tx, scope.workspaceId),
    snapshotRead,
  )
}

/** `listCatalogTypeSchemas` inside a transaction the caller has checked for `catalog.read`. */
export async function readCatalogTypeSchemas(
  tx: Transaction,
  workspaceId: string,
): Promise<CatalogAnswer & { items: TypeSchemaJson[] }> {
  const answer = await answerFor(tx, workspaceId)
  const rows = await tx
    .select({ type: documents.type, data: documents.data })
    .from(documents)
    .where(
      and(
        eq(documents.workspaceId, workspaceId),
        eq(documents.kind, "schema"),
        sql`${documents.data} is not null`,
      ),
    )
    .orderBy(asc(documents.path))
  const types = new Map<string, TypeSchemaJson>()
  for (const [type, builtIn] of builtInSchemas)
    types.set(type, typeSchemaJson(builtIn))
  const seen = new Set<string>()
  for (const row of rows) {
    if (row.type === null || seen.has(row.type)) continue
    seen.add(row.type)
    types.set(row.type, (row.data as { schema: TypeSchemaJson }).schema)
  }
  return {
    ...answer,
    items: [...types.values()].sort((a, b) => (a.type < b.type ? -1 : 1)),
  }
}

/** The workspace-wide lists (catalog §10, §12.1). */
export const catalogLists = [
  "discrepancies",
  "due-for-recheck",
  "known-unknowns",
  "not-yet-recorded",
] as const
export type CatalogList = (typeof catalogLists)[number]

export interface CatalogListInput extends ListInput {
  list: CatalogList
  includeRetired?: boolean
}

/** A discrepancy, with its entity and its facts. */
export interface DiscrepancyItemJson extends DiscrepancyJson {
  entity: EntitySummaryJson
  /** The facts of the discrepancy, with both sides' evidence. */
  fact_details: FactJson[]
}

/** A fact due for recheck, or a known unknown, with its entity. */
export interface FactItemJson {
  entity: EntitySummaryJson
  fact: FactJson
}

/** Required keys an entity does not mention, and its facts never checked (catalog §4.8). */
export interface NotYetRecordedItemJson {
  entity: EntitySummaryJson
  missing_keys: string[]
  not_checked: FactJson[]
}

export type CatalogListItem =
  DiscrepancyItemJson | FactItemJson | NotYetRecordedItemJson

/**
 * One of the workspace-wide lists: discrepancies (accepted ones included,
 * marked), facts due for recheck (most overdue first), known unknowns, and
 * the quieter not-yet-recorded list. Retired entities are left out unless
 * asked for.
 */
export async function getCatalogList(
  ctx: Context,
  workspaceId: string,
  input: CatalogListInput,
): Promise<ListAnswer<CatalogListItem>> {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.read",
    (scope) => readCatalogList(scope.tx, scope.workspaceId, input),
    snapshotRead,
  )
}

/** `getCatalogList` inside a transaction the caller has checked for `catalog.read`. */
export async function readCatalogList(
  tx: Transaction,
  workspaceId: string,
  input: CatalogListInput,
): Promise<ListAnswer<CatalogListItem>> {
  if (!catalogLists.includes(input.list))
    throw new InvalidInputError(
      "list",
      `The list is one of ${catalogLists.join(", ")}`,
    )
  const range = page(input)
  const answer = await answerFor(tx, workspaceId)
  const now = Date.now()
  const inScope = and(
    eq(documents.workspaceId, workspaceId),
    isEntity,
    statusFilter(input),
  )
  let items: CatalogListItem[]
  switch (input.list) {
    case "discrepancies": {
      const d = schema.catalogIndexDiscrepancies
      const rows = await tx
        .select({ discrepancy: d, document: documents })
        .from(d)
        .innerJoin(documents, joinDocument(d))
        .where(inScope)
        .orderBy(asc(d.entityId), asc(d.key), asc(d.path))
        .offset(range.offset)
        .limit(range.limit + 1)
      const factRows = await factsOf(
        tx,
        workspaceId,
        rows.map((r) => r.document.path),
      )
      items = rows.map(({ discrepancy, document }) => ({
        entity: summaryJson(document),
        key: discrepancy.key,
        values: discrepancy.values,
        accepted: discrepancy.accepted,
        facts: discrepancy.identities,
        fact_details: factRows
          .filter(
            (f) =>
              f.path === document.path &&
              discrepancy.identities.includes(f.identity),
          )
          .map((f) => factJson(f, now)),
      }))
      break
    }
    case "due-for-recheck":
    case "known-unknowns": {
      const due = input.list === "due-for-recheck"
      const rows = await tx
        .select({ fact: facts, document: documents })
        .from(facts)
        .innerJoin(documents, joinDocument(facts))
        .where(
          and(
            inScope,
            due
              ? sql`${facts.dueAt} <= ${new Date(now)}`
              : eq(facts.state, "unknown"),
          ),
        )
        .orderBy(
          ...(due ? [asc(facts.dueAt)] : []),
          asc(facts.entityId),
          asc(facts.path),
          asc(facts.position),
        )
        .offset(range.offset)
        .limit(range.limit + 1)
      items = rows.map(({ fact, document }) => ({
        entity: summaryJson(document),
        fact: factJson(fact, now),
      }))
      break
    }
    case "not-yet-recorded": {
      const rows = await tx
        .select()
        .from(documents)
        .where(
          and(
            inScope,
            sql`(cardinality(${documents.missingKeys}) > 0 or exists (select 1 from ${facts} where ${facts.workspaceId} = ${documents.workspaceId} and ${facts.path} = ${documents.path} and ${facts.hasCheck} and ${facts.checked} is null))`,
          ),
        )
        .orderBy(asc(documents.catalogId), asc(documents.path))
        .offset(range.offset)
        .limit(range.limit + 1)
      const factRows = await factsOf(
        tx,
        workspaceId,
        rows.map((r) => r.path),
      )
      items = rows.map((document) => ({
        entity: summaryJson(document),
        missing_keys: document.missingKeys,
        not_checked: factRows
          .filter(
            (f) => f.path === document.path && f.hasCheck && f.checked === null,
          )
          .map((f) => factJson(f, now)),
      }))
      break
    }
  }
  return { ...answer, ...paged(items, range) }
}

async function factsOf(
  tx: Transaction,
  workspaceId: string,
  paths: readonly string[],
) {
  if (paths.length === 0) return []
  return tx
    .select()
    .from(facts)
    .where(
      and(
        eq(facts.workspaceId, workspaceId),
        inArray(facts.path, [...new Set(paths)]),
      ),
    )
    .orderBy(asc(facts.path), asc(facts.position))
}

export interface StartHereJson {
  path: "people" | "agents"
  title: string | null
  summary: string | null
  /** The start-here document's path on `main` and the Git blob ID of its text. */
  document: { path: string; blob: string }
  steps: ResolvedStepJson[]
}

/**
 * A start-here path (catalog §11), the agents' by default: its steps in
 * order, each entity step with the entity it names. Null when the workspace
 * has no start-here document yet.
 */
export async function getCatalogStartHere(
  ctx: Context,
  workspaceId: string,
  input: { path?: "people" | "agents" } = {},
): Promise<CatalogAnswer & { start_here: StartHereJson | null }> {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.read",
    (scope) => readCatalogStartHere(scope.tx, scope.workspaceId, input),
    snapshotRead,
  )
}

/** `getCatalogStartHere` inside a transaction the caller has checked for `catalog.read`. */
export async function readCatalogStartHere(
  tx: Transaction,
  workspaceId: string,
  input: { path?: "people" | "agents" } = {},
): Promise<CatalogAnswer & { start_here: StartHereJson | null }> {
  const path = input.path ?? "agents"
  if (path !== "agents" && path !== "people")
    throw new InvalidInputError("path", "The path is agents or people")
  const answer = await answerFor(tx, workspaceId)
  const [row] = await tx
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.workspaceId, workspaceId),
        eq(documents.kind, "start-here"),
        ne(sql`coalesce(${documents.data}, 'null'::jsonb)`, sql`'null'::jsonb`),
      ),
    )
    .orderBy(asc(documents.path))
    .limit(1)
  if (!row) return { ...answer, start_here: null }
  const steps = (row.data as Record<typeof path, StepJson[]>)[path]
  const named = await summaries(
    tx,
    workspaceId,
    steps.flatMap((s) => ("to" in s ? [s.to] : [])),
  )
  return {
    ...answer,
    start_here: {
      path,
      title: row.title,
      summary: row.summary,
      document: { path: row.path, blob: row.blob },
      steps: steps.map((s) =>
        "to" in s ? { ...s, entity: named.get(s.to) ?? null } : s,
      ),
    },
  }
}
