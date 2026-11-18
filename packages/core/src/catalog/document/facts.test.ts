import { describe, expect, it } from "vitest"

import {
  dockyard,
  domainSchema,
  guneetDev,
  musashi,
  noReadFailure,
} from "../../../test/catalog-documents.js"
import {
  discrepancies,
  freshness,
  knownUnknowns,
  notYetRecorded,
} from "./analysis.js"
import { readCatalog } from "./catalog.js"
import { factsWithIdentity, resolveEntity } from "./entity.js"
import {
  factIdentityKey,
  identityWithoutState,
  parseFactIdentityKey,
} from "./identity.js"
import { parseCatalogDocument as readDocument } from "./parse.js"
import { buildTypeRegistry, builtInSchemas } from "./schemas.js"

/** Reads a document, failing the test on an unexpected read failure. */
const parseCatalogDocument = (text: string) => noReadFailure(readDocument(text))

const builtIns = buildTypeRegistry([])

/** Resolves an entity; frontmatter left open by the helpers below is closed. */
function resolve(written: string, schemas: string[] = []) {
  const text =
    (written.match(/^---$/gm) ?? []).length < 2 ? `${written}---\n` : written
  const catalog = readCatalog([...schemas, text])
  for (const d of catalog.documents) noReadFailure(d)
  const id = parseCatalogDocument(text).id
  const entity = catalog.entities.get(id ?? "")
  if (!entity) throw new Error("expected an entity")
  return entity
}

const header = `---
id: machine/x
type: machine
title: X
summary: A machine.
status: active
owner: person/guneet
facts:
`
const check = (date = "2026-11-14") =>
  `  - checked: ${date}\n    by: guneet\n    scope: s\n    source: s\n`

describe("fact identity keys (catalog §4.2)", () => {
  it("names Dockyard's facts", () => {
    expect(resolve(dockyard).facts.map((f) => f.identity)).toEqual([
      "repository|observed|value=https://github.com/guneet-xyz/dockyard",
      "docs.agent_instructions|observed",
      "release.latest|observed",
      "checkout-on|observed|to=machine/daedalus|path=/root/dockyard",
      "checkout-on|observed|to=machine/musashi|path=/mnt/musashi/stacks/dockyard",
      "checkout-on|observed|to=machine/musashi|path=/mnt/musashi/stacks/dockyard/dockyard",
      "provides|observed|to=service/container-registry",
    ])
  })

  it("adds via to single-valued keys, so two means of observation are two facts", () => {
    const keys = resolve(musashi).facts.map((f) => f.identity)
    expect(keys).toContain("disk.data.size|observed|via=filesystem")
    expect(keys).toContain("disk.data.size|observed|via=instance-metadata")
    expect(keys).toContain("network.public_ipv6|unknown")
  })

  it("includes the state, so intended and observed facts, and planned removals, sit side by side", () => {
    const e = resolve(
      `${header}${check()}    intended:\n      role: web\n      environment: production\n    observed:\n      role: web\n  - planned:\n      role: { value: web, task: T-1, remove: true }\n`,
    )
    expect(e.problems).toEqual([])
    expect(e.facts.map((f) => f.identity)).toEqual([
      "role|intended",
      "environment|intended",
      "role|observed",
      "role|planned",
    ])
  })

  it("uses the schema's identifying attributes and ignores the others", () => {
    const e = resolve(
      `${header}${check()}    observed:\n      secrets-in:\n        - to: service/obscuro\n          item: musashi/dockyard/registry-admin\n          note: Registry admin password\n`,
    )
    expect(e.facts[0]?.identity).toBe(
      "secrets-in|observed|to=service/obscuro|item=musashi/dockyard/registry-admin",
    )
  })

  it("treats a single-valued relation like a single-valued key", () => {
    const e = resolve(
      `---\nid: agent/guneet-opencode-daedalus\ntype: agent\ntitle: A\nsummary: S.\nstatus: active\nowner: person/guneet\nfacts:\n${check()}    observed:\n      on-machine: machine/daedalus\n`,
    )
    expect(e.facts[0]).toMatchObject({
      identity: "on-machine|observed",
      to: "machine/daedalus",
      value: undefined,
    })
  })

  it("escapes separators and reads keys back", () => {
    const identity = factIdentityKey({
      key: "endpoint",
      state: "observed",
      many: true,
      relation: null,
      value: "a|b=c%d\ne",
      to: undefined,
      via: undefined,
      attributes: {},
    })
    expect(identity).toBe("endpoint|observed|value=a%7Cb=c%25d%0Ae")
    expect(parseFactIdentityKey(identity)).toEqual({
      key: "endpoint",
      state: "observed",
      parts: [{ name: "value", value: "a|b=c%d\ne" }],
    })
    expect(parseFactIdentityKey("endpoint|seen")).toBeNull()
    expect(parseFactIdentityKey("endpoint|observed|novalue")).toBeNull()
  })

  it("finds facts by identity key", () => {
    const e = resolve(musashi)
    expect(
      factsWithIdentity(e, "disk.data.size|observed|via=filesystem").map(
        (f) => f.value,
      ),
    ).toEqual(["128 GiB"])
  })
})

