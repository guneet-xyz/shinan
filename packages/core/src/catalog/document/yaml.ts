import {
  Composer,
  isAlias,
  isMap,
  isPair,
  isScalar,
  isSeq,
  Parser,
  Scalar,
} from "yaml"
import type { Node as YamlLibraryNode } from "yaml"

import type { Range } from "./source.js"

/**
 * The frontmatter's YAML, reduced to the subset catalog §2.1 allows: plain
 * maps, lists and scalars (strings, numbers, booleans and `null`). Dates stay
 * strings; Shinan checks them itself (see `dates.ts`). Ranges are offsets
 * into the whole document.
 */
export type YamlNode = YamlScalar | YamlMap | YamlList

export type ScalarValue = string | number | boolean | null

export interface YamlScalar {
  kind: "scalar"
  value: ScalarValue
  range: Range
}

export interface YamlMap {
  kind: "map"
  entries: YamlEntry[]
  /** Written inline, as `{ a: 1 }`. */
  flow: boolean
  range: Range
}

export interface YamlEntry {
  key: string
  keyRange: Range
  value: YamlNode
  /** From the key's first character to the value's last. */
  range: Range
}

export interface YamlList {
  kind: "list"
  items: YamlNode[]
  flow: boolean
  range: Range
}

export interface YamlProblem {
  message: string
  range: Range
}

export interface YamlResult {
  node: YamlNode | null
  problems: YamlProblem[]
}

const parseOptions = {
  version: "1.2",
  schema: "core",
  strict: true,
  uniqueKeys: true,
  prettyErrors: false,
} as const

/**
 * Parses `source`, which starts at `offset` in the document, refusing
 * anchors, aliases, tags, directives, document markers, multiple documents,
 * duplicate keys, keys that are not plain strings, and numbers that are not
 * finite. YAML 1.2's core schema keeps `no`, `on` and dates as strings.
 */
export function parseYaml(source: string, offset: number): YamlResult {
  const problems: YamlProblem[] = []
  const at = (start: number, end = start): Range => ({
    start: offset + start,
    end: offset + Math.max(start, end),
  })

  // One tokenization serves both the marker checks and the composer.
  const tokens = Array.from(new Parser().parse(source))
  let documents = 0
  for (const token of tokens) {
    if (token.type === "directive")
      problems.push({
        message: "YAML directives (lines starting with %) are not allowed",
        range: at(token.offset, token.offset + token.source.length),
      })
    if (token.type === "document") {
      documents++
      if (token.start.some((t) => t.type === "doc-start"))
        problems.push({
          message: "Document markers (---) are not allowed inside frontmatter",
          range: at(token.offset),
        })
    }
    if (token.type === "doc-end")
      problems.push({
        message: "Document markers (...) are not allowed inside frontmatter",
        range: at(token.offset, token.offset + token.source.length),
      })
  }
  if (documents > 1)
    problems.push({
      message: "Frontmatter must hold exactly one YAML document",
      range: at(0, source.length),
    })

  const composed = Array.from(
    new Composer(parseOptions).compose(tokens, true, source.length),
  )
  const document = composed[0]
  if (!document) return { node: null, problems }
  for (const error of [...document.errors, ...document.warnings]) {
    problems.push({
      message: describeError(error.code, error.message),
      range: at(error.pos[0], error.pos[1]),
    })
  }
  if (problems.length > 0) return { node: null, problems }

  const node = document.contents
    ? convert(document.contents, source, at, problems)
    : null
  return { node: problems.length > 0 ? null : node, problems }
}

function describeError(code: string, message: string): string {
  switch (code) {
    case "DUPLICATE_KEY":
      return "A key appears twice in the same map"
    case "MULTIPLE_DOCS":
      return "Frontmatter must hold exactly one YAML document"
    case "TAG_RESOLVE_FAILED":
      return "YAML tags are not allowed"
    default:
      return `YAML could not be read: ${message.split("\n")[0]}`
  }
}

function convert(
  node: YamlLibraryNode,
  source: string,
  at: (start: number, end?: number) => Range,
  problems: YamlProblem[],
): YamlNode | null {
  const range = valueRange(node, source, at)
  if (isAlias(node)) {
    problems.push({ message: "YAML aliases (*name) are not allowed", range })
    return null
  }
  if (node.anchor)
    problems.push({ message: "YAML anchors (&name) are not allowed", range })
  if (node.tag)
    problems.push({ message: "YAML tags (!tag) are not allowed", range })

  if (isScalar(node)) {
    const value = node.value
    if (typeof value === "number" && !Number.isFinite(value)) {
      problems.push({
        message: "Infinite and not-a-number values are not allowed",
        range,
      })
      return null
    }
    if (typeof value === "number") {
      // Every reader must see what the text says, so a number is accepted
      // only when it reads back as written: not `1.10`, `0x10`, `+12`, `1e3`
      // or an integer too large to hold exactly.
      const [start, end] = node.range ?? [0, 0]
      const written = source.slice(start, end)
      if (String(value) !== written) {
        problems.push({
          message: `${written} would be read as the number ${String(value)}; put it in quotes to keep it as written`,
          range,
        })
        return null
      }
    }
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      problems.push({ message: "Unsupported YAML value", range })
      return null
    }
    return { kind: "scalar", value, range }
  }

  if (isMap(node)) {
    const entries: YamlEntry[] = []
    for (const pair of node.items) {
      if (!isPair(pair)) continue
      const key = pair.key as YamlLibraryNode | null
      if (
        !key ||
        !isScalar(key) ||
        typeof key.value !== "string" ||
        key.anchor ||
        key.tag
      ) {
        problems.push({
          message: "Map keys must be plain text",
          range: key ? valueRange(key, source, at) : range,
        })
        continue
      }
      const keyRange = valueRange(key, source, at)
      const raw = pair.value as YamlLibraryNode | null
      const value: YamlNode | null = raw
        ? convert(raw, source, at, problems)
        : {
            kind: "scalar",
            value: null,
            range: { start: keyRange.end, end: keyRange.end },
          }
      if (!value) continue
      entries.push({
        key: key.value,
        keyRange,
        value,
        range: {
          start: keyRange.start,
          end: Math.max(keyRange.end, value.range.end),
        },
      })
    }
    return { kind: "map", entries, flow: Boolean(node.flow), range }
  }

  if (isSeq(node)) {
    const items: YamlNode[] = []
    for (const item of node.items) {
      const converted = convert(item as YamlLibraryNode, source, at, problems)
      if (converted) items.push(converted)
    }
    return { kind: "list", items, flow: Boolean(node.flow), range }
  }

  problems.push({ message: "Unsupported YAML", range })
  return null
}

/** The node's own text, without trailing spaces, line breaks or comments. */
function valueRange(
  node: YamlLibraryNode,
  source: string,
  at: (start: number, end?: number) => Range,
): Range {
  const [start, end] = node.range ?? [0, 0, 0]
  let last = end
  if (!(isScalar(node) && isBlockScalar(node))) {
    while (last > start && /\s/.test(source[last - 1] ?? "")) last--
  }
  return at(start, last)
}

function isBlockScalar(node: Scalar): boolean {
  return node.type === Scalar.BLOCK_LITERAL || node.type === Scalar.BLOCK_FOLDED
}
