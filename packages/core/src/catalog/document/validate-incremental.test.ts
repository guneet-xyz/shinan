import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { agentTokenPrefix } from "../../tokens.js"
import { readCatalog } from "./catalog.js"
import type { Catalog } from "./catalog.js"
import type { CatalogDocument } from "./model.js"
import { parseCatalogDocument } from "./parse.js"
import {
  prepareCatalogValidation,
  updateCatalogValidation,
  validateChange,
  validateChangeFully,
  validateChangeIncrementally,
} from "./validate.js"
import type {
  CatalogValidation,
  Change,
  ValidationContext,
} from "./validate.js"

/**
 * Incremental validation (#116) against the full validation as the oracle:
 * random catalogs, changed step by step, give the same result whether the
 * change is validated in full, from no base, from the validation of the
 * revision before it, or from an older revision's.
 */

/** Few names, so documents often share IDs and aliases and reference each other. */
const ids = [
  "person/ana",
  "person/ben",
  "machine/m1",
  "machine/m2",
  "service/s1",
  "project/p1",
  "decision/d1",
  "decision/d2",
  "widget/w1",
  "widget/w2",
] as const
const names = [
  ...ids,
  "machine/old",
  "schema/widget",
  "schema/machine",
  "schema/gadget",
  "start-here",
  "nowhere/x",
] as const
const name = fc.constantFrom(...names)

const token = `${agentTokenPrefix}Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4zAb7cDe0fGh2`
const secret = fc.constantFrom(
  `Used ${token} once.`,
  "Log in with password=hunter22 for now.",
  "Address kV9xQ2mZ7pL4tR8wB3nF6hJ1cY5dG0sAe here.",
)

/** Around `now` below, so fact checks are sometimes in the future, and later not. */
const checked = fc.constantFrom(
  "2026-11-10",
  "2026-11-14",
  "2026-11-21",
  "2026-11-23",
  "2026-12-30",
  "2026-11-20T18:00:00Z",
)

const fact = fc.oneof(
  fc.constantFrom(
    "member: ana",
    "member: ben",
    "role: in progress",
    "role: Production host",
    "size: 3",
    "ups: big",
    "disk.data.size: 4 GiB",
  ),
  name.map((n) => `configured-by: ${n}`),
  name.map((n) => `on-network: ${n}`),
  name.map((n) => `runs-on: ${n}`),
  name.map((n) => `applies-to: ${n}`),
  name.map((n) => `link: ${n}`),
  fc.constantFrom("from-task: T-12", "from-task: nope"),
)

const group = (date: string, state: string, facts: readonly string[]) =>
  `  - checked: ${date}\n    by: guneet\n    scope: Looked\n    source: Somewhere\n    ${state}:\n${facts.map((f) => `      ${f}\n`).join("")}`

const entity = fc
  .record({
    id: fc.constantFrom(...ids, "machine/old"),
    wrongType: fc.boolean(),
    status: fc.constantFrom("active", "active", "retired"),
    owner: fc.constantFrom(
      "person/ana",
      "person/ben",
      "unknown",
      "machine/m1",
      "person/zed",
    ),
    alias: fc.option(fc.constantFrom("machine/old", "machine/m2", "widget/w1")),
    replacedBy: fc.option(name),
    decidedBy: fc.option(fc.constantFrom("person/ana", "machine/m1")),
    accepted: fc.boolean(),
    observed: fc.uniqueArray(fact, {
      maxLength: 3,
      selector: (f) => f.split(":")[0],
    }),
    observedOn: checked,
    intended: fc.option(fc.constantFrom("role: Spare", "size: 4")),
    intendedOn: checked,
    planned: fc.option(
      fc.constantFrom("decision/d1", "decision/d2", "T-12", "machine/m1"),
    ),
    links: fc.array(name, { maxLength: 2 }),
    secret: fc.option(secret, { freq: 4 }),
  })
  .map((e) => {
    const type = e.wrongType ? "gadget" : e.id.split("/")[0]
    const facts = [
      ...(e.observed.length > 0
        ? [group(e.observedOn, "observed", e.observed)]
        : []),
      ...(e.intended ? [group(e.intendedOn, "intended", [e.intended])] : []),
      ...(e.planned
        ? [`  - planned:\n      role: { value: Spare, task: ${e.planned} }\n`]
        : []),
    ]
    return `---
id: ${e.id}
type: ${type}
title: ${e.id}
summary: An entity for tests.
status: ${e.status}
owner: ${e.owner}
${e.alias ? `aliases: [${e.alias}]\n` : ""}${e.replacedBy ? `replaced_by: ${e.replacedBy}\n` : ""}${
      type === "decision"
        ? `decision_state: ${e.accepted ? "accepted" : "proposed"}\ndecided_on: 2026-11-01\n${e.decidedBy ? `decided_by: ${e.decidedBy}\n` : ""}`
        : ""
    }${facts.length > 0 ? `facts:\n${facts.join("")}` : ""}---

# ${e.id}

${e.links.map((l) => `See [${l}](${l}).`).join(" ")}
${e.secret ?? ""}
`
  })

