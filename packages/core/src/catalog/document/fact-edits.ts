import { canonicalValue } from "./identity.js"
import { factStates } from "./model.js"
import type {
  CatalogDocument,
  EntityDocument,
  FactCheck,
  FactState,
  WrittenFact,
} from "./model.js"
import type { FactInput, KeyOptions, StartHereStepInput } from "./operations.js"
import type { KeySchema } from "./schemas.js"
import {
  appendListItem,
  column,
  insertMapEntry,
  lineBreak,
  removeListItem,
  removeMapEntry,
  replaceEntryValue,
  replaceListItem,
  UnsupportedLayoutError,
} from "./text-edit.js"
import type { Edit } from "./text-edit.js"
import {
  blockList,
  blockMap,
  flowList,
  flowMap,
  fromYaml,
  scalar,
} from "./write.js"
import type { Out } from "./write.js"
import type { YamlEntry, YamlList, YamlMap, YamlNode } from "./yaml.js"

/**
 * A fact as Shinan writes it: an operation's fact, plus `accepted`, which
 * only Shinan writes (catalog §4.7).
 */
export type FactToWrite = FactInput & { accepted?: string }

/** The fields of a fact check as Shinan writes them, `by` included. */
export interface CheckFields {
  checked: string
  by: string
  scope: string
  source: string
  limits?: string
}

