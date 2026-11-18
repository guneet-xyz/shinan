import fc from "fast-check"
import { describe, expect, it } from "vitest"

import {
  dockyard,
  domainSchema,
  guneetDev,
  musashi,
  noReadFailure,
} from "../../../test/catalog-documents.js"
import { comparableValue, discrepancies } from "./analysis.js"
import { applyOperations, expectationOf } from "./apply.js"
import { readCatalog } from "./catalog.js"
import type { Catalog } from "./catalog.js"
import type { Fact, ResolvedEntity } from "./entity.js"
import { factIdentityKey } from "./identity.js"
import type { CatalogDocument, EntityDocument, FactState } from "./model.js"
import type { CatalogOperation, CheckInput, FactInput } from "./operations.js"
import { builtInSchemas, keySchema } from "./schemas.js"
import { validateCatalog, validateChange } from "./validate.js"

/**
 * Property tests (architecture §5.2, rule 5): random sequences of
 * operations on random valid documents, written in many YAML styles, each
 * give a document that reads without problems, holds what the operation
 * wrote, and differs from the one before only where the operation points.
 */

const by = "guneet via opencode-daedalus"
const service = builtInSchemas.get("service") ?? null

type Scalar = string | number | boolean

interface GeneratedFact {
  key: string
  state: FactState
  value?: Scalar
  to?: string
  item?: string
  via?: string
  note?: string
  task?: string
  accepted?: string
  long: boolean
  /** A long form written as a block map over several lines. */
  block: boolean
}

interface GeneratedGroup {
  check: {
    checked: string
    by: string
    scope: string
    source: string
    limits?: string
  } | null
  /** Facts by state; each inner list is one key's facts. */
  states: { state: FactState; facts: GeneratedFact[][] }[]
  statesFirst: boolean
}

interface Style {
  indent: 2 | 4
  /** `facts:` followed by `- ` at column 0. */
  zeroIndent: boolean
  crlf: boolean
  comments: boolean
  flowLists: boolean
  quote: "double" | "single"
  /** Some text values written as block scalars (`|`, `>-`), some followed by a comment at column 0. */
  blockScalars: boolean
}

interface GeneratedEntity {
  slug: string
  title: string
  summary: string
  status: "active" | "deprecated" | "retired"
  aliases: string[]
  groups: GeneratedGroup[]
  sections: { level: number; heading: string; text: string }[]
  style: Style
}

const word = fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/)
const slug = fc
  .array(word, { minLength: 1, maxLength: 2 })
  .map((w) => w.join("-"))
const text = fc
  .string({
    unit: fc.constantFrom(
      ..."abcXYZ 019:#-'\"{}[],&*!|>%@`?/.é🙂\n".split(/(?:)/u),
    ),
    minLength: 1,
    maxLength: 24,
  })
  .filter((s) => s.trim() !== "")
const value: fc.Arbitrary<Scalar> = fc.oneof(
  text,
  fc.integer({ min: -100_000, max: 100_000 }),
  fc.boolean(),
  fc.constantFrom(
    "no",
    "on",
    "null",
    "true",
    "2026-11-14",
    "1.10",
    "~",
    "-5",
    "a, b",
  ),
)
const date = fc
  .date({
    min: new Date("2020-01-01T00:00:00Z"),
    max: new Date("2026-11-01T00:00:00Z"),
    noInvalidDate: true,
  })
  .chain((d) =>
    fc.constantFrom(
      d.toISOString().slice(0, 10),
      `${d.toISOString().slice(0, 16)}Z`,
    ),
  )
const checkArb = fc.record({
  checked: date,
  scope: text,
  source: text,
  limits: fc.option(text, { nil: undefined }),
})

const singleKeys = [
  "environment",
  "deployment.version",
  "provided-by",
  "ups.model",
]
const machines = ["machine/musashi", "machine/daedalus"]
const services = ["service/postgres", "service/vault", "service/ingress"]
const endpoints = [
  "https://a.example",
  "https://b.example",
  "https://c.example",
]