const schema = fc
  .record({
    type: fc.constantFrom("widget", "widget", "machine", "gadget"),
    status: fc.constantFrom("active", "active", "retired"),
    keys: fc.uniqueArray(
      fc.constantFrom(
        "size: {}",
        "size: { many: true }",
        "ups: {}",
        "role: {}",
        "link: { relation: [machine], inverse: widgets }",
        "link: { relation: [service], many: true, inverse: widgets }",
        "link: { relation: [gadget], inverse: widgets }",
        "parts: { relation: [widget], inverse: in }",
      ),
      { maxLength: 3, selector: (k) => k.split(":")[0] },
    ),
  })
  .map(
    (s) => `---
id: schema/${s.type}
title: ${s.type}
summary: A type for tests.
status: ${s.status}
owner: person/ana
${s.keys.length > 0 ? `keys:\n${s.keys.map((k) => `  ${k}\n`).join("")}` : ""}---

# ${s.type}
`,
  )

const startHereText = (steps: readonly string[]) => `---
id: start-here
title: Start here
owner: person/ana
people:
${steps.map((s) => `  - to: ${s}\n    note: Read it.\n`).join("")}---
`
const startHere = fc
  .array(name, { minLength: 1, maxLength: 3 })
  .map(startHereText)

const document = fc.oneof(
  { arbitrary: entity, weight: 12 },
  { arbitrary: schema, weight: 2 },
  { arbitrary: startHere, weight: 1 },
  { arbitrary: fc.constant("Not a catalog document."), weight: 1 },
)

const now = Date.UTC(2026, 10, 20, 12)
const day = 24 * 60 * 60 * 1000
const members = fc.constantFrom<ReadonlySet<string> | undefined>(
  undefined,
  new Set(["ana"]),
  new Set(["ana", "ben"]),
)

type Step =
  | { kind: "write"; at: number; text: string }
  | { kind: "add"; at: number; text: string }
  | { kind: "remove"; at: number }
  | { kind: "copy"; at: number }
  | { kind: "reread"; at: number }
  | { kind: "move"; from: number; to: number }
  | { kind: "none" }

const at = fc.nat(1000)
const step: fc.Arbitrary<Step> = fc.oneof(
  {
    arbitrary: fc.record({ kind: fc.constant("write"), at, text: document }),
    weight: 6,
  },
  {
    arbitrary: fc.record({ kind: fc.constant("add"), at, text: document }),
    weight: 3,
  },
  { arbitrary: fc.record({ kind: fc.constant("remove"), at }), weight: 2 },
  { arbitrary: fc.record({ kind: fc.constant("copy"), at }), weight: 1 },
  { arbitrary: fc.record({ kind: fc.constant("reread"), at }), weight: 1 },
  {
    arbitrary: fc.record({ kind: fc.constant("move"), from: at, to: at }),
    weight: 1,
  },
  { arbitrary: fc.record({ kind: fc.constant("none") }), weight: 1 },
)

