import { createHash } from "node:crypto"

import {
  and,
  asc,
  createLimitedLog,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  schema,
  sql,
} from "@shinan/db"
import type { Transaction } from "@shinan/db"

import { shinan } from "../../actor.js"
import type { ResolvedActor } from "../../actor.js"
import { inWorkspace, mayAlso, snapshotRead } from "../../authorize.js"
import type { Context } from "../../context.js"
import {
  BusyError,
  InvalidInputError,
  NotFoundError,
  RuleViolationError,
} from "../../errors.js"
import { appendEvent } from "../../events.js"
import type { EventCredit, WriteScope } from "../../events.js"
import { rateLimits, takeRateLimit } from "../../rate-limits.js"
import { recordSecurityEntry } from "../../security-log.js"
import { checkStorable, isId } from "../../validation.js"
import type {
  CatalogOperation,
  OperationProblem,
  Problem,
} from "../document/index.js"
import { lockIndexState } from "../index/indexer.js"
import { latestRevision } from "../index/store.js"
import { appendCatalogRevision } from "../revisions.js"
import type { RevisionSource } from "../revisions.js"
import { isGated } from "./classify.js"
import type { ApprovalClass } from "./classify.js"
import { checkProposalInput } from "./input.js"
import { catalogWorkers } from "./pool.js"
import type { LatestDocument, Prepare } from "./pool.js"
import type { LoadedText } from "./protocol.js"
import type { CatalogSize, Prepared, PrepareInput } from "./work.js"

export type ProposalRow = typeof schema.catalogProposals.$inferSelect
export type CatalogProposalState = ProposalRow["state"]

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
  /** The applied proposal this one reverts, for a revert. */
  revertsProposalId: string | null
  /**
   * Whether its author is still a current member, or an enabled agent of
   * one, so a reviewer looks harder at a proposal from a disabled agent or a
   * member who left (catalog §8.2). Given by the operations that read
   * proposals (`getCatalogProposal`, `listCatalogProposals`, the recent
   * changes); left out where a proposal was just made or decided.
   */
  authorStatus?: AuthorStatus
}

