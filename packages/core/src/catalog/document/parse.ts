import { BodyTooComplexError, parseBody } from "./body.js"
import type { Body } from "./body.js"
import { parseCatalogTime } from "./dates.js"
import type { CatalogTime } from "./dates.js"
import {
  attributeNameProblem,
  factOptions,
  isEntityId,
  isFactKey,
  parseEntityId,
  schemaIdPrefix,
  schemaType,
  startHereId,
} from "./ids.js"
import {
  checkFields,
  decisionStates,
  entityStatuses,
  factStates,
  workspaceLists,
} from "./model.js"
import type {
  CatalogDocument,
  CheckField,
  DecisionFields,
  EntityDocument,
  FactCheck,
  FactGroup,
  FactState,
  SchemaDocument,
  SchemaKeyDefinition,
  StartHereDocument,
  StartHereStep,
  WrittenFact,
} from "./model.js"
import { blocking } from "./problems.js"
import type { Problem, ProblemCode } from "./problems.js"
import { utf8Length } from "./source.js"
import type { Range } from "./source.js"
import { parseYaml } from "./yaml.js"
import type { ScalarValue, YamlEntry, YamlMap, YamlNode } from "./yaml.js"

/**
 * The version of the document model's reading rules. Anything derived from
 * parsed documents (the agent index) records it and is rebuilt when it
 * changes (architecture §5.2, M2-3). 5: no `waiting-for-approval` list,
 * since there is no catalog approval (D-060).
 */
export const parserVersion = 5

/**
 * The largest document Shinan reads: 64 KiB of UTF-8, the form documents are
 * stored and sent in. Checked before anything else, so hostile input cannot
 * make reading slow (catalog §2.1).
 */
export const maxDocumentBytes = 64 * 1024

/**
 * Reads one catalog document. Never throws: anything that keeps the document
 * from being read as catalog §2 describes is in `problems`, and every part
 * that could be read is still there, with its place in `text`.
 */