/** One change: what it does to the documents, and the context it is validated in. */
const round = fc.record({
  steps: fc.array(step, { minLength: 1, maxLength: 3 }),
  /** Days after `now`; mostly later, sometimes earlier. */
  days: fc.constantFrom(0, 0, 0, 1, 2, 3, 15, -1),
  members: fc.option(members, { freq: 4 }),
  explanation: fc.option(secret, { freq: 3 }),
  /** Which validation to start from. */
  base: fc.constantFrom("latest", "latest", "latest", "older", "none"),
})

/** Applies the steps, keeping unchanged documents as the same objects, as `applyOperations` does. */
function apply(
  documents: readonly CatalogDocument[],
  steps: readonly Step[],
): { documents: CatalogDocument[]; changed: CatalogDocument[] } {
  const list = [...documents]
  const changed = new Set<CatalogDocument>()
  const fresh = (text: string) => {
    const d = parseCatalogDocument(text)
    changed.add(d)
    return d
  }
  for (const s of steps) {
    const i = (n: number) => n % Math.max(list.length, 1)
    if (s.kind === "add")
      list.splice(s.at % (list.length + 1), 0, fresh(s.text))
    if (list.length === 0) continue
    if (s.kind === "write") list[i(s.at)] = fresh(s.text)
    if (s.kind === "remove") list.splice(i(s.at), 1)
    if (s.kind === "copy")
      list.push(fresh((list[i(s.at)] as CatalogDocument).text))
    if (s.kind === "reread")
      list[i(s.at)] = fresh((list[i(s.at)] as CatalogDocument).text)
    if (s.kind === "move") {
      const [d] = list.splice(i(s.from), 1)
      list.splice(s.to % (list.length + 1), 0, d as CatalogDocument)
    }
  }
  return { documents: list, changed: list.filter((d) => changed.has(d)) }
}

