import {
  and,
  createLimitedLog,
  databaseErrorCode,
  desc,
  eq,
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
import { clearTypeSchemaCache } from "../index/indexer.js"
import { PurgeMatcher, spaces } from "./matcher.js"

/**
 * Catalog purge (catalog §9; architecture §4.4): a workspace owner removes
 * a text that must not survive, such as a leaked secret or personal data,
 * from what the workspace stores. Every occurrence is replaced by a
 * marker, and every record keeps its shape: its time, kind, actor and
 * subjects.
 *
 * **Between GC-6 and GC-8:** M2's stores of catalog text (revisions,
 * proposals and their comments) are gone with the move into Git (GC-6),
 * so what this purges in PostgreSQL is the timeline's events. The
 * catalog's text is in the workspace's Git repository, which GC-8 purges by
 * rewriting its history (plan §2.9), here, with the push log's ref names,
 * after which the agent index is rebuilt from the new `main`
 * (`requestCatalogIndexRebuilds`). Until then a purge does not reach the
 * repository or the index built from it. The preview's and the counts'
 * fields for M2's stores stay, at zero, so the API and the screen keep
 * their shape for purges made before.
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
 * Where the workspace stores text a purge rewrites, by table and column,
 * and checks afterwards (catalog §9). A new table or column holding
 * catalog text belongs here.
 *
 * - `events`: the summary and data.
 */
export const purgeTargets = {
  events: { text: ["summary"], json: ["data"] },
} as const

/** Where a text is in a workspace's records. */
export interface CatalogPurgePreview {
  /** M2's stored document texts: gone with the move into Git, so 0. */
  revisionTexts: number
  /** 0, as `revisionTexts`. */
  documents: number
  /** None: the catalog's current text is in Git (GC-8 purges it there). */
  latestDocuments: string[]
  /** M2's catalog proposals: gone, so 0. */
  proposals: number
  waitingProposals: number
  /** Timeline events that hold it. */
  events: number
  /** Comments on M2's catalog proposals: gone, so 0. */
  comments: number
  /**
   * Where it is found only across a line break (wrapped text, or a long
   * word split by an editor), to look at before purging.
   */
  acrossLines: { revisionTexts: number; latestDocuments: string[] }
  /**
   * Places that hold it in an encoded form the purge does not reach, such
   * as in a link: purge each form too (`text` is the form to purge).
   */
  alsoWrittenAs: EncodedForm[]
  /** Where purging would change a document's structure: none until GC-8. */
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
  /** The M2 catalog revision that stored the cleaned latest text, for purges made before v0.4.0; otherwise null. */
  revision: number | null
  counts: CatalogPurgeCounts
  /** Documents that read with new problems after the purge: none until GC-8. */
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
 * Where a text is in the workspace's records, so a workspace owner sees
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
      const events = await holding(scope.tx, scope.workspaceId, match)
      return {
        revisionTexts: 0,
        documents: 0,
        latestDocuments: [],
        proposals: 0,
        waitingProposals: 0,
        events: events.length,
        comments: 0,
        acrossLines: { revisionTexts: 0, latestDocuments: [] },
        alsoWrittenAs: await encodedForms(
          scope.tx,
          scope.workspaceId,
          match.text,
        ),
        structure: [],
      }
    },
    snapshotRead,
  )
}

/**
 * Purges a text from the workspace's records (catalog §9; architecture
 * §4.4), in one transaction:
 *
 * 1. records the purge: who, when and why, never the text;
 * 2. replaces every occurrence (`PurgeMatcher`) with `purgeMarker` in the
 *    timeline's events (`purgeTargets`);
 * 3. checks that the text is nowhere left in what it purges;
 * 4. appends a `catalog.purged` event and a security-log entry. The
 *    security log itself is never purged (D-049).
 *
 * Here GC-8 rewrites the repository's history (plan §2.9). Afterwards this
 * process forgets text it had parsed; other processes do within a minute
 * (`watchCatalogPurges`). Copies outside Shinan, such as exports, backups
 * and agents' clones and model providers, are not reached: a purged secret
 * must still be rotated at its source.
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

      const p = schema.catalogPurges
      const [{ next }] = (await tx
        .select({ next: sql<number>`coalesce(max(${p.number}), 0)::int + 1` })
        .from(p)
        .where(eq(p.workspaceId, workspace))) as [{ next: number }]
      // First, so that the trigger on events allows this transaction's
      // updates.
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

      const events = await purgeEvents(tx, workspace, match)
      // GC-8: the rewrite of the repository's history goes here.
      if (events.length === 0) throw nothingToPurge()
      if ((await holding(tx, workspace, match)).length > 0)
        throw new Error("A purge left the text in stored records")

      const counts: CatalogPurgeCounts = {
        ...emptyCounts,
        events: events.length,
      }
      const [stored] = await tx
        .update(p)
        .set({ counts })
        .where(eq(p.id, purge.id))
        .returning()
      await appendEvent(scope, {
        kind: "catalog.purged",
        subjects: [{ type: "catalog-purge", id: purge.id }],
        summary: `${scope.actor.label} purged text from the catalog (purge ${purge.number}): ${describe(counts)}`,
        data: {
          purgeId: purge.id,
          number: purge.number,
          reason,
          revision: null,
          counts,
        },
      })
      await recordSecurityEntry(tx, {
        workspaceId: workspace,
        action: "catalog.purged",
        outcome: "succeeded",
        actor: scope.actor,
        request: scope.request,
        details: {
          purgeId: purge.id,
          number: purge.number,
          revision: null,
          counts,
        },
      })
      return { ...purgeOf(stored!), newProblems: [] }
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
      const rows = await scope.tx
        .select()
        .from(p)
        .where(eq(p.workspaceId, scope.workspaceId))
        .orderBy(desc(p.number))
      return rows.map(purgeOf)
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

function purgeOf(row: typeof schema.catalogPurges.$inferSelect): CatalogPurge {
  return {
    id: row.id,
    number: row.number,
    createdAt: row.createdAt,
    purgedBy: row.actorLabel,
    reason: row.reason,
    // M2's purges stored their revision; it went with M2's tables, and
    // only the counts say what they changed.
    revision: null,
    counts: row.counts,
  }
}

function describe(counts: CatalogPurgeCounts): string {
  return plural(counts.events, "timeline event")
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
    "No timeline event of this workspace holds this text",
  )
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

/** The events that hold the text now: what a purge would change, or what one left. */
async function holding(
  tx: Transaction,
  workspaceId: string,
  match: PurgeMatcher,
): Promise<number[]> {
  const found: number[] = []
  for (const row of await eventCandidates(tx, workspaceId, match)) {
    // Gives the event loop back between rows (#149).
    await match.pause()
    if (holdsJson({ summary: row.summary, data: row.data }, match))
      found.push(row.id)
  }
  return found
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
    const e = schema.events
    const [counts] = (
      await tx.execute<{ events: number }>(
        sql`select count(*)::int as events from ${e} where ${e.workspaceId} = ${workspaceId} and (${has(sql`${e.summary}`, form.text)} or ${has(sql`${e.data}::text`, inJson(form.text))})`,
      )
    ).rows
    if (counts!.events > 0)
      result.push({
        form: form.form,
        text: form.text,
        revisionTexts: 0,
        proposals: 0,
        events: counts!.events,
        comments: 0,
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
    await ctx.db.execute(sql`vacuum (skip_locked) events`)
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
