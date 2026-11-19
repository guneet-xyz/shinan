import { createHash } from "node:crypto"

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  schema,
  sql,
} from "@shinan/db"
import type { SQL } from "@shinan/db"

import { shinan } from "../../actor.js"
import { inWorkspace, snapshotRead } from "../../authorize.js"
import type { Context } from "../../context.js"
import {
  BusyError,
  InvalidInputError,
  NotFoundError,
  RuleViolationError,
} from "../../errors.js"
import { appendEvent } from "../../events.js"
import { rateLimits, takeRateLimit } from "../../rate-limits.js"
import { recordSecurityEntry } from "../../security-log.js"
import { checkStorable, isId } from "../../validation.js"
import { maxOperations, taskIdPattern } from "../document/index.js"
import type {
  CatalogOperation,
  EntityStatus,
  OperationProblem,
} from "../document/index.js"
import { proposalLimits } from "./input.js"
import {
  approveCatalogProposal,
  rejectCatalogProposal,
  submitProposal,
  withAuthorStatus,
} from "./proposals.js"
import type {
  ApprovalOutcome,
  CatalogProposal,
  CatalogProposalState,
  ProposalOutcome,
  ProposalRow,
  ProposalScope,
} from "./proposals.js"

/**
 * Reviewing catalog changes (catalog §8.2, §8.6; human experience,
 * reviewing catalog changes): comments on proposals, the strict setting,
 * bulk approval, the recent-changes feed and revert.
 */

// Comments.

/** A comment on a catalog proposal (catalog §8.6). */
export interface CatalogProposalComment {
  id: string
  proposalId: string
  createdAt: Date
  author: {
    kind: "person" | "agent"
    label: string
    personId: string | null
    agentId: string | null
  }
  text: string
}

/** The longest comment accepted, in characters. */
export const commentLimit = 4000

/**
 * Comments on a catalog proposal, in any state: members, and agents with
 * `catalog:propose`, such as one asked to review it (catalog §8.6). A
 * comment informs the reviewer; it never approves. Comments are not
 * edited; purge (M2-10) can remove one.
 *
 * Three steps, so no transaction is held while another connection is
 * needed: a read finds the proposal and a retry's stored comment; then an
 * agent's rate limit is counted, outside any transaction, as proposals do;
 * then the comment is stored.
 */
export async function commentOnCatalogProposal(
  ctx: Context,
  workspaceId: string,
  input: { proposalId: string; text: string; idempotencyKey?: string | null },
): Promise<CatalogProposalComment> {
  const text = typeof input.text === "string" ? input.text.trim() : ""
  if (text === "")
    throw new InvalidInputError("comment-blank", "Write the comment")
  if (text.length > commentLimit)
    throw new InvalidInputError(
      "comment-too-long",
      `A comment is at most ${commentLimit} characters`,
    )
  checkStorable(text, "The comment")
  const key = checkKey(input.idempotencyKey)
  const retried = await inWorkspace(
    ctx,
    workspaceId,
    "catalog.comment",
    async (scope) => {
      const proposal = await findProposal(
        scope.tx,
        scope.workspaceId,
        input.proposalId,
      )
      return storedComment(scope, key, proposal.id, text)
    },
    snapshotRead,
  )
  if (retried) return retried
  if (ctx.actor.kind === "agent")
    await throttle(ctx, "catalog-comment", ctx.actor.agentId)
  return inWorkspace(ctx, workspaceId, "catalog.comment", async (scope) => {
    const proposal = await findProposal(
      scope.tx,
      scope.workspaceId,
      input.proposalId,
    )
    const [row] = await scope.tx
      .insert(schema.catalogProposalComments)
      .values({
        workspaceId: scope.workspaceId,
        proposalId: proposal.id,
        actorKind: scope.actor.kind,
        actorPersonId: scope.actor.personId,
        actorAgentId: scope.actor.agentId,
        actorAgentSessionId: scope.actor.agentSessionId,
        actorLabel: scope.actor.label,
        confidence: scope.actor.confidence,
        text,
        idempotencyKey: key,
      })
      .onConflictDoNothing()
      .returning()
    // The same key from a retry running at the same time.
    if (!row) return (await storedComment(scope, key, proposal.id, text))!
    await appendEvent(scope, {
      kind: "catalog.proposal-commented",
      subjects: [{ type: "catalog-proposal", id: proposal.id }],
      // The comment is outside text: the summary does not repeat it.
      summary: `${scope.actor.label} commented on catalog proposal ${proposal.number}`,
      data: {
        proposalId: proposal.id,
        number: proposal.number,
        commentId: row.id,
      },
    })
    return commentOf(row)
  })
}

