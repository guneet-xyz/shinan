import { createHash } from "node:crypto"

import { and, asc, desc, eq, gt, isNull, lt, schema, sql } from "@shinan/db"
import type { Transaction } from "@shinan/db"

import { inWorkspace, mayAlso, snapshotRead } from "../../authorize.js"
import type { Context } from "../../context.js"
import {
  InvalidInputError,
  NotFoundError,
  RuleViolationError,
} from "../../errors.js"
import { appendEvent } from "../../events.js"
import type { EventCredit, WriteScope } from "../../events.js"
import { recordSecurityEntry } from "../../security-log.js"
import { isId } from "../../validation.js"
import type {
  CatalogOperation,
  OperationProblem,
  Problem,
} from "../document/index.js"
import { lockIndexState } from "../index/indexer.js"
import { latestRevision, latestTexts } from "../index/store.js"
import { appendCatalogRevision } from "../revisions.js"
import type { RevisionSource } from "../revisions.js"
import { isGated } from "./classify.js"
import type { ApprovalClass } from "./classify.js"
import { checkProposalInput } from "./input.js"
import { catalogWorker } from "./pool.js"
import type { LatestDocument } from "./pool.js"
import type { Prepared } from "./work.js"

type ProposalRow = typeof schema.catalogProposals.$inferSelect
type CatalogProposalState = ProposalRow["state"]

/** A catalog proposal as operations return it (catalog §8.1). */
export interface CatalogProposal {
  id: string
  /** Numbered from 1 in each workspace. */
  number: number
  state: CatalogProposalState
  createdAt: Date
  author: { kind: ProposalRow["actorKind"]; label: string }
  explanation: string
  relatedTask: string | null
  operations: CatalogOperation[]
  /** The catalog revision it was made against. */
  basedOnRevision: number
  approvalClasses: ApprovalClass[]
  /** Why it needs catalog approval; empty when it applies on its own. */
  approvalReasons: string[]
  /** Validation's warnings (catalog §8.3). */
  warnings: Problem[]
  /** The catalog IDs of the documents it changes. */
  touches: string[]
  appliedRevision: number | null
  decidedAt: Date | null
  /** Who applied, rejected or withdrew it. */
  decidedBy: string | null
  rejectionReason: string | null
}

/**
 * What became of a proposal:
 *
 * - `applied` or `pending` (waiting for catalog approval): it is stored. A
 *   retry with the same idempotency key gets the stored proposal again, in
 *   whatever state it is now;
 * - `conflict`: an expectation no longer holds on the latest revision; the
 *   author refreshes the proposal (catalog §8.5);
 * - `invalid`: an operation cannot apply as written;
 * - `blocked`: validation found a blocking problem (catalog §8.3);
 * - `unchanged`: the operations would leave every document as it was.
 *
 * Proposals that conflict, are invalid or are blocked are not stored: their
 * author is told why and sends a corrected one.
 */
export type ProposalOutcome =
  | {
      outcome: CatalogProposalState
      proposal: CatalogProposal
    }
  | NotApplied

/** Why a proposal did not apply; nothing was stored. */
export type NotApplied =
  | { outcome: "conflict" | "invalid"; problems: OperationProblem[] }
  | { outcome: "blocked"; problems: Problem[] }
  /** The operations would leave every document as it was. */
  | { outcome: "unchanged" }

/**
 * Makes a catalog proposal (catalog §8.1), from a person or an agent: it
 * applies at once as a new catalog revision, or waits for catalog approval
 * when it is in a gated class (§8.2). A person's own gated edit applies at
 * once, since they may approve it.
 *
 * `input` is checked here (`checkProposalInput`), so callers pass the
 * request's JSON as it came.
 */
