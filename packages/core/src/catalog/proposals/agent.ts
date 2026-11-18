import { and, eq, inArray, or, schema, sql } from "@shinan/db"
import type { Transaction } from "@shinan/db"

import type { AgentActor } from "../../actor.js"
import { inWorkspace, snapshotRead } from "../../authorize.js"
import type { Context } from "../../context.js"
import { NotFoundError, RuleViolationError } from "../../errors.js"
import type { OperationProblem, Problem } from "../document/index.js"
import {
  documentLabels,
  inheritLabels,
  labelForActor,
  labelForWrittenActor,
  lessTrusted,
  shinanLabel,
} from "../index/labels.js"
import type { TrustLabel } from "../index/labels.js"
import {
  getCatalogProposal,
  proposeCatalogChange,
  withdrawCatalogProposal,
} from "./proposals.js"
import type { CatalogProposal, ProposalOutcome } from "./proposals.js"
import {
  commentOnCatalogProposal,
  listCatalogProposalComments,
} from "./review.js"
import type { CatalogProposalComment } from "./review.js"

/**
 * Catalog proposals as agents make and read them (agent integrations, tool
 * set: Catalog): M2-4's operations in the agent's own workspace, answered
 * in the agent index's field names with a trust label on every object that
 * holds text. The MCP tools (M2-6) only translate to these.
 *
 * Labels (agent integrations, "Trust labels"):
 *
 * - a proposal's own text (explanation, operations, approval reasons,
 *   warnings): the least trusted of its author and every catalog document
 *   it names, since operations' expectations copy those documents' text and
 *   Shinan's reasons and warnings quote their IDs. A document not in the
 *   catalog (one the proposal creates) was written by the author alone;
 * - a rejection's reason: the person who rejected it;
 * - problems of a proposal that did not apply (nothing stored): the least
 *   trusted of the agent and the documents its operations name;
 * - the outcome itself: `shinan`.
 */

/** A catalog proposal in the agent index's field names (catalog §12.4). */
export interface AgentProposalJson {
  id: string
  number: number
  state: CatalogProposal["state"]
  created_at: string
  /** The author's written form (identity §8.7). */
  author: string
  author_kind: CatalogProposal["author"]["kind"]
  explanation: string
  related_task: string | null
  operations: unknown[]
  based_on_revision: number
  approval_classes: string[]
  /** Why it waits for catalog approval; empty when it applies on its own. */
  approval_reasons: string[]
  warnings: (AgentProblemJson & { severity: string })[]
  /** The catalog IDs of the documents it changes. */
  touches: string[]
  applied_revision: number | null
  decided_at: string | null
  /** Who applied, rejected or withdrew it. */
  decided_by: string | null
  rejection: { reason: string; by: string | null; label: TrustLabel } | null
  label: TrustLabel
}

export interface AgentProblemJson {
  /** The operation's position in `operations`, from 0, when it is about one. */
  operation?: number
  kind?: "conflict" | "invalid"
  severity?: string
  code: string
  message: string
  document_id: string | null
  label?: TrustLabel
}

/**
 * What became of a proposal, or a proposal as it is now: `applied`,
 * `pending` (waiting for catalog approval), `rejected` or `withdrawn` with
 * the stored `proposal`; `conflict`, `invalid` or `blocked` with the
 * `problems` (nothing was stored); `unchanged` (nothing to do).
 */
export interface AgentProposalAnswer {
  outcome:
    CatalogProposal["state"] | "conflict" | "invalid" | "blocked" | "unchanged"
  proposal?: AgentProposalJson
  problems?: AgentProblemJson[]
  /** With `get_catalog_proposal`: a page of its comments, oldest first. */
  comments?: AgentCommentJson[]
  /** How many comments the proposal has in all. */
  comment_count?: number
  /** Pass as `comments_cursor` for the next page; null on the last. */
  comments_next_cursor?: string | null
  label: TrustLabel
}