/**
 * The comment this author already stored with this idempotency key, if
 * any; refused when the key was used for a different comment.
 */
async function storedComment(
  scope: Pick<ProposalScope, "tx" | "workspaceId" | "actor">,
  key: string | null,
  proposalId: string,
  text: string,
): Promise<CatalogProposalComment | null> {
  if (key === null) return null
  const t = schema.catalogProposalComments
  const [existing] = await scope.tx
    .select()
    .from(t)
    .where(
      and(
        eq(t.workspaceId, scope.workspaceId),
        eq(t.idempotencyKey, key),
        scope.actor.agentId
          ? eq(t.actorAgentId, scope.actor.agentId)
          : and(
              eq(t.actorPersonId, scope.actor.personId!),
              isNull(t.actorAgentId),
            ),
      ),
    )
  if (!existing) return null
  if (existing.proposalId !== proposalId || existing.text !== text)
    throw new InvalidInputError(
      "idempotency-key-reused",
      "You used this idempotency key for a different comment",
    )
  return commentOf(existing)
}

export interface CatalogProposalCommentsInput {
  /** Comments after this one: the last `id` of the previous page. */
  cursor?: string
  /** At most this many: 50 by default, 1 to 200. */
  limit?: number
}

/**
 * A catalog proposal's comments, oldest first, a page at a time, so a
 * proposal with many comments is never read whole.
 */
export async function listCatalogProposalComments(
  ctx: Context,
  workspaceId: string,
  proposalId: string,
  input: CatalogProposalCommentsInput = {},
): Promise<{
  items: CatalogProposalComment[]
  nextCursor: string | null
  total: number
}> {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.read",
    async (scope) => {
      if (
        input.cursor !== undefined &&
        (typeof input.cursor !== "string" || !isId(input.cursor))
      )
        throw new InvalidInputError("cursor", "cursor is a comment ID")
      if (
        input.limit !== undefined &&
        (!Number.isInteger(input.limit) || input.limit < 1)
      )
        throw new InvalidInputError("limit", "limit is a positive number")
      const limit = Math.min(input.limit ?? commentPage, 200)
      const proposal = await findProposal(
        scope.tx,
        scope.workspaceId,
        proposalId,
      )
      const t = schema.catalogProposalComments
      const mine = and(
        eq(t.workspaceId, scope.workspaceId),
        eq(t.proposalId, proposal.id),
      )
      let after: SQL | undefined
      if (input.cursor !== undefined) {
        const cursor = input.cursor.toLowerCase()
        const [from] = await scope.tx
          .select({ id: t.id })
          .from(t)
          .where(and(mine, eq(t.id, cursor)))
        if (!from)
          throw new InvalidInputError(
            "cursor",
            "cursor is a comment ID of this proposal",
          )
        // Compared in the database: timestamps there are finer than a Date.
        after = sql`(${t.createdAt}, ${t.id}) > (select c.created_at, c.id from catalog_proposal_comments c where c.id = ${cursor})`
      }
      const rows = await scope.tx
        .select()
        .from(t)
        .where(and(mine, after))
        .orderBy(asc(t.createdAt), asc(t.id))
        .limit(limit + 1)
      const [{ total } = { total: 0 }] = await scope.tx
        .select({ total: sql<number>`count(*)::int` })
        .from(t)
        .where(mine)
      const page = rows.slice(0, limit)
      return {
        items: page.map(commentOf),
        nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
        total,
      }
    },
    snapshotRead,
  )
}