export function parseCatalogDocument(text: string): CatalogDocument {
  const bytes = utf8Length(text)
  if (bytes > maxDocumentBytes)
    return unread(
      text,
      "too-large",
      `The document is ${bytes} bytes long; a catalog document holds at most ${maxDocumentBytes} bytes (64 KiB)`,
    )
  try {
    return read(text)
  } catch (error) {
    // A backstop: nothing below should throw, but a dependency might. Its
    // own code, so tests can tell a bug from a refusal.
    return unread(
      text,
      "read-failed",
      `The document could not be read: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * The ID `parseCatalogDocument` would read from a document, found by
 * reading only its frontmatter, the way `read` does: for telling type
 * schema documents apart before reading every document in full (an index
 * rebuild). Null when the text has no readable ID.
 */
export function readDocumentId(text: string): string | null {
  if (utf8Length(text) > maxDocumentBytes) return null
  try {
    const split = splitFrontmatter(text)
    if (!split.frontmatter) return null
    const yaml = parseYaml(
      text.slice(split.frontmatter.start, split.frontmatter.end),
      split.frontmatter.start,
    )
    if (yaml.node?.kind !== "map") return null
    let id: YamlEntry | undefined
    for (const e of yaml.node.entries) if (e.key === "id") id = e
    const value = id?.value
    return value?.kind === "scalar" &&
      typeof value.value === "string" &&
      value.value.trim() !== ""
      ? value.value
      : null
  } catch {
    return null
  }
}

/**
 * A document that could not be read at all: only its text and the problem.
 * Also for a document Shinan was not given the text of, such as a file on
 * `main` larger than the Git container reads (the index).
 */
export function unread(
  text: string,
  code: ProblemCode,
  message: string,
): EntityDocument {
  return {
    kind: "entity",
    text,
    frontmatter: null,
    body: {
      range: { start: text.length, end: text.length },
      text: "",
      sections: [],
      links: [],
    },
    id: null,
    title: null,
    summary: null,
    owner: null,
    importedFrom: null,
    fields: new Map(),
    problems: [blocking(code, message, null)],
    type: null,
    status: null,
    replacedBy: null,
    aliases: [],
    decision: null,
    groups: [],
    facts: [],
  }
}

function read(text: string): CatalogDocument {
  const split = splitFrontmatter(text)
  const reader = new Reader()
  let body: Body
  try {
    body = parseBody(text.slice(split.bodyStart), split.bodyStart)
  } catch (error) {
    if (error instanceof BodyTooComplexError)
      reader.problem("body-invalid", error.message)
    else
      reader.problem(
        "read-failed",
        `The body could not be read: ${error instanceof Error ? error.message : String(error)}`,
      )
    body = {
      range: { start: split.bodyStart, end: text.length },
      text: text.slice(split.bodyStart),
      sections: [],
      links: [],
    }
  }

  let map: YamlMap | null = null
  if (!split.frontmatter) {
    reader.problem(
      "frontmatter-invalid",
      "A catalog document starts with frontmatter between two --- lines",
      { start: 0, end: Math.min(text.length, 3) },
    )
  } else {
    const yaml = parseYaml(
      text.slice(split.frontmatter.start, split.frontmatter.end),
      split.frontmatter.start,
    )
    for (const p of yaml.problems)
      reader.problem("frontmatter-invalid", p.message, p.range)
    if (yaml.node && yaml.node.kind !== "map") {
      reader.problem(
        "frontmatter-invalid",
        "The frontmatter must be a map of fields",
        yaml.node.range,
      )
    } else if (yaml.node) {
      map = yaml.node
    } else if (yaml.problems.length === 0) {
      map = { kind: "map", entries: [], flow: false, range: split.frontmatter }
    }
  }

  const fields = new Map<string, YamlEntry>()
  for (const e of map?.entries ?? []) fields.set(e.key, e)
  const id = reader.string(fields, "id", map !== null)
  reader.documentId = id
  // Problems found before the ID was read belong to this document too.
  for (const p of reader.problems) p.documentId ??= id

  const common = {
    text,
    frontmatter: split.frontmatter,
    body,
    id,
    fields,
    problems: reader.problems,
  }

  if (id !== null && id.startsWith(schemaIdPrefix))
    return readSchema(reader, fields, common)
  if (id === startHereId) return readStartHere(reader, fields, common)
  return readEntity(reader, fields, common, map !== null)
}

export interface Split {
  frontmatter: Range | null
  bodyStart: number
}

/** Finds the frontmatter between a first line `---` and the next line `---`. */
export function splitFrontmatter(text: string): Split {
  const open = /^---\r?\n/.exec(text)
  if (!open) return { frontmatter: null, bodyStart: 0 }
  const start = open[0].length
  let lineStart = start
  while (lineStart <= text.length) {
    const newline = text.indexOf("\n", lineStart)
    const lineEnd = newline < 0 ? text.length : newline
    const line = text.slice(lineStart, lineEnd).replace(/\r$/, "")
    if (line === "---") {
      return {
        frontmatter: { start, end: lineStart },
        bodyStart: newline < 0 ? text.length : newline + 1,
      }
    }
    if (newline < 0) break
    lineStart = newline + 1
  }
  return { frontmatter: null, bodyStart: 0 }
}

type Common = Pick<
  EntityDocument,
  "text" | "frontmatter" | "body" | "id" | "fields" | "problems"
>

const entityFields = new Set([
  "id",
  "type",
  "title",
  "summary",
  "status",
  "owner",
  "replaced_by",
  "aliases",
  "imported_from",
  "facts",
  "decision_state",
  "decided_on",
  "decided_by",
])

const decisionOnlyFields = ["decision_state", "decided_on", "decided_by"]

function readEntity(
  reader: Reader,
  fields: Map<string, YamlEntry>,
  common: Common,
  readable: boolean,
): EntityDocument {
  reader.onlyFields(fields, entityFields, "an entity")
  const type = reader.string(fields, "type", readable)
  if (type !== null && common.id !== null) {
    const parsed = parseEntityId(common.id)
    if (!parsed || parsed.type === "schema")
      reader.problem(
        "field-invalid",
        `The ID "${common.id}" is not of the form <type>/<slug>, in lowercase kebab-case`,
        fields.get("id")?.value.range,
      )
    else if (parsed.type !== type)
      reader.problem(
        "field-invalid",
        `The ID "${common.id}" must start with its type, "${type}/"`,
        fields.get("id")?.value.range,
      )
  }
  const title = reader.string(fields, "title", readable)
  const summary = reader.string(fields, "summary", readable)
  const status = reader.choice(fields, "status", entityStatuses, readable)
  const owner = reader.reference(fields, "owner", readable, true)
  const replacedBy = reader.reference(fields, "replaced_by", false, false)
  const aliases = reader.aliases(fields)
  const importedFrom = reader.string(fields, "imported_from", false)

  let decision: DecisionFields | null = null
  if (type === "decision") {
    decision = {
      state: reader.choice(fields, "decision_state", decisionStates, true),
      decidedOn: reader.date(fields, "decided_on"),
      decidedBy: reader.reference(fields, "decided_by", false, true),
    }
  } else {
    for (const name of decisionOnlyFields) {
      const e = fields.get(name)
      if (e)
        reader.problem(
          "field-invalid",
          `"${name}" is a field of decision entities only`,
          e.range,
        )
    }
  }

  const { groups, facts } = readFacts(reader, fields.get("facts"))
  return {
    ...common,
    kind: "entity",
    type,
    title,
    summary,
    status,
    owner,
    replacedBy,
    aliases,
    importedFrom,
    decision,
    groups,
    facts,
  }
}

const groupFields: ReadonlySet<string> = new Set([
  ...checkFields,
  ...factStates,
])

function readFacts(
  reader: Reader,
  entry: YamlEntry | undefined,
): { groups: FactGroup[]; facts: WrittenFact[] } {
  const groups: FactGroup[] = []
  const facts: WrittenFact[] = []
  if (!entry) return { groups, facts }
  if (entry.value.kind !== "list") {
    if (!(entry.value.kind === "scalar" && entry.value.value === null))
      reader.problem(
        "facts-invalid",
        "`facts` is a list of groups, each a fact check with its facts or facts with no check",
        entry.value.range,
      )
    return { groups, facts }
  }
  entry.value.items.forEach((node, index) => {
    if (node.kind !== "map") {
      reader.problem(
        "facts-invalid",
        "Each item of `facts` is a map: a fact check and its facts, or facts by state",
        node.range,
      )
      return
    }
    for (const e of node.entries) {
      if (!groupFields.has(e.key))
        reader.problem(
          "facts-invalid",
          `"${e.key}" is not part of a fact group; a group has ${[...checkFields].join(", ")} and the states ${factStates.join(", ")}`,
          e.keyRange,
        )
    }
    const check = readCheck(reader, node)
    const states: FactGroup["states"] = []
    for (const e of node.entries) {
      const state = factStates.find((s) => s === e.key)
      if (!state) continue
      states.push({ state, entry: e })
      if (state === "planned" && check)
        reader.problem(
          "facts-invalid",
          "`planned` facts have no fact check; put them in a group of their own",
          e.keyRange,
        )
      if (e.value.kind !== "map" || e.value.entries.length === 0) {
        reader.problem(
          "facts-invalid",
          `\`${state}\` holds a map of fact keys to values`,
          e.value.kind === "scalar" ? e.range : e.value.range,
        )
        continue
      }
      for (const f of e.value.entries)
        facts.push(...readFact(reader, f, state, index))
    }
    if (states.length === 0)
      reader.problem(
        "facts-invalid",
        "A fact group holds at least one of intended, observed, planned or unknown",
        node.range,
      )
    groups.push({ index, range: node.range, check, states })
  })
  return { groups, facts }
}

