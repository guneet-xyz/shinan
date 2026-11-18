import { describe, expect, it } from "vitest"

import { lineRange, positionAt } from "./source.js"

describe("source helpers", () => {
  const text = "a: 1\nbb: 2\nc: 3"

  it("gives 1-based lines and columns", () => {
    expect(positionAt(text, 0)).toEqual({ line: 1, column: 1 })
    expect(positionAt(text, 6)).toEqual({ line: 2, column: 2 })
    expect(positionAt(text, text.length)).toEqual({ line: 3, column: 5 })
  })

  it("widens a range to whole lines, with the line break that ends them", () => {
    expect(lineRange(text, { start: 6, end: 7 })).toEqual({ start: 5, end: 11 })
    expect(lineRange(text, { start: 5, end: 11 })).toEqual({
      start: 5,
      end: 11,
    })
    expect(lineRange(text, { start: 12, end: 13 })).toEqual({
      start: 11,
      end: 15,
    })
  })
})