export type AuthorStatus = "current" | "agent-disabled" | "member-left"

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
 * The most a workspace's catalog may hold (**proposed**, M2-4; raised with
 * incremental validation, #116): 20,000 documents, 50 MiB of text, and
 * 320 MiB as the catalog worker estimates its memory with its validation
 * (`estimatedBytes`), which bounds documents full of facts, links, problems
 * or suspected secrets. A proposal that would take the catalog past any of
 * them, and grow it, is refused; one that shrinks it always applies.
 * Reason: each workspace's catalog is kept parsed and validated in a
 * catalog worker with bounded memory (`CatalogWorkerOptions`), and an
 * agent's new entities apply on their own (§8.2). At these limits, on
 * Daedalus under a load of 6 to 10 on 2 cores, a one-field change took
 * 0.1 to 2 s against a 20 s limit (most of it applying the operations,
 * which reads the catalog's entities twice), extending the type of every
 * document 0.1 to 1.3 s, and every shape measured ran within a 384 MiB
 * heap.
 */
export const catalogLimits = {
  documents: 20_000,
  bytes: 50 * 1024 * 1024,
  estimatedBytes: 320 * 1024 * 1024,
} as const

/**
 * How many times a proposal is applied again when another process stored a
 * revision first, before the author is told to send it again. Within a
 * process, a workspace's proposals take turns, so they never do.
 */
const attempts = 5

/**
 * Makes a catalog proposal (catalog §8.1), from a person or an agent: it
 * applies at once as a new catalog revision, or waits for catalog approval
 * when it is in a gated class (§8.2). A person's own gated edit applies at
 * once, since they may approve it.
 *
 * After a first check (permission, input, idempotency), the proposal takes
 * its turn in the workspace's queue (`CatalogWorkers.run`): it reads the
 * latest revision, the catalog worker applies the operations to it with no
 * transaction open, then a short transaction takes the index lock, checks
 * no other process stored a revision meanwhile (otherwise the turn starts
 * over) and stores the result. So a slow proposal holds no database
 * connection and no lock, and proposals are served in order (architecture
 * §5.3).
 *
 * `input` is checked here (`checkProposalInput`), so callers pass the
 * request's JSON as it came. May throw `BusyError` (the catalog workers'
 * queues are full, or an agent sent too many proposals): send it again.
 */
export async function proposeCatalogChange(
  ctx: Context,
  workspaceId: string,
  input: unknown,
): Promise<ProposalOutcome> {
  return submitProposal(ctx, workspaceId, () => {
    const proposal = checkProposalInput(input)
    return Promise.resolve({
      request: [
        proposal.explanation,
        proposal.relatedTask ?? null,
        proposal.operations,
      ],
      explanation: proposal.explanation,
      relatedTask: proposal.relatedTask ?? null,
      idempotencyKey: proposal.idempotencyKey ?? null,
      revertsProposalId: null,
      operations: () => Promise.resolve(proposal.operations),
    })
  })
}

/** A proposal to submit, as `submitProposal` takes it. */
export interface Submission {
  /**
   * The request as its author sent it, which a retry with the same
   * idempotency key must match: for a revert, the proposal it reverts and
   * the explanation, not the operations worked out from them.
   */
  request: unknown
  explanation: string
  relatedTask: string | null
  idempotencyKey: string | null
  /** The applied proposal it reverts, for a revert. */
  revertsProposalId: string | null
  /**
   * The operations, worked out in each attempt of the proposal's turn from
   * what that attempt reads, so text a purge removed meanwhile is never
   * used (M2-10), or why the proposal cannot be made.
   */
  operations: (scope: ProposalScope) => Promise<CatalogOperation[] | NotApplied>
}

/**
 * The path every proposal takes (`proposeCatalogChange`,
 * `revertCatalogProposal`): `prepare` checks the request in a first,
 * read-only transaction, where a retry with the same idempotency key gets
 * the stored proposal back; then the proposal takes its turn.
 */
export async function submitProposal(
  ctx: Context,
  workspaceId: string,
  prepare: (scope: ProposalScope) => Promise<Submission>,
): Promise<ProposalOutcome> {
  const plan = await inWorkspace(
    ctx,
    workspaceId,
    "catalog.propose",
    async (scope) => {
      const submission = await prepare(scope)
      const requestHash = hashOf(submission.request)
      const existing = await byIdempotencyKey(
        scope,
        submission.idempotencyKey,
        requestHash,
      )
      if (existing) return { replay: true as const, row: existing }
      return {
        replay: false as const,
        submission,
        requestHash,
        actor: scope.actor,
        // A person who may approve applies their own gated edit at once; for
        // anyone else, their person stands in for the approver until one
        // approves.
        approver: {
          handle: await personHandle(scope),
          preview: !mayApprove(scope),
        },
      }
    },
    snapshotRead,
  )
  if (plan.replay)
    return { outcome: plan.row.state, proposal: proposalOf(plan.row) }
  const { submission: proposal, requestHash } = plan
  const { revertsProposalId } = proposal

  return inTurn(
    ctx,
    workspaceId,
    "catalog.propose",
    plan.actor,
    async (base, prepare): Promise<Stored<ProposalOutcome>> => {
      const operations = base.operations!
      if (!Array.isArray(operations)) return { done: operations }
      const prepared = await work(ctx, workspaceId, "catalog.propose", {
        prepare,
        base,
        input: {
          operations,
          by: plan.actor.label,
          explanation: proposal.explanation,
          approver: plan.approver,
        },
      })
      if (prepared.outcome !== "ready") return { done: refusal(prepared) }
      checkCatalogSize(prepared.size)

      return inWorkspace(
        ctx,
        workspaceId,
        "catalog.propose",
        async (scope): Promise<Stored<ProposalOutcome>> => {
          // The index lock comes first on every path that applies, so two
          // applies never wait on each other's proposal rows.
          await lockIndexState(scope.tx, scope.workspaceId)
          const existing = await byIdempotencyKey(
            scope,
            proposal.idempotencyKey,
            requestHash,
          )
          if (existing)
            return {
              done: {
                outcome: existing.state,
                proposal: proposalOf(existing),
              },
            }
          if (
            (await latestRevision(scope.tx, scope.workspaceId)) !==
            base.revision
          )
            return { moved: true }

          const strict = await isStrict(scope)
          const gated = needsApproval(prepared.classes, strict)
          const appliesNow =
            mayApprove(scope) && !plan.approver.preview
              ? true
              : !gated && prepared.accepts.length === 0
          if (appliesNow) checkAccepts(prepared, plan.approver.handle)

          const [{ next }] = (await scope.tx
            .select({
              next: sql<number>`coalesce(max(${schema.catalogProposals.number}), 0)::int + 1`,
            })
            .from(schema.catalogProposals)
            .where(
              eq(schema.catalogProposals.workspaceId, scope.workspaceId),
            )) as [{ next: number }]
          const [row] = await scope.tx
            .insert(schema.catalogProposals)
            .values({
              workspaceId: scope.workspaceId,
              number: next,
              ...actorColumns(scope.actor),
              explanation: proposal.explanation,
              relatedTask: proposal.relatedTask,
              operations,
              basedOnRevision: base.revision,
              approvalClasses: prepared.classes,
              approvalReasons: reasonsFor(prepared, strict),
              touches: prepared.touches,
              validation: prepared.warnings as unknown as Record<
                string,
                unknown
              >[],
              idempotencyKey: proposal.idempotencyKey ?? null,
              requestHash,
              revertsProposalId,
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
            return {
              done: { outcome: "pending", proposal: proposalOf(row!) },
            }
          }
          const applied = await apply(scope, row!, prepared, {
            approvedBy: gated ? scope.actor : null,
            reasons: reasonsFor(prepared, strict),
          })
          return {
            done: { outcome: "applied", proposal: proposalOf(applied) },
          }
        },
      )
    },
    // Counted in the turn, so a proposal refused as busy is not.
    ctx.actor.kind === "agent" ? ctx.actor.agentId : null,
    proposal.operations,
  )
}

export type ApprovalOutcome =
  { outcome: "applied"; proposal: CatalogProposal } | NotApplied

/**
 * Gives catalog approval to a waiting proposal (catalog §8.2), which applies
 * it to the latest revision: its expectations are checked and the result
 * validated again, so a proposal that now conflicts stays waiting and the
 * approver is told why. Only people approve (identity §6.3). A person may
 * approve their own agents' proposals only while the workspace has one
 * member (D-024, O-46); otherwise another member approves. An
 * `accept-discrepancy` names the approver (catalog §4.7).
 *
 * Like `proposeCatalogChange`, it takes a turn in the workspace's queue.
 */
export async function approveCatalogProposal(
  ctx: Context,
  workspaceId: string,
  proposalId: string,
): Promise<ApprovalOutcome> {
  const plan = await inWorkspace(
    ctx,
    workspaceId,
    "catalog.approve",
    async (scope) => {
      const row = await pendingProposal(scope, proposalId, false)
      await checkNotOwnAgent(scope, row)
      return { row, actor: scope.actor }
    },
    snapshotRead,
  )
  const { row } = plan
  return inTurn(
    ctx,
    workspaceId,
    "catalog.approve",
    plan.actor,
    async (base, prepare): Promise<Stored<ApprovalOutcome>> => {
      const prepared = await work(ctx, workspaceId, "catalog.approve", {
        prepare,
        base,
        input: {
          operations: row.operations as CatalogOperation[],
          by: row.actorLabel,
          explanation: row.explanation,
          approver: { handle: plan.actor.label, preview: false },
        },
      })
      if (prepared.outcome !== "ready") return { done: refusal(prepared) }
      checkCatalogSize(prepared.size)

      return inWorkspace(
        ctx,
        workspaceId,
        "catalog.approve",
        async (scope): Promise<Stored<ApprovalOutcome>> => {
          await lockIndexState(scope.tx, scope.workspaceId)
          const current = await pendingProposal(scope, proposalId, true)
          await checkNotOwnAgent(scope, current)
          if (
            (await latestRevision(scope.tx, scope.workspaceId)) !==
            base.revision
          )
            return { moved: true }
          checkAccepts(prepared, scope.actor.label)
          const applied = await apply(scope, current, prepared, {
            approvedBy: scope.actor,
            reasons: reasonsFor(prepared, await isStrict(scope)),
          })
          return {
            done: { outcome: "applied", proposal: proposalOf(applied) },
          }
        },
      )
    },
    null,
  )
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
    checkStorable(reason, "The reason")
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
      return (await withAuthorStatus(scope.tx, scope.workspaceId, [row]))[0]!
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
      return withAuthorStatus(scope.tx, scope.workspaceId, rows)
    },
    snapshotRead,
  )
}

