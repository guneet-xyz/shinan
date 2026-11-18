import { describe, expect, it, vi } from "vitest"

import type * as markdown from "@shinan/markdown"

import { parseCatalogDocument } from "./parse.js"
import type * as yaml from "./yaml.js"

// Make the Markdown or YAML reader throw on demand, to pin the never-throws
// backstop: an unexpected error is reported as `read-failed`, never thrown.
const fail = vi.hoisted(() => ({ body: false, yaml: false }))

vi.mock("@shinan/markdown", async (original) => {
  const actual = await original<typeof markdown>()
  return {
    ...actual,
    createMarkdown: () => {
      const md = actual.createMarkdown()
      const parse = md.parse.bind(md)
      md.parse = (...args: Parameters<typeof parse>) => {
        if (fail.body) throw new Error("the Markdown reader broke")
        return parse(...args)
      }
      return md
    },
  }
})

vi.mock("./yaml.js", async (original) => {
  const actual = await original<typeof yaml>()
  return {
    ...actual,
    parseYaml: (...args: Parameters<typeof actual.parseYaml>) => {
      if (fail.yaml) throw new TypeError("the YAML reader broke")
      return actual.parseYaml(...args)
    },
  }
})

const text = `---
id: machine/x
type: machine
title: X
summary: A machine.
status: active
owner: person/guneet
---

# X
`

describe("the never-throws backstop", () => {
  it("reports a body reader that throws as read-failed, keeping the frontmatter", () => {
    fail.body = true
    try {
      const d = parseCatalogDocument(text)
      expect(d.problems.map((p) => p.code)).toEqual(["read-failed"])
      expect(d.problems[0]?.message).toContain("the Markdown reader broke")
      expect(d.problems[0]?.documentId).toBe("machine/x")
      expect(d.id).toBe("machine/x")
    } finally {
      fail.body = false
    }
  })

  it("reports anything else that throws as read-failed", () => {
    fail.yaml = true
    try {
      const d = parseCatalogDocument(text)
      expect(d.problems.map((p) => p.code)).toEqual(["read-failed"])
      expect(d.problems[0]?.message).toContain("the YAML reader broke")
      expect(d.text).toBe(text)
    } finally {
      fail.yaml = false
    }
  })

  it("reads normally otherwise", () => {
    expect(parseCatalogDocument(text).problems).toEqual([])
  })
})
