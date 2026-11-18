import { describe, expect, it } from "vitest"

import { createMarkdown, markdownOptions } from "./index.js"

const md = createMarkdown()

describe("the shared configuration", () => {
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
  // about linearly: from 16 KiB to 64 KiB, the best of three runs grows well
  // under 16 times (quadratic). Wall-clock time is a loose backstop only.
  const fill = (unit: string, size: number) =>
    unit.repeat(Math.ceil(size / unit.length)).slice(0, size)
  const best = (text: string) => {
    let fastest = Infinity
    for (let i = 0; i < 3; i++) {
      const started = performance.now()
      md.parse(text, {})
      fastest = Math.min(fastest, performance.now() - started)
    }
    return fastest
  }

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
      const quarter = Math.max(best(make(16 * 1024)), 2)
      const full = best(make(64 * 1024))
      expect(full / quarter).toBeLessThan(8)
      expect(full).toBeLessThan(30_000)
    },
    120_000,
  )
})
