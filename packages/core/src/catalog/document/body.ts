import { createMarkdown } from "@shinan/markdown"
import type {
  Env,
  MarkdownIt,
  StateBlock,
  StateInline,
  Token,
} from "@shinan/markdown"

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
  /**
   * The heading itself, from its first character to the end of its last
   * line (both lines of an underlined heading); null for the text before the
   * first heading.
   */
  headingRange: Range | null
  /** Exactly the source text of `range`. */
  text: string
}

export interface BodyLink {
  /** `link` (`[text](url)`), `image` (`![alt](url)`) or `definition` (`[label]: url`). */
  kind: "link" | "image" | "definition"
  /**
   * The destination as written, with Markdown escapes and character
   * references decoded, and nothing else changed (no percent-encoding or
   * decoding). Every destination is listed, including `javascript:`,
   * `file:` and `data:` ones, so validation sees them; the wiki's renderer
   * never makes those clickable.
   */
  url: string
  /**
   * The entity ID the destination names, when it is a reference
   * (catalog §2.4): a destination with no scheme that does not start with
   * `/`, `.`, `#` or `?`, without any `#section` part. Whether it resolves is
   * validation's job.
   */
  reference: string | null
  /**
   * Where the link is written: from `[` (or `<`, `![`) to the closing `)`
   * or `>`, or for a definition its first and last lines. If the link's
   * text cannot be found where the parser read it, the range covers the
   * lines it was read from, so it always contains the link.
   */
  range: Range
}

/**
 * The parser: Shinan's shared Markdown configuration (`@shinan/markdown`,
 * the same one the wiki renders with), plus rules that note where each link
 * and definition is written, since markdown-it keeps source lines for
 * blocks but no positions for inline content.
 */
const markdown = withPositions(createMarkdown())

/**
 * Thrown when a body goes past the limits of `limits.ts`;
 * `parseCatalogDocument` reports it as a problem.
 */
export class BodyTooComplexError extends Error {}

/** Parses the body that starts at `offset` in the document. */
export function parseBody(text: string, offset: number): Body {
  const refusal = tooComplex(bodyShape(text))
  if (refusal) throw new BodyTooComplexError(refusal)
  const env: ParseEnv = {}
  const tokens = markdown.parse(text, env)
  if (env.cutOff)
    throw new BodyTooComplexError(
      `The body nests quotes or lists deeper than the Markdown reader goes (${markdown.options.maxNesting} levels, about ${Math.floor(markdown.options.maxNesting / 2)} lists inside each other), so the rest would be lost`,
    )
  const lines = new Lines(text)
  return {
    range: { start: offset, end: offset + text.length },
    text,
    sections: splitSections(tokens, lines, text, offset),
    links: collectLinks(tokens, lines, offset),
  }
}

interface Heading {
  start: number
  end: number
  level: number
  heading: string
}

