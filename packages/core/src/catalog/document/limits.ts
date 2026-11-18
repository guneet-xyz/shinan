/**
 * A linear scan of a Markdown body that runs before micromark reads it.
 * micromark's time grows with the square of several shapes of input, so a
 * body past these limits is refused (catalog §2.1).
 *
 * **When unsure, count.** The scan does not try to parse Markdown exactly;
 * wherever a line could be one of the costly shapes, it is counted as one:
 *
 * - a line ends at `\n`, `\r\n` or a lone `\r`, as micromark sees lines;
 * - a marker (`>`, `-`, `+`, `*`, or digits and `.` or `)`) counts whether a
 *   space, a tab or the end of the line follows it; a line whose first
 *   characters could be a marker but are followed by something else (`-x`,
 *   `1.5`) counts as a block start and, inside a quote or list, as a lazy
 *   line too;
 * - every non-blank line without markers that continues a paragraph in a
 *   quote counts as a lazy line, at any indentation (a line without `>`
 *   never belongs to the quote); in a list item, so does every such line
 *   indented less than the item's content (the column after its marker and
 *   spaces), which is the only way it can belong to the item;
 * - markers inside fenced code are counted like any others.
 *
 * - link destinations opened with `](` are counted per paragraph, less the
 *   `)` in it, whether or not they would close.
 *
 * Over-counting only makes the scan refuse sooner, and real documents stay
 * below the limits: across the 142 Markdown files of the `workspace`
 * repository and Shinan's own documents (cut to 64 KiB), counted this
 * conservative way, the highest counts are 81 nested containers, 452 blocks,
 * 220 lazy lines, 4 underlines and no unclosed links, all in Shinan's design
 * documents. The scan still cannot be proven complete,
 * which is why proposal and MCP text is also parsed off the main event loop
 * with a time limit (security checklist 10.8).
 */

/** Quote and list markers a line may start with. */
export const maxNesting = 32
/** Quotes and list items opened inside others. */
export const maxNestedContainers = 1000
/**
 * Quotes and lists started: markers on a line beyond those it shares with
 * the line before (a different kind of marker starts a new block), and
 * lines that could start one.
 */
export const maxContainerBlocks = 1000
/** Lines that may continue a quote or list paragraph without its markers. */
export const maxLazyLines = 1000
/** Lines of only `=` or `-`, which may underline setext headings. */
export const maxUnderlines = 500
/** Link destinations opened with `](` and not closed, counted per paragraph. */
export const maxUnclosedLinks = 1000

export interface BodyShape {
  deepest: number
  nested: number
  blocks: number
  lazy: number
  underlines: number
  unclosedLinks: number
}

/** Why a body is refused, or null if it is within every limit. */
export function tooComplex(shape: BodyShape): string | null {
  if (shape.deepest > maxNesting)
    return `A line nests quotes or lists ${shape.deepest} deep; at most ${maxNesting} are read`
  if (shape.nested > maxNestedContainers)
    return `The body opens ${shape.nested} quotes or list items inside others; at most ${maxNestedContainers} are read`
  if (shape.blocks > maxContainerBlocks)
    return `The body starts ${shape.blocks} separate quotes or lists; at most ${maxContainerBlocks} are read`
  if (shape.lazy > maxLazyLines)
    return `The body has ${shape.lazy} lines continuing a quote or list without its markers; at most ${maxLazyLines} are read`
  if (shape.underlines > maxUnderlines)
    return `The body has ${shape.underlines} lines of only = or -; at most ${maxUnderlines} are read`
  if (shape.unclosedLinks > maxUnclosedLinks)
    return `The body has ${shape.unclosedLinks} links opened with "](" and not closed; at most ${maxUnclosedLinks} are read`
  return null
}

