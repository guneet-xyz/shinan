import { describe, expect, it } from "vitest"

import { alignmentClasses, createMarkdown, markdownOptions } from "./index.js"
import { growth, maxGrowth } from "./testing.js"

const md = createMarkdown()

describe("the shared configuration", () => {
  // Every construct the configuration reads, including hostile ones.
  const everything = `# Heading **bold** _em_ ~~gone~~ \`code\`

Setext
===

Text with [a link](machine/musashi), <https://example.com/x>, an
![image](https://example.com/i.png), a ![data image](data:image/png;base64,AAAA),
[script](javascript:alert(1)), [vb](vbscript:x), [file](file:///etc/passwd),
[data](data:text/html,<script>x</script>), [ref][r] and [![inner](i.png)](machine/x).

> A quote with <b onclick="x">raw HTML</b> and <script>alert(1)</script>
> - a list in it

1. one
2. two
   - nested

| Left | Centre | Right | None |
|:-----|:------:|------:|------|
| a | b | c | d |

\`\`\`js
const x = "<script>"
\`\`\`

    indented code

<div style="color: red">raw block</div>

---

[r]: machine/y "Title"
`

  it("renders HTML the Content Security Policy allows", () => {
    const html = md.render(everything)
    // Inside tags only: raw HTML written in the text is shown escaped.
    expect(html).not.toMatch(/<[^>]*\sstyle=/i)
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/<img/i)
    expect(html).not.toMatch(/<[^>]*\son[a-z]+=/i)
    expect(html).not.toMatch(/(href|src)="(javascript|vbscript|file|data):/i)
    expect(html).toContain(`<th class="${alignmentClasses.left}">Left</th>`)
    expect(html).toContain(`<td class="${alignmentClasses.center}">b</td>`)
    expect(html).toContain(`<td class="${alignmentClasses.right}">c</td>`)
    expect(html).toContain("<td>d</td>")
    expect(html).toContain('<a href="https://example.com/i.png">image</a>')
    expect(html).toContain('<a href="machine/x">inner</a>')
    expect(html).toContain('<a href="machine/musashi">a link</a>')
  })

  it("leaves refused destinations as text", () => {
    const html = md.render(
      "[s](javascript:x) ![d](data:image/png;base64,AAAA)\n",
    )
    expect(html).toBe(
      "<p>[s](javascript:x) ![d](data:image/png;base64,AAAA)</p>\n",
    )
  })

  it("renders no raw HTML and reads tables and strikethrough", () => {
    const html = md.render(
      "<script>alert(1)</script>\n\n| a |\n| - |\n| ~~b~~ |\n",
    )
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
    expect(html).toContain("<table>")
    expect(html).toContain("<s>b</s>")
  })

  it("does not turn bare addresses into links, or change quotes", () => {
    expect(md.render('See https://example.com "here"')).toBe(
      "<p>See https://example.com &quot;here&quot;</p>\n",
    )
  })

  it("nests deeper than the body limits allow, so nothing stored is cut off", () => {
    // 32 nested list markers (catalog §2.1) use about 64 levels.
    const deep = `${Array.from({ length: 32 }, (_, i) => `${"  ".repeat(i)}- a`).join("\n")} [x](y)\n`
    expect(md.render(deep)).toContain('<a href="y">x</a>')
    expect(markdownOptions.maxNesting).toBeGreaterThan(64)
  })

  it("gives each caller its own parser", () => {
    expect(createMarkdown()).not.toBe(createMarkdown())
  })
})

describe("time on hostile input (#102)", () => {
  // Inputs that made the earlier parser (micromark) take seconds to minutes
  // at 64 KiB, here with no limits in front. markdown-it's time must grow
  // about linearly (see `growth` in ./testing.ts: CPU time, best of five,
  // the full size against four quarters).
  const fill = (unit: string, size: number) =>
    unit.repeat(Math.ceil(size / unit.length)).slice(0, size)
  const read = (text: string) => md.parse(text, {})

  it.each<[string, (size: number) => string]>([
    ["emphasis *a_", (n) => fill("*a_", n)],
    ["emphasis **a__", (n) => fill("**a__", n)],
    ["strikethrough ~~a", (n) => fill("~~a", n)],
    ["unclosed links", (n) => fill("[a](", n)],
    ["unclosed links to <", (n) => fill("[a](<", n)],
    ["unclosed links, one per line", (n) => fill("[a](\n", n)],
    ["reference-style links", (n) => fill("[a][b]", n)],
    ["link brackets", (n) => fill("[", n)],
    ["inline HTML comments", (n) => fill("a <!-- b\n", n)],
    ["backticks", (n) => fill("`a", n)],
    ["a list in every list item", (n) => fill("- - a\n", n)],
    ["two-level lists", (n) => fill("- a\n  - b\n", n)],
    ["deeply nested ordered lists", (n) => fill("1. ", n)],
    ["deeply nested quotes", (n) => `${">".repeat(n - 2)} x`],
    ["quotes reopened inside quotes", (n) => fill("> > a\n> \n", n)],
    ["setext headings", (n) => fill("a\n===\n", n)],
    ["setext headings in quotes", (n) => fill("> a\n> ===\n", n)],
    ["separate quotes", (n) => fill("> b\n\n", n)],
    ["a quote with lazy lines", (n) => `> a\n${fill("b\n", n - 4)}`],
    [
      "a quote with tab-indented lazy lines",
      (n) => `> a\n${fill("\tb\n", n - 4)}`,
    ],
    ["empty quotes between paragraphs", (n) => fill(">\nb\n", n)],
    ["lists interrupted by paragraphs", (n) => fill("- b\n\nc\n\n", n)],
    ["empty list items", (n) => fill("+\n\nc\n\n", n)],
    [
      "lazy lines under a wide marker",
      (n) => `123456789. a\n${fill("   b\n", n - 20)}`,
    ],
    ["> > a, then > b", (n) => `> > a\n${fill("> b\n", n - 6)}`],
    ["> - a, then > b", (n) => `> - a\n${fill("> b\n", n - 6)}`],
    ["two-level lists, CR line breaks", (n) => fill("- a\r  - b\r", n)],
    ["setext headings, CR line breaks", (n) => fill("a\r===\r", n)],
    ["a long flat list", (n) => fill("- a\n", n)],
    [
      "table rows",
      (n) => `| a | b |\n| - | - |\n${fill("| [a](b) | c |\n", n - 20)}`,
    ],
    ["link definitions", (n) => fill("[r]: x\n", n)],
  ])(
    "reads %s in time that grows about linearly",
    (_, make) => {
      const { ratio, full } = growth(make, read, 64 * 1024)
      expect(ratio).toBeLessThan(maxGrowth)
      expect(full).toBeLessThan(30_000)
    },
    120_000,
  )
})

describe("the growth measurement itself", () => {
  // Work that is quadratic or linear in the length of the text, to check
  // that `growth` tells them apart reliably.
  const quadratic = (text: string) => {
    const n = text.length >> 3
    let sum = 0
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) sum += i ^ j
    return sum
  }
  const linear = (text: string) => {
    let sum = 0
    for (let k = 0; k < 64; k++)
      for (let i = 0; i < text.length; i++) sum += text.charCodeAt(i) ^ k
    return sum
  }
  const make = (size: number) => "a".repeat(size)

  it("flags quadratic work", () => {
    expect(growth(make, quadratic, 64 * 1024).ratio).toBeGreaterThan(maxGrowth)
  })

  it("passes linear work", () => {
    expect(growth(make, linear, 64 * 1024).ratio).toBeLessThan(maxGrowth)
  })
})