function readCheck(reader: Reader, group: YamlMap): FactCheck | null {
  const entries: Partial<Record<CheckField, YamlEntry>> = {}
  for (const e of group.entries) {
    const field = checkFields.find((f) => f === e.key)
    if (field) entries[field] = e
  }
  if (Object.keys(entries).length === 0) return null

  let checked: CatalogTime | null | undefined
  const c = entries.checked
  if (c) {
    if (c.value.kind === "scalar" && c.value.value === null) checked = null
    else checked = reader.time(c, "checked")
  }
  const text = (field: CheckField): string | undefined => {
    const e = entries[field]
    if (!e) return undefined
    if (
      e.value.kind === "scalar" &&
      typeof e.value.value === "string" &&
      e.value.value.trim() !== ""
    )
      return e.value.value
    reader.problem(
      "facts-invalid",
      `The fact check's \`${field}\` is one line of text`,
      e.value.range,
    )
    return undefined
  }
  return {
    checked,
    by: text("by"),
    scope: text("scope"),
    source: text("source"),
    limits: text("limits"),
    entries,
  }
}

function readFact(
  reader: Reader,
  entry: YamlEntry,
  state: FactState,
  group: number,
): WrittenFact[] {
  if (!isFactKey(entry.key)) {
    reader.problem(
      "fact-invalid",
      `"${entry.key}" is not a fact key: lowercase words joined by ".", "-" or "_", and not a name such as "constructor"`,
      entry.keyRange,
    )
    return []
  }
  const one = (
    node: YamlNode,
    item: number | null,
    range: Range,
  ): WrittenFact | null => {
    const base = {
      key: entry.key,
      state,
      group,
      item,
      range,
      keyRange: entry.keyRange,
      valueRange: node.range,
    }
    if (node.kind === "scalar") {
      if (node.value === null || node.value === "") {
        reader.problem(
          "fact-invalid",
          state === "unknown"
            ? `The unknown fact "${entry.key}" needs a short note saying why it is unknown`
            : `The fact "${entry.key}" has no value; record it as unknown instead`,
          range,
        )
        return null
      }
      if (state === "unknown" && typeof node.value !== "string") {
        reader.problem(
          "fact-invalid",
          `The unknown fact "${entry.key}" needs a short note saying why it is unknown`,
          node.range,
        )
        return null
      }
      return {
        ...base,
        form: "short",
        value: state === "unknown" ? undefined : node.value,
        to: undefined,
        via: undefined,
        note: state === "unknown" ? (node.value as string) : undefined,
        task: undefined,
        remove: false,
        accepted: undefined,
        attributes: Object.create(null) as Record<string, ScalarValue>,
      }
    }
    if (node.kind === "list") {
      reader.problem(
        "fact-invalid",
        `A value of "${entry.key}" cannot itself be a list`,
        node.range,
      )
      return null
    }
    return readLongForm(reader, node, base, state)
  }

  const node = entry.value
  if (node.kind === "list") {
    if (node.items.length === 0) {
      reader.problem(
        "fact-invalid",
        `"${entry.key}" holds an empty list`,
        node.range,
      )
      return []
    }
    return node.items.flatMap((item, i) => one(item, i, item.range) ?? [])
  }
  const fact = one(node, null, entry.range)
  return fact ? [fact] : []
}

