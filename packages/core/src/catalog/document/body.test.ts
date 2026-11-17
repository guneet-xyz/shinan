import { describe, expect, it } from "vitest"

import { AnchorMaker, parseBody, referenceTarget } from "./body.js"

describe("body sections (catalog §2.5, §12.1)", () => {
  it("splits at every top-level heading and keeps the exact text", () => {
    const text = `Intro line.

# Title

Text.

## Cautions
Setext heading below is a heading too.

Setup
-----

\`\`\`sh
# not a heading
\`\`\`

> # Not a section in a quote

- # nor in a list

## Cautions
again
`
    const body = parseBody(text, 100)
    expect(body.sections.map((s) => [s.heading, s.level, s.anchor])).toEqual([
      [null, 0, null],
      ["Title", 1, "title"],
      ["Cautions", 2, "cautions"],
      ["Setup", 2, "setup"],
      ["Cautions", 2, "cautions-1"],
    ])
    expect(body.sections.map((s) => s.text).join("")).toBe(text)
    for (const s of body.sections) {
      expect(text.slice(s.range.start - 100, s.range.end - 100)).toBe(s.text)
    }
    expect(body.sections[1]?.headingRange).toEqual({ start: 113, end: 120 })
    expect(body.sections[3]?.text).toContain("# not a heading")
  })

  it("has no text-before-heading section when the body starts with a heading", () => {
    const body = parseBody("# A\n\n## B\n", 0)
    expect(body.sections.map((s) => s.heading)).toEqual(["A", "B"])
  })

  it("uses the heading's text, without Markdown", () => {
    const body = parseBody("## The `ups` **model** [link](x/y)\n", 0)
    expect(body.sections[0]).toMatchObject({
      heading: "The ups model link",
      anchor: "the-ups-model-link",
    })
  })

  it("makes GitHub-style anchors, unique within the body", () => {
    const anchors = new AnchorMaker()
    expect(
      ["Cautions", "Cautions", "Cautions-1", "What's next?", "A  B"].map((h) =>
        anchors.make(h),
      ),
    ).toEqual(["cautions", "cautions-1", "cautions-1-1", "whats-next", "a--b"])
  })
})

describe("body links (catalog §2.4)", () => {
  it("finds links, images and definitions (a reference-style link through its definition)", () => {
    const text = `See [Musashi](machine/musashi), [its cautions](machine/musashi#cautions),
[docs](https://example.com/x), <https://example.com/auto>, [mail](mailto:a@b.c),
![diagram](service/ingress), [ref][r], [top](#top), [rel](../machines/musashi.md),
\`[code](machine/not-a-link)\`.

[r]: project/dockyard
`
    const links = parseBody(text, 0).links
    expect(links.map((l) => [l.kind, l.url, l.reference])).toEqual([
      ["link", "machine/musashi", "machine/musashi"],
      ["link", "machine/musashi#cautions", "machine/musashi"],
      ["link", "https://example.com/x", null],
      ["link", "https://example.com/auto", null],
      ["link", "mailto:a@b.c", null],
      ["image", "service/ingress", "service/ingress"],
      ["link", "#top", null],
      ["link", "../machines/musashi.md", null],
      ["definition", "project/dockyard", "project/dockyard"],
    ])
    expect(text.slice(links[0]!.range.start, links[0]!.range.end)).toBe(
      "[Musashi](machine/musashi)",
    )
  })

  it.each([
    ["machine/musashi", "machine/musashi"],
    ["machine/musashi#x", "machine/musashi"],
    ["Machine/Musashi", "Machine/Musashi"],
    ["www.example.com", "www.example.com"],
    ["", null],
    ["#x", null],
    ["/abs", null],
    ["./rel", null],
    ["?q", null],
    ["HTTPS://x", null],
    ["ftp://x", null],
  ])("reads %j as reference %j", (url, reference) => {
    expect(referenceTarget(url)).toBe(reference)
  })
})