export type ProposalScope = WriteScope & {
  action: "catalog.propose" | "catalog.approve"
}

/** The latest revision a proposal is worked out against. */
interface Base {
  revision: number
  documents: LatestDocument[]
  memberHandles: string[]
  /** A submission's operations, worked out from the same snapshot. */
  operations?: CatalogOperation[] | NotApplied
}

/** What one attempt did: finished, or found that another process stored a revision first. */
type Stored<T> = { done: T } | { moved: true }

async function readBase(scope: ProposalScope): Promise<Base> {
  const d = schema.catalogDocuments
  const documents: LatestDocument[] = await scope.tx
    .select({ documentId: d.id, revision: d.currentRevision })
    .from(d)
    .where(eq(d.workspaceId, scope.workspaceId))
    .orderBy(asc(d.id))
  return {
    revision: await latestRevision(scope.tx, scope.workspaceId),
    documents,
    memberHandles: await currentMemberHandles(scope.tx, scope.workspaceId),
  }
}

/**
 * Takes a turn in the workspace's queue of catalog work: reads the latest
 * revision and runs `attempt` on it, again with a new one (up to
 * `attempts` times) if another process stored a revision first. An
 * agent's proposal counts against its rate limit when its turn comes.
 */
async function inTurn<T>(
  ctx: Context,
  workspaceId: string,
  action: ProposalScope["action"],
  actor: ResolvedActor,
  attempt: (base: Base, prepare: Prepare) => Promise<Stored<T>>,
  agentId: string | null,
  operations?: Submission["operations"],
): Promise<T> {
  try {
    return await catalogWorkers().run(workspaceId, async (prepare) => {
      if (agentId) await throttle(ctx, agentId)
      for (let n = 1; ; n++) {
        // The operations are worked out from the same snapshot as the base.
        const base = await inWorkspace(
          ctx,
          workspaceId,
          action,
          async (scope) => {
            const read = await readBase(scope)
            return operations
              ? { ...read, operations: await operations(scope) }
              : read
          },
          snapshotRead,
        )
        const stored = await attempt(base, prepare)
        if ("done" in stored) return stored.done
        if (n === attempts) throw changingTooFast()
      }
    })
  } catch (error) {
    if (
      error instanceof RuleViolationError &&
      workerFailures.includes(error.rule)
    )
      await reportWorkerFailure(ctx, workspaceId, actor, error.rule)
    throw error
  }
}