function readLongForm(
  reader: Reader,
  node: YamlMap,
  base: Pick<
    WrittenFact,
    "key" | "state" | "group" | "item" | "range" | "keyRange" | "valueRange"
  >,
  state: FactState,
): WrittenFact | null {
  let ok = true
  const fail = (message: string, range: Range) => {
    reader.problem("fact-invalid", message, range)
    ok = false
  }
  const options = new Map(node.entries.map((e) => [e.key, e]))
  // No prototype, so an attribute named like an Object member is just data.
  const attributes = Object.create(null) as Record<string, ScalarValue>
  for (const e of node.entries) {
    if (factOptions.has(e.key)) continue
    const problem = attributeNameProblem(e.key)
    if (problem !== null) fail(problem, e.keyRange)
    else if (e.value.kind !== "scalar" || e.value.value === null)
      fail(
        `The attribute "${e.key}" of "${base.key}" must be one value`,
        e.range,
      )
    else attributes[e.key] = e.value.value
  }
  const text = (name: string): string | undefined => {
    const e = options.get(name)
    if (!e) return undefined
    if (
      e.value.kind === "scalar" &&
      typeof e.value.value === "string" &&
      e.value.value !== ""
    )
      return e.value.value
    fail(`\`${name}\` of "${base.key}" is text`, e.value.range)
    return undefined
  }
  let value: ScalarValue | undefined
  const v = options.get("value")
  if (v) {
    if (
      v.value.kind !== "scalar" ||
      v.value.value === null ||
      v.value.value === ""
    )
      fail(`\`value\` of "${base.key}" is one value`, v.value.range)
    else value = v.value.value
  }
  let remove = false
  const r = options.get("remove")
  if (r) {
    if (r.value.kind !== "scalar" || typeof r.value.value !== "boolean")
      fail(`\`remove\` of "${base.key}" is true or false`, r.value.range)
    else remove = r.value.value
    if (remove && state !== "planned")
      fail("Only a planned fact can plan a removal (`remove: true`)", r.range)
  }
  const fact: WrittenFact = {
    ...base,
    form: "long",
    value,
    to: text("to"),
    via: text("via"),
    note: text("note"),
    task: text("task"),
    remove,
    accepted: text("accepted"),
    attributes,
  }
  if (state === "unknown") {
    if (v)
      fail(
        `An unknown fact has no value; its \`note\` says why "${base.key}" is unknown`,
        v.range,
      )
    if (fact.note === undefined)
      fail(
        `The unknown fact "${base.key}" needs a \`note\` saying why it is unknown`,
        node.range,
      )
  } else if (fact.value === undefined && fact.to === undefined && !v) {
    fail(
      `The fact "${base.key}" needs a \`value\` (or \`to\`, for a relation)`,
      node.range,
    )
  }
  return ok ? fact : null
}

