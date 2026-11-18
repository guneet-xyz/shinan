/**
 * A linear scan of a Markdown body that micromark runs before reading it.
 * micromark's time grows with the square of several shapes of input, so a
 * body past these limits is refused (catalog §2.1). Real documents stay far
 * below them: across the `workspace` repository and Shinan's documents, the
 * most container blocks any document opens is 72.
 *
 * The scan is conservative, not exact: it counts by line starts, the way
 * micromark sees lines (`\n`, `\r\n` and a lone `\r` all end a line), and
 * may count lines inside fenced code. That only makes it refuse sooner.
 * It cannot be proven complete, which is why proposal and MCP text is also
 * parsed off the main event loop with a timeout (security checklist 10.8).
 */

/** Quote and list markers a line may start with. */
export const maxNesting = 32
/** Quotes and list items opened inside others. */
export const maxNestedContainers = 1000
/**
 * Quotes and lists started: markers on a line beyond those it shares with
 * the line before (a different kind of marker starts a new block).
 */
export const maxContainerBlocks = 1000
/** Lines that continue a quote or list paragraph without its markers. */
export const maxLazyLines = 1000
/** Lines of only `=` or `-`, which may underline setext headings. */
export const maxUnderlines = 500

export interface BodyShape {
  deepest: number
  nested: number
  blocks: number
  lazy: number
  underlines: number
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
  }
  // Only for the scan: the stored text and every range are unchanged.
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  let previous = ""
  let inContainer = false
  for (const line of lines) {
    const start = lineStart(line)
    const blank = start.rest.trim() === ""
    if (start.markers > shape.deepest) shape.deepest = start.markers
    shape.nested += start.nested
    shape.blocks += start.markers - sharedPrefix(start.kinds, previous)
    if (isUnderline(start.rest)) shape.underlines++
    if (start.markers === 0 && !blank && inContainer && start.indent < 2)
      shape.lazy++
    // A blank line (even inside a quote, `>` alone) ends paragraph
    // continuation; a line with markers or a lazy line keeps it going.
    inContainer = !blank && (start.markers > 0 || inContainer)
    previous = blank && start.markers === 0 ? "" : start.kinds
  }
  return shape
}

interface LineStart {
  /** Quote and list markers at the start of the line. */
  markers: number
  /** One character per marker: `>`, the bullet, or `.`/`)` for numbers. */
  kinds: string
  /** Markers that open a container inside another one. */
  nested: number
  /** Columns of indentation before the first marker or text. */
  indent: number
  /** The line after its markers and the spaces between them. */
  rest: string
}

function lineStart(line: string): LineStart {
  let markers = 0
  let kinds = ""
  let nested = 0
  let indent = 0
  let i = 0
  while (i < line.length) {
    const c = line.charCodeAt(i)
    if (c === 32 || c === 9) {
      if (markers === 0) indent += c === 9 ? 4 : 1
      i++
      continue
    }
    if (c === 62) {
      if (markers > 0) nested++
      markers++
      kinds += ">"
      i++
      continue
    }
    if ((c === 45 || c === 42 || c === 43) && isBlank(line, i + 1)) {
      if (markers > 0 || indent >= 2) nested++
      markers++
      kinds += line[i]
      i++
      continue
    }
    if (isDigit(c)) {
      let j = i
      while (j < line.length && j - i < 9 && isDigit(line.charCodeAt(j))) j++
      const mark = line.charCodeAt(j)
      if ((mark === 46 || mark === 41) && isBlank(line, j + 1)) {
        if (markers > 0 || indent >= 2) nested++
        markers++
        kinds += line[j]
        i = j + 1
        continue
      }
    }
    break
  }
  return { markers, kinds, nested, indent, rest: line.slice(i) }
}

function sharedPrefix(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

/** A space or tab follows: a list marker, not the start of `-x` or `---`. */
function isBlank(line: string, i: number): boolean {
  const c = line.charCodeAt(i)
  return c === 32 || c === 9
}

function isDigit(c: number): boolean {
  return c >= 48 && c <= 57
}

/** Only `=` or only `-`, with spaces or tabs around or between. */
function isUnderline(rest: string): boolean {
  return /^[ \t]*(?:=[ \t]*)+$|^[ \t]*(?:-[ \t]*)+$/.test(rest)
}
