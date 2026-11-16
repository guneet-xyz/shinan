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
    // Dot segments that leave a single leading slash are fine.
    expect(safeNextPath("/x/../account", origin)).toBe("/account")
    expect(safeNextPath("/./account", origin)).toBe("/account")
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
      // Dot segments the parser removes, leaving a path that starts with //.
      "/.//evil.example",
      "/..//evil.example",
      "/x/..//evil.example",
      "/./\\evil.example",
      "/../\\evil.example",
      "/x/../\\evil.example",
      "/%2e//evil.example",
      "/%2E%2E//evil.example",
      "/x/%2e%2e//evil.example",
      "/.\t//evil.example",
      "/./\n/evil.example",
      "/a/b/../..//evil.example",
      "/.///evil.example",
      "/.//evil.example/account?x=1#y",
      "./..//evil.example",
      "..//evil.example",
    ]) {
      expect(safeNextPath(next, origin), JSON.stringify(next)).toBe("/")
    }
  })
})
