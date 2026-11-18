import { and, eq, inArray, schema, sql } from "@shinan/db"
import type { Transaction } from "@shinan/db"

import type { AgentActor } from "../../actor.js"
import { inWorkspace, snapshotRead } from "../../authorize.js"
import type { Context } from "../../context.js"
import { InvalidInputError, NotFoundError } from "../../errors.js"
import { getConnectedAgent } from "../../identity/agents.js"
import type { ConnectedAgent } from "../../identity/agents.js"
import { decide, rules } from "../../permissions.js"
import { recordSecurityEntry } from "../../security-log.js"
import { builtInSchemas, entityStatuses } from "../document/index.js"
import type { EntityStatus } from "../document/index.js"
import type {
  CatalogAnswer,
  EntityJson,
  EntitySummaryJson,
  FactJson,
  SectionJson,
  TypeSchemaJson,
} from "./format.js"
import {
  documentLabels,
  inheritLabels,
  labelForActor,
  labelForWrittenActor,
  lessTrusted,
  shinanLabel,
} from "./labels.js"
import type { TrustLabel } from "./labels.js"
import {
  catalogLists,
  readCatalogChanges,
  readCatalogEntities,
  readCatalogEntity,
  readCatalogList,
  readCatalogNeighbours,
  readCatalogSearch,
  readCatalogStartHere,
  readCatalogTypeSchema,
  readCatalogTypeSchemas,
} from "./queries.js"

/**
 * The agent index as agents read it (agent integrations, tool set: Context
 * and Catalog): the M2-3 answers, each in the agent's own workspace, read
 * from one snapshot, with a trust label on every object that holds text.
 * The MCP tools (M2-6) only translate to these.
 *
 * A `label` on an object covers that object's own text fields; objects
 * inside it carry their own. Labels come from Shinan's records:
 *
 * - a fact: its fact check's `by`, which Shinan writes from the actor of
 *   the request that applied it; facts with no fact check, like entity
 *   fields, take the document's label;
 * - a body section: its `written_by`, the least-trusted author whose words
 *   may remain in it (catalog §12.4; owner, M2-Q6);
 * - an entity's own fields, start-here steps and a custom type schema: the
 *   least-trusted author of any revision of the document;
 * - a discrepancy: the least trusted of its facts;
 * - what Shinan computes (freshness, revision numbers, the change list):
 *   `shinan`.
 */

/** The agent's own workspace: tools never take one. */
function agentOf(ctx: Context): AgentActor {
  if (ctx.actor.kind !== "agent") throw new NotFoundError()
  return ctx.actor
}

/** Whether the agent's token and member allow reading the catalog. */
function mayReadCatalog(agent: AgentActor, role: ConnectedAgent["role"]) {
  return decide(rules["catalog.read"], {
    kind: "agent",
    role,
    scopes: agent.scopes,
  }).allowed
}

export interface AgentWorkspaceContext {
  agent: ConnectedAgent["agent"] & { label: TrustLabel }
  person: ConnectedAgent["person"] & { label: TrustLabel }
  workspace: ConnectedAgent["workspace"] & { label: TrustLabel }
  role: ConnectedAgent["role"]
  access: ConnectedAgent["access"]
  scopes: ConnectedAgent["scopes"]
  /** The catalog revision the index stands at, and whether it is behind; null without `catalog:read`. */
  catalog: (CatalogAnswer & { label: TrustLabel }) | null
  /** The agents' start-here path (catalog §11); null without `catalog:read` or before the document exists. */
  start_here: Record<string, unknown> | null
  label: TrustLabel
}

/**
 * The `workspace_context` tool: the agent, its member, the workspace, what
 * the token allows, and, with `catalog:read`, the catalog revision and the
 * agents' start-here path.
 */
export async function agentWorkspaceContext(
  ctx: Context,
): Promise<AgentWorkspaceContext> {
  const agent = agentOf(ctx)
  const connected = await getConnectedAgent(ctx)
  const member: TrustLabel = {
    author_kind: "member",
    author: connected.person.handle,
    instruction: "no",
  }
  const context: AgentWorkspaceContext = {
    agent: { ...connected.agent, label: member },
    person: { ...connected.person, label: member },
    // Named by one of the workspace owners, who are people.
    workspace: {
      ...connected.workspace,
      label: { author_kind: "member", author: null, instruction: "no" },
    },
    role: connected.role,
    access: connected.access,
    scopes: connected.scopes,
    catalog: null,
    start_here: null,
    label: shinanLabel,
  }
  if (!mayReadCatalog(agent, connected.role)) return context
  return inWorkspace(
    ctx,
    agent.workspaceId,
    "catalog.read",
    async (scope) => {
      const answer = await readCatalogStartHere(scope.tx, scope.workspaceId, {
        path: "agents",
      })
      context.catalog = {
        catalog_revision: answer.catalog_revision,
        index_behind: answer.index_behind,
        label: shinanLabel,
      }
      if (answer.start_here) {
        const labels = await documentLabels(scope.tx, scope.workspaceId, [
          "start-here",
          ...summaryIds(answer.start_here),
        ])
        const label = labels.get("start-here") ?? shinanLabel
        context.start_here = labelSummaries(
          { ...answer.start_here, label },
          labels,
        ) as Record<string, unknown>
        inheritLabels(context.start_here, label)
      }
      return context
    },
    snapshotRead,
  )
}

