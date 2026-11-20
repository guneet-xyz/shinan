import { and, desc, eq, schema, sql } from "@shinan/db"
import type { Transaction } from "@shinan/db"

import type { ResolvedActor } from "../../actor.js"
import { atInstallation, shinanInWorkspace } from "../../authorize.js"
import type { Context, InstallationScope } from "../../context.js"
import { appendEvent } from "../../events.js"
import { recordSecurityEntry } from "../../security-log.js"
import { recordCatalogMain } from "../index/maintain.js"
import type { JournalEntry } from "./api.js"
import type { GitClient } from "./client.js"

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
    /** IDs of the catalog documents it changed, at most 1,000. */
    documents: string[]
    documentsTruncated: boolean
  } | null
}

export interface RepositoryCreatedData {
  workspaceId: string
  commit: string
}

const objectId = /^([0-9a-f]{40}|[0-9a-f]{64})$/
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** How many entries one transaction stores. */
const page = 200

/**
 * Stores the Git container's journal entries not stored yet, and
 * acknowledges them, until none are left. Returns how many it stored. Safe
 * to run from several processes at once: each journal's row is locked
 * while its entries are stored.
 */
export async function storeCatalogJournal(
  ctx: Context,
  git: GitClient,
): Promise<{ stored: number }> {
  let stored = 0
  for (;;) {
    const probe = await git.readJournal({ after: 0, limit: 1 })
    const journalId = probe.journalId
    const after = await lastStored(ctx, journalId)
    const { entries } =
      probe.entries.length === 0
        ? { entries: [] as JournalEntry[] }
        : await git.readJournal({ after, limit: page })
    const through = await atInstallation(
      { ...ctx, origin: "git_push" },
      "catalog-push.record",
      async (scope) => {
        await scope.tx
          .insert(schema.catalogJournals)
          .values({ journalId })
          .onConflictDoNothing()
        const [state] = await scope.tx
          .select()
          .from(schema.catalogJournals)
          .where(eq(schema.catalogJournals.journalId, journalId))
          .for("update")
        let last = state!.lastStored
        for (const entry of entries) {
          if (entry.number <= last) continue
          await storeEntry(scope, journalId, entry)
          last = entry.number
          stored++
        }
        await scope.tx
          .update(schema.catalogJournals)
          .set({ lastStored: last, updatedAt: sql`now()` })
          .where(eq(schema.catalogJournals.journalId, journalId))
        return last
      },
    )
    if (through > 0) await git.acknowledgeJournal({ journalId, through })
    if (entries.length < page) return { stored }
  }
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
    throw new Error(`Journal entry ${entry.number} has no valid ${what}`)
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
}

/**
 * The minute check of the push log against Git (plan §2.6): for each
 * workspace with a repository, the branches the Git container reports are
 * compared with what the push log says they should be (the last confirmed
 * update of each, or the repository's first commit for `main`), after
 * storing the journal up to the moment the refs were read. An update the
 * log does not explain is recorded in the security log once
 * (`catalog.unlogged-update`). A repository with a push being checked is
 * left for the next minute. Returns how many it recorded.
 */
export async function checkCatalogRefs(
  ctx: Context,
  git: GitClient,
): Promise<{ unlogged: number }> {
  const repositories = await ctx.db
    .select({
      workspaceId: schema.catalogRepositories.workspaceId,
      firstCommit: schema.catalogRepositories.firstCommit,
    })
    .from(schema.catalogRepositories)
    .where(sql`${schema.catalogRepositories.firstCommit} is not null`)
  let unlogged = 0
  for (const repository of repositories) {
    const refs = await git.listRefs(repository.workspaceId)
    if (!refs || refs.busy) continue
    if ((await lastStored(ctx, refs.journalId)) < refs.journalLast) {
      await storeCatalogJournal(ctx, git)
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
  return { unlogged }
}

/**
 * What the push log says each branch points to: the newest confirmed
 * update of each (a deletion: nothing), and `main` at the first commit
 * until a push moves it.
 */
async function loggedRefs(
  tx: Transaction,
  workspaceId: string,
  firstCommit: string,
): Promise<Map<string, string>> {
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
      ),
    )
    .orderBy(
      schema.catalogPushRefs.ref,
      desc(schema.catalogPushes.pushedAt),
      desc(schema.catalogPushes.journalEntry),
    )
  const refs = new Map<string, string>([["refs/heads/main", firstCommit]])
  for (const row of rows) {
    if (row.commit === null) refs.delete(row.ref)
    else refs.set(row.ref, row.commit)
  }
  return refs
}
