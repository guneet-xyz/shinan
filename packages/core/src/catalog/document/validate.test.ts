import { describe, expect, it } from "vitest"

import {
  dockyard,
  domainSchema,
  guneetDev,
  musashi,
  noReadFailure,
} from "../../../test/catalog-documents.js"
import { agentTokenPrefix } from "../../tokens.js"
import { readCatalog } from "./catalog.js"
import { parseCatalogDocument } from "./parse.js"
import type { ProblemCode } from "./problems.js"
import { validateCatalog, validateChange } from "./validate.js"
import type { ValidationContext } from "./validate.js"

const now = Date.UTC(2026, 10, 20, 12)
const context: ValidationContext = { now }

function entity(
  id: string,
  options: { fields?: string; facts?: string; body?: string } = {},
) {
  const type = id.split("/")[0]
  return `---
id: ${id}
type: ${type}
title: ${id}
summary: An entity for tests.
status: active
owner: person/guneet
${options.fields ?? ""}${options.facts ? `facts:\n${options.facts}` : ""}---

${options.body ?? `# ${id}\n`}`
}

const check = (date = "2026-11-14", by = "guneet") =>
  `  - checked: ${date}\n    by: ${by}\n    scope: Looked\n    source: Somewhere\n`

const startHere = `---
id: start-here
title: Start here
owner: person/guneet
people:
  - to: project/dockyard
    note: The registry.
  - list: discrepancies
    note: What disagrees.
agents:
  - url: https://git.guneet.dev/guneet/workspace
    note: Policies, during the trial.
---
`

/** A small, valid catalog: the catalog document's examples and what they point to. */
const base: Record<string, string> = {
  "person/guneet": entity("person/guneet", {
    facts: `${check()}    observed:\n      member: guneet\n`,
  }),
  "machine/daedalus": entity("machine/daedalus"),
  "machine/musashi": musashi,
  "project/dockyard": dockyard,
  "service/container-registry": entity("service/container-registry"),
  "service/ingress": entity("service/ingress"),
  "service/obscuro": entity("service/obscuro"),
  "service/cloudflare-dns": entity("service/cloudflare-dns"),
  "schema/domain": domainSchema,
  "domain/guneet-dev": guneetDev,
  "decision/release-versioning": entity("decision/release-versioning", {
    fields: "decision_state: accepted\ndecided_on: 2026-11-01\n",
  }),
  "decision/maybe": entity("decision/maybe", {
    fields: "decision_state: proposed\n",
  }),
  "start-here": startHere,
}

/** The warnings the examples have on their own: Musashi's keys outside the machine schema. */
const exampleWarnings = [
  ["key-not-in-schema", "machine/musashi"],
  ["key-not-in-schema", "machine/musashi"],
]

function change(
  documents: Record<string, string | null>,
  options: {
    context?: ValidationContext
    texts?: { label: string; text: string }[]
  } = {},
) {
  const before = readCatalog(Object.values(base))
  const merged = { ...base }
  for (const [id, text] of Object.entries(documents)) {
    if (text === null) delete merged[id]
    else merged[id] = text
  }
  const after = readCatalog(Object.values(merged))
  for (const d of after.documents) noReadFailure(d)
  const changed = after.documents.filter((d) =>
    Object.values(documents).includes(d.text),
  )
  return validateChange(
    { before, after, changed, texts: options.texts },
    options.context ?? context,
  )
}

function found(result: ReturnType<typeof change>) {
  return result.problems.map((p) => [p.code, p.documentId])
}

describe("the examples", () => {
  it("validate, with only Musashi's keys outside the schema flagged", () => {
    const result = validateCatalog(readCatalog(Object.values(base)), context)
    expect(found(result)).toEqual(exampleWarnings)
    expect(result).toMatchObject({ blocked: false, hasWarnings: true })
  })

  it("an unchanged document's problems are not the change's", () => {
    const result = change({
      "machine/daedalus": entity("machine/daedalus", { body: "# Daedalus\n" }),
    })
    expect(result.problems).toEqual([])
    expect(result).toMatchObject({ blocked: false, hasWarnings: false })
  })
})