/** Why a catalog worker could not hold or read a workspace's catalog. */
const workerFailures = ["catalog-too-large", "catalog-unreadable"]

const failureLog = createLimitedLog({ intervalMs: 60 * 60 * 1000 })
const failuresRecorded = new Map<string, number>()

/**
 * A catalog that does not fit in its worker, or cannot be read in time,
 * stops every proposal in the workspace until an operator acts (operator
 * guide): it is logged for the operator and recorded in the workspace's
 * security log, at most once an hour per workspace and process.
 */
async function reportWorkerFailure(
  ctx: Context,
  workspaceId: string,
  actor: ResolvedActor,
  rule: string,
) {
  const key = `${workspaceId}:${rule}`
  failureLog(
    key,
    `Catalog worker: workspace ${workspaceId}: ${rule}. Proposals there fail until it is fixed; see the operator guide, "Catalog workers".`,
  )
  const now = Date.now()
  const last = failuresRecorded.get(key)
  if (last !== undefined && now - last < 60 * 60 * 1000) return
  failuresRecorded.set(key, now)
  await recordSecurityEntry(ctx.db, {
    workspaceId,
    action: "catalog-worker.failed",
    outcome: "failed",
    actor,
    request: ctx.request ?? {},
    details: { reason: rule },
  })
}

