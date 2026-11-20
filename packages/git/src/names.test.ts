import { describe, expect, it } from "vitest"

import {
  checkObjectName,
  isBranchRef,
  objectName,
  revision,
  treePath,
} from "./names.js"

const oid = "a".repeat(40)

describe("revisions", () => {
  it("are full object IDs or branches", () => {
    for (const value of [
      oid,
      "b".repeat(64),
      "refs/heads/main",
      "refs/heads/agent/fix-2.1",
      "refs/heads/a_b",
    ]) {
      expect(revision(value)).toBe(value)
    }
  })

  it("are never Git's searches, relative forms or options", () => {
    for (const value of [
      "",
      "main",
      "HEAD",
      ":/one",
      "refs/heads/main~1",
      "refs/heads/main^",
      "refs/heads/main^{tree}",
      "refs/heads/main^{/fix}",
      "refs/heads/main@{1}",
      "@{-1}",
      "refs/tags/v1",
      "refs/heads/",
      "refs/heads/a..b",
      "refs/heads/a//b",
      "refs/heads/.hidden",
      "refs/heads/-x",
      "refs/heads/x.lock",
      "refs/heads/x.",
      "refs/heads/a b",
      "refs/heads/a\nb",
      "--output=/tmp/x",
      oid.slice(0, 39),
      oid.toUpperCase(),
      `refs/heads/${"x".repeat(250)}`,
    ]) {
      expect(() => revision(value), value).toThrow()
      expect(isBranchRef(value), value).toBe(false)
    }
  })
})

describe("paths and object names", () => {
  it("take plain paths in a tree", () => {
    expect(treePath("machine/musashi.md")).toBe("machine/musashi.md")
    expect(treePath("machine/")).toBe("machine/")
    expect(treePath(":(top)x")).toBe(":(top)x")
    for (const value of ["", "/etc", "../x", "a/../b", "a//b", "./a", "a\0b"]) {
      expect(() => treePath(value), value).toThrow()
    }
  })

  it("name an object by revision and path, or by revision alone", () => {
    expect(objectName("refs/heads/main", "README.md")).toBe(
      "refs/heads/main:README.md",
    )
    expect(checkObjectName(oid)).toBe(oid)
    expect(checkObjectName("refs/heads/main")).toBe("refs/heads/main")
    expect(checkObjectName(`${oid}:a/b:c.md`)).toBe(`${oid}:a/b:c.md`)
    for (const value of [
      ":/one",
      "main:README.md",
      "HEAD:README.md",
      "refs/heads/main:../x",
      "refs/heads/main:",
      ":0:README.md",
      "refs/heads/main~1:README.md",
    ]) {
      expect(() => checkObjectName(value), value).toThrow()
    }
  })
})
