import { afterAll, beforeAll, describe, expect, it } from "vitest"

import * as fixtures from "../../test/catalog-index-fixtures.js"
import { asPerson, newPerson, testDatabase } from "../../test/helpers.js"
import { createMemoryGit } from "../../test/memory-git.js"
import {
  InvalidInputError,
  NotFoundError,
  UnavailableError,
} from "../errors.js"
import type { Person } from "../identity/people.js"
import { createWorkspace } from "../identity/workspaces.js"
import { readDocumentId } from "./document/parse.js"
import { updateWorkspaceIndex } from "./index/indexer.js"
import {
  getCatalogDocument,
  getCatalogPageHistory,
  getCatalogPageSource,
  getCatalogReadme,
  historyCursors,
} from "./pages.js"

const { db, pool } = testDatabase()

afterAll(async () => {
  await pool.end()
})

let owner: Person
let stranger: Person
let workspaceId: string
let git: ReturnType<typeof createMemoryGit>
/** Musashi's changes, oldest first. */
const musashiChanges: string[] = []
let indexed: string

beforeAll(async () => {
  owner = await newPerson(db, "owner")
  stranger = await newPerson(db, "stranger")
  workspaceId = (await createWorkspace(asPerson(db, owner), { name: "Pages" }))
    .workspace.id
  git = createMemoryGit()
  musashiChanges.push(
    git.create(workspaceId, {
      ...Object.fromEntries(
        fixtures.allDocuments.map((text) => [
          `${readDocumentId(text)}.md`,
          text,
        ]),
      ),
      "README.md": "# Our catalog\n\nRead me \u202Efirst.\n",
    }),
  )
  for (let i = 1; i <= 4; i++) {
    musashiChanges.push(
      git.push(
        workspaceId,
        { "machine/musashi.md": `${fixtures.musashi}\nRevision ${i}.\n` },
        `Recheck Musashi, ${i}`,
      ),
    )
    // A change to another page, not in Musashi's history.
    git.push(
      workspaceId,
      { "machine/daedalus.md": `${fixtures.daedalus}\nRevision ${i}.\n` },
      `Recheck Daedalus, ${i}`,
    )
  }
  indexed = (await git.getRepository(workspaceId))!.main
  await updateWorkspaceIndex(db, git, workspaceId)
})

