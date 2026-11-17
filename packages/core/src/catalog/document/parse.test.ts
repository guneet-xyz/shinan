import { describe, expect, it } from "vitest"

import {
  dockyard,
  domainSchema,
  musashi,
  startHere,
} from "../../../test/catalog-documents.js"
import { parseCatalogDocument } from "./parse.js"
import type { ProblemCode } from "./problems.js"
import { slice } from "./source.js"

function entity(text: string) {
  const document = parseCatalogDocument(text)
  if (document.kind !== "entity") throw new Error("expected an entity")
  return document
}

const header = `id: machine/x
type: machine
title: X
summary: A machine.
status: active
owner: person/guneet
`

function withFrontmatter(yaml: string, body = "\n# X\n") {
  return `---\n${yaml}---\n${body}`
}

function codes(text: string): ProblemCode[] {
  return parseCatalogDocument(text).problems.map((p) => p.code)
}

describe("catalog document examples", () => {
  it("reads Dockyard (catalog §2.6)", () => {
    const d = entity(dockyard)
    expect(d.problems).toEqual([])
    expect(d).toMatchObject({
      id: "project/dockyard",
      type: "project",
      title: "Dockyard",
      status: "active",
      owner: "person/guneet",
      aliases: [],
      importedFrom: null,
    })
    expect(d.groups).toHaveLength(2)
    expect(d.groups[0]?.check).toMatchObject({
      checked: { text: "2026-11-14", dateOnly: true },
      by: "guneet via opencode-daedalus",
      limits: undefined,
    })
    expect(d.groups[1]?.check?.limits).toContain("submodule")
    expect(d.facts.map((f) => [f.key, f.item, f.form])).toEqual([
      ["repository", null, "short"],
      ["docs.agent_instructions", null, "short"],
      ["release.latest", null, "short"],
      ["checkout-on", 0, "long"],
      ["checkout-on", 1, "long"],
      ["checkout-on", 2, "long"],
      ["provides", null, "short"],
    ])
    expect(d.facts[3]).toMatchObject({
      to: "machine/daedalus",
      attributes: { path: "/root/dockyard" },
    })
  })

  it("reads the Musashi excerpt, with long forms, comments and unknowns", () => {
    const d = entity(musashi)
    expect(d.problems).toEqual([])
    const sizes = d.facts.filter((f) => f.key === "disk.data.size")
    expect(sizes.map((f) => [f.value, f.via, f.note])).toEqual([
      ["128 GiB", "filesystem", undefined],
      ["64 GB", "instance-metadata", "Metadata lags after a resize"],
    ])
    const unknown = d.facts.filter((f) => f.state === "unknown")
    expect(unknown.map((f) => [f.key, f.value, f.note])).toEqual([
      ["network.public_ipv6", undefined, "Reachability not tested"],
      ["recovery.tested", undefined, "The rebuild runbook has not been run"],
    ])
    expect(d.groups[3]?.check).toBeNull()
  })

  it("reads the domain type schema document (catalog §3.9)", () => {
    const d = parseCatalogDocument(domainSchema)
    expect(d.problems).toEqual([])
    if (d.kind !== "schema") throw new Error("expected a schema")
    expect(d.describes).toBe("domain")
    expect(d.required).toEqual(["registrar", "served-by"])
    expect(d.sections).toEqual(["Role", "Cautions"])
    expect(
      d.keys.map((k) => [k.key, k.many, k.relation, k.inverse, k.recheck]),
    ).toEqual([
      ["registrar", undefined, undefined, undefined, undefined],
      ["expires_on", undefined, undefined, undefined, "30d"],
      ["nameservers", true, undefined, undefined, "90d"],
      ["served-by", true, ["service"], "domains", undefined],
      ["configured-by", undefined, ["project"], "domains", undefined],
    ])
  })

  it("reads the start-here document (catalog §11)", () => {
    const d = parseCatalogDocument(startHere)
    expect(d.problems).toEqual([])
    if (d.kind !== "start-here") throw new Error("expected start here")
    expect(d.people.map((s) => s.target)).toEqual([
      { kind: "entity", id: "project/dockyard" },
      { kind: "list", list: "discrepancies" },
    ])
    expect(d.agents.map((s) => s.target.kind)).toEqual(["url", "entity"])
    expect(d.agents[1]?.note).toBe(
      "Production host; read its cautions before any change.",
    )
  })
})

