import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { asPerson, newPerson, testDatabase } from "../../../test/helpers.js"
import type { Person } from "../../identity/people.js"
import { createWorkspace } from "../../identity/workspaces.js"
import { appendCatalogRevision } from "../revisions.js"
import type { RevisionActor } from "../revisions.js"
import { compareWorkspaceIndex, rebuildWorkspaceIndex } from "./indexer.js"
import { getCatalogEntity, searchCatalog } from "./queries.js"

/**
 * The index at the size it is built for: a catalog of a few thousand
 * entities (M2 build plan, M2-3). Applying a revision reads only what it
 * changes, so it stays fast however large the catalog is; a rebuild reads
 * everything once.
 */

const { db, pool } = testDatabase()

afterAll(async () => {
  await pool.end()
})

/**
 * 500 by default, to keep the test run short and light; set SHINAN_SCALE_ENTITIES to
 * measure larger catalogs.
 */
const entities = Number(process.env.SHINAN_SCALE_ENTITIES ?? 500)

function machine(i: number, extra = ""): string {
  return `---
id: machine/m${i}
type: machine
title: Machine ${i}
summary: Machine number ${i} of the fleet.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-14
    by: guneet
    scope: Platform and disks
    source: Read-only SSH
    observed:
      role: Worker ${i}
      environment: production
      platform.os: Ubuntu 24.04
      disk.data.size: ${i} GiB
      disk.data.free: ${i % 50} GiB
  - unknown:
      access.method: Not checked
---

# Machine ${i}

Runs batch work for the fleet.${extra}

## Cautions

Drain it before a restart.
`
}

let owner: Person
let workspaceId: string
const actor = (): RevisionActor => ({
  kind: "person",
  personId: owner.id,
  agentId: null,
  agentSessionId: null,
  label: owner.handle,
  confidence: "recorded",
})

beforeAll(async () => {
  owner = await newPerson(db, "owner")
  workspaceId = (await createWorkspace(asPerson(db, owner), { name: "Fleet" }))
    .workspace.id
  const documents = Array.from({ length: entities }, (_, i) => ({
    text: machine(i),
  }))
  await db.transaction((tx) =>
    appendCatalogRevision(tx, workspaceId, actor(), documents),
  )
}, 300_000)

describe("a catalog of a few thousand entities", () => {
  it("applies a one-document revision without reading the rest", async () => {
    const [{ id }] = await db
      .execute<{ id: string }>(
        `select document_id as id from catalog_index_documents where catalog_id = 'machine/m7'`,
      )
      .then((r) => r.rows as [{ id: string }])
    const started = performance.now()
    for (let n = 1; n <= 5; n++)
      await db.transaction((tx) =>
        appendCatalogRevision(tx, workspaceId, actor(), [
          { documentId: id, text: machine(7, ` Change ${n}.`) },
        ]),
      )
    const perRevision = (performance.now() - started) / 5
    console.info(`One-document revision: ${perRevision.toFixed(0)} ms`)
    // Independent of the catalog's size: a few documents are read, not all.
    expect(perRevision).toBeLessThan(500)
  })

  it("answers reads quickly", async () => {
    const ctx = asPerson(db, owner)
    let started = performance.now()
    const last = entities - 1
    const entity = await getCatalogEntity(ctx, workspaceId, {
      id: `machine/m${last}`,
    })
    const get = performance.now() - started
    started = performance.now()
    const found = await searchCatalog(ctx, workspaceId, {
      text: `worker ${last}`,
    })
    const search = performance.now() - started
    console.info(`Get: ${get.toFixed(0)} ms, search: ${search.toFixed(0)} ms`)
    expect(entity.entity.facts).toHaveLength(6)
    expect(found.items[0]?.entity.id).toBe(`machine/m${last}`)
    expect(get).toBeLessThan(500)
    expect(search).toBeLessThan(1000)
  })

  it("rebuilds and checks the whole catalog from its text", async () => {
    let started = performance.now()
    const rebuilt = await db.transaction((tx) =>
      rebuildWorkspaceIndex(tx, workspaceId),
    )
    const rebuild = performance.now() - started
    started = performance.now()
    const compared = await db.transaction((tx) =>
      compareWorkspaceIndex(tx, workspaceId),
    )
    const check = performance.now() - started
    console.info(
      `Rebuild: ${rebuild.toFixed(0)} ms, check: ${check.toFixed(0)} ms for ${entities} entities`,
    )
    expect(rebuilt.documents).toBe(entities)
    expect(compared.differences).toEqual([])
  }, 300_000)
})