/**
 * Applies, validates and classifies operations against a base revision in
 * the workspace's catalog worker. Stored texts the worker lacks are read in
 * short read-only transactions of their own, each checked like any read.
 */
async function work(
  ctx: Context,
  workspaceId: string,
  action: ProposalScope["action"],
  turn: {
    prepare: Prepare
    base: Base
    input: Omit<PrepareInput, "now" | "memberHandles">
  },
): Promise<Prepared> {
  return turn.prepare(
    turn.base.documents,
    (documents) =>
      inWorkspace(
        ctx,
        workspaceId,
        action,
        (scope) => textsAt(scope.tx, scope.workspaceId, documents),
        snapshotRead,
      ),
    {
      ...turn.input,
      now: Date.now(),
      memberHandles: turn.base.memberHandles,
    },
  )
}

/** Stored texts at given revisions; never edited, so any snapshot agrees. */
async function textsAt(
  tx: Transaction,
  workspaceId: string,
  documents: readonly LatestDocument[],
): Promise<LoadedText[]> {
  if (documents.length === 0) return []
  const r = schema.catalogRevisionDocuments
  return tx
    .select({ documentId: r.documentId, revision: r.revision, text: r.text })
    .from(r)
    .where(
      and(
        eq(r.workspaceId, workspaceId),
        sql`(${r.documentId}, ${r.revision}) in (${sql.join(
          documents.map(
            (d) => sql`(${d.documentId}::uuid, ${d.revision}::int)`,
          ),
          sql`, `,
        )})`,
      ),
    )
}

/** The reason the strict setting adds (catalog §8.2). */
export const strictReason =
  "The workspace's strict setting is on: every change except a recheck needs catalog approval"

/**
 * Whether a change needs catalog approval: it is in a gated class, or the
 * strict setting is on and it is more than a recheck (catalog §8.2).
 */
function needsApproval(classes: readonly ApprovalClass[], strict: boolean) {
  return isGated(classes) || (strict && classes.some((c) => c !== "recheck"))
}

function reasonsFor(
  prepared: Extract<Prepared, { outcome: "ready" }>,
  strict: boolean,
): string[] {
  return strict &&
    !isGated(prepared.classes) &&
    needsApproval(prepared.classes, strict)
    ? [...prepared.reasons, strictReason]
    : prepared.reasons
}

async function isStrict(scope: ProposalScope): Promise<boolean> {
  const [workspace] = await scope.tx
    .select({ strict: schema.workspaces.catalogStrict })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, scope.workspaceId))
  return workspace?.strict ?? false
}

function mayApprove(scope: ProposalScope): boolean {
  return scope.actor.kind === "person" && mayAlso(scope, "catalog.approve")
}

/** Counts an agent's proposal against its rate limit (`rateLimits`). */
async function throttle(ctx: Context, agentId: string): Promise<void> {
  const outcome = await takeRateLimit(
    { db: ctx.db, actor: shinan, request: ctx.request ?? {} },
    "catalog-proposal",
    { key: agentId },
  )
  if (!outcome.allowed)
    throw new BusyError(
      "catalog-proposal-rate",
      `This agent has sent ${rateLimits["catalog-proposal"].max} catalog proposals in ${rateLimits["catalog-proposal"].windowSeconds / 60} minutes; send this one again later`,
      outcome.retryAfterSeconds,
    )
}

/**
 * Refuses a change that takes a catalog past any of its limits and grows
 * it (`catalogLimits`); a change that shrinks it always applies.
 */
export function checkCatalogSize(
  size: CatalogSize,
  limits: {
    documents: number
    bytes: number
    estimatedBytes: number
  } = catalogLimits,
): void {
  const mib = (n: number) => Math.round(n / 1024 / 1024)
  const past =
    (size.documents > limits.documents &&
      size.documents > size.documentsBefore) ||
    (size.bytes > limits.bytes && size.bytes > size.bytesBefore) ||
    (size.estimated > limits.estimatedBytes &&
      size.estimated > size.estimatedBefore)
  if (past)
    throw new RuleViolationError(
      "catalog-full",
      `A workspace's catalog holds at most ${limits.documents} documents, ${mib(limits.bytes)} MiB of text and ${mib(limits.estimatedBytes)} MiB as Shinan holds it in memory (facts count most); this change would take it to ${size.documents} documents, ${mib(size.bytes)} MiB and ${mib(size.estimated)} MiB. Retire or shorten documents first.`,
    )
}

