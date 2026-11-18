import { createHash } from "node:crypto"

import { and, eq, schema } from "@shinan/db"

import type { Context } from "../../context.js"
import { InvalidInputError, NotFoundError } from "../../errors.js"
import type { CatalogOperation } from "../document/index.js"
import { findCatalogDocument } from "../revisions.js"
import { proposalLimits } from "./input.js"
import { submitProposal } from "./proposals.js"
import type { NotApplied, ProposalOutcome, ProposalScope } from "./proposals.js"
import { checkKey } from "./review.js"

/** What a workspace owner sends to repair a document. */
export interface RepairInput {
  /** The document's catalog ID, or one of its aliases. */
  id: unknown
  /**
   * The catalog revision of the text the owner corrected, as the wiki read
   * it: the repair applies only while the document is still at it.
   */
  revision: unknown
  /** The document's whole corrected text. */
  text: unknown
  explanation: unknown
  idempotencyKey?: unknown
}

/**
 * Repairs a catalog document that reads with problems by replacing its
 * whole text (catalog §8.3): for a fact the parser can no longer read, which
 * no other operation can name, so validation would otherwise block every
 * later change to the document.
 *
 * Only a workspace owner who signed in again recently may, never an agent
 * (`catalog.repair`). It is a catalog proposal like any other, made of one
 * `restore-document` operation, the one a revert uses, and takes the same
 * turn, validation and records. Validation charges the document only with
 * problems it did not already have, so a repair may fix some and leave the
 * rest; anything it newly breaks, in it or elsewhere, blocks it. It applies
 * at once and is recorded as the owner's approval in the security log.
 */
export async function repairCatalogDocument(
  ctx: Context,
  workspaceId: string,
  input: RepairInput,
): Promise<ProposalOutcome> {
  return submitProposal(
    ctx,
    workspaceId,
    () => {
      const id = checkId(input.id)
      const revision = checkRevision(input.revision)
      const text = checkText(input.text)
      const explanation = checkExplanation(input.explanation)
      return Promise.resolve({
        request: ["repair", id, revision, text, explanation],
        explanation,
        relatedTask: null,
        idempotencyKey: checkKey(input.idempotencyKey),
        revertsProposalId: null,
        // Read in each attempt of the turn, from the text stored then.
        operations: (attempt: ProposalScope) =>
          repairOperations(attempt, { id, revision, text }),
      })
    },
    { repair: true },
  )
}

async function repairOperations(
  scope: ProposalScope,
  input: { id: string; revision: number; text: string },
): Promise<CatalogOperation[] | NotApplied> {
  const documentId = await findCatalogDocument(
    scope.tx,
    scope.workspaceId,
    input.id,
  )
  if (!documentId) throw new NotFoundError()
  const d = schema.catalogDocuments
  const r = schema.catalogRevisionDocuments
  const [current] = await scope.tx
    .select({
      revision: d.currentRevision,
      text: r.text,
      catalogId: schema.catalogIndexDocuments.catalogId,
    })
    .from(d)
    .innerJoin(
      r,
      and(eq(r.documentId, d.id), eq(r.revision, d.currentRevision)),
    )
    .innerJoin(
      schema.catalogIndexDocuments,
      eq(schema.catalogIndexDocuments.documentId, d.id),
    )
    .where(and(eq(d.workspaceId, scope.workspaceId), eq(d.id, documentId)))
  if (!current?.catalogId) throw new NotFoundError()
  if (current.revision !== input.revision)
    return {
      outcome: "conflict",
      problems: [
        {
          operation: 0,
          kind: "conflict",
          code: "changed",
          message: `"${current.catalogId}" has changed since revision ${input.revision}; start the repair again from its current text`,
          documentId: current.catalogId,
        },
      ],
    }
  return [
    {
      op: "restore-document",
      document: current.catalogId,
      text: input.text,
      expect: {
        sha256: createHash("sha256").update(current.text).digest("hex"),
      },
    },
  ]
}

function checkId(id: unknown): string {
  if (typeof id !== "string" || id.trim() === "") throw new NotFoundError()
  return id.trim()
}

function checkRevision(revision: unknown): number {
  if (
    typeof revision !== "number" ||
    !Number.isInteger(revision) ||
    revision < 1
  )
    throw new InvalidInputError(
      "revision",
      "revision is the catalog revision of the text being repaired, a whole number from 1",
    )
  return revision
}

function checkText(text: unknown): string {
  if (typeof text !== "string")
    throw new InvalidInputError("text", "text is the document's whole text")
  // The document's own limit is checked when the text is read, as for any
  // document; this only bounds the request.
  if (text.length > proposalLimits.bytes)
    throw new InvalidInputError(
      "too-large",
      `The text is longer than ${proposalLimits.bytes / 1024} KiB`,
    )
  return text
}

function checkExplanation(explanation: unknown): string {
  if (typeof explanation !== "string" || explanation.trim() === "")
    throw new InvalidInputError(
      "explanation-blank",
      "Explain the repair in a few sentences",
    )
  if (explanation.length > proposalLimits.explanation)
    throw new InvalidInputError(
      "explanation-too-long",
      `The explanation is longer than ${proposalLimits.explanation} characters`,
    )
  return explanation
}