describe("applying type schemas", () => {
  it("reads short-form relations as targets", () => {
    const provides = resolve(dockyard).facts.at(-1)
    expect(provides).toMatchObject({
      to: "service/container-registry",
      value: undefined,
      schema: { many: true, relation: { inverse: "provided by" } },
    })
  })

  it("treats keys outside the schema as single-valued values", () => {
    const e = resolve(`${header}${check()}    observed:\n      ups.model: X1\n`)
    expect(e.facts[0]).toMatchObject({
      identity: "ups.model|observed",
      schema: { inSchema: false, many: false, relation: null },
    })
  })

  it.each<[string, string, string]>([
    ["a list for a single-valued key", "role: [a, b]", "cardinality"],
    ["a list for a key outside the schema", "ups.model: [a, b]", "cardinality"],
    [
      "a value on a relation",
      "configured-by: { value: project/y }",
      "fact-invalid",
    ],
    ["a relation target that is not text", "configured-by: 12", "fact-invalid"],
    ["`to` on a plain key", "role: { to: machine/y }", "fact-invalid"],
    [
      "attributes on a plain key",
      "role: { value: web, path: /x }",
      "fact-invalid",
    ],
  ])("blocks %s", (_, fact, code) => {
    const e = resolve(`${header}${check()}    observed:\n      ${fact}\n`)
    expect(e.problems.map((p) => p.code)).toContain(code)
  })

  it("reports a list on a single-valued key once", () => {
    const e = resolve(
      `${header}${check()}    observed:\n      role: [a, b, c]\n`,
    )
    expect(e.problems).toHaveLength(1)
  })

  it("applies a custom type's schema document", () => {
    const e = resolve(guneetDev, [domainSchema])
    expect(e.problems).toEqual([])
    expect(e.schema?.type).toBe("domain")
    expect(e.facts.map((f) => [f.identity, f.schema.recheckDays])).toEqual([
      ["registrar|observed", null],
      ["nameservers|observed|value=ada.ns.cloudflare.com", 90],
      ["nameservers|observed|value=bob.ns.cloudflare.com", 90],
      ["served-by|observed|to=service/cloudflare-dns", null],
      ["expires_on|planned", 30],
    ])
  })

  it("leaves the schema null for an unknown type", () => {
    const e = resolveEntity(
      parseCatalogDocument(guneetDev) as Parameters<typeof resolveEntity>[0],
      builtIns,
    )
    expect(e.schema).toBeNull()
    expect(e.facts.every((f) => !f.schema.inSchema)).toBe(true)
  })
})