/** How many comments a page holds by default. */
export const commentPage = 50

/** Counts an agent's request against one of its rate limits (`rateLimits`). */
async function throttle(
  ctx: Context,
  name: "catalog-comment",
  agentId: string,
): Promise<void> {
  const outcome = await takeRateLimit(
    { db: ctx.db, actor: shinan, request: ctx.request ?? {} },
    name,
    { key: agentId },
  )
  if (!outcome.allowed)
    throw new BusyError(
      name,
      `This agent has sent ${rateLimits[name].max} comments in ${rateLimits[name].windowSeconds / 60} minutes; send this one again later`,
      outcome.retryAfterSeconds,
    )
}

function commentOf(
  row: typeof schema.catalogProposalComments.$inferSelect,
): CatalogProposalComment {
  return {
    id: row.id,
    proposalId: row.proposalId,
    createdAt: row.createdAt,
    author: {
      kind: row.actorKind as "person" | "agent",
      label: row.actorLabel,
      personId: row.actorPersonId,
      agentId: row.actorAgentId,
    },
    text: row.text,
  }
}

// The strict setting.

export interface CatalogSettings {
  /** When on, every catalog change except a recheck needs catalog approval (catalog §8.2). */
  strict: boolean
}

/** The workspace's catalog settings. */
export async function getCatalogSettings(
  ctx: Context,
  workspaceId: string,
): Promise<CatalogSettings> {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.read",
    async (scope) => ({ strict: await strictOf(scope.tx, scope.workspaceId) }),
    snapshotRead,
  )
}

/**
 * Turns the strict setting on or off (catalog §8.2): a workspace setting,
 * so only workspace owners may, after signing in again (identity §3.3,
 * §5.1). Proposals already waiting stay waiting when it is turned off;
 * bulk approval handles them. Recorded as an event and in the security log.
 */
export async function setCatalogStrict(
  ctx: Context,
  input: { workspaceId: string; strict: boolean },
): Promise<CatalogSettings> {
  return inWorkspace(
    ctx,
    input.workspaceId,
    "workspace.change-settings",
    async (scope) => {
      if (typeof input.strict !== "boolean")
        throw new InvalidInputError("strict", "strict is true or false")
      const [current] = await scope.tx
        .select({ strict: schema.workspaces.catalogStrict })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, scope.workspaceId))
        .for("update")
      if (current!.strict === input.strict) return { strict: input.strict }
      await scope.tx
        .update(schema.workspaces)
        .set({ catalogStrict: input.strict })
        .where(eq(schema.workspaces.id, scope.workspaceId))
      await appendEvent(scope, {
        kind: "catalog.strict-changed",
        summary: `${scope.actor.label} turned the catalog's strict setting ${input.strict ? "on" : "off"}`,
        data: { strict: input.strict },
      })
      await recordSecurityEntry(scope.tx, {
        workspaceId: scope.workspaceId,
        action: "catalog.strict-changed",
        outcome: "succeeded",
        actor: scope.actor,
        request: scope.request,
        details: { strict: input.strict },
      })
      return { strict: input.strict }
    },
  )
}

async function strictOf(
  tx: ProposalScope["tx"],
  workspaceId: string,
): Promise<boolean> {
  const [workspace] = await tx
    .select({ strict: schema.workspaces.catalogStrict })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
  return workspace?.strict ?? false
}

// Bulk approval and rejection.

/** The most proposals one bulk approval or rejection takes. */
export const bulkApprovalLimit = 50

/**
 * Which waiting proposals a bulk action takes: exactly the ones the person
 * was shown. Either their IDs, or one related task's waiting proposals up
 * to the highest proposal number the person saw (`seenUpTo`), so a
 * proposal added to the task later is never included.
 */
export type BulkSelection =
  { proposalIds: string[] } | { relatedTask: string; seenUpTo: number }

export type BulkApprovalResult = {
  proposalId: string
  number: number | null
} & (
  | ApprovalOutcome
  | { outcome: "refused"; rule: string; message: string }
  /** Shinan was busy before it reached this one: send it again later. */
  | { outcome: "not-attempted"; retryAfterSeconds: number }
)

