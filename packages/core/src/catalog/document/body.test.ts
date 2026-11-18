import fc from "fast-check"
import { describe, expect, it } from "vitest"

import {
  AnchorMaker,
  BodyTooComplexError,
  parseBody,
  referenceTarget,
} from "./body.js"

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

  it.each([
    ["a tab after a list marker", "-\tone\n\t[a](x/y)\n"],
    ["a tab-indented continuation line", "- a\n\t[b](c)\n"],
    ["a tab and spaces", "- a\n\t  [b](c)\n"],
    ["a tab in a nested list", "- a\n\t- b\n\t\t[c](d)\n"],
  ])("is exact after %s, which the parser expands to spaces", (_, text) => {
    const [link] = parseBody(text, 0).links
    expect(text.slice(link!.range.start, link!.range.end)).toMatch(
      /^\[[a-z]\]\([a-z/]+\)$/,
    )
  })

  it("is exact after an escaped pipe in a table row", () => {
    for (const text of [
      "| a | b |\n|-|-|\n| x \\| [y](z) | w |\n",
      '| a |\n|-|\n| [y](z "\\|") |\n',
      "| a | b |\n|-|-|\n| `p \\| q` [y](z) | [y](z) |\n",
    ]) {
      const links = parseBody(text, 0).links
      expect(links.length).toBeGreaterThan(0)
      for (const link of links)
        expect(text.slice(link.range.start, link.range.end)).toMatch(
          /^\[y\]\(z( "\\\|")?\)$/,
        )
    }
  })

  it("does not list a reference-style image with a link in its text as inline", () => {
    const text = "![#[a\n  b](c)][r]\n\n[r]: d\n"
    const links = parseBody(text, 0).links
    // The image takes its destination from the definition; text inside an
    // image's description is its alternative text, not a link.
    expect(links.map((l) => [l.kind, l.url])).toEqual([["definition", "d"]])
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

describe("link destinations", () => {
  it.each([
    ["machine/%41", "machine/%41"],
    ["machine/a%20b", "machine/a%20b"],
    ["x%", "x%"],
    ["machine/a%zz", "machine/a%zz"],
    ["https://xn--mnchen-3ya.de/x", "https://xn--mnchen-3ya.de/x"],
    ["<a b>", "a b"],
    ["a\\_b", "a_b"],
    ["a&amp;b", "a&b"],
  ])(
    "keeps %s as written, with escapes and references decoded",
    (written, url) => {
      expect(parseBody(`[t](${written})\n`, 0).links[0]?.url).toBe(url)
    },
  )

  it("lists javascript:, vbscript:, file: and data: destinations", () => {
    const text =
      "[a](javascript:alert(1)) [b](vbscript:x) [c](file:///etc/passwd) ![d](data:image/png;base64,AAAA) [e](data:text/html,x)\n"
    expect(parseBody(text, 0).links.map((l) => [l.url, l.reference])).toEqual([
      ["javascript:alert(1)", null],
      ["vbscript:x", null],
      ["file:///etc/passwd", null],
      ["data:image/png;base64,AAAA", null],
      ["data:text/html,x", null],
    ])
  })
})

describe("nesting the Markdown reader cannot follow", () => {
  const nested = (depth: number) =>
    `${Array.from({ length: depth }, (_, i) => `${"  ".repeat(i)}- a`).join("\n")}\n\n## Cautions\n\nSee [db](machine/x).\n`

  it("reads lists nested 49 deep by indentation, to the end", () => {
    const body = parseBody(nested(49), 0)
    expect(body.sections.map((s) => s.heading)).toEqual([null, "Cautions"])
    expect(body.links.map((l) => l.reference)).toEqual(["machine/x"])
  })

  it.each([50, 60, 200])(
    "refuses lists nested %i deep instead of dropping what follows",
    (depth) => {
      expect(() => parseBody(nested(depth), 0)).toThrow(BodyTooComplexError)
      expect(() => parseBody(nested(depth), 0)).toThrow(/rest would be lost/)
    },
  )

  it("refuses quotes nested past the limit inside lists", () => {
    const text = `${Array.from({ length: 40 }, (_, i) => `${"  ".repeat(i)}- a`).join("\n")}\n${"  ".repeat(40)}${"> ".repeat(25)}b\n`
    expect(() => parseBody(text, 0)).toThrow(BodyTooComplexError)
  })
})

describe("link positions on generated bodies", () => {
  const word = fc.stringMatching(/^[a-z]{1,6}$/)
  const destination = fc.oneof(
    fc.stringMatching(/^[a-z]{1,5}\/[a-z]{1,5}$/),
    fc.constant("https://example.com/a_b"),
    fc.constant("<a b>"),
  )
  const linkText: fc.Arbitrary<string> = fc.oneof(
    fc.tuple(word, destination).map(([t, d]) => `[${t}](${d})`),
    fc.tuple(word, destination).map(([t, d]) => `![${t}](${d})`),
    fc.tuple(word, destination).map(([t, d]) => `[${t}](${d} "t")`),
    fc.constant("<https://example.com/x>"),
    fc.tuple(word, word).map(([a, b]) => `[${a}\n${b}](x/y)`),
  )
  const inline = fc
    .array(fc.oneof(word, linkText, fc.constant("`a|b`"), fc.constant("*e*")), {
      minLength: 1,
      maxLength: 5,
    })
    .map((parts) => parts.join(" "))
  const prefix = fc.constantFrom(
    "",
    "> ",
    "- ",
    "1. ",
    "  ",
    "\t",
    "> > ",
    "- > ",
  )
  const paragraph = fc
    .array(fc.tuple(prefix, inline), { minLength: 1, maxLength: 3 })
    .map((lines) => lines.map(([p, t]) => p + t).join("\n"))
  const cell = fc
    .tuple(inline, fc.boolean())
    .map(([t, pipe]) => (pipe ? `${t} \\| x` : t).replace(/\n/g, " "))
  const table = fc
    .array(cell, { minLength: 1, maxLength: 3 })
    .map(
      (cells) =>
        `| ${cells.map(() => "h").join(" | ")} |\n|${cells.map(() => "-").join("|")}|\n| ${cells.join(" | ")} |`,
    )
  const listWithTabs = fc
    .tuple(word, inline)
    .map(([a, t]) => `- ${a}\n\t${t.replace(/\n/g, " ")}`)
  const heading = fc
    .tuple(fc.constantFrom("# ", "## "), inline)
    .map(([h, t]) => h + t.replace(/\n/g, " "))
  const block = fc.oneof(paragraph, paragraph, table, listWithTabs, heading)
  const body = fc
    .tuple(
      fc.array(block, { minLength: 1, maxLength: 6 }),
      fc.constantFrom("\n", "\r\n", "\r"),
    )
    .map(([blocks, end]) => `${blocks.join("\n\n")}\n`.replace(/\n/g, end))

  it("every range slices to the written link, or to the whole lines it was read from", () => {
    let fallbacks = 0
    fc.assert(
      fc.property(body, (text) => {
        const lineStarts = new Set([0])
        const lineEnds = new Set([text.length])
        for (const m of text.matchAll(/\r\n?|\n/g)) {
          lineEnds.add(m.index)
          lineStarts.add(m.index + m[0].length)
        }
        for (const link of parseBody(text, 0).links) {
          const written = text.slice(link.range.start, link.range.end)
          const exact =
            link.kind === "definition"
              ? written.startsWith("[")
              : /^(!?\[[\s\S]*\]\([\s\S]*\)|<[^<>\s]*>)$/.test(written)
          if (exact) continue
          fallbacks++
          expect(lineStarts.has(link.range.start)).toBe(true)
          expect(lineEnds.has(link.range.end)).toBe(true)
        }
      }),
      { numRuns: 500, verbose: 1 },
    )
    // The fallback is a safety net; the generator should not need it.
    expect(fallbacks).toBe(0)
  }, 120_000)
})
