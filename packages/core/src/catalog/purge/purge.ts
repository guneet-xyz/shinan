import { randomUUID } from "node:crypto"

import {
  and,
  createLimitedLog,
  databaseErrorCode,
  desc,
  eq,
  errorSummary,
  inArray,
  schema,
  sql,
} from "@shinan/db"
import type {
  CatalogPurgeCounts,
  CatalogPurgeHistoryCounts,
  SQL,
  Transaction,
} from "@shinan/db"

import { shinan } from "../../actor.js"
import { atInstallation, inWorkspace, snapshotRead } from "../../authorize.js"
import type { Context } from "../../context.js"
import {
  BusyError,
  InvalidInputError,
  NotFoundError,
  RuleViolationError,
  UnavailableError,
} from "../../errors.js"
import { appendEvent } from "../../events.js"
import { recordSecurityEntry } from "../../security-log.js"
import type {
  PurgeEncoding,
  PurgeForm,
  RepositoryPurgePreview,
  RepositoryPurgeResult,
  RepositoryPurgeStatus,
} from "../git/api.js"
import type { GitClient } from "../git/client.js"
import { GitServiceError } from "../git/client.js"
import { storeCatalogJournal } from "../git/push-log.js"
import { clearTypeSchemaCache } from "../index/indexer.js"
import { requestCatalogIndexRebuildIn } from "../index/maintain.js"
import { PurgeMatcher, spaces } from "./matcher.js"
import {
  checkPurgeText,
  encodedStrings,
  purgeForms,
  purgeLimits,
  purgeMarker,
  purgeNameMarker,
  replaceKeepingIds,
} from "./scanner.js"

/**
 * Catalog purge (catalog §9; architecture §4.4; Git-based catalog plan
 * §2.9): a workspace owner removes a text that must not survive, such as a
 * leaked secret or personal data, from everything Shinan stores for the
 * workspace's catalog. Since the catalog moved into Git (GC-8), that is a
 * rewrite of the repository's whole history in the Git container, then
 * the database's copies: branch names in the push log, timeline events,
 * the agent index (rebuilt from the new `main`) and the record of the
 * catalog's move into Git (GC-6). Every occurrence is replaced by a marker; every record
 * keeps its shape. The security log is never purged (D-049).
 */

export { purgeLimits, purgeMarker }

/**
 * Where the database stores catalog text a purge rewrites, by table and
 * column, and checks afterwards. A new table or column holding catalog
 * text belongs here, and in the full-database tests (`purge.test.ts` in
 * core and in the `git` role).
 *
 * - `catalog_push_refs.ref`, `catalog_commit_first_pushes.ref`,
 *   `catalog_rewrites.refs`: branch names, as the push log keeps them.
 * - `events`: the summary and data.
 * - `catalog_moves`: the catalog IDs the move into Git recorded (GC-6),
 *   which a purged text can be part of.
 * - The agent index: rows of documents that hold the text are dropped, and
 *   the index is rebuilt from the new `main`.
 */
export const purgeTargets = {
  pushLog: [
    "catalog_push_refs.ref",
    "catalog_commit_first_pushes.ref",
    "catalog_rewrites.refs",
  ],
  events: { text: ["summary"], json: ["data"] },
  moves: ["catalog_moves.waiting_proposals", "catalog_moves.problems"],
  index: [
    "catalog_index_documents",
    "catalog_index_facts",
    "catalog_index_relations",
    "catalog_index_discrepancies",
    "catalog_index_sections",
    "catalog_index_state.check_details",
  ],
} as const

/** Where a text is in a workspace's catalog: what removing it would change. */
export interface CatalogPurgePreview {
  /** In the repository's history; null if the workspace has no repository yet. */
  history: RepositoryPurgePreview | null
  /** Branch names in the push log. */
  pushLog: number
  /** Timeline events. */
  events: number
  /** Documents of the agent index, dropped and rebuilt from the new `main`. */
  indexDocuments: number
  /** The record of the catalog's move into Git, when its catalog IDs hold it. */
  moves: number
  /** Places found only across a line break, to look at before removing. */
  acrossLines: number
  /**
   * Places that hold it in an encoded form a purge of the text does not
   * reach, such as in a link: remove each form too (`text` is the form).
   */
  alsoWrittenAs: { form: PurgeForm; text: string; places: number }[]
  /**
   * Places that may hold it encoded (base64, every byte percent-encoded,
   * quoted-printable, UTF-16, another letter case), which a purge does not
   * remove: only the exact text is removed. Reported for the owner to have
   * them checked (review of #197).
   */
  mayAppearEncoded: { encoding: PurgeEncoding; places: number }[]
  /**
   * Rewrites of the history whose removal was not recorded: removing the
   * same text again finishes each.
   */
  unfinished: number
  /** Whether this text is that of one of them: removing it finishes it. */
  finishesUnfinished: boolean
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
  counts: CatalogPurgeCounts
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
 * Where a text is in the workspace's catalog (human experience, workspace
 * settings: Catalog), so a workspace owner sees what removing it would
 * change before anything does, and copies it would not reach. Like the
 * purge, it needs a workspace owner who signed in again recently; it
 * stores nothing. The database is read first, then the Git container,
 * outside the transaction.
 */
