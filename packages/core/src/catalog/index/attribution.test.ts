import { describe, expect, it } from "vitest"

import { attributeSections } from "./attribution.js"
import type { RevisionAuthor } from "./attribution.js"

const by = (revision: number, author: string): RevisionAuthor => ({
  revision,
  authorKind: "person",
  author,
})

const section = (anchor: string | null, text: string) => ({ anchor, text })

describe("attributeSections", () => {
  it("credits every section of a new document to its first revision", () => {
    const credits = attributeSections(
      [],
      [section(null, "\n"), section("cautions", "## Cautions\n\nCare.\n")],
      by(1, "ada"),
    )
    expect(credits.map((c) => [c.anchor, c.changedRevision, c.author])).toEqual(
      [
        [null, 1, "ada"],
        ["cautions", 1, "ada"],
      ],
    )
  })

  it("keeps credits for unchanged sections and moves them for changed, new or renamed ones", () => {
    const first = attributeSections(
      [],
      [
        section(null, "Intro\n"),
        section("role", "## Role\n\nA.\n"),
        section("cautions", "## Cautions\n\nB.\n"),
      ],
      by(1, "ada"),
    )
    const second = attributeSections(
      first,
      [
        section(null, "Intro\n"),
        section("role", "## Role\n\nA, changed.\n"),
        section("warnings", "## Warnings\n\nB.\n"),
        section("history", "## History\n\nC.\n"),
      ],
      by(2, "bob"),
    )
    expect(second.map((c) => [c.anchor, c.changedRevision, c.author])).toEqual([
      [null, 1, "ada"],
      ["role", 2, "bob"],
      ["warnings", 2, "bob"],
      ["history", 2, "bob"],
    ])
  })

  it("follows a section that moved, by its anchor", () => {
    const first = attributeSections(
      [],
      [section("a", "## A\n"), section("b", "## B\n")],
      by(1, "ada"),
    )
    const moved = attributeSections(
      first,
      [section("b", "## B\n"), section("a", "## A\n")],
      by(2, "bob"),
    )
    expect(moved.map((c) => c.changedRevision)).toEqual([1, 1])
  })

  it("counts any changed byte, such as a heading's level", () => {
    const first = attributeSections([], [section("a", "## A\n")], by(1, "ada"))
    const changed = attributeSections(
      first,
      [section("a", "### A\n")],
      by(2, "bob"),
    )
    expect(changed[0]!.changedRevision).toBe(2)
  })
})
