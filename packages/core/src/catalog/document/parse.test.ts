import { describe, expect, it } from "vitest"

import { growth, maxGrowth } from "@shinan/markdown/testing"

import {
  dockyard,
  domainSchema,
  musashi,
  noReadFailure,
  startHere,
} from "../../../test/catalog-documents.js"
import {
  maxDocumentBytes,
  parseCatalogDocument as readDocument,
} from "./parse.js"
import type { ProblemCode } from "./problems.js"
import { slice } from "./source.js"

/** Reads a document, failing the test on an unexpected read failure. */
const parseCatalogDocument = (text: string) => noReadFailure(readDocument(text))

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

describe("hostile input", () => {
  const front = withFrontmatter(header, "")
  const fill = (unit: string, size: number) =>
    unit.repeat(Math.ceil(size / unit.length)).slice(0, size)
  const room = maxDocumentBytes - front.length

  it("refuses a document longer than the limit before reading it", () => {
    const d = parseCatalogDocument(front + "x".repeat(room + 1))
    expect(d.problems.map((p) => p.code)).toEqual(["too-large"])
    expect(d.id).toBeNull()
    expect(parseCatalogDocument(front + "x".repeat(room)).problems).toEqual([])
  })

  it("counts the limit in UTF-8 bytes, not characters", () => {
    // "é" is one character but two bytes.
    const half = "é".repeat(Math.ceil(room / 2) + 1)
    expect(half.length).toBeLessThan(room)
    const d = parseCatalogDocument(front + half)
    expect(d.problems.map((p) => p.code)).toEqual(["too-large"])
    expect(d.problems[0]?.message).toContain("bytes")
  })

  // Instead of a wall-clock bound, these check how CPU time grows with size
  // (`growth` from @shinan/markdown/testing): reading the full size once
  // must cost well under twice reading a quarter of it four times, where
  // quadratic reading costs about four times as much. A loose absolute
  // bound remains as a backstop.
  const read = (body: string) => parseCatalogDocument(front + body)

  const under = (repeated: string, count: number, size: number) =>
    (repeated.repeat(count) + fill("x\n\n", size)).slice(0, size)

  it.each<[string, (size: number) => string]>([
    ["repeated *a_ (emphasis)", (n) => fill("*a_", n)],
    ["unclosed links just under the limit", (n) => under("[a](\n\n", 990, n)],
    ["inline HTML comments", (n) => fill("a <!-- b\n", n)],
    ["nested link brackets", (n) => fill("[", n)],
    ["many backticks", (n) => fill("`a", n)],
    ["a long flat list", (n) => fill("- a\n", n)],
    ["lists nested just under the limit", (n) => under("- a\n  - b\n", 990, n)],
    [
      "quotes 31 deep",
      (n) => `${"> ".repeat(31)}a\n\n${fill("x\n\n", n - 70)}`,
    ],
    ["setext headings just under the limit", (n) => under("a\n===\n", 490, n)],
    ["separate quotes just under the limit", (n) => under("> b\n\n", 990, n)],
    [
      "empty list items just under the limit",
      (n) => under("+\n\nc\n\n", 990, n),
    ],
    [
      "lazy lines just under the limit",
      (n) => (`> a\n${"  b\n".repeat(990)}\n` + fill("x\n\n", n)).slice(0, n),
    ],
    [
      "> > a, then > b, just under the limit",
      (n) => (`> > a\n${"> b\n".repeat(990)}\n` + fill("x\n\n", n)).slice(0, n),
    ],
    [
      "> > > > a, then > b, just under the limit",
      (n) =>
        (`> > > > a\n${"> b\n".repeat(990)}\n` + fill("x\n\n", n)).slice(0, n),
    ],
    [
      "> - a, then > b, just under the limit",
      (n) => (`> - a\n${"> b\n".repeat(990)}\n` + fill("x\n\n", n)).slice(0, n),
    ],
    [
      "> - - a, then > b, just under the limit",
      (n) =>
        (`> - - a\n${"> b\n".repeat(990)}\n` + fill("x\n\n", n)).slice(0, n),
    ],
    [
      "list continuation lines",
      (n) => `123456789. a\n${fill("           b\n", n - 20)}`,
    ],
    ["a long single quote", (n) => fill("> a\n", n)],
    ["a long single list", (n) => fill("- a\n", n)],
  ])(
    "reads %s, in time that grows about linearly",
    (_, make) => {
      const full = make(room)
      const d = parseCatalogDocument(front + full)
      expect(d.problems).toEqual([])
      expect(d.body.sections.map((s) => s.text).join("")).toBe(d.body.text)
      const measured = growth(make, read, room)
      expect(measured.ratio).toBeLessThan(maxGrowth)
      expect(measured.full).toBeLessThan(30_000)
    },
    120_000,
  )

  // Refusals take milliseconds, so a tight bound is safe.
  const bound = 2000

  it.each([
    ["deeply nested quotes", `${">".repeat(room - 2)} x`, "deep"],
    ["deeply nested lists", fill("1. ", room), "deep"],
    ["a list in every list item", fill("- - a\n", room), "inside others"],
    [
      "nested lists by indentation",
      fill("- a\n  - b\n", room),
      "inside others",
    ],
    [
      "quotes reopened inside quotes",
      fill("> > a\n> \n", room),
      "inside others",
    ],
    ["many setext headings", fill("a\n===\n", room), "lines of only"],
    // Line breaks as micromark reads them: CR alone, and CR LF mixed with CR.
    [
      "quotes reopened inside quotes, CR line breaks",
      fill("> > a\r> \r", room),
      "inside others",
    ],
    [
      "setext headings, CR line breaks",
      fill("a\r===\r", room),
      "lines of only",
    ],
    [
      "two-level lists, CR line breaks",
      fill("- a\r  - b\r", room),
      "inside others",
    ],
    [
      "two-level lists, mixed line breaks",
      fill("- a\r\n  - b\r", room),
      "inside others",
    ],
    [
      "setext headings inside quotes",
      fill("> a\n> ===\n", room),
      "lines of only",
    ],
    [
      "thematic breaks inside quotes",
      fill("> a\n> ---\n", room),
      // `---` could start a list item, so it also counts as a block.
      "separate quotes",
    ],
    ["many separate quotes", fill("> b\n\n", room), "separate quotes"],
    [
      "lists interrupted by paragraphs",
      fill("- b\n\nc\n\n", room),
      "separate quotes",
    ],
    [
      "empty quotes between paragraphs",
      fill(">\nb\n", room),
      "separate quotes",
    ],
    [
      "one quote with lazy lines",
      `> a\n${fill("b\n", room - 4)}`,
      "without its markers",
    ],
    [
      "a deep quote with lazy lines",
      `${"> ".repeat(32)}a\n${"b\n".repeat(20_000)}`,
      "without its markers",
    ],
    // A list marker at the end of a line starts an empty list item.
    ["empty + list items", fill("+\n\nc\n\n", room), "separate quotes"],
    ["empty * list items", fill("*\n\nc\n\n", room), "separate quotes"],
    ["empty 1) list items", fill("1)\n\nc\n\n", room), "separate quotes"],
    ["empty 1. list items", fill("1.\n\nc\n\n", room), "separate quotes"],
    // A line without > never belongs to a quote, whatever its indentation.
    [
      "lazy lines indented by a tab",
      `> a\n${fill("\tb\n", room - 4)}`,
      "without its markers",
    ],
    [
      "lazy lines indented by 2",
      `> a\n${fill("  b\n", room - 4)}`,
      "without its markers",
    ],
    [
      "lazy lines indented by 3",
      `> a\n${fill("   b\n", room - 4)}`,
      "without its markers",
    ],
    [
      "lazy lines indented by 4",
      `> a\n${fill("    b\n", room - 4)}`,
      "without its markers",
    ],
    // Below a list item's content column, a line can only be lazy.
    [
      "lazy lines under a wide list marker",
      `123456789. a\n${fill("   b\n", room - 20)}`,
      "without its markers",
    ],
    [
      "lazy lines just under a wide marker's content",
      `123456789. a\n${fill("         b\n", room - 20)}`,
      "without its markers",
    ],
    ["lines that could start a list", fill("-x\n\n", room), "separate quotes"],
    ["unclosed links", fill("[a](", room), "not closed"],
    // Lazy lines that keep the outer markers: `> b` continues the inner
    // quote's or list item's paragraph.
    [
      "> > a, then > b",
      `> > a\n${fill("> b\n", room - 6)}`,
      "without its markers",
    ],
    [
      "> > > > a, then > b",
      `> > > > a\n${fill("> b\n", room - 10)}`,
      "without its markers",
    ],
    [
      "> - a, then > b",
      `> - a\n${fill("> b\n", room - 6)}`,
      "without its markers",
    ],
    [
      "> - - a, then > b",
      `> - - a\n${fill("> b\n", room - 8)}`,
      "without its markers",
    ],
    ["unclosed links to <", fill("[a](<", room), "not closed"],
    ["unclosed links, one per line", fill("[a](\n", room), "not closed"],
  ])(
    "refuses %s quickly, without throwing",
    (_, body, reason) => {
      const started = performance.now()
      const d = parseCatalogDocument(front + body)
      expect(performance.now() - started).toBeLessThan(bound)
      expect(d.problems.map((p) => p.code)).toEqual(["body-invalid"])
      expect(d.problems[0]?.message).toContain(reason)
      expect(d.id).toBe("machine/x")
    },
    30_000,
  )

  it("finds links deep inside quotes and lists", () => {
    const quoted = `${"> ".repeat(30)}[m](machine/musashi)\n`
    expect(entity(front + quoted).body.links.map((l) => l.reference)).toEqual([
      "machine/musashi",
    ])
    const listed = `${Array.from({ length: 30 }, (_, i) => `${"  ".repeat(i)}- a`).join("\n")} [m](machine/musashi)\n`
    expect(entity(front + listed).body.links.map((l) => l.reference)).toEqual([
      "machine/musashi",
    ])
  })
})