export async function proposeCatalogChange(
  ctx: Context,
  workspaceId: string,
  input: unknown,
): Promise<ProposalOutcome> {
  return inWorkspace(ctx, workspaceId, "catalog.propose", async (scope) => {
    const proposal = checkProposalInput(input)
    const requestHash = hashOf(proposal)
    // The index lock comes first on every path that applies, so two applies
    // never wait on each other's proposal rows (architecture §5.3).
    await lockIndexState(scope.tx, scope.workspaceId)
    if (proposal.idempotencyKey) {
      const [existing] = await scope.tx
        .select()
        .from(schema.catalogProposals)
        .where(
          and(
            eq(schema.catalogProposals.workspaceId, scope.workspaceId),
            eq(schema.catalogProposals.idempotencyKey, proposal.idempotencyKey),
          ),
        )
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new InvalidInputError(
            "idempotency-key-reused",
            "This idempotency key was used for a different proposal",
          )
        return { outcome: existing.state, proposal: proposalOf(existing) }
      }
    }

    const basedOnRevision = await latestRevision(scope.tx, scope.workspaceId)
    // A person who may approve applies their own gated edit at once; for
    // anyone else, their person stands in for the approver until one approves.
    const mayApprove =
      scope.actor.kind === "person" && mayAlso(scope, "catalog.approve")
    const prepared = await prepare(scope, proposal.operations, {
      by: scope.actor.label,
      explanation: proposal.explanation,
      approver: {
        handle: await personHandle(scope),
        preview: !mayApprove,
      },
    })
    if (prepared.outcome !== "ready") return refusal(prepared)

    const gated = isGated(prepared.classes)
    const appliesNow = mayApprove || (!gated && prepared.accepts.length === 0)
    if (appliesNow) checkAccepts(prepared, scope.actor.label)

    const [{ next }] = (await scope.tx
      .select({
        next: sql<number>`coalesce(max(${schema.catalogProposals.number}), 0)::int + 1`,
      })
      .from(schema.catalogProposals)
      .where(eq(schema.catalogProposals.workspaceId, scope.workspaceId))) as [
      { next: number },
    ]
    const [row] = await scope.tx
      .insert(schema.catalogProposals)
      .values({
        workspaceId: scope.workspaceId,
        number: next,
        ...actorColumns(scope.actor),
        explanation: proposal.explanation,
        relatedTask: proposal.relatedTask ?? null,
        operations: proposal.operations,
        basedOnRevision,
        approvalClasses: prepared.classes,
        approvalReasons: prepared.reasons,
        touches: prepared.touches,
        validation: prepared.warnings as unknown as Record<string, unknown>[],
        idempotencyKey: proposal.idempotencyKey ?? null,
        requestHash,
      })
      .returning()
    if (!appliesNow) {
      await appendEvent(scope, {
        kind: "catalog.proposal-waiting",
        subjects: subjectsOf(
          row!,
          prepared.documents.flatMap((d) =>
            d.documentId ? [d.documentId] : [],
          ),
        ),
        summary: `${scope.actor.label} proposed catalog change ${row!.number}, waiting for approval: ${headline(row!)}`,
        data: eventData(row!),
      })
      return { outcome: "pending", proposal: proposalOf(row!) }
    }
    const applied = await apply(scope, row!, prepared, {
      approvedBy: gated ? scope.actor : null,
    })
    return { outcome: "applied", proposal: proposalOf(applied) }
  })
}

export type ApprovalOutcome =
  { outcome: "applied"; proposal: CatalogProposal } | NotApplied

/**
 * Gives catalog approval to a waiting proposal (catalog §8.2), which applies
 * it to the latest revision: its expectations are checked and the result
 * validated again, so a proposal that now conflicts stays waiting and the
 * approver is told why. Only people approve (identity §6.3); a person may
 * approve their own agents' proposals (owner, O-46). An `accepted` the
 * proposal writes must name the approver (catalog §4.7).
 */
export async function approveCatalogProposal(
  ctx: Context,
  workspaceId: string,
  proposalId: string,
): Promise<ApprovalOutcome> {
  return inWorkspace(ctx, workspaceId, "catalog.approve", async (scope) => {
    await lockIndexState(scope.tx, scope.workspaceId)
    const row = await pendingProposal(scope, proposalId)
    const author = authorOf(row)
    const prepared = await prepare(
      scope,
      row.operations as CatalogOperation[],
      {
        by: author.label,
        explanation: row.explanation,
        approver: { handle: scope.actor.label, preview: false },
      },
    )
    if (prepared.outcome !== "ready") return refusal(prepared)
    checkAccepts(prepared, scope.actor.label)
    const applied = await apply(scope, row, prepared, {
      approvedBy: scope.actor,
    })
    return { outcome: "applied", proposal: proposalOf(applied) }
  })
}

/** The longest rejection reason accepted. */
export const rejectionReasonLimit = 2000