describe("discrepancies (catalog §4.7)", () => {
  it("finds Musashi's two disk sizes", () => {
    const found = discrepancies(resolve(musashi))
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      key: "disk.data.size",
      values: ["128 GiB", "64 GB"],
      accepted: false,
    })
  })

  it("never finds one between values of a multi-valued key", () => {
    expect(discrepancies(resolve(dockyard))).toEqual([])
  })

  it.each([
    [
      "intended and observed differ",
      "    intended:\n      role: web\n    observed:\n      role: db\n",
      1,
    ],
    [
      "intended and observed agree",
      "    intended:\n      role: web\n    observed:\n      role: web\n",
      0,
    ],
    [
      "unknown beside observed",
      "    observed:\n      role: web\n    unknown:\n      role: Not sure\n",
      0,
    ],
    [
      "two values of a key outside the schema",
      "    intended:\n      ups.model: A\n    observed:\n      ups.model: B\n",
      1,
    ],
  ])("%s", (_, facts, count) => {
    expect(discrepancies(resolve(`${header}${check()}${facts}`))).toHaveLength(
      count,
    )
  })

  it("finds one between two targets of a single-valued relation", () => {
    const e = resolve(
      `---\nid: agent/a\ntype: agent\ntitle: A\nsummary: S.\nstatus: active\nowner: person/guneet\nfacts:\n${check()}    intended:\n      on-machine: machine/a\n    observed:\n      on-machine: machine/b\n`,
    )
    expect(discrepancies(e)[0]?.values).toEqual(["machine/a", "machine/b"])
  })

  it("does not count a plan as a discrepancy", () => {
    const e = resolve(
      `${header}${check()}    observed:\n      role: web\n  - planned:\n      role: { value: db, task: T-1 }\n`,
    )
    expect(discrepancies(e)).toEqual([])
  })

  it("is accepted only when every fact in it names who accepted it", () => {
    const one = `${header}${check()}    intended:\n      role: { value: web, accepted: person/guneet, note: Moving later }\n    observed:\n      role: db\n`
    expect(discrepancies(resolve(one))[0]?.accepted).toBe(false)
    const both = one.replace(
      "role: db",
      "role: { value: db, accepted: person/guneet, note: Known }",
    )
    expect(discrepancies(resolve(both))[0]?.accepted).toBe(true)
  })
})

describe("unknowns (catalog §4.8)", () => {
  it("lists known unknowns apart from keys not yet recorded", () => {
    const e = resolve(musashi)
    expect(knownUnknowns(e).map((f) => f.key)).toEqual([
      "network.public_ipv6",
      "recovery.tested",
    ])
    expect(notYetRecorded(e)).toEqual({
      missingKeys: ["role", "environment", "access.method"],
      notChecked: [],
    })
  })

  it("counts a key written as unknown as recorded, and lists checked: null", () => {
    const e = resolve(
      `${header}  - checked: null\n    by: unknown\n    scope: Imported\n    source: x\n    observed:\n      role: web\n  - unknown:\n      environment: Not checked\n`,
    )
    const result = notYetRecorded(e)
    expect(result.missingKeys).toEqual(["access.method"])
    expect(result.notChecked.map((f) => f.key)).toEqual(["role"])
  })
})