/** One key's facts in one state, valid for the `service` schema. */
function factsFor(state: FactState): fc.Arbitrary<GeneratedFact[]> {
  const shape = { long: fc.boolean(), block: fc.boolean() }
  if (state === "unknown")
    return fc
      .record({
        key: fc.constantFrom(...singleKeys, "endpoint", "runs-on"),
        note: text,
        to: fc.option(fc.constantFrom(...machines), { nil: undefined }),
        ...shape,
      })
      .map(({ to, ...f }) => {
        const relation = f.key === "runs-on" && to !== undefined
        return [{ ...f, state, ...(relation ? { to, long: true } : {}) }]
      })
  const task =
    state === "planned"
      ? fc.constantFrom("T-1", "SHN-42")
      : fc.constant(undefined)
  const single = fc
    .record({
      key: fc.constantFrom(...singleKeys),
      value,
      via: fc.option(word, { nil: undefined }),
      note: fc.option(text, { nil: undefined }),
      task,
      ...shape,
    })
    .map((f) => [
      {
        ...f,
        state,
        long:
          f.long ||
          f.via !== undefined ||
          f.note !== undefined ||
          f.task !== undefined,
      },
    ])
  const many = <T>(
    pool: readonly T[],
    make: (t: T) => Omit<GeneratedFact, "state" | "long" | "block">,
  ) =>
    fc
      .tuple(
        fc.subarray([...pool], { minLength: 1 }),
        fc.boolean(),
        fc.boolean(),
        task,
      )
      .map(([picked, long, block, t]) =>
        picked.map((p) => ({
          ...make(p),
          state,
          long: long || t !== undefined || make(p).item !== undefined,
          block,
          ...(t !== undefined ? { task: t } : {}),
        })),
      )
  return fc.oneof(
    single,
    single,
    many(endpoints, (v) => ({ key: "endpoint", value: v })),
    many(machines, (to) => ({ key: "runs-on", to })),
    many(services, (to) => ({
      key: "secrets-in",
      to: "service/vault",
      item: `vault/${to.slice(8)}`,
    })),
  )
}

const stateMap = (state: FactState) =>
  fc
    .array(factsFor(state), { minLength: 1, maxLength: 3 })
    .map((lists) => {
      const seen = new Set<string>()
      return lists.filter((l) => {
        const key = l[0]?.key ?? ""
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    })
    .map((facts) => ({ state, facts }))

const group: fc.Arbitrary<GeneratedGroup> = fc.oneof(
  fc.record({
    check: fc.record({
      checked: date,
      by: fc.constantFrom("guneet", by),
      scope: text,
      source: text,
      limits: fc.option(text, { nil: undefined }),
    }),
    states: fc
      .subarray(["intended", "observed", "unknown"] as FactState[], {
        minLength: 1,
      })
      .chain((states) => fc.tuple(...states.map(stateMap))),
    statesFirst: fc.boolean(),
  }),
  fc.record({
    check: fc.constant(null),
    states: fc
      .subarray(["planned", "unknown"] as FactState[], { minLength: 1 })
      .chain((states) => fc.tuple(...states.map(stateMap))),
    statesFirst: fc.constant(false),
  }),
)

function identity(f: GeneratedFact): string {
  const key = keySchema(service, f.key)
  return factIdentityKey({
    key: f.key,
    state: f.state,
    many: key.many,
    relation: key.relation,
    value: f.value,
    to: f.to,
    via: f.via,
    attributes: f.item === undefined ? {} : { item: f.item },
  })
}

/** Drops facts that repeat an identity, so the document stays valid. */
function dedupe(e: GeneratedEntity): GeneratedEntity {
  const seen = new Set<string>()
  const groups = e.groups
    .map((g) => ({
      ...g,
      states: g.states
        .map(({ state, facts }) => ({
          state,
          facts: facts
            .map((list) =>
              list.filter((f) => {
                const id = identity(f)
                if (seen.has(id)) return false
                seen.add(id)
                return true
              }),
            )
            .filter((list) => list.length > 0),
        }))
        .filter((s) => s.facts.length > 0),
    }))
    .filter((g) => g.states.length > 0)
  return { ...e, groups }
}

const entity: fc.Arbitrary<GeneratedEntity> = fc
  .record({
    slug,
    title: text,
    summary: text,
    status: fc.constantFrom("active", "deprecated", "retired"),
    aliases: fc.uniqueArray(
      slug.map((s) => `service/old-${s}`),
      { maxLength: 2 },
    ),
    groups: fc.array(group, { maxLength: 4 }),
    sections: fc.array(
      fc.record({
        level: fc.integer({ min: 1, max: 3 }),
        heading: fc.stringMatching(/^[A-Z][a-z]{1,8}( [a-z]{1,8}){0,2}$/),
        text: fc.stringMatching(/^[A-Za-z ,.]{0,40}$/),
      }),
      { maxLength: 3 },
    ),
    style: fc.record({
      indent: fc.constantFrom(2 as const, 4 as const),
      zeroIndent: fc.boolean(),
      crlf: fc.boolean(),
      comments: fc.boolean(),
      flowLists: fc.boolean(),
      quote: fc.constantFrom("double" as const, "single" as const),
      blockScalars: fc.boolean(),
    }),
  })
  .map(dedupe)

/** A scalar in the generated document's own style, independent of Shinan's writer. */
function written(v: Scalar, style: Style, flow: boolean): string {
  if (typeof v !== "string") return String(v)
  const plain = flow
    ? /^[A-Za-z][A-Za-z0-9 ./_()-]*[A-Za-z0-9)]$/
    : /^[A-Za-z][A-Za-z0-9 ./_(),-]*[A-Za-z0-9)]$/
  if (
    plain.test(v) &&
    !/^(true|false|null|True|False|TRUE|FALSE|Null|NULL)$/.test(v)
  )
    return v
  if (style.quote === "single" && !/[\n\\\u0080-\uffff]/.test(v))
    return `'${v.replace(/'/g, "''")}'`
  return JSON.stringify(v)
}

