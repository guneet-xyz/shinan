import { afterAll, beforeAll, describe, expect, it } from "vitest"

import * as fixtures from "../../test/catalog-index-fixtures.js"
import { asPerson, newPerson, testDatabase } from "../../test/helpers.js"
import { createMemoryGit } from "../../test/memory-git.js"
import { InvalidInputError, NotFoundError } from "../errors.js"
import type { Person } from "../identity/people.js"
import { createWorkspace } from "../identity/workspaces.js"
import { readDocumentId } from "./document/parse.js"
import { updateWorkspaceIndex } from "./index/indexer.js"
import {
  getCatalogState,
  listCatalogTree,
  listCatalogTypeIndex,
} from "./wiki.js"

const { db, pool } = testDatabase()

afterAll(async () => {
  await pool.end()
})

let owner: Person
let workspaceId: string
let git: ReturnType<typeof createMemoryGit>

beforeAll(async () => {
  owner = await newPerson(db, "owner")
  workspaceId = (await createWorkspace(asPerson(db, owner), { name: "Wiki" }))
    .workspace.id
  git = createMemoryGit()
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

describe("the catalog's tree", () => {
  it("lists every page but start here, by path, with titles and what needs attention", async () => {
    const tree = await listCatalogTree(asPerson(db, owner), workspaceId)
    expect(tree).toMatchObject({ index_behind: false })
    expect(tree.catalog_commit).toMatch(/^[0-9a-f]{40}$/)
    expect(tree.items.map((i) => i.path)).toEqual(
      fixtures.allDocuments
        .map((t) => `${readDocumentId(t)}.md`)
        .filter((p) => p !== "start-here.md")
        .sort(),
    )
    expect(tree.items.find((i) => i.path === "machine/musashi.md")).toEqual({
      path: "machine/musashi.md",
      id: "machine/musashi",
      title: "Musashi",
      kind: "entity",
      status: "active",
    })
    expect(tree.items.find((i) => i.path === "schema/domain.md")).toMatchObject(
      { kind: "schema", title: "Domain" },
    )
    // Musashi's disk sizes disagree and its IPv6 is unknown; the runbook's
    // last run is unknown; the domain is due for a recheck.
    expect(tree.attention).toBe(4)

    // A file whose name cannot be read needs attention too.
    git.push(workspaceId, { "machine/new\nline.md": fixtures.daedalus })
    await updateWorkspaceIndex(db, git, workspaceId)
    const after = await listCatalogTree(asPerson(db, owner), workspaceId)
    expect(after.attention).toBe(5)
    expect(after.items.find((i) => i.id === null)).toMatchObject({
      path: "machine/new\nline.md",
      title: null,
    })
  })

  it("gives where the catalog stands on its own", async () => {
    const tree = await listCatalogTree(asPerson(db, owner), workspaceId)
    expect(await getCatalogState(asPerson(db, owner), workspaceId)).toEqual({
      catalog_commit: tree.catalog_commit,
      index_behind: false,
    })
  })

  it("is for the workspace's members only", async () => {
    const stranger = await newPerson(db, "stranger")
    await expect(
      getCatalogState(asPerson(db, stranger), workspaceId),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      listCatalogTree(asPerson(db, stranger), workspaceId),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
