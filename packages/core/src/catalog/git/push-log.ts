import { and, databaseErrorCode, desc, eq, schema, sql } from "@shinan/db"
import type { CatalogPurgeHistoryCounts, Transaction } from "@shinan/db"

import type { ResolvedActor } from "../../actor.js"
import { atInstallation, shinanInWorkspace } from "../../authorize.js"
import type { Context, InstallationScope } from "../../context.js"
import { appendEvent } from "../../events.js"
import { recordSecurityEntry } from "../../security-log.js"
import { recordCatalogMain } from "../index/maintain.js"
import type { JournalEntry } from "./api.js"
import type { GitClient } from "./client.js"
import { pushLimits } from "./push-codes.js"

/**
 * The push log (Git-based catalog plan §2.6): `web` and the worker copy
 * what the Git container appended to its journal into PostgreSQL, then
 * acknowledge it. Writing is idempotent by entry number, per journal, so an
 * entry read twice is stored once. The journal's entries, as the Git
 * container writes them:
 *
 * - `push.checked`: a push's verdict, with the context `web` sent and its
 *   refs; one row of `catalog_pushes` and its `catalog_push_refs`.
 * - `push.confirmed`: the refs Git updated and the commits they first
 *   brought; the refs are confirmed, the commits' first pushes stored, and
 *   an update of `main` becomes a `catalog.pushed` event and moves the
 *   index (`recordCatalogMain`).
 * - `repository.created`: a repository's first commit, first pushed by
 *   Shinan.
 * - `repository.rewritten` and `repository.purged`: a purge's rewrite of
 *   the history (plan §2.9, GC-8). The first gives rewritten commits, each
 *   stored with the first pusher of the commit it replaces (D-066); the
 *   second the branches after it, stored as a `catalog_rewrites` row,
 *   which the check of the log against Git starts from, and moves the
 *   index to the new `main`.
 */

/** A ref of a push, as the journal lists it. */
export interface JournalPushRef {
  ref: string
  old: string | null
  new: string | null
  kind: "create" | "update" | "forced-update" | "delete"
}

export interface PushCheckedData {
  push: string
  workspaceId: string
  agent: { id: string; handle: string }
  person: { id: string; handle: string }
  memberId: string
  tokenId?: string
  networkAddress?: string
  by: string
  outcome: "accepted" | "refused" | "check-only"
  codes: string[]
  warnings: number
  /** Secrets found (refused or warned), counted; never the values. */
  secrets: number
  refs: JournalPushRef[]
  receivedBytes: number
  receivedObjects: number
  newCommits: number
}

export interface PushConfirmedData {
  push: string
  workspaceId: string
  /** Positions (in `push.checked`'s `refs`) of the refs Git updated. */
  confirmed: number[]
  /** The commits the push first brought, each with the first ref that carried it. */
  firstPushes: { commit: string; ref: string }[]
  /** The update of `main`, if Git applied one. */
  main: {
    from: string
    to: string
    commits: number
    /**
     * The commits the update made reachable from `main`, when there were at
     * most the checks' limit (`pushLimits.mainCommits`); absent from
     * entries written before GC-7 recorded them.
     */
    added?: string[]
    /** IDs of the catalog documents it changed, at most 1,000. */
    documents: string[]
    documentsTruncated: boolean
  } | null
}

export interface RepositoryCreatedData {
  workspaceId: string
  commit: string
}

export interface RepositoryRewrittenData {
  workspaceId: string
  /** The purge's ID. */
  purge: string
  /** Rewritten commits, the commits they replace, and their first ref, already purged. */
  commits: { commit: string; replaces: string; ref: string | null }[]
}

export interface RepositoryPurgedData {
  workspaceId: string
  purge: string
  refs: { ref: string; commit: string }[]
  counts: CatalogPurgeHistoryCounts
}

const objectId = /^([0-9a-f]{40}|[0-9a-f]{64})$/
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** How many entries are read from the journal at a time. */
const page = 200