export interface AgentSearchInput {
  /** Words, as in a web search; leave out to list by type and status. */
  text?: string
  type?: string
  status?: EntityStatus
  includeRetired?: boolean
  /** An entity ID or alias: its neighbours through relations, both ways. */
  relatedTo?: string
  offset?: number
  limit?: number
}

/**
 * The `search_catalog` tool: full-text search, a list by type and status,
 * or an entity's neighbours, each result with its facts' freshness.
 */
export async function agentSearchCatalog(
  ctx: Context,
  input: AgentSearchInput,
): Promise<Record<string, unknown>> {
  const agent = agentOf(ctx)
  return inWorkspace(
    ctx,
    agent.workspaceId,
    "catalog.read",
    async ({ tx, workspaceId }) => {
      let answer: Record<string, unknown>
      if (input.relatedTo !== undefined) {
        if (input.text !== undefined)
          throw new InvalidInputError(
            "relatedTo",
            "Search by text or by relation, not both",
          )
        answer = {
          ...(await readCatalogNeighbours(tx, workspaceId, {
            id: input.relatedTo,
          })),
        }
      } else if (input.text !== undefined) {
        if (input.offset !== undefined)
          throw new InvalidInputError(
            "offset",
            "A text search returns its best results in one page",
          )
        answer = {
          ...(await readCatalogSearch(tx, workspaceId, {
            text: input.text,
            ...optional(input),
          })),
        }
      } else {
        answer = {
          ...(await readCatalogEntities(tx, workspaceId, {
            ...optional(input),
            ...(input.offset === undefined ? {} : { offset: input.offset }),
          })),
        }
      }
      await addFreshness(tx, workspaceId, answer)
      return labelAnswer(tx, workspaceId, answer)
    },
    snapshotRead,
  )
}