function write(e: GeneratedEntity): string {
  const s = e.style
  const pad = (n: number) => " ".repeat(n)
  const comment = (i: number) =>
    s.comments && i % 3 === 0 ? ` # note ${i}` : ""
  let counter = 0
  /** A comment at column 0, marked so the group writer does not indent it. */
  const column0 = "\u0000"
  const styles = ["|-", ">-", "|", "|+"]
  /**
   * `key: value` as lines, the value as a block scalar now and then: only
   * text on one line that a block scalar keeps as it is.
   */
  const entry = (indent: number, key: string, v: Scalar): string[] => {
    const n = counter++
    if (
      !s.blockScalars ||
      n % 3 !== 1 ||
      typeof v !== "string" ||
      !/^[^\s][^\r\n]*$/.test(v) ||
      /\s$/.test(v)
    )
      return [`${pad(indent)}${key}: ${written(v, s, false)}`]
    const lines = [
      `${pad(indent)}${key}: ${styles[n % styles.length]}`,
      `${pad(indent + 2)}${v}`,
    ]
    if (s.comments) lines.push(`${column0}# after a block scalar`)
    return lines
  }
  const lines = [
    "---",
    `id: service/${e.slug}`,
    "type: service",
    ...entry(0, "title", e.title),
    ...entry(0, "summary", e.summary),
    `status: ${e.status}`,
    "owner: person/guneet",
  ].map((l) => l.replace(column0, ""))
  if (e.aliases.length > 0) lines.push(`aliases: [${e.aliases.join(", ")}]`)
  if (e.groups.length > 0) lines.push("facts:")
  const base = s.zeroIndent ? 0 : s.indent
  const fieldCol = base + 2
  const longFlow = (f: GeneratedFact) => {
    const parts: string[] = []
    if (f.to !== undefined) parts.push(`to: ${f.to}`)
    if (f.item !== undefined) parts.push(`item: ${written(f.item, s, true)}`)
    if (f.value !== undefined && f.state !== "unknown")
      parts.push(`value: ${written(f.value, s, true)}`)
    if (f.via !== undefined) parts.push(`via: ${f.via}`)
    if (f.note !== undefined) parts.push(`note: ${written(f.note, s, true)}`)
    if (f.task !== undefined) parts.push(`task: ${f.task}`)
    return parts
  }
  const short = (f: GeneratedFact, flow: boolean) =>
    written(
      f.state === "unknown"
        ? (f.note as string)
        : ((f.to ?? f.value) as Scalar),
      s,
      flow,
    )
  for (const g of e.groups) {
    const fields: string[][] = []
    const checkFields: string[][] = []
    if (g.check) {
      checkFields.push([`checked: ${g.check.checked}${comment(counter++)}`])
      checkFields.push([`by: ${g.check.by}`])
      checkFields.push([`scope: ${written(g.check.scope, s, false)}`])
      checkFields.push([`source: ${written(g.check.source, s, false)}`])
      if (g.check.limits)
        checkFields.push([`limits: ${written(g.check.limits, s, false)}`])
    }
    const stateFields: string[][] = []
    for (const { state, facts } of g.states) {
      const block = [`${state}:${comment(counter++)}`]
      for (const list of facts) {
        const first = list[0] as GeneratedFact
        const many =
          first.key === "endpoint" ||
          first.key === "runs-on" ||
          first.key === "secrets-in"
        if (!many || (list.length === 1 && counter++ % 2 === 0)) {
          if (!first.long)
            block.push(
              ...(first.to === undefined
                ? entry(
                    s.indent,
                    first.key,
                    first.state === "unknown"
                      ? (first.note as string)
                      : (first.value as Scalar),
                  )
                : [`${pad(s.indent)}${first.key}: ${short(first, false)}`]),
            )
          else if (first.block) {
            block.push(`${pad(s.indent)}${first.key}:`)
            for (const p of longFlow(first).map((p) =>
              p.replace(/^(\w+): /, "$1: "),
            ))
              block.push(`${pad(2 * s.indent)}${p}`)
          } else
            block.push(
              `${pad(s.indent)}${first.key}: { ${longFlow(first).join(", ")} }`,
            )
        } else if (s.flowLists && list.every((f) => !f.block || !f.long)) {
          const items = list.map((f) =>
            f.long ? `{ ${longFlow(f).join(", ")} }` : short(f, true),
          )
          block.push(`${pad(s.indent)}${first.key}: [${items.join(", ")}]`)
        } else {
          block.push(`${pad(s.indent)}${first.key}:`)
          for (const f of list) {
            const dash = pad(2 * s.indent)
            if (!f.long) block.push(`${dash}- ${short(f, false)}`)
            else if (f.block) {
              const parts = longFlow(f)
              block.push(`${dash}- ${parts[0]}`)
              for (const p of parts.slice(1)) block.push(`${dash}  ${p}`)
            } else block.push(`${dash}- { ${longFlow(f).join(", ")} }`)
          }
        }
      }
      // A comment on its own line before a state map, now and then; on the
      // dash line when the state map comes first (`- # about observed`).
      if (s.comments && counter++ % 2 === 0) block.unshift(`# about ${state}`)
      stateFields.push(block)
    }
    fields.push(
      ...(g.statesFirst
        ? [...stateFields, ...checkFields]
        : [...checkFields, ...stateFields]),
    )
    fields.forEach((field, i) => {
      field.forEach((line, j) => {
        if (line.startsWith(column0)) lines.push(line.slice(1))
        else if (i === 0 && j === 0) lines.push(`${pad(base)}- ${line}`)
        else lines.push(`${pad(fieldCol)}${line}`)
      })
    })
  }
  lines.push("---", "")
  for (const section of e.sections)
    lines.push(
      `${"#".repeat(section.level)} ${section.heading}`,
      "",
      section.text,
      "",
    )
  const eol = s.crlf ? "\r\n" : "\n"
  return lines.join(eol)
}

