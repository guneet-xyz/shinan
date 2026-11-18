import { createHash } from "node:crypto"

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  schema,
  sql,
} from "@shinan/db"

import { inWorkspace, snapshotRead } from "../../authorize.js"
import type { Context } from "../../context.js"
import {
  InvalidInputError,
  NotFoundError,
  RuleViolationError,
} from "../../errors.js"
import { appendEvent } from "../../events.js"
import { recordSecurityEntry } from "../../security-log.js"
import { isId } from "../../validation.js"
import { maxOperations, taskIdPattern } from "../document/index.js"
import type {
  CatalogOperation,
  EntityStatus,
  OperationProblem,
} from "../document/index.js"
import { proposalLimits } from "./input.js"
import {
  approveCatalogProposal,
  proposalOf,
  submitProposal,
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
 */
export async function commentOnCatalogProposal(
  ctx: Context,
  workspaceId: string,
  input: { proposalId: string; text: string },
): Promise<CatalogProposalComment> {
  return inWorkspace(ctx, workspaceId, "catalog.comment", async (scope) => {
    const text = typeof input.text === "string" ? input.text.trim() : ""
    if (text === "")
      throw new InvalidInputError("comment-blank", "Write the comment")
    if (text.length > commentLimit)
      throw new InvalidInputError(
        "comment-too-long",
        `A comment is at most ${commentLimit} characters`,
      )
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
      })
      .returning()
    await appendEvent(scope, {
      kind: "catalog.proposal-commented",
      subjects: [{ type: "catalog-proposal", id: proposal.id }],
      // The comment is outside text: the summary does not repeat it.
      summary: `${scope.actor.label} commented on catalog proposal ${proposal.number}`,
      data: {
        proposalId: proposal.id,
        number: proposal.number,
        commentId: row!.id,
      },
    })
    return commentOf(row!)
  })
}

/** A catalog proposal's comments, oldest first. */
export async function listCatalogProposalComments(
  ctx: Context,
  workspaceId: string,
  proposalId: string,
): Promise<CatalogProposalComment[]> {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.read",
    async (scope) => {
      const proposal = await findProposal(
        scope.tx,
        scope.workspaceId,
        proposalId,
      )
      const t = schema.catalogProposalComments
      const rows = await scope.tx
        .select()
        .from(t)
        .where(
          and(
            eq(t.workspaceId, scope.workspaceId),
            eq(t.proposalId, proposal.id),
          ),
        )
        .orderBy(asc(t.createdAt), asc(t.id))
      return rows.map(commentOf)
    },
    snapshotRead,
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

// Bulk approval.

/** The most proposals one bulk approval takes. */
export const bulkApprovalLimit = 50

export type BulkApprovalResult = {
  proposalId: string
  number: number | null
} & (ApprovalOutcome | { outcome: "refused"; rule: string; message: string })

/**
 * Approves several waiting proposals (catalog §8.2: "when it is on,
 * approval works in bulk"): a selected list, or every waiting proposal of
 * one task, oldest first, at most `bulkApprovalLimit`. Each is approved as
 * `approveCatalogProposal` does, in its own turn, so each is checked,
 * applied and recorded on its own; one that cannot apply does not stop the
 * others, and is reported with why.
 */
export async function approveCatalogProposals(
  ctx: Context,
  workspaceId: string,
  input: { proposalIds: string[] } | { relatedTask: string },
): Promise<{ results: BulkApprovalResult[] }> {
  const selected = await inWorkspace(
    ctx,
    workspaceId,
    "catalog.approve",
    async (scope) => {
      const t = schema.catalogProposals
      if ("relatedTask" in input) {
        if (
          typeof input.relatedTask !== "string" ||
          !taskIdPattern.test(input.relatedTask)
        )
          throw new InvalidInputError(
            "related-task",
            "relatedTask is a task ID, such as SHN-12",
          )
        const rows = await scope.tx
          .select({ id: t.id, number: t.number })
          .from(t)
          .where(
            and(
              eq(t.workspaceId, scope.workspaceId),
              eq(t.relatedTask, input.relatedTask),
              eq(t.state, "pending"),
            ),
          )
          .orderBy(asc(t.number))
          .limit(bulkApprovalLimit + 1)
        if (rows.length > bulkApprovalLimit) throw tooMany()
        return rows.map((r) => ({ proposalId: r.id, number: r.number }))
      }
      const ids = Array.isArray(input.proposalIds) ? input.proposalIds : null
      if (!ids || ids.length === 0 || ids.some((id) => typeof id !== "string"))
        throw new InvalidInputError(
          "proposal-ids",
          "proposalIds lists the proposals to approve",
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

  const results: BulkApprovalResult[] = []
  for (const { proposalId, number } of selected) {
    try {
      const outcome = await approveCatalogProposal(ctx, workspaceId, proposalId)
      results.push({ proposalId, number, ...outcome })
    } catch (error) {
      if (error instanceof NotFoundError)
        results.push({
          proposalId,
          number,
          outcome: "refused",
          rule: "not-found",
          message: "There is no such catalog proposal",
        })
      else if (error instanceof RuleViolationError)
        results.push({
          proposalId,
          number,
          outcome: "refused",
          rule: error.rule,
          message: error.message,
        })
      // Anything else (permission, busy, a failure) stops the rest.
      else throw error
    }
  }
  return { results }
}

function tooMany(): InvalidInputError {
  return new InvalidInputError(
    "too-many",
    `Bulk approval takes at most ${bulkApprovalLimit} proposals at a time`,
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
      return {
        items: page.map((row) => ({
          revision: row.revision,
          proposal: proposalOf(row.proposal),
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
    const explanation =
      input.explanation === undefined
        ? `Reverts catalog proposal ${row.number}.`
        : input.explanation
    const built = await revertOperations(scope, row)
    if ("outcome" in built) return built
    return {
      proposal: {
        explanation: checkExplanation(explanation),
        relatedTask: row.relatedTask,
        operations: built.operations,
        idempotencyKey: checkKey(input.idempotencyKey),
      },
      revertsProposalId: row.id,
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
  return explanation
}

function checkKey(key: unknown): string | null {
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
