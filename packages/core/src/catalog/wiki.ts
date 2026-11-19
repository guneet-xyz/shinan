import { createHash } from "node:crypto"

import { and, asc, desc, eq, inArray, lt, schema, sql } from "@shinan/db"
import type { ActorKind, Confidence, Transaction } from "@shinan/db"

import { inWorkspace, snapshotRead } from "../authorize.js"
import type { Context } from "../context.js"
import { InvalidInputError, NotFoundError } from "../errors.js"
import {
  editableDocument,
  entityStatuses,
  parseCatalogDocument,
  utf8Length,
} from "./document/index.js"
import type { EditableDocument, EntityStatus } from "./document/index.js"
import { agentAnswerText, labelledStartHere } from "./index/agent.js"
import { summaryJson } from "./index/format.js"
import type { CatalogAnswer, EntitySummaryJson } from "./index/format.js"
import { answerFor, readCatalogStartHere } from "./index/queries.js"

/**
 * What the wiki reads besides the agent index's own queries (human
 * experience, the wiki): a page's history from the stored revisions, a
 * document's text at a revision for comparing, each type's entities with
 * their freshness summaries, and the per-person "opened" records behind
 * the start-here markers. Each read is one snapshot.
 */

const documents = schema.catalogIndexDocuments
const facts = schema.catalogIndexFacts
const revisions = schema.catalogRevisions
const revisionDocuments = schema.catalogRevisionDocuments
const visits = schema.catalogPageVisits

type DocumentRecord = typeof documents.$inferSelect

function idText(value: unknown, name = "id"): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > 200 ||
    // eslint-disable-next-line no-control-regex -- control characters are what it looks for
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new InvalidInputError(
      name,
      `The ${name} is a catalog ID such as machine/musashi`,
    )
  return value
}

/**
 * Any catalog document by its ID: an entity (also by an alias), a type
 * schema document (`schema/<type>`) or the start-here document.
 */
async function findDocument(
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
        sql`(${documents.catalogId} = ${id} or ${documents.aliases} @> array[${id}]::text[])`,
      ),
    )
    .orderBy(
      sql`${documents.catalogId} = ${id} desc`,
      asc(documents.documentId),
    )
    .limit(1)
  return row ?? null
}

async function requireDocument(
  tx: Transaction,
  workspaceId: string,
  id: unknown,
): Promise<DocumentRecord> {
  const row = await findDocument(tx, workspaceId, idText(id))
  if (!row) throw new NotFoundError()
  return row
}

/** One catalog revision of a document: when, and who it is credited to. */
export interface CatalogHistoryItemJson {
  revision: number
  /** When it was applied (ISO 8601). */
  at: string
  /** The author's written form (identity §8.7). */
  changed_by: string
  changed_by_kind: ActorKind
  confidence: Confidence
  /**
   * The number of the purge that stored this revision (catalog §9): the
   * latest text with purged text replaced by a marker. Null for a change.
   */
  purge: number | null
}

export interface CatalogHistoryAnswer extends CatalogAnswer {
  /** The document's current ID (an alias asked for leads here). */
  id: string
  kind: string
  /** Newest first. */
  items: CatalogHistoryItemJson[]
  /** Ask again with this `before` for older revisions, or null when there are none. */
  next_before: number | null
}

/**
 * The catalog revisions that changed a document, newest first (human
 * experience, an entity page: History). From the stored revisions, so it
 * holds every change, including those to a former ID.
 */
export async function listCatalogHistory(
  ctx: Context,
  workspaceId: string,
  input: { id: string; before?: number; limit?: number },
): Promise<CatalogHistoryAnswer> {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.read",
    async (scope) => {
      const limit = input.limit ?? 50
      if (!Number.isInteger(limit) || limit < 1 || limit > 200)
        throw new InvalidInputError(
          "limit",
          "The limit is a whole number from 1 to 200",
        )
      if (
        input.before !== undefined &&
        (!Number.isInteger(input.before) || input.before < 1)
      )
        throw new InvalidInputError(
          "before",
          "A catalog revision is a whole number from 1",
        )
      const answer = await answerFor(scope.tx, scope.workspaceId)
      const row = await requireDocument(scope.tx, scope.workspaceId, input.id)
      const rows = await scope.tx
        .select({
          revision: revisions.number,
          at: revisions.createdAt,
          changedBy: revisions.actorLabel,
          kind: revisions.actorKind,
          confidence: revisions.confidence,
          purge: schema.catalogPurges.number,
        })
        .from(revisionDocuments)
        .innerJoin(
          revisions,
          and(
            eq(revisions.workspaceId, revisionDocuments.workspaceId),
            eq(revisions.number, revisionDocuments.revision),
          ),
        )
        .leftJoin(
          schema.catalogPurges,
          and(
            eq(schema.catalogPurges.workspaceId, revisions.workspaceId),
            eq(schema.catalogPurges.id, revisions.purgeId),
          ),
        )
        .where(
          and(
            eq(revisionDocuments.workspaceId, scope.workspaceId),
            eq(revisionDocuments.documentId, row.documentId),
            input.before === undefined
              ? undefined
              : lt(revisionDocuments.revision, input.before),
          ),
        )
        .orderBy(desc(revisionDocuments.revision))
        .limit(limit + 1)
      const shown = rows.slice(0, limit)
      return {
        ...answer,
        id: row.catalogId ?? "",
        kind: row.kind,
        items: shown.map((r) => ({
          revision: r.revision,
          at: r.at.toISOString(),
          changed_by: r.changedBy,
          changed_by_kind: r.kind,
          confidence: r.confidence,
          purge: r.purge,
        })),
        next_before:
          rows.length > limit ? shown[shown.length - 1]!.revision : null,
      }
    },
    snapshotRead,
  )
}

