import { describe, expect, it } from "vitest"

import * as fixtures from "../../../test/catalog-index-fixtures.js"
import {
  expectationOf,
  parseCatalogDocument,
  prepareCatalogValidation,
  readCatalog,
} from "../document/index.js"
import type {
  CatalogDocument,
  CatalogOperation,
  CheckInput,
} from "../document/index.js"
import { isGated } from "./classify.js"
import { estimatedBytes } from "./estimate.js"
import { prepareChange } from "./work.js"
import type { Prepared } from "./work.js"

const today = new Date().toISOString().slice(0, 10)
const check: CheckInput = {
  checked: today,
  scope: "A test check",
  source: "The test",
}

/** Guneet's person entity, linked to the member `guneet`. */
const guneet = `---
id: person/guneet
type: person
title: Guneet
summary: Owner of the workspace.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-10
    by: guneet
    scope: Membership
    source: Shinan
    observed:
      member: guneet
---

# Guneet
`

const documents = [
  guneet,
  ...fixtures.allDocuments.filter((d) => d !== fixtures.guneet),
]
const stored = documents.map((text, i) => ({
  documentId: `document-${i}`,
  document: parseCatalogDocument(text),
}))
const catalog = readCatalog(stored.map((s) => s.document))
const now = Date.now()

function prepare(...operations: CatalogOperation[]) {
  return prepareChange(stored, {
    operations,
    by: "guneet via opencode-daedalus",
    explanation: "A test change",
    now,
    memberHandles: ["guneet"],
    approver: { handle: "guneet", preview: false },
  })
}

function ready(...operations: CatalogOperation[]) {
  const result = prepare(...operations)
  if (result.outcome !== "ready")
    throw new Error(`Not ready: ${JSON.stringify(result, null, 2)}`)
  return result
}

function bodyOf(id: string): string {
  return catalog.entities.get(id)!.document.body.text
}

function present(id: string, key: string, via?: string) {
  const fact = catalog.entities
    .get(id)!
    .facts.find((f) => f.key === key && (via === undefined || f.via === via))
  if (!fact) throw new Error(`No fact ${key} on ${id}`)
  return expectationOf(fact)
}

const field = (
  document: string,
  name: "title" | "summary" | "status" | "owner" | "decision_state",
  value: string,
  expected: string | null,
): CatalogOperation => ({
  op: "set-field",
  document,
  field: name,
  value,
  expect: { value: expected },
})

describe("preparing a proposal in the catalog worker", () => {
  it("maps each written document to its stored ID, and new ones to null", () => {
    const result = ready(
      {
        op: "edit-body",
        document: "machine/daedalus",
        text: "# Daedalus\n\nAgents work here, and so do people.\n",
        expect: { text: bodyOf("machine/daedalus") },
      },
      {
        op: "create-entity",
        id: "machine/kojiro",
        title: "Kojiro",
        summary: "A new machine.",
        owner: "person/guneet",
      },
    )
    const daedalus = stored.find((s) => s.document.id === "machine/daedalus")!
    expect(result.documents.map((d) => d.documentId)).toEqual([
      daedalus.documentId,
      null,
    ])
    expect(result.documents[0]!.parsed.text).toBe(result.documents[0]!.text)
    expect(result.touches).toEqual(["machine/daedalus", "machine/kojiro"])
    const bytes = (text: string) => Buffer.byteLength(text, "utf8")
    const before = stored.reduce((n, d) => n + bytes(d.document.text), 0)
    // Each document with what its validation keeps.
    const estimate = (documents: readonly CatalogDocument[]) => {
      const v = prepareCatalogValidation(readCatalog(documents), {
        now,
        memberHandles: new Set(["guneet"]),
      })
      return documents.reduce((n, d) => n + estimatedBytes(d, v.counts(d)), 0)
    }
    const after = [
      ...stored.map((s) =>
        s === daedalus ? result.documents[0]!.parsed : s.document,
      ),
      result.documents[1]!.parsed,
    ]
    expect(result.size).toEqual({
      bytesBefore: before,
      bytes:
        before -
        bytes(daedalus.document.text) +
        bytes(result.documents[0]!.text) +
        bytes(result.documents[1]!.text),
      documentsBefore: stored.length,
      documents: stored.length + 1,
      estimatedBefore: estimate(stored.map((s) => s.document)),
      estimated: estimate(after),
    })
    expect(result.size.estimatedBefore).toBeGreaterThan(
      stored.reduce((n, d) => n + estimatedBytes(d.document), 0),
    )
  })

  it("reports conflicts and invalid operations without validating", () => {
    const result = prepare({
      op: "remove-fact",
      document: "machine/musashi",
      expect: { ...present("machine/musashi", "role"), value: "Spare" },
    })
    expect(result).toMatchObject({
      outcome: "problems",
      problems: [{ operation: 0, kind: "conflict", code: "fact-changed" }],
    })
  })

  it("is blocked by a near-certain secret, also in the explanation", () => {
    const token = `ghp_${"A1b2C3d4".repeat(5)}`
    const blocked = prepareChange(stored, {
      operations: [
        field(
          "machine/daedalus",
          "summary",
          "Dev host",
          "Development host where agents work.",
        ),
      ],
      by: "guneet",
      explanation: `The token is ${token}`,
      now: Date.now(),
      memberHandles: ["guneet"],
    })
    expect(blocked).toMatchObject({
      outcome: "blocked",
      problems: [{ code: "secret" }],
    })
    expect(JSON.stringify(blocked)).not.toContain(token)
  })

  it("says when nothing would change", () => {
    expect(
      prepare(field("machine/daedalus", "title", "Daedalus", "Daedalus")),
    ).toEqual({ outcome: "unchanged" })
  })
})

