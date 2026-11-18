import { describe, expect, it } from "vitest"

import { InvalidInputError } from "../../errors.js"
import { checkProposalInput, proposalLimits } from "./input.js"

const operation = {
  op: "change-id",
  document: "machine/musashi",
  id: "machine/miyamoto",
}

function refusal(input: unknown): InvalidInputError {
  try {
    checkProposalInput(input)
  } catch (error) {
    if (error instanceof InvalidInputError) return error
    throw error
  }
  throw new Error("Expected the input to be refused")
}

describe("checking a proposal before it reaches the catalog worker", () => {
  it("accepts an explanation, a related task, operations and an idempotency key", () => {
    const input = {
      explanation: "Rename Musashi.",
      relatedTask: "SHN-12",
      operations: [operation],
      idempotencyKey: "retry-1",
    }
    expect(checkProposalInput(input)).toEqual(input)
    expect(
      checkProposalInput({ explanation: "x", operations: [operation] }),
    ).toEqual({
      explanation: "x",
      relatedTask: null,
      operations: [operation],
      idempotencyKey: null,
    })
  })

  it("refuses other shapes and unknown properties", () => {
    expect(refusal([]).message).toBe("The proposal is an object")
    expect(
      refusal({ explanation: "x", operations: [operation], by: "me" }).message,
    ).toBe('The proposal has no property "by"')
    expect(refusal({ explanation: "x", operations: "all" }).rule).toBe(
      "operations",
    )
  })

  it("needs an explanation, a task ID for relatedTask and at least one operation", () => {
    expect(refusal({ explanation: " ", operations: [operation] }).rule).toBe(
      "explanation-blank",
    )
    expect(
      refusal({
        explanation: "x".repeat(proposalLimits.explanation + 1),
        operations: [operation],
      }).rule,
    ).toBe("explanation-too-long")
    expect(
      refusal({
        explanation: "x",
        relatedTask: "not a task",
        operations: [operation],
      }).rule,
    ).toBe("related-task")
    expect(
      refusal({
        explanation: "x",
        idempotencyKey: "k".repeat(proposalLimits.idempotencyKey + 1),
        operations: [operation],
      }).rule,
    ).toBe("idempotency-key")
    expect(refusal({ explanation: "x", operations: [] }).rule).toBe(
      "operations-empty",
    )
  })

  it("caps the operations and the whole proposal's size", () => {
    expect(
      refusal({
        explanation: "x",
        operations: Array(proposalLimits.operations + 1).fill(operation),
      }).rule,
    ).toBe("too-many")
    expect(
      refusal({
        explanation: "x",
        operations: Array(5).fill({
          op: "edit-body",
          document: "machine/musashi",
          text: "x".repeat(60_000),
          expect: { text: "" },
        }),
      }).rule,
    ).toBe("too-large")
  })
})