describe("documents as pages", () => {
  it("reads the start-here and type schema documents with their bodies", async () => {
    const start = await getCatalogDocument(asPerson(db, owner), workspaceId, {
      id: "start-here",
    })
    expect(start.document).toMatchObject({
      id: "start-here",
      kind: "start-here",
      path: "start-here.md",
      title: "Start here",
      summary: "The short path through this catalog.",
    })
    expect(start.document.body).toContainEqual(
      expect.objectContaining({ heading: "Start here", level: 1 }),
    )
    const schemaPage = await getCatalogDocument(
      asPerson(db, owner),
      workspaceId,
      { id: "schema/domain" },
    )
    expect(schemaPage.document).toMatchObject({
      kind: "schema",
      path: "schema/domain.md",
    })
  })

  it("leaves entities to their own answer, and is for members only", async () => {
    await expect(
      getCatalogDocument(asPerson(db, owner), workspaceId, {
        id: "machine/musashi",
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      getCatalogDocument(asPerson(db, stranger), workspaceId, {
        id: "start-here",
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe("a page's history", () => {
  const cursors = historyCursors("test key")
  const history = (
    input: { after?: string; limit?: number; id?: string },
    who = owner,
    workspace = workspaceId,
  ) =>
    getCatalogPageHistory(
      asPerson(db, who),
      git,
      workspace,
      { id: "machine/musashi", ...input },
      cursors,
    )

  it("lists the changes of its file, newest first, by signed cursor", async () => {
    const first = await history({ limit: 2 })
    expect(first).toMatchObject({
      catalog_commit: indexed,
      path: "machine/musashi.md",
      title: "Musashi",
    })
    expect(first.changes.map((c) => c.subject)).toEqual([
      "Recheck Musashi, 4",
      "Recheck Musashi, 3",
    ])
    expect(first.changes[0]).toMatchObject({
      commit: musashiChanges[4],
      body: "",
      merge: false,
      pushed_by: null,
    })
    expect(first.changes[0]!.time).toMatch(/^\d{4}-\d\d-\d\dT/)
    expect(
      cursors.read(first.next_after!, {
        workspaceId,
        path: "machine/musashi.md",
      }),
    ).toEqual({ start: indexed, position: 2 })

    const second = await history({ limit: 2, after: first.next_after! })
    expect(second.changes.map((c) => c.subject)).toEqual([
      "Recheck Musashi, 2",
      "Recheck Musashi, 1",
    ])
    const last = await history({ limit: 2, after: second.next_after! })
    expect(last.changes.map((c) => c.commit)).toEqual([musashiChanges[0]])
    expect(last.next_after).toBeNull()
  })

  it("stands at the commit the index is at, not a newer main", async () => {
    git.push(
      workspaceId,
      { "machine/musashi.md": `${fixtures.musashi}\nNot indexed yet.\n` },
      "Not indexed yet",
    )
    expect((await history({ limit: 1 })).changes[0]!.subject).toBe(
      "Recheck Musashi, 4",
    )
    git.setMain(workspaceId, indexed)
  })

  it("starts only from a cursor Shinan gave out for this page, never a branch's commit", async () => {
    // A commit only on a branch: made, then `main` is back where it was.
    const branchOnly = git.push(
      workspaceId,
      { "machine/musashi.md": `${fixtures.musashi}\nSecret plan.\n` },
      "Branch only: secret plan to retire Musashi",
    )
    git.setMain(workspaceId, indexed)
    const path = "machine/musashi.md"
    const refused = [
      branchOnly,
      `${branchOnly}.forged`,
      `${branchOnly}.1.forged`,
      // Signed, but by another key, or for another page or workspace.
      historyCursors("other key").issue({
        workspaceId,
        path,
        start: branchOnly,
        position: 1,
      }),
      cursors.issue({
        workspaceId,
        path: "machine/daedalus.md",
        start: branchOnly,
        position: 1,
      }),
      cursors.issue({
        workspaceId: "22222222-2222-4222-8222-222222222222",
        path,
        start: branchOnly,
        position: 1,
      }),
      // A commit of `main` itself, not given out as a cursor.
      musashiChanges[3]!,
      "main",
      "x".repeat(300),
    ]
    for (const after of refused)
      await expect(history({ after }), after).rejects.toBeInstanceOf(
        InvalidInputError,
      )
    const all = await history({})
    expect(all.changes.map((c) => c.subject)).not.toContain(
      "Branch only: secret plan to retire Musashi",
    )
  })

  it("sends a change's first line and a short start of the rest", async () => {
    const subject = "s".repeat(800)
    const body = "b".repeat(5000)
    git.push(
      workspaceId,
      { "machine/musashi.md": `${fixtures.musashi}\nLong message.\n` },
      `${subject}\r\n\r\n${body}`,
    )
    await updateWorkspaceIndex(db, git, workspaceId)
    const [change] = (await history({ limit: 1 })).changes
    expect(change!.subject).toBe(`${"s".repeat(500)}…`)
    expect(change!.body).toBe(`${"b".repeat(1000)}…`)
    // Musashi's text as the tests below expect it.
    git.push(workspaceId, {
      "machine/musashi.md": `${fixtures.musashi}\nRevision 4.\n`,
    })
    await updateWorkspaceIndex(db, git, workspaceId)
  })

  it("takes the workspace ID in any case", async () => {
    expect(
      (await history({ limit: 1 }, owner, workspaceId.toUpperCase())).changes,
    ).toHaveLength(1)
  })

  it("refuses a bad limit, outsiders and unknown pages", async () => {
    await expect(history({ limit: 51 })).rejects.toBeInstanceOf(
      InvalidInputError,
    )
    await expect(history({}, stranger)).rejects.toBeInstanceOf(NotFoundError)
    await expect(history({ id: "machine/nothing" })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it("goes on from where its first page started, however the index moves", async () => {
    const all = (await history({})).changes.map((c) => c.commit)
    const first = await history({ limit: 2 })
    git.push(
      workspaceId,
      { "machine/musashi.md": `${fixtures.musashi}\nNewer.\n` },
      "Newer than the first page",
    )
    await updateWorkspaceIndex(db, git, workspaceId)
    const second = await history({ limit: 2, after: first.next_after! })
    expect(second.changes.map((c) => c.commit)).toEqual(all.slice(2, 4))
    // Musashi's text as the tests below expect it.
    git.push(workspaceId, {
      "machine/musashi.md": `${fixtures.musashi}\nRevision 4.\n`,
    })
    await updateWorkspaceIndex(db, git, workspaceId)
    indexed = (await git.getRepository(workspaceId))!.main
  })

  it("is unavailable without the Git container", async () => {
    await expect(
      getCatalogPageHistory(
        asPerson(db, owner),
        undefined,
        workspaceId,
        { id: "machine/musashi" },
        cursors,
      ),
    ).rejects.toBeInstanceOf(UnavailableError)
    git.limits.busy = 1
    await expect(history({})).rejects.toBeInstanceOf(UnavailableError)
  })
})

describe("a page's source and the README", () => {
  it("reads the file at the index's commit", async () => {
    const answer = await getCatalogPageSource(
      asPerson(db, owner),
      git,
      workspaceId,
      { id: "machine/musashi" },
    )
    expect(answer.title).toBe("Musashi")
    expect(answer.source.path).toBe("machine/musashi.md")
    expect(answer.source.text).toBe(`${fixtures.musashi}\nRevision 4.\n`)
    await expect(
      getCatalogPageSource(asPerson(db, stranger), git, workspaceId, {
        id: "machine/musashi",
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it("reads the README, with its text as written", async () => {
    const answer = await getCatalogReadme(asPerson(db, owner), git, workspaceId)
    expect(answer.readme).toMatchObject({
      path: "README.md",
      text: "# Our catalog\n\nRead me \u202Efirst.\n",
    })
    await expect(
      getCatalogReadme(asPerson(db, stranger), git, workspaceId),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it("has no README when the catalog has none, or no repository yet", async () => {
    git.push(workspaceId, { "README.md": null })
    await updateWorkspaceIndex(db, git, workspaceId)
    expect(
      (await getCatalogReadme(asPerson(db, owner), git, workspaceId)).readme,
    ).toBeNull()
    const fresh = (
      await createWorkspace(asPerson(db, owner), { name: "Fresh" })
    ).workspace.id
    expect(
      await getCatalogReadme(asPerson(db, owner), undefined, fresh),
    ).toEqual({ catalog_commit: null, index_behind: false, readme: null })
  })
})
