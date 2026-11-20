import { afterAll, beforeAll, describe, expect, it } from "vitest"

import * as fixtures from "../../test/catalog-index-fixtures.js"
import { asPerson, newPerson, testDatabase } from "../../test/helpers.js"
import { NotFoundError } from "../errors.js"
import { addMember } from "../identity/members.js"
import type { Person } from "../identity/people.js"
import { createWorkspace } from "../identity/workspaces.js"
import { appendCatalogRevision, findCatalogDocument } from "./revisions.js"
import type { RevisionActor, RevisionDocument } from "./revisions.js"
import {
  getCatalogDocumentText,
  listCatalogHistory,
  listCatalogTypeIndex,
} from "./wiki.js"

const { db, pool } = testDatabase()

afterAll(async () => {
  await pool.end()
})

let owner: Person
let contributor: Person
let workspaceId: string

function actorOf(person: Person): RevisionActor {
  return {
    kind: "person",
    personId: person.id,
    agentId: null,
    agentSessionId: null,
    label: person.handle,
    confidence: "recorded",
  }
}

async function apply(documents: RevisionDocument[], person = owner) {
  return db.transaction((tx) =>
    appendCatalogRevision(tx, workspaceId, actorOf(person), documents),
  )
}

async function documentId(catalogId: string): Promise<string> {
  const id = await db.transaction((tx) =>
    findCatalogDocument(tx, workspaceId, catalogId),
  )
  if (!id) throw new Error(`No document ${catalogId}`)
  return id
}

beforeAll(async () => {
  owner = await newPerson(db, "owner")
  contributor = await newPerson(db, "contributor")
  workspaceId = (await createWorkspace(asPerson(db, owner), { name: "Wiki" }))
    .workspace.id
  await addMember(asPerson(db, owner), {
    workspaceId,
    personId: contributor.id,
    role: "contributor",
  })
  await apply(fixtures.allDocuments.map((text) => ({ text })))
  // Musashi's disk grows: a second revision of one document.
  await apply(
    [
      {
        documentId: await documentId("machine/musashi"),
        text: fixtures.musashi.replace(
          "disk.data.free: 74 GiB",
          "disk.data.free: 70 GiB",
        ),
      },
    ],
    contributor,
  )
})

describe("a page's history (human experience: History)", () => {
  it("lists the revisions that changed a document, newest first, with who made them", async () => {
    const history = await listCatalogHistory(asPerson(db, owner), workspaceId, {
      id: "machine/musashi",
    })
    expect(history).toMatchObject({
      catalog_revision: 2,
      index_behind: false,
      id: "machine/musashi",
      kind: "entity",
      next_before: null,
    })
    expect(
      history.items.map((i) => [i.revision, i.changed_by, i.changed_by_kind]),
    ).toEqual([
      [2, contributor.handle, "person"],
      [1, owner.handle, "person"],
    ])
    const page = await listCatalogHistory(asPerson(db, owner), workspaceId, {
      id: "machine/musashi",
      limit: 1,
    })
    expect(page.items.map((i) => i.revision)).toEqual([2])
    expect(page.next_before).toBe(2)
    const older = await listCatalogHistory(asPerson(db, owner), workspaceId, {
      id: "machine/musashi",
      before: 2,
    })
    expect(older.items.map((i) => i.revision)).toEqual([1])
  })

  it("finds type schema documents and the start-here document too", async () => {
    for (const id of ["schema/domain", "start-here"]) {
      const history = await listCatalogHistory(
        asPerson(db, owner),
        workspaceId,
        { id },
      )
      expect(history.items.map((i) => i.revision)).toEqual([1])
    }
  })

  it("gives a document's text at any revision, for comparing", async () => {
    const now = await getCatalogDocumentText(asPerson(db, owner), workspaceId, {
      id: "machine/musashi",
    })
    expect(now.revision).toBe(2)
    expect(now.text).toContain("disk.data.free: 70 GiB")
    const then = await getCatalogDocumentText(
      asPerson(db, owner),
      workspaceId,
      { id: "machine/musashi", revision: 1 },
    )
    expect(then).toMatchObject({ revision: 1, changed_by: owner.handle })
    expect(then.text).toBe(fixtures.musashi)
    // A revision that did not change it gives the text it had then.
    const unchanged = await getCatalogDocumentText(
      asPerson(db, owner),
      workspaceId,
      { id: "project/dockyard", revision: 2 },
    )
    expect(unchanged.revision).toBe(1)
  })

  it("refuses unknown documents and malformed input", async () => {
    const ctx = asPerson(db, owner)
    await expect(
      listCatalogHistory(ctx, workspaceId, { id: "machine/nowhere" }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      getCatalogDocumentText(ctx, workspaceId, {
        id: "machine/musashi",
        revision: 0,
      }),
    ).rejects.toThrow(/revision/)
    await expect(
      listCatalogHistory(ctx, workspaceId, { id: "x\u0000" }),
    ).rejects.toThrow(/catalog ID/)
  })
})

describe("the index per entity type", () => {
  it("lists a type's entities with their freshness summaries", async () => {
    const index = await listCatalogTypeIndex(asPerson(db, owner), workspaceId, {
      type: "machine",
    })
    expect(index.truncated).toBe(false)
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
    expect(all.items.length).toBeGreaterThanOrEqual(index.items.length)
  })
})