function optional(input: AgentSearchInput) {
  if (input.status !== undefined && !entityStatuses.includes(input.status))
    throw new InvalidInputError(
      "status",
      `The status is one of ${entityStatuses.join(", ")}`,
    )
  return {
    ...(input.type === undefined ? {} : { type: input.type }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.includeRetired === undefined
      ? {}
      : { includeRetired: input.includeRetired }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  }
}

/**
 * Adds to each listed entity how fresh its facts are, computed now
 * (catalog §4.6): how many there are, how many are due for recheck and how
 * many were never checked.
 */
async function addFreshness(
  tx: Transaction,
  workspaceId: string,
  answer: Record<string, unknown>,
): Promise<void> {
  const items = (answer.items ?? []) as Record<string, unknown>[]
  const summaries = items.map(
    (item) => (item.entity ?? item) as EntitySummaryJson,
  )
  const ids = summaries.map((s) => s.id)
  if (ids.length === 0) return
  const f = schema.catalogIndexFacts
  const rows = await tx
    .select({
      entityId: f.entityId,
      facts: sql<number>`count(*)::int`,
      due: sql<number>`(count(*) filter (where ${f.dueAt} <= now()))::int`,
      notChecked: sql<number>`(count(*) filter (where ${f.state} <> 'planned' and ${f.checkedAt} is null))::int`,
    })
    .from(f)
    .where(and(eq(f.workspaceId, workspaceId), inArray(f.entityId, ids)))
    .groupBy(f.entityId)
  const counts = new Map(rows.map((r) => [r.entityId, r]))
  items.forEach((item, i) => {
    const c = counts.get(ids[i]!)
    item.freshness = {
      facts: c?.facts ?? 0,
      due_for_recheck: c?.due ?? 0,
      not_checked: c?.notChecked ?? 0,
    }
  })
}

export interface AgentGetEntityInput {
  /** An entity ID or alias. */
  id: string
  /** Also return the entity's type schema. */
  includeSchema?: boolean
}

/** The `get_entity` tool: one entity in the index format, optionally with its type schema. */
export async function agentGetEntity(
  ctx: Context,
  input: AgentGetEntityInput,
): Promise<Record<string, unknown>> {
  const agent = agentOf(ctx)
  return inWorkspace(
    ctx,
    agent.workspaceId,
    "catalog.read",
    async ({ tx, workspaceId }) => {
      const answer: Record<string, unknown> = {
        ...(await readCatalogEntity(tx, workspaceId, { id: input.id })),
      }
      const type = (answer.entity as EntityJson).type
      if (input.includeSchema && type !== null) {
        const known =
          builtInSchemas.has(type) ||
          (await readCatalogTypeSchemas(tx, workspaceId)).items.some(
            (s) => s.type === type,
          )
        answer.schema = known
          ? (await readCatalogTypeSchema(tx, workspaceId, { type })).schema
          : null
      }
      return labelAnswer(tx, workspaceId, answer)
    },
    snapshotRead,
  )
}

/** The lists the `catalog_lists` tool offers: the workspace lists, the type schemas and the changes since a revision. */
export const agentCatalogLists = [
  ...catalogLists,
  "type-schemas",
  "changes",
] as const
export type AgentCatalogList = (typeof agentCatalogLists)[number]

export interface AgentCatalogListInput {
  list: AgentCatalogList
  includeRetired?: boolean
  offset?: number
  limit?: number
  /** For `changes`: the catalog revision to list changes after. */
  since?: number
}

/**
 * The `catalog_lists` tool: a workspace-wide list. Each call is a bulk read
 * of the agent index, recorded in the security log (identity §11; security
 * checklist 10.5), with the list, the page and how many items it returned.
 */
export async function agentCatalogList(
  ctx: Context,
  input: AgentCatalogListInput,
): Promise<Record<string, unknown>> {
  const agent = agentOf(ctx)
  if (!agentCatalogLists.includes(input.list))
    throw new InvalidInputError(
      "list",
      `The list is one of ${agentCatalogLists.join(", ")}`,
    )
  const { answer, actor } = await inWorkspace(
    ctx,
    agent.workspaceId,
    "catalog.read",
    async (scope) => {
      const { tx, workspaceId } = scope
      let read: Record<string, unknown>
      if (input.list === "type-schemas") {
        read = { ...(await readCatalogTypeSchemas(tx, workspaceId)) }
      } else if (input.list === "changes") {
        if (input.since === undefined)
          throw new InvalidInputError(
            "since",
            "The changes list needs `since`, a catalog revision (0 for all)",
          )
        read = {
          ...(await readCatalogChanges(tx, workspaceId, {
            since: input.since,
            ...(input.limit === undefined ? {} : { limit: input.limit }),
          })),
        }
      } else {
        read = {
          ...(await readCatalogList(tx, workspaceId, {
            list: input.list,
            ...(input.includeRetired === undefined
              ? {}
              : { includeRetired: input.includeRetired }),
            ...(input.offset === undefined ? {} : { offset: input.offset }),
            ...(input.limit === undefined ? {} : { limit: input.limit }),
          })),
        }
      }
      return {
        answer: await labelAnswer(tx, workspaceId, read),
        actor: scope.actor,
      }
    },
    snapshotRead,
  )
  await recordSecurityEntry(ctx.db, {
    workspaceId: agent.workspaceId,
    action: "catalog.bulk-read",
    outcome: "succeeded",
    actor,
    request: ctx.request ?? {},
    details: {
      list: input.list,
      offset: input.offset ?? 0,
      items: Array.isArray(answer.items) ? answer.items.length : 0,
      catalogRevision: answer.catalog_revision,
    },
  })
  return answer
}

/**
 * Labels an answer of the agent index. Precise labels first (facts,
 * sections, entities, discrepancies, type schemas), then every other object
 * that holds text takes the label of the object it is in.
 */
async function labelAnswer(
  tx: Transaction,
  workspaceId: string,
  answer: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const ids = summaryIds(answer)
  for (const schemaDocument of schemaDocumentIds(answer))
    ids.push(schemaDocument)
  const labels = await documentLabels(tx, workspaceId, ids)
  labelSummaries(answer, labels)
  inheritLabels(answer, shinanLabel)
  return answer
}

/** The IDs of every entity summary in a value. */
function summaryIds(value: unknown): string[] {
  const ids: string[] = []
  walk(value, (object) => {
    if (isSummary(object)) ids.push(object.id)
  })
  return ids
}

function schemaDocumentIds(value: unknown): string[] {
  const ids: string[] = []
  walk(value, (object) => {
    if (isTypeSchema(object) && object.document !== null)
      ids.push(object.document)
  })
  return ids
}

function walk(
  value: unknown,
  visit: (object: Record<string, unknown>) => void,
) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit)
  } else if (value !== null && typeof value === "object") {
    visit(value as Record<string, unknown>)
    for (const [key, child] of Object.entries(value))
      if (key !== "label") walk(child, visit)
  }
}