/**
 * Stores the Git container's journal entries not stored yet, and
 * acknowledges them, until none are left. Each entry is stored in a
 * transaction of its own, so one that cannot be stored never holds back
 * the entries after it: an entry about a workspace PostgreSQL does not
 * have (a repository restored from a backup, or made through the Git
 * API alone), or one that can never be stored as it is, is set aside
 * instead: recorded once in the security log (`catalog.journal-set-aside`,
 * its number, kind, workspace and reason), counted in `setAside` for the
 * caller to report, and acknowledged. Only an entry of a kind this release
 * does not know, or a failure of the database, stops the run, to be tried
 * again. Safe to run from several processes at once: each journal's row
 * is locked while an entry is stored.
 */
export async function storeCatalogJournal(
  ctx: Context,
  git: GitClient,
): Promise<{ stored: number; setAside: number }> {
  let stored = 0
  let setAside = 0
  for (;;) {
    const probe = await git.readJournal({ after: 0, limit: 1 })
    const journalId = probe.journalId
    const after = await lastStored(ctx, journalId)
    const { entries } =
      probe.entries.length === 0
        ? { entries: [] as JournalEntry[] }
        : await git.readJournal({ after, limit: page })
    // What is stored already is acknowledged even if this run stores
    // nothing: another process may have stored it and stopped.
    let through = after
    for (const entry of entries) {
      const result = await storeOne(ctx, journalId, entry)
      if (result.outcome === "stored") stored++
      if (result.outcome === "set-aside") setAside++
      through = result.last
    }
    if (through > 0) await git.acknowledgeJournal({ journalId, through })
    if (entries.length < page) return { stored, setAside }
  }
}

/** The one line a run that set entries aside writes to its log. */
export function setAsideMessage(count: number): string {
  return `${count} Git journal ${count === 1 ? "entry" : "entries"} could not be stored and ${count === 1 ? "was" : "were"} set aside; see the security log (catalog.journal-set-aside)`
}

/** An entry that can never be stored as it is: storing it again would fail again. */
class UnstorableEntryError extends Error {
  override name = "UnstorableEntryError"
}

/**
 * Database errors no retry can mend: a row referring to one PostgreSQL
 * does not have, a missing value, or a value of the wrong form.
 */
const unstorableCodes = new Set(["23503", "23502", "23514", "22P02"])

/**
 * Stores one entry, or sets it aside, in its own transaction; an entry
 * stored already (by another process) is passed over. Returns the
 * journal's last stored entry after it.
 */
async function storeOne(
  ctx: Context,
  journalId: string,
  entry: JournalEntry,
): Promise<{ outcome: "stored" | "set-aside" | "passed"; last: number }> {
  const record = <T>(work: (scope: RecordScope) => Promise<T>) =>
    atInstallation({ ...ctx, origin: "git_push" }, "catalog-push.record", work)
  const workspaceId = (entry.data as { workspaceId?: unknown } | null)
    ?.workspaceId
  try {
    return await record(async (scope) => {
      const last = await lockJournal(scope, journalId)
      if (entry.number <= last) return { outcome: "passed" as const, last }
      if (
        typeof workspaceId === "string" &&
        uuid.test(workspaceId) &&
        !(await workspaceExists(scope.tx, workspaceId))
      ) {
        await setEntryAside(scope, journalId, entry, "workspace-unknown")
        await advance(scope, journalId, entry.number)
        return { outcome: "set-aside" as const, last: entry.number }
      }
      await storeEntry(scope, journalId, entry)
      await advance(scope, journalId, entry.number)
      return { outcome: "stored" as const, last: entry.number }
    })
  } catch (error) {
    const code = databaseErrorCode(error)
    if (!(error instanceof UnstorableEntryError) && !unstorableCodes.has(code))
      throw error
    return record(async (scope) => {
      const last = await lockJournal(scope, journalId)
      if (entry.number <= last) return { outcome: "passed" as const, last }
      await setEntryAside(
        scope,
        journalId,
        entry,
        error instanceof UnstorableEntryError ? "invalid" : `database-${code}`,
      )
      await advance(scope, journalId, entry.number)
      return { outcome: "set-aside" as const, last: entry.number }
    })
  }
}