/** Rejects a waiting proposal, with a reason for its author (catalog §8.6). */
export async function rejectCatalogProposal(
  ctx: Context,
  workspaceId: string,
  input: { proposalId: string; reason: string },
): Promise<CatalogProposal> {
  return inWorkspace(ctx, workspaceId, "catalog.approve", async (scope) => {
    const reason = typeof input.reason === "string" ? input.reason.trim() : ""
    if (reason === "")
      throw new InvalidInputError(
        "reason-blank",
        "Say why the proposal is rejected",
      )
    if (reason.length > rejectionReasonLimit)
      throw new InvalidInputError(
        "reason-too-long",
        `The reason is longer than ${rejectionReasonLimit} characters`,
      )
    const row = await pendingProposal(scope, input.proposalId)
    const [updated] = await scope.tx
      .update(schema.catalogProposals)
      .set({ state: "rejected", rejectionReason: reason, ...decided(scope) })
      .where(eq(schema.catalogProposals.id, row.id))
      .returning()
    await appendEvent(scope, {
      kind: "catalog.proposal-rejected",
      subjects: subjectsOf(updated!),
      summary: `${scope.actor.label} rejected catalog proposal ${updated!.number}: ${headline(updated!)}`,
      data: { ...eventData(updated!), reason },
    })
    await recordSecurityEntry(scope.tx, {
      workspaceId: scope.workspaceId,
      action: "catalog-proposal.rejected",
      outcome: "succeeded",
      actor: scope.actor,
      subjectPersonId: row.actorPersonId,
      request: scope.request,
      details: securityDetails(updated!),
    })
    return proposalOf(updated!)
  })
}

/**
 * Withdraws a waiting proposal. Only its author may: a person withdraws
 * their own proposals and their agents', an agent its own (identity §5.1).
 */
export async function withdrawCatalogProposal(
  ctx: Context,
  workspaceId: string,
  proposalId: string,
): Promise<CatalogProposal> {
  return inWorkspace(ctx, workspaceId, "catalog.propose", async (scope) => {
    const row = await pendingProposal(scope, proposalId)
    const own =
      scope.actor.kind === "agent"
        ? row.actorAgentId === scope.actor.agentId
        : row.actorPersonId === scope.actor.personId
    if (!own)
      throw new RuleViolationError(
        "not-author",
        "Only its author withdraws a catalog proposal; a reviewer rejects it",
      )
    const [updated] = await scope.tx
      .update(schema.catalogProposals)
      .set({ state: "withdrawn", ...decided(scope) })
      .where(eq(schema.catalogProposals.id, row.id))
      .returning()
    await appendEvent(scope, {
      kind: "catalog.proposal-withdrawn",
      subjects: subjectsOf(updated!),
      summary: `${scope.actor.label} withdrew catalog proposal ${updated!.number}: ${headline(updated!)}`,
      data: eventData(updated!),
    })
    return proposalOf(updated!)
  })
}

/** One catalog proposal, by ID. */
export async function getCatalogProposal(
  ctx: Context,
  workspaceId: string,
  proposalId: string,
): Promise<CatalogProposal> {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.read",
    async (scope) => {
      if (!isId(proposalId)) throw new NotFoundError()
      const [row] = await scope.tx
        .select()
        .from(schema.catalogProposals)
        .where(
          and(
            eq(schema.catalogProposals.workspaceId, scope.workspaceId),
            eq(schema.catalogProposals.id, proposalId.toLowerCase()),
          ),
        )
      if (!row) throw new NotFoundError()
      return proposalOf(row)
    },
    snapshotRead,
  )
}

export interface ListProposalsInput {
  state?: CatalogProposalState
  /** Most proposals to return: 50 by default, 1 to 200. */
  limit?: number
  /** The last proposal number of the previous page. */
  cursor?: number
  /** Oldest first, as the review list shows waiting proposals (human experience). */
  oldestFirst?: boolean
}

/** The workspace's catalog proposals, newest first unless asked otherwise. */
export async function listCatalogProposals(
  ctx: Context,
  workspaceId: string,
  input: ListProposalsInput = {},
): Promise<CatalogProposal[]> {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog.read",
    async (scope) => {
      const t = schema.catalogProposals
      const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)
      if (
        input.cursor !== undefined &&
        (!Number.isInteger(input.cursor) || input.cursor < 0)
      )
        throw new InvalidInputError("cursor", "cursor is a proposal number")
      const rows = await scope.tx
        .select()
        .from(t)
        .where(
          and(
            eq(t.workspaceId, scope.workspaceId),
            input.state === undefined ? undefined : eq(t.state, input.state),
            input.cursor === undefined
              ? undefined
              : input.oldestFirst
                ? gt(t.number, input.cursor)
                : lt(t.number, input.cursor),
          ),
        )
        .orderBy(input.oldestFirst ? asc(t.number) : desc(t.number))
        .limit(limit)
      return rows.map(proposalOf)
    },
    snapshotRead,
  )
}