const schemaFields = new Set([
  "id",
  "title",
  "summary",
  "status",
  "owner",
  "imported_from",
  "keys",
  "required",
  "sections",
])

const keyOptions = new Set([
  "many",
  "relation",
  "identified_by",
  "inverse",
  "recheck",
])

/** A recheck interval: a whole number of days, such as `30d`. */
export const recheckPattern = /^([1-9][0-9]{0,3})d$/

function readSchema(
  reader: Reader,
  fields: Map<string, YamlEntry>,
  common: Common,
): SchemaDocument {
  reader.onlyFields(fields, schemaFields, "a type schema document")
  const describes = schemaType(common.id ?? "")
  if (describes === null)
    reader.problem(
      "schema-invalid",
      `A type schema document's ID is schema/<type>, with the type in lowercase kebab-case`,
      fields.get("id")?.value.range,
    )
  const title = reader.string(fields, "title", true)
  const summary = reader.string(fields, "summary", true)
  const status = reader.choice(fields, "status", entityStatuses, true)
  const owner = reader.reference(fields, "owner", true, true)
  const importedFrom = reader.string(fields, "imported_from", false)

  const keys: SchemaKeyDefinition[] = []
  const keysEntry = fields.get("keys")
  if (keysEntry) {
    const node = keysEntry.value
    if (node.kind === "map") {
      for (const k of node.entries) {
        const definition = readKeyDefinition(reader, k)
        if (definition) keys.push(definition)
      }
    } else if (!(node.kind === "scalar" && node.value === null)) {
      reader.problem(
        "schema-invalid",
        "`keys` is a map from each key to its options",
        node.range,
      )
    }
  }
  return {
    ...common,
    kind: "schema",
    describes,
    title,
    summary,
    owner,
    importedFrom,
    status,
    keys,
    required: reader.strings(fields, "required", "schema-invalid"),
    sections: reader.strings(fields, "sections", "schema-invalid"),
  }
}

function readKeyDefinition(
  reader: Reader,
  entry: YamlEntry,
): SchemaKeyDefinition | null {
  if (!isFactKey(entry.key)) {
    reader.problem(
      "schema-invalid",
      `"${entry.key}" is not a fact key: lowercase words joined by ".", "-" or "_", and not a name such as "constructor"`,
      entry.keyRange,
    )
    return null
  }
  const definition: SchemaKeyDefinition = {
    key: entry.key,
    many: undefined,
    relation: undefined,
    identifiedBy: undefined,
    inverse: undefined,
    recheck: undefined,
    range: entry.range,
  }
  const node = entry.value
  if (node.kind === "scalar" && node.value === null) return definition
  if (node.kind !== "map") {
    reader.problem(
      "schema-invalid",
      `The options of "${entry.key}" are a map, such as { many: true, recheck: 90d }`,
      node.range,
    )
    return null
  }
  const options = new Map(node.entries.map((e) => [e.key, e]))
  for (const e of node.entries) {
    if (!keyOptions.has(e.key))
      reader.problem(
        "schema-invalid",
        `"${e.key}" is not a key option; the options are ${[...keyOptions].join(", ")}`,
        e.keyRange,
      )
  }
  const many = options.get("many")
  if (many) {
    if (many.value.kind === "scalar" && typeof many.value.value === "boolean")
      definition.many = many.value.value
    else
      reader.problem(
        "schema-invalid",
        "`many` is true or false",
        many.value.range,
      )
  }
  const list = (name: string): string[] | undefined => {
    const e = options.get(name)
    if (!e) return undefined
    const items = e.value.kind === "list" ? e.value.items : [e.value]
    const values = items.flatMap((i) =>
      i.kind === "scalar" && typeof i.value === "string" ? [i.value] : [],
    )
    if (values.length !== items.length || values.length === 0) {
      reader.problem(
        "schema-invalid",
        `\`${name}\` is a list of names`,
        e.value.range,
      )
      return undefined
    }
    return values
  }
  definition.relation = list("relation")
  definition.identifiedBy = list("identified_by")
  const inverse = options.get("inverse")
  if (inverse) {
    if (
      inverse.value.kind === "scalar" &&
      typeof inverse.value.value === "string" &&
      inverse.value.value.trim() !== ""
    )
      definition.inverse = inverse.value.value
    else
      reader.problem(
        "schema-invalid",
        "`inverse` is a name",
        inverse.value.range,
      )
  }
  const recheck = options.get("recheck")
  if (recheck) {
    if (
      recheck.value.kind === "scalar" &&
      typeof recheck.value.value === "string" &&
      recheckPattern.test(recheck.value.value)
    )
      definition.recheck = recheck.value.value
    else
      reader.problem(
        "schema-invalid",
        "`recheck` is a number of days, such as 30d",
        recheck.value.range,
      )
  }
  if (definition.identifiedBy && !definition.relation)
    reader.problem(
      "schema-invalid",
      "`identified_by` applies only to relations",
      options.get("identified_by")?.range,
    )
  if (definition.inverse && !definition.relation)
    reader.problem(
      "schema-invalid",
      "`inverse` applies only to relations",
      options.get("inverse")?.range,
    )
  return definition
}