const accept: CatalogOperation = {
  op: "accept-discrepancy",
  document: "machine/musashi",
  key: "disk.data.size",
  note: "Metadata lags after a resize",
  expect: [
    present("machine/musashi", "disk.data.size", "filesystem"),
    present("machine/musashi", "disk.data.size", "instance-metadata"),
  ],
}

describe("accepting a discrepancy (catalog §4.7)", () => {
  const withApprover = (approver?: { handle: string; preview: boolean }) =>
    prepareChange(stored, {
      operations: [accept],
      by: "guneet via opencode-daedalus",
      explanation: "Accept it.",
      now: Date.now(),
      memberHandles: ["guneet"],
      ...(approver ? { approver } : {}),
    })

  it("names the approving person's entity, found by its member fact", () => {
    const result = withApprover({ handle: "guneet", preview: false })
    if (result.outcome !== "ready") throw new Error(result.outcome)
    const musashi = result.documents[0]!.text
    expect(musashi).toContain("accepted: person/guneet")
  })

  it("needs an approver with a person entity", () => {
    expect(withApprover()).toMatchObject({
      outcome: "problems",
      problems: [{ code: "needs-approval" }],
    })
    expect(withApprover({ handle: "kojiro", preview: false })).toMatchObject({
      outcome: "problems",
      problems: [{ operation: 0, code: "needs-approval" }],
    })
  })

  it("lets a member's person stand in before anyone approves", () => {
    expect(withApprover({ handle: "kojiro", preview: true })).toMatchObject({
      outcome: "ready",
      accepts: [{ entityId: "person/guneet" }],
    })
  })
})