/** Locks the journal's row, made if new, and returns its last stored entry. */
async function lockJournal(
  scope: RecordScope,
  journalId: string,
): Promise<number> {
  await scope.tx
    .insert(schema.catalogJournals)
    .values({ journalId })
    .onConflictDoNothing()
  const [state] = await scope.tx
    .select()
    .from(schema.catalogJournals)
    .where(eq(schema.catalogJournals.journalId, journalId))
    .for("update")
  return state!.lastStored
}

async function advance(
  scope: RecordScope,
  journalId: string,
  through: number,
): Promise<void> {
  await scope.tx
    .update(schema.catalogJournals)
    .set({ lastStored: through, updatedAt: sql`now()` })
    .where(eq(schema.catalogJournals.journalId, journalId))
}

async function workspaceExists(
  tx: Transaction,
  workspaceId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
  return row !== undefined
}

/**
 * Records an entry set aside, at the installation's level (its workspace
 * may not exist): what it was and why, never its data.
 */
async function setEntryAside(
  scope: RecordScope,
  journalId: string,
  entry: JournalEntry,
  reason: string,
): Promise<void> {
  const workspaceId = (entry.data as { workspaceId?: unknown } | null)
    ?.workspaceId
  await recordSecurityEntry(scope.tx, {
    workspaceId: null,
    action: "catalog.journal-set-aside",
    outcome: "failed",
    actor: scope.actor,
    request: {},
    details: {
      journalId,
      entry: entry.number,
      kind: /^[a-z.-]{1,40}$/.test(entry.kind) ? entry.kind : "unknown",
      workspaceId:
        typeof workspaceId === "string" && uuid.test(workspaceId)
          ? workspaceId
          : null,
      reason,
    },
  })
}

async function lastStored(ctx: Context, journalId: string): Promise<number> {
  const [row] = await ctx.db
    .select({ lastStored: schema.catalogJournals.lastStored })
    .from(schema.catalogJournals)
    .where(eq(schema.catalogJournals.journalId, journalId))
  return row?.lastStored ?? 0
}

type RecordScope = InstallationScope<"catalog-push.record">

async function storeEntry(
  scope: RecordScope,
  journalId: string,
  entry: JournalEntry,
): Promise<void> {
  switch (entry.kind) {
    case "push.checked":
      return storeChecked(scope, journalId, entry, entry.data as never)
    case "push.confirmed":
      return storeConfirmed(scope, entry, entry.data as never)
    case "repository.created":
      return storeCreated(scope, entry, entry.data as never)
    case "repository.rewritten":
      return storeRewritten(scope, entry, entry.data as never)
    case "repository.purged":
      return storePurged(scope, journalId, entry, entry.data as never)
    default:
      // A kind this release does not know: a newer Git container's. It is
      // not stored, so it must not be acknowledged either.
      throw new Error(
        `Journal entry ${entry.number} is of an unknown kind; upgrade web and the worker`,
      )
  }
}

function check(condition: boolean, entry: JournalEntry, what: string) {
  if (!condition) {
    throw new UnstorableEntryError(
      `Journal entry ${entry.number} has no valid ${what}`,
    )
  }
}

/** The pusher, as the security log and events name actors. */
function pusher(data: PushCheckedData): ResolvedActor {
  return {
    kind: "agent",
    personId: data.person.id,
    agentId: data.agent.id,
    agentSessionId: null,
    label: data.by,
    confidence: "recorded",
    member: null,
    operator: false,
  }
}

