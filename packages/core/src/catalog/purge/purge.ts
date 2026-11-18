import {
  and,
  createLimitedLog,
  databaseErrorCode,
  desc,
  eq,
  inArray,
  schema,
  sql,
} from "@shinan/db"
import type { CatalogPurgeCounts, Transaction } from "@shinan/db"

import { shinan } from "../../actor.js"
import { atInstallation, inWorkspace, snapshotRead } from "../../authorize.js"
import type { Context } from "../../context.js"
import { InvalidInputError, RuleViolationError } from "../../errors.js"
import { appendEvent } from "../../events.js"
import { recordSecurityEntry } from "../../security-log.js"
import type { CatalogOperation } from "../document/index.js"
import { excerpt } from "../document/secrets.js"
import {
  clearTypeSchemaCache,
  lockIndexState,
  reindexDocuments,
} from "../index/indexer.js"
import { latestTexts } from "../index/store.js"
import { catalogWorkers } from "../proposals/pool.js"
import { hashOf } from "../proposals/proposals.js"
import { appendCatalogRevision } from "../revisions.js"

/**
 * Catalog purge (catalog §9; architecture §4.4): a workspace owner removes
 * a text that must not survive, such as a leaked secret or personal data,
 * from everything the workspace's catalog stores. Every occurrence is
 * replaced by a marker, and every record keeps its shape: its time, kind,
 * actor and subjects.
 */

/** What replaces purged text. Plain words in brackets, so YAML still reads it as text. */
export const purgeMarker = "(purged)"

/**
 * **Proposed (M2-10):** the text to purge is 4 to 10,000 characters, so it
 * cannot match ordinary words by accident and a long passage is purged in
 * parts; the reason is at most 2,000 characters.
 */
export const purgeLimits = {
  textMin: 4,
  textMax: 10_000,
  reason: 2000,
} as const

/**
 * Where the catalog stores text, by table and column: what a purge
 * rewrites and what it checks afterwards (catalog §9). A new table or
 * column holding catalog text, such as comments on proposals (M2-4b),
 * belongs here, and in the full-database test in `purge.test.ts`.
 *
 * - `catalog_revision_documents.text`: every revision's text, rewritten
 *   in place.
 * - `catalog_proposals`: the request (explanation, related task,
 *   operations, idempotency key) and what Shinan stored about it
 *   (validation's findings, approval reasons, touched catalog IDs, the
 *   rejection reason). The request hash is computed again.
 * - `events`: the summary and data.
 * - The agent index: rebuilt from the purged text, then checked, except
 *   the columns naming who wrote what (an actor's written form is not
 *   catalog content) and those derived from other columns.
 */
export const purgeTargets = {
  revisionText: ["text"],
  proposals: {
    text: ["explanation", "relatedTask", "rejectionReason"],
    json: ["operations", "validation", "approvalReasons"],
    list: ["touches"],
    /** Cleared rather than rewritten: two keys could become the same. */
    cleared: ["idempotencyKey"],
  },
  events: { text: ["summary"], json: ["data"] },
  index: {
    tables: [
      schema.catalogIndexDocuments,
      schema.catalogIndexFacts,
      schema.catalogIndexRelations,
      schema.catalogIndexDiscrepancies,
      schema.catalogIndexSections,
      schema.catalogIndexProvenance,
    ],
    skipped: [
      "search",
      "search_simple",
      "author",
      "least_trusted",
      "authors",
      "units",
    ],
  },
} as const

/** Where a text is in a workspace's catalog. */
export interface CatalogPurgePreview {
  /** Stored document texts that hold it, counting each revision. */
  revisionTexts: number
  /** Documents with any revision that holds it. */
  documents: number
  /**
   * The catalog IDs (or, without one, the stable IDs) of documents whose
   * latest text holds it: the purge stores their cleaned text as a new
   * catalog revision.
   */
  latestDocuments: string[]
  /** Catalog proposals that hold it. */
  proposals: number
  /** Of those, the ones waiting for catalog approval: the purge rejects them. */
  waitingProposals: number
  /** Timeline events that hold it. */
  events: number
  /**
   * Documents whose agent index rows hold it while their stored text does
   * not hold it as written (for example in YAML escapes, or folded across
   * lines): purge it as the stored text writes it.
   */
  writtenDifferently: number
}