export type BulkRejectionResult = {
  proposalId: string
  number: number | null
} & (
  | { outcome: "rejected"; proposal: CatalogProposal }
  | { outcome: "refused"; rule: string; message: string }
)

/**
 * Approves several waiting proposals (catalog §8.2: "when it is on,
 * approval works in bulk"): exactly the ones the person was shown
 * (`BulkSelection`), oldest first, at most `bulkApprovalLimit`. Each is
 * approved as `approveCatalogProposal` does, in its own turn, so each is
 * checked, applied and recorded on its own; one that cannot apply does not
 * stop the others, and is reported with why. When Shinan is busy, the
 * results so far are returned and the rest are `not-attempted`, with when
 * to send them again.
 */
export async function approveCatalogProposals(
  ctx: Context,
  workspaceId: string,
  selection: BulkSelection,
): Promise<{ results: BulkApprovalResult[] }> {
  const selected = await select(ctx, workspaceId, selection)
  const results: BulkApprovalResult[] = []
  for (const [i, { proposalId, number }] of selected.entries()) {
    try {
      const outcome = await approveCatalogProposal(ctx, workspaceId, proposalId)
      results.push({ proposalId, number, ...outcome })
    } catch (error) {
      if (error instanceof BusyError) {
        for (const rest of selected.slice(i))
          results.push({
            ...rest,
            outcome: "not-attempted",
            retryAfterSeconds: error.retryAfterSeconds,
          })
        break
      }
      const refused = refusalOf(error)
      if (!refused) throw error
      results.push({ proposalId, number, ...refused })
    }
  }
  return { results }
}

/**
 * Rejects several waiting proposals with one reason, such as those of an
 * agent that was disabled: exactly the ones the person was shown, as
 * `rejectCatalogProposal` does for each.
 */
export async function rejectCatalogProposals(
  ctx: Context,
  workspaceId: string,
  input: BulkSelection & { reason: string },
): Promise<{ results: BulkRejectionResult[] }> {
  const selected = await select(ctx, workspaceId, input)
  const results: BulkRejectionResult[] = []
  for (const { proposalId, number } of selected) {
    try {
      const proposal = await rejectCatalogProposal(ctx, workspaceId, {
        proposalId,
        reason: input.reason,
      })
      results.push({ proposalId, number, outcome: "rejected", proposal })
    } catch (error) {
      const refused = refusalOf(error)
      if (!refused) throw error
      // A bad reason is the same for every proposal.
      if (error instanceof InvalidInputError) throw error
      results.push({ proposalId, number, ...refused })
    }
  }
  return { results }
}

/** A refusal that concerns one proposal, reported in its result. */
function refusalOf(
  error: unknown,
): { outcome: "refused"; rule: string; message: string } | null {
  if (error instanceof NotFoundError)
    return {
      outcome: "refused",
      rule: "not-found",
      message: "There is no such catalog proposal",
    }
  if (error instanceof RuleViolationError)
    return { outcome: "refused", rule: error.rule, message: error.message }
  return null
}