/** The frontmatter's top-level map, rebuilt from the document's fields. */
export function topMap(document: CatalogDocument): YamlMap {
  const range = document.frontmatter
  if (!range)
    throw new UnsupportedLayoutError("The document has no frontmatter")
  const yaml = document.text
    .slice(range.start, range.end)
    .replace(/^[ \t]*#.*$/gm, "")
  return {
    kind: "map",
    entries: [...document.fields.values()],
    flow: /^\s*\{/.test(yaml),
    range,
  }
}

/** Where a written fact is in the frontmatter's YAML. */
interface Located {
  list: YamlList
  group: YamlMap
  stateEntry: YamlEntry
  stateMap: YamlMap
  keyEntry: YamlEntry
  /** The key's list, when the fact is one of its items. */
  itemList: YamlList | null
  /** The fact's value: a scalar, or a long form's map. */
  node: YamlNode
  /** Whether the fact's value sits inside a flow collection. */
  inFlow: boolean
}

function locate(document: EntityDocument, fact: WrittenFact): Located {
  const facts = document.fields.get("facts")?.value
  const group = facts?.kind === "list" ? facts.items[fact.group] : undefined
  const stateEntry =
    group?.kind === "map"
      ? group.entries.find((e) => e.key === fact.state)
      : undefined
  const stateMap = stateEntry?.value
  const keyEntry =
    stateMap?.kind === "map"
      ? stateMap.entries.find((e) => e.key === fact.key)
      : undefined
  if (
    facts?.kind !== "list" ||
    group?.kind !== "map" ||
    !stateEntry ||
    stateMap?.kind !== "map" ||
    !keyEntry
  )
    throw new UnsupportedLayoutError("A fact is not where the model says")
  let itemList: YamlList | null = null
  let node: YamlNode = keyEntry.value
  if (fact.item !== null) {
    if (keyEntry.value.kind !== "list")
      throw new UnsupportedLayoutError("A fact is not where the model says")
    itemList = keyEntry.value
    const item = itemList.items[fact.item]
    if (!item)
      throw new UnsupportedLayoutError("A fact is not where the model says")
    node = item
  }
  return {
    list: facts,
    group,
    stateEntry,
    stateMap,
    keyEntry,
    itemList,
    node,
    inFlow: itemList ? itemList.flow : stateMap.flow,
  }
}

/**
 * Removes a fact. A key, state map, group or `facts` field left empty goes
 * with it (catalog §4.3: groups left empty are dropped).
 */
export function removeFactEdit(
  document: EntityDocument,
  fact: WrittenFact,
): Edit {
  const text = document.text
  const at = locate(document, fact)
  if (at.itemList && at.itemList.items.length > 1 && fact.item !== null)
    return removeListItem(text, at.itemList, fact.item)
  if (at.stateMap.entries.length > 1)
    return removeMapEntry(
      text,
      at.stateMap,
      at.stateMap.entries.indexOf(at.keyEntry),
    )
  const states = at.group.entries.filter((e) =>
    factStates.some((s) => s === e.key),
  )
  if (states.length > 1)
    return removeMapEntry(
      text,
      at.group,
      at.group.entries.indexOf(at.stateEntry),
    )
  if (at.list.items.length > 1) return removeListItem(text, at.list, fact.group)
  const top = topMap(document)
  return removeMapEntry(
    text,
    top,
    top.entries.findIndex((e) => e.key === "facts"),
  )
}

/** Replaces a fact's value where it stands, keeping its key and place. */
export function replaceFactEdit(
  document: EntityDocument,
  fact: WrittenFact,
  value: Out,
): Edit {
  const at = locate(document, fact)
  if (at.itemList)
    return replaceListItem(document.text, at.node, value, at.inFlow)
  return replaceEntryValue(
    document.text,
    at.keyEntry,
    value,
    at.inFlow,
    lineBreak(document.text),
  )
}

/** Removes `accepted` from a fact's long form (catalog §4.7). */
export function stripAcceptedEdit(
  document: EntityDocument,
  fact: WrittenFact,
): Edit {
  const at = locate(document, fact)
  if (at.node.kind !== "map")
    throw new UnsupportedLayoutError("Only a long form holds `accepted`")
  return removeMapEntry(
    document.text,
    at.node,
    at.node.entries.findIndex((e) => e.key === "accepted"),
  )
}

/**
 * A fact's value as it stands, to move elsewhere: its own text when it is
 * one line, and otherwise rewritten on one line.
 */
export function factText(document: EntityDocument, fact: WrittenFact): Out {
  const at = locate(document, fact)
  const out = valueOut(document.text, at.node, at.inFlow)
  // The comment at the end of the fact's line moves with it.
  const comment = /^[ \t]+#[^\r\n]*/.exec(
    document.text.slice(at.node.range.end),
  )?.[0]
  if (!comment || at.inFlow) return out
  if (out.kind === "raw")
    return { ...out, text: out.text + comment, flowSafe: false }
  if (out.kind === "lines") {
    const lines = [...out.lines]
    lines[lines.length - 1] += comment
    return { ...out, lines }
  }
  return out
}

export function checkMatches(
  check: FactCheck | null,
  target: CheckFields | null,
): boolean {
  if (target === null) return check === null
  return (
    check !== null &&
    check.checked !== null &&
    check.checked?.text === target.checked &&
    check.by === target.by &&
    check.scope === target.scope &&
    check.source === target.source &&
    check.limits === target.limits
  )
}

/**
 * Adds a fact to the first group whose fact check matches in every field
 * (catalog §4.3), or to a new group at the end of `facts`. A group whose
 * state map already holds a single-valued key cannot take a second value
 * of it, so that fact goes to another group.
 */
export function insertFactEdit(
  document: EntityDocument,
  check: CheckFields | null,
  state: FactState,
  key: string,
  many: boolean,
  value: Out,
): Edit {
  const text = document.text
  const eol = lineBreak(text)
  const factsEntry = document.fields.get("facts")
  const list = factsEntry?.value.kind === "list" ? factsEntry.value : null
  for (const group of document.groups) {
    if (!checkMatches(group.check, check)) continue
    const node = list?.items[group.index]
    if (node?.kind !== "map") continue
    const stateEntry = node.entries.find((e) => e.key === state)
    if (!stateEntry)
      return insertMapEntry(
        text,
        node,
        state,
        node.flow ? flowMap([[key, value]]) : blockMap([[key, value]]),
        eol,
      )
    const stateMap = stateEntry.value
    if (stateMap.kind !== "map") continue
    const keyEntry = stateMap.entries.find((e) => e.key === key)
    if (!keyEntry) return insertMapEntry(text, stateMap, key, value, eol)
    if (!many) continue
    if (keyEntry.value.kind === "list")
      return appendListItem(text, keyEntry.value, value, eol)
    const old = valueOut(text, keyEntry.value, stateMap.flow)
    return replaceEntryValue(
      text,
      keyEntry,
      stateMap.flow ? flowList([old, value]) : blockList([old, value]),
      stateMap.flow,
      eol,
    )
  }

  const group = blockMap([
    ...(check ? checkEntries(check) : []),
    [state, blockMap([[key, value]])],
  ])
  if (list && list.items.length > 0)
    return appendListItem(text, list, group, eol)
  if (
    factsEntry &&
    (list ||
      (factsEntry.value.kind === "scalar" && factsEntry.value.value === null))
  )
    return replaceEntryValue(text, factsEntry, blockList([group]), false, eol)
  if (factsEntry)
    throw new UnsupportedLayoutError("`facts` is not a list of groups")
  return insertField(document, "facts", blockList([group]))
}

/**
 * A value as it stands, to move elsewhere: its own text (a block map's
 * lines re-indented), or, when it spans lines otherwise, written again in
 * flow style.
 */
function valueOut(text: string, node: YamlNode, inFlow: boolean): Out {
  if (node.kind === "map" && !node.flow) {
    const lines = blockText(text, node)
    return lines ? { kind: "lines", lines, node } : fromYaml(node)
  }
  const written = text.slice(node.range.start, node.range.end)
  if (written.includes("\n") || written.includes("\r")) return fromYaml(node)
  return {
    kind: "raw",
    text: written,
    flowSafe: inFlow || /^["'{[]/.test(written),
    node,
  }
}

/**
 * A block map's lines without the indentation of its first line, or null if
 * a line is indented less (then it is written again instead).
 */
function blockText(text: string, node: YamlMap): string[] | null {
  const indent = column(text, node.range.start)
  const lines = text.slice(node.range.start, node.range.end).split(/\r?\n/)
  const out: string[] = [lines[0] ?? ""]
  for (const line of lines.slice(1)) {
    if (line.trim() === "") out.push("")
    else if (/^ *$/.test(line.slice(0, indent))) out.push(line.slice(indent))
    else return null
  }
  return out
}

function checkEntries(check: CheckFields): [string, Out][] {
  const entries: [string, Out][] = [
    ["checked", scalar(check.checked)],
    ["by", scalar(check.by)],
    ["scope", scalar(check.scope)],
    ["source", scalar(check.source)],
  ]
  if (check.limits !== undefined) entries.push(["limits", scalar(check.limits)])
  return entries
}

/**
 * A new fact, in canonical style: the short form when it has only a value
 * (or a target, or an `unknown` fact's note), and otherwise a flow map.
 */
export function factOut(fact: FactToWrite, key: KeySchema): Out {
  const attributes = Object.entries(fact.attributes ?? {})
  const identifying = key.relation?.identifiedBy ?? []
  attributes.sort(([a], [b]) => {
    const ia = identifying.indexOf(a)
    const ib = identifying.indexOf(b)
    if (ia >= 0 || ib >= 0)
      return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib)
    return a < b ? -1 : a > b ? 1 : 0
  })
  const unknown = fact.state === "unknown"
  const short =
    attributes.length === 0 &&
    fact.via === undefined &&
    fact.task === undefined &&
    !fact.remove &&
    fact.accepted === undefined &&
    (unknown ? fact.to === undefined : fact.note === undefined)
  if (short) {
    const value = unknown ? fact.note : (fact.to ?? fact.value)
    if (value === undefined) throw new RangeError("A fact needs a value")
    return scalar(value)
  }
  const entries: [string, Out][] = []
  if (fact.to !== undefined) entries.push(["to", scalar(fact.to)])
  for (const [name, value] of attributes) entries.push([name, scalar(value)])
  if (fact.value !== undefined && !unknown)
    entries.push(["value", scalar(fact.value)])
  if (fact.via !== undefined) entries.push(["via", scalar(fact.via)])
  if (fact.note !== undefined) entries.push(["note", scalar(fact.note)])
  if (fact.task !== undefined) entries.push(["task", scalar(fact.task)])
  if (fact.remove) entries.push(["remove", scalar(true)])
  if (fact.accepted !== undefined)
    entries.push(["accepted", scalar(fact.accepted)])
  return flowMap(entries)
}

/** The order Shinan writes each kind of document's fields in. */
const fieldOrder: Record<CatalogDocument["kind"], readonly string[]> = {
  entity: [
    "id",
    "type",
    "title",
    "summary",
    "status",
    "owner",
    "replaced_by",
    "aliases",
    "imported_from",
    "decision_state",
    "decided_on",
    "decided_by",
    "facts",
  ],
  schema: [
    "id",
    "title",
    "summary",
    "status",
    "owner",
    "imported_from",
    "keys",
    "required",
    "sections",
  ],
  "start-here": [
    "id",
    "title",
    "summary",
    "owner",
    "imported_from",
    "people",
    "agents",
  ],
}

/** Adds a top-level field after the fields that come before it in Shinan's order. */
export function insertField(
  document: CatalogDocument,
  name: string,
  value: Out,
): Edit {
  const order = fieldOrder[document.kind]
  const rank = order.indexOf(name)
  const top = topMap(document)
  let position = 0
  top.entries.forEach((e, i) => {
    const r = order.indexOf(e.key)
    if (r >= 0 && r < rank) position = i + 1
  })
  return insertMapEntry(
    document.text,
    top,
    name,
    value,
    lineBreak(document.text),
    position,
  )
}

/** Sets a top-level field: replaces its value, or adds it. */
export function setFieldEdit(
  document: CatalogDocument,
  name: string,
  value: Out,
): Edit {
  const entry = document.fields.get(name)
  if (!entry) return insertField(document, name, value)
  const top = topMap(document)
  return replaceEntryValue(
    document.text,
    entry,
    value,
    top.flow,
    lineBreak(document.text),
  )
}

/** Removes a top-level field. */
export function removeFieldEdit(document: CatalogDocument, name: string): Edit {
  const top = topMap(document)
  return removeMapEntry(
    document.text,
    top,
    top.entries.findIndex((e) => e.key === name),
  )
}

/** A type schema key's options, in canonical style: `{ relation: [service], many: true }`. */
export function keyOptionsOut(options: KeyOptions): Out {
  const entries: [string, Out][] = []
  if (options.relation)
    entries.push(["relation", flowList(options.relation.map(scalar))])
  if (options.identifiedBy)
    entries.push(["identified_by", flowList(options.identifiedBy.map(scalar))])
  if (options.many !== undefined) entries.push(["many", scalar(options.many)])
  if (options.inverse !== undefined)
    entries.push(["inverse", scalar(options.inverse)])
  if (options.recheck !== undefined)
    entries.push(["recheck", scalar(options.recheck)])
  return flowMap(entries)
}

/** A start-here step, in canonical style: its target, then its note. */
export function stepOut(step: StartHereStepInput): Out {
  const [target, value] =
    "to" in step
      ? ["to", step.to]
      : "list" in step
        ? ["list", step.list]
        : ["url", step.url]
  return blockMap([
    [target, scalar(value)],
    ["note", scalar(step.note)],
  ])
}

/** A fact's value as text, as expectations name it (catalog §8.5). */
export function writtenValueText(fact: {
  state: FactState
  value?: WrittenFact["value"]
  to?: string | undefined
  note?: string | undefined
}): string {
  if (fact.state === "unknown") return fact.note ?? ""
  if (fact.to !== undefined) return fact.to
  return fact.value === undefined ? "" : canonicalValue(fact.value)
}