export async function previewCatalogPurge(
  ctx: Context,
  git: GitClient | undefined,
  workspaceId: string,
  input: { text: unknown },
): Promise<CatalogPurgePreview> {
  const found = await inWorkspace(
    ctx,
    workspaceId,
    "catalog.purge",
    async (scope) => {
      const match = new PurgeMatcher(checkPurgeText(input.text))
      const { tx } = scope
      const workspace = scope.workspaceId
      return {
        workspace,
        text: match.text,
        pushLog: (await pushLogHolding(tx, workspace, match)).count,
        events: (await eventsHolding(tx, workspace, match)).length,
        indexDocuments: (await indexHolding(tx, workspace, match)).length,
        moves: (await movesHolding(tx, workspace, match)).length,
        forms: await encodedForms(tx, workspace, match.text),
        encodings: await encodingsInEvents(tx, workspace, match.text),
        unfinished: (await unfinishedRewrites(tx, workspace)).map((r) => r.id),
      }
    },
    snapshotRead,
  )
  const client = requireGit(git)
  const history = await fromGit(() =>
    client.previewPurge(found.workspace, { text: found.text }),
  )
  const places = new Map(found.forms.map((f) => [f.form, f]))
  for (const f of history?.alsoWrittenAs ?? []) {
    const known = places.get(f.form)
    if (known) known.places += f.places
  }
  const encodings = new Map(found.encodings.map((e) => [e.encoding, e.places]))
  for (const e of history?.mayAppearEncoded ?? [])
    encodings.set(e.encoding, (encodings.get(e.encoding) ?? 0) + e.places)
  let finishes = false
  for (const purgeId of found.unfinished)
    if (
      await fromGit(() =>
        client.isPurgeText(found.workspace, { purgeId, text: found.text }),
      )
    )
      finishes = true
  return {
    history,
    pushLog: found.pushLog,
    events: found.events,
    indexDocuments: found.indexDocuments,
    moves: found.moves,
    acrossLines: history?.acrossLines ?? 0,
    alsoWrittenAs: [...places.values()].filter((f) => f.places > 0),
    mayAppearEncoded: [...encodings]
      .filter(([, places]) => places > 0)
      .map(([encoding, places]) => ({ encoding, places })),
    unfinished: found.unfinished.length,
    finishesUnfinished: finishes,
  }
}

/** Where a purge stands, as `purgeCatalogText` and `getCatalogPurgeStatus` give it. */
export interface CatalogPurgeStatus {
  id: string
  /**
   * `running`: the Git container is rewriting the history; `done`: recorded
   * (`purge`); `failed`: nothing more will happen (`message` says why);
   * `unfinished`: the history was rewritten but not recorded: removing the
   * same text again finishes it.
   */
  state: "running" | "done" | "failed" | "unfinished"
  purge?: CatalogPurge
  /** Why it failed, or what to do; never the text. */
  message?: string
  /** When it failed on a rule, such as `nothing-to-purge`: the rule. */
  rule?: string
}

/** How often a running purge is asked how it stands; tests make it shorter. */
export const purgeFollowing = { intervalMs: 2000 }

/** How long a purge's outcome is kept in this process's memory; the database keeps the rest. */
const outcomeMs = 24 * 60 * 60 * 1000

/** The purges this process follows, and their recent outcomes. */
const following = new Map<
  string,
  { workspaceId: string; status: CatalogPurgeStatus; at: number }
>()

const unfinishedMessage =
  "The text was removed from the catalog's history, but the removal was not recorded: remove the same text again to finish it"

