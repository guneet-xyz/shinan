import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { sql } from "@shinan/db"

import {
  asAgent,
  asPerson,
  newPerson,
  testDatabase,
} from "../../../test/helpers.js"
import type { Person } from "../../identity/people.js"
import { createWorkspace } from "../../identity/workspaces.js"
import { purgeCatalogText } from "../purge/purge.js"
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

${prose(i, 1)}

## Cautions

Drain it before a restart.

${prose(i, 2)}

## Access prerequisites

${prose(i, 3)}
`
}

const vocabulary =
  "the a machine fleet worker queue drain restart deploy owner approval disk data backup restore network address host key access agent task stack service registry container image build release version check before after only never always when then while because so that this each every one two three logs metrics alert dashboard runbook policy decision project repository branch commit review merge test run script cron job timer volume mount path user group permission secret store vault rotate token expire renew certificate domain dns proxy route port firewall rule window maintenance upgrade rollback snapshot schedule weekly daily monthly ticket issue note caution warning".split(
    " ",
  )

/** About 100 words of prose that differ from document to document, like real bodies. */
function prose(i: number, part: number): string {
  let seed = i * 7919 + part * 104729
  const words: string[] = []
  for (let n = 0; n < 100; n++) {
    seed = (seed * 1103515245 + 12345) % 2147483648
    words.push(vocabulary[seed % vocabulary.length]!)
  }
  return words.join(" ").replace(/(([a-z]+ ){12})/g, "$1\n")
}

let owner: Person
let workspaceId: string
let agentId: string
let agentLabel: string
/** An agent writes the catalog, as during the trial, so every word has a provenance to keep. */
const actor = (): RevisionActor => ({
  kind: "agent",
  personId: owner.id,
  agentId,
  agentSessionId: null,
  label: agentLabel,
  confidence: "recorded",
})

beforeAll(async () => {
  owner = await newPerson(db, "owner")
  workspaceId = (await createWorkspace(asPerson(db, owner), { name: "Fleet" }))
    .workspace.id
  const agent = await asAgent(db, owner, workspaceId)
  if (agent.actor.kind !== "agent") throw new Error("Expected an agent")
  agentId = agent.actor.agentId
  agentLabel = `${owner.handle} via ${agent.actor.agentHandle}`
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
        // Only this workspace's: other tests use the same catalog IDs.
        sql`select document_id as id from catalog_index_documents where workspace_id = ${workspaceId} and catalog_id = 'machine/m7'`,
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
    const [size] = await db
      .execute<{ provenance: string; index: string }>(
        `select pg_size_pretty(pg_total_relation_size('catalog_index_provenance')) as provenance, pg_size_pretty(pg_total_relation_size('catalog_index_documents') + pg_total_relation_size('catalog_index_facts') + pg_total_relation_size('catalog_index_relations') + pg_total_relation_size('catalog_index_sections') + pg_total_relation_size('catalog_index_provenance')) as index`,
      )
      .then((r) => r.rows as [{ provenance: string; index: string }])
    console.info(
      `Storage: word provenance ${size.provenance}, whole index ${size.index} (the test database, all workspaces)`,
    )
    expect(rebuilt.documents).toBe(entities)
    expect(compared.differences).toEqual([])
  }, 300_000)

  it("purges a text from one page or from every page", async () => {
    const ctx = asPerson(db, owner)
    const [{ id }] = await db
      .execute<{ id: string }>(
        // Only this workspace's: other tests use the same catalog IDs.
        sql`select document_id as id from catalog_index_documents where workspace_id = ${workspaceId} and catalog_id = 'machine/m11'`,
      )
      .then((r) => r.rows as [{ id: string }])
    await db.transaction((tx) =>
      appendCatalogRevision(tx, workspaceId, actor(), [
        { documentId: id, text: machine(11, " The key is plum-otter-11.") },
      ]),
    )
    let started = performance.now()
    const one = await purgeCatalogText(ctx, workspaceId, {
      text: "plum-otter-11",
      reason: "A test of one page.",
    })
    const page = performance.now() - started
    started = performance.now()
    const all = await purgeCatalogText(ctx, workspaceId, {
      text: "Drain it before a restart.",
      reason: "A test of every page.",
    })
    const every = performance.now() - started
    console.info(
      `Purge: ${page.toFixed(0)} ms from one page, ${every.toFixed(0)} ms from every page, for ${entities} entities`,
    )
    expect(one.counts).toMatchObject({ documents: 1, latestDocuments: 1 })
    expect(all.counts).toMatchObject({ latestDocuments: entities })
    const compared = await db.transaction((tx) =>
      compareWorkspaceIndex(tx, workspaceId),
    )
    expect(compared.differences).toEqual([])
  }, 600_000)
})