describe("numbers are read only as written (catalog §2.1)", () => {
  const fact = (v: string) =>
    withFrontmatter(
      `${header}facts:\n  - checked: 2026-11-14\n    by: guneet\n    scope: s\n    source: s\n    observed:\n      disk.root.size: ${v}\n`,
    )

  it.each([
    "12345678901234567890",
    "0x10",
    "0o17",
    "+12",
    "1e3",
    "1.10",
    "1.0",
    ".5",
    "-0",
  ])("refuses %s, which would read as another number", (v) => {
    const d = parseCatalogDocument(fact(v))
    expect(d.problems.map((p) => p.code)).toEqual(["frontmatter-invalid"])
    expect(d.problems[0]?.message).toContain("quotes")
  })

  it.each([
    ["128", 128],
    ["-5", -5],
    ["0.5", 0.5],
    ['"1.10"', "1.10"],
    ['"0x10"', "0x10"],
  ])("reads %s", (v, value) => {
    const d = entity(fact(v))
    expect(d.problems).toEqual([])
    expect(d.facts[0]?.value).toBe(value)
  })
})

describe("names that are object members", () => {
  const check =
    "  - checked: 2026-11-14\n    by: guneet\n    scope: s\n    source: s\n"

  it.each(["__proto__", "constructor", "toString", "prototype"])(
    "refuses %s as a relation attribute",
    (name) => {
      const d = entity(
        withFrontmatter(
          `${header}facts:\n${check}    observed:\n      secrets-in: { to: service/o, ${name}: evil, item: a }\n`,
        ),
      )
      expect(d.problems.map((p) => p.code)).toEqual(["fact-invalid"])
      expect(d.problems[0]?.message).toContain(name)
    },
  )

  it.each(["checked", "by", "scope", "source", "limits"])(
    "refuses %s, a fact check's field, as a relation attribute",
    (name) => {
      const d = entity(
        withFrontmatter(
          `${header}facts:\n${check}    observed:\n      secrets-in: { to: service/o, item: a, ${name}: guneet }\n`,
        ),
      )
      expect(d.problems.map((p) => p.code)).toEqual(["fact-invalid"])
      expect(d.problems[0]?.message).toContain(`"${name}"`)
      expect(d.problems[0]?.message).toContain("fact check")
    },
  )

  it("keeps attributes in a map with no prototype", () => {
    const d = entity(
      withFrontmatter(
        `${header}facts:\n${check}    observed:\n      secrets-in: { to: service/o, item: a }\n`,
      ),
    )
    const attributes = d.facts[0]?.attributes ?? {}
    expect(Object.getPrototypeOf(attributes)).toBeNull()
    expect(Object.keys(attributes)).toEqual(["item"])
  })
})

describe("facts and their groups", () => {
  it("gives each fact its own group's check when an earlier item is not a group", () => {
    const d = entity(
      withFrontmatter(
        `${header}facts:\n  - oops\n  - checked: 2026-11-14\n    by: guneet\n    scope: s\n    source: s\n    observed:\n      role: web\n  - unknown:\n      hostname: Not looked\n`,
      ),
    )
    expect(d.groups.map((g) => g.index)).toEqual([1, 2])
    expect(d.facts.map((f) => [f.key, f.group])).toEqual([
      ["role", 1],
      ["hostname", 2],
    ])
  })
})