async function storeChecked(
  scope: RecordScope,
  journalId: string,
  entry: JournalEntry,
  data: PushCheckedData,
): Promise<void> {
  check(uuid.test(data.push ?? ""), entry, "push ID")
  check(uuid.test(data.workspaceId ?? ""), entry, "workspace")
  check(Array.isArray(data.refs), entry, "refs")
  const [inserted] = await scope.tx
    .insert(schema.catalogPushes)
    .values({
      id: data.push,
      workspaceId: data.workspaceId,
      journalId,
      journalEntry: entry.number,
      pushedAt: new Date(entry.recordedAt),
      agentId: data.agent.id,
      tokenId: data.tokenId ?? null,
      memberId: data.memberId,
      personId: data.person.id,
      byLabel: data.by,
      networkAddress: data.networkAddress ?? null,
      outcome: data.outcome,
      codes: [...new Set(data.codes)].sort(),
      warnings: data.warnings,
      receivedBytes: data.receivedBytes,
      receivedObjects: data.receivedObjects,
      newCommits: data.newCommits,
    })
    .onConflictDoNothing()
    .returning({ id: schema.catalogPushes.id })
  if (!inserted) return
  if (data.refs.length > 0) {
    await scope.tx.insert(schema.catalogPushRefs).values(
      data.refs.map((r, position) => ({
        pushId: data.push,
        position,
        ref: r.ref,
        oldCommit: r.old,
        newCommit: r.new,
        kind: r.kind,
      })),
    )
  }
  // Refusals that point at a leak reach the security log (plan §2.14):
  // codes and counts, never text.
  if (data.outcome !== "accepted" && data.secrets > 0) {
    await recordSecurityEntry(scope.tx, {
      workspaceId: data.workspaceId,
      action: "catalog.push-refused",
      outcome: "refused",
      actor: pusher(data),
      request: { networkAddress: data.networkAddress },
      details: {
        push: data.push,
        agentId: data.agent.id,
        codes: [...new Set(data.codes)].sort(),
        secrets: data.secrets,
      },
    })
  }
}

async function storeConfirmed(
  scope: RecordScope,
  entry: JournalEntry,
  data: PushConfirmedData,
): Promise<void> {
  const [push] = await scope.tx
    .select()
    .from(schema.catalogPushes)
    .where(eq(schema.catalogPushes.id, data.push))
  // Its `push.checked` entry comes first in the same journal.
  check(push !== undefined, entry, "push (its push.checked entry is missing)")
  for (const position of data.confirmed) {
    await scope.tx
      .update(schema.catalogPushRefs)
      .set({ confirmed: true })
      .where(
        and(
          eq(schema.catalogPushRefs.pushId, data.push),
          eq(schema.catalogPushRefs.position, position),
          eq(schema.catalogPushRefs.confirmed, false),
        ),
      )
  }
  for (const first of data.firstPushes) {
    check(objectId.test(first.commit), entry, "commit")
    await scope.tx
      .insert(schema.catalogCommitFirstPushes)
      .values({
        workspaceId: push!.workspaceId,
        commit: first.commit,
        pushId: push!.id,
        ref: first.ref,
        firstPushedAt: push!.pushedAt,
        pusherKind: "agent",
        agentId: push!.agentId,
        personId: push!.personId,
        byLabel: push!.byLabel,
      })
      .onConflictDoNothing()
  }
  if (data.main) {
    check(
      objectId.test(data.main.from) && objectId.test(data.main.to),
      entry,
      "update of main",
    )
    // When each commit reached `main`: the commits this update made
    // reachable (and `main`'s new commit, always), at the time Shinan
    // recorded the update; a commit's first arrival is kept.
    const added = data.main.added ?? []
    check(
      Array.isArray(added) &&
        added.length <= pushLimits.mainCommits &&
        added.every((c) => objectId.test(c)),
      entry,
      "commits added to main",
    )
    const arrived = [...new Set([data.main.to, ...added])]
    await scope.tx
      .insert(schema.catalogMainArrivals)
      .values(
        arrived.map((commit) => ({
          workspaceId: push!.workspaceId,
          commit,
          pushId: push!.id,
          reachedMainAt: new Date(entry.recordedAt),
        })),
      )
      .onConflictDoNothing()
    const workspace = shinanInWorkspace(scope, push!.workspaceId)
    await appendEvent(workspace, {
      kind: "catalog.pushed",
      summary: `${push!.byLabel} pushed ${data.main.commits} ${data.main.commits === 1 ? "commit" : "commits"} to the catalog`,
      data: {
        push: push!.id,
        from: data.main.from,
        to: data.main.to,
        commits: data.main.commits,
        documents: data.main.documents,
        documentsTruncated: data.main.documentsTruncated,
      },
      idempotencyKey: `catalog.pushed:${push!.id}`,
      credit: {
        kind: "agent",
        personId: push!.personId,
        agentId: push!.agentId,
        agentSessionId: null,
        label: push!.byLabel,
        confidence: "recorded",
      },
    })
    await recordCatalogMain({
      tx: scope.tx,
      jobs: scope.jobs,
      workspaceId: push!.workspaceId,
      commit: data.main.to,
    })
  }
}

