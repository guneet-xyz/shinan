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

  it("names a section with an empty heading", () => {
    const body = parseBody("#\n\n#\n", 0)
    expect(body.sections.map((s) => s.anchor)).toEqual(["section", "section-1"])
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

describe("link positions", () => {
  // Every link's range must slice back to the link as written, wherever it
  // sits: markdown-it gives no inline positions, so they are recomputed.
  it.each([
    [
      "a paragraph",
      "Text [a](x/y) and ![b](z/w) end.\n",
      ["[a](x/y)", "![b](z/w)"],
    ],
    ["a second paragraph line", "One\ntwo [a](x/y) three\n", ["[a](x/y)"]],
    ["a quote", "> See [a](x/y)\n> and [b](z/w).\n", ["[a](x/y)", "[b](z/w)"]],
    ["a nested list", "- one\n  - two [a](x/y)\n", ["[a](x/y)"]],
    ["an ordered list", "1. [a](x/y)\n", ["[a](x/y)"]],
    ["a heading with closing marks", "## See [a](x/y) ##\n", ["[a](x/y)"]],
    ["an underlined heading", "See [a](x/y)\n===\n", ["[a](x/y)"]],
    [
      "a table",
      "| a | b |\n| - | - |\n| [a](x/y) | [a](x/y) |\n",
      ["[a](x/y)", "[a](x/y)"],
    ],
    [
      "an autolink",
      "Go <https://example.com/x>.\n",
      ["<https://example.com/x>"],
    ],
    [
      "a link over two lines",
      "A [long\nlink](x/y) here.\n",
      ["[long\nlink](x/y)"],
    ],
    ["CRLF line breaks", "One\r\n> [a](x/y)\r\n", ["[a](x/y)"]],
    ["lone CR line breaks", "One\r> [a](x/y)\r", ["[a](x/y)"]],
    [
      "a link in an image",
      "[![a](i/j)](x/y)\n",
      ["[![a](i/j)](x/y)", "![a](i/j)"],
    ],
    ["a definition", 'Text\n\n[r]: x/y "Title"\n', ['[r]: x/y "Title"']],
    ["non-ASCII text", "Ünïcödé 🙂 [a](x/y)\n", ["[a](x/y)"]],
  ])("in %s", (_, text, written) => {
    const body = parseBody(text, 10)
    expect(
      body.links.map((l) => text.slice(l.range.start - 10, l.range.end - 10)),
    ).toEqual(written)
  })

  it("covers the line when the text cannot be found as written", () => {
    // A tab after a list marker is expanded to spaces by the parser.
    const text = "-\tone\n\t[a](x/y)\n"
    const [link] = parseBody(text, 0).links
    expect(link?.reference).toBe("x/y")
    expect(text.slice(link!.range.start, link!.range.end)).toContain("[a](x/y)")
  })
})

describe("the shared Markdown configuration", () => {
  it("does not render raw HTML, and reads tables", () => {
    const body = parseBody(
      '<a href="machine/x">x</a>\n\n| a |\n| - |\n| [b](y/z) |\n',
      0,
    )
    expect(body.links.map((l) => l.url)).toEqual(["y/z"])
  })
})
