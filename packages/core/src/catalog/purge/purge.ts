import { createHash } from "node:crypto"

import {
  and,
  createLimitedLog,
  databaseErrorCode,
  desc,
  eq,
  getTableColumns,
  inArray,
  schema,
  sql,
} from "@shinan/db"
import type { CatalogPurgeCounts, SQL, Transaction } from "@shinan/db"

import { shinan } from "../../actor.js"
import { atInstallation, inWorkspace, snapshotRead } from "../../authorize.js"
import type { Context } from "../../context.js"
import { InvalidInputError, RuleViolationError } from "../../errors.js"
import { appendEvent } from "../../events.js"
import { recordSecurityEntry } from "../../security-log.js"
import { parseCatalogDocument } from "../document/index.js"
import { splitFrontmatter } from "../document/parse.js"
import { excerpt } from "../document/secrets.js"
import {
  clearTypeSchemaCache,
  lockIndexState,
  reindexDocuments,
} from "../index/indexer.js"
import { latestTexts } from "../index/store.js"
import { appendCatalogRevision } from "../revisions.js"
import { PurgeMatcher, spaces } from "./matcher.js"

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
 * - `catalog_proposal_comments`: the text, and the idempotency key, cleared
 *   when either holds the text.
 * - The agent index: rebuilt from the purged text, then checked, except
 *   the columns naming who wrote what (an actor's written form is not
 *   catalog content), those derived from other columns, and the word
 *   provenance, which holds only hashes of words and the authors.
 */