/**
 * Removes a text from the workspace's catalog (catalog §9; architecture
 * §4.4; plan §2.9). The history's rewrite can take minutes, so it runs as
 * a job this process follows; the answer is the purge's status, `running`
 * until the job ends (`getCatalogPurgeStatus`). In steps, none inside
 * another:
 *
 * 1. Checks that the actor is a workspace owner who signed in again
 *    recently, and the text and the reason.
 * 2. Stores the Git container's journal, so every rewrite it made is
 *    known. A rewrite whose database part never ran, of this same text (by
 *    its keyed hash, `GitClient.isPurgeText`), is finished at once, under
 *    its own ID. A rewrite is never finished under another text.
 * 3. Otherwise starts the Git container's rewrite under a new purge ID and
 *    follows it. When it ends, stores the journal (the rewrite becomes a
 *    `catalog_rewrites` row, and each rewritten commit's first pusher
 *    follows) and records the purge (`recordPurge`).
 *
 * The text stays in this process's memory while it follows the job. If
 * the process stops meanwhile, the rewrite stays listed as unfinished until
 * the owner removes the same text again. Copies outside Shinan, such as
 * agents' clones, exports, backups and model providers, are not reached: a
 * purged secret must still be rotated.
 */
export async function purgeCatalogText(
  ctx: Context,
  git: GitClient | undefined,
  workspaceId: string,
  input: { text: unknown; reason: unknown },
): Promise<CatalogPurgeStatus> {
  const checked = await inWorkspace(
    ctx,
    workspaceId,
    "catalog.purge",
    (scope) => {
      const match = new PurgeMatcher(checkPurgeText(input.text))
      return Promise.resolve({
        workspace: scope.workspaceId,
        text: match.text,
        reason: purgeReason(input.reason, match),
      })
    },
    snapshotRead,
  )
  const client = requireGit(git)
  await storeCatalogJournal({ ...ctx, actor: shinan }, client).catch(() => {})

  // An earlier rewrite of this same text, never recorded: finished now.
  for (const rewrite of await unfinishedOf(ctx, checked.workspace)) {
    const same = await fromGit(() =>
      client.isPurgeText(checked.workspace, {
        purgeId: rewrite.id,
        text: checked.text,
      }),
    )
    if (!same) continue
    const purge = await recordPurge(ctx, checked, {
      id: rewrite.id,
      rewritten: true,
      history: null,
    })
    await forgetText(client, checked.workspace, purge.id)
    return { id: purge.id, state: "done", purge }
  }

  sweepFollowing()
  // One followed here is running until recorded: its record may be in the
  // database a moment before this process marks it done.
  const followed = [...following]
    .filter(
      ([, f]) =>
        f.workspaceId === checked.workspace && f.status.state === "running",
    )
    .map(([id]) => id)
  if (
    followed.length > 0 &&
    (await recordedOf(ctx, checked.workspace, followed)) < followed.length
  )
    throw busyRemoving()
  const purgeId = randomUUID()
  const started = await fromGit(() =>
    client.startPurge(checked.workspace, { purgeId, text: checked.text }),
  )
  if (!started) {
    // No repository yet: only what the database holds.
    const purge = await recordPurge(ctx, checked, {
      id: purgeId,
      rewritten: false,
      history: null,
    })
    return { id: purge.id, state: "done", purge }
  }
  const status: CatalogPurgeStatus = { id: purgeId, state: "running" }
  const entry = { workspaceId: checked.workspace, status, at: Date.now() }
  following.set(purgeId, entry)
  void follow(ctx, client, checked, purgeId, (message) => {
    // Running longer than it should: the Git container says why.
    entry.status = message
      ? { id: purgeId, state: "running", message }
      : { id: purgeId, state: "running" }
  }).then((outcome) => {
    entry.status = outcome
    entry.at = Date.now()
  })
  return status
}

/**
 * Where a purge stands: recorded, followed by this process, a rewrite not
 * recorded, or the Git container's job. Counts only, never the text;
 * workspace owners only (`catalog.purge-status`), without signing in again,
 * so a long purge can be followed to its end.
 */
