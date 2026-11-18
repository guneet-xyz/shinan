import type { Range } from "./source.js"
import {
  blockLines,
  entryLines,
  flowText,
  itemLines,
  keyText,
} from "./write.js"
import type { Out } from "./write.js"
import type { YamlEntry, YamlList, YamlMap, YamlNode } from "./yaml.js"

/**
 * Edits on a document's text at the places the parsed model points to
 * (architecture §5.2, rule 2): each replaces one range and leaves every
 * other byte as it was. Block and flow collections are both handled, so a
 * document keeps whatever YAML style it was written in.
 */
export interface Edit {
  start: number
  end: number
  text: string
}

export function applyEdit(text: string, edit: Edit): string {
  return text.slice(0, edit.start) + edit.text + text.slice(edit.end)
}

/** A layout the edits cannot handle, such as a list item sharing its line with another dash. */
export class UnsupportedLayoutError extends Error {}

/** The line break the document uses: `\r\n` when its first line ends with one. */
export function lineBreak(text: string): string {
  const first = text.indexOf("\n")
  return first > 0 && text[first - 1] === "\r" ? "\r\n" : "\n"
}

export function lineStart(text: string, offset: number): number {
  let i = offset
  while (i > 0 && text[i - 1] !== "\n") i--
  return i
}

/** Just after the line break ending the line `offset` is on (or the end of the text). */
export function lineEnd(text: string, offset: number): number {
  if (offset > 0 && text[offset - 1] === "\n") return offset
  const newline = text.indexOf("\n", offset)
  return newline < 0 ? text.length : newline + 1
}

export function column(text: string, offset: number): number {
  return offset - lineStart(text, offset)
}

/** Whether only spaces come before `offset` on its line. */
function firstOnLine(text: string, offset: number): boolean {
  return /^[ \t]*$/.test(text.slice(lineStart(text, offset), offset))
}

/**
 * The dash of a block list item: before the item on its line, or on an
 * earlier line with only a comment after it (`- # note`), with blank or
 * comment lines between.
 */