/** A purge, as operations return it: never the purged text. */
export interface CatalogPurge {
  id: string
  /** Numbered from 1 in each workspace. */
  number: number
  createdAt: Date
  /** Who purged, in their written form (identity §8.7). */
  purgedBy: string
  reason: string
  /** The catalog revision that stored the cleaned latest text, if any latest text held it. */
  revision: number | null
  counts: CatalogPurgeCounts
}

/**
 * Where a text is in the workspace's catalog, so a workspace owner sees
 * what a purge would change before purging (human experience, workspace
 * settings: Data). Like the purge, it needs a workspace owner who signed
 * in again recently; it stores nothing.
 */
export async function previewCatalogPurge(
  ctx: Context,
  workspaceId: string,
  input: { text: unknown },
): Promise<CatalogPurgePreview> {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.purge",
    async (scope) => {
      const text = purgeText(input.text)
      const found = await find(scope.tx, scope.workspaceId, text)
      const latest = await currentOf(
        scope.tx,
        scope.workspaceId,
        found.revisionTexts,
      )
      const ids =
        latest.length === 0
          ? []
          : await scope.tx
              .select({
                documentId: schema.catalogIndexDocuments.documentId,
                catalogId: schema.catalogIndexDocuments.catalogId,
              })
              .from(schema.catalogIndexDocuments)
              .where(inArray(schema.catalogIndexDocuments.documentId, latest))
      const names = new Map(ids.map((r) => [r.documentId, r.catalogId]))
      const documents = new Set(found.revisionTexts.map((r) => r.documentId))
      return {
        revisionTexts: found.revisionTexts.length,
        documents: documents.size,
        latestDocuments: latest.map((id) => names.get(id) ?? id).sort(),
        proposals: found.proposals.length,
        waitingProposals: found.proposals.filter((p) => p.state === "pending")
          .length,
        events: found.events.length,
        writtenDifferently: found.index.filter((id) => !documents.has(id))
          .length,
      }
    },
    snapshotRead,
  )
}

/**
 * Purges a text from the workspace's catalog (catalog §9; architecture
 * §4.4), in one transaction holding the index lock:
 *
 * 1. records the purge: who, when and why, never the text;
 * 2. replaces every occurrence with `purgeMarker` in every revision's
 *    stored text, in catalog proposals and in timeline events
 *    (`purgeTargets`), rejecting waiting proposals that held it;
 * 3. stores the cleaned latest text of each document whose latest text
 *    held it as a new catalog revision, credited to the workspace owner,
 *    so agents asking what changed since a revision, and the catalog
 *    workers, see that the text changed;
 * 4. derives the agent index rows of every document with purged text
 *    again from its purged history, as a rebuild does (section credits and
 *    word provenance are replayed; a type schema document among them
 *    rebuilds the whole index), and checks that the text is nowhere left;
 * 5. appends a `catalog.purged` event and a security-log entry. The
 *    security log itself is never purged (D-049).
 *
 * Afterwards this process forgets text it had parsed; other processes do
 * within a minute (`watchCatalogPurges`). Copies outside Shinan, such as
 * exports, backups and agents' model providers, are not reached: a purged
 * secret must still be rotated at its source.
 */