describe("freshness (catalog §4.6)", () => {
  const e = resolve(
    `${header}${check("2026-11-01")}    observed:\n      disk.data.free: 10 GiB\n      platform.arch: aarch64\n  - checked: 2026-11-10T12:00+02:00\n    by: guneet\n    scope: s\n    source: s\n    observed:\n      role: web\n  - planned:\n      environment: { value: production, task: T-1 }\n  - unknown:\n      access.method: Never looked\n`,
  )
  const fact = (key: string) => e.facts.find((f) => f.key === key)!
  const now = Date.UTC(2026, 10, 9, 0, 0)

  it("marks a fact due once its key's interval has passed", () => {
    expect(freshness(fact("disk.data.free"), now)).toEqual({
      status: "due",
      checkedAt: Date.UTC(2026, 10, 1),
      ageDays: 8,
      recheckDays: 7,
      dueAt: Date.UTC(2026, 10, 8),
    })
    expect(
      freshness(fact("disk.data.free"), Date.UTC(2026, 10, 7, 23)).status,
    ).toBe("fresh")
  })

  it("never marks a key without an interval due, but shows its age", () => {
    expect(
      freshness(fact("platform.arch"), Date.UTC(2030, 0, 1)),
    ).toMatchObject({
      status: "fresh",
      ageDays: 1157,
      recheckDays: null,
      dueAt: null,
    })
  })

  it("reads a date and time with its offset", () => {
    expect(
      freshness(fact("role"), new Date(Date.UTC(2026, 10, 11, 10))),
    ).toMatchObject({
      checkedAt: Date.UTC(2026, 10, 10, 10),
      ageDays: 1,
      status: "fresh",
    })
  })

  it("gives planned facts no freshness and unchecked facts none either", () => {
    expect(freshness(fact("environment"), now).status).toBe("none")
    expect(freshness(fact("access.method"), now).status).toBe("not-checked")
  })
})

describe("type registry (catalog §3, §3.9)", () => {
  it("has the eight built-in types with their relations", () => {
    expect([...builtInSchemas.keys()]).toEqual([
      "project",
      "machine",
      "service",
      "runbook",
      "decision",
      "policy",
      "person",
      "agent",
    ])
    const relations = [...builtInSchemas.values()].flatMap((t) =>
      [...t.keys.values()]
        .filter((k) => k.relation)
        .map((k) => `${t.type}.${k.key}${k.many ? "" : " (one)"}`),
    )
    expect(relations).toEqual([
      "project.checkout-on",
      "project.provides",
      "project.depends-on",
      "project.secrets-in",
      "machine.configured-by",
      "machine.on-network",
      "machine.secrets-in",
      "service.runs-on",
      "service.configured-by",
      "service.depends-on",
      "service.secrets-in",
      "runbook.applies-to",
      "decision.supersedes",
      "decision.applies-to",
      "decision.from-task",
      "policy.applies-to",
      "policy.see-also",
      "agent.on-machine (one)",
    ])
  })

  it("names a recheck interval or none for every built-in key", () => {
    for (const type of builtInSchemas.values())
      for (const key of type.keys.values())
        expect(key.recheckDays === null || key.recheckDays > 0).toBe(true)
  })

  const schemaDoc = (id: string, keys: string, extra = "") =>
    parseCatalogDocument(
      `---\nid: ${id}\ntitle: T\nsummary: S.\nstatus: active\nowner: person/guneet\nkeys:\n${keys}${extra}---\n`,
    ) as Parameters<typeof buildTypeRegistry>[0][number]

  it("extends a built-in type with new keys, sections and required keys", () => {
    const registry = buildTypeRegistry([
      schemaDoc(
        "schema/machine",
        "  ups.model: { recheck: 365d }\n",
        "required: [ups.model]\nsections: [Power]\n",
      ),
    ])
    expect(registry.problems).toEqual([])
    const machine = registry.types.get("machine")!
    expect(machine).toMatchObject({
      builtIn: true,
      extended: true,
      documentId: "schema/machine",
    })
    expect(machine.keys.get("ups.model")).toMatchObject({
      recheckDays: 365,
      builtIn: false,
      inSchema: true,
    })
    expect(machine.keys.get("role")?.builtIn).toBe(true)
    expect(machine.required).toContain("ups.model")
    expect(machine.sections.at(-1)).toBe("Power")
  })

  it("refuses to change a built-in key", () => {
    const registry = buildTypeRegistry([
      schemaDoc("schema/machine", "  role: { many: true }\n"),
    ])
    expect(registry.problems.map((p) => p.code)).toEqual(["schema-invalid"])
    expect(registry.types.get("machine")?.keys.get("role")?.many).toBe(false)
  })

  it.each([
    ["a reserved type name", "schema/workspace", "  a: {}\n", ""],
    [
      "a relation to a type that does not exist",
      "schema/domain",
      "  a: { relation: [zone] }\n",
      "",
    ],
    [
      "a required key the type does not have",
      "schema/domain",
      "  a: {}\n",
      "required: [b]\n",
    ],
    [
      "an identifying attribute named like a fact option",
      "schema/domain",
      "  a: { relation: [service], identified_by: [note] }\n",
      "",
    ],
    [
      "an identifying attribute named like a fact check's field",
      "schema/domain",
      "  a: { relation: [service], identified_by: [checked] }\n",
      "",
    ],
  ])("refuses %s", (_, id, keys, extra) => {
    expect(
      buildTypeRegistry([schemaDoc(id, keys, extra)]).problems.map(
        (p) => p.code,
      ),
    ).toEqual(["schema-invalid"])
  })

  it.each([
    ["note", "a field of a fact's long form"],
    ["checked", "a field of a fact check"],
    ["Bad Name", "lowercase words"],
  ])("says why %s cannot identify a relation", (name, reason) => {
    const [problem] = buildTypeRegistry([
      schemaDoc(
        "schema/domain",
        `  a: { relation: [service], identified_by: ["${name}"] }\n`,
        "",
      ),
    ]).problems
    expect(problem?.message).toContain(`identified_by of "a"`)
    expect(problem?.message).toContain(reason)
  })

  it("lets custom types point at each other, and makes relations multi-valued by default", () => {
    const registry = buildTypeRegistry([
      schemaDoc("schema/domain", "  zone: { relation: [zone] }\n"),
      schemaDoc(
        "schema/zone",
        "  domain: { relation: [domain], many: false }\n",
      ),
    ])
    expect(registry.problems).toEqual([])
    expect(registry.types.get("domain")?.keys.get("zone")?.many).toBe(true)
    expect(registry.types.get("zone")?.keys.get("domain")?.many).toBe(false)
  })

  it("keeps a retired custom type, and ignores a retired extension", () => {
    const retired = (id: string, keys: string) =>
      parseCatalogDocument(
        schemaDoc(id, keys).text.replace("status: active", "status: retired"),
      ) as Parameters<typeof buildTypeRegistry>[0][number]
    const registry = buildTypeRegistry([
      retired("schema/domain", "  a: {}\n"),
      retired("schema/machine", "  ups.model: {}\n"),
    ])
    expect(registry.types.get("domain")?.status).toBe("retired")
    expect(registry.types.get("machine")?.keys.has("ups.model")).toBe(false)
  })
})