export async function getCatalogPurgeStatus(
  ctx: Context,
  git: GitClient | undefined,
  workspaceId: string,
  purgeId: string,
): Promise<CatalogPurgeStatus> {
  const found = await inWorkspace(
    ctx,
    workspaceId,
    "catalog.purge-status",
    async (scope) => {
      if (!/^[0-9a-f-]{36}$/.test(purgeId)) throw new NotFoundError()
      const [row] = await scope.tx
        .select()
        .from(schema.catalogPurges)
        .where(
          and(
            eq(schema.catalogPurges.workspaceId, scope.workspaceId),
            eq(schema.catalogPurges.id, purgeId),
          ),
        )
      const unfinished = (await unfinishedRewrites(scope.tx, scope.workspaceId))
        .map((r) => r.id)
        .includes(purgeId)
      return { workspace: scope.workspaceId, row, unfinished }
    },
    snapshotRead,
  )
  if (found.row)
    return { id: purgeId, state: "done", purge: purgeOf(found.row) }
  const followed = following.get(purgeId)
  if (followed?.workspaceId === found.workspace) return followed.status
  if (found.unfinished)
    return { id: purgeId, state: "unfinished", message: unfinishedMessage }
  const job = await fromGit(() =>
    requireGit(git).purgeStatus(found.workspace, purgeId),
  )
  if (job?.state === "running") return { id: purgeId, state: "running" }
  if (job?.state === "done")
    return { id: purgeId, state: "unfinished", message: unfinishedMessage }
  throw new NotFoundError()
}

/** Follows a Git container's purge to its end, then records it. */
async function follow(
  ctx: Context,
  client: GitClient,
  checked: { workspace: string; text: string; reason: string },
  purgeId: string,
  onRunning: (message?: string) => void,
): Promise<CatalogPurgeStatus> {
  let failures = 0
  let job: RepositoryPurgeStatus
  for (;;) {
    await new Promise((resolve) =>
      setTimeout(resolve, purgeFollowing.intervalMs),
    )
    try {
      job = await client.purgeStatus(checked.workspace, purgeId)
      failures = 0
    } catch {
      // The Git container may be restarting: asked again, for a while.
      if (++failures > 60)
        return { id: purgeId, state: "unfinished", message: unfinishedMessage }
      continue
    }
    if (job.state !== "running") break
    onRunning(job.message)
  }
  if (job.state === "failed" || job.state === "unknown")
    return {
      id: purgeId,
      state: "failed",
      message:
        job.message ??
        "Shinan could not remove the text: nothing was changed; try again",
    }
  const result = job.result!
  try {
    if (result.rewritten)
      for (let attempt = 1; ; attempt++) {
        try {
          await storeCatalogJournal({ ...ctx, actor: shinan }, client)
          break
        } catch (error) {
          if (attempt >= 5) throw error
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
        }
      }
    const purge = await recordPurge(ctx, checked, {
      id: purgeId,
      rewritten: result.rewritten,
      history: result,
    })
    // Not waited for: the purge is done once recorded, and a new one may
    // start at once.
    if (result.rewritten) void forgetText(client, checked.workspace, purgeId)
    return { id: purgeId, state: "done", purge }
  } catch (error) {
    if (error instanceof RuleViolationError)
      return {
        id: purgeId,
        state: "failed",
        message: error.message,
        rule: error.rule,
      }
    return result.rewritten
      ? { id: purgeId, state: "unfinished", message: unfinishedMessage }
      : {
          id: purgeId,
          state: "failed",
          message: "Shinan could not record the removal: try again",
        }
  }
}

const forgetLog = createLimitedLog()

/**
 * Once a rewrite is recorded, the Git container drops its text's keyed
 * hash (review of #197). If it can't now, the hash stays until the same
 * text is removed again; the record is kept all the same.
 */
async function forgetText(
  client: GitClient,
  workspaceId: string,
  purgeId: string,
): Promise<void> {
  try {
    await client.forgetPurgeText(workspaceId, purgeId)
  } catch (error) {
    forgetLog(
      `Purge ${purgeId}: the Git container could not drop its text's hash: ${errorSummary(error)}`,
    )
  }
}

function sweepFollowing(): void {
  for (const [id, f] of following)
    if (f.status.state !== "running" && Date.now() - f.at > outcomeMs)
      following.delete(id)
}

function busyRemoving(): BusyError {
  return new BusyError(
    "purge-running",
    "Text is already being removed from this catalog's history: try again in a few minutes",
    60,
  )
}

/** How many of these purges are recorded. */
async function recordedOf(
  ctx: Context,
  workspaceId: string,
  ids: string[],
): Promise<number> {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.purge",
    async (scope) => {
      const p = schema.catalogPurges
      const rows = await scope.tx
        .select({ id: p.id })
        .from(p)
        .where(and(eq(p.workspaceId, scope.workspaceId), inArray(p.id, ids)))
      return rows.length
    },
    snapshotRead,
  )
}