describe("source ranges", () => {
  for (const [name, text] of Object.entries({ dockyard, musashi })) {
    it(`point at the written text in ${name}`, () => {
      const d = entity(text)
      expect(d.text).toBe(text)
      for (const fact of d.facts) {
        expect(slice(text, fact.keyRange)).toBe(fact.key)
        expect(text.slice(fact.range.start, fact.range.end)).toContain(
          fact.form === "short" ? String(fact.value ?? fact.note) : "",
        )
        if (fact.form === "short")
          expect(slice(text, fact.valueRange)).toBe(
            String(fact.value ?? fact.note),
          )
      }
      for (const [name, entry] of d.fields) {
        expect(slice(text, entry.keyRange)).toBe(name)
      }
      const fm = d.frontmatter
      if (!fm) throw new Error("expected frontmatter")
      expect(text.slice(0, fm.start)).toBe("---\n")
      expect(text.slice(fm.end, d.body.range.start)).toBe("---\n")
      expect(text.slice(d.body.range.start)).toBe(d.body.text)
      expect(d.body.sections.map((s) => s.text).join("")).toBe(d.body.text)
    })
  }

  it("covers each fact check field and group", () => {
    const d = entity(musashi)
    const group = d.groups[1]
    if (!group?.check) throw new Error("expected a check")
    expect(slice(musashi, group.check.entries.checked!.value.range)).toBe(
      "2026-11-14",
    )
    expect(slice(musashi, group.range)).toMatch(/^checked: 2026-11-14\n/)
    expect(slice(musashi, group.range)).toMatch(/disk\.data\.free: 74 GiB$/)
    const longForm = d.facts.find((f) => f.via === "instance-metadata")
    expect(slice(musashi, longForm!.valueRange)).toBe(
      "value: 64 GB\n        via: instance-metadata\n        note: Metadata lags after a resize",
    )
  })

  it("keeps line breaks written as CRLF", () => {
    const text = dockyard.replace(/\n/g, "\r\n")
    const d = entity(text)
    expect(d.problems).toEqual([])
    expect(d.facts).toHaveLength(7)
    expect(slice(text, d.facts[0]!.valueRange)).toBe(
      "https://github.com/guneet-xyz/dockyard",
    )
    expect(d.body.sections.map((s) => s.text).join("")).toBe(d.body.text)
  })

  it("counts offsets in UTF-16 code units, as JavaScript strings do", () => {
    const text = withFrontmatter(
      `${header}facts:\n  - unknown:\n      role: Not checked 🙂 yet\n`,
      "\nIntro 🙂\n\n## Über 🙂\n\nSee [M](machine/musashi).\n",
    )
    const d = entity(text)
    expect(d.problems).toEqual([])
    expect(slice(text, d.facts[0]!.valueRange)).toBe("Not checked 🙂 yet")
    expect(slice(text, d.body.links[0]!.range)).toBe("[M](machine/musashi)")
    expect(d.body.sections[1]?.anchor).toBe("über-")
  })
})

describe("the YAML subset (catalog §2.1)", () => {
  it.each([
    ["anchors", "role: &r web\nhostname: x\n"],
    ["aliases", "role: &r web\nhostname: *r\n"],
    ["tags", "role: !!str web\n"],
    ["custom tags", "role: !thing web\n"],
    ["duplicate keys", "title: Again\n"],
    ["directives", "%YAML 1.2\n"],
    ["document end markers", "...\n"],
    ["keys that are not text", "? [a, b]\n: c\n"],
    ["number keys", "1: one\n"],
    ["infinite numbers", "extra: .inf\n"],
    ["broken YAML", "title: [unclosed\n"],
  ])("refuses %s", (_, yaml) => {
    const text = yaml.startsWith("%")
      ? withFrontmatter(yaml + header)
      : withFrontmatter(header + yaml)
    expect(codes(text)).toContain("frontmatter-invalid")
  })

  it("keeps `no`, `on` and dates as text (YAML 1.2 core schema)", () => {
    const d = entity(
      withFrontmatter(
        `${header}facts:\n  - checked: 2026-11-14\n    by: guneet\n    scope: s\n    source: s\n    observed:\n      role: no\n      environment: on\n      hostname: 2026-11-14\n      disk.root.size: 12\n      access.method: true\n`,
      ),
    )
    expect(d.problems).toEqual([])
    expect(d.facts.map((f) => f.value)).toEqual([
      "no",
      "on",
      "2026-11-14",
      12,
      true,
    ])
  })

  it("needs frontmatter between --- lines", () => {
    expect(codes("# Just a body\n")).toEqual(["frontmatter-invalid"])
    expect(codes(`---\n${header}`)).toContain("frontmatter-invalid")
    expect(codes(`---\n- a\n- b\n---\n`)).toContain("frontmatter-invalid")
  })

  it("reads an empty body", () => {
    const d = entity(`---\n${header}---\n`)
    expect(d.problems).toEqual([])
    expect(d.body.text).toBe("")
    expect(d.body.sections).toEqual([
      expect.objectContaining({ heading: null, text: "" }),
    ])
  })
})

