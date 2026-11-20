import { describe, expect, it } from "vitest"

import { clashingNames, nameProblem } from "./names.js"

const problem = (name: string | Buffer) =>
  nameProblem(typeof name === "string" ? Buffer.from(name) : name)

describe("names that break a checkout on Windows or macOS", () => {
  it.each([
    ["x.md.", "ends with a dot or a space"],
    ["x.md ", "ends with a dot or a space"],
    [" x.md", "starts with a space"],
    ["a\\b.md", "does not allow"],
    ["a:b.md", "does not allow"],
    ["what?.md", "does not allow"],
    ["tab\there", "does not allow"],
    ["con", "reserves"],
    ["CON.md", "reserves"],
    ["aux", "reserves"],
    ["Nul.txt", "reserves"],
    ["com1.md", "reserves"],
    ["LPT9", "reserves"],
    ["x".repeat(256), "longer than 255 bytes"],
  ])("refuses %j", (name, why) => {
    expect(problem(name)).toContain(why)
  })

  it("refuses a name that is not UTF-8", () => {
    expect(problem(Buffer.from([0x61, 0xff, 0x62]))).toBe("is not UTF-8")
  })

  it.each([
    "musashi.md",
    "README.md",
    "start-here.md",
    "console.md",
    "com10.md",
    "lpt.md",
    "café.md",
    ".gitattributes",
    "x".repeat(255),
    "\u200b.git",
  ])("accepts %j", (name) => {
    expect(problem(name)).toBeNull()
  })

  it("finds names one folder would hold twice on Windows or macOS", () => {
    expect(clashingNames(["A.md", "a.md", "b.md"])).toEqual([["A.md", "a.md"]])
    expect(clashingNames(["Dir", "dir"])).toEqual([["Dir", "dir"]])
    expect(
      clashingNames(["caf\u00e9.md", "cafe\u0301.md"]).map((p) =>
        p.map((n) => n.length),
      ),
    ).toEqual([[7, 8]])
    expect(clashingNames(["a.md", "b.md", "a.mdx"])).toEqual([])
  })
})