async function storeCreated(
  scope: RecordScope,
  entry: JournalEntry,
  data: RepositoryCreatedData,
): Promise<void> {
  check(uuid.test(data.workspaceId ?? ""), entry, "workspace")
  check(objectId.test(data.commit ?? ""), entry, "commit")
  await scope.tx
    .insert(schema.catalogCommitFirstPushes)
    .values({
      workspaceId: data.workspaceId,
      commit: data.commit,
      firstPushedAt: new Date(entry.recordedAt),
      pusherKind: "shinan",
      byLabel: "shinan",
    })
    .onConflictDoNothing()
  // The first commit is on `main` from the start.
  await scope.tx
    .insert(schema.catalogMainArrivals)
    .values({
      workspaceId: data.workspaceId,
      commit: data.commit,
      pushId: null,
      reachedMainAt: new Date(entry.recordedAt),
    })
    .onConflictDoNothing()
}

async function storeRewritten(
  scope: RecordScope,
  entry: JournalEntry,
  data: RepositoryRewrittenData,
): Promise<void> {
  check(uuid.test(data.workspaceId ?? ""), entry, "workspace")
  check(Array.isArray(data.commits), entry, "commits")
  for (const c of data.commits)
    check(
      objectId.test(c.commit) && objectId.test(c.replaces),
      entry,
      "rewritten commit",
    )
  if (data.commits.length === 0) return
  const f = schema.catalogCommitFirstPushes
  // Each inherits the first pusher of the commit it replaces; one Shinan
  // never recorded is Shinan's, as the Git container records it.
  await scope.tx.execute(sql`
    insert into ${f} (workspace_id, commit, push_id, ref, first_pushed_at, pusher_kind, agent_id, person_id, by_label, replaces_commit)
    select ${data.workspaceId}::uuid, v.commit, o.push_id, v.ref,
      coalesce(o.first_pushed_at, ${new Date(entry.recordedAt)}::timestamptz),
      coalesce(o.pusher_kind, 'shinan'), o.agent_id, o.person_id,
      coalesce(o.by_label, 'shinan'), v.replaces
    from jsonb_to_recordset(${JSON.stringify(data.commits)}::jsonb) as v(commit text, replaces text, ref text)
    left join ${f} o on o.workspace_id = ${data.workspaceId}::uuid and o.commit = v.replaces
    on conflict do nothing`)
}

async function storePurged(
  scope: RecordScope,
  journalId: string,
  entry: JournalEntry,
  data: RepositoryPurgedData,
): Promise<void> {
  check(uuid.test(data.workspaceId ?? ""), entry, "workspace")
  check(uuid.test(data.purge ?? ""), entry, "purge ID")
  check(
    Array.isArray(data.refs) &&
      data.refs.every(
        (r) => typeof r.ref === "string" && objectId.test(r.commit),
      ),
    entry,
    "refs",
  )
  check(
    typeof data.counts === "object" && data.counts !== null,
    entry,
    "counts",
  )
  const [inserted] = await scope.tx
    .insert(schema.catalogRewrites)
    .values({
      id: data.purge,
      workspaceId: data.workspaceId,
      journalId,
      journalEntry: entry.number,
      rewrittenAt: new Date(entry.recordedAt),
      refs: data.refs.map(({ ref, commit }) => ({ ref, commit })),
      counts: data.counts,
    })
    .onConflictDoNothing()
    .returning({ id: schema.catalogRewrites.id })
  if (!inserted) return
  const main = data.refs.find((r) => r.ref === "refs/heads/main")
  if (main)
    await recordCatalogMain({
      tx: scope.tx,
      jobs: scope.jobs,
      workspaceId: data.workspaceId,
      commit: main.commit,
    })
}

/**
 * The minute check of the push log against Git (plan §2.6): for each
 * workspace with a repository, the branches the Git container reports are
 * compared with what the push log says they should be (the last confirmed
 * update of each, or the repository's first commit for `main`), after
 * storing the journal up to the moment the refs were read. An update the
 * log does not explain is recorded in the security log once
 * (`catalog.unlogged-update`). A repository with a push being checked is
 * left for the next minute. Returns how many it recorded, and how many
 * journal entries the storing it did set aside.
 */
