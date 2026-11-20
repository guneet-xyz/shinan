import { afterAll, beforeAll, describe, expect, it } from "vitest"

import * as fixtures from "../../test/catalog-index-fixtures.js"
import { asPerson, newPerson, testDatabase } from "../../test/helpers.js"
import { createMemoryGit } from "../../test/memory-git.js"
import { InvalidInputError } from "../errors.js"
import type { Person } from "../identity/people.js"
import { createWorkspace } from "../identity/workspaces.js"
import { readDocumentId } from "./document/parse.js"
import { updateWorkspaceIndex } from "./index/indexer.js"
import { listCatalogTypeIndex } from "./wiki.js"

const { db, pool } = testDatabase()

afterAll(async () => {
  await pool.end()
})

let owner: Person
let workspaceId: string

beforeAll(async () => {
  owner = await newPerson(db, "owner")
  workspaceId = (await createWorkspace(asPerson(db, owner), { name: "Wiki" }))
    .workspace.id
  const git = createMemoryGit()
  git.create(
    workspaceId,
    Object.fromEntries(
      fixtures.allDocuments.map((text) => [`${readDocumentId(text)}.md`, text]),
    ),
  )
  await updateWorkspaceIndex(db, git, workspaceId)
})

describe("the index per entity type", () => {
  it("lists a type's entities with their freshness summaries", async () => {
    const index = await listCatalogTypeIndex(asPerson(db, owner), workspaceId, {
      type: "machine",
    })
    expect(index.truncated).toBe(false)
    expect(index.index_behind).toBe(false)
    const musashi = index.items.find((i) => i.entity.id === "machine/musashi")
    expect(musashi?.entity).toMatchObject({ type: "machine", status: "active" })
    expect(musashi?.freshness).toMatchObject({
      facts: expect.any(Number) as number,
      unknown: expect.any(Number) as number,
    })
    expect(musashi!.freshness.facts).toBeGreaterThan(0)
    expect(musashi!.freshness.oldest_checked_at).toMatch(/^\d{4}-\d\d-\d\dT/)
    // Retired entities only when asked for.
    const retired = index.items.some((i) => i.entity.status === "retired")
    const all = await listCatalogTypeIndex(asPerson(db, owner), workspaceId, {
      type: "machine",
      includeRetired: true,
    })
    expect(retired).toBe(false)
    expect(all.items.length).toBeGreaterThan(index.items.length)
  })

  it("refuses malformed input", async () => {
    await expect(
      listCatalogTypeIndex(asPerson(db, owner), workspaceId, {
        type: "x\u0000",
      }),
    ).rejects.toBeInstanceOf(InvalidInputError)
  })
})
