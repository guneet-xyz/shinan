import { describe, expect, it } from "vitest"

import { editableDocument, parseCatalogDocument } from "./document/index.js"
import { editableOf } from "./wiki.js"

const text = (title: string, type = "machine") => `---
id: ${type}/x
type: ${type}
title: ${title}
summary: A test.
status: active
owner: person/guneet
${type === "decision" ? "decision_state: accepted\n" : ""}---

# X
`

describe("the editable form of a document", () => {
  it("is read once per text, and again when the text changes", () => {
    const first = editableOf(text("One"))
    expect(editableOf(text("One"))).toBe(first)
    const second = editableOf(text("Two"))
    expect(second).not.toBe(first)
    expect(second.fields.title).toBe("Two")
  })

  it("has a decision's fields only on decisions", () => {
    expect(
      Object.keys(editableDocument(parseCatalogDocument(text("A"))).fields),
    ).toEqual(["title", "summary", "status", "owner"])
    expect(
      editableDocument(parseCatalogDocument(text("A", "decision"))).fields,
    ).toMatchObject({ decision_state: "accepted", decided_on: null })
  })
})