/** The proposals a bulk action takes, oldest first; checked for `catalog.approve`. */
async function select(
  ctx: Context,
  workspaceId: string,
  selection: BulkSelection,
): Promise<{ proposalId: string; number: number | null }[]> {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.approve",
    async (scope) => {
      const t = schema.catalogProposals
      if ("relatedTask" in selection) {
        if (
          typeof selection.relatedTask !== "string" ||
          !taskIdPattern.test(selection.relatedTask)
        )
          throw new InvalidInputError(
            "related-task",
            "relatedTask is a task ID, such as SHN-12",
          )
        if (!Number.isInteger(selection.seenUpTo) || selection.seenUpTo < 1)
          throw new InvalidInputError(
            "seen-up-to",
            "seenUpTo is the highest proposal number the person was shown",
          )
        const rows = await scope.tx
          .select({ id: t.id, number: t.number })
          .from(t)
          .where(
            and(
              eq(t.workspaceId, scope.workspaceId),
              eq(t.relatedTask, selection.relatedTask),
              eq(t.state, "pending"),
              lte(t.number, selection.seenUpTo),
            ),
          )
          .orderBy(asc(t.number))
          .limit(bulkApprovalLimit + 1)
        if (rows.length > bulkApprovalLimit) throw tooMany()
        return rows.map((r) => ({ proposalId: r.id, number: r.number }))
      }
      const ids = Array.isArray(selection.proposalIds)
        ? selection.proposalIds
        : null
      if (!ids || ids.length === 0 || ids.some((id) => typeof id !== "string"))
        throw new InvalidInputError(
          "proposal-ids",
          "proposalIds lists the proposals the person was shown",
        )
      if (ids.length > bulkApprovalLimit) throw tooMany()
      const wanted = [...new Set(ids.map((id) => id.toLowerCase()))]
      const rows = await scope.tx
        .select({ id: t.id, number: t.number })
        .from(t)
        .where(
          and(
            eq(t.workspaceId, scope.workspaceId),
            inArray(t.id, wanted.filter(isId)),
          ),
        )
      const numbers = new Map(rows.map((r) => [r.id, r.number]))
      return wanted
        .map((id) => ({ proposalId: id, number: numbers.get(id) ?? null }))
        .sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity))
    },
    snapshotRead,
  )
}

function tooMany(): InvalidInputError {
  return new InvalidInputError(
    "too-many",
    `A bulk action takes at most ${bulkApprovalLimit} proposals at a time`,
  )
}

// The recent-changes feed.

/** One applied proposal in the recent-changes feed. */
export interface RecentCatalogChange {
  revision: number
  proposal: CatalogProposal
  /** The person whose approval applied it, if it needed one. */
  approvedBy: string | null
  /** Whether every document it changed is still as it left it, so it can be reverted. */
  revertible: boolean
  /** The latest proposal reverting it, if any. */
  revertedBy: { id: string; number: number; state: CatalogProposalState } | null
}

export interface RecentCatalogChangesInput {
  /** Changes before this revision: the last `revision` of the previous page. */
  cursor?: number
  /** At most this many: 50 by default, 1 to 200. */
  limit?: number
  /** Only changes that applied without catalog approval (the default), or all. */
  approval?: "without" | "any"
}

/**
 * The recent-changes feed (catalog §8.2; human experience, reviewing
 * catalog changes): applied proposals, one per revision, newest first. By
 * default only those that applied without approval, which no person has
 * reviewed; each says whether it can still be reverted.
 */
