import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { noReadFailure } from "../../../test/catalog-documents.js"
import { readCatalog } from "./catalog.js"
import { factIdentityKey, parseFactIdentityKey } from "./identity.js"
import type { FactState } from "./model.js"
import { parseCatalogDocument as readDocument } from "./parse.js"
import { builtInSchemas, keySchema } from "./schemas.js"
import { slice } from "./source.js"
import { parseYaml } from "./yaml.js"

/** Reads a document, failing the test on an unexpected read failure. */
const parseCatalogDocument = (text: string) => noReadFailure(readDocument(text))

/**
 * Property tests: random valid entity documents, written in the styles the
 * catalog document uses, parse back to what was generated, with every range
 * pointing at the written text.
 */

type Scalar = string | number | boolean

interface GeneratedFact {
  key: string
  state: FactState
  value?: Scalar
  to?: string
  /** The identifying attribute of `secrets-in`. */
  item?: string
  via?: string
  note?: string
  task?: string
  long: boolean
}

interface GeneratedGroup {
  check: {
    checked: string
    by: string
    scope: string
    source: string
    limits?: string
  } | null
  states: { state: FactState; facts: GeneratedFact[][] }[]
}

interface GeneratedEntity {
  slug: string
  title: string
  summary: string
  status: "active" | "deprecated" | "retired"
  aliases: string[]
  groups: GeneratedGroup[]
  sections: { level: number; heading: string; text: string }[]
}

const word = fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/)
const slug = fc
  .array(word, { minLength: 1, maxLength: 3 })
  .map((w) => w.join("-"))
const text = fc
  .string({
    unit: fc.constantFrom(
      ..."abcXYZ 019:#-'\"{}[],&*!|>%@`?/.é🙂".split(/(?:)/u),
    ),
    minLength: 1,
    maxLength: 30,
  })
  .filter((s) => s.trim() !== "")
const value: fc.Arbitrary<Scalar> = fc.oneof(
  text,
  fc.integer({ min: -1_000_000, max: 1_000_000 }),
  fc.boolean(),
  fc.constantFrom("no", "on", "null", "true", "2026-11-14", "1.10", "~"),
)
const date = fc
  .date({
    min: new Date("2000-01-01T00:00:00Z"),
    max: new Date("2030-12-31T00:00:00Z"),
    noInvalidDate: true,
  })
  .chain((d) =>
    fc.constantFrom(
      d.toISOString().slice(0, 10),
      `${d.toISOString().slice(0, 16)}Z`,
      `${d.toISOString().slice(0, 19)}+05:30`,
    ),
  )

/** Single-valued machine keys, and keys outside the schema (also single-valued). */
const singleKey = fc.constantFrom(
  "role",
  "environment",
  "platform.arch",
  "disk.data.size",
  "access.address",
  "ups.model",
  "rack_position",
)

function factFor(state: FactState): fc.Arbitrary<GeneratedFact[]> {
  const extras = {
    via: fc.option(word, { nil: undefined }),
    note: fc.option(text, { nil: undefined }),
  }
  if (state === "unknown")
    return fc
      .record({ key: singleKey, note: text, long: fc.boolean() })
      .map((f) => [{ ...f, state }])
  const single = fc
    .record({
      key: singleKey,
      value,
      long: fc.boolean(),
      ...extras,
      task:
        state === "planned"
          ? fc.constantFrom("T-1", "SHN-42")
          : fc.constant(undefined),
    })
    .map((f) => ({
      ...f,
      state,
      long:
        f.long ||
        f.via !== undefined ||
        f.note !== undefined ||
        f.task !== undefined,
    }))
    .map((f) => [f])
  if (state === "planned") return single
  const networks = fc
    .uniqueArray(slug, { minLength: 1, maxLength: 3 })
    .map((targets) =>
      targets.map((t) => ({
        key: "on-network",
        state,
        to: `service/${t}`,
        long: false,
      })),
    )
  // `secrets-in` is identified by its target and `item`.
  const secrets = fc
    .uniqueArray(fc.tuple(slug, slug), {
      minLength: 1,
      maxLength: 3,
      selector: ([target, item]) => `${target}|${item}`,
    })
    .map((pairs) =>
      pairs.map(([target, item]) => ({
        key: "secrets-in",
        state,
        to: `service/${target}`,
        item: `vault/${item}`,
        long: true,
      })),
    )
  return fc.oneof(single, single, networks, secrets)
}