const blockingCases: [string, Record<string, string | null>, ProblemCode][] = [
  [
    "frontmatter that does not parse",
    { "machine/daedalus": "---\nid: [\n---\n" },
    "frontmatter-invalid",
  ],
  [
    "a missing required field",
    {
      "machine/daedalus": entity("machine/daedalus").replace(
        "summary: An entity for tests.\n",
        "",
      ),
    },
    "field-missing",
  ],
  [
    "an invalid status",
    {
      "machine/daedalus": entity("machine/daedalus").replace(
        "status: active",
        "status: gone",
      ),
    },
    "field-invalid",
  ],
  [
    "an invalid date",
    {
      "machine/daedalus": entity("machine/daedalus", {
        facts: `${check("2026-13-01")}    observed:\n      role: dev\n`,
      }),
    },
    "date-invalid",
  ],
  [
    "facts that are not groups",
    { "machine/daedalus": entity("machine/daedalus", { facts: "  - role\n" }) },
    "facts-invalid",
  ],
  [
    "a long form without a value",
    {
      "machine/daedalus": entity("machine/daedalus", {
        facts: `${check()}    observed:\n      role: { via: x }\n`,
      }),
    },
    "fact-invalid",
  ],
  [
    "a list for a single-valued key",
    {
      "machine/daedalus": entity("machine/daedalus", {
        facts: `${check()}    observed:\n      role: [a, b]\n`,
      }),
    },
    "cardinality",
  ],
  [
    "an invalid type schema",
    {
      "schema/zone":
        "---\nid: schema/zone\ntitle: Z\nsummary: Z.\nstatus: active\nowner: person/guneet\nkeys:\n  a: { colour: red }\n---\n",
    },
    "schema-invalid",
  ],
  [
    "a type schema built on a missing type",
    {
      "schema/zone":
        "---\nid: schema/zone\ntitle: Z\nsummary: Z.\nstatus: active\nowner: person/guneet\nkeys:\n  a: { relation: [nothing] }\n---\n",
    },
    "schema-invalid",
  ],
  [
    "an invalid start-here step",
    { "start-here": startHere.replace("list: discrepancies", "list: todo") },
    "start-here-invalid",
  ],
  ["an unknown type", { "zone/a": entity("zone/a") }, "type-unknown"],
  [
    "a retired type on an active entity",
    {
      "schema/zone":
        "---\nid: schema/zone\ntitle: Z\nsummary: Z.\nstatus: retired\nowner: person/guneet\n---\n",
      "zone/a": entity("zone/a"),
    },
    "type-unknown",
  ],
  [
    "a duplicate ID",
    { "machine/daedalus-2": entity("machine/daedalus") },
    "id-duplicate",
  ],
  [
    "an alias that is another entity's ID",
    {
      "machine/daedalus": entity("machine/daedalus", {
        fields: "aliases: [machine/musashi]\n",
      }),
    },
    "id-duplicate",
  ],
  [
    "an unknown owner",
    {
      "machine/daedalus": entity("machine/daedalus").replace(
        "owner: person/guneet",
        "owner: person/nobody",
      ),
    },
    "reference-unresolved",
  ],
  [
    "an owner who is not a person",
    {
      "machine/daedalus": entity("machine/daedalus").replace(
        "owner: person/guneet",
        "owner: machine/musashi",
      ),
    },
    "reference-type",
  ],
  [
    "an unknown replaced_by",
    {
      "machine/daedalus": entity("machine/daedalus", {
        fields: "replaced_by: machine/nowhere\n",
      }),
    },
    "reference-unresolved",
  ],
  [
    "a relation to a missing entity",
    {
      "service/ingress": entity("service/ingress", {
        facts: `${check()}    observed:\n      runs-on: machine/nowhere\n`,
      }),
    },
    "reference-unresolved",
  ],
  [
    "a relation to the wrong type",
    {
      "service/ingress": entity("service/ingress", {
        facts: `${check()}    observed:\n      runs-on: service/obscuro\n`,
      }),
    },
    "reference-type",
  ],
  [
    "applies-to a type that does not exist",
    {
      "policy/p": entity("policy/p", {
        facts: `${check()}    intended:\n      applies-to: schema/zone\n`,
      }),
    },
    "reference-unresolved",
  ],
  [
    "from-task with something that is not a task ID",
    {
      "decision/release-versioning": entity("decision/release-versioning", {
        fields: "decision_state: accepted\n",
        facts: `${check()}    observed:\n      from-task: twelve\n`,
      }),
    },
    "reference-unresolved",
  ],
  [
    "a body link to a missing entity",
    {
      "machine/daedalus": entity("machine/daedalus", {
        body: "See [it](machine/nowhere).\n",
      }),
    },
    "reference-unresolved",
  ],
  [
    "a start-here step to a missing entity",
    {
      "start-here": startHere.replace(
        "to: project/dockyard",
        "to: project/nowhere",
      ),
    },
    "reference-unresolved",
  ],
  [
    "accepted by someone who is not a person",
    {
      "machine/daedalus": entity("machine/daedalus", {
        facts: `${check()}    observed:\n      role: { value: dev, accepted: machine/musashi, note: n }\n`,
      }),
    },
    "reference-type",
  ],
  [
    "an observed fact with no fact check",
    {
      "machine/daedalus": entity("machine/daedalus", {
        facts: "  - observed:\n      role: dev\n",
      }),
    },
    "fact-check-missing",
  ],
  [
    "a fact check without a source",
    {
      "machine/daedalus": entity("machine/daedalus", {
        facts:
          "  - checked: 2026-11-14\n    by: guneet\n    scope: s\n    observed:\n      role: dev\n",
      }),
    },
    "fact-check-incomplete",
  ],
  [
    "a fact check by someone not written as an actor",
    {
      "machine/daedalus": entity("machine/daedalus", {
        facts: `${check("2026-11-14", "Guneet Singh")}    observed:\n      role: dev\n`,
      }),
    },
    "fact-check-invalid",
  ],
  [
    "a fact check dated tomorrow",
    {
      "machine/daedalus": entity("machine/daedalus", {
        facts: `${check("2026-11-22")}    observed:\n      role: dev\n`,
      }),
    },
    "checked-in-future",
  ],
  [
    "a fact check later today",
    {
      "machine/daedalus": entity("machine/daedalus", {
        facts: `${check("2026-11-20T13:00Z")}    observed:\n      role: dev\n`,
      }),
    },
    "checked-in-future",
  ],
  [
    "checked: null outside an import",
    {
      "machine/daedalus": entity("machine/daedalus", {
        facts:
          "  - checked: null\n    by: guneet\n    scope: s\n    source: s\n    observed:\n      role: dev\n",
      }),
    },
    "unchecked-not-imported",
  ],
  [
    "by: unknown outside an import",
    {
      "machine/daedalus": entity("machine/daedalus", {
        facts: `${check("2026-11-14", "unknown")}    observed:\n      role: dev\n`,
      }),
    },
    "unchecked-not-imported",
  ],
  [
    "a planned fact without a task",
    {
      "machine/daedalus": entity("machine/daedalus", {
        facts: "  - planned:\n      role: dev\n",
      }),
    },
    "planned-without-task",
  ],
  [
    "a planned fact with a malformed task",
    {
      "machine/daedalus": entity("machine/daedalus", {
        facts: "  - planned:\n      role: { value: dev, task: t12 }\n",
      }),
    },
    "planned-without-task",
  ],
  [
    "a planned fact behind a decision not accepted",
    {
      "machine/daedalus": entity("machine/daedalus", {
        facts:
          "  - planned:\n      role: { value: dev, task: decision/maybe }\n",
      }),
    },
    "planned-without-task",
  ],
  [
    "a fact written twice",
    {
      "machine/daedalus": entity("machine/daedalus", {
        facts: `${check()}    observed:\n      role: dev\n${check("2026-11-15")}    observed:\n      role: build\n`,
      }),
    },
    "identity-duplicate",
  ],
  [
    "a private key",
    {
      "machine/daedalus": entity("machine/daedalus", {
        body: "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----\n",
      }),
    },
    "secret",
  ],
  [
    "a Shinan agent token",
    {
      "machine/daedalus": entity("machine/daedalus", {
        facts: `${check()}    observed:\n      access.method: ${agentTokenPrefix}Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4zAb7cDe0fGh2\n`,
      }),
    },
    "secret",
  ],
  [
    "a GitHub token",
    {
      "machine/daedalus": entity("machine/daedalus", {
        body: "Use ghp_0123456789abcdefghijABCDEFGHIJ012345 to clone.\n",
      }),
    },
    "secret",
  ],
  [
    "a URL with a password",
    {
      "machine/daedalus": entity("machine/daedalus", {
        facts: `  - checked: 2026-11-14\n    by: guneet\n    scope: s\n    source: postgres://shinan:hunter22@db.internal:5432/shinan\n    observed:\n      role: db\n`,
      }),
    },
    "secret",
  ],
  [
    "a document longer than Shinan reads",
    {
      "machine/daedalus": entity("machine/daedalus", {
        body: `${"Plain text. ".repeat(50_000)}\n`,
      }),
    },
    "too-large",
  ],
]