export async function listRecentCatalogChanges(
  ctx: Context,
  workspaceId: string,
  input: RecentCatalogChangesInput = {},
): Promise<{ items: RecentCatalogChange[]; nextCursor: number | null }> {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.read",
    async (scope) => {
      if (
        input.cursor !== undefined &&
        (!Number.isInteger(input.cursor) || input.cursor < 1)
      )
        throw new InvalidInputError("cursor", "cursor is a revision number")
      if (
        input.approval !== undefined &&
        !["without", "any"].includes(input.approval)
      )
        throw new InvalidInputError("approval", "approval is without or any")
      const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)
      const r = schema.catalogRevisions
      const p = schema.catalogProposals
      const rows = await scope.tx
        .select({
          revision: r.number,
          approvedBy: r.approvedByLabel,
          proposal: p,
        })
        .from(r)
        .innerJoin(
          p,
          and(eq(p.workspaceId, r.workspaceId), eq(p.id, r.proposalId)),
        )
        .where(
          and(
            eq(r.workspaceId, scope.workspaceId),
            input.cursor === undefined ? undefined : lt(r.number, input.cursor),
            input.approval === "any" ? undefined : isNull(r.approvedByPersonId),
          ),
        )
        .orderBy(desc(r.number))
        .limit(limit + 1)
      const page = rows.slice(0, limit)
      const revisions = page.map((row) => row.revision)
      const stale = new Set<number>()
      if (revisions.length > 0) {
        const d = schema.catalogRevisionDocuments
        const changed = await scope.tx
          .select({ revision: d.revision })
          .from(d)
          .innerJoin(
            schema.catalogDocuments,
            eq(schema.catalogDocuments.id, d.documentId),
          )
          .where(
            and(
              eq(d.workspaceId, scope.workspaceId),
              inArray(d.revision, revisions),
              sql`${schema.catalogDocuments.currentRevision} <> ${d.revision}`,
            ),
          )
        for (const row of changed) stale.add(row.revision)
      }
      const reverts = new Map<
        string,
        { id: string; number: number; state: CatalogProposalState }
      >()
      const ids = page.map((row) => row.proposal.id)
      if (ids.length > 0) {
        const reverting = await scope.tx
          .select({
            id: p.id,
            number: p.number,
            state: p.state,
            reverts: p.revertsProposalId,
          })
          .from(p)
          .where(
            and(
              eq(p.workspaceId, scope.workspaceId),
              inArray(p.revertsProposalId, ids),
            ),
          )
          .orderBy(asc(p.number))
        for (const row of reverting)
          reverts.set(row.reverts!, {
            id: row.id,
            number: row.number,
            state: row.state,
          })
      }
      const proposals = await withAuthorStatus(
        scope.tx,
        scope.workspaceId,
        page.map((row) => row.proposal),
      )
      return {
        items: page.map((row, i) => ({
          revision: row.revision,
          proposal: proposals[i]!,
          approvedBy: row.approvedBy,
          revertible: !stale.has(row.revision),
          revertedBy: reverts.get(row.proposal.id) ?? null,
        })),
        nextCursor:
          rows.length > limit ? page[page.length - 1]!.revision : null,
      }
    },
    snapshotRead,
  )
}

// Revert.

/**
 * Reverts an applied proposal (catalog §8.2, §9): makes a new proposal,
 * through the same path as any other, whose operations put back each
 * document it changed as it was just before. Revisions are never edited;
 * the revert is its own revision. Its approval classes come from the
 * Markdown like any proposal's, so it applies at once or waits as any
 * change would, with the strict setting and the author's rate limit.
 *
 * - A document the proposal changed is restored whole (`restore-document`),
 *   expecting it to be exactly as the proposal left it; if anything
 *   changed it since, the revert conflicts and nothing is stored.
 * - A document the proposal created is retired: documents are never
 *   deleted. The start-here document cannot be retired, so a proposal that
 *   created it cannot be reverted.
 *
 * The earlier text is read from the stored revisions, so what purge
 * (M2-10) removed from them stays removed.
 */
export async function revertCatalogProposal(
  ctx: Context,
  workspaceId: string,
  input: { proposalId: string; explanation?: string; idempotencyKey?: string },
): Promise<ProposalOutcome> {
  return submitProposal(ctx, workspaceId, async (scope) => {
    const row = await findProposal(
      scope.tx,
      scope.workspaceId,
      input.proposalId,
    )
    if (row.state !== "applied" || row.appliedRevision === null)
      throw new RuleViolationError(
        "proposal-not-applied",
        `Catalog proposal ${row.number} is ${row.state}; only an applied proposal is reverted`,
      )
    const explanation = checkExplanation(
      input.explanation === undefined
        ? `Reverts catalog proposal ${row.number}.`
        : input.explanation,
    )
    return {
      // A retry is the same revert, whatever the operations come to now.
      request: ["revert", row.id, explanation],
      explanation,
      relatedTask: row.relatedTask,
      idempotencyKey: checkKey(input.idempotencyKey),
      revertsProposalId: row.id,
      // Worked out in each attempt of the turn, from the text it reads.
      operations: async (attempt) => {
        const built = await revertOperations(attempt, row)
        return "outcome" in built ? built : built.operations
      },
    }
  })
}

/** The operations that put back what an applied proposal changed. */
async function revertOperations(
  scope: ProposalScope,
  row: ProposalRow,
): Promise<
  | { operations: CatalogOperation[] }
  | { outcome: "conflict"; problems: OperationProblem[] }