/** The workspace's rewrites no purge record covers yet, oldest first. */
async function unfinishedOf(ctx: Context, workspaceId: string) {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.purge",
    (scope) => unfinishedRewrites(scope.tx, scope.workspaceId),
    snapshotRead,
  )
}

/**
 * The database part of a purge, in one transaction: records the purge
 * (who, when, why, never the text) under `id`, the ID of the Git
 * container's rewrite when there was one; replaces the text in branch
 * names of the push log, in events and in the record of the move into Git
 * (`purgeTargets`); drops index rows that hold it; checks that the text is
 * nowhere left in what it purges; appends a `catalog.purged` event and a
 * security-log entry with counts only; and asks for a rebuild of the index
 * from the new `main`.
 */
async function recordPurge(
  ctx: Context,
  checked: { workspace: string; text: string; reason: string },
  input: {
    id: string
    rewritten: boolean
    history: RepositoryPurgeResult | null
  },
): Promise<CatalogPurge> {
  const { history } = input
  const purge = await inWorkspace(
    ctx,
    checked.workspace,
    "catalog.purge",
    async (scope) => {
      const match = new PurgeMatcher(checked.text)
      const reason = checked.reason
      const { tx } = scope
      const workspace = scope.workspaceId
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`catalog-purge:${workspace}`}))`,
      )
      const [rewrite] = input.rewritten
        ? await tx
            .select()
            .from(schema.catalogRewrites)
            .where(
              and(
                eq(schema.catalogRewrites.workspaceId, workspace),
                eq(schema.catalogRewrites.id, input.id),
              ),
            )
        : []
      if (input.rewritten && !rewrite)
        throw new UnavailableError(unfinishedMessage)

      const p = schema.catalogPurges
      const [{ next }] = (await tx
        .select({ next: sql<number>`coalesce(max(${p.number}), 0)::int + 1` })
        .from(p)
        .where(eq(p.workspaceId, workspace))) as [{ next: number }]
      // First, so that the triggers allow this transaction's updates.
      const [row] = await tx
        .insert(p)
        .values({
          id: input.id,
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

      const pushLog = await purgePushLog(tx, workspace, match)
      // Catalog IDs the rewrite named apart from another page's are named
      // the same way here.
      const named = new Map(rewrite?.ids ?? [])
      const idName = (plain: string) => named.get(plain) ?? plain
      const events = await purgeEvents(tx, workspace, match, idName)
      const index = await dropIndexRows(tx, workspace, match)
      const moves = await purgeMoves(tx, workspace, match, idName)
      const historyCounts: CatalogPurgeHistoryCounts | undefined = rewrite
        ? rewrite.counts
        : history && history.journalEntries > 0
          ? historyOf(history)
          : undefined
      if (
        !historyCounts &&
        pushLog + events.length + index.documents + index.state + moves === 0
      )
        throw nothingToPurge()

      if (
        (await eventsHolding(tx, workspace, match)).length +
          (await movesHolding(tx, workspace, match)).length +
          (await pushLogHolding(tx, workspace, match)).count +
          (await indexHolding(tx, workspace, match)).length >
        0
      )
        throw new Error("A purge left the text in stored catalog records")

      const counts: CatalogPurgeCounts = {
        ...(historyCounts ? { history: historyCounts } : {}),
        pushLog,
        indexDocuments: index.documents,
        // M2's stores are gone (GC-6): their counts stay, at zero.
        revisionTexts: 0,
        documents: 0,
        latestDocuments: 0,
        proposals: 0,
        rejectedProposals: 0,
        events: events.length,
        comments: 0,
      }
      const [stored] = await tx
        .update(p)
        .set({ counts })
        .where(eq(p.id, purge.id))
        .returning()
      await appendEvent(scope, {
        kind: "catalog.purged",
        subjects: [{ type: "catalog-purge", id: purge.id }],
        summary: `${scope.actor.label} removed text from the catalog's history (purge ${purge.number})`,
        data: { purgeId: purge.id, number: purge.number, reason, counts },
      })
      await recordSecurityEntry(tx, {
        workspaceId: workspace,
        action: "catalog.purged",
        outcome: "succeeded",
        actor: scope.actor,
        request: scope.request,
        details: { purgeId: purge.id, number: purge.number, counts },
      })
      // The index is rebuilt from the new `main`, and drops what it held.
      if (rewrite || index.documents + index.state > 0)
        await requestCatalogIndexRebuildIn(scope, workspace)
      return purgeOf(stored!)
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