describe("facts and their checks", () => {
  it("resolves each fact's check by its group, not by list position", () => {
    const e = resolve(
      `${header}  - oops\n${check()}    observed:\n      role: web\n  - unknown:\n      hostname: Not looked\n`,
    )
    expect(e.facts.map((f) => [f.key, f.check?.by ?? null])).toEqual([
      ["role", "guneet"],
      ["hostname", null],
    ])
  })

  it("links facts that differ only in state", () => {
    const e = resolve(
      `${header}${check()}    observed:\n      on-network: service/tailscale\n  - planned:\n      on-network: { to: service/tailscale, task: T-1, remove: true }\n`,
    )
    const [observed, planned] = e.facts
    expect(identityWithoutState(observed!.identity)).toBe(
      identityWithoutState(planned!.identity),
    )
    expect(identityWithoutState(observed!.identity)).toBe(
      "on-network|to=service/tailscale",
    )
    expect(identityWithoutState("weird")).toBeNull()
  })

  it("refuses an identifying attribute named like an object member", () => {
    const registry = buildTypeRegistry([
      parseCatalogDocument(
        "---\nid: schema/zone\ntitle: Z\nsummary: Z.\nstatus: active\nowner: person/guneet\nkeys:\n  linked-to: { relation: [machine], identified_by: [constructor] }\n---\n",
      ) as Parameters<typeof buildTypeRegistry>[0][number],
    ])
    expect(registry.problems.map((p) => p.code)).toEqual(["schema-invalid"])
  })
})