function splitSections(
  tokens: Token[],
  lines: Lines,
  text: string,
  offset: number,
): Section[] {
  const headings: Heading[] = []
  tokens.forEach((token, i) => {
    if (token.type !== "heading_open" || token.level !== 0 || !token.map) return
    const [first, after] = token.map
    headings.push({
      start: lines.firstText(first),
      end: lines.end(after - 1, true),
      level: Number(token.tag.slice(1)),
      heading: plainText(tokens[i + 1]?.children ?? []),
    })
  })
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

/** The text of inline tokens, without Markdown: what a reader sees. */
function plainText(children: Token[]): string {
  let result = ""
  for (const token of children) {
    if (token.type === "text" || token.type === "code_inline")
      result += token.content
    else if (token.type === "image") result += plainText(token.children ?? [])
    else if (token.type === "softbreak" || token.type === "hardbreak")
      result += "\n"
  }
  return result
}

function collectLinks(
  tokens: Token[],
  lines: Lines,
  offset: number,
): BodyLink[] {
  const links: BodyLink[] = []
  // Table cells carry no lines of their own; their row's do.
  let lastMap: [number, number] | null = null
  const cursor = new Map<number, number>()
  let previous: Token | undefined
  for (const token of tokens) {
    const after = previous
    previous = token
    if (token.map) lastMap = token.map
    if (token.type === "reference_definition" && token.map) {
      const meta = token.meta as { href?: string } | null
      if (meta?.href === undefined) continue
      const [first, after] = token.map
      const start = lines.indexOf(first, "[") ?? lines.firstText(first)
      links.push(
        link("definition", meta.href, {
          start: offset + start,
          end: offset + lines.end(after - 1, true),
        }),
      )
      continue
    }
    if (token.type !== "inline" || !lastMap) continue
    const place = new ContentPlace(
      token.content,
      token.map ?? lastMap,
      lines,
      cursor,
      after?.type === "th_open" || after?.type === "td_open",
    )
    for (const child of token.children ?? []) {
      const kind =
        child.type === "link_open"
          ? "link"
          : child.type === "image"
            ? "image"
            : null
      if (!kind) continue
      const href = String(
        child.attrGet(kind === "image" ? "src" : "href") ?? "",
      )
      const at = child.meta as {
        start?: number
        end?: number
        viaDefinition?: boolean
      } | null
      if (at?.viaDefinition) continue
      const start = at?.start === undefined ? null : place.source(at.start)
      const end = at?.end === undefined ? null : place.source(at.end)
      const range =
        start !== null && end !== null && end > start
          ? { start, end }
          : place.whole()
      links.push(
        link(kind, href, {
          start: offset + range.start,
          end: offset + range.end,
        }),
      )
    }
  }
  return links
}

function link(kind: BodyLink["kind"], url: string, range: Range): BodyLink {
  return { kind, url, reference: referenceTarget(url), range }
}

/** The body's lines, as markdown-it numbers them (`\n`, `\r\n` or `\r` ends one). */
class Lines {
  private readonly starts: number[] = [0]
  private readonly ends: number[] = []

  constructor(readonly text: string) {
    const breaks = /\r\n?|\n/g
    for (let m = breaks.exec(text); m; m = breaks.exec(text)) {
      this.ends.push(m.index)
      this.starts.push(m.index + m[0].length)
    }
    this.ends.push(text.length)
  }

  get count(): number {
    return this.starts.length
  }

  start(line: number): number {
    return this.starts[Math.min(line, this.count - 1)] ?? this.text.length
  }

  /** The end of a line, before its line break; with `trim`, before trailing spaces. */
  end(line: number, trim = false): number {
    const end = this.ends[Math.min(line, this.count - 1)] ?? this.text.length
    if (!trim) return end
    let at = end
    const start = this.start(line)
    while (at > start && /[ \t]/.test(this.text[at - 1] ?? "")) at--
    return at
  }

  line(line: number): string {
    return this.text.slice(this.start(line), this.end(line))
  }

  /** The first character on a line that is not a space or tab. */
  firstText(line: number): number {
    const start = this.start(line)
    const end = this.end(line)
    let at = start
    while (at < end && /[ \t]/.test(this.text[at] ?? "")) at++
    return at < end ? at : start
  }

  /** Where `search` first appears on a line, or null. */
  indexOf(line: number, search: string): number | null {
    const found = this.line(line).indexOf(search)
    return found < 0 ? null : this.start(line) + found
  }
}

/** One line of an inline token's content, and where it is in the body. */
interface Piece {
  /** Its offset in the content. */
  content: number
  /** Spaces it starts with in the content (tabs the parser expanded, too). */
  lead: number
  /** Where its first other character is in the body, or null if not found. */
  source: number | null
  /** The body line it was read from. */
  line: number
  /** Offsets after `lead` of `|` that the body writes `\|` (table cells). */
  pipes: number[]
}

/**
 * Maps offsets in an inline token's content back to the body's text. The
 * content is the block's lines, each without its quote and list markers and
 * indentation, joined with line breaks and trimmed; so each line of content
 * is found at the end of its source line (or, for a table cell or a heading
 * with closing `#`, inside it). Each line is anchored at its first
 * character that is not a space, since the parser may have turned a tab
 * there into spaces; in a table cell, `|` is looked for as written, `\|`.
 */
class ContentPlace {
  private readonly pieces: Piece[] = []

  constructor(
    content: string,
    map: [number, number],
    private readonly lines: Lines,
    cursor: Map<number, number>,
    cell: boolean,
  ) {
    let at = 0
    content.split("\n").forEach((piece, i) => {
      const line = Math.min(map[0] + i, Math.max(map[0], map[1] - 1))
      const core = piece.trimStart()
      const lead = piece.length - core.length
      const place = find(lines.line(line), core, cursor.get(line) ?? 0, cell)
      if (place) cursor.set(line, place.end)
      this.pieces.push({
        content: at,
        lead,
        source: place ? lines.start(line) + place.start : null,
        line,
        pipes: place?.pipes ?? [],
      })
      at += piece.length + 1
    })
  }

  /** The body offset of a content offset, or null if it cannot be placed. */
  source(offset: number): number | null {
    let piece = this.pieces[0]
    for (const p of this.pieces) {
      if (p.content > offset) break
      piece = p
    }
    if (!piece || piece.source === null) return null
    const into = Math.max(0, offset - piece.content - piece.lead)
    const escapes = piece.pipes.filter((p) => p < into).length
    return Math.min(piece.source + into + escapes, this.lines.end(piece.line))
  }

  /** The lines the content was read from. */
  whole(): Range {
    const first = this.pieces[0]?.line ?? 0
    const last = this.pieces.at(-1)?.line ?? first
    return { start: this.lines.start(first), end: this.lines.end(last) }
  }
}

/**
 * Finds a line of content in its source line, from `from` on. A table
 * cell's content is searched for with every `|` written `\|` first (a bare
 * `|` would have ended the cell), and never just at the end of the row, so
 * it cannot match across a cell boundary. Other content is found at the end
 * of its line (after trailing spaces), or else anywhere after `from`.
 */
function find(
  source: string,
  core: string,
  from: number,
  cell: boolean,
): { start: number; end: number; pipes: number[] } | null {
  if (core === "") return null
  if (!cell) {
    const trimmed = source.trimEnd()
    if (trimmed.endsWith(core) && trimmed.length - core.length >= from) {
      const start = trimmed.length - core.length
      return { start, end: trimmed.length, pipes: [] }
    }
  }
  if (cell && core.includes("|")) {
    const escaped = core.replaceAll("|", "\\|")
    const found = source.indexOf(escaped, from)
    if (found >= 0) {
      const pipes: number[] = []
      for (let i = core.indexOf("|"); i >= 0; i = core.indexOf("|", i + 1))
        pipes.push(i)
      return { start: found, end: found + escaped.length, pipes }
    }
  }
  const index = source.indexOf(core, from)
  if (index >= 0) return { start: index, end: index + core.length, pipes: [] }
  return null
}

type ParseEnv = Env & {
  /** Set when markdown-it stopped reading at its nesting limit. */
  cutOff?: boolean
}

type InlineRule = (state: StateInline, silent: boolean) => boolean
type BlockRule = (
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
) => boolean

interface RuleList<T> {
  __rules__: { name: string; fn: T }[]
}

/**
 * Adds positions to links and definitions: each link, image and autolink
 * token gets `meta.start` and `meta.end`, offsets in its inline content;
 * each definition token gets its destination in `meta.href`, even when its
 * label repeats an earlier one (markdown-it keeps only the first).
 */
function withPositions(md: MarkdownIt): MarkdownIt {
  // markdown-it has no public way to wrap a rule; its rule list is read
  // here once, when the parser is set up.
  const inline = md.inline.ruler as unknown as RuleList<InlineRule>
  for (const name of ["link", "image", "autolink"]) {
    const rule = inline.__rules__.find((r) => r.name === name)?.fn
    if (!rule) throw new Error(`markdown-it has no inline rule "${name}"`)
    md.inline.ruler.at(name, (state, silent) => {
      const start = state.pos
      const before = state.tokens.length
      const matched = rule(state, silent)
      if (matched && !silent) {
        const token = state.tokens
          .slice(before)
          .find((t) => t.type === "link_open" || t.type === "image")
        if (token) {
          const written = state.src.slice(start, state.pos)
          // A reference-style link (`[text][label]`, `[text]`) takes its
          // destination from a definition, which is listed itself; an
          // inline link always ends with `)`.
          const viaDefinition = name !== "autolink" && !written.endsWith(")")
          token.meta = { ...token.meta, start, end: state.pos, viaDefinition }
        }
      }
      return matched
    })
  }
  const block = md.block.ruler as unknown as RuleList<BlockRule>
  const reference = block.__rules__.find((r) => r.name === "reference")?.fn
  if (!reference) throw new Error('markdown-it has no block rule "reference"')
  md.block.ruler.at("reference", (state, startLine, endLine, silent) => {
    const env = state.env as { references?: Record<string, unknown> }
    const kept = env.references
    const own: Record<string, { href: string }> = {}
    env.references = own
    let matched: boolean
    try {
      matched = reference(state, startLine, endLine, silent)
    } finally {
      env.references = kept ?? {}
      for (const [label, value] of Object.entries(own))
        if (!(label in env.references)) env.references[label] = value
    }
    if (matched && !silent) {
      const token = state.tokens.at(-1)
      const href = Object.values(own)[0]?.href
      if (token?.type === "reference_definition" && href !== undefined)
        token.meta = { ...token.meta, href }
    }
    return matched
  })
  // Keep the definition tokens: markdown-it drops them before reading
  // inline content, but the body model lists definitions as links.
  md.core.ruler.disable("strip_references")
  // Keep every destination as written, and list them all, including
  // `javascript:`, `file:` and `data:`, so validation sees them. Only this
  // instance does so; the wiki renders with its own, which refuses them.
  md.normalizeLink = (url) => url
  md.validateLink = () => true
  // markdown-it stops reading, silently, where blocks nest deeper than
  // `maxNesting`; note it, so the body is refused instead.
  const tokenize = md.block.tokenize.bind(md.block)
  md.block.tokenize = (state, startLine, endLine) => {
    if (state.level >= md.options.maxNesting) {
      const line = state.skipEmptyLines(startLine)
      if (line < endLine && state.sCount[line]! >= state.blkIndent)
        (state.env as ParseEnv).cutOff = true
    }
    tokenize(state, startLine, endLine)
  }
  return md
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