describe("entity fields (catalog §2.3)", () => {
  it.each<[string, string, ProblemCode]>([
    ["a missing title", header.replace("title: X\n", ""), "field-missing"],
    [
      "a missing owner",
      header.replace("owner: person/guneet\n", ""),
      "field-missing",
    ],
    ["an unknown status", header.replace("active", "gone"), "field-invalid"],
    [
      "an owner that is not an ID",
      header.replace("person/guneet", "guneet"),
      "field-invalid",
    ],
    [
      "an ID of another type",
      header.replace("machine/x", "service/x"),
      "field-invalid",
    ],
    [
      "an ID that is not kebab-case",
      header.replace("machine/x", "machine/X_1"),
      "field-invalid",
    ],
    ["an unknown field", `${header}colour: blue\n`, "field-invalid"],
    [
      "a decision field on a machine",
      `${header}decision_state: accepted\n`,
      "field-invalid",
    ],
    ["aliases that are not a list", `${header}aliases: x\n`, "field-invalid"],
    [
      "a title that is not text",
      header.replace("title: X", "title: 12"),
      "field-invalid",
    ],
  ])("blocks %s", (_, yaml, code) => {
    expect(codes(withFrontmatter(yaml))).toContain(code)
  })

  it("accepts `owner: unknown`, aliases, replaced_by and imported_from", () => {
    const d = entity(
      withFrontmatter(
        header
          .replace("person/guneet", "unknown")
          .replace("active", "retired") +
          "replaced_by: machine/y\naliases: [x, musashi]\nimported_from: catalog/machines/x.md@86bba32\n",
      ),
    )
    expect(d.problems).toEqual([])
    expect(d).toMatchObject({
      owner: "unknown",
      status: "retired",
      replacedBy: "machine/y",
      aliases: ["x", "musashi"],
      importedFrom: "catalog/machines/x.md@86bba32",
    })
  })

  it("reads a decision's own fields", () => {
    const d = entity(
      withFrontmatter(
        "id: decision/release-versioning\ntype: decision\ntitle: Release versioning\nsummary: How releases are versioned.\nstatus: active\nowner: person/guneet\ndecision_state: accepted\ndecided_on: 2026-11-01\ndecided_by: person/guneet\n",
      ),
    )
    expect(d.problems).toEqual([])
    expect(d.decision).toMatchObject({
      state: "accepted",
      decidedOn: { text: "2026-11-01" },
      decidedBy: "person/guneet",
    })
    expect(
      codes(
        withFrontmatter(
          "id: decision/x\ntype: decision\ntitle: X\nsummary: X.\nstatus: active\nowner: person/guneet\ndecision_state: maybe\ndecided_on: 2026-02-30\n",
        ),
      ),
    ).toEqual(["field-invalid", "date-invalid"])
  })
})

describe("facts (catalog §4.3)", () => {
  const check =
    "  - checked: 2026-11-14\n    by: guneet\n    scope: s\n    source: s\n"

  it.each<[string, string, ProblemCode]>([
    ["facts that are not a list", "facts: { a: 1 }\n", "facts-invalid"],
    ["a group that is not a map", "facts:\n  - just text\n", "facts-invalid"],
    ["a group with no facts", `facts:\n${check}`, "facts-invalid"],
    [
      "an unknown group field",
      `facts:\n${check}    seen: true\n    observed:\n      role: web\n`,
      "facts-invalid",
    ],
    [
      "a state that is not a map",
      `facts:\n${check}    observed: web\n`,
      "facts-invalid",
    ],
    [
      "planned facts in a check group",
      `facts:\n${check}    planned:\n      role: { value: web, task: T-1 }\n`,
      "facts-invalid",
    ],
    [
      "a fact check field that is not text",
      `facts:\n  - checked: 2026-11-14\n    by: [a]\n    observed:\n      role: web\n`,
      "facts-invalid",
    ],
    [
      "an invalid check date",
      `facts:\n  - checked: 14/11/2026\n    observed:\n      role: web\n`,
      "date-invalid",
    ],
    [
      "a date and time without a UTC offset",
      `facts:\n  - checked: 2026-11-14T10:00\n    observed:\n      role: web\n`,
      "date-invalid",
    ],
    [
      "a key that is not a fact key",
      `facts:\n${check}    observed:\n      Role: web\n`,
      "fact-invalid",
    ],
    [
      "a fact with no value",
      `facts:\n${check}    observed:\n      role:\n`,
      "fact-invalid",
    ],
    [
      "an empty list",
      `facts:\n${check}    observed:\n      role: []\n`,
      "fact-invalid",
    ],
    [
      "a list in a list",
      `facts:\n${check}    observed:\n      role: [[a]]\n`,
      "fact-invalid",
    ],
    [
      "an unknown fact without a note",
      `facts:\n  - unknown:\n      role: { via: x }\n`,
      "fact-invalid",
    ],
    [
      "an unknown fact with a value",
      `facts:\n  - unknown:\n      role: { value: web, note: n }\n`,
      "fact-invalid",
    ],
    [
      "an unknown fact whose note is not text",
      `facts:\n  - unknown:\n      role: 12\n`,
      "fact-invalid",
    ],
    [
      "a long form without a value",
      `facts:\n${check}    observed:\n      role: { via: x }\n`,
      "fact-invalid",
    ],
    [
      "a removal that is not planned",
      `facts:\n${check}    observed:\n      role: { value: web, remove: true }\n`,
      "fact-invalid",
    ],
    [
      "a `remove` that is not true or false",
      `facts:\n  - planned:\n      role: { value: web, task: T-1, remove: yes }\n`,
      "fact-invalid",
    ],
    [
      "an attribute that is a map",
      `facts:\n${check}    observed:\n      role: { value: web, extra: { a: 1 } }\n`,
      "fact-invalid",
    ],
  ])("blocks %s", (_, yaml, code) => {
    expect(codes(withFrontmatter(header + yaml))).toContain(code)
  })

  it("reads a planned removal, a task and checked: null", () => {
    const d = entity(
      withFrontmatter(
        `${header}imported_from: catalog/machines/x.md@86bba32\nfacts:\n  - checked: null\n    by: unknown\n    scope: Imported\n    source: catalog/machines/x.md@86bba32\n    intended:\n      role: web\n  - planned:\n      role: { value: web, task: T-12, remove: true }\n`,
      ),
    )
    expect(d.problems).toEqual([])
    expect(d.groups[0]?.check?.checked).toBeNull()
    expect(d.facts[1]).toMatchObject({
      state: "planned",
      task: "T-12",
      remove: true,
    })
  })
})

