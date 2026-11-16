import { describe, expect, it } from "vitest"

import { safeLogText } from "./log-text.js"

describe("safeLogText", () => {
  it("keeps only the text before the first colon", () => {
    expect(safeLogText("Invalid callbackURL: https://evil.example/")).toBe(
      "Invalid callbackURL",
    )
    expect(safeLogText("signup_disabled")).toBe("signup_disabled")
  })

  it("replaces control characters and caps the length", () => {
    expect(safeLogText("a\nb\rc\u0085d\u001b[31m")).toBe("a?b?c?d?[31m")
    expect(safeLogText("x".repeat(500))).toHaveLength(100)
  })
})