const startHereFields = new Set([
  "id",
  "title",
  "summary",
  "owner",
  "imported_from",
  "people",
  "agents",
])

function readStartHere(
  reader: Reader,
  fields: Map<string, YamlEntry>,
  common: Common,
): StartHereDocument {
  reader.onlyFields(fields, startHereFields, "the start-here document")
  return {
    ...common,
    kind: "start-here",
    title: reader.string(fields, "title", true),
    summary: reader.string(fields, "summary", false),
    owner: reader.reference(fields, "owner", false, true),
    importedFrom: reader.string(fields, "imported_from", false),
    people: readPath(reader, fields, "people"),
    agents: readPath(reader, fields, "agents"),
  }
}

function readPath(
  reader: Reader,
  fields: Map<string, YamlEntry>,
  name: "people" | "agents",
): StartHereStep[] {
  const entry = fields.get(name)
  if (!entry) {
    reader.problem(
      "field-missing",
      `The start-here document needs \`${name}\`, its path for ${name}`,
    )
    return []
  }
  const node = entry.value
  if (node.kind === "scalar" && node.value === null) return []
  if (node.kind !== "list") {
    reader.problem(
      "start-here-invalid",
      `\`${name}\` is an ordered list of steps`,
      node.range,
    )
    return []
  }
  const steps: StartHereStep[] = []
  for (const item of node.items) {
    const step = readStep(reader, item)
    if (step) steps.push(step)
  }
  return steps
}

const stepTargets = ["to", "list", "url"] as const

function readStep(reader: Reader, node: YamlNode): StartHereStep | null {
  const shape =
    "A step is a map with one of `to` (an entity), `list` (a workspace list) or `url`, and a `note`"
  if (node.kind !== "map") {
    reader.problem("start-here-invalid", shape, node.range)
    return null
  }
  const fields = new Map(node.entries.map((e) => [e.key, e]))
  for (const e of node.entries) {
    if (e.key !== "note" && !stepTargets.some((t) => t === e.key))
      reader.problem("start-here-invalid", shape, e.keyRange)
  }
  const targets = stepTargets.filter((t) => fields.has(t))
  const noteEntry = fields.get("note")
  const note =
    noteEntry?.value.kind === "scalar" &&
    typeof noteEntry.value.value === "string" &&
    noteEntry.value.value.trim() !== ""
      ? noteEntry.value.value
      : null
  if (targets.length !== 1 || note === null) {
    reader.problem("start-here-invalid", shape, node.range)
    return null
  }
  const kind = targets[0] as (typeof stepTargets)[number]
  const valueNode = fields.get(kind)?.value
  const value =
    valueNode?.kind === "scalar" && typeof valueNode.value === "string"
      ? valueNode.value
      : null
  if (value === null) {
    reader.problem("start-here-invalid", shape, valueNode?.range ?? node.range)
    return null
  }
  if (kind === "to") {
    if (!isEntityId(value)) {
      reader.problem(
        "start-here-invalid",
        `"${value}" is not an entity ID`,
        valueNode?.range,
      )
      return null
    }
    return { target: { kind: "entity", id: value }, note, range: node.range }
  }
  if (kind === "list") {
    const list = workspaceLists.find((l) => l === value)
    if (!list) {
      reader.problem(
        "start-here-invalid",
        `"${value}" is not a workspace list; the lists are ${workspaceLists.join(", ")}`,
        valueNode?.range,
      )
      return null
    }
    return {
      target: { kind: "list", list },
      note,
      range: node.range,
    }
  }
  if (!/^https?:\/\/\S+$/.test(value)) {
    reader.problem(
      "start-here-invalid",
      "A step's `url` is an http or https address",
      valueNode?.range,
    )
    return null
  }
  return { target: { kind: "url", url: value }, note, range: node.range }
}