/** Interprets a random command against the document as it is now. */
interface Command {
  kind: number
  a: number
  b: number
  value: Scalar
  text: string
  check: CheckInput
  flag: boolean
}

const command: fc.Arbitrary<Command> = fc.record({
  kind: fc.integer({ min: 0, max: 11 }),
  a: fc.nat(),
  b: fc.nat(),
  value,
  text,
  check: checkArb.map(({ limits, ...c }) =>
    limits === undefined ? c : { ...c, limits },
  ),
  flag: fc.boolean(),
})

const pick = <T>(list: readonly T[], n: number): T | undefined =>
  list[n % Math.max(1, list.length)]

/** What a command targets, for the checks after it applies. */
type Target =
  | {
      kind: "fact"
      keys: Set<string>
      identity?: string
      input?: FactInput
      check?: CheckInput
      /** The key whose discrepancy is accepted. */
      accepts?: string
    }
  | { kind: "recheck"; identities: string[]; check: CheckInput }
  | { kind: "remove"; identity: string; key: string }
  | { kind: "field"; names: Set<string> }
  | { kind: "body" }

/** The keys and values commands use on one kind of document. */
interface Vocabulary {
  single: string[]
  many: { key: string; values: string[] }[]
  relations: {
    key: string
    targets: string[]
    attribute?: { name: string; values: string[] }
  }[]
}

const serviceVocabulary: Vocabulary = {
  single: singleKeys,
  many: [{ key: "endpoint", values: endpoints }],
  relations: [
    { key: "runs-on", targets: machines },
    {
      key: "secrets-in",
      targets: ["service/vault"],
      attribute: {
        name: "item",
        values: services.map((s) => `vault/${s.slice(8)}`),
      },
    },
  ],
}

