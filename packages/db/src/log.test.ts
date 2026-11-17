import { describe, expect, it } from "vitest"

import {
  createLimitedLog,
  databaseErrorCode,
  errorFrames,
  errorSummary,
} from "./log.js"

describe("databaseErrorCode", () => {
  it("finds a code through wrappers and ignores anything else", () => {
    expect(databaseErrorCode({ code: "ECONNRESET" })).toBe("ECONNRESET")
    expect(
      databaseErrorCode(new Error("wrapped", { cause: { code: "57P01" } })),
    ).toBe("57P01")
    expect(
      databaseErrorCode(
        new AggregateError([
          Object.assign(new Error(), { code: "ECONNREFUSED" }),
        ]),
      ),
    ).toBe("ECONNREFUSED")
    expect(databaseErrorCode({ code: "with spaces and values 'x'" })).toBe(
      "unknown",
    )
    expect(databaseErrorCode(undefined)).toBe("unknown")
  })
})

describe("errorSummary and errorFrames", () => {
  const failed = Object.assign(
    new Error("Failed query: select $1\nparams: 203.0.113.9,ada@example.com", {
      cause: Object.assign(new Error('invalid input: "ada@example.com"'), {
        code: "22P02",
      }),
    }),
    { name: "DrizzleQueryError" },
  )

  it("keep the name, code and stack frames, never the message", () => {
    expect(errorSummary(failed)).toBe("DrizzleQueryError 22P02")
    expect(errorSummary(new TypeError("x is ada@example.com"))).toBe(
      "TypeError",
    )
    class DatabaseError extends Error {
      override name = "error"
      code = "57P01"
    }
    expect(errorSummary(new DatabaseError("terminating"))).toBe(
      "DatabaseError 57P01",
    )
    expect(errorSummary("a string")).toBe("Error")
    expect(errorSummary(Object.assign(new Error(), { name: "a b: c" }))).toBe(
      "Error",
    )
    const frames = errorFrames(failed)
    expect(frames).toMatch(/^\s+at /)
    expect(frames).not.toMatch(/203\.0\.113\.9|ada@example\.com|Failed query/)
  })
})

describe("createLimitedLog", () => {
  it("writes the same line at most once an interval, then says how many were held back", () => {
    let time = 0
    const lines: string[] = []
    const log = createLimitedLog({
      intervalMs: 1000,
      now: () => time,
      write: (line) => lines.push(line),
    })
    log("Database connection lost")
    log("Database connection lost")
    log("Request failed: TypeError", "Request failed: TypeError\n    at x")
    time = 500
    log("Database connection lost")
    time = 1000
    log("Database connection lost")
    log("Request failed: TypeError", "Request failed: TypeError\n    at y")
    expect(lines).toEqual([
      "Database connection lost",
      "Request failed: TypeError\n    at x",
      "Database connection lost (and 2 more like it since then)",
      "Request failed: TypeError\n    at y",
    ])
  })
})