describe("blocking rules (catalog §8.3)", () => {
  it.each(blockingCases)("blocks %s", (_, documents, code) => {
    const result = change(documents)
    expect(result.problems.map((p) => p.code)).toContain(code)
    expect(result.blocked).toBe(true)
    const problem = result.problems.find((p) => p.code === code)
    expect(problem?.severity).toBe("blocking")
  })

  it("blocks a type schema change that breaks entities, listing them", () => {
    const narrowed = domainSchema.replace(
      "nameservers: { many: true, recheck: 90d }",
      "nameservers: { recheck: 90d }",
    )
    const result = change({ "schema/domain": narrowed })
    expect(result.blocked).toBe(true)
    const breaks = result.problems.find(
      (p) => p.code === "schema-breaks-entities",
    )
    expect(breaks?.documentId).toBe("schema/domain")
    expect(breaks?.message).toContain("domain/guneet-dev")
    expect(found(result)).toContainEqual(["cardinality", "domain/guneet-dev"])
  })

  it("blocks removing a key current entities use, but not adding keys", () => {
    const removed = domainSchema
      .replace("  registrar: {}\n", "")
      .replace("required: [registrar, served-by]", "required: [served-by]")
    expect(
      change({ "schema/domain": removed }).problems.map((p) => p.code),
    ).toEqual(["key-not-in-schema", "schema-breaks-entities"])
    const added = domainSchema.replace("keys:\n", "keys:\n  dnssec: {}\n")
    expect(change({ "schema/domain": added }).problems).toEqual([])
  })

  it("blocks retiring a type with active entities, and allows it once they are retired", () => {
    const retired = domainSchema.replace("status: active", "status: retired")
    expect(
      change({ "schema/domain": retired }).problems.map((p) => p.code),
    ).toEqual(["type-unknown", "schema-breaks-entities"])
    expect(
      change({
        "schema/domain": retired,
        "domain/guneet-dev": guneetDev.replace(
          "status: active",
          "status: retired",
        ),
      }).problems,
    ).toEqual([])
  })

  it("reports references a change breaks in documents it does not write", () => {
    const moved = entity("machine/daedalus-two")
    const result = change({
      "machine/daedalus": null,
      "machine/daedalus-two": moved,
    })
    expect(found(result)).toContainEqual([
      "reference-unresolved",
      "project/dockyard",
    ])
    const aliased = entity("machine/daedalus-two", {
      fields: "aliases: [machine/daedalus]\n",
    })
    expect(
      change({ "machine/daedalus": null, "machine/daedalus-two": aliased })
        .problems,
    ).toEqual([])
  })

  it("checks the proposal's own text for secrets, without repeating the secret", () => {
    const token = `${agentTokenPrefix}Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4zAb7cDe0fGh2`
    const result = change(
      {},
      { texts: [{ label: "Explanation", text: `Used ${token}` }] },
    )
    expect(result.problems).toEqual([
      expect.objectContaining({ code: "secret", documentId: null }),
    ])
    expect(result.problems[0]?.message).not.toContain(token)
    expect(result.problems[0]?.message).toContain("Explanation")
  })
})

