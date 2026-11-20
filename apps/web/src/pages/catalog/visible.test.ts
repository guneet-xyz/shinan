import { describe, expect, it } from "vitest"

import { hasHidden, hiddenName, visible, visibleParts } from "./visible"

const marker = (code: number) =>
  `⟨U+${code.toString(16).toUpperCase().padStart(4, "0")}⟩`

describe("hidden characters", () => {
  it.each([
    ["bidi override and pop", [0x202e, 0x202c]],
    ["isolates", [0x2066, 0x2068, 0x2069]],
    ["zero-width and word joiner", [0x200b, 0x200c, 0x200d, 0x2060]],
    ["byte-order mark", [0xfeff]],
    ["controls", [0x0007, 0x007f, 0x0085]],
    ["soft hyphen and grapheme joiner", [0x00ad, 0x034f]],
    ["Mongolian vowel separator", [0x180e]],
    ["line and paragraph separators", [0x2028, 0x2029]],
    ["variation selectors", [0xfe0f, 0xe0100, 0xe01ef]],
    ["Hangul fillers", [0x3164, 0x115f, 0x1160, 0xffa0]],
    ["braille blank", [0x2800]],
    ["tag characters", [0xe0001, 0xe0020, 0xe0041, 0xe007f]],
  ])("marks %s", (_, codes) => {
    const text = codes.map((c) => `a${String.fromCodePoint(c)}`).join("")
    expect(visible(text)).toBe(codes.map((c) => `a${marker(c)}`).join(""))
    expect(hasHidden(text)).toBe(true)
  })

  it("marks line breaks and tabs in a name", () => {
    expect(visible("machine/new\nline\t.md", { oneLine: true })).toBe(
      `machine/new${marker(0x0a)}line${marker(0x09)}.md`,
    )
  })

  it("keeps line breaks, tabs, letters and emoji as they are", () => {
    const text = "One\r\n\ttwo: café, 日本語, ✓ 👍🏽, e\u0301"
    expect(visible(text)).toBe(text)
    expect(hasHidden(text)).toBe(false)
  })

  it("splits text into plain runs and named hidden characters", () => {
    expect(visibleParts("Invoice \u202Egnp.exe\u202C")).toEqual([
      "Invoice ",
      { marker: marker(0x202e), name: "right-to-left override" },
      "gnp.exe",
      { marker: marker(0x202c), name: "pop directional formatting" },
    ])
    expect(visibleParts("one\ntwo")).toEqual(["one\ntwo"])
    expect(visibleParts("one\ntwo", { oneLine: true })).toEqual([
      "one",
      { marker: marker(0x0a), name: "line break" },
      "two",
    ])
    expect(visibleParts("")).toEqual([])
    expect(hasHidden("one\ntwo")).toBe(false)
    expect(hasHidden("one\ntwo", { oneLine: true })).toBe(true)
  })

  it.each([
    [0x200b, "zero-width space"],
    [0xfe0f, "variation selector"],
    [0xe0041, "tag character"],
    [0x0007, "control character"],
    [0x2062, "invisible operator"],
    [0x00ad, "soft hyphen"],
  ])("names U+%s", (code, name) => {
    expect(hiddenName(String.fromCodePoint(code))).toBe(name)
  })
})