export interface CatalogDocumentTextAnswer extends CatalogAnswer {
  id: string
  kind: string
  /** The revision that wrote this text: the last one at or before the revision asked for. */
  revision: number
  at: string
  changed_by: string
  changed_by_kind: ActorKind
  /** The document's full Markdown text, exactly as stored. */
  text: string
}

/**
 * A document's full text as it stood at a catalog revision (the latest
 * when none is given), for reading and comparing earlier revisions (human
 * experience, an entity page: History).
 */
export async function getCatalogDocumentText(
  ctx: Context,
  workspaceId: string,
  input: { id: string; revision?: number },
): Promise<CatalogDocumentTextAnswer> {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.read",
    async (scope) => {
      if (
        input.revision !== undefined &&
        (!Number.isInteger(input.revision) || input.revision < 1)
      )
        throw new InvalidInputError(
          "revision",
          "A catalog revision is a whole number from 1",
        )
      const answer = await answerFor(scope.tx, scope.workspaceId)
      const row = await requireDocument(scope.tx, scope.workspaceId, input.id)
      const [found] = await scope.tx
        .select({
          revision: revisionDocuments.revision,
          text: revisionDocuments.text,
          at: revisions.createdAt,
          changedBy: revisions.actorLabel,
          kind: revisions.actorKind,
        })
        .from(revisionDocuments)
        .innerJoin(
          revisions,
          and(
            eq(revisions.workspaceId, revisionDocuments.workspaceId),
            eq(revisions.number, revisionDocuments.revision),
          ),
        )
        .where(
          and(
            eq(revisionDocuments.workspaceId, scope.workspaceId),
            eq(revisionDocuments.documentId, row.documentId),
            input.revision === undefined
              ? undefined
              : sql`${revisionDocuments.revision} <= ${input.revision}`,
          ),
        )
        .orderBy(desc(revisionDocuments.revision))
        .limit(1)
      if (!found) throw new NotFoundError()
      return {
        ...answer,
        id: row.catalogId ?? "",
        kind: row.kind,
        revision: found.revision,
        at: found.at.toISOString(),
        changed_by: found.changedBy,
        changed_by_kind: found.kind,
        text: found.text,
      }
    },
    snapshotRead,
  )
}

/**
 * An entity's freshness summary (human experience, an entity page: one
 * line), computed when read: how many facts, the oldest last checked, how
 * many due for recheck, how many never checked, and how many `unknown`.
 */
export interface FreshnessSummaryJson {
  facts: number
  /** The oldest fact check's time (ISO 8601), or null if no fact was checked. */
  oldest_checked_at: string | null
  due: number
  /** Facts other than `planned` with no fact check, or `checked: null`. */
  not_checked: number
  unknown: number
}

export interface TypeIndexItemJson {
  entity: EntitySummaryJson
  freshness: FreshnessSummaryJson
}

export interface TypeIndexAnswer extends CatalogAnswer {
  items: TypeIndexItemJson[]
  /** More entities than shown: the index lists at most 1,000. */
  truncated: boolean
}

/** The most entities a type index lists at once. */
export const typeIndexLimit = 1000

/**
 * The entities of one type, each with its freshness summary, for the wiki's
 * index per entity type (human experience, moving around the wiki).
 * Retired entities are left out unless asked for.
 */