const warningCases: [
  string,
  Record<string, string | null>,
  ProblemCode,
  ValidationContext?,
][] = [
  [
    "a password written as a value",
    {
      "machine/daedalus": entity("machine/daedalus", {
        body: "Log in with password=hunter22 for now.\n",
      }),
    },
    "secret-suspected",
  ],
  [
    "a long random-looking string",
    {
      "machine/daedalus": entity("machine/daedalus", {
        facts: `${check()}    observed:\n      access.address: kV9xQ2mZ7pL4tR8wB3nF6hJ1cY5dG0sAe\n`,
      }),
    },
    "secret-suspected",
  ],
  [
    "a key outside the type schema",
    {
      "machine/daedalus": entity("machine/daedalus", {
        facts: `${check()}    observed:\n      ups.model: X1\n`,
      }),
    },
    "key-not-in-schema",
  ],
  [
    "a fact check older than the one it replaces",
    {
      "project/dockyard": dockyard.replace(
        "  - checked: 2026-11-14\n    by: guneet via opencode-daedalus\n    scope: Repository",
        "  - checked: 2026-11-10\n    by: guneet via opencode-daedalus\n    scope: Repository",
      ),
    },
    "check-older",
  ],
  [
    "a start-here step to a retired entity",
    {
      "start-here": startHere.replace(
        "to: project/dockyard",
        "to: machine/daedalus",
      ),
      "machine/daedalus": entity("machine/daedalus").replace(
        "status: active",
        "status: retired",
      ),
    },
    "start-here-retired",
  ],
  [
    "a start-here step to an entity with discrepancies",
    {
      "start-here": startHere.replace(
        "to: project/dockyard",
        "to: machine/musashi",
      ),
    },
    "start-here-discrepancy",
  ],
  [
    "a task status in a fact",
    {
      "service/ingress": entity("service/ingress", {
        facts: `${check()}    observed:\n      deployment.status: in progress\n`,
      }),
    },
    "task-status",
  ],
  [
    "an owner who is not a current member",
    { "machine/new": entity("machine/new") },
    "owner-not-member",
    { now, memberHandles: new Set(["someone"]) },
  ],
]

