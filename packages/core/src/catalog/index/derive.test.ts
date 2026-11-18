import { describe, expect, it } from "vitest"

import * as fixtures from "../../../test/catalog-index-fixtures.js"
import {
  freshness,
  parseCatalogDocument,
  readCatalog,
} from "../document/index.js"
import { attributeSections } from "./attribution.js"
import { deriveDocumentRows } from "./derive.js"
import type { FactRow } from "./derive.js"
import { factJson, freshnessJson } from "./format.js"

const catalog = readCatalog(fixtures.allDocuments)

function rowsOf(text: string) {
  const document = parseCatalogDocument(text)
  return deriveDocumentRows({
    workspaceId: "00000000-0000-4000-8000-000000000001",
    documentId: "00000000-0000-4000-8000-000000000002",
    revision: 3,
    document,
    registry: catalog.registry,
    attribution: attributeSections([], document.body.sections, {
      revision: 3,
      authorKind: "person",
      author: "guneet",
    }),
  })
}

/** A stored fact row, as read back. */
function stored(row: FactRow) {
  return {
    ...row,
    value: row.value ?? null,
    checkedAt: row.checkedAt ?? null,
    dueAt: row.dueAt ?? null,
    recheckDays: row.recheckDays ?? null,
  } as Parameters<typeof factJson>[0]
}

describe("deriveDocumentRows", () => {
  it("gives the same rows for the same text", () => {
    expect(rowsOf(fixtures.musashi)).toEqual(rowsOf(fixtures.musashi))
  })

  it("keeps a fact's long form and its fact check", () => {
    const { facts } = rowsOf(fixtures.musashi)
    expect(facts[3]).toMatchObject({
      identity: "disk.data.size|observed|via=instance-metadata",
      value: ["64 GB"],
      via: "instance-metadata",
      note: "Metadata lags after a resize",
      groupIndex: 1,
      hasCheck: true,
      checked: "2026-11-14",
      checkedAt: new Date("2026-11-14T00:00:00Z"),
      dueAt: new Date("2026-12-14T00:00:00Z"),
    })
    expect(facts[4]).toMatchObject({
      state: "unknown",
      value: null,
      note: "Reachability not tested",
      hasCheck: false,
      inSchema: false,
    })
  })

  it("writes relations once, with the inverse their target shows, and the owner as a field", () => {
    const { relations } = rowsOf(fixtures.dockyard)
    expect(
      relations.map((r) => [r.key, r.toId, r.inverse, r.field, r.attributes]),
    ).toEqual([
      [
        "checkout-on",
        "machine/daedalus",
        "checkouts",
        false,
        { path: "/root/dockyard" },
      ],
      [
        "checkout-on",
        "machine/takezo-old",
        "checkouts",
        false,
        { path: "/mnt/stacks/dockyard" },
      ],
      ["provides", "service/container-registry", "provided by", false, {}],
      ["owner", "person/guneet", "owns", true, {}],
    ])
  })

  it("makes IDs and fact values searchable", () => {
    const { document } = rowsOf(fixtures.musashi)
    expect(document.searchText).toContain("machine musashi")
    expect(document.searchText).toContain("instance-metadata")
    expect(document.searchText).toContain("machine/takezo-old")
  })

  it("keeps a type schema document's resolved schema and the start-here paths", () => {
    expect(rowsOf(fixtures.domainSchema).document).toMatchObject({
      kind: "schema",
      type: "domain",
      data: { schema: { type: "domain", document: "schema/domain" } },
    })
    expect(rowsOf(fixtures.startHere).document.data).toEqual({
      people: [{ to: "machine/musashi", note: "The production host." }],
      agents: [
        {
          to: "policy/deploy-approval",
          note: "Follow it before touching any machine.",
        },
        { list: "discrepancies", note: "Facts that disagree." },
        {
          url: "https://git.guneet.dev/guneet/workspace",
          note: "The workspace repository, during the trial.",
        },
      ],
    })
  })

  it("refuses credits that do not match the sections", () => {
    const document = parseCatalogDocument(fixtures.musashi)
    expect(() =>
      deriveDocumentRows({
        workspaceId: "w",
        documentId: "d",
        revision: 1,
        document,
        registry: catalog.registry,
        attribution: [],
      }),
    ).toThrow(/credit/)
  })
})

describe("freshness when read", () => {
  it("agrees with the document model's freshness for every fact", () => {
    for (const now of [
      Date.UTC(2026, 10, 18),
      Date.UTC(2027, 5, 1),
      Date.UTC(2019, 0, 1),
    ]) {
      for (const entity of catalog.entities.values()) {
        const { facts } = rowsOf(entity.document.text)
        entity.facts.forEach((fact, i) => {
          const expected = freshness(fact, now)
          expect(freshnessJson(stored(facts[i]!), now)).toEqual({
            status: expected.status,
            age_days: expected.ageDays,
            recheck_days: expected.recheckDays,
            due_at:
              expected.dueAt === null || expected.status === "not-checked"
                ? null
                : new Date(expected.dueAt).toISOString(),
          })
        })
      }
    }
  })

  it("writes only the long-form fields a fact has", () => {
    const { facts } = rowsOf(fixtures.registry)
    const planned = factJson(stored(facts[1]!), Date.UTC(2026, 10, 18))
    expect(planned).toEqual({
      identity: "endpoint|planned|value=https://registry.guneet.dev",
      key: "endpoint",
      state: "planned",
      value: "https://registry.guneet.dev",
      task: "T-12",
      many: true,
      relation: false,
      in_schema: true,
      check: null,
      freshness: {
        status: "none",
        age_days: null,
        recheck_days: 30,
        due_at: null,
      },
    })
  })
})