const machine = builtInSchemas.get("machine") ?? null

/**
 * fast-check options: failures report the seed and the shrunk
 * counterexample; `FC_SEED` and `FC_RUNS` replay or widen a run.
 */
const runs = (numRuns: number): fc.Parameters<unknown> => ({
  numRuns: Number(process.env.FC_RUNS ?? numRuns),
  verbose: 1,
  ...(process.env.FC_SEED ? { seed: Number(process.env.FC_SEED) } : {}),
})

/**
 * A generous time limit: a busy machine must not turn a slow run into a
 * failure without a counterexample.
 */
const timeout = (numRuns: number) =>
  Math.max(120_000, Number(process.env.FC_RUNS ?? numRuns) * 50)

/** Drops facts that repeat an earlier fact's identity, so the document stays valid. */
function dedupe(e: GeneratedEntity): GeneratedEntity {
  const seen = new Set<string>()
  // The parser's own identity rules, so the generator cannot disagree.
  const identity = (f: GeneratedFact) => {
    const key = keySchema(machine, f.key)
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

const stateMap = (state: FactState) =>
  fc
    .array(factFor(state), { minLength: 1, maxLength: 4 })
    .map((lists) => {
      const seen = new Set<string>()
      return lists.filter((l) => {
        const key = l[0]!.key
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
      by: fc.constantFrom("guneet", "guneet via opencode-daedalus", "shinan"),
      scope: text,
      source: text,
      limits: fc.option(text, { nil: undefined }),
    }),
    states: fc
      .subarray(["intended", "observed", "unknown"] as FactState[], {
        minLength: 1,
      })
      .chain((states) => fc.tuple(...states.map(stateMap))),
  }),
  fc.record({
    check: fc.constant(null),
    states: fc
      .subarray(["planned", "unknown"] as FactState[], { minLength: 1 })
      .chain((states) => fc.tuple(...states.map(stateMap))),
  }),
)

const entity: fc.Arbitrary<GeneratedEntity> = fc
  .record({
    slug,
    title: text,
    summary: text,
    status: fc.constantFrom("active", "deprecated", "retired"),
    aliases: fc.uniqueArray(slug, { maxLength: 2 }),
    groups: fc.array(group, { maxLength: 4 }),
    sections: fc.array(
      fc.record({
        level: fc.integer({ min: 1, max: 6 }),
        heading: fc.stringMatching(/^[A-Z][a-z]{1,8}( [a-z]{1,8}){0,2}$/),
        text: fc.stringMatching(/^[A-Za-z ,.]{0,60}$/),
      }),
      { maxLength: 4 },
    ),
  })
  .map(dedupe)

/** Writes a scalar plainly where YAML reads it back as the same text, quoted otherwise. */
function scalar(v: Scalar): string {
  if (typeof v !== "string") return String(v)
  if (
    /^[A-Za-z][A-Za-z0-9 ./_()-]*[A-Za-z0-9)]$/.test(v) &&
    !/^(true|false|null|True|False|TRUE|FALSE|Null|NULL)$/.test(v)
  )
    return v
  return JSON.stringify(v)
}

function writeFact(f: GeneratedFact, indent: string): string {
  const parts: string[] = []
  if (f.to !== undefined) parts.push(`to: ${f.to}`)
  if (f.item !== undefined) parts.push(`item: ${scalar(f.item)}`)
  if (f.value !== undefined) parts.push(`value: ${scalar(f.value)}`)
  if (f.via !== undefined) parts.push(`via: ${f.via}`)
  if (f.note !== undefined) parts.push(`note: ${scalar(f.note)}`)
  if (f.task !== undefined) parts.push(`task: ${f.task}`)
  if (!f.long)
    return scalar(f.state === "unknown" ? f.note! : (f.to ?? f.value!))
  return indent === ""
    ? `{ ${parts.join(", ")} }`
    : `\n${parts.map((p) => `${indent}${p}`).join("\n")}`
}