describe("warning rules (catalog §8.3)", () => {
  it.each(warningCases)("holds %s for approval", (_, documents, code, ctx) => {
    const result = change(documents, { context: ctx })
    expect(result.problems.map((p) => [p.code, p.severity])).toContainEqual([
      code,
      "warning",
    ])
    expect(result).toMatchObject({ blocked: false, hasWarnings: true })
  })

  it("does not warn about an owner who is a current member", () => {
    const result = change(
      { "machine/new": entity("machine/new") },
      { context: { now, memberHandles: new Set(["guneet"]) } },
    )
    expect(result.problems).toEqual([])
  })

  it("does not warn about an accepted discrepancy on a start-here step", () => {
    const accepted = musashi
      .replace(
        "{ value: 128 GiB, via: filesystem }",
        "{ value: 128 GiB, via: filesystem, accepted: person/guneet, note: Known }",
      )
      .replace(
        "note: Metadata lags after a resize",
        "note: Metadata lags after a resize\n        accepted: person/guneet",
      )
    const result = change({
      "machine/musashi": accepted,
      "start-here": startHere.replace(
        "to: project/dockyard",
        "to: machine/musashi",
      ),
    })
    expect(result.problems.map((p) => p.code)).not.toContain(
      "start-here-discrepancy",
    )
  })

  it("does not warn when a recheck is newer, or the check is unchanged", () => {
    const newer = dockyard.replace(
      "  - checked: 2026-11-14\n    by: guneet via opencode-daedalus\n    scope: Repository",
      "  - checked: 2026-11-18T08:00Z\n    by: guneet via opencode-daedalus\n    scope: Repository",
    )
    expect(change({ "project/dockyard": newer }).problems).toEqual([])
  })
})