function changingTooFast(): BusyError {
  return new BusyError(
    "catalog-changing",
    "Other changes to the catalog kept applying first; send this proposal again",
    1,
  )
}

/**
 * A person may approve their own agents' proposals only while the
 * workspace has one current member (D-024, O-46).
 */
async function checkNotOwnAgent(scope: ProposalScope, row: ProposalRow) {
  if (row.actorKind !== "agent" || row.actorPersonId !== scope.actor.personId)
    return
  const [{ members }] = (await scope.tx
    .select({ members: sql<number>`count(*)::int` })
    .from(schema.members)
    .where(
      and(
        eq(schema.members.workspaceId, scope.workspaceId),
        isNull(schema.members.removedAt),
      ),
    )) as [{ members: number }]
  if (members > 1)
    throw new RuleViolationError(
      "own-agent",
      "Another member approves your agents' catalog proposals: you may approve them yourself only while you are the workspace's only member",
    )
}

/** A stored proposal with the author's idempotency key, if any; refused if its content differs. */
async function byIdempotencyKey(
  scope: ProposalScope,
  key: string | null | undefined,
  requestHash: string,
): Promise<ProposalRow | null> {
  if (!key) return null
  const t = schema.catalogProposals
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
  if (existing.requestHash !== requestHash)
    throw new InvalidInputError(
      "idempotency-key-reused",
      "You used this idempotency key for a different proposal",
    )
  return existing
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
  options: {
    approvedBy: ProposalScope["actor"] | null
    /** Why it needed catalog approval, if it did. */
    reasons: string[]
  },
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
      approvalReasons: options.reasons,
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
  lock = true,
): Promise<ProposalRow> {
  if (!isId(proposalId)) throw new NotFoundError()
  const query = scope.tx
    .select()
    .from(schema.catalogProposals)
    .where(
      and(
        eq(schema.catalogProposals.workspaceId, scope.workspaceId),
        eq(schema.catalogProposals.id, proposalId.toLowerCase()),
      ),
    )
  const [row] = lock ? await query.for("update") : await query
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

function hashOf(request: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(request)))
    .digest("base64url")
}

/** The same value with every map's keys sorted, so key order does not change the hash. */
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

/** The proposals, each with whether its author is still current. */
export async function withAuthorStatus(
  tx: Transaction,
  workspaceId: string,
  rows: readonly ProposalRow[],
): Promise<CatalogProposal[]> {
  const people = [
    ...new Set(rows.flatMap((r) => (r.actorPersonId ? [r.actorPersonId] : []))),
  ]
  const agentIds = [
    ...new Set(rows.flatMap((r) => (r.actorAgentId ? [r.actorAgentId] : []))),
  ]
  const members =
    people.length === 0
      ? []
      : await tx
          .select({ personId: schema.members.personId })
          .from(schema.members)
          .where(
            and(
              eq(schema.members.workspaceId, workspaceId),
              inArray(schema.members.personId, people),
              isNull(schema.members.removedAt),
            ),
          )
  const current = new Set(members.map((m) => m.personId))
  const agents =
    agentIds.length === 0
      ? []
      : await tx
          .select({ id: schema.agents.id, enabled: schema.agents.enabled })
          .from(schema.agents)
          .where(inArray(schema.agents.id, agentIds))
  const enabled = new Set(agents.filter((a) => a.enabled).map((a) => a.id))
  return rows.map((row) => ({
    ...proposalOf(row),
    authorStatus:
      row.actorPersonId && !current.has(row.actorPersonId)
        ? "member-left"
        : row.actorAgentId && !enabled.has(row.actorAgentId)
          ? "agent-disabled"
          : "current",
  }))
}

export function proposalOf(row: ProposalRow): CatalogProposal {
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
    revertsProposalId: row.revertsProposalId,
  }
}