function historyOf(result: RepositoryPurgeResult): CatalogPurgeHistoryCounts {
  return {
    commits: result.commits,
    rewrittenCommits: result.rewrittenCommits,
    removedCommits: result.removedCommits,
    files: result.files,
    messages: result.messages,
    renamedBranches: result.renamedBranches,
    journalEntries: result.journalEntries,
  }
}

function purgeOf(row: typeof schema.catalogPurges.$inferSelect): CatalogPurge {
  return {
    id: row.id,
    number: row.number,
    createdAt: row.createdAt,
    purgedBy: row.actorLabel,
    reason: row.reason,
    counts: row.counts,
  }
}

function requireGit(git: GitClient | undefined): GitClient {
  if (!git)
    throw new UnavailableError(
      "The catalog's repository can't be reached right now",
    )
  return git
}

/**
 * A call to the Git container's purge, with its refusals as core's errors:
 * a workspace with no repository yet has no history (null); a push being
 * checked is busy; a text the rules refuse is invalid input.
 */
async function fromGit<T>(call: () => Promise<T>): Promise<T | null> {
  try {
    return await call()
  } catch (error) {
    if (!(error instanceof GitServiceError)) throw error
    if (error.status === 404) return null
    if (error.status === 409 && error.code === "busy")
      throw new BusyError("busy", error.message, 30)
    if (error.status === 409 && error.code === "purge-running")
      throw busyRemoving()
    if (error.status === 400 && error.code.startsWith("text"))
      throw new InvalidInputError(error.code, error.message)
    if (error.status === 422 && error.code === "purge-too-slow")
      throw new RuleViolationError(error.code, error.message)
    throw new UnavailableError(
      "The catalog's repository can't be reached right now",
      { cause: error },
    )
  }
}

/**
 * Rewrites of the workspace's history that no purge record covers yet,
 * oldest first: each stays listed until a purge of the same text finishes
 * it (review of #197).
 */
async function unfinishedRewrites(tx: Transaction, workspaceId: string) {
  const w = schema.catalogRewrites
  const p = schema.catalogPurges
  return tx
    .select()
    .from(w)
    .where(
      and(
        eq(w.workspaceId, workspaceId),
        sql`not exists (select 1 from ${p} where ${p.id} = ${w.id})`,
      ),
    )
    .orderBy(w.rewrittenAt, w.journalEntry)
}

function purgeReason(value: unknown, match: PurgeMatcher): string {
  const reason = typeof value === "string" ? value.trim() : ""
  if (reason === "")
    throw new InvalidInputError(
      "reason-blank",
      "Say why the text is removed: the reason is kept on the timeline",
    )
  if (reason.length > purgeLimits.reason)
    throw new InvalidInputError(
      "reason-too-long",
      `The reason is longer than ${purgeLimits.reason} characters`,
    )
  if (match.test(reason))
    throw new InvalidInputError(
      "reason-holds-text",
      "The reason must not repeat the text: the reason is kept",
    )
  return reason
}

function nothingToPurge(): RuleViolationError {
  return new RuleViolationError(
    "nothing-to-purge",
    "Nothing Shinan stores for this workspace's catalog holds this text",
  )
}

/** A branch name with the text replaced, as the Git container renames branches. */
function purgedRef(ref: string, match: PurgeMatcher): string {
  return match.test(ref) ? match.replace(ref, purgeNameMarker) : ref
}

/** Branch names of the push log that hold the text: how many places, and the rows. */
async function pushLogHolding(
  tx: Transaction,
  workspaceId: string,
  match: PurgeMatcher,
) {
  const r = schema.catalogPushRefs
  const s = schema.catalogPushes
  const f = schema.catalogCommitFirstPushes
  const w = schema.catalogRewrites
  const pushRefs = (
    await tx
      .select({ pushId: r.pushId, position: r.position, ref: r.ref })
      .from(r)
      .innerJoin(s, eq(s.id, r.pushId))
      .where(and(eq(s.workspaceId, workspaceId), mayHold(match, sql`${r.ref}`)))
  ).filter((row) => match.test(row.ref))
  const firstPushes = (
    await tx
      .select({ commit: f.commit, ref: f.ref })
      .from(f)
      .where(
        and(
          eq(f.workspaceId, workspaceId),
          mayHold(match, sql`coalesce(${f.ref}, '')`),
        ),
      )
  ).filter((row) => row.ref !== null && match.test(row.ref))
  const rewrites = (
    await tx
      .select({ id: w.id, refs: w.refs })
      .from(w)
      .where(
        and(
          eq(w.workspaceId, workspaceId),
          mayHold(match, sql`${w.refs}::text`, true),
        ),
      )
  ).filter((row) => row.refs.some((x) => match.test(x.ref)))
  return {
    count: pushRefs.length + firstPushes.length + rewrites.length,
    pushRefs,
    firstPushes,
    rewrites,
  }
}