describe("type schema documents (catalog §3.9)", () => {
  const schema = (keys: string, extra = "") =>
    `---\nid: schema/domain\ntitle: Domain\nsummary: S.\nstatus: active\nowner: person/guneet\nkeys:\n${keys}${extra}---\n`

  it.each<[string, string, string]>([
    ["an unknown key option", "  registrar: { colour: red }\n", ""],
    ["`many` that is not true or false", "  registrar: { many: often }\n", ""],
    ["a recheck that is not days", "  registrar: { recheck: 2w }\n", ""],
    [
      "identified_by on a plain key",
      "  registrar: { identified_by: [path] }\n",
      "",
    ],
    ["inverse on a plain key", "  registrar: { inverse: domains }\n", ""],
    ["options that are not a map", "  registrar: yes\n", ""],
    ["a key name that is not a fact key", "  Registrar: {}\n", ""],
    [
      "required that is not a list",
      "  registrar: {}\n",
      "required: registrar\n",
    ],
  ])("blocks %s", (_, keys, extra) => {
    expect(codes(schema(keys, extra))).toContain("schema-invalid")
  })

  it("blocks entity fields on a schema document, and a bad type name", () => {
    expect(codes(schema("  a: {}\n", "type: domain\n"))).toContain(
      "field-invalid",
    )
    expect(
      codes(schema("  a: {}\n").replace("schema/domain", "schema/Domain")),
    ).toContain("schema-invalid")
  })

  it("accepts a key with no options written", () => {
    const d = parseCatalogDocument(schema("  registrar:\n"))
    expect(d.problems).toEqual([])
  })
})

describe("the start-here document (catalog §11)", () => {
  const doc = (people: string) =>
    `---\nid: start-here\ntitle: Start here\npeople:\n${people}agents: []\n---\n`

  it.each([
    ["a step that is only text", "  - project/x\n"],
    ["a step without a note", "  - to: project/x\n"],
    [
      "a step with two targets",
      "  - { to: project/x, url: https://x.dev, note: n }\n",
    ],
    ["a target that is not an ID", "  - { to: x, note: n }\n"],
    ["an unknown list", "  - { list: todo, note: n }\n"],
    ["a URL that is not http", "  - { url: ftp://x, note: n }\n"],
    ["an unknown step field", "  - { to: project/x, note: n, why: w }\n"],
  ])("blocks %s", (_, people) => {
    expect(codes(doc(people))).toContain("start-here-invalid")
  })

  it("needs both paths", () => {
    expect(codes("---\nid: start-here\ntitle: Start here\n---\n")).toEqual([
      "field-missing",
      "field-missing",
    ])
  })

  it("blocks facts on the start-here document", () => {
    expect(
      codes(doc("  []\n").replace("agents", "facts: []\nagents")),
    ).toContain("field-invalid")
  })
})