describe("the parser and validation agree", () => {
  it("every problem points into its document", () => {
    const broken = entity("machine/daedalus", {
      facts: `${check("2026-12-01")}    observed:\n      role: [a, b]\n      ups: { to: machine/x }\n`,
      body: "[x](machine/nowhere)\n",
    })
    const result = change({ "machine/daedalus": broken })
    const text = parseCatalogDocument(broken).text
    for (const p of result.problems) {
      expect(p.documentId).toBe("machine/daedalus")
      if (p.range) expect(p.range.end).toBeLessThanOrEqual(text.length)
    }
    expect(result.problems.map((p) => p.code).sort()).toEqual([
      "cardinality",
      "checked-in-future",
      "fact-invalid",
      "key-not-in-schema",
      "reference-unresolved",
    ])
  })
})

describe("which problems a change is charged with", () => {
  it("does not charge a document's earlier warnings again", () => {
    const recheck = musashi.replace(
      "disk.data.free: 74 GiB",
      "disk.data.free: 70 GiB",
    )
    const result = change({ "machine/musashi": recheck })
    expect(result.problems).toEqual([])
    expect(result).toMatchObject({ blocked: false, hasWarnings: false })
  })

  it("charges a new warning in a written document", () => {
    const result = change({
      "machine/musashi": musashi.replace(
        "disk.data.free: 74 GiB",
        "disk.data.free: 74 GiB\n      ups.model: X1",
      ),
    })
    expect(found(result)).toEqual([["key-not-in-schema", "machine/musashi"]])
  })

  it("compares secret warnings by the value, not the message", () => {
    const withPassword = (value: string, extra = "") =>
      entity("machine/daedalus", {
        body: `Log in with password=${value} for now.${extra}\n`,
      })
    const accepted = { "machine/daedalus": withPassword("hunter22") }
    const before = readCatalog(Object.values({ ...base, ...accepted }))
    const run = (text: string) => {
      const after = readCatalog(
        Object.values({ ...base, "machine/daedalus": text }),
      )
      const changed = after.documents.filter((d) => d.text === text)
      return validateChange({ before, after, changed }, context)
    }
    expect(run(withPassword("hunter22", " Edited.")).problems).toEqual([])
    expect(run(withPassword("realpass")).problems.map((p) => p.code)).toEqual([
      "secret-suspected",
    ])
  })

  it("does not charge an unreadable document's problems to unrelated changes", () => {
    const broken = "---\nid: [\n---\n# Broken\n"
    const before = readCatalog([...Object.values(base), broken])
    const text = entity("machine/daedalus", { body: "# D\n\nChanged.\n" })
    const after = readCatalog([
      ...Object.values({ ...base, "machine/daedalus": text }),
      broken,
    ])
    const changed = after.documents.filter((d) => d.text === text)
    expect(
      validateChange({ before, after, changed }, context).problems,
    ).toEqual([])
    expect(validateCatalog(after, context).blocked).toBe(true)
  })

  it("charges a repair only with problems the document did not have (catalog §8.3)", () => {
    const unreadable = (title: string, extra = "") =>
      entity("machine/daedalus", {
        fields: `${extra}`,
        facts: `${check()}    observed:\n      contact: { to: person/guneet, by: someone }\n`,
        body: `# ${title}\n`,
      })
    const before = readCatalog(
      Object.values({ ...base, "machine/daedalus": unreadable("Daedalus") }),
    )
    const run = (text: string, repair: boolean) => {
      const after = readCatalog(
        Object.values({ ...base, "machine/daedalus": text }),
      )
      const changed = after.documents.filter((d) => d.text === text)
      return validateChange({ before, after, changed, repair }, context)
    }
    const edited = unreadable("Daedalus, edited")
    // An ordinary change is charged with every blocking problem.
    expect(run(edited, false).problems.map((p) => p.code)).toEqual([
      "fact-invalid",
    ])
    // A repair may leave it, but not add one, and never a secret.
    expect(run(edited, true).problems).toEqual([])
    expect(
      run(
        unreadable("Daedalus", "replaced_by: machine/nowhere\n"),
        true,
      ).problems.map((p) => p.code),
    ).toEqual(["reference-unresolved"])
    // A secret is charged even when the document already held it.
    const token = `${agentTokenPrefix}${"a".repeat(40)}`
    const leaky = readCatalog(
      Object.values({
        ...base,
        "machine/daedalus": unreadable(`Daedalus ${token}`),
      }),
    )
    const text = unreadable(`Daedalus, edited ${token}`)
    const after = readCatalog(
      Object.values({ ...base, "machine/daedalus": text }),
    )
    const changed = after.documents.filter((d) => d.text === text)
    expect(
      validateChange(
        { before: leaky, after, changed, repair: true },
        context,
      ).problems.map((p) => p.code),
    ).toEqual(["secret"])
  })

  it("blames a schema change only for problems a schema can cause", () => {
    const added = domainSchema.replace("keys:\n", "keys:\n  dnssec: {}\n")
    const result = change({
      "schema/domain": added,
      "person/guneet": null,
      "person/guneet-two": base["person/guneet"]!.replace(
        "person/guneet\ntype",
        "person/guneet-two\ntype",
      ),
    })
    const codes = result.problems.map((p) => p.code)
    expect(codes).toContain("reference-unresolved")
    expect(codes).not.toContain("schema-breaks-entities")
  })

  it("refuses a changed document that is not in the catalog after the change", () => {
    const after = readCatalog(Object.values(base))
    const stray = parseCatalogDocument(entity("machine/stray"))
    expect(() =>
      validateChange({ before: null, after, changed: [stray] }, context),
    ).toThrow(/not in the catalog after the change/)
  })

  it("blocks a proposal text longer than Shinan reads", () => {
    const result = change(
      {},
      { texts: [{ label: "Explanation", text: "x".repeat(600 * 1024) }] },
    )
    expect(result.problems.map((p) => p.code)).toEqual(["too-large"])
  })
})