function operationFor(
  vocabulary: Vocabulary,
  c: Command,
  document: EntityDocument,
  entity: ResolvedEntity,
): { operation: CatalogOperation; target: Target } | null {
  const id = document.id as string
  const facts = entity.facts
  const known = facts.filter((f) => f.state !== "planned")
  switch (c.kind) {
    case 0:
    case 1: {
      const states: FactState[] = ["intended", "observed", "planned", "unknown"]
      const state = pick(states, c.a) as FactState
      const keys = [
        ...vocabulary.single,
        ...vocabulary.many.map((m) => m.key),
        ...vocabulary.relations.map((r) => r.key),
      ]
      const key = pick(keys, c.b) as string
      const schema = keySchema(entity.schema, key)
      const relation = vocabulary.relations.find((r) => r.key === key)
      const many = vocabulary.many.find((m) => m.key === key)
      const fact: FactInput = { key, state }
      if (state === "unknown") {
        fact.note = c.text
        if (relation && c.flag) fact.to = pick(relation.targets, c.a)
      } else if (relation) {
        fact.to = pick(relation.targets, c.a)
        if (relation.attribute)
          fact.attributes = {
            [relation.attribute.name]: pick(
              relation.attribute.values,
              c.b,
            ) as string,
          }
      } else {
        fact.value = many ? pick(many.values, c.a) : c.value
        if (c.flag && !schema.many) fact.via = pick(["df", "lsblk"], c.b)
      }
      if (state === "planned") fact.task = "T-7"
      if (c.flag && state !== "unknown" && state !== "planned")
        fact.note = c.text
      const identity = factIdentityKey({
        key,
        state,
        many: schema.many,
        relation: schema.relation,
        value: fact.value,
        to: fact.to,
        via: fact.via,
        attributes: fact.attributes ?? {},
      })
      const existing = facts.find((f) => f.identity === identity)
      // Reuse an existing group's check half the time, so facts merge.
      const groupCheck = pick(
        document.groups.filter((g) => g.check?.checked && g.check.by === by),
        c.b,
      )?.check
      const check: CheckInput | undefined =
        state === "planned" || (state === "unknown" && c.flag)
          ? undefined
          : c.a % 2 === 0 &&
              groupCheck?.checked &&
              groupCheck.scope &&
              groupCheck.source
            ? {
                checked: groupCheck.checked.text,
                scope: groupCheck.scope,
                source: groupCheck.source,
                ...(groupCheck.limits ? { limits: groupCheck.limits } : {}),
              }
            : c.check
      const operation: CatalogOperation = {
        op: "set-fact",
        document: id,
        fact,
        ...(check ? { check } : {}),
        expect: existing ? expectationOf(existing) : { identity, absent: true },
      }
      return {
        operation,
        target: {
          kind: "fact",
          keys: new Set([key]),
          identity,
          input: fact,
          ...(check ? { check } : {}),
        },
      }
    }
    case 2: {
      const fact = pick(facts, c.a)
      if (!fact) return null
      return {
        operation: {
          op: "remove-fact",
          document: id,
          expect: expectationOf(fact),
        },
        target: { kind: "remove", identity: fact.identity, key: fact.key },
      }
    }
    case 3: {
      const chosen = [pick(known, c.a), pick(known, c.b)].filter(
        (f): f is Fact => f !== undefined,
      )
      const unique = [...new Map(chosen.map((f) => [f.identity, f])).values()]
      if (unique.length === 0) return null
      return {
        operation: {
          op: "recheck-facts",
          document: id,
          facts: unique.map(expectationOf),
          check: c.check,
        },
        target: {
          kind: "recheck",
          identities: unique.map((f) => f.identity),
          check: c.check,
        },
      }
    }
    case 4: {
      // A change of state: a planned or unknown fact settled by an observation.
      const settled = pick(
        facts.filter((f) => f.state === "planned" || f.state === "unknown"),
        c.a,
      )
      if (!settled) return null
      const fact: FactInput = { key: settled.key, state: "observed" }
      const relation = vocabulary.relations.find((r) => r.key === settled.key)
      const many = vocabulary.many.find((m) => m.key === settled.key)
      if (settled.schema.relation) {
        fact.to = settled.to ?? pick(relation?.targets ?? machines, c.b)
        const attribute = relation?.attribute
        if (attribute)
          fact.attributes = {
            [attribute.name]: String(
              settled.attributes[attribute.name] ?? pick(attribute.values, c.b),
            ),
          }
      } else
        fact.value = settled.schema.many
          ? String(settled.value ?? pick(many?.values ?? endpoints, c.b))
          : c.value
      if (settled.via !== undefined && !settled.schema.many)
        fact.via = settled.via
      const identity = factIdentityKey({
        key: fact.key,
        state: "observed",
        many: settled.schema.many,
        relation: settled.schema.relation,
        value: fact.value,
        to: fact.to,
        via: fact.via,
        attributes: fact.attributes ?? {},
      })
      const existing = facts.find((f) => f.identity === identity)
      return {
        operation: {
          op: "set-fact",
          document: id,
          fact,
          check: c.check,
          expect: existing
            ? expectationOf(existing)
            : { identity, absent: true },
          supersedes: expectationOf(settled),
        },
        target: {
          kind: "fact",
          keys: new Set([fact.key]),
          identity,
          input: fact,
          check: c.check,
        },
      }
    }
    case 5: {
      // A retired entity stays retired.
      const fields =
        document.status === "retired"
          ? (["title", "summary"] as const)
          : (["title", "summary", "status"] as const)
      const field = pick(fields, c.a) as "title" | "summary" | "status"
      const value =
        field === "status" ? (c.flag ? "active" : "deprecated") : c.text
      const now = document[field]
      return {
        operation: {
          op: "set-field",
          document: id,
          field,
          value,
          expect: { value: now },
        },
        target: { kind: "field", names: new Set([field]) },
      }
    }
    case 6: {
      const sections = document.body.sections
      const section = pick(sections, c.a)
      const replacement = `## Note ${c.b % 100}\n\n${c.text.replace(/[\r\n#]/g, " ")}\n`
      if (c.flag || !section)
        return {
          operation: {
            op: "edit-body",
            document: id,
            text: `\n${replacement}`,
            expect: { text: document.body.text },
          },
          target: { kind: "body" },
        }
      const name = section.anchor
      // A section keeps its heading; the text before the first heading has none.
      const paragraph = `${c.text.replace(/[\r\n#]/g, " ")}\n`
      const text =
        section.heading === null
          ? paragraph
          : `${"#".repeat(section.level)} ${section.heading}\n\n${paragraph}`
      return {
        operation: {
          op: "edit-body",
          document: id,
          section: name,
          text: c.a % 3 === 0 ? "" : text,
          expect: { text: section.text },
        },
        target: { kind: "body" },
      }
    }
    case 7: {
      if (document.body.sections.some((s) => s.anchor === "added")) return null
      return {
        operation: {
          op: "edit-body",
          document: id,
          section: "added",
          text: `## Added\n\n${c.b}\n`,
          expect: { absent: true },
        },
        target: { kind: "body" },
      }
    }
    case 8: {
      const next = `${document.type}/moved-${c.a % 1000}`
      if (next === id || document.aliases.includes(next)) return null
      return {
        operation: { op: "change-id", document: id, id: next },
        target: { kind: "field", names: new Set(["id", "aliases"]) },
      }
    }
    case 10:
    case 11: {
      // Accepting a discrepancy, as a person's approval writes it.
      const found = pick(discrepancies(entity), c.a)
      if (!found) return null
      return {
        operation: {
          op: "accept-discrepancy",
          document: id,
          key: found.key,
          note: "Accepted: the sources lag",
          expect: found.facts.map(expectationOf),
        },
        target: {
          kind: "fact",
          keys: new Set([found.key]),
          accepts: found.key,
        },
      }
    }
    default: {
      if (document.status === "retired") return null
      return {
        operation: {
          op: "retire",
          document: id,
          ...(c.flag ? { replacedBy: `${document.type}/replacement` } : {}),
          expect: { status: document.status ?? "active" },
        },
        target: { kind: "field", names: new Set(["status", "replaced_by"]) },
      }
    }
  }
}