type ProposalScope = WriteScope & {
  action: "catalog.propose" | "catalog.approve"
}

/** Applies, validates and classifies operations against the latest revision, in the catalog worker. */
async function prepare(
  scope: ProposalScope,
  operations: readonly CatalogOperation[],
  input: {
    by: string
    explanation: string
    approver: { handle: string; preview: boolean }
  },
): Promise<Prepared> {
  const d = schema.catalogDocuments
  const documents: LatestDocument[] = await scope.tx
    .select({ documentId: d.id, revision: d.currentRevision })
    .from(d)
    .where(eq(d.workspaceId, scope.workspaceId))
    .orderBy(asc(d.id))
  const memberHandles = await currentMemberHandles(scope.tx, scope.workspaceId)
  return catalogWorker().prepare(
    documents,
    async (wanted) => {
      const texts = await latestTexts(
        scope.tx,
        scope.workspaceId,
        wanted.map((w) => w.documentId),
      )
      return new Map(texts.map((t) => [t.documentId, t.text]))
    },
    {
      operations,
      by: input.by,
      explanation: input.explanation,
      now: Date.now(),
      memberHandles,
      approver: input.approver,
    },
  )
}

/** The handle of the person the scope's actor is or acts for. */
async function personHandle(scope: ProposalScope): Promise<string> {
  const [row] = await scope.tx
    .select({ handle: schema.people.handle })
    .from(schema.people)
    .where(eq(schema.people.id, scope.actor.personId!))
  return row!.handle
}

/**
 * Stores the prepared documents as a new catalog revision, credited to the
 * proposal's author, and records the proposal as applied (catalog §9).
 */
async function apply(
  scope: ProposalScope,
  row: ProposalRow,
  prepared: Extract<Prepared, { outcome: "ready" }>,
  options: { approvedBy: ProposalScope["actor"] | null },
): Promise<ProposalRow> {
  const approver = options.approvedBy
  const source: RevisionSource = {
    proposalId: row.id,
    basedOnRevision: row.basedOnRevision,
    ...(approver?.personId
      ? { approvedBy: { personId: approver.personId, label: approver.label } }
      : {}),
  }
  const author = authorOf(row)
  const { revision, documentIds } = await appendCatalogRevision(
    scope.tx,
    scope.workspaceId,
    author,
    prepared.documents.map((d) => ({
      ...(d.documentId ? { documentId: d.documentId } : {}),
      text: d.text,
      parsed: d.parsed,
    })),
    source,
  )
  const [updated] = await scope.tx
    .update(schema.catalogProposals)
    .set({
      state: "applied",
      appliedRevision: revision,
      approvalClasses: prepared.classes,
      approvalReasons: prepared.reasons,
      touches: prepared.touches,
      validation: prepared.warnings as unknown as Record<string, unknown>[],
      ...decided(scope),
    })
    .where(eq(schema.catalogProposals.id, row.id))
    .returning()
  await appendEvent(scope, {
    kind: "catalog.changed",
    credit: author,
    subjects: subjectsOf(updated!, documentIds),
    summary: `${author.label} changed ${headline(updated!)} (catalog proposal ${updated!.number}, revision ${revision})`,
    data: {
      ...eventData(updated!),
      revision,
      ...(approver ? { approvedBy: approver.label } : {}),
    },
  })
  if (approver)
    await recordSecurityEntry(scope.tx, {
      workspaceId: scope.workspaceId,
      action: "catalog-proposal.approved",
      outcome: "succeeded",
      actor: approver,
      subjectPersonId:
        row.actorPersonId === approver.personId ? null : row.actorPersonId,
      request: scope.request,
      details: { ...securityDetails(updated!), revision },
    })
  return updated!
}

/**
 * An `accepted` field names the `person` entity accepting a discrepancy
 * (catalog §4.7), so it is written only when that person's approval
 * applies the change: the entity's `member` fact holds their handle.
 * `accept-discrepancy` writes it from the approver; this checks the result.
 */
function checkAccepts(
  prepared: Extract<Prepared, { outcome: "ready" }>,
  handle: string,
) {
  for (const accept of prepared.accepts)
    if (!accept.memberHandles.includes(handle))
      throw new RuleViolationError(
        "accepted-not-approver",
        `This change accepts a discrepancy in the name of ${accept.entityId}. Only that person can, by approving it: \`accepted\` must name the person whose approval applies the change, and their person entity's \`member\` fact must hold their handle (${handle}).`,
      )
}