/** A comment on a proposal, labelled by who wrote it. */
export interface AgentCommentJson {
  id: string
  proposal_id: string
  created_at: string
  author: string
  author_kind: "person" | "agent"
  text: string
  label: TrustLabel
}

/** The agent's own workspace: tools never take one. */
function agentOf(ctx: Context): AgentActor {
  if (ctx.actor.kind !== "agent") throw new NotFoundError()
  return ctx.actor
}

/**
 * The `propose_catalog_change` tool: a catalog proposal as the agent sent
 * it (`explanation`, `operations`, `relatedTask`, `idempotencyKey`), checked
 * and applied by core (`proposeCatalogChange`) in the catalog worker with
 * its time limit. May throw `BusyError`: send it again, with the same key.
 */
export async function agentProposeCatalogChange(
  ctx: Context,
  input: unknown,
): Promise<AgentProposalAnswer> {
  const agent = agentOf(ctx)
  const outcome = await proposeCatalogChange(ctx, agent.workspaceId, input)
  return answerOf(ctx, agent, outcome, operationsOf(input))
}

export interface AgentRecheckInput {
  /** The entity, by ID or alias. */
  document: unknown
  /** The facts checked, each as it is now (`expectationOf`). */
  facts: unknown
  /** The fact check: `checked`, `scope`, `source`, `limits`. */
  check: unknown
  /** Why; by default, one line naming the entity. */
  explanation?: unknown
  relatedTask?: unknown
  idempotencyKey?: unknown
}

/**
 * The `record_fact_check` tool: a recheck of facts whose values did not
 * change, as a proposal with one `recheck-facts` operation (catalog §4.5,
 * §8.1). It applies on its own unless it is doubtful, such as a check
 * older than the current one (§8.2).
 */
export async function agentRecordFactCheck(
  ctx: Context,
  input: AgentRecheckInput,
): Promise<AgentProposalAnswer> {
  const explanation =
    input.explanation ??
    (typeof input.document === "string"
      ? `Rechecked facts of ${input.document.slice(0, 500)} at their source; the values did not change.`
      : "Rechecked facts at their source; the values did not change.")
  return agentProposeCatalogChange(ctx, {
    explanation,
    operations: [
      {
        op: "recheck-facts",
        document: input.document,
        facts: input.facts,
        check: input.check,
      },
    ],
    ...(input.relatedTask === undefined
      ? {}
      : { relatedTask: input.relatedTask }),
    ...(input.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: input.idempotencyKey }),
  })
}

/** How many comments `get_catalog_proposal` gives at a time. */
export const agentCommentPage = 20

/**
 * The `get_catalog_proposal` tool: one proposal of the agent's workspace,
 * with its comments a page at a time, oldest first: `agentCommentPage`
 * from the start, or after `commentsCursor`.
 */
export async function agentGetCatalogProposal(
  ctx: Context,
  proposalId: string,
  options: { commentsCursor?: string } = {},
): Promise<AgentProposalAnswer> {
  const agent = agentOf(ctx)
  const proposal = await getCatalogProposal(ctx, agent.workspaceId, proposalId)
  const answer = await answerOf(
    ctx,
    agent,
    { outcome: proposal.state, proposal },
    [],
  )
  const comments = await listCatalogProposalComments(
    ctx,
    agent.workspaceId,
    proposal.id,
    {
      limit: agentCommentPage,
      ...(options.commentsCursor === undefined
        ? {}
        : { cursor: options.commentsCursor }),
    },
  )
  answer.comments = comments.items.map(commentJson)
  answer.comment_count = comments.total
  answer.comments_next_cursor = comments.nextCursor
  return answer
}

/**
 * The `comment_on_catalog_proposal` tool: a comment on a proposal of the
 * agent's workspace, such as review findings (catalog §8.6); only people
 * approve. A retry with the same `idempotencyKey` is stored once. May
 * throw `BusyError` when the agent sent too many: send it again later.
 */