function slice(
  document: CatalogDocument,
  range: { start: number; end: number },
) {
  return document.text.slice(range.start, range.end)
}

function checkUntouched(
  before: EntityDocument,
  beforeEntity: ResolvedEntity,
  after: EntityDocument,
  afterEntity: ResolvedEntity,
  target: Target,
) {
  const frontmatter = before.frontmatter as { start: number; end: number }
  if (target.kind === "body") {
    expect(after.text.slice(0, after.body.range.start)).toBe(
      before.text.slice(0, before.body.range.start),
    )
    return
  }
  // Everything else changes only frontmatter bytes.
  expect(after.text.startsWith(before.text.slice(0, frontmatter.start))).toBe(
    true,
  )
  expect(after.text.endsWith(before.text.slice(frontmatter.end))).toBe(true)
  expect(after.body.text).toBe(before.body.text)

  const touched = target.kind === "field" ? target.names : new Set(["facts"])
  for (const [name, entry] of before.fields) {
    if (touched.has(name)) continue
    const now = after.fields.get(name)
    expect(now && slice(after, now.range)).toBe(slice(before, entry.range))
  }
  if (target.kind === "field") {
    expect(
      slice(after, after.fields.get("facts")?.range ?? { start: 0, end: 0 }),
    ).toBe(
      slice(before, before.fields.get("facts")?.range ?? { start: 0, end: 0 }),
    )
    return
  }

  // Facts of other keys keep their text and their fact check; rechecked
  // facts keep their value.
  const keys =
    target.kind === "fact"
      ? target.keys
      : target.kind === "remove"
        ? new Set([target.key])
        : new Set<string>()
  const moved = new Set(target.kind === "recheck" ? target.identities : [])
  for (const fact of beforeEntity.facts) {
    if (keys.has(fact.key)) continue
    const now = afterEntity.facts.find((f) => f.identity === fact.identity)
    expect(now, `${fact.identity} is kept`).toBeDefined()
    if (!now) continue
    expect(now.value).toEqual(fact.value)
    expect(now.to).toEqual(fact.to)
    expect(now.note).toEqual(fact.note)
    expect(now.accepted).toEqual(fact.accepted)
    if (!moved.has(fact.identity)) {
      expect(slice(after, now.valueRange)).toBe(slice(before, fact.valueRange))
      expect(now.check?.checked?.text).toBe(fact.check?.checked?.text)
      expect(now.check?.scope).toBe(fact.check?.scope)
    }
  }
}

/**
 * Catalog §4.7: when a discrepancy's facts or values change, no fact of it
 * keeps `accepted` (but one the operation accepts itself); otherwise every
 * acceptance stays.
 */
function checkAccepted(
  before: ResolvedEntity,
  after: ResolvedEntity,
  target: Target,
) {
  const keys =
    target.kind === "fact"
      ? target.keys
      : target.kind === "remove"
        ? new Set([target.key])
        : null
  if (!keys) return
  const of = (entity: ResolvedEntity, key: string) =>
    (discrepancies(entity).find((d) => d.key === key)?.facts ?? [])
      .map((f) => `${f.identity}=${comparableValue(f)}`)
      .sort()
      .join("\n")
  for (const key of keys) {
    const facts = after.facts.filter(
      (f) =>
        f.key === key &&
        !f.schema.many &&
        (f.state === "intended" || f.state === "observed"),
    )
    if (of(before, key) !== of(after, key))
      expect(facts.filter((f) => f.accepted !== undefined)).toEqual([])
    else
      for (const fact of before.facts.filter(
        (f) => f.key === key && f.accepted !== undefined,
      ))
        if (facts.some((f) => f.identity === fact.identity))
          expect(
            facts.find((f) => f.identity === fact.identity)?.accepted,
          ).toBe(fact.accepted)
  }
}