/** Reads typed fields and collects problems. */
class Reader {
  readonly problems: Problem[] = []
  documentId: string | null = null

  problem(code: ProblemCode, message: string, range?: Range) {
    this.problems.push(blocking(code, message, this.documentId, range))
  }

  onlyFields(
    fields: Map<string, YamlEntry>,
    allowed: Set<string>,
    what: string,
  ) {
    for (const [name, e] of fields) {
      if (!allowed.has(name))
        this.problem(
          "field-invalid",
          `"${name}" is not a field of ${what}`,
          e.keyRange,
        )
    }
  }

  string(
    fields: Map<string, YamlEntry>,
    name: string,
    required: boolean,
  ): string | null {
    const e = fields.get(name)
    if (!e || (e.value.kind === "scalar" && e.value.value === null)) {
      if (required)
        this.problem("field-missing", `\`${name}\` is required`, e?.range)
      return null
    }
    if (
      e.value.kind !== "scalar" ||
      typeof e.value.value !== "string" ||
      e.value.value.trim() === ""
    ) {
      this.problem("field-invalid", `\`${name}\` is text`, e.value.range)
      return null
    }
    return e.value.value
  }

  choice<T extends string>(
    fields: Map<string, YamlEntry>,
    name: string,
    choices: readonly T[],
    required: boolean,
  ): T | null {
    const value = this.string(fields, name, required)
    if (value === null) return null
    const found = choices.find((c) => c === value)
    if (!found)
      this.problem(
        "field-invalid",
        `\`${name}\` is one of ${choices.join(", ")}`,
        fields.get(name)?.value.range,
      )
    return found ?? null
  }

  /** An entity ID, or `unknown` where allowed. */
  reference(
    fields: Map<string, YamlEntry>,
    name: string,
    required: boolean,
    unknownAllowed: boolean,
  ): string | null {
    const value = this.string(fields, name, required)
    if (value === null) return null
    if ((unknownAllowed && value === "unknown") || isEntityId(value))
      return value
    this.problem(
      "field-invalid",
      `\`${name}\` is an entity ID such as person/guneet${unknownAllowed ? ", or unknown" : ""}`,
      fields.get(name)?.value.range,
    )
    return null
  }

  aliases(fields: Map<string, YamlEntry>): string[] {
    return this.strings(fields, "aliases", "field-invalid").filter((a) => {
      if (/^[a-z0-9][a-z0-9/_.-]*$/.test(a)) return true
      this.problem(
        "field-invalid",
        `The alias "${a}" is not an ID: lowercase letters, digits, "-", "_", "." and "/"`,
        fields.get("aliases")?.value.range,
      )
      return false
    })
  }

  strings(
    fields: Map<string, YamlEntry>,
    name: string,
    code: ProblemCode,
  ): string[] {
    const e = fields.get(name)
    if (!e || (e.value.kind === "scalar" && e.value.value === null)) return []
    const items = e.value.kind === "list" ? e.value.items : null
    const values = (items ?? []).flatMap((i) =>
      i.kind === "scalar" && typeof i.value === "string" && i.value !== ""
        ? [i.value]
        : [],
    )
    if (!items || values.length !== items.length) {
      this.problem(code, `\`${name}\` is a list of text`, e.value.range)
      return values
    }
    return values
  }

  date(fields: Map<string, YamlEntry>, name: string): CatalogTime | null {
    const e = fields.get(name)
    if (!e || (e.value.kind === "scalar" && e.value.value === null)) return null
    return this.time(e, name) ?? null
  }

  time(e: YamlEntry, name: string): CatalogTime | undefined {
    const parsed =
      e.value.kind === "scalar" && typeof e.value.value === "string"
        ? parseCatalogTime(e.value.value)
        : null
    if (parsed) return parsed
    this.problem(
      "date-invalid",
      `\`${name}\` is a date (2026-11-14) or a date and time with a UTC offset (2026-11-14T09:30Z)`,
      e.value.range,
    )
    return undefined
  }
}
