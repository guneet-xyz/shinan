import type { ScalarValue, YamlNode } from "./yaml.js"
import { parseYaml } from "./yaml.js"

/**
 * The one canonical style Shinan writes new catalog content in (catalog
 * §4.3; architecture §5.2, rule 2). Existing text keeps its own style; only
 * what an operation adds or rewrites is written here:
 *
 * - block maps and lists, indented by two spaces, for documents, fact
 *   groups, state maps, lists of facts and start-here steps;
 * - one line per fact: a short form (`key: value`) or a flow map in the
 *   order `to`, relation attributes, `value`, `via`, `note`, `task`,
 *   `remove`, `accepted`;
 * - flow lists for lists of names (`aliases`, `required`, `sections`), and
 *   flow maps for a type schema's key options;
 * - text plain where YAML's core schema reads it back as the same text, and
 *   double-quoted otherwise: anything that would read as a number, a
 *   boolean or null (`"1.10"`, `"true"`, `"null"`, `"~"`), start with an
 *   indicator, hold `: ` or ` #`, or span lines. Numbers are written as
 *   `String(n)`, which the parser always reads back as written.
 */
export type Out =
  | { kind: "scalar"; value: ScalarValue }
  | { kind: "map"; entries: [string, Out][]; flow?: boolean }
  | { kind: "list"; items: Out[]; flow?: boolean }
  /**
   * Existing text moved as it is (one line). `flowSafe` says whether it may
   * stand inside a flow collection; when not, `node` is written instead.
   */
  | { kind: "raw"; text: string; flowSafe: boolean; node: YamlNode }
  /**
   * An existing block map moved as it is: its lines, without the
   * indentation of its first line. Inside a flow collection, `node` is
   * written instead.
   */
  | { kind: "lines"; lines: string[]; node: YamlNode }

export const scalar = (value: ScalarValue): Out => ({ kind: "scalar", value })
export const flowMap = (entries: [string, Out][]): Out => ({
  kind: "map",
  entries,
  flow: true,
})
export const blockMap = (entries: [string, Out][]): Out => ({
  kind: "map",
  entries,
  flow: false,
})
export const flowList = (items: Out[]): Out => ({
  kind: "list",
  items,
  flow: true,
})
export const blockList = (items: Out[]): Out => ({
  kind: "list",
  items,
  flow: false,
})

/** A YAML scalar as text, in block context or inside a flow collection. */
export function yamlScalar(value: ScalarValue, flow: boolean): string {
  if (value === null) return "null"
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new RangeError("Infinite and not-a-number values cannot be written")
    return String(value)
  }
  return plainIsSafe(value, flow) ? value : doubleQuoted(value)
}

/**
 * Whether `text` can be written without quotes and still read back as the
 * same text: checked by reading it, so the rules of YAML's core schema
 * (numbers, booleans, null) and of plain scalars are never restated here.
 */
function plainIsSafe(text: string, flow: boolean): boolean {
  if (text === "" || text !== text.trim()) return false
  // Line breaks, tabs, control and invisible characters are always quoted,
  // so the text stays one line and shows what it holds.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f\u00a0\u2028\u2029\ufeff]/.test(text))
    return false
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(text)) return false
  if (/: |:$| #/.test(text)) return false
  if (flow && /[,[\]{}]/.test(text)) return false
  const read = parseYaml(flow ? `[${text}]` : `k: ${text}`, 0)
  if (read.problems.length > 0 || !read.node) return false
  const node =
    read.node.kind === "list"
      ? read.node.items[0]
      : read.node.kind === "map"
        ? read.node.entries[0]?.value
        : undefined
  const count =
    read.node.kind === "list"
      ? read.node.items.length
      : read.node.kind === "map"
        ? read.node.entries.length
        : 0
  return count === 1 && node?.kind === "scalar" && node.value === text
}

/**
 * YAML double-quoted text: JSON's escapes, which YAML accepts, plus escapes
 * for characters JSON leaves as they are but YAML does not allow raw or
 * would hide (C1 controls, separators, the byte-order mark).
 */
function doubleQuoted(text: string): string {
  return JSON.stringify(text).replace(
    /[\u007f-\u009f\u00a0\u2028\u2029\ufeff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  )
}

/**
 * A map key: plain unless it would read as something other than its text,
 * as the fact keys `null`, `true` and `false` would.
 */
export function keyText(key: string, flow: boolean): string {
  return yamlScalar(key, flow)
}

/** A node on one line, as it reads inside a flow collection. */
export function flowText(node: Out): string {
  switch (node.kind) {
    case "scalar":
      return yamlScalar(node.value, true)
    case "raw":
      return node.flowSafe ? node.text : flowText(fromYaml(node.node))
    case "lines":
      return flowText(fromYaml(node.node))
    case "map":
      return node.entries.length === 0
        ? "{}"
        : `{ ${node.entries.map(([k, v]) => `${keyText(k, true)}: ${flowText(v)}`).join(", ")} }`
    case "list":
      return `[${node.items.map(flowText).join(", ")}]`
  }
}

/** Whether a node is written on the same line as its key or dash. */
function inline(node: Out): boolean {
  if (node.kind === "lines") return false
  return (
    node.kind === "scalar" ||
    node.kind === "raw" ||
    node.flow === true ||
    (node.kind === "map" && node.entries.length === 0) ||
    (node.kind === "list" && node.items.length === 0)
  )
}

function inlineText(node: Out): string {
  if (node.kind === "scalar") return yamlScalar(node.value, false)
  if (node.kind === "raw") return node.text
  if (node.kind === "lines") return flowText(node)
  return flowText(node)
}

/** `key: value`, as lines starting at `indent` spaces. */
export function entryLines(key: string, value: Out, indent: number): string[] {
  const pad = " ".repeat(indent)
  const name = keyText(key, false)
  if (inline(value)) return [`${pad}${name}: ${inlineText(value)}`]
  if (value.kind === "lines")
    return [
      `${pad}${name}:`,
      ...value.lines.map((l) => indented(l, indent + 2)),
    ]
  return [`${pad}${name}:`, ...blockLines(value, indent + 2)]
}

/** A list item, as lines whose dash is at `indent` spaces. */
export function itemLines(value: Out, indent: number): string[] {
  const pad = " ".repeat(indent)
  if (inline(value)) return [`${pad}- ${inlineText(value)}`]
  if (value.kind === "lines")
    return value.lines.map((l, i) =>
      i === 0 ? `${pad}- ${l}` : indented(l, indent + 2),
    )
  const lines = blockLines(value, indent + 2)
  const first = lines[0] ?? ""
  return [`${pad}- ${first.slice(indent + 2)}`, ...lines.slice(1)]
}

function indented(line: string, indent: number): string {
  return line === "" ? "" : " ".repeat(indent) + line
}

/** A block map's entries or a block list's items, as lines at `indent` spaces. */
export function blockLines(node: Out, indent: number): string[] {
  if (node.kind === "map")
    return node.entries.flatMap(([k, v]) => entryLines(k, v, indent))
  if (node.kind === "list")
    return node.items.flatMap((item) => itemLines(item, indent))
  if (node.kind === "lines") return node.lines.map((l) => indented(l, indent))
  return [`${" ".repeat(indent)}${inlineText(node)}`]
}

/** A node read from the document, to write again in flow style. */
export function fromYaml(node: YamlNode): Out {
  switch (node.kind) {
    case "scalar":
      return scalar(node.value)
    case "map":
      return flowMap(node.entries.map((e) => [e.key, fromYaml(e.value)]))
    case "list":
      return flowList(node.items.map(fromYaml))
  }
}