/** Replaces the text in the push log's branch names; returns how many rows changed. */
async function purgePushLog(
  tx: Transaction,
  workspaceId: string,
  match: PurgeMatcher,
): Promise<number> {
  const found = await pushLogHolding(tx, workspaceId, match)
  for (const row of found.pushRefs)
    await tx
      .update(schema.catalogPushRefs)
      .set({ ref: purgedRef(row.ref, match) })
      .where(
        and(
          eq(schema.catalogPushRefs.pushId, row.pushId),
          eq(schema.catalogPushRefs.position, row.position),
        ),
      )
  for (const row of found.firstPushes)
    await tx
      .update(schema.catalogCommitFirstPushes)
      .set({ ref: purgedRef(row.ref!, match) })
      .where(
        and(
          eq(schema.catalogCommitFirstPushes.workspaceId, workspaceId),
          eq(schema.catalogCommitFirstPushes.commit, row.commit),
        ),
      )
  for (const row of found.rewrites)
    await tx
      .update(schema.catalogRewrites)
      .set({
        refs: row.refs.map((x) => ({ ...x, ref: purgedRef(x.ref, match) })),
      })
      .where(eq(schema.catalogRewrites.id, row.id))
  return found.count
}

/**
 * Index documents (by path) whose rows, or their facts, relations,
 * discrepancies or sections, hold the text; and whether the index state's
 * last check holds it.
 */
async function indexHolding(
  tx: Transaction,
  workspaceId: string,
  match: PurgeMatcher,
): Promise<string[]> {
  const paths = new Set<string>()
  for (const table of [
    schema.catalogIndexDocuments,
    schema.catalogIndexFacts,
    schema.catalogIndexRelations,
    schema.catalogIndexDiscrepancies,
    schema.catalogIndexSections,
  ]) {
    const rows = await tx.execute<{ path: string; row: unknown }>(
      sql`select t.path, to_jsonb(t) - 'search' - 'search_simple' as row from ${table} t where t.workspace_id = ${workspaceId} and ${mayHold(match, sql`(to_jsonb(t) - 'search' - 'search_simple')::text`, true)}`,
    )
    for (const row of rows.rows) {
      await match.pause()
      if (holdsJson(row.row, match)) paths.add(row.path)
    }
  }
  return [...paths].sort()
}

/**
 * Drops the index rows that hold the text (a document's rows go with it),
 * and the index state's last check if it holds it: the rebuild from the
 * new `main` makes them again without it.
 */
async function dropIndexRows(
  tx: Transaction,
  workspaceId: string,
  match: PurgeMatcher,
): Promise<{ documents: number; state: number }> {
  const paths = await indexHolding(tx, workspaceId, match)
  const d = schema.catalogIndexDocuments
  for (let i = 0; i < paths.length; i += 500)
    await tx
      .delete(d)
      .where(
        and(
          eq(d.workspaceId, workspaceId),
          inArray(d.path, paths.slice(i, i + 500)),
        ),
      )
  const s = schema.catalogIndexState
  const [state] = await tx
    .select({ details: s.checkDetails })
    .from(s)
    .where(eq(s.workspaceId, workspaceId))
  let cleared = 0
  if (state?.details && holdsJson(state.details, match)) {
    await tx
      .update(s)
      .set({ checkDetails: null })
      .where(eq(s.workspaceId, workspaceId))
    cleared = 1
  }
  return { documents: paths.length, state: cleared }
}

/** The rows `keep` keeps, giving the event loop back between rows (#149). */
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

/**
 * The text written in encoded forms a purge does not reach, and how many
 * of the workspace's events hold each. Searched as written, and
 * percent-encoding in either case (`purgeForms`); the Git container counts
 * the history's.
 */