describe("approval classes (catalog §8.2)", () => {
  const classesOf = (...operations: CatalogOperation[]) =>
    ready(...operations).classes

  it("a recheck: a new fact check, values unchanged", () => {
    expect(
      classesOf({
        op: "recheck-facts",
        document: "machine/daedalus",
        facts: [present("machine/daedalus", "hostname")],
        check,
      }),
    ).toEqual(["recheck"])
  })

  it("observed and unknown facts, intended facts and planned facts", () => {
    expect(
      classesOf({
        op: "set-fact",
        document: "machine/daedalus",
        fact: { key: "role", state: "observed", value: "Build host" },
        check,
        expect: present("machine/daedalus", "role"),
      }),
    ).toEqual(["observed-or-unknown"])
    expect(
      classesOf({
        op: "remove-fact",
        document: "machine/musashi",
        expect: present("machine/musashi", "network.public_ipv6"),
      }),
    ).toEqual(["observed-or-unknown"])
    expect(
      classesOf({
        op: "set-fact",
        document: "machine/daedalus",
        fact: { key: "platform.os", state: "intended", value: "Debian 13" },
        check,
        expect: { identity: "platform.os|intended", absent: true },
      }),
    ).toEqual(["intended"])
    expect(
      classesOf({
        op: "set-fact",
        document: "machine/daedalus",
        fact: {
          key: "platform.os",
          state: "planned",
          value: "Debian 14",
          task: "T-3",
        },
        expect: { identity: "platform.os|planned", absent: true },
      }),
    ).toEqual(["planned"])
  })

  it("body and bookkeeping: body, title, summary and new entities", () => {
    expect(
      classesOf(field("machine/daedalus", "title", "Daedalus II", "Daedalus")),
    ).toEqual(["body-and-bookkeeping"])
    expect(
      classesOf({
        op: "create-entity",
        id: "machine/kojiro",
        title: "Kojiro",
        summary: "A new machine.",
        owner: "person/guneet",
        facts: [
          { fact: { key: "role", state: "observed", value: "Spare" }, check },
        ],
      }),
    ).toEqual(["observed-or-unknown", "body-and-bookkeeping"])
  })

  it("rules: policies, settled decisions, type schemas and start-here are gated", () => {
    const policy = ready(
      field(
        "policy/no-secrets",
        "summary",
        "No secrets.",
        "Secret values never go in the catalog.",
      ),
    )
    expect(policy.classes).toEqual(["body-and-bookkeeping", "rules"])
    expect(policy.reasons).toEqual(["Changes the policy policy/no-secrets"])
    expect(isGated(policy.classes)).toBe(true)

    expect(
      classesOf({
        op: "set-schema-key",
        document: "schema/domain",
        key: "renews",
        options: {},
        expect: { absent: true },
      }),
    ).toEqual(["rules"])
    expect(
      classesOf({
        op: "set-start-here-path",
        path: "people",
        steps: [{ to: "machine/daedalus", note: "Where agents work." }],
        expect: {
          steps: [{ to: "machine/musashi", note: "The production host." }],
        },
      }),
    ).toEqual(["rules"])

    const decision = ready({
      op: "create-entity",
      id: "decision/use-shinan",
      title: "Use Shinan",
      summary: "The team uses Shinan.",
      owner: "person/guneet",
      decision: {
        state: "accepted",
        decidedOn: "2026-11-01",
        decidedBy: "person/guneet",
      },
    })
    expect(decision.classes).toContain("rules")
    expect(decision.reasons).toEqual([
      "Records the decision decision/use-shinan as accepted",
    ])
    expect(
      classesOf({
        op: "create-entity",
        id: "decision/maybe",
        title: "Maybe",
        summary: "Still open.",
        owner: "person/guneet",
        decision: { state: "proposed" },
      }),
    ).toEqual(["body-and-bookkeeping"])
  })

  it("lifecycle: deprecate, retire, change ID and change owner are gated", () => {
    expect(
      ready(field("machine/daedalus", "status", "deprecated", "active"))
        .reasons,
    ).toEqual([
      "Changes the status of machine/daedalus from active to deprecated",
    ])
    expect(
      classesOf({
        op: "retire",
        document: "machine/daedalus",
        expect: { status: "active" },
      }),
    ).toEqual(["lifecycle"])
    expect(
      ready({
        op: "change-id",
        document: "machine/daedalus",
        id: "machine/icarus",
      }).reasons,
    ).toEqual(["Changes the ID machine/daedalus to machine/icarus"])
    const owner = ready({
      op: "create-entity",
      id: "person/kojiro",
      title: "Kojiro",
      summary: "A colleague.",
      owner: "person/guneet",
    })
    expect(owner.classes).toEqual(["body-and-bookkeeping", "people-and-agents"])
  })

  it("people and agents: any change to a person or agent entity is gated", () => {
    expect(
      ready(field("person/guneet", "title", "Guneet S", "Guneet")).classes,
    ).toEqual(["body-and-bookkeeping", "people-and-agents"])
  })

  it("doubtful: accepting a discrepancy, and any validation warning", () => {
    const accepted = ready(accept)
    expect(accepted.classes).toContain("doubtful")
    expect(accepted.reasons).toEqual([
      "Accepts a discrepancy on machine/musashi",
    ])
    expect(accepted.accepts).toEqual([
      { entityId: "person/guneet", memberHandles: ["guneet"] },
    ])

    const warned = ready({
      op: "set-fact",
      document: "machine/daedalus",
      fact: { key: "favourite-colour", state: "observed", value: "blue" },
      check,
      expect: { identity: "favourite-colour|observed", absent: true },
    })
    expect(warned.classes).toEqual(["observed-or-unknown", "doubtful"])
    expect(warned.warnings.map((w) => w.code)).toEqual(["key-not-in-schema"])
    expect(warned.reasons[0]).toMatch(/^machine\/daedalus: /)
  })

  it("an older fact check than the current one is doubtful", () => {
    const result: Prepared = prepare({
      op: "recheck-facts",
      document: "machine/daedalus",
      facts: [present("machine/daedalus", "hostname")],
      check: { ...check, checked: "2020-01-01" },
    })
    expect(result).toMatchObject({
      outcome: "ready",
      classes: ["recheck", "doubtful"],
    })
  })
})
