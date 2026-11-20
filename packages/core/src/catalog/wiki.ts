import { and, asc, eq, schema, sql } from "@shinan/db"

import { inWorkspace, snapshotRead } from "../authorize.js"
import type { Context } from "../context.js"
import { InvalidInputError } from "../errors.js"
import { entityStatuses } from "./document/index.js"
import type { EntityStatus } from "./document/index.js"
import { summaryJson } from "./index/format.js"
import type { CatalogAnswer, EntitySummaryJson } from "./index/format.js"
import { answerFor } from "./index/queries.js"

/**
 * What the catalog pages read besides the agent index's own queries: each
 * type's entities with their freshness summaries. Each read is one
 * snapshot. A page's history comes from `main`'s commits and the push log
 * (Git-based catalog plan §3, GC-7), not from the index.
 */

const documents = schema.catalogIndexDocuments
const facts = schema.catalogIndexFacts

function idText(value: unknown, name: string): string {
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
        .leftJoin(
          facts,
          and(
            eq(facts.workspaceId, documents.workspaceId),
            eq(facts.path, documents.path),
          ),
        )
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
        .groupBy(documents.workspaceId, documents.path)
        .orderBy(asc(documents.catalogId), asc(documents.path))
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

/** One file of `main` in the catalog's tree. */
export interface CatalogTreeItemJson {
  /** Its path on `main`, such as `machine/musashi.md`. */
  path: string
  /** Its catalog ID; null when the file could not be read. */
  id: string | null
  title: string | null
  /** `entity` or `schema`; the start-here document is not in the tree. */
  kind: string
  status: string | null
}

export interface CatalogTreeAnswer extends CatalogAnswer {
  /** Every page but the start-here document, by path. */
  items: CatalogTreeItemJson[]
  /**
   * How many things need attention: facts that disagree (differences not
   * accepted), facts due for a recheck, facts recorded as unknown, and
   * files that could not be read. Retired pages are left out.
   */
  attention: number
}

/**
 * The catalog's tree for the app's sidebar (Git-based catalog plan §3):
 * every page of `main` but the start-here document, by path, with its
 * title, and how many things need attention.
 */
export async function listCatalogTree(
  ctx: Context,
  workspaceId: string,
): Promise<CatalogTreeAnswer> {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.read",
    async (scope) => {
      const tx = scope.tx
      const answer = await answerFor(tx, scope.workspaceId)
      const rows = await tx
        .select({
          path: documents.path,
          id: documents.catalogId,
          title: documents.title,
          kind: documents.kind,
          status: documents.status,
        })
        .from(documents)
        .where(
          and(
            eq(documents.workspaceId, scope.workspaceId),
            sql`${documents.kind} <> 'start-here'`,
          ),
        )
        .orderBy(asc(documents.path))
      const current = sql`${documents.status} is distinct from 'retired'`
      const [counts] = await tx
        .execute<{ attention: number }>(
          sql`
        select
          (select count(*) from ${schema.catalogIndexDiscrepancies} x
             join ${documents} on ${documents.workspaceId} = x.workspace_id and ${documents.path} = x.path
             where x.workspace_id = ${scope.workspaceId} and not x.accepted and ${current})
        + (select count(*) from ${facts}
             join ${documents} on ${documents.workspaceId} = ${facts.workspaceId} and ${documents.path} = ${facts.path}
             where ${facts.workspaceId} = ${scope.workspaceId} and ${current}
               and (${facts.state} = 'unknown' or ${facts.dueAt} <= now()))
        + (select count(*) from ${documents}
             where ${documents.workspaceId} = ${scope.workspaceId}
               and ${documents.problems} @> '[{"code":"unreadable-path"}]'::jsonb)
        as attention`,
        )
        .then((r) => r.rows as { attention: number }[])
      return {
        ...answer,
        items: rows,
        attention: Number(counts?.attention ?? 0),
      }
    },
    snapshotRead,
  )
}
