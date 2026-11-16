import { describe, expect, it } from "vitest"

import { safeNextPath } from "./format"

const origin = "https://shinan.example"

describe("safeNextPath", () => {
  it("keeps paths on this site, with their query and fragment", () => {
    expect(safeNextPath("/account", origin)).toBe("/account")
    expect(safeNextPath("/w/1/settings?tab=x#top", origin)).toBe(
      "/w/1/settings?tab=x#top",
    )
    expect(safeNextPath(`${origin}/account`, origin)).toBe("/account")
    // A browser reads this as a path relative to the current page.
    expect(safeNextPath("https:evil.example", origin)).toBe("/evil.example")
  })

  it("falls back to the start for nothing", () => {
    expect(safeNextPath(null, origin)).toBe("/")
    expect(safeNextPath("", origin)).toBe("/")
  })

  it("refuses anything that leaves this site", () => {
    for (const next of [
      "//evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "\t//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "/\\/evil.example",
      "https://evil.example/account",
      "http://shinan.example/account",
      "javascript:alert(1)",
      "data:text/html,hi",
    ]) {
      expect(safeNextPath(next, origin), JSON.stringify(next)).toBe("/")
    }
  })
})
