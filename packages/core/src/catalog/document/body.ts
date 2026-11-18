import type { Nodes, Root } from "mdast"
import { fromMarkdown } from "mdast-util-from-markdown"
import { toString } from "mdast-util-to-string"

import { bodyShape, tooComplex } from "./limits.js"
import type { Range } from "./source.js"

/**
 * The Markdown body of a catalog document, split by heading (catalog §2.5,
 * §12.1). Section texts concatenated in order give the body exactly.
 */
export interface Body {
  range: Range
  text: string
  sections: Section[]
  links: BodyLink[]
}

export interface Section {
  /** The heading's text, or null for the text before the first heading. */
  heading: string | null
  /** The heading's level (1 to 6), or 0 for the text before the first heading. */
  level: number
  /**
   * A name for the section that is unique in the body, made from the heading
   * the way GitHub makes heading anchors (`Cautions` is `cautions`, a second
   * `Cautions` is `cautions-1`). Null for the text before the first heading.
   */
  anchor: string | null
  /** From the heading's first character to the next heading at any level, or the end of the body. */
  range: Range
  /** The heading line itself; null for the text before the first heading. */
  headingRange: Range | null
  /** Exactly the source text of `range`. */
  text: string
}

export interface BodyLink {
  /** `link` (`[text](url)`), `image` (`![alt](url)`) or `definition` (`[label]: url`). */
  kind: "link" | "image" | "definition"
  /** The destination as written, with Markdown escapes decoded. */
  url: string
  /**
   * The entity ID the destination names, when it is a reference
   * (catalog §2.4): a destination with no scheme that does not start with
   * `/`, `.`, `#` or `?`, without any `#section` part. Whether it resolves is
   * validation's job.
   */
  reference: string | null
  range: Range
}

/**
 * Markdown constructs the body model never uses, turned off: emphasis,
 * inline HTML and hard line breaks. Emphasis (`attention`) and inline HTML
 * take quadratic time in micromark on hostile input such as repeated `*a_`
 * or `<!--`. Heading text keeps any literal `*` or `_`, which anchors drop
 * anyway. Links, code, headings, quotes, lists and HTML blocks stay, since
 * they decide what is a heading or a link.
 */
const options = {
  extensions: [
    {
      disable: {
        null: ["attention", "htmlText", "hardBreakEscape", "hardBreakTrailing"],
      },
    },
  ],
}

/**
 * Thrown when a body goes past the limits of `limits.ts`;
 * `parseCatalogDocument` reports it as a problem.
 */
export class BodyTooComplexError extends Error {}

/** Parses the body that starts at `offset` in the document. */
export function parseBody(text: string, offset: number): Body {
  const refusal = tooComplex(bodyShape(text))
  if (refusal) throw new BodyTooComplexError(refusal)
  const tree = fromMarkdown(text, options)
  return {
    range: { start: offset, end: offset + text.length },
    text,
    sections: splitSections(tree, text, offset),
    links: collectLinks(tree, offset),
  }
}

function splitSections(tree: Root, text: string, offset: number): Section[] {
  const headings = tree.children.flatMap((node) =>
    node.type === "heading" && node.position?.start.offset !== undefined
      ? [
          {
            start: node.position.start.offset,
            end: node.position.end.offset ?? node.position.start.offset,
            level: node.depth,
            heading: toString(node),
          },
        ]
      : [],
  )
  const sections: Section[] = []
  const first = headings[0]?.start ?? text.length
  if (first > 0 || headings.length === 0) {
    sections.push({
      heading: null,
      level: 0,
      anchor: null,
      range: { start: offset, end: offset + first },
      headingRange: null,
      text: text.slice(0, first),
    })
  }
  const anchors = new AnchorMaker()
  headings.forEach((h, i) => {
    const end = headings[i + 1]?.start ?? text.length
    sections.push({
      heading: h.heading,
      level: h.level,
      anchor: anchors.make(h.heading),
      range: { start: offset + h.start, end: offset + end },
      headingRange: { start: offset + h.start, end: offset + h.end },
      text: text.slice(h.start, end),
    })
  })
  return sections
}

function collectLinks(tree: Root, offset: number): BodyLink[] {
  const links: BodyLink[] = []
  // An explicit stack, not recursion: deeply nested quotes or lists must not
  // overflow the call stack.
  const stack: Nodes[] = [tree]
  while (stack.length > 0) {
    const node = stack.pop() as Nodes
    if (
      (node.type === "link" ||
        node.type === "image" ||
        node.type === "definition") &&
      node.position?.start.offset !== undefined
    ) {
      links.push({
        kind: node.type,
        url: node.url,
        reference: referenceTarget(node.url),
        range: {
          start: offset + node.position.start.offset,
          end:
            offset + (node.position.end.offset ?? node.position.start.offset),
        },
      })
    }
    if ("children" in node)
      for (let i = node.children.length - 1; i >= 0; i--)
        stack.push(node.children[i] as Nodes)
  }
  return links
}

/** The entity ID a link destination names, or null if it is not a reference. */
export function referenceTarget(url: string): string | null {
  if (url === "" || /^[a-z][a-z0-9+.-]*:/i.test(url) || /^[/.#?]/.test(url))
    return null
  const hash = url.indexOf("#")
  const target = hash < 0 ? url : url.slice(0, hash)
  return target === "" ? null : target
}

/** GitHub-style heading anchors, unique within one body. */
export class AnchorMaker {
  private readonly seen = new Map<string, number>()

  make(heading: string): string {
    const base =
      heading
        .toLowerCase()
        .trim()
        .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
        .replace(/\s/g, "-") || "section"
    const count = this.seen.get(base)
    if (count === undefined) {
      this.seen.set(base, 0)
      return base
    }
    let n = count + 1
    while (this.seen.has(`${base}-${n}`)) n++
    this.seen.set(base, n)
    this.seen.set(`${base}-${n}`, 0)
    return `${base}-${n}`
  }
}