describe("no message repeats a secret (catalog §7.3)", () => {
  const token = "ghp_0123456789abcdefghijABCDEFGHIJ012345"

  it.each<[string, Record<string, string | null>]>([
    [
      "in a fact check's by",
      {
        "machine/daedalus": entity("machine/daedalus", {
          facts: `${check("2026-11-14", `guneet ${token}`)}    observed:\n      role: dev\n`,
        }),
      },
    ],
    [
      "in a type, and in a reference to it from another document",
      {
        "machine/daedalus": entity("machine/daedalus").replace(
          "type: machine",
          `type: ${token}`,
        ),
        "service/ingress": entity("service/ingress", {
          facts: `${check()}    observed:\n      runs-on: machine/daedalus\n`,
        }),
      },
    ],
    [
      "in an alias",
      {
        "machine/daedalus": entity("machine/daedalus", {
          fields: `aliases: [${token}]\n`,
        }),
      },
    ],
    [
      "in a planned fact's task",
      {
        "machine/daedalus": entity("machine/daedalus", {
          facts: `  - planned:\n      role: { value: dev, task: ${token} }\n`,
        }),
      },
    ],
    [
      "in a relation target",
      {
        "service/ingress": entity("service/ingress", {
          facts: `${check()}    observed:\n      runs-on: ${token}\n`,
        }),
      },
    ],
    [
      "in a body link",
      {
        "machine/daedalus": entity("machine/daedalus", {
          body: `See [it](${token}).\n`,
        }),
      },
    ],
  ])("when it is %s", (_, documents) => {
    const result = change(documents)
    expect(result.problems.map((p) => p.code)).toContain("secret")
    expect(result.problems.length).toBeGreaterThan(1)
    for (const p of result.problems) expect(p.message).not.toContain(token)
    expect(
      result.problems.some(
        (p) => p.code !== "secret" && p.message.includes("ghp_01…"),
      ),
    ).toBe(true)
  })

  it("in validateCatalog too", () => {
    const text = entity("machine/daedalus", {
      facts: `${check("2026-11-14", `guneet ${token}`)}    observed:\n      role: dev\n`,
    })
    const result = validateCatalog(
      readCatalog(Object.values({ ...base, "machine/daedalus": text })),
      context,
    )
    for (const p of result.problems) expect(p.message).not.toContain(token)
  })
})