export async function agentCommentOnCatalogProposal(
  ctx: Context,
  input: { proposalId: string; text: string; idempotencyKey?: string },
): Promise<{ comment: AgentCommentJson; label: TrustLabel }> {
  const agent = agentOf(ctx)
  const comment = await commentOnCatalogProposal(ctx, agent.workspaceId, {
    proposalId: input.proposalId,
    text: input.text,
    ...(input.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: input.idempotencyKey }),
  })
  return { comment: commentJson(comment), label: shinanLabel }
}

function commentJson(comment: CatalogProposalComment): AgentCommentJson {
  return {
    id: comment.id,
    proposal_id: comment.proposalId,
    created_at: comment.createdAt.toISOString(),
    author: comment.author.label,
    author_kind: comment.author.kind,
    text: comment.text,
    label: labelForActor(comment.author.kind, comment.author.label),
  }
}

/**
 * The `withdraw_catalog_proposal` tool: withdraws the agent's own waiting
 * proposal. Safe to repeat: a proposal this agent already withdrew is
 * answered as it is.
 */
export async function agentWithdrawCatalogProposal(
  ctx: Context,
  proposalId: string,
): Promise<AgentProposalAnswer> {
  const agent = agentOf(ctx)
  let proposal: CatalogProposal
  try {
    proposal = await withdrawCatalogProposal(ctx, agent.workspaceId, proposalId)
  } catch (error) {
    if (!(error instanceof RuleViolationError)) throw error
    const current = await getCatalogProposal(ctx, agent.workspaceId, proposalId)
    if (!(await withdrawnByThisAgent(ctx, agent, current.id))) throw error
    proposal = current
  }
  return answerOf(ctx, agent, { outcome: proposal.state, proposal }, [])
}

/**
 * Whether the agent making the request wrote the proposal and withdrew it,
 * by agent ID: an agent made again under the same handle has the same
 * label but is another agent.
 */
async function withdrawnByThisAgent(
  ctx: Context,
  agent: AgentActor,
  proposalId: string,
): Promise<boolean> {
  return inWorkspace(
    ctx,
    agent.workspaceId,
    "catalog.read",
    async (scope) => {
      const p = schema.catalogProposals
      const [row] = await scope.tx
        .select({
          state: p.state,
          author: p.actorAgentId,
          decidedBy: p.decidedByAgentId,
        })
        .from(p)
        .where(and(eq(p.workspaceId, scope.workspaceId), eq(p.id, proposalId)))
      return (
        row?.state === "withdrawn" &&
        row.author === agent.agentId &&
        row.decidedBy === agent.agentId
      )
    },
    snapshotRead,
  )
}

/** The answer, with every label worked out from Shinan's records. */
async function answerOf(
  ctx: Context,
  agent: AgentActor,
  outcome: ProposalOutcome,
  operations: readonly unknown[],
): Promise<AgentProposalAnswer> {
  const proposal = "proposal" in outcome ? outcome.proposal : undefined
  const problems: (OperationProblem | Problem)[] =
    "problems" in outcome ? outcome.problems : []
  const named = new Set<string>()
  for (const id of documentIdsOf(proposal ? proposal.operations : operations))
    named.add(id)
  for (const id of proposal?.touches ?? []) named.add(id)
  for (const p of [...problems, ...(proposal?.warnings ?? [])])
    if (p.documentId !== null) named.add(p.documentId)

  return inWorkspace(
    ctx,
    agent.workspaceId,
    "catalog.read",
    async (scope) => {
      const labels = await documentLabels(
        scope.tx,
        scope.workspaceId,
        await catalogIdsOf(scope.tx, scope.workspaceId, [...named]),
      )
      let label = proposal
        ? labelForActor(proposal.author.kind, proposal.author.label)
        : labelForActor("agent", scope.actor.label)
      for (const documentLabel of labels.values())
        label = lessTrusted(label, documentLabel)

      const answer: AgentProposalAnswer = {
        outcome: outcome.outcome,
        label: shinanLabel,
      }
      if (proposal) answer.proposal = proposalJson(proposal, label)
      if ("problems" in outcome)
        answer.problems = outcome.problems.map((p) => ({
          ...problemJson(p),
          label,
        }))
      inheritLabels(answer.proposal, label)
      return answer
    },
    snapshotRead,
  )
}