export async function listCatalogTypeIndex(
  ctx: Context,
  workspaceId: string,
  input: { type: string; status?: EntityStatus; includeRetired?: boolean },
): Promise<TypeIndexAnswer> {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.read",
    async (scope) => {
      const type = idText(input.type, "type")
      if (input.status !== undefined && !entityStatuses.includes(input.status))
        throw new InvalidInputError(
          "status",
          `The status is one of ${entityStatuses.join(", ")}`,
        )
      const answer = await answerFor(scope.tx, scope.workspaceId)
      const now = new Date()
      const counted = (condition: ReturnType<typeof sql>) =>
        sql<number>`count(${facts.position}) filter (where ${condition})::int`
      const rows = await scope.tx
        .select({
          document: documents,
          facts: sql<number>`count(${facts.position})::int`,
          oldest: sql<Date | null>`min(${facts.checkedAt})`,
          due: counted(sql`${facts.dueAt} <= ${now}`),
          notChecked: counted(
            sql`${facts.state} <> 'planned' and ${facts.checkedAt} is null`,
          ),
          unknown: counted(sql`${facts.state} = 'unknown'`),
        })
        .from(documents)
        .leftJoin(facts, eq(facts.documentId, documents.documentId))
        .where(
          and(
            eq(documents.workspaceId, scope.workspaceId),
            eq(documents.kind, "entity"),
            sql`${documents.catalogId} is not null`,
            eq(documents.type, type),
            input.status !== undefined
              ? eq(documents.status, input.status)
              : input.includeRetired
                ? undefined
                : sql`${documents.status} is distinct from 'retired'`,
          ),
        )
        .groupBy(documents.documentId)
        .orderBy(asc(documents.catalogId), asc(documents.documentId))
        .limit(typeIndexLimit + 1)
      return {
        ...answer,
        items: rows.slice(0, typeIndexLimit).map((r) => ({
          entity: summaryJson(r.document),
          freshness: {
            facts: r.facts,
            oldest_checked_at:
              r.oldest === null ? null : new Date(r.oldest).toISOString(),
            due: r.due,
            not_checked: r.notChecked,
            unknown: r.unknown,
          },
        })),
        truncated: rows.length > typeIndexLimit,
      }
    },
    snapshotRead,
  )
}

/**
 * Records that the person opened a catalog page, at the revision it stands
 * at (human experience, start here for people). Opening it again
 * overwrites the record.
 */
export async function recordCatalogPageOpened(
  ctx: Context,
  workspaceId: string,
  input: { id: string },
): Promise<void> {
  await inWorkspace(ctx, workspaceId, "catalog.mark-opened", async (scope) => {
    const row = await requireDocument(scope.tx, scope.workspaceId, input.id)
    const personId = scope.actor.personId!
    await scope.tx
      .insert(visits)
      .values({
        workspaceId: scope.workspaceId,
        personId,
        documentId: row.documentId,
        revision: row.revision,
      })
      .onConflictDoUpdate({
        target: [visits.workspaceId, visits.personId, visits.documentId],
        set: { revision: row.revision, openedAt: sql`now()` },
      })
  })
}

export interface CatalogPageOpenedJson {
  /** The ID as asked for. */
  id: string
  /** The catalog revision that last changed the page. */
  revision: number
  /** The revision the page stood at when the person last opened it; null if they never did. */
  opened_revision: number | null
  opened_at: string | null
}

/**
 * Whether the person has opened each page, and whether it changed since:
 * the start-here markers. IDs that name no document are left out.
 */
export async function listCatalogPagesOpened(
  ctx: Context,
  workspaceId: string,
  input: { ids: readonly string[] },
): Promise<{ items: CatalogPageOpenedJson[] }> {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.mark-opened",
    async (scope) => {
      if (!Array.isArray(input.ids) || input.ids.length > 200)
        throw new InvalidInputError("ids", "Ask for at most 200 pages at once")
      const ids = [...new Set(input.ids.map((id) => idText(id)))]
      if (ids.length === 0) return { items: [] }
      const rows = await scope.tx
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.workspaceId, scope.workspaceId),
            sql`(${inArray(documents.catalogId, ids)} or ${documents.aliases} && ${sql`array[${sql.join(
              ids.map((id) => sql`${id}`),
              sql`, `,
            )}]::text[]`})`,
          ),
        )
        .orderBy(asc(documents.documentId))
      const byId = new Map<string, DocumentRecord>()
      for (const row of rows)
        if (row.catalogId && !byId.has(row.catalogId))
          byId.set(row.catalogId, row)
      for (const row of rows)
        for (const alias of row.aliases)
          if (!byId.has(alias)) byId.set(alias, row)
      const found = ids.flatMap((id) => {
        const row = byId.get(id)
        return row ? [{ id, row }] : []
      })
      const opened =
        found.length === 0
          ? []
          : await scope.tx
              .select()
              .from(visits)
              .where(
                and(
                  eq(visits.workspaceId, scope.workspaceId),
                  eq(visits.personId, scope.actor.personId!),
                  inArray(
                    visits.documentId,
                    found.map((f) => f.row.documentId),
                  ),
                ),
              )
      return {
        items: found.map(({ id, row }) => {
          const visit = opened.find((v) => v.documentId === row.documentId)
          return {
            id,
            revision: row.revision,
            opened_revision: visit?.revision ?? null,
            opened_at: visit ? visit.openedAt.toISOString() : null,
          }
        }),
      }
    },
    snapshotRead,
  )
}

