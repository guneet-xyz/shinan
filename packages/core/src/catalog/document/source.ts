/**
 * A span of a document's text: offsets into the full Markdown text of the
 * document, `end` exclusive. Every part of the parsed model carries one, so
 * operations can edit exactly the bytes they target (architecture §5.2,
 * rule 2).
 */
export interface Range {
  start: number
  end: number
}

/** A 1-based line and column, for messages. */
export interface Position {
  line: number
  column: number
}

export function positionAt(text: string, offset: number): Position {
  let line = 1
  let lineStart = 0
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++
      lineStart = i + 1
    }
  }
  return { line, column: offset - lineStart + 1 }
}

/**
 * Widens a range to whole lines: from the start of its first line to just
 * after the line break that ends its last line (or the end of the text).
 */
export function lineRange(text: string, range: Range): Range {
  let start = range.start
  while (start > 0 && text[start - 1] !== "\n") start--
  let end = range.end
  if (end > start && text[end - 1] === "\n") return { start, end }
  while (end < text.length && text[end] !== "\n") end++
  if (end < text.length) end++
  return { start, end }
}

export function slice(text: string, range: Range): string {
  return text.slice(range.start, range.end)
}
