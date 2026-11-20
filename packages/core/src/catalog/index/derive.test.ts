import { describe, expect, it } from "vitest"

import * as fixtures from "../../../test/catalog-index-fixtures.js"
import {
  freshness,
  parseCatalogDocument,
  readCatalog,
} from "../document/index.js"
import { readDocumentId } from "../document/parse.js"
import { deriveDocumentRows } from "./derive.js"
import type { FactRow } from "./derive.js"
import { factJson, freshnessJson, sectionJson } from "./format.js"

const catalog = readCatalog(fixtures.allDocuments)

function rowsOf(text: string) {
  return deriveDocumentRows({
    workspaceId: "00000000-0000-4000-8000-000000000001",
    path: `${readDocumentId(text)}.md`,
    blob: "0123456789abcdef0123456789abcdef01234567",
    document: parseCatalogDocument(text),
    registry: catalog.registry,
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

  it("keeps each body section's text and place, and nothing about who wrote it", () => {
    const rows = rowsOf(fixtures.musashi)
    expect(rows.sections.map((s) => [s.position, s.anchor])).toEqual([
      [0, null],
      [1, "musashi"],
      [2, "cautions"],
    ])
    expect(
      Object.keys(
        sectionJson({
          ...rows.sections[0]!,
          search: "",
          searchSimple: "",
        } as Parameters<typeof sectionJson>[0]),
      ).sort(),
    ).toEqual(["anchor", "heading", "level", "text"])
    expect(rows.document).toMatchObject({
      path: "machine/musashi.md",
      blob: "0123456789abcdef0123456789abcdef01234567",
    })
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

describe("readDocumentId", () => {
  it("reads the same ID as the full parse", () => {
    const texts = [
      ...fixtures.allDocuments,
      fixtures.machineExtension,
      '---\nid: "schema\\x2fdomain"\ntitle: D\n---\n',
      "---\n{ id: schema/area, title: Area }\n---\n",
      "---\nid: schema/a\nid: schema/b\n---\n",
      "---\nid: [schema/a]\n---\n",
      "---\nid: schema/a\n",
      "no frontmatter",
      `---\nid: schema/big\n---\n${"x".repeat(70_000)}`,
      "---\nid: schema/x\n  bad: indent\n---\n",
    ]
    for (const text of texts)
      expect(readDocumentId(text), text.slice(0, 40)).toBe(
        parseCatalogDocument(text).id,
      )
  })
})