function checkModel(afterEntity: ResolvedEntity, target: Target) {
  if (target.kind === "fact" && target.accepts) {
    const found = discrepancies(afterEntity).find(
      (d) => d.key === target.accepts,
    )
    expect(found?.accepted).toBe(true)
    for (const fact of found?.facts ?? []) {
      expect(fact.accepted).toBe("person/guneet")
      expect(fact.note).toBe("Accepted: the sources lag")
    }
  }
  if (target.kind === "remove")
    expect(afterEntity.facts.some((f) => f.identity === target.identity)).toBe(
      false,
    )
  if (target.kind === "recheck")
    for (const identity of target.identities) {
      const fact = afterEntity.facts.find((f) => f.identity === identity)
      expect(fact?.check?.checked?.text).toBe(target.check.checked)
      expect(fact?.check?.by).toBe(by)
      expect(fact?.check?.scope).toBe(target.check.scope)
    }
  if (target.kind === "fact" && target.identity && target.input) {
    const found = afterEntity.facts.filter(
      (f) => f.identity === target.identity,
    )
    expect(found).toHaveLength(1)
    const fact = found[0] as Fact
    const input = target.input
    expect(fact.state).toBe(input.state)
    expect(fact.value).toEqual(
      input.state === "unknown" ? undefined : input.value,
    )
    expect(fact.to).toEqual(input.to)
    expect(fact.via).toEqual(input.via)
    if (input.note !== undefined) expect(fact.note).toEqual(input.note)
    expect(fact.task).toEqual(input.task)
    if (target.check) {
      expect(fact.check?.checked?.text).toBe(target.check.checked)
      expect(fact.check?.by).toBe(by)
      expect(fact.check?.source).toBe(target.check.source)
      expect(fact.check?.limits).toBe(target.check.limits)
    } else expect(fact.check).toBeNull()
    if (input.state === "intended" || input.state === "observed") {
      const unknowns = afterEntity.facts.filter(
        (f) => f.key === input.key && f.state === "unknown",
      )
      if (!fact.schema.many) expect(unknowns).toEqual([])
      else if (input.to !== undefined)
        expect(unknowns.filter((f) => f.to === input.to)).toEqual([])
    }
  }
}

/** fast-check options: `FC_SEED` and `FC_RUNS` replay or widen a run. */
const runs = (numRuns: number): fc.Parameters<unknown> => ({
  numRuns: Number(process.env.FC_RUNS ?? numRuns),
  verbose: 0,
  ...(process.env.FC_SEED ? { seed: Number(process.env.FC_SEED) } : {}),
})
/**
 * A generous time limit: a busy machine (or a widened run) must not turn a
 * slow run into a failure without a counterexample.
 */
const timeout = (numRuns: number) =>
  Math.max(600_000, Number(process.env.FC_RUNS ?? numRuns) * 1000)

describe("operations on random documents", () => {
  it(
    "the generated documents read without problems",
    () => {
      fc.assert(
        fc.property(entity, (e) => {
          const text = write(e)
          const catalog = readCatalog([text])
          const document = noReadFailure(
            catalog.documents[0] as CatalogDocument,
          )
          expect(document.problems).toEqual([])
          expect(catalog.entities.get(`service/${e.slug}`)?.problems).toEqual(
            [],
          )
          expect(applyOperations([text], [], { by })).toMatchObject({
            applied: true,
            changes: [],
          })
        }),
        runs(200),
      )
    },
    timeout(200),
  )

  it(
    "each give a document that reads, holds what was written and changes only the targeted bytes",
    () => {
      fc.assert(
        fc.property(
          entity,
          fc.array(command, { minLength: 1, maxLength: 8 }),
          (e, commands) => {
            const text = write(e)
            const last = runCommands(
              [text],
              `service/${e.slug}`,
              serviceVocabulary,
              commands,
            )
            if (e.style.crlf)
              expect(last.replace(/\r\n/g, "")).not.toMatch(/\n/)
            else expect(last).not.toMatch(/\r/)
          },
        ),
        runs(300),
      )
    },
    timeout(300),
  )
})

const fixtures: {
  name: string
  documents: string[]
  id: string
  vocabulary: Vocabulary
}[] = [
  {
    name: "Dockyard",
    documents: [dockyard],
    id: "project/dockyard",
    vocabulary: {
      single: ["release.latest", "docs.readme", "issue_tracker"],
      many: [
        {
          key: "repository",
          values: [
            "https://github.com/guneet-xyz/dockyard",
            "https://git.guneet.dev/x",
          ],
        },
      ],
      relations: [
        {
          key: "checkout-on",
          targets: ["machine/daedalus", "machine/musashi"],
          attribute: {
            name: "path",
            values: ["/root/dockyard", "/mnt/musashi/stacks/dockyard"],
          },
        },
        {
          key: "provides",
          targets: ["service/container-registry", "service/registry-ui"],
        },
      ],
    },
  },
  {
    name: "Musashi",
    documents: [musashi],
    id: "machine/musashi",
    vocabulary: {
      single: [
        "disk.data.size",
        "disk.data.free",
        "platform.arch",
        "network.public_ipv6",
        "role",
      ],
      many: [],
      relations: [
        {
          key: "on-network",
          targets: ["service/tailscale", "service/ingress"],
        },
        {
          key: "secrets-in",
          targets: ["service/infisical"],
          attribute: { name: "item", values: ["musashi/ssh", "musashi/azure"] },
        },
      ],
    },
  },
  {
    name: "guneet.dev, with its type schema",
    documents: [domainSchema, guneetDev],
    id: "domain/guneet-dev",
    vocabulary: {
      single: ["registrar", "expires_on"],
      many: [
        {
          key: "nameservers",
          values: ["ada.ns.cloudflare.com", "carl.ns.cloudflare.com"],
        },
      ],
      relations: [
        {
          key: "served-by",
          targets: ["service/cloudflare-dns", "service/ingress"],
        },
        { key: "configured-by", targets: ["project/dns"] },
      ],
    },
  },
]