export async function checkCatalogRefs(
  ctx: Context,
  git: GitClient,
): Promise<{ unlogged: number; setAside: number }> {
  const repositories = await ctx.db
    .select({
      workspaceId: schema.catalogRepositories.workspaceId,
      firstCommit: schema.catalogRepositories.firstCommit,
    })
    .from(schema.catalogRepositories)
    .where(sql`${schema.catalogRepositories.firstCommit} is not null`)
  let unlogged = 0
  let setAside = 0
  for (const repository of repositories) {
    const refs = await git.listRefs(repository.workspaceId)
    if (!refs || refs.busy) continue
    if ((await lastStored(ctx, refs.journalId)) < refs.journalLast) {
      setAside += (await storeCatalogJournal(ctx, git)).setAside
    }
    unlogged += await atInstallation(
      ctx,
      "catalog-push.record",
      async (scope) => {
        const expected = await loggedRefs(
          scope.tx,
          repository.workspaceId,
          repository.firstCommit!,
        )
        const actual = new Map(refs.refs.map((r) => [r.ref, r.commit]))
        let found = 0
        for (const ref of new Set([...expected.keys(), ...actual.keys()])) {
          const commit = actual.get(ref) ?? null
          const logged = expected.get(ref) ?? null
          if (commit === logged) continue
          const details = { ref, commit, logged }
          const [seen] = await scope.tx
            .select({ id: schema.securityLog.id })
            .from(schema.securityLog)
            .where(
              and(
                eq(schema.securityLog.workspaceId, repository.workspaceId),
                eq(schema.securityLog.action, "catalog.unlogged-update"),
                sql`${schema.securityLog.details} = ${JSON.stringify(details)}::jsonb`,
              ),
            )
            .limit(1)
          if (seen) continue
          await recordSecurityEntry(scope.tx, {
            workspaceId: repository.workspaceId,
            action: "catalog.unlogged-update",
            outcome: "failed",
            actor: scope.actor,
            request: {},
            details,
          })
          found++
        }
        return found
      },
    )
  }
  return { unlogged, setAside }
}

/**
 * What the push log says each branch points to: the newest confirmed
 * update of each (a deletion: nothing), and `main` at the first commit
 * until a push moves it. After a purge's rewrite, the branches as it left
 * them, and the pushes since.
 */
async function loggedRefs(
  tx: Transaction,
  workspaceId: string,
  firstCommit: string,
): Promise<Map<string, string>> {
  const w = schema.catalogRewrites
  const [rewrite] = await tx
    .select()
    .from(w)
    .where(eq(w.workspaceId, workspaceId))
    .orderBy(desc(w.rewrittenAt), desc(w.journalEntry))
    .limit(1)
  const since = rewrite
    ? sql`(${schema.catalogPushes.pushedAt} > ${rewrite.rewrittenAt} or (${schema.catalogPushes.pushedAt} = ${rewrite.rewrittenAt} and ${schema.catalogPushes.journalEntry} > ${rewrite.journalEntry}))`
    : sql`true`
  const rows = await tx
    .selectDistinctOn([schema.catalogPushRefs.ref], {
      ref: schema.catalogPushRefs.ref,
      commit: schema.catalogPushRefs.newCommit,
    })
    .from(schema.catalogPushRefs)
    .innerJoin(
      schema.catalogPushes,
      eq(schema.catalogPushes.id, schema.catalogPushRefs.pushId),
    )
    .where(
      and(
        eq(schema.catalogPushes.workspaceId, workspaceId),
        eq(schema.catalogPushRefs.confirmed, true),
        since,
      ),
    )
    .orderBy(
      schema.catalogPushRefs.ref,
      desc(schema.catalogPushes.pushedAt),
      desc(schema.catalogPushes.journalEntry),
    )
  const refs = new Map<string, string>(
    rewrite
      ? rewrite.refs.map((r) => [r.ref, r.commit])
      : [["refs/heads/main", firstCommit]],
  )
  for (const row of rows) {
    if (row.commit === null) refs.delete(row.ref)
    else refs.set(row.ref, row.commit)
  }
  return refs
}
