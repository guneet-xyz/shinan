import { describe, expect, it } from "vitest"

import { violatedUniqueConstraint } from "./database-errors.js"

function databaseError(code: string, constraint?: string) {
  return Object.assign(new Error("duplicate key"), { code, constraint })
}

describe("violatedUniqueConstraint", () => {
  it("names the constraint of a unique violation", () => {
    expect(
      violatedUniqueConstraint(databaseError("23505", "people_handle_unique")),
    ).toBe("people_handle_unique")
  })

  it("looks through a wrapping error", () => {
    const wrapped = new Error("Failed query", {
      cause: databaseError("23505", "people_email_unique"),
    })
    expect(violatedUniqueConstraint(wrapped)).toBe("people_email_unique")
  })

  it("ignores other errors", () => {
    expect(violatedUniqueConstraint(databaseError("23503", "x"))).toBe(
      undefined,
    )
    expect(violatedUniqueConstraint("not an error")).toBe(undefined)
  })
})