> {
  const revision = row.appliedRevision!
  const d = schema.catalogRevisionDocuments
  const docs = schema.catalogDocuments
  const index = schema.catalogIndexDocuments
  const changed = await scope.tx
    .select({
      documentId: d.documentId,
      text: d.text,
      current: docs.currentRevision,
      catalogId: index.catalogId,
      kind: index.kind,
      status: index.status,
    })
    .from(d)
    .innerJoin(docs, eq(docs.id, d.documentId))
    .leftJoin(index, eq(index.documentId, d.documentId))
    .where(and(eq(d.workspaceId, scope.workspaceId), eq(d.revision, revision)))
    .orderBy(asc(d.documentId))
  if (changed.length > maxOperations)
    throw new RuleViolationError(
      "revert-too-large",
      `Catalog proposal ${row.number} changed more than ${maxOperations} documents; revert it in parts by hand`,
    )

  const problems: OperationProblem[] = []
  const operations: CatalogOperation[] = []
  for (const [i, document] of changed.entries()) {
    const name = document.catalogId
    if (document.current !== revision || name === null) {
      problems.push({
        operation: i,
        kind: "conflict",
        code: "changed",
        message: name
          ? `"${name}" has changed since catalog proposal ${row.number} applied; revert it by hand`
          : `A document catalog proposal ${row.number} changed cannot be read now; revert it by hand`,
        documentId: name,
      })
      continue
    }
    const [earlier] = await scope.tx
      .select({ text: d.text })
      .from(d)
      .where(
        and(
          eq(d.workspaceId, scope.workspaceId),
          eq(d.documentId, document.documentId),
          lt(d.revision, revision),
        ),
      )
      .orderBy(desc(d.revision))
      .limit(1)
    if (earlier) {
      operations.push({
        op: "restore-document",
        document: name,
        text: earlier.text,
        expect: {
          sha256: createHash("sha256").update(document.text).digest("hex"),
        },
      })
      continue
    }
    // Created by the proposal: retired, since documents are never deleted.
    if (document.kind === "start-here")
      throw new RuleViolationError(
        "revert-unsupported",
        `Catalog proposal ${row.number} created the start-here document, which cannot be retired; change it instead`,
      )
    if (document.status === "retired") continue
    operations.push({
      op: "retire",
      document: name,
      expect: { status: (document.status as EntityStatus | null) ?? "active" },
    })
  }
  if (problems.length > 0) return { outcome: "conflict", problems }
  if (operations.length === 0)
    throw new RuleViolationError(
      "revert-unchanged",
      `Reverting catalog proposal ${row.number} would change nothing`,
    )
  return { operations }
}

function checkExplanation(explanation: unknown): string {
  if (typeof explanation !== "string" || explanation.trim() === "")
    throw new InvalidInputError(
      "explanation-blank",
      "Explain the revert in a few sentences",
    )
  if (explanation.length > proposalLimits.explanation)
    throw new InvalidInputError(
      "explanation-too-long",
      `The explanation is longer than ${proposalLimits.explanation} characters`,
    )
  checkStorable(explanation, "The explanation")
  return explanation
}

/** An idempotency key as a request sends it, checked. */
export function checkKey(key: unknown): string | null {
  if (key === undefined || key === null) return null
  if (
    typeof key !== "string" ||
    key === "" ||
    key.length > proposalLimits.idempotencyKey
  )
    throw new InvalidInputError(
      "idempotency-key",
      `idempotencyKey is text of 1 to ${proposalLimits.idempotencyKey} characters`,
    )
  checkStorable(key, "idempotencyKey")
  return key
}

async function findProposal(
  tx: ProposalScope["tx"],
  workspaceId: string,
  proposalId: string,
): Promise<ProposalRow> {
  if (typeof proposalId !== "string" || !isId(proposalId))
    throw new NotFoundError()
  const [row] = await tx
    .select()
    .from(schema.catalogProposals)
    .where(
      and(
        eq(schema.catalogProposals.workspaceId, workspaceId),
        eq(schema.catalogProposals.id, proposalId.toLowerCase()),
      ),
    )
  if (!row) throw new NotFoundError()
  return row
}