/** Everything a validation holds, comparable with `toEqual`. */
function inside(v: CatalogValidation, catalog: Catalog) {
  const index = new Map(catalog.documents.map((d, i) => [d, i]))
  return {
    entries: [...v.entries].map(([d, e]) => [
      index.get(d),
      e.problems,
      e.secrets,
      [...e.references].sort(),
      e.future,
    ]),
    referrers: [...v.referrers]
      .map(([n, set]) => [n, [...set].map((d) => index.get(d)).sort()] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
  }
}

const runs = (numRuns: number): fc.Parameters<unknown> => ({
  numRuns: Number(process.env.FC_RUNS ?? numRuns),
  verbose: 1,
  ...(process.env.FC_SEED ? { seed: Number(process.env.FC_SEED) } : {}),
})
const timeout = (numRuns: number) =>
  Math.max(120_000, Number(process.env.FC_RUNS ?? numRuns) * 100)

describe("incremental validation agrees with full validation", () => {
  it(
    "on random catalogs and random changes",
    () => {
      fc.assert(
        fc.property(
          fc.array(document, { minLength: 1, maxLength: 14 }),
          fc.array(round, { minLength: 1, maxLength: 5 }),
          (texts, rounds) => {
            let catalog = readCatalog(texts)
            let context: ValidationContext = { now }
            let latest: CatalogValidation | undefined
            let older: CatalogValidation | undefined
            for (const r of rounds) {
              const next = apply(catalog.documents, r.steps)
              const after = readCatalog(next.documents)
              context = {
                now: now + r.days * day,
                ...(r.members === null
                  ? context.memberHandles
                    ? { memberHandles: context.memberHandles }
                    : {}
                  : r.members
                    ? { memberHandles: r.members }
                    : {}),
              }
              const change: Change = {
                before: catalog,
                after,
                changed: next.changed,
                ...(r.explanation
                  ? {
                      texts: [
                        { label: "The explanation", text: r.explanation },
                      ],
                    }
                  : {}),
              }
              const expected = validateChangeFully(change, context)
              expect(validateChange(change, context)).toEqual(expected)
              const base =
                r.base === "latest"
                  ? latest
                  : r.base === "older"
                    ? older
                    : undefined
              const incremental = validateChangeIncrementally(
                change,
                context,
                base,
              )
              expect(incremental.result).toEqual(expected)
              expect(validateChange(change, context, base)).toEqual(expected)
              expect(inside(incremental.after, after)).toEqual(
                inside(prepareCatalogValidation(after, context), after),
              )
              older = latest
              latest = incremental.after
              catalog = after
            }
          },
        ),
        runs(300),
      )
    },
    timeout(300),
  )

  it(
    "updates a validation from any other revision's",
    () => {
      fc.assert(
        fc.property(
          fc.array(document, { minLength: 0, maxLength: 12 }),
          fc.array(step, { minLength: 1, maxLength: 6 }),
          fc.constantFrom(0, 0, 1, 15, -1),
          members,
          members,
          (texts, steps, days, was, is) => {
            const before = readCatalog(texts)
            const after = readCatalog(apply(before.documents, steps).documents)
            const context: ValidationContext = {
              now: now + days * day,
              ...(is ? { memberHandles: is } : {}),
            }
            const base = prepareCatalogValidation(before, {
              now,
              ...(was ? { memberHandles: was } : {}),
            })
            expect(
              inside(updateCatalogValidation(base, after, context), after),
            ).toEqual(inside(prepareCatalogValidation(after, context), after))
          },
        ),
        runs(300),
      )
    },
    timeout(300),
  )
})

describe("a validation kept for a revision", () => {
  const text = (id: string, owner = "person/ana") => `---
id: ${id}
type: ${id.split("/")[0]}
title: ${id}
summary: An entity for tests.
status: active
owner: ${owner}
---

# ${id}
`
  const context = { now }

  it("is reused as is for the same documents", () => {
    const catalog = readCatalog([text("person/ana"), text("machine/m1")])
    const base = prepareCatalogValidation(catalog, context)
    expect(
      updateCatalogValidation(base, readCatalog(catalog.documents), context),
    ).toBe(base)
  })

  it("validates again only what a change can affect", () => {
    const documents = [
      text("person/ana"),
      text("machine/m1"),
      text("machine/m2", "person/ben"),
      text("person/ben"),
    ].map(parseCatalogDocument)
    const before = readCatalog(documents)
    const base = prepareCatalogValidation(before, context)
    const ben = parseCatalogDocument(
      text("person/ben").replace("title: person/ben", "title: Ben"),
    )
    const after = readCatalog([...documents.slice(0, 3), ben])
    const updated = updateCatalogValidation(base, after, context)
    // Ana and Musashi are untouched; m2 names Ben as its owner.
    for (const d of documents.slice(0, 2))
      expect(updated.entries.get(d)).toBe(base.entries.get(d))
    expect(updated.entries.get(documents[2] as CatalogDocument)).not.toBe(
      base.entries.get(documents[2] as CatalogDocument),
    )
  })

  it("validates again what references an entity whose type schema changed", () => {
    const widget = (key: string) => `---
id: schema/widget
title: Widget
summary: A type for tests.
status: active
owner: person/ana
keys:
  ${key}
---
`
    const documents = [
      text("person/ana"),
      widget("size: {}"),
      `---
id: widget/w1
type: widget
title: W1
summary: An entity for tests.
status: active
owner: person/ana
facts:
${group("2026-11-14", "observed", ["size: 3"])}${group("2026-11-14", "intended", ["size: 4"])}---
`,
      startHereText(["widget/w1"]),
    ].map(parseCatalogDocument)
    const before = readCatalog(documents)
    const base = prepareCatalogValidation(before, context)
    expect([...base.problems()].map((p) => p.code)).toContain(
      "start-here-discrepancy",
    )
    // Many-valued, the two sizes no longer disagree.
    const after = readCatalog([
      documents[0] as CatalogDocument,
      parseCatalogDocument(widget("size: { many: true }")),
      ...documents.slice(2),
    ])
    expect(
      inside(updateCatalogValidation(base, after, context), after),
    ).toEqual(inside(prepareCatalogValidation(after, context), after))
  })

  it("starts over for other member handles or an earlier time", () => {
    const catalog = readCatalog([text("person/ana")])
    const base = prepareCatalogValidation(catalog, context)
    const document = catalog.documents[0] as CatalogDocument
    for (const other of [
      { now, memberHandles: new Set(["ana"]) },
      { now: now - day },
    ])
      expect(
        updateCatalogValidation(base, catalog, other).entries.get(document),
      ).not.toBe(base.entries.get(document))
  })
})