function dashOf(text: string, item: YamlNode): number {
  let i = item.range.start - 1
  while (i >= 0 && (text[i] === " " || text[i] === "\t")) i--
  if (text[i] === "-") return i
  let end = lineStart(text, item.range.start)
  while (end > 0) {
    const start = lineStart(text, end - 1)
    const line = text.slice(start, end).replace(/\r?\n$/, "")
    const dash = /^([ \t]*)-(?:[ \t]+#.*|[ \t]*)$/.exec(line)
    if (dash) return start + (dash[1]?.length ?? 0)
    if (!/^[ \t]*(?:#.*)?$/.test(line)) break
    end = start
  }
  throw new UnsupportedLayoutError("A list item has no dash before it")
}

/** The `:` after an entry's key. */
function colonOf(text: string, entry: YamlEntry): number {
  const colon = text.indexOf(":", entry.keyRange.end)
  if (colon < 0) throw new UnsupportedLayoutError("A map entry has no colon")
  return colon
}

/** Whether a value has text of its own (an empty value is null with no text). */
function written(entry: YamlEntry): boolean {
  return entry.value.range.start > entry.keyRange.end
}

function lines(parts: string[], eol: string): string {
  return parts.map((l) => l + eol).join("")
}

/** Removes the entry at `index` from a map that keeps at least one other entry. */
export function removeMapEntry(
  text: string,
  map: YamlMap,
  index: number,
): Edit {
  const entry = map.entries[index]
  if (!entry) throw new RangeError("No such entry")
  const next = map.entries[index + 1]
  const previous = map.entries[index - 1]
  if (map.flow) {
    if (next)
      return { start: entry.keyRange.start, end: next.keyRange.start, text: "" }
    if (previous)
      return { start: previous.range.end, end: entry.range.end, text: "" }
    return { start: entry.keyRange.start, end: entry.range.end, text: "" }
  }
  if (firstOnLine(text, entry.keyRange.start))
    return {
      start: lineStart(text, entry.keyRange.start),
      end: lineEnd(text, entry.range.end),
      text: "",
    }
  // The first entry of a list item shares its line with the dash: the next
  // entry moves up to the dash, at the same column. Comment lines between
  // them belong to the next entry and stay: the first moves up to the dash
  // instead (`- # note`), and the next entry keeps its own line.
  if (next) {
    const after = lineEnd(text, entry.range.end)
    const between = text.slice(after, next.keyRange.start)
    const end = between.includes("#")
      ? after + between.length - between.trimStart().length
      : next.keyRange.start
    return { start: entry.keyRange.start, end, text: "" }
  }
  throw new UnsupportedLayoutError("Cannot remove the only entry of a map")
}

/** Removes the item at `index` from a list that keeps at least one other item. */
export function removeListItem(
  text: string,
  list: YamlList,
  index: number,
): Edit {
  const item = list.items[index]
  if (!item) throw new RangeError("No such item")
  const next = list.items[index + 1]
  const previous = list.items[index - 1]
  if (list.flow) {
    if (next)
      return { start: item.range.start, end: next.range.start, text: "" }
    if (previous)
      return { start: previous.range.end, end: item.range.end, text: "" }
    return { start: item.range.start, end: item.range.end, text: "" }
  }
  const dash = dashOf(text, item)
  if (!firstOnLine(text, dash))
    throw new UnsupportedLayoutError("A list item shares its line")
  return {
    start: lineStart(text, dash),
    end: lineEnd(text, item.range.end),
    text: "",
  }
}

/**
 * Adds `key: value` to a map: in a block map, as new lines after the entry
 * before `position` (or before the first entry), at the map's indentation;
 * in a flow map, at the end.
 */
export function insertMapEntry(
  text: string,
  map: YamlMap,
  key: string,
  value: Out,
  eol: string,
  position = map.entries.length,
): Edit {
  if (map.flow) {
    const last = map.entries[map.entries.length - 1]
    if (last)
      return {
        start: last.range.end,
        end: last.range.end,
        text: `, ${keyText(key, true)}: ${flowText(value)}`,
      }
    return {
      start: map.range.start,
      end: map.range.end,
      text: `{ ${keyText(key, true)}: ${flowText(value)} }`,
    }
  }
  const first = map.entries[0]
  if (!first)
    throw new UnsupportedLayoutError("Cannot add to an empty block map")
  const indent = column(text, first.keyRange.start)
  const after = map.entries[position - 1]
  if (after) {
    const at = lineEnd(text, after.range.end)
    // The last line of the frontmatter may end without a line break only
    // when it is the end of the text, which a document never is.
    return {
      start: at,
      end: at,
      text: lines(entryLines(key, value, indent), eol),
    }
  }
  if (!firstOnLine(text, first.keyRange.start))
    throw new UnsupportedLayoutError(
      "Cannot add before an entry that shares its line",
    )
  const at = lineStart(text, first.keyRange.start)
  return {
    start: at,
    end: at,
    text: lines(entryLines(key, value, indent), eol),
  }
}

/** Adds an item at the end of a list. */
export function appendListItem(
  text: string,
  list: YamlList,
  value: Out,
  eol: string,
): Edit {
  const last = list.items[list.items.length - 1]
  if (list.flow) {
    if (last)
      return {
        start: last.range.end,
        end: last.range.end,
        text: `, ${flowText(value)}`,
      }
    return {
      start: list.range.start,
      end: list.range.end,
      text: `[${flowText(value)}]`,
    }
  }
  if (!last)
    throw new UnsupportedLayoutError("Cannot add to an empty block list")
  const dash = dashOf(text, last)
  if (!firstOnLine(text, dash))
    throw new UnsupportedLayoutError("A list item shares its line")
  const at = lineEnd(text, last.range.end)
  return {
    start: at,
    end: at,
    text: lines(itemLines(value, column(text, dash)), eol),
  }
}

/**
 * The line break a block scalar (`|`, `>`) ends with: its range includes the
 * break, which a replacement must keep so the next line stays its own.
 */
function blockScalarTail(text: string, node: YamlNode): string {
  if (node.kind !== "scalar") return ""
  const first = text[node.range.start]
  if (first !== "|" && first !== ">") return ""
  const written = text.slice(node.range.start, node.range.end)
  return written.endsWith("\r\n") ? "\r\n" : written.endsWith("\n") ? "\n" : ""
}

/**
 * Replaces an entry's value. A value that fits on the key's line replaces
 * the old value's text exactly; a block value starts on the next line,
 * indented two spaces more than the key. A block scalar's final line break
 * stays.
 */
export function replaceEntryValue(
  text: string,
  entry: YamlEntry,
  value: Out,
  inFlow: boolean,
  eol: string,
): Edit {
  const blockValue =
    !inFlow &&
    (value.kind === "map" || value.kind === "list") &&
    !value.flow &&
    (value.kind === "map" ? value.entries.length > 0 : value.items.length > 0)
  const old = entry.value
  const oldIsBlock = (old.kind === "map" || old.kind === "list") && !old.flow
  const tail = written(entry) ? blockScalarTail(text, old) : ""
  if (!blockValue && !oldIsBlock && written(entry))
    return {
      start: old.range.start,
      end: old.range.end,
      text: (inFlow ? flowText(value) : inlineFirst(value)) + tail,
    }
  const colon = colonOf(text, entry)
  const indent = column(text, entry.keyRange.start) + 2
  // A comment on the key's own line, before a value on the next line (or no
  // value), stays there; the new value starts on the next line.
  const comment = /^[ \t]+#[^\r\n]*/.exec(text.slice(colon + 1))?.[0]
  const keep =
    comment !== undefined &&
    !inFlow &&
    (!written(entry) || old.range.start > colon + 1 + comment.length)
  const start = keep ? colon + 1 + comment.length : colon + 1
  const end = written(entry) ? old.range.end : start
  if (!blockValue) {
    const inline = inFlow ? flowText(value) : inlineFirst(value)
    return {
      start,
      end,
      text: keep
        ? `${eol}${" ".repeat(indent)}${inline}${tail}`
        : ` ${inline}${tail}`,
    }
  }
  const body = blockLines(value, indent)
  return { start, end, text: eol + body.join(eol) + tail }
}

/** Replaces a list item with a value that fits on one line. */
export function replaceListItem(
  text: string,
  item: YamlNode,
  value: Out,
  inFlow: boolean,
): Edit {
  return {
    start: item.range.start,
    end: item.range.end,
    text:
      (inFlow ? flowText(value) : inlineFirst(value)) +
      blockScalarTail(text, item),
  }
}

/** A value written on one line in block context. */
function inlineFirst(value: Out): string {
  const [line] = entryLines("k", value, 0)
  if (!line || !line.startsWith("k: "))
    throw new UnsupportedLayoutError("A value that spans lines cannot go here")
  return line.slice(3)
}

/** Replaces a range of the text, such as a body section. */
export function replaceRange(range: Range, text: string): Edit {
  return { start: range.start, end: range.end, text }
}