async function pendingProposal(
  scope: ProposalScope,
  proposalId: string,
): Promise<ProposalRow> {
  if (!isId(proposalId)) throw new NotFoundError()
  const [row] = await scope.tx
    .select()
    .from(schema.catalogProposals)
    .where(
      and(
        eq(schema.catalogProposals.workspaceId, scope.workspaceId),
        eq(schema.catalogProposals.id, proposalId.toLowerCase()),
      ),
    )
    .for("update")
  if (!row) throw new NotFoundError()
  if (row.state !== "pending")
    throw new RuleViolationError(
      "proposal-not-pending",
      `Catalog proposal ${row.number} is ${row.state}, not waiting for approval`,
    )
  return row
}

async function currentMemberHandles(
  tx: Transaction,
  workspaceId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ handle: schema.people.handle })
    .from(schema.members)
    .innerJoin(schema.people, eq(schema.people.id, schema.members.personId))
    .where(
      and(
        eq(schema.members.workspaceId, workspaceId),
        isNull(schema.members.removedAt),
      ),
    )
  return rows.map((r) => r.handle)
}

function refusal(
  prepared: Exclude<Prepared, { outcome: "ready" }>,
): NotApplied {
  if (prepared.outcome === "blocked")
    return { outcome: "blocked", problems: prepared.problems }
  if (prepared.outcome === "unchanged") return { outcome: "unchanged" }
  return {
    outcome: prepared.problems.some((p) => p.kind === "conflict")
      ? "conflict"
      : "invalid",
    problems: prepared.problems,
  }
}

function actorColumns(actor: EventCredit) {
  return {
    actorKind: actor.kind,
    actorPersonId: actor.personId,
    actorAgentId: actor.agentId,
    actorAgentSessionId: actor.agentSessionId,
    actorLabel: actor.label,
    confidence: actor.confidence,
  }
}

function authorOf(row: ProposalRow): EventCredit {
  return {
    kind: row.actorKind,
    personId: row.actorPersonId,
    agentId: row.actorAgentId,
    agentSessionId: row.actorAgentSessionId,
    label: row.actorLabel,
    confidence: row.confidence,
  }
}

function decided(scope: ProposalScope) {
  return {
    decidedAt: new Date(),
    decidedByPersonId: scope.actor.personId,
    decidedByAgentId: scope.actor.agentId,
    decidedByLabel: scope.actor.label,
  }
}

/** The proposal and the catalog documents it changes, for their timelines. */
function subjectsOf(row: ProposalRow, documentIds: readonly string[] = []) {
  return [
    { type: "catalog-proposal", id: row.id },
    ...documentIds.map((id) => ({ type: "catalog-document", id })),
  ]
}

/**
 * What a proposal changes, for timelines: catalog IDs, never its text or
 * explanation, which validation may have held as secret-looking.
 */
function headline(row: ProposalRow): string {
  const shown = row.touches.slice(0, 3).join(", ")
  const more = row.touches.length - 3
  return more > 0 ? `${shown} and ${more} more` : shown
}

function eventData(row: ProposalRow): Record<string, unknown> {
  return {
    proposalId: row.id,
    number: row.number,
    approvalClasses: row.approvalClasses,
    touches: row.touches,
    ...(row.relatedTask ? { relatedTask: row.relatedTask } : {}),
  }
}

/** For the security log: structured values, never catalog text (identity §11). */
function securityDetails(row: ProposalRow): Record<string, unknown> {
  return {
    proposalId: row.id,
    number: row.number,
    approvalClasses: row.approvalClasses,
    author: row.actorLabel,
  }
}

function hashOf(proposal: {
  explanation: string
  relatedTask?: string | null
  operations: readonly CatalogOperation[]
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        proposal.explanation,
        proposal.relatedTask ?? null,
        proposal.operations,
      ]),
    )
    .digest("base64url")
}

function proposalOf(row: ProposalRow): CatalogProposal {
  return {
    id: row.id,
    number: row.number,
    state: row.state,
    createdAt: row.createdAt,
    author: { kind: row.actorKind, label: row.actorLabel },
    explanation: row.explanation,
    relatedTask: row.relatedTask,
    operations: row.operations as CatalogOperation[],
    basedOnRevision: row.basedOnRevision,
    approvalClasses: row.approvalClasses as ApprovalClass[],
    approvalReasons: row.approvalReasons,
    warnings: row.validation as unknown as Problem[],
    touches: row.touches,
    appliedRevision: row.appliedRevision,
    decidedAt: row.decidedAt,
    decidedBy: row.decidedByLabel,
    rejectionReason: row.rejectionReason,
  }
}