describe("operations on the catalog document's examples", () => {
  it.each(fixtures)(
    "$name: random sequences read, hold what was written and change only the targeted bytes",
    ({ documents, id, vocabulary }) => {
      fc.assert(
        fc.property(
          fc.array(command, { minLength: 1, maxLength: 12 }),
          (commands) => {
            runCommands(documents, id, vocabulary, commands)
          },
        ),
        runs(150),
      )
    },
    timeout(150),
  )
})

const now = Date.parse("2026-11-18T00:00:00Z")

/**
 * Small entities for everything the documents and commands may refer to,
 * so references resolve and validation judges only what operations write.
 */
function stubs(catalog: Catalog, vocabulary: Vocabulary, id: string): string[] {
  const type = id.slice(0, id.indexOf("/"))
  const wanted = new Set([
    "person/guneet",
    `${type}/replacement`,
    ...machines,
    ...services,
    ...vocabulary.relations.flatMap((r) => r.targets),
  ])
  for (const document of catalog.documents)
    for (const link of document.body.links)
      if (link.reference) wanted.add(link.reference)
  for (const entity of catalog.entities.values())
    for (const fact of entity.facts) if (fact.to) wanted.add(fact.to)
  const taken = new Set(
    catalog.documents.flatMap((d) => [
      d.id,
      ...(d.kind === "entity" ? d.aliases : []),
    ]),
  )
  return [...wanted]
    .filter((ref) => !taken.has(ref))
    .map(
      (ref) =>
        `---\nid: ${ref}\ntype: ${ref.slice(0, ref.indexOf("/"))}\ntitle: Stub\nsummary: A stub.\nstatus: active\nowner: person/guneet\n---\n`,
    )
}

/**
 * Applies each command to the entity `id` among `documents`, one proposal
 * at a time, checking every result. Returns the entity's last text.
 */
function runCommands(
  documents: string[],
  id: string,
  vocabulary: Vocabulary,
  commands: Command[],
): string {
  const start = readCatalog(documents)
  const index = start.documents.findIndex((d) => d.id === id)
  const others = [
    ...documents.filter((_, i) => i !== index),
    ...stubs(start, vocabulary, id),
  ]
  let text = documents[index] as string
  let current = id
  expect(
    validateCatalog(readCatalog([...others, text]), { now }).problems.filter(
      (p) => p.severity === "blocking",
    ),
  ).toEqual([])
  for (const c of commands) {
    const catalog = readCatalog([...others, text])
    const document = catalog.documents.find(
      (d) => d.id === current,
    ) as EntityDocument
    const entity = catalog.entities.get(current) as ResolvedEntity
    const planned = operationFor(vocabulary, c, document, entity)
    if (!planned) continue
    const result = applyOperations([...others, text], [planned.operation], {
      by,
      acceptedBy: "person/guneet",
    })
    if (!result.applied)
      throw new Error(
        `Refused ${JSON.stringify(planned.operation)}: ${JSON.stringify(result.problems)}\n${text}`,
      )
    const after = (result.changes[0]?.after ??
      result.after.documents.find((d) => d.id === current)) as EntityDocument
    noReadFailure(after)
    expect(after.problems).toEqual([])
    const afterEntity = result.after.entities.get(
      after.id as string,
    ) as ResolvedEntity
    expect(afterEntity.problems).toEqual([])
    // Every fact identity is still unique.
    expect(new Set(afterEntity.facts.map((f) => f.identity)).size).toBe(
      afterEntity.facts.length,
    )
    // The other documents are untouched.
    expect(result.changes.every((change) => change.after === after)).toBe(true)
    checkUntouched(document, entity, after, afterEntity, planned.target)
    checkModel(afterEntity, planned.target)
    checkAccepted(entity, afterEntity, planned.target)
    // The result validates (catalog §8.3): nothing the operation wrote blocks it.
    const validation = validateChange(
      {
        before: result.before,
        after: result.after,
        changed: result.changes.map((change) => change.after),
      },
      { now },
    )
    expect(
      validation.problems.filter((p) => p.severity === "blocking"),
    ).toEqual([])
    text = after.text
    current = after.id as string
  }
  return text
}
