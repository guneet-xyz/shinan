import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { asPerson, newPerson, testDatabase } from "../../../test/helpers.js"
import { createMemoryGit } from "../../../test/memory-git.js"
import type { Person } from "../../identity/people.js"
import { createWorkspace } from "../../identity/workspaces.js"
import { compareWorkspaceIndex, updateWorkspaceIndex } from "./indexer.js"
import { getCatalogEntity, searchCatalog } from "./queries.js"
import { listDocuments, readTexts } from "./source.js"

/**
 * The index at the size it is built for: a catalog of a few thousand
 * entities (M2 build plan, M2-3). An update of `main` reads only what it
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
const git = createMemoryGit()

beforeAll(async () => {
  owner = await newPerson(db, "owner")
  workspaceId = (await createWorkspace(asPerson(db, owner), { name: "Fleet" }))
    .workspace.id
  git.create(
    workspaceId,
    Object.fromEntries(
      Array.from({ length: entities }, (_, i) => [
        `machine/m${i}.md`,
        machine(i),
      ]),
    ),
  )
  await updateWorkspaceIndex(db, git, workspaceId)
}, 300_000)

describe("a catalog of a few thousand entities", () => {
  it("indexes a one-document push without reading the rest", async () => {
    const started = performance.now()
    for (let n = 1; n <= 5; n++) {
      git.push(workspaceId, { "machine/m7.md": machine(7, ` Change ${n}.`) })
      git.calls.pathsRead.length = 0
      expect(await updateWorkspaceIndex(db, git, workspaceId)).toMatchObject({
        outcome: "updated",
        documents: 1,
      })
      expect(git.calls.pathsRead).toEqual(["machine/m7.md"])
    }
    const perPush = (performance.now() - started) / 5
    console.info(`One-document push: ${perPush.toFixed(0)} ms`)
    // Independent of the catalog's size: one document is read, not all.
    expect(perPush).toBeLessThan(500)
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

  it("rebuilds and checks the whole catalog from main", async () => {
    let started = performance.now()
    const rebuilt = await updateWorkspaceIndex(db, git, workspaceId, {
      rebuild: true,
    })
    const rebuild = performance.now() - started
    started = performance.now()
    const main = rebuilt.commit!
    const texts = await readTexts(
      git,
      workspaceId,
      main,
      await listDocuments(git, workspaceId, main),
    )
    const compared = await db.transaction((tx) =>
      compareWorkspaceIndex(tx, workspaceId, texts),
    )
    const check = performance.now() - started
    console.info(
      `Rebuild: ${rebuild.toFixed(0)} ms, check: ${check.toFixed(0)} ms for ${entities} entities`,
    )
    expect(rebuilt.documents).toBe(entities)
    expect(compared.differences).toEqual([])
  }, 300_000)
})