export async function purgeCatalogText(
  ctx: Context,
  workspaceId: string,
  input: { text: unknown; reason: unknown },
): Promise<CatalogPurge> {
  const purge = await inWorkspace(
    ctx,
    workspaceId,
    "catalog.purge",
    async (scope) => {
      const text = purgeText(input.text)
      const reason = purgeReason(input.reason, text)
      const { tx } = scope
      const workspace = scope.workspaceId
      await lockIndexState(tx, workspace)

      const p = schema.catalogPurges
      const [{ next }] = (await tx
        .select({ next: sql<number>`coalesce(max(${p.number}), 0)::int + 1` })
        .from(p)
        .where(eq(p.workspaceId, workspace))) as [{ next: number }]
      // First, so that the triggers on events and revision text allow this
      // transaction's updates.
      const [row] = await tx
        .insert(p)
        .values({
          workspaceId: workspace,
          number: next,
          actorKind: scope.actor.kind,
          actorPersonId: scope.actor.personId,
          actorAgentId: scope.actor.agentId,
          actorAgentSessionId: scope.actor.agentSessionId,
          actorLabel: scope.actor.label,
          confidence: scope.actor.confidence,
          reason,
          counts: emptyCounts,
        })
        .returning()
      const purge = row!

      const texts = await purgeRevisionTexts(tx, workspace, text)
      const proposals = await purgeProposals(tx, workspace, text, {
        number: purge.number,
        actor: scope.actor,
      })
      const events = await purgeEvents(tx, workspace, text)
      if (texts.length + proposals.length + events.length === 0) {
        const found = await find(tx, workspace, text)
        throw found.index.length > 0 ? writtenDifferently() : nothingToPurge()
      }

      const latest = await currentOf(tx, workspace, texts)
      let revision: number | null = null
      if (latest.length > 0) {
        const cleaned = await latestTexts(tx, workspace, latest)
        ;({ revision } = await appendCatalogRevision(
          tx,
          workspace,
          scope.actor,
          cleaned.map((t) => ({ documentId: t.documentId, text: t.text })),
          { purgeId: purge.id },
        ))
      }
      const documents = [...new Set(texts.map((t) => t.documentId))].sort()
      await reindexDocuments(tx, workspace, documents)

      const left = await find(tx, workspace, text)
      if (left.index.length > 0) throw writtenDifferently()
      if (
        left.revisionTexts.length + left.proposals.length + left.events.length >
        0
      )
        throw new Error("A purge left the text in stored catalog records")

      const counts: CatalogPurgeCounts = {
        revisionTexts: texts.length,
        documents: documents.length,
        latestDocuments: latest.length,
        proposals: proposals.length,
        rejectedProposals: proposals.filter((p) => p.rejected).length,
        events: events.length,
      }
      const [stored] = await tx
        .update(p)
        .set({ counts })
        .where(eq(p.id, purge.id))
        .returning()
      await appendEvent(scope, {
        kind: "catalog.purged",
        subjects: [
          { type: "catalog-purge", id: purge.id },
          ...documents.map((id) => ({ type: "catalog-document", id })),
          ...proposals.map((p) => ({ type: "catalog-proposal", id: p.id })),
        ],
        summary: `${scope.actor.label} purged text from the catalog (purge ${purge.number}): ${describe(counts)}`,
        data: {
          purgeId: purge.id,
          number: purge.number,
          reason,
          revision,
          counts,
          proposals: proposals.map((p) => p.number).sort((a, b) => a - b),
        },
      })
      await recordSecurityEntry(tx, {
        workspaceId: workspace,
        action: "catalog.purged",
        outcome: "succeeded",
        actor: scope.actor,
        request: scope.request,
        details: { purgeId: purge.id, number: purge.number, revision, counts },
      })
      return purgeOf(stored!, revision)
    },
  )
  await forgetInThisProcess(workspaceId, purge.number)
  await vacuumPurged(ctx)
  return purge
}