export const purgeTargets = {
  revisionText: ["text"],
  proposals: {
    text: ["explanation", "relatedTask", "rejectionReason"],
    json: ["operations", "validation", "approvalReasons"],
    list: ["touches"],
    /**
     * Cleared: a retry of the request as it was sent no longer matches the
     * purged proposal, and two rewritten keys could become the same.
     */
    cleared: ["idempotencyKey"],
  },
  events: { text: ["summary"], json: ["data"] },
  comments: { text: ["text"], cleared: ["idempotencyKey"] },
  index: {
    tables: [
      schema.catalogIndexDocuments,
      schema.catalogIndexFacts,
      schema.catalogIndexRelations,
      schema.catalogIndexDiscrepancies,
      schema.catalogIndexSections,
    ],
    skipped: ["author", "least_trusted"],
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
  /** Comments on catalog proposals that hold it. */
  comments: number
  /**
   * Documents whose agent index rows hold it while their stored text does
   * not, because the text writes it differently (YAML escapes, for
   * example): purge it as the stored text writes it.
   */
  writtenDifferently: string[]
  /**
   * Where it is found only across a line break (wrapped text, or a long
   * word split by an editor), to look at before purging: the stored texts,
   * and the current pages among them.
   */
  acrossLines: { revisionTexts: number; latestDocuments: string[] }
  /**
   * Places that hold it in an encoded form the purge does not reach, such
   * as in a link: purge each form too (`text` is the form to purge).
   */
  alsoWrittenAs: EncodedForm[]
  /**
   * Where purging would change a document's structure: the text is in its
   * ID or an alias, ends at a frontmatter key, or spans lines of the
   * frontmatter. The document may then read with problems, to repair.
   */
  structure: { id: string; where: "id" | "alias" | "key" | "frontmatter" }[]
}

/** A text written in an encoded form, and how many places hold it. */
export interface EncodedForm {
  form: "url" | "percent" | "html" | "escaped"
  text: string
  revisionTexts: number
  proposals: number
  events: number
  comments: number
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
  /**
   * Documents whose latest text reads with problems it did not have before
   * the purge, to repair: given only by the purge itself.
   */
  newProblems?: { id: string; problems: string[] }[]
}

/**
 * A condition that holds for every value of `column` that holds the text
 * (`PurgeMatcher`), and is quick to test: the value has the text's first
 * 64 characters other than whitespace, with any whitespace between them.
 * For a JSON column, its text form, where whitespace may also be written
 * as JSON's escapes.
 */
function mayHold(match: PurgeMatcher, column: SQL, json = false): SQL {
  const gap = json ? `(?:[${spaces}]|\\\\[nrtf]|\\\\u000[bB])*` : `[${spaces}]*`
  const pattern = [...match.words.join("")]
    .slice(0, 64)
    .map((c) => (json ? inJson(c) : c).replace(/[!-/:-@[-`{-~]/g, "\\$&"))
    .join(gap)
  return sql`${column} ~ ${pattern}`
}

/**
 * Where a text is in the workspace's catalog, so a workspace owner sees
 * what a purge would change before purging (human experience, workspace
 * settings: Data), and copies the purge would not reach. Like the purge,
 * it needs a workspace owner who signed in again recently; it stores
 * nothing.
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
      const match = new PurgeMatcher(purgeText(input.text))
      const { tx } = scope
      const workspace = scope.workspaceId
      const found = await find(tx, workspace, match)
      const latest = await latestHolding(tx, workspace, match)
      const names = await catalogIds(tx, [
        ...latest.map((l) => l.documentId),
        ...found.index,
      ])
      const name = (id: string) =>
        match.replace(names.get(id) ?? id, purgeMarker)
      const documents = new Set(found.revisionTexts.map((r) => r.documentId))
      return {
        revisionTexts: found.revisionTexts.length,
        documents: documents.size,
        latestDocuments: latest.map((l) => name(l.documentId)).sort(),
        proposals: found.proposals.length,
        waitingProposals: found.proposals.filter((p) => p.state === "pending")
          .length,
        events: found.events.length,
        comments: found.comments.length,
        writtenDifferently: found.index
          .filter((id) => !documents.has(id))
          .map(name)
          .sort(),
        acrossLines: {
          revisionTexts: found.acrossLines.length,
          latestDocuments: (
            await kept(match, latest, (l) =>
              match.matches(l.text).some((m) => m.acrossLines),
            )
          )
            .map((l) => name(l.documentId))
            .sort(),
        },
        alsoWrittenAs: await encodedForms(tx, workspace, match.text),
        structure: (
          await mapped(match, latest, (l) =>
            structureAt(l.text, match).map((where) => ({
              id: name(l.documentId),
              where,
            })),
          )
        ).flat(),
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
 * 2. replaces every occurrence (`PurgeMatcher`) with `purgeMarker` in every
 *    revision's stored text, in catalog proposals and their comments, and
 *    in timeline events
 *    (`purgeTargets`), rejecting waiting proposals that held it;
 * 3. stores the cleaned latest text of each document whose latest text
 *    held it as a new catalog revision, credited to the workspace owner,
 *    so agents asking what changed since a revision, and the catalog
 *    workers, see that the text changed;
 * 4. derives the agent index rows of every document with purged text
 *    again from its purged history, as a rebuild does (section credits and
 *    word provenance are replayed), or rebuilds the whole index when a type
 *    schema document or a large share of the catalog is among them, and
 *    checks that the text is nowhere left;
 * 5. appends a `catalog.purged` event and a security-log entry. The
 *    security log itself is never purged (D-049).
 *
 * Afterwards this process forgets text it had parsed; other processes do
 * within a minute (`watchCatalogPurges`). Copies outside Shinan, such as
 * exports, backups and agents' model providers, are not reached: a purged
 * secret must still be rotated at its source. A proposal being worked out
 * during the purge, or sent again afterwards, can bring the text back, so
 * the owner looks again a minute later.
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
      const match = new PurgeMatcher(purgeText(input.text))
      const reason = purgeReason(input.reason, match)
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

      const before = await latestHolding(tx, workspace, match)
      // How they read before, to tell which the purge breaks.
      const problemsBefore = new Map(
        [
          ...(await indexProblems(
            tx,
            before.map((b) => b.documentId),
          )),
        ].map(([id, row]) => [id, row.problems]),
      )
      const texts = await purgeRevisionTexts(tx, workspace, match)
      const proposals = await purgeProposals(tx, workspace, match, {
        number: purge.number,
        actor: scope.actor,
      })
      const events = await purgeEvents(tx, workspace, match)
      const comments = await purgeComments(tx, workspace, match)
      if (
        texts.length + proposals.length + events.length + comments.length ===
        0
      ) {
        const found = await find(tx, workspace, match)
        throw found.index.length > 0
          ? await writtenDifferently(tx, found.index, match)
          : nothingToPurge()
      }

      const latest = before.map((b) => b.documentId)
      let revision: number | null = null
      if (latest.length > 0) {
        const cleaned = await latestTexts(tx, workspace, latest)
        // Not indexed here: every one is derived again below.
        ;({ revision } = await appendCatalogRevision(
          tx,
          workspace,
          scope.actor,
          cleaned.map((t) => ({ documentId: t.documentId, text: t.text })),
          { purgeId: purge.id },
          { index: false },
        ))
      }
      const documents = [...new Set(texts.map((t) => t.documentId))].sort()
      await reindexDocuments(tx, workspace, documents)

      const left = await find(tx, workspace, match)
      if (left.index.length > 0)
        throw await writtenDifferently(tx, left.index, match)
      if (
        left.revisionTexts.length +
          left.proposals.length +
          left.events.length +
          left.comments.length >
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
        comments: comments.length,
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
          ...[
            ...new Set([
              ...proposals.map((p) => p.id),
              ...comments.map((c) => c.proposalId),
            ]),
          ].map((id) => ({ type: "catalog-proposal", id })),
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
      return {
        ...purgeOf(stored!, revision),
        newProblems: await newProblems(tx, latest, problemsBefore),
      }
    },
  )
  // Forget the type schemas this process parsed from the purged text.
  clearTypeSchemaCache()
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
  comments: 0,
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
    counts.comments > 0 && plural(counts.comments, "comment"),
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
  if (new PurgeMatcher(text).test(purgeMarker))
    throw new InvalidInputError(
      "text-in-marker",
      `The text to purge cannot be part of ${purgeMarker}, the marker that replaces it`,
    )
  return text
}

function purgeReason(value: unknown, match: PurgeMatcher): string {
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
  if (match.test(reason))
    throw new InvalidInputError(
      "reason-holds-text",
      "The reason must not repeat the purged text: the reason is kept",
    )
  return reason
}

function nothingToPurge(): RuleViolationError {
  return new RuleViolationError(
    "nothing-to-purge",
    "No stored catalog text, catalog proposal or timeline event of this workspace holds this text",
  )
}

/** Names the documents whose index holds the text while their stored text writes it differently. */
async function writtenDifferently(
  tx: Transaction,
  documentIds: readonly string[],
  match: PurgeMatcher,
): Promise<RuleViolationError> {
  const names = await catalogIds(tx, documentIds)
  const shown = documentIds
    .map((id) => match.replace(names.get(id) ?? id, purgeMarker))
    .sort()
  const listed =
    shown.length > 20
      ? `${shown.slice(0, 20).join(", ")} and ${shown.length - 20} more`
      : shown.join(", ")
  return new RuleViolationError(
    "written-differently",
    `The agent index holds this text for ${listed}, but their stored text writes it differently, for example with YAML escapes. Nothing was purged: purge it as the stored text writes it.`,
  )
}

/** Each document's current catalog ID, by stable ID. */
async function catalogIds(
  tx: Transaction,
  documentIds: readonly string[],
): Promise<Map<string, string | null>> {
  if (documentIds.length === 0) return new Map()
  const t = schema.catalogIndexDocuments
  const rows = await tx
    .select({ documentId: t.documentId, catalogId: t.catalogId })
    .from(t)
    .where(inArray(t.documentId, [...new Set(documentIds)]))
  return new Map(rows.map((r) => [r.documentId, r.catalogId]))
}

/**
 * `fn` of each row, in order, giving the event loop back between rows
 * once matching has held it for a while (#149).
 */
async function mapped<T, R>(
  match: PurgeMatcher,
  rows: readonly T[],
  fn: (row: T) => R,
): Promise<R[]> {
  const result: R[] = []
  for (const row of rows) {
    await match.pause()
    result.push(fn(row))
  }
  return result
}

/** The rows `keep` keeps, as `mapped` goes through them. */
async function kept<T>(
  match: PurgeMatcher,
  rows: readonly T[],
  keep: (row: T) => boolean,
): Promise<T[]> {
  const result: T[] = []
  for (const row of rows) {
    await match.pause()
    if (keep(row)) result.push(row)
  }
  return result
}

/** The text as it appears inside a JSON string, as PostgreSQL writes jsonb. */
function inJson(text: string): string {
  return JSON.stringify(text).slice(1, -1)
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

/** Whether any string in a JSON value, keys too, holds the text. */
function holdsJson(value: unknown, match: PurgeMatcher): boolean {
  let found = false
  mapStrings(value, (s) => {
    if (!found && match.test(s)) found = true
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
  match: PurgeMatcher,
): Promise<{
  revisionTexts: { documentId: string; revision: number }[]
  /** Of those, the ones where it crosses a line break. */
  acrossLines: { documentId: string; revision: number }[]
  proposals: { id: string; state: ProposalRow["state"] }[]
  events: number[]
  comments: string[]
  /** Documents whose index rows hold it. */
  index: string[]
}> {
  const holding = (
    await mapped(
      match,
      await revisionCandidates(tx, workspaceId, match),
      ({ documentId, revision, text }) => {
        const found = match.matches(text)
        return found.length === 0
          ? []
          : [
              {
                documentId,
                revision,
                acrossLines: found.some((m) => m.acrossLines),
              },
            ]
      },
    )
  ).flat()
  const revisionTexts = holding.map(({ documentId, revision }) => ({
    documentId,
    revision,
  }))
  const acrossLines = holding
    .filter((h) => h.acrossLines)
    .map(({ documentId, revision }) => ({ documentId, revision }))

  const proposals = (
    await kept(
      match,
      await proposalCandidates(tx, workspaceId, match, false),
      (row) => holdsJson(proposalFields(row), match),
    )
  ).map((row) => ({ id: row.id, state: row.state }))

  const events = (
    await kept(match, await eventCandidates(tx, workspaceId, match), (row) =>
      holdsJson({ summary: row.summary, data: row.data }, match),
    )
  ).map((row) => row.id)

  const index = new Set<string>()
  for (const table of purgeTargets.index.tables) {
    // The columns that can hold catalog text, as one JSON array per row.
    const columns = Object.values(
      getTableColumns(table) as Record<
        string,
        { name: string; generated: unknown; columnType: string }
      >,
    ).filter(
      (c) =>
        !c.generated &&
        !(purgeTargets.index.skipped as readonly string[]).includes(c.name) &&
        !["PgUUID", "PgInteger", "PgBoolean", "PgTimestamp"].includes(
          c.columnType,
        ),
    )
    const row = sql`json_build_array(${sql.join(
      columns.map((c) => sql.identifier(c.name)),
      sql`, `,
    )})`
    const rows = await tx.execute<{ document_id: string; row: unknown }>(
      sql`select document_id, ${row} as row from ${table} where workspace_id = ${workspaceId} and ${mayHold(match, sql`${row}::text`, true)}`,
    )
    for (const found of await kept(match, rows.rows, (r) =>
      holdsJson(r.row, match),
    ))
      index.add(found.document_id)
  }
  const comments = (
    await kept(match, await commentCandidates(tx, workspaceId, match), (row) =>
      commentHolds(row, match),
    )
  ).map((row) => row.id)

  return {
    revisionTexts,
    acrossLines,
    proposals,
    events,
    comments,
    index: [...index],
  }
}

/** Revision texts that might hold the text, to check one by one. */
function revisionCandidates(
  tx: Transaction,
  workspaceId: string,
  match: PurgeMatcher,
) {
  const r = schema.catalogRevisionDocuments
  return tx
    .select({ documentId: r.documentId, revision: r.revision, text: r.text })
    .from(r)
    .where(and(eq(r.workspaceId, workspaceId), mayHold(match, sql`${r.text}`)))
}

/**
 * Proposals whose stored row might hold the text, to check one by one;
 * locked when they are to be purged.
 */
async function proposalCandidates(
  tx: Transaction,
  workspaceId: string,
  match: PurgeMatcher,
  lock = true,
): Promise<ProposalRow[]> {
  const t = schema.catalogProposals
  const query = tx
    .select()
    .from(t)
    .where(
      and(
        eq(t.workspaceId, workspaceId),
        mayHold(match, sql`to_jsonb(${t})::text`, true),
      ),
    )
  return lock ? query.for("update") : query
}

function eventCandidates(
  tx: Transaction,
  workspaceId: string,
  match: PurgeMatcher,
) {
  const e = schema.events
  return tx
    .select({ id: e.id, summary: e.summary, data: e.data })
    .from(e)
    .where(
      and(
        eq(e.workspaceId, workspaceId),
        sql`((${mayHold(match, sql`${e.summary}`)}) or (${mayHold(match, sql`${e.data}::text`, true)}))`,
      ),
    )
}

/** Rewrites every revision's stored text; returns the texts it changed. */
async function purgeRevisionTexts(
  tx: Transaction,
  workspaceId: string,
  match: PurgeMatcher,
): Promise<{ documentId: string; revision: number }[]> {
  const r = schema.catalogRevisionDocuments
  const changed = (
    await mapped(
      match,
      await revisionCandidates(tx, workspaceId, match),
      (row) =>
        match.test(row.text)
          ? [{ ...row, text: match.replace(row.text, purgeMarker) }]
          : [],
    )
  ).flat()
  // A few hundred at a time, each batch in one statement.
  for (let i = 0; i < changed.length; i += 200)
    await tx.execute(
      sql`update ${r} set text = v.text from jsonb_to_recordset(${JSON.stringify(
        changed.slice(i, i + 200).map((c) => ({
          document_id: c.documentId,
          revision: c.revision,
          text: c.text,
        })),
      )}::jsonb) as v(document_id uuid, revision integer, text text) where ${r.documentId} = v.document_id and ${r.revision} = v.revision`,
    )
  return changed.map(({ documentId, revision }) => ({ documentId, revision }))
}

/** The latest texts that hold the text, by document. */
async function latestHolding(
  tx: Transaction,
  workspaceId: string,
  match: PurgeMatcher,
): Promise<{ documentId: string; text: string }[]> {
  const d = schema.catalogDocuments
  const r = schema.catalogRevisionDocuments
  const rows = await tx
    .select({ documentId: d.id, text: r.text })
    .from(d)
    .innerJoin(
      r,
      and(eq(r.documentId, d.id), eq(r.revision, d.currentRevision)),
    )
    .where(and(eq(d.workspaceId, workspaceId), mayHold(match, sql`${r.text}`)))
  return (await kept(match, rows, (row) => match.test(row.text))).sort(
    (a, b) => (a.documentId < b.documentId ? -1 : 1),
  )
}

/**
 * Where purging the text from a latest text would change the document's
 * structure: its ID or an alias, a frontmatter key it ends at, or lines of
 * the frontmatter it spans.
 */
function structureAt(
  text: string,
  match: PurgeMatcher,
): ("id" | "alias" | "key" | "frontmatter")[] {
  const found = new Set<"id" | "alias" | "key" | "frontmatter">()
  const document = parseCatalogDocument(text)
  if (document.id !== null && match.test(document.id)) found.add("id")
  if (
    document.kind === "entity" &&
    document.aliases.some((alias) => match.test(alias))
  )
    found.add("alias")
  const { bodyStart } = splitFrontmatter(text)
  for (const m of match.find(text)) {
    if (m.index >= bodyStart) continue
    if (/^\s*:/.test(text.slice(m.index + m.text.length))) found.add("key")
    if (/[\r\n]/.test(m.text)) found.add("frontmatter")
  }
  return [...found]
}

/** The latest texts the purge left reading with problems they did not have. */
async function newProblems(
  tx: Transaction,
  documentIds: readonly string[],
  before: ReadonlyMap<string, { code: string }[]>,
): Promise<{ id: string; problems: string[] }[]> {
  if (documentIds.length === 0) return []
  const result: { id: string; problems: string[] }[] = []
  for (const [documentId, now] of await indexProblems(tx, documentIds)) {
    const was = (before.get(documentId) ?? []).map((p) => p.code)
    const added = now.problems.filter((p) => {
      const i = was.indexOf(p.code)
      if (i < 0) return true
      was.splice(i, 1)
      return false
    })
    if (added.length > 0)
      result.push({
        id: now.catalogId ?? documentId,
        problems: added.map((p) => p.message),
      })
  }
  return result.sort((a, b) => (a.id < b.id ? -1 : 1))
}

/** The problems the index found reading each document's latest text. */
async function indexProblems(
  tx: Transaction,
  documentIds: readonly string[],
): Promise<
  Map<
    string,
    { catalogId: string | null; problems: { code: string; message: string }[] }
  >
> {
  if (documentIds.length === 0) return new Map()
  const t = schema.catalogIndexDocuments
  const rows = await tx
    .select({
      documentId: t.documentId,
      catalogId: t.catalogId,
      problems: t.problems,
    })
    .from(t)
    .where(inArray(t.documentId, [...documentIds]))
  return new Map(rows.map((r) => [r.documentId, r]))
}

/**
 * The text written in encoded forms a purge does not reach, and where:
 * URL-encoded (as in a link), percent-encoded character by character, with
 * HTML entities, or with JSON or YAML escapes. Searched as written, and
 * percent-encoding in either case.
 */
async function encodedForms(
  tx: Transaction,
  workspaceId: string,
  text: string,
): Promise<EncodedForm[]> {
  const forms: { form: EncodedForm["form"]; text: string; anyCase: boolean }[] =
    [
      { form: "url", text: encodeURIComponent(text), anyCase: true },
      { form: "percent", text: percentEncoded(text), anyCase: true },
      { form: "html", text: htmlEscaped(text), anyCase: false },
      { form: "escaped", text: inJson(text), anyCase: false },
    ]
  const seen = new Set([text])
  const result: EncodedForm[] = []
  for (const form of forms) {
    if (seen.has(form.text)) continue
    seen.add(form.text)
    const has = (column: SQL, value: string) =>
      form.anyCase
        ? sql`strpos(lower(${column}), ${value.toLowerCase()}) > 0`
        : sql`strpos(${column}, ${value}) > 0`
    const r = schema.catalogRevisionDocuments
    const p = schema.catalogProposals
    const e = schema.events
    const c = schema.catalogProposalComments
    const [counts] = (
      await tx.execute<{
        revision_texts: number
        proposals: number
        events: number
        comments: number
      }>(
        sql`select
          (select count(*)::int from ${r} where ${r.workspaceId} = ${workspaceId} and ${has(sql`${r.text}`, form.text)}) as revision_texts,
          (select count(*)::int from ${p} where ${p.workspaceId} = ${workspaceId} and ${has(sql`to_jsonb(${p})::text`, inJson(form.text))}) as proposals,
          (select count(*)::int from ${e} where ${e.workspaceId} = ${workspaceId} and (${has(sql`${e.summary}`, form.text)} or ${has(sql`${e.data}::text`, inJson(form.text))})) as events,
          (select count(*)::int from ${c} where ${c.workspaceId} = ${workspaceId} and ${has(sql`${c.text}`, form.text)}) as comments`,
      )
    ).rows
    if (
      counts!.revision_texts +
        counts!.proposals +
        counts!.events +
        counts!.comments >
      0
    )
      result.push({
        form: form.form,
        text: form.text,
        revisionTexts: counts!.revision_texts,
        proposals: counts!.proposals,
        events: counts!.events,
        comments: counts!.comments,
      })
  }
  return result
}

/** Every character but ASCII letters and digits as `%XX`, byte by byte. */
function percentEncoded(text: string): string {
  return [...new TextEncoder().encode(text)]
    .map((b) =>
      /[A-Za-z0-9]/.test(String.fromCharCode(b))
        ? String.fromCharCode(b)
        : `%${b.toString(16).toUpperCase().padStart(2, "0")}`,
    )
    .join("")
}

function htmlEscaped(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
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
  match: PurgeMatcher,
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
  const cut = excerpt(match.text)
  const plain = (s: string) => match.replace(s, purgeMarker)
  // An excerpt of six characters, of a text of 18 or more.
  const findings = (s: string) =>
    cut.length > 6 ? plain(s).split(cut).join(purgeMarker) : plain(s)
  for (const row of await proposalCandidates(tx, workspaceId, match)) {
    await match.pause()
    if (!holdsJson(proposalFields(row), match)) continue
    const explanation = plain(row.explanation)
    const relatedTask = row.relatedTask === null ? null : plain(row.relatedTask)
    const operations = mapStrings(row.operations, plain) as unknown[]
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
        // A retry of the request as it was sent can no longer match it.
        idempotencyKey: null,
        requestHash: hashOf(["purged", explanation, relatedTask, operations]),
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

/** Comments on proposals that might hold the text, to check one by one. */
function commentCandidates(
  tx: Transaction,
  workspaceId: string,
  match: PurgeMatcher,
) {
  const c = schema.catalogProposalComments
  return tx
    .select({
      id: c.id,
      proposalId: c.proposalId,
      text: c.text,
      idempotencyKey: c.idempotencyKey,
    })
    .from(c)
    .where(
      and(
        eq(c.workspaceId, workspaceId),
        sql`(${mayHold(match, sql`${c.text}`)} or ${mayHold(match, sql`coalesce(${c.idempotencyKey}, '')`)})`,
      ),
    )
}

/** Whether a comment holds the text, in its text or its idempotency key. */
function commentHolds(
  row: { text: string; idempotencyKey: string | null },
  match: PurgeMatcher,
): boolean {
  return (
    match.test(row.text) ||
    (row.idempotencyKey !== null && match.test(row.idempotencyKey))
  )
}

/**
 * Rewrites the comments on proposals that hold the text, clearing their
 * idempotency keys: a retry of the comment as it was sent no longer matches.
 */
async function purgeComments(
  tx: Transaction,
  workspaceId: string,
  match: PurgeMatcher,
): Promise<{ id: string; proposalId: string }[]> {
  const purged: { id: string; proposalId: string }[] = []
  const c = schema.catalogProposalComments
  for (const row of await commentCandidates(tx, workspaceId, match)) {
    await match.pause()
    if (!commentHolds(row, match)) continue
    await tx
      .update(c)
      .set({ text: match.replace(row.text, purgeMarker), idempotencyKey: null })
      .where(eq(c.id, row.id))
    purged.push({ id: row.id, proposalId: row.proposalId })
  }
  return purged
}

/** Rewrites the summary and data of the timeline events that hold the text. */
async function purgeEvents(
  tx: Transaction,
  workspaceId: string,
  match: PurgeMatcher,
): Promise<number[]> {
  const purged: number[] = []
  const plain = (s: string) => match.replace(s, purgeMarker)
  for (const row of await eventCandidates(tx, workspaceId, match)) {
    await match.pause()
    if (!holdsJson({ summary: row.summary, data: row.data }, match)) continue
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

const vacuumLog = createLimitedLog()

/**
 * Asks PostgreSQL to clear out the rows' earlier versions, which still hold
 * the text until it does (otherwise autovacuum does, in its own time). Best
 * effort: the purge has committed whatever happens here.
 */
async function vacuumPurged(ctx: Context): Promise<void> {
  try {
    await ctx.db.execute(
      sql`vacuum (skip_locked) catalog_revision_documents, catalog_proposals, catalog_proposal_comments, events, catalog_index_documents, catalog_index_facts, catalog_index_relations, catalog_index_discrepancies, catalog_index_sections, catalog_index_provenance`,
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
 * process (catalog §9): empties the type schema cache. `watchCatalogPurges`
 * runs it every minute; the purging process does it at once.
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

/**
 * A stored proposal's request hash after a purge (M2's proposals stay in the
 * database until GC-6 moves the catalog into Git): the same form M2 used,
 * the request with every map's keys sorted.
 */
function hashOf(request: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(request)))
    .digest("base64url")
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    )
  return value
}