function write(e: GeneratedEntity, blockLongForms: boolean): string {
  const lines = [
    "---",
    `id: machine/${e.slug}`,
    "type: machine",
    `title: ${scalar(e.title)}`,
    `summary: ${scalar(e.summary)}`,
    `status: ${e.status}`,
    "owner: person/guneet",
  ]
  if (e.aliases.length > 0) lines.push(`aliases: [${e.aliases.join(", ")}]`)
  if (e.groups.length > 0) lines.push("facts:")
  for (const g of e.groups) {
    const fields: string[] = []
    if (g.check) {
      fields.push(`checked: ${g.check.checked}`)
      fields.push(`by: ${g.check.by}`)
      fields.push(`scope: ${scalar(g.check.scope)}`)
      fields.push(`source: ${scalar(g.check.source)}`)
      if (g.check.limits) fields.push(`limits: ${scalar(g.check.limits)}`)
    }
    for (const { state, facts } of g.states) {
      fields.push(`${state}:`)
      for (const list of facts) {
        const first = list[0]!
        if (
          list.length === 1 &&
          first.key !== "on-network" &&
          first.key !== "secrets-in"
        ) {
          fields.push(
            `  ${first.key}: ${writeFact(first, blockLongForms ? "    " : "")}`,
          )
        } else {
          fields.push(`  ${first.key}:`)
          for (const f of list) fields.push(`    - ${writeFact(f, "")}`)
        }
      }
    }
    fields.forEach((f, i) =>
      lines.push(`${i === 0 ? "  - " : "    "}${f.replace(/\n/g, "\n    ")}`),
    )
  }
  lines.push("---", "")
  for (const s of e.sections)
    lines.push(`${"#".repeat(s.level)} ${s.heading}`, "", s.text, "")
  return lines.join("\n")
}

describe("random valid entity documents", () => {
  it(
    "parse back to what was written, with ranges on the written text",
    () => {
      fc.assert(
        fc.property(entity, fc.boolean(), (e, blockLongForms) => {
          const text = write(e, blockLongForms)
          const d = parseCatalogDocument(text)
          expect(d.problems).toEqual([])
          if (d.kind !== "entity") throw new Error("expected an entity")
          expect(d.text).toBe(text)
          expect(d).toMatchObject({
            id: `machine/${e.slug}`,
            title: e.title,
            summary: e.summary,
            status: e.status,
            aliases: e.aliases,
          })

          const expected = e.groups.flatMap((g) =>
            g.states.flatMap(({ facts }) => facts.flat()),
          )
          expect(
            d.facts.map((f) => ({
              key: f.key,
              state: f.state,
              value: f.value ?? f.to,
              item: f.attributes.item,
              via: f.via,
              note: f.note,
              task: f.task,
            })),
          ).toEqual(
            expected.map((f) => ({
              key: f.key,
              state: f.state,
              value: f.value ?? f.to,
              item: f.item,
              via: f.via,
              note: f.note,
              task: f.task,
            })),
          )
          expect(d.groups.map((g) => g.check?.checked?.text)).toEqual(
            e.groups.map((g) => g.check?.checked),
          )

          for (const f of d.facts) {
            expect(slice(text, f.keyRange)).toBe(f.key)
            // Re-indented to its column, a value's text reads as YAML on its own.
            const column =
              f.valueRange.start -
              text.lastIndexOf("\n", f.valueRange.start - 1) -
              1
            const written = parseYaml(
              " ".repeat(column) + slice(text, f.valueRange),
              0,
            ).node
            if (f.form === "short")
              expect(written).toMatchObject({
                kind: "scalar",
                value: f.value ?? f.note,
              })
            else expect(written?.kind).toBe("map")
          }

          expect(d.body.sections.map((s) => s.text).join("")).toBe(d.body.text)
          expect(
            d.body.sections.filter((s) => s.heading).map((s) => s.heading),
          ).toEqual(e.sections.map((s) => s.heading))

          const resolved = readCatalog([d]).entities.get(d.id!)!
          expect(resolved.problems).toEqual([])
          for (const f of resolved.facts) {
            expect(parseFactIdentityKey(f.identity)).toMatchObject({
              key: f.key,
              state: f.state,
            })
          }
          expect(new Set(resolved.facts.map((f) => f.identity)).size).toBe(
            resolved.facts.length,
          )
        }),
        runs(300),
      )
    },
    timeout(300),
  )

  it(
    "parse the same way every time",
    () => {
      fc.assert(
        fc.property(entity, (e) => {
          const text = write(e, false)
          expect(JSON.stringify(parseCatalogDocument(text))).toBe(
            JSON.stringify(parseCatalogDocument(text)),
          )
        }),
        runs(50),
      )
    },
    timeout(50),
  )
})