/** The workspace's purges, newest first: who, when, why and how much, never the text. */
export async function listCatalogPurges(
  ctx: Context,
  workspaceId: string,
): Promise<CatalogPurge[]> {
  return inWorkspace(
    ctx,
    workspaceId,
    "workspace.read",
    async (scope) => {
      const p = schema.catalogPurges
      const r = schema.catalogRevisions
      const rows = await scope.tx
        .select({ purge: p, revision: r.number })
        .from(p)
        .leftJoin(r, and(eq(r.workspaceId, p.workspaceId), eq(r.purgeId, p.id)))
        .where(eq(p.workspaceId, scope.workspaceId))
        .orderBy(desc(p.number))
      return rows.map((row) => purgeOf(row.purge, row.revision))
    },
    snapshotRead,
  )
}

const emptyCounts: CatalogPurgeCounts = {
  revisionTexts: 0,
  documents: 0,
  latestDocuments: 0,
  proposals: 0,
  rejectedProposals: 0,
  events: 0,
}

function purgeOf(
  row: typeof schema.catalogPurges.$inferSelect,
  revision: number | null,
): CatalogPurge {
  return {
    id: row.id,
    number: row.number,
    createdAt: row.createdAt,
    purgedBy: row.actorLabel,
    reason: row.reason,
    revision,
    counts: row.counts,
  }
}