function isSummary(
  object: Record<string, unknown>,
): object is Record<string, unknown> & EntitySummaryJson {
  return (
    typeof object.id === "string" &&
    "title" in object &&
    "summary" in object &&
    "status" in object &&
    "owner" in object
  )
}

function isTypeSchema(
  object: Record<string, unknown>,
): object is Record<string, unknown> & TypeSchemaJson {
  return (
    typeof object.type === "string" &&
    "built_in" in object &&
    "keys" in object &&
    "document" in object
  )
}

function isFact(
  object: Record<string, unknown>,
): object is Record<string, unknown> & FactJson {
  return (
    typeof object.identity === "string" &&
    typeof object.key === "string" &&
    "check" in object &&
    "freshness" in object
  )
}

function isSection(
  object: Record<string, unknown>,
): object is Record<string, unknown> & SectionJson {
  return (
    typeof object.text === "string" &&
    typeof object.written_by === "string" &&
    "written_by_kind" in object
  )
}

/**
 * Sets the precise labels, carrying the nearest enclosing label down to
 * what has none of its own: entity summaries (and whole entities) from
 * their documents' revisions, facts from their fact checks, sections from
 * `written_by`, type schemas from their documents. An item wrapping one
 * entity (a search result, an incoming relation, a policy that applies)
 * takes that entity's label; one wrapping facts (a list item, a
 * discrepancy) the least trusted of them; a relation written on an entity
 * the label of its fact, or of the entity that wrote it.
 */
function labelSummaries(
  value: unknown,
  labels: ReadonlyMap<string, TrustLabel>,
  inherited: TrustLabel = shinanLabel,
): unknown {
  if (Array.isArray(value)) {
    for (const item of value) labelSummaries(item, labels, inherited)
    return value
  }
  if (value === null || typeof value !== "object") return value
  const object = value as Record<string, unknown>
  const of = (id: string) => labels.get(id) ?? shinanLabel
  if (!("label" in object)) {
    const wrapped = (object.entity ?? object.from) as
      Record<string, unknown> | undefined
    if (isSection(object))
      object.label = labelForActor(object.written_by_kind, object.written_by)
    else if (isSummary(object)) object.label = of(object.id)
    else if (isTypeSchema(object))
      object.label =
        object.document === null ? shinanLabel : of(object.document)
    else if (isFact(object))
      object.label = object.check
        ? labelForWrittenActor((object.check as { by: string | null }).by)
        : inherited
    // A relation or a start-here step names its target with `to`: its
    // text is the writer's, not the target's.
    else if ("to" in object) object.label = inherited
    else if (wrapped && isSummary(wrapped)) object.label = of(wrapped.id)
  }
  const own = (object.label as TrustLabel | undefined) ?? inherited
  for (const [key, child] of Object.entries(object))
    if (key !== "label") labelSummaries(child, labels, own)

  // What depends on labels set below.
  if (Array.isArray(object.fact_details))
    object.label = (object.fact_details as { label: TrustLabel }[])
      .map((f) => f.label)
      .reduce(lessTrusted, own)
  else if (object.fact && typeof object.fact === "object" && "entity" in object)
    object.label = lessTrusted(
      (object.fact as { label: TrustLabel }).label,
      own,
    )
  if (isSummary(object) && Array.isArray(object.facts)) {
    const facts = new Map(
      (object.facts as (FactJson & { label: TrustLabel })[]).map((f) => [
        f.identity,
        f.label,
      ]),
    )
    for (const d of (object.discrepancies ?? []) as Record<string, unknown>[])
      d.label = (d.facts as string[])
        .map((identity) => facts.get(identity) ?? own)
        .reduce(lessTrusted, own)
    const relations = object.relations as
      { outgoing: Record<string, unknown>[] } | undefined
    for (const r of relations?.outgoing ?? [])
      r.label = facts.get(r.identity as string) ?? own
  }
  // Neighbours: the relations an entity wrote take its label.
  if (
    Array.isArray(object.outgoing) &&
    object.entity &&
    typeof object.entity === "object"
  )
    for (const r of object.outgoing as Record<string, unknown>[])
      r.label = (object.entity as { label: TrustLabel }).label
  return value
}
