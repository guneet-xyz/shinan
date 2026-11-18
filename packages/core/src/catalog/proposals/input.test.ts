import { describe, expect, it } from "vitest"

import { InvalidInputError } from "../../errors.js"
import { checkProposalInput, proposalLimits } from "./input.js"

const check = { checked: "2026-11-18", scope: "Disk", source: "df -h" }
const recheck = {
  op: "recheck-facts",
  document: "machine/musashi",
  facts: [
    {
      identity: "disk.data.free|observed",
      value: "74 GiB",
      check: { checked: "2026-11-14", by: "guneet" },
    },
  ],
  check,
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

describe("checking a proposal's shape before it reaches applyOperations", () => {
  it("accepts every operation type in its documented shape", () => {
    const operations = [
      recheck,
      {
        op: "create-entity",
        id: "machine/kojiro",
        title: "Kojiro",
        summary: "A machine.",
        status: "active",
        owner: "person/guneet",
        decision: { state: "proposed" },
        facts: [
          {
            fact: {
              key: "checkout-on",
              state: "observed",
              to: "machine/daedalus",
              attributes: { path: "/root/x", primary: true, port: 22 },
            },
            check,
          },
        ],
        body: "# Kojiro\n",
      },
      {
        op: "set-fact",
        document: "machine/musashi",
        fact: { key: "role", state: "observed", value: "Host", note: "n" },
        check: { ...check, limits: "Only the role" },
        expect: { identity: "role|observed", absent: true },
        supersedes: { identity: "role|planned", value: "Host", check: null },
      },
      {
        op: "remove-fact",
        document: "machine/musashi",
        expect: { identity: "role|observed", value: "x", check: null },
      },
      {
        op: "edit-body",
        document: "machine/musashi",
        section: null,
        text: "",
        expect: { absent: true },
      },
      {
        op: "set-field",
        document: "schema/domain",
        field: "required",
        value: ["registrar"],
        expect: { value: null },
      },
      {
        op: "retire",
        document: "machine/takezo",
        replacedBy: "machine/musashi",
        expect: { status: "active" },
      },
      { op: "change-id", document: "machine/musashi", id: "machine/m" },
      {
        op: "create-schema",
        type: "domain",
        title: "Domain",
        summary: "Domains.",
        owner: "person/guneet",
        keys: { "served-by": { relation: ["service"], many: true } },
        required: ["served-by"],
        sections: ["Role"],
      },
      {
        op: "set-schema-key",
        document: "schema/domain",
        key: "registrar",
        options: null,
        expect: { options: {} },
      },
      {
        op: "create-start-here",
        title: "Start here",
        people: [{ to: "machine/musashi", note: "Host" }],
        agents: [{ list: "discrepancies", note: "Facts that disagree" }],
      },
      {
        op: "set-start-here-path",
        path: "agents",
        steps: [{ url: "https://example.com", note: "Docs" }],
        expect: { steps: [] },
      },
    ]
    const input = {
      explanation: "Every operation.",
      relatedTask: "SHN-12",
      operations,
      idempotencyKey: "retry-1",
    }
    expect(checkProposalInput(input)).toEqual(input)
  })

  it("refuses `by`: Shinan writes it from who sends the proposal", () => {
    const error = refusal({
      explanation: "x",
      operations: [{ ...recheck, check: { ...check, by: "someone-else" } }],
    })
    expect(error.message).toBe(
      "operations[0] (recheck-facts).check.by is written by Shinan, from who sends the proposal",
    )
  })

  it("refuses unknown operations, unknown properties and wrong types", () => {
    expect(
      refusal({ explanation: "x", operations: [{ op: "delete-all" }] }).rule,
    ).toBe("operation-unknown")
    expect(
      refusal({ explanation: "x", operations: [{ ...recheck, extra: 1 }] })
        .message,
    ).toMatch(/has no property "extra"/)
    expect(
      refusal({
        explanation: "x",
        operations: [{ ...recheck, facts: "all" }],
      }).message,
    ).toMatch(/facts is a list/)
    expect(
      refusal({
        explanation: "x",
        operations: [
          {
            op: "set-fact",
            document: "machine/musashi",
            fact: { key: "role", state: "observed", value: null },
            expect: { identity: "role|observed", absent: true },
          },
        ],
      }).message,
    ).toMatch(/value is text, a number or true\/false/)
    expect(
      refusal({
        explanation: "x",
        operations: [
          {
            op: "edit-body",
            document: "machine/musashi",
            text: "",
            expect: { absent: false },
          },
        ],
      }).message,
    ).toMatch(/expect.absent is true/)
    expect(refusal([]).message).toBe("The proposal is an object")
    expect(
      refusal({ explanation: "x", operations: [Object.create({ op: "x" })] })
        .message,
    ).toMatch(/is an object/)
  })

  it("needs an explanation, a task ID for relatedTask and at least one operation", () => {
    expect(refusal({ explanation: " ", operations: [recheck] }).rule).toBe(
      "explanation-blank",
    )
    expect(
      refusal({
        explanation: "x".repeat(proposalLimits.explanation + 1),
        operations: [recheck],
      }).rule,
    ).toBe("explanation-too-long")
    expect(
      refusal({
        explanation: "x",
        relatedTask: "not a task",
        operations: [recheck],
      }).rule,
    ).toBe("related-task")
    expect(refusal({ explanation: "x", operations: [] }).rule).toBe(
      "operations-empty",
    )
  })

  it("caps operations, facts and the whole proposal's size", () => {
    expect(
      refusal({
        explanation: "x",
        operations: Array(proposalLimits.operations + 1).fill(recheck),
      }).rule,
    ).toBe("too-many")
    expect(
      refusal({
        explanation: "x",
        operations: [
          {
            ...recheck,
            facts: Array(proposalLimits.facts + 1).fill(recheck.facts[0]),
          },
        ],
      }).rule,
    ).toBe("too-many")
    const body = "x".repeat(60_000)
    expect(
      refusal({
        explanation: "x",
        operations: Array(5).fill({
          op: "edit-body",
          document: "machine/musashi",
          text: body,
          expect: { text: "" },
        }),
      }).rule,
    ).toBe("too-large")
    expect(
      refusal({
        explanation: "x",
        operations: [{ ...recheck, document: "x".repeat(70_000) }],
      }).rule,
    ).toBe("too-large")
  })
})