/** Measures `text` for `tooComplex`. */
export function bodyShape(text: string): BodyShape {
  const shape: BodyShape = {
    deepest: 0,
    nested: 0,
    blocks: 0,
    lazy: 0,
    underlines: 0,
    unclosedLinks: 0,
  }
  // Only for the scan: the stored text and every range are unchanged.
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  let previous = ""
  let inContainer = false
  let inQuote = false
  let contentColumn = 0
  let opened = 0
  let closed = 0
  for (const line of lines) {
    const start = lineStart(line)
    const blank =
      start.markers === 0 && !start.candidate && isBlankText(start.rest)
    if (blank) {
      shape.unclosedLinks += Math.max(0, opened - closed)
      opened = 0
      closed = 0
    } else {
      opened += count(line, "](")
      closed += count(line, ")")
    }
    if (start.markers > shape.deepest) shape.deepest = start.markers
    shape.nested += start.nested
    shape.blocks += start.kinds.length - sharedPrefix(start.kinds, previous)
    if (start.candidate) shape.blocks++
    if (isUnderline(start.rest)) shape.underlines++
    if (
      inContainer &&
      !blank &&
      (start.candidate ||
        (start.markers === 0 && (inQuote || start.indent < contentColumn)))
    )
      shape.lazy++
    if (start.markers > 0) {
      inQuote = start.kinds.includes(">")
      contentColumn = start.column
    }
    // A blank line ends paragraph continuation; a line with markers, or a
    // lazy line, keeps it going.
    inContainer =
      !blank && (start.markers > 0 || start.candidate || inContainer)
    previous = blank ? "" : start.kinds
  }
  shape.unclosedLinks += Math.max(0, opened - closed)
  return shape
}

interface LineStart {
  /** Markers at the start of the line followed by a space, tab or line end. */
  markers: number
  /** One character per marker: `>`, the bullet, or `.`/`)` for numbers. */
  kinds: string
  /** Markers that open a container inside another one. */
  nested: number
  /** The line's first characters could be a marker but are followed by text. */
  candidate: boolean
  /** Columns of indentation before the first marker or text. */
  indent: number
  /** The column where the text after the markers starts. */
  column: number
  /** The line after its markers and the spaces between them. */
  rest: string
}

function lineStart(line: string): LineStart {
  let markers = 0
  let kinds = ""
  let nested = 0
  let indent = 0
  let column = 0
  let i = 0
  while (i < line.length) {
    const c = line.charCodeAt(i)
    if (c === 32 || c === 9) {
      const width = c === 9 ? 4 - (column % 4) : 1
      if (markers === 0) indent += width
      column += width
      i++
      continue
    }
    if (c === 62) {
      // `>` needs nothing after it.
      if (markers > 0) nested++
      markers++
      kinds += ">"
      column++
      i++
      continue
    }
    let end = -1
    if (c === 45 || c === 42 || c === 43) end = i + 1
    else if (isDigit(c)) {
      let j = i
      while (j < line.length && j - i < 9 && isDigit(line.charCodeAt(j))) j++
      const mark = line.charCodeAt(j)
      if (mark === 46 || mark === 41) end = j + 1
    }
    if (end < 0) break
    if (!isBlank(line, end)) {
      // Could be a marker, but text follows: count it as a possible block
      // start and keep the rest for the underline check.
      return {
        markers,
        kinds,
        nested,
        candidate: true,
        indent,
        column,
        rest: line.slice(i),
      }
    }
    if (markers > 0 || indent >= 2) nested++
    markers++
    kinds += line[end - 1]
    column += end - i
    i = end
  }
  return {
    markers,
    kinds,
    nested,
    candidate: false,
    indent,
    column,
    rest: line.slice(i),
  }
}

/** A space, a tab or the end of the line follows. */
function isBlank(line: string, i: number): boolean {
  if (i >= line.length) return true
  const c = line.charCodeAt(i)
  return c === 32 || c === 9
}

function isBlankText(text: string): boolean {
  return /^[ \t]*$/.test(text)
}

function isDigit(c: number): boolean {
  return c >= 48 && c <= 57
}

function count(line: string, token: string): number {
  let n = 0
  for (let i = line.indexOf(token); i >= 0; i = line.indexOf(token, i + 1)) n++
  return n
}

function sharedPrefix(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

/** Only `=` or only `-`, with spaces or tabs around or between. */
function isUnderline(rest: string): boolean {
  return /^[ \t]*(?:=[ \t]*)+$|^[ \t]*(?:-[ \t]*)+$/.test(rest)
}