export interface AgentStartHerePreviewAnswer extends CatalogAnswer {
  /** The agents' path exactly as `workspace_context` gives it, trust labels included; null before the document exists. */
  start_here: Record<string, unknown> | null
  /** That path as agents receive it: compact JSON. */
  text: string | null
  /** The text's size in bytes of UTF-8. */
  bytes: number
}

/**
 * "Preview as agent" (human experience, start here for agents): the
 * agents' path written out by the same code as MCP's `workspace_context`,
 * so what a person sees, and its size, is what an agent is given.
 */
export async function getAgentStartHerePreview(
  ctx: Context,
  workspaceId: string,
): Promise<AgentStartHerePreviewAnswer> {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.read",
    async (scope) => {
      const answer = await readCatalogStartHere(scope.tx, scope.workspaceId, {
        path: "agents",
      })
      const startHere = await labelledStartHere(
        scope.tx,
        scope.workspaceId,
        answer.start_here,
      )
      const text = startHere ? agentAnswerText(startHere) : null
      return {
        catalog_revision: answer.catalog_revision,
        index_behind: answer.index_behind,
        start_here: startHere,
        text,
        bytes: text === null ? 0 : utf8Length(text),
      }
    },
    snapshotRead,
  )
}

export interface CatalogEditableAnswer extends CatalogAnswer {
  /** The document's current ID (an alias asked for leads here). */
  id: string
  /** The revision that last changed it: the text the expectations come from. */
  revision: number
  document: EditableDocument
}

/**
 * A document as the wiki's editors write operations against it (human
 * experience, changing the catalog from the wiki): its fields, body, type
 * schema keys or start-here paths as written in its latest stored text,
 * so each operation expects exactly what is there (catalog §8.5).
 *
 * Reading a document takes up to a few hundred milliseconds of the main
 * thread for one full of facts, so the result is kept (`editableOf`): a
 * page is read once per revision, however often its editor opens.
 */
export async function getCatalogEditable(
  ctx: Context,
  workspaceId: string,
  input: { id: string },
): Promise<CatalogEditableAnswer> {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.read",
    async (scope) => {
      const answer = await answerFor(scope.tx, scope.workspaceId)
      const row = await requireDocument(scope.tx, scope.workspaceId, input.id)
      const [found] = await scope.tx
        .select({
          revision: revisionDocuments.revision,
          text: revisionDocuments.text,
        })
        .from(revisionDocuments)
        .where(
          and(
            eq(revisionDocuments.workspaceId, scope.workspaceId),
            eq(revisionDocuments.documentId, row.documentId),
          ),
        )
        .orderBy(desc(revisionDocuments.revision))
        .limit(1)
      if (!found) throw new NotFoundError()
      return {
        ...answer,
        id: row.catalogId ?? "",
        revision: found.revision,
        document: editableOf(found.text),
      }
    },
    snapshotRead,
  )
}

/**
 * Editable forms already read, by a hash of the exact stored text: a
 * revision's text never changes, and purge (M2-10) changes the text, so
 * the key changes with it. The result depends on the text alone. At most
 * `editableCacheBytes` of text, the least recently used dropped first.
 */
const editableCache = new Map<
  string,
  { bytes: number; editable: EditableDocument }
>()
let editableCachedBytes = 0
const editableCacheBytes = 16 * 1024 * 1024

export function editableOf(text: string): EditableDocument {
  const key = createHash("sha256").update(text).digest("base64url")
  const cached = editableCache.get(key)
  if (cached) {
    editableCache.delete(key)
    editableCache.set(key, cached)
    return cached.editable
  }
  const editable = editableDocument(parseCatalogDocument(text))
  const bytes = utf8Length(text)
  editableCache.set(key, { bytes, editable })
  editableCachedBytes += bytes
  for (const [oldest, entry] of editableCache) {
    if (editableCachedBytes <= editableCacheBytes) break
    editableCache.delete(oldest)
    editableCachedBytes -= entry.bytes
  }
  return editable
}