describe("the task-status rule (proposed)", () => {
  it.each([
    ["subscription.status: cancelled"],
    ["registration.state: done"],
    ["deployment.status: active"],
  ])("lets %s pass", (fact) => {
    const result = change({
      "service/ingress": entity("service/ingress", {
        facts: `${check()}    observed:\n      ${fact}\n`,
      }),
    })
    expect(result.problems.map((p) => p.code)).not.toContain("task-status")
  })

  it.each([
    ["review.state: In_Review"],
    ["status: to do"],
    ["work.status: verifying"],
  ])("warns about %s", (fact) => {
    const result = change({
      "service/ingress": entity("service/ingress", {
        facts: `${check()}    observed:\n      ${fact}\n`,
      }),
    })
    expect(result.blocked).toBe(false)
    expect(result.problems.map((p) => p.code)).toContain("task-status")
  })
})

describe("messages that help", () => {
  it("suggests https:// for a link that looks like a web address", () => {
    const result = change({
      "machine/daedalus": entity("machine/daedalus", {
        body: "See [docs](www.example.com/guide).\n",
      }),
    })
    expect(result.problems[0]?.message).toContain("https://")
  })
})

describe("secrets written with YAML escapes (catalog §7.3)", () => {
  // `\x41` is "A": the text never contains the token, the value read does.
  const escaped = "ghp_0123456789abcdefghij\\x41BCDEFGHIJ012345"
  const token = "ghp_0123456789abcdefghijABCDEFGHIJ012345"

  it.each<[string, string]>([
    [
      "a fact value",
      `${check()}    observed:\n      platform.os: "${escaped}"\n`,
    ],
    [
      "a fact check's by",
      `${check("2026-11-14", `"guneet ${escaped}"`)}    observed:\n      role: dev\n`,
    ],
    ["a fact key", `${check()}    observed:\n      "${escaped}": x\n`],
  ])("are found in %s, and never repeated", (_, facts) => {
    const text = entity("machine/daedalus", { facts })
    expect(text).not.toContain(token)
    const result = change({ "machine/daedalus": text })
    expect(result.problems.map((p) => p.code)).toContain("secret")
    for (const p of result.problems) expect(p.message).not.toContain(token)
  })
})

describe("redaction keeps ordinary words", () => {
  it("does not cut a weak sign's value from the warning that reports it", () => {
    const result = change({
      "machine/daedalus": entity("machine/daedalus", {
        body: "Ask for the password: person at the desk.\n",
      }),
    })
    expect(result.problems.map((p) => p.code)).toEqual(["secret-suspected"])
    expect(result.problems[0]?.message).toContain("a person confirms")
    expect(result.problems[0]?.message).toContain(
      "(password or key written as a value, passw…)",
    )
  })

  it("cuts a weak sign's value only where it was found", () => {
    const result = change({
      "machine/daedalus": entity("machine/daedalus", {
        facts: `${check()}    observed:\n      ups.model: X1\n`,
        body: "Set token: machine before the first run.\n",
      }),
    })
    expect(result.problems.map((p) => p.code).sort()).toEqual([
      "key-not-in-schema",
      "secret-suspected",
    ])
    const key = result.problems.find((p) => p.code === "key-not-in-schema")
    expect(key?.message).toContain("machine type schema")
  })

  it("still cuts a near-certain secret everywhere", () => {
    const token = "ghp_0123456789abcdefghijABCDEFGHIJ012345"
    const result = change({
      "machine/daedalus": entity("machine/daedalus", {
        body: `Token ${token}.\n`,
      }),
      "service/ingress": entity("service/ingress", {
        facts: `${check()}    observed:\n      runs-on: ${token}\n`,
      }),
    })
    for (const p of result.problems) expect(p.message).not.toContain(token)
  })
})

describe("limits in bytes", () => {
  it("measures a proposal text in UTF-8 bytes", () => {
    const text = "é".repeat(40 * 1024)
    expect(text.length).toBeLessThan(64 * 1024)
    const result = change({}, { texts: [{ label: "Explanation", text }] })
    expect(result.problems.map((p) => p.code)).toEqual(["too-large"])
  })
})
