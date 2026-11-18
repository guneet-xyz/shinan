import { InvalidInputError } from "../../errors.js"
import { checkStorable } from "../../validation.js"
import {
  maxFacts,
  maxOperations,
  taskIdPattern,
  utf8Length,
} from "../document/index.js"
import type { CatalogOperation } from "../document/index.js"

/**
 * Limits on one catalog proposal (catalog §8.1). They bound the work of
 * applying and validating it, which runs in the catalog worker with a time
 * limit. The operation and fact limits are `applyOperations`'s; the rest
 * are **proposed (M2-4)**.
 */
export const proposalLimits = {
  /** Operations in one proposal. */
  operations: maxOperations,
  /** Facts one proposal names in all. */
  facts: maxFacts,
  /** The explanation, in characters. */
  explanation: 4000,
  /** An idempotency key, in characters. */
  idempotencyKey: 200,
  /** The whole proposal as JSON, in bytes of UTF-8. */
  bytes: 256 * 1024,
} as const

/** A catalog proposal as its author sends it. */
export interface ProposalInput {
  /** Why, in a few sentences (catalog §8.1). */
  explanation: string
  /** The related task's ID, such as `SHN-12`. */
  relatedTask?: string | null
  operations: CatalogOperation[]
  /**
   * A key of the author's choosing: a retried request with the same key and
   * the same content is stored once.
   */
  idempotencyKey?: string | null
}

/**
 * Checks a catalog proposal from outside core, such as an MCP call's JSON:
 * its explanation, related task, idempotency key, the number of operations
 * and its size. Each operation's shape is checked by `applyOperations`,
 * which reports a malformed one as `invalid` with its position.
 */
export function checkProposalInput(input: unknown): ProposalInput {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    (Object.getPrototypeOf(input) !== Object.prototype &&
      Object.getPrototypeOf(input) !== null)
  )
    throw invalid("proposal-shape", "The proposal is an object")
  checkStorable(input, "The proposal")
  const proposal = input as Record<string, unknown>
  for (const key of Object.keys(proposal))
    if (
      !["explanation", "relatedTask", "operations", "idempotencyKey"].includes(
        key,
      )
    )
      throw invalid(
        "proposal-shape",
        `The proposal has no property ${JSON.stringify(key.slice(0, 50))}`,
      )

  const explanation = proposal.explanation
  if (typeof explanation !== "string" || explanation.trim() === "")
    throw invalid("explanation-blank", "Explain the change in a few sentences")
  if (explanation.length > proposalLimits.explanation)
    throw invalid(
      "explanation-too-long",
      `The explanation is longer than ${proposalLimits.explanation} characters`,
    )

  const relatedTask = proposal.relatedTask ?? null
  if (
    relatedTask !== null &&
    (typeof relatedTask !== "string" || !taskIdPattern.test(relatedTask))
  )
    throw invalid("related-task", "relatedTask is a task ID, such as SHN-12")

  const idempotencyKey = proposal.idempotencyKey ?? null
  if (
    idempotencyKey !== null &&
    (typeof idempotencyKey !== "string" ||
      idempotencyKey === "" ||
      idempotencyKey.length > proposalLimits.idempotencyKey)
  )
    throw invalid(
      "idempotency-key",
      `idempotencyKey is text of 1 to ${proposalLimits.idempotencyKey} characters`,
    )

  const operations = proposal.operations
  if (!Array.isArray(operations))
    throw invalid("operations", "operations is a list")
  if (operations.length === 0)
    throw invalid("operations-empty", "A proposal has at least one operation")
  if (operations.length > proposalLimits.operations)
    throw invalid(
      "too-many",
      `A proposal holds at most ${proposalLimits.operations} operations; split it`,
    )
  if (
    operations.some(
      (o) =>
        typeof o === "object" &&
        o !== null &&
        (o as { op?: unknown }).op === "restore-document",
    )
  )
    throw invalid(
      "restore-document",
      "Only a revert puts back a document's earlier text; revert the proposal instead",
    )
  if (utf8Length(JSON.stringify(input)) > proposalLimits.bytes)
    throw invalid(
      "too-large",
      `The proposal is larger than ${proposalLimits.bytes / 1024} KiB`,
    )
  return {
    explanation,
    relatedTask,
    operations: operations as CatalogOperation[],
    idempotencyKey,
  }
}

function invalid(rule: string, message: string): InvalidInputError {
  return new InvalidInputError(rule, message)
}