function describe(counts: CatalogPurgeCounts): string {
  const parts = [
    counts.revisionTexts > 0 &&
      `${plural(counts.revisionTexts, "revision text")} of ${plural(counts.documents, "document")}`,
    counts.proposals > 0 && plural(counts.proposals, "catalog proposal"),
    counts.events > 0 && plural(counts.events, "timeline event"),
  ].filter((part): part is string => typeof part === "string")
  return parts.join(", ")
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`
}

function purgeText(value: unknown): string {
  if (typeof value !== "string")
    throw new InvalidInputError("text", "Give the text to purge")
  const text = value.trim()
  if (text.length < purgeLimits.textMin)
    throw new InvalidInputError(
      "text-too-short",
      `The text to purge is at least ${purgeLimits.textMin} characters long, so that it cannot match ordinary words by accident`,
    )
  if (text.length > purgeLimits.textMax)
    throw new InvalidInputError(
      "text-too-long",
      `The text to purge is at most ${purgeLimits.textMax} characters long; purge a longer passage in parts`,
    )
  if (!text.isWellFormed() || text.includes("\u0000"))
    throw new InvalidInputError(
      "text",
      "The text to purge has characters that no catalog text can hold",
    )
  if (purgeMarker.includes(text))
    throw new InvalidInputError(
      "text-in-marker",
      `The text to purge cannot be part of ${purgeMarker}, the marker that replaces it`,
    )
  return text
}

function purgeReason(value: unknown, text: string): string {
  const reason = typeof value === "string" ? value.trim() : ""
  if (reason === "")
    throw new InvalidInputError(
      "reason-blank",
      "Say why the text is purged: the reason is kept on the timeline",
    )
  if (reason.length > purgeLimits.reason)
    throw new InvalidInputError(
      "reason-too-long",
      `The reason is longer than ${purgeLimits.reason} characters`,
    )
  if (reason.includes(text))
    throw new InvalidInputError(
      "reason-holds-text",
      "The reason must not repeat the purged text: the reason is kept",
    )
  return reason
}

function nothingToPurge(): RuleViolationError {
  return new RuleViolationError(
    "nothing-to-purge",
    "No stored catalog text, catalog proposal or timeline event of this workspace holds this text, written exactly so",
  )
}

function writtenDifferently(): RuleViolationError {
  return new RuleViolationError(
    "written-differently",
    "The agent index holds this text, but the stored text writes it differently, for example with YAML escapes or folded across lines. Nothing was purged: purge it as the stored text writes it.",
  )
}

/** The text as it appears inside a JSON string, as PostgreSQL writes jsonb. */
function inJson(text: string): string {
  return JSON.stringify(text).slice(1, -1)
}

/**
 * Replaces every occurrence of `text`, again until none is left: a
 * replacement next to other text could complete a new one.
 */
function replaceAll(value: string, text: string, marker = purgeMarker): string {
  let result = value
  for (let pass = 0; result.includes(text); pass++) {
    if (pass === 10) throw new Error("Purging a text did not finish")
    result = result.split(text).join(marker)
  }
  return result
}

/** A JSON value with every string in it, keys too, passed through `purge`. */
function mapStrings(value: unknown, purge: (s: string) => string): unknown {
  if (typeof value === "string") return purge(value)
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, purge))
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [purge(k), mapStrings(v, purge)]),
    )
  return value
}

/** Whether any string in a JSON value, keys too, holds `text`. */
function holdsJson(value: unknown, text: string): boolean {
  let found = false
  mapStrings(value, (s) => {
    if (s.includes(text)) found = true
    return s
  })
  return found
}

type ProposalRow = typeof schema.catalogProposals.$inferSelect

/** The purgeable fields of a proposal, as `purgeTargets.proposals` names them. */
function proposalFields(row: ProposalRow) {
  return {
    explanation: row.explanation,
    relatedTask: row.relatedTask,
    rejectionReason: row.rejectionReason,
    operations: row.operations as unknown,
    validation: row.validation as unknown,
    approvalReasons: row.approvalReasons as unknown,
    touches: row.touches,
    idempotencyKey: row.idempotencyKey,
  } satisfies Record<
    (typeof purgeTargets.proposals)[
      "text" | "json" | "list" | "cleared"][number],
    unknown
  >
}

/** Where the text is now: what a purge would change, or what one left. */
async function find(
  tx: Transaction,
  workspaceId: string,
  text: string,
): Promise<{
  revisionTexts: { documentId: string; revision: number }[]
  proposals: { id: string; state: ProposalRow["state"] }[]
  events: number[]
  /** Documents whose index rows hold it. */
  index: string[]
}> {
  const json = inJson(text)
  const r = schema.catalogRevisionDocuments
  const revisionTexts = await tx
    .select({ documentId: r.documentId, revision: r.revision })
    .from(r)
    .where(
      and(eq(r.workspaceId, workspaceId), sql`strpos(${r.text}, ${text}) > 0`),
    )

  const proposals = (await proposalCandidates(tx, workspaceId, json, false))
    .filter((row) => holdsJson(proposalFields(row), text))
    .map((row) => ({ id: row.id, state: row.state }))

  const events = (await eventCandidates(tx, workspaceId, text, json))
    .filter((row) => holdsJson({ summary: row.summary, data: row.data }, text))
    .map((row) => row.id)

  const index = new Set<string>()
  const skipped = sql.raw(
    `array[${purgeTargets.index.skipped.map((c) => `'${c}'`).join(", ")}]`,
  )
  for (const table of purgeTargets.index.tables) {
    const rows = await tx.execute<{ document_id: string; row: unknown }>(
      sql`select document_id, to_jsonb(t) - ${skipped}::text[] as row from ${table} t where t.workspace_id = ${workspaceId} and strpos((to_jsonb(t) - ${skipped}::text[])::text, ${json}) > 0`,
    )
    for (const row of rows.rows)
      if (holdsJson(row.row, text)) index.add(row.document_id)
  }
  return { revisionTexts, proposals, events, index: [...index] }
}

/**
 * Proposals whose stored row might hold the text, to check one by one;
 * locked when they are to be purged.
 */
async function proposalCandidates(
  tx: Transaction,
  workspaceId: string,
  json: string,
  lock = true,
): Promise<ProposalRow[]> {
  const t = schema.catalogProposals
  const query = tx
    .select()
    .from(t)
    .where(
      and(
        eq(t.workspaceId, workspaceId),
        sql`strpos(to_jsonb(${t})::text, ${json}) > 0`,
      ),
    )
  return lock ? query.for("update") : query
}

function eventCandidates(
  tx: Transaction,
  workspaceId: string,
  text: string,
  json: string,
) {
  const e = schema.events
  return tx
    .select({ id: e.id, summary: e.summary, data: e.data })
    .from(e)
    .where(
      and(
        eq(e.workspaceId, workspaceId),
        sql`(strpos(${e.summary}, ${text}) > 0 or strpos(${e.data}::text, ${json}) > 0)`,
      ),
    )
}

/** Rewrites every revision's stored text; returns the texts it changed. */
async function purgeRevisionTexts(
  tx: Transaction,
  workspaceId: string,
  text: string,
): Promise<{ documentId: string; revision: number }[]> {
  const r = schema.catalogRevisionDocuments
  const changed = new Map<string, { documentId: string; revision: number }>()
  for (let pass = 0; ; pass++) {
    const rows = await tx
      .update(r)
      .set({ text: sql`replace(${r.text}, ${text}, ${purgeMarker})` })
      .where(
        and(
          eq(r.workspaceId, workspaceId),
          sql`strpos(${r.text}, ${text}) > 0`,
        ),
      )
      .returning({ documentId: r.documentId, revision: r.revision })
    if (rows.length === 0) break
    if (pass === 10) throw new Error("Purging a text did not finish")
    for (const row of rows)
      changed.set(`${row.documentId}@${row.revision}`, row)
  }
  return [...changed.values()]
}

/** Which of the documents with rewritten texts had their latest text rewritten. */
async function currentOf(
  tx: Transaction,
  workspaceId: string,
  texts: readonly { documentId: string; revision: number }[],
): Promise<string[]> {
  if (texts.length === 0) return []
  const rewritten = new Set(texts.map((t) => `${t.documentId}@${t.revision}`))
  const d = schema.catalogDocuments
  const rows = await tx
    .select({ id: d.id, revision: d.currentRevision })
    .from(d)
    .where(
      and(
        eq(d.workspaceId, workspaceId),
        inArray(d.id, [...new Set(texts.map((t) => t.documentId))]),
      ),
    )
  return rows
    .filter((row) => rewritten.has(`${row.id}@${row.revision}`))
    .map((row) => row.id)
    .sort()
}

/**
 * Rewrites the catalog proposals that hold the text. A waiting one is
 * rejected: its operations no longer say what its author meant. Validation
 * findings and approval reasons also lose the text's excerpt, as the
 * secret check shows it (`excerpt`).
 */
async function purgeProposals(
  tx: Transaction,
  workspaceId: string,
  text: string,
  purge: {
    number: number
    actor: {
      personId: string | null
      agentId: string | null
      label: string
    }
  },
): Promise<{ id: string; number: number; rejected: boolean }[]> {
  const purged: { id: string; number: number; rejected: boolean }[] = []
  const cut = excerpt(text)
  const plain = (s: string) => replaceAll(s, text)
  // An excerpt of six characters, of a text of 18 or more.
  const findings = (s: string) =>
    cut.length > 6 ? replaceAll(plain(s), cut) : plain(s)
  for (const row of await proposalCandidates(tx, workspaceId, inJson(text))) {
    const fields = proposalFields(row)
    if (!holdsJson(fields, text)) continue
    const explanation = plain(row.explanation)
    const relatedTask = row.relatedTask === null ? null : plain(row.relatedTask)
    const operations = mapStrings(row.operations, plain) as CatalogOperation[]
    const pending = row.state === "pending"
    await tx
      .update(schema.catalogProposals)
      .set({
        explanation,
        relatedTask,
        operations,
        validation: mapStrings(row.validation, findings) as Record<
          string,
          unknown
        >[],
        approvalReasons: mapStrings(row.approvalReasons, findings) as string[],
        touches: row.touches.map(plain),
        idempotencyKey:
          row.idempotencyKey === null || row.idempotencyKey.includes(text)
            ? null
            : row.idempotencyKey,
        requestHash: hashOf({ explanation, relatedTask, operations }),
        ...(pending
          ? {
              state: "rejected" as const,
              rejectionReason: `Rejected by purge ${purge.number}: it held text a workspace owner purged`,
              decidedAt: new Date(),
              decidedByPersonId: purge.actor.personId,
              decidedByAgentId: purge.actor.agentId,
              decidedByLabel: purge.actor.label,
            }
          : {
              rejectionReason:
                row.rejectionReason === null
                  ? null
                  : plain(row.rejectionReason),
            }),
      })
      .where(eq(schema.catalogProposals.id, row.id))
    purged.push({ id: row.id, number: row.number, rejected: pending })
  }
  return purged
}

/** Rewrites the summary and data of the timeline events that hold the text. */
async function purgeEvents(
  tx: Transaction,
  workspaceId: string,
  text: string,
): Promise<number[]> {
  const purged: number[] = []
  const plain = (s: string) => replaceAll(s, text)
  for (const row of await eventCandidates(
    tx,
    workspaceId,
    text,
    inJson(text),
  )) {
    if (!holdsJson({ summary: row.summary, data: row.data }, text)) continue
    await tx
      .update(schema.events)
      .set({
        summary: plain(row.summary),
        data: mapStrings(row.data, plain) as Record<string, unknown>,
      })
      .where(eq(schema.events.id, row.id))
    purged.push(row.id)
  }
  return purged
}

/** After a purge in this process: forget the workspace's parsed text here at once. */
async function forgetInThisProcess(
  workspaceId: string,
  purges: number,
): Promise<void> {
  clearTypeSchemaCache()
  await catalogWorkers().forgetPurged(new Map([[workspaceId, purges]]))
}

const vacuumLog = createLimitedLog()

/**
 * Asks PostgreSQL to clear out the rows' earlier versions, which still hold
 * the text until it does (otherwise autovacuum does, in its own time). Best
 * effort: the purge has committed whatever happens here.
 */
async function vacuumPurged(ctx: Context): Promise<void> {
  try {
    await ctx.db.execute(
      sql`vacuum (skip_locked) catalog_revision_documents, catalog_proposals, events, catalog_index_documents, catalog_index_facts, catalog_index_relations, catalog_index_discrepancies, catalog_index_sections, catalog_index_provenance`,
    )
  } catch (error) {
    vacuumLog(
      "purge-vacuum",
      `Vacuum after a catalog purge failed (${databaseErrorCode(error)}); autovacuum clears the earlier row versions later`,
    )
  }
}

/** Each workspace's number of purges, as this process last saw them. */
let seenPurges: number | null = null

/**
 * Forgets catalog text this process parsed before a purge in another
 * process (catalog §9): stops the catalog workers of workspaces with new
 * purges and empties the type schema cache. `watchCatalogPurges` runs it
 * every minute; the purging process does it at once.
 */
export async function forgetPurgedCatalogText(ctx: Context): Promise<void> {
  const rows = await atInstallation(
    { ...ctx, actor: shinan },
    "catalog-index.maintain",
    (scope) =>
      scope.tx
        .select({
          workspaceId: schema.catalogPurges.workspaceId,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.catalogPurges)
        .groupBy(schema.catalogPurges.workspaceId),
  )
  const total = rows.reduce((sum, row) => sum + row.count, 0)
  if (seenPurges !== null && total !== seenPurges) clearTypeSchemaCache()
  seenPurges = total
  await catalogWorkers().forgetPurged(
    new Map(rows.map((row) => [row.workspaceId, row.count])),
  )
}

const watchLog = createLimitedLog()

/**
 * Runs `forgetPurgedCatalogText` every `intervalMs` (a minute) in a process
 * that keeps catalog text parsed: the `web` and `worker` roles. Returns a
 * function that stops it.
 */
export function watchCatalogPurges(
  ctx: Context,
  intervalMs = 60_000,
): () => void {
  const run = () =>
    forgetPurgedCatalogText(ctx).catch((error: unknown) =>
      watchLog(
        "purge-watch",
        `Checking for catalog purges failed (${databaseErrorCode(error)}); trying again in a minute`,
      ),
    )
  void run()
  const timer = setInterval(() => void run(), intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}