function proposalJson(
  proposal: CatalogProposal,
  label: TrustLabel,
): AgentProposalJson {
  return {
    id: proposal.id,
    number: proposal.number,
    state: proposal.state,
    created_at: proposal.createdAt.toISOString(),
    author: proposal.author.label,
    author_kind: proposal.author.kind,
    explanation: proposal.explanation,
    related_task: proposal.relatedTask,
    operations: proposal.operations,
    based_on_revision: proposal.basedOnRevision,
    approval_classes: proposal.approvalClasses,
    approval_reasons: proposal.approvalReasons,
    warnings: proposal.warnings.map((w) => ({
      ...problemJson(w),
      severity: w.severity,
      label,
    })),
    touches: proposal.touches,
    applied_revision: proposal.appliedRevision,
    decided_at: proposal.decidedAt?.toISOString() ?? null,
    decided_by: proposal.decidedBy,
    // Only people reject (catalog §8.6): the reason is theirs.
    rejection:
      proposal.state === "rejected" && proposal.rejectionReason !== null
        ? {
            reason: proposal.rejectionReason,
            by: proposal.decidedBy,
            label: labelForWrittenActor(proposal.decidedBy),
          }
        : null,
    label,
  }
}

function problemJson(problem: OperationProblem | Problem): AgentProblemJson {
  return {
    ...("operation" in problem
      ? { operation: problem.operation, kind: problem.kind }
      : { severity: problem.severity }),
    code: problem.code,
    message: problem.message,
    document_id: problem.documentId,
  }
}

/** The operations an agent sent, if they are a list. */
function operationsOf(input: unknown): unknown[] {
  if (typeof input !== "object" || input === null) return []
  const operations = (input as { operations?: unknown }).operations
  return Array.isArray(operations) ? operations.slice(0, 100) : []
}

/** The catalog IDs operations name as the document they change or create. */
function documentIdsOf(operations: readonly unknown[]): string[] {
  const ids: string[] = []
  for (const operation of operations) {
    if (typeof operation !== "object" || operation === null) continue
    const { document, id, op, type } = operation as Record<string, unknown>
    if (typeof document === "string") ids.push(document.slice(0, 500))
    if (typeof id === "string") ids.push(id.slice(0, 500))
    if (op === "create-schema" && typeof type === "string")
      ids.push(`schema/${type.slice(0, 100)}`)
    if (op === "create-start-here" || op === "set-start-here-path")
      ids.push("start-here")
  }
  return ids
}

/**
 * The catalog IDs of the documents these names find, by ID or by alias
 * (catalog §2.4). A name that finds none is one the proposal itself
 * creates, or none at all: only its author wrote it.
 */
async function catalogIdsOf(
  tx: Transaction,
  workspaceId: string,
  names: readonly string[],
): Promise<string[]> {
  if (names.length === 0) return []
  const d = schema.catalogIndexDocuments
  const rows = await tx
    .select({ catalogId: d.catalogId })
    .from(d)
    .where(
      and(
        eq(d.workspaceId, workspaceId),
        or(
          inArray(d.catalogId, [...names]),
          sql`${d.aliases} && array[${sql.join(
            names.map((n) => sql`${n}`),
            sql`, `,
          )}]::text[]`,
        ),
      ),
    )
  return rows.flatMap((r) => (r.catalogId === null ? [] : [r.catalogId]))
}