async function encodedForms(
  tx: Transaction,
  workspaceId: string,
  text: string,
): Promise<{ form: PurgeForm; text: string; places: number }[]> {
  const result: { form: PurgeForm; text: string; places: number }[] = []
  for (const form of purgeForms(text)) {
    const has = (column: SQL, value: string) =>
      form.anyCase
        ? sql`strpos(lower(${column}), ${value.toLowerCase()}) > 0`
        : sql`strpos(${column}, ${value}) > 0`
    const e = schema.events
    const [counts] = (
      await tx.execute<{ places: number }>(
        sql`select count(*)::int as places from ${e} where ${e.workspaceId} = ${workspaceId} and (${has(sql`${e.summary}`, form.text)} or ${has(sql`${e.data}::text`, inJson(form.text))})`,
      )
    ).rows
    result.push({ form: form.form, text: form.text, places: counts!.places })
  }
  return result
}

/**
 * How many of the workspace's events may hold the text encoded: as
 * base64, with every byte percent-encoded, or in another letter case.
 */
async function encodingsInEvents(
  tx: Transaction,
  workspaceId: string,
  text: string,
): Promise<{ encoding: PurgeEncoding; places: number }[]> {
  const e = schema.events
  const value = sql`(${e.summary} || ' ' || ${e.data}::text)`
  const result: { encoding: PurgeEncoding; places: number }[] = []
  for (const { encoding, strings, anyCase } of encodedStrings(text)) {
    if (strings.length === 0) continue
    const any = sql.join(
      strings.map((s) =>
        anyCase
          ? sql`strpos(lower(${value}), ${s.toLowerCase()}) > 0`
          : sql`strpos(${value}, ${s}) > 0`,
      ),
      sql` or `,
    )
    const exact =
      encoding === "other-case"
        ? sql` and strpos(${value}, ${text}) = 0`
        : sql``
    const [row] = (
      await tx.execute<{ places: number }>(
        sql`select count(*)::int as places from ${e} where ${e.workspaceId} = ${workspaceId} and (${any})${exact}`,
      )
    ).rows
    result.push({ encoding, places: row!.places })
  }
  return result
}

/** The workspace's events that hold the text. */
async function eventsHolding(
  tx: Transaction,
  workspaceId: string,
  match: PurgeMatcher,
): Promise<number[]> {
  return (
    await kept(match, await eventCandidates(tx, workspaceId, match), (row) =>
      holdsJson({ summary: row.summary, data: row.data }, match),
    )
  ).map((row) => row.id)
}

/** The workspace's record of its move into Git, if its catalog IDs hold the text. */
async function movesHolding(
  tx: Transaction,
  workspaceId: string,
  match: PurgeMatcher,
) {
  const m = schema.catalogMoves
  const rows = await tx
    .select({
      workspaceId: m.workspaceId,
      waitingProposals: m.waitingProposals,
      problems: m.problems,
    })
    .from(m)
    .where(
      and(
        eq(m.workspaceId, workspaceId),
        sql`(${mayHold(match, sql`${m.waitingProposals}::text`, true)} or ${mayHold(match, sql`${m.problems}::text`, true)})`,
      ),
    )
  return kept(match, rows, (row) =>
    holdsJson([row.waitingProposals, row.problems], match),
  )
}

/** Replaces the text in the record of the move into Git; how many rows changed. */
async function purgeMoves(
  tx: Transaction,
  workspaceId: string,
  match: PurgeMatcher,
  idName?: (plain: string) => string,
): Promise<number> {
  const plain = (s: string) => replaceKeepingIds(match, s, purgeMarker, idName)
  const rows = await movesHolding(tx, workspaceId, match)
  for (const row of rows)
    await tx
      .update(schema.catalogMoves)
      .set({
        waitingProposals: mapStrings(
          row.waitingProposals,
          plain,
        ) as typeof row.waitingProposals,
        problems: mapStrings(row.problems, plain) as typeof row.problems,
      })
      .where(eq(schema.catalogMoves.workspaceId, row.workspaceId))
  return rows.length
}

/** Rewrites the summary and data of the timeline events that hold the text. */
async function purgeEvents(
  tx: Transaction,
  workspaceId: string,
  match: PurgeMatcher,
  idName?: (plain: string) => string,
): Promise<number[]> {
  const purged: number[] = []
  const plain = (s: string) => replaceKeepingIds(match, s, purgeMarker, idName)
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
      sql`vacuum (skip_locked) catalog_push_refs, catalog_commit_first_pushes, catalog_rewrites, events, catalog_moves, catalog_index_documents, catalog_index_facts, catalog_index_relations, catalog_index_discrepancies, catalog_index_sections, catalog_index_state`,
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
