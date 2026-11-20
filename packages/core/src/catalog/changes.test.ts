import { afterAll, beforeAll, describe, expect, it } from "vitest"

import * as fixtures from "../../test/catalog-index-fixtures.js"
import { asPerson, newPerson, testDatabase } from "../../test/helpers.js"
import { createMemoryGit } from "../../test/memory-git.js"
import { InvalidInputError, NotFoundError } from "../errors.js"
import type { Person } from "../identity/people.js"
import { createWorkspace } from "../identity/workspaces.js"
import { listCatalogChanges } from "./changes.js"
import { readDocumentId } from "./document/parse.js"
import { updateWorkspaceIndex } from "./index/indexer.js"
import { historyCursors } from "./pages.js"

const { db, pool } = testDatabase()

afterAll(async () => {
  await pool.end()
})

let owner: Person
let stranger: Person
let workspaceId: string
let git: ReturnType<typeof createMemoryGit>
let indexed: string
const cursors = historyCursors("test key")

const page = (id: string, title: string) => `---
id: ${id}
type: ${id.split("/")[0]}
title: ${title}
summary: A page.
status: active
owner: person/guneet
---
`

beforeAll(async () => {
  owner = await newPerson(db, "owner")
  stranger = await newPerson(db, "stranger")
  workspaceId = (
    await createWorkspace(asPerson(db, owner), { name: "Changes" })
  ).workspace.id
  git = createMemoryGit()
  git.create(
    workspaceId,
    Object.fromEntries(
      fixtures.allDocuments.map((text) => [`${readDocumentId(text)}.md`, text]),
    ),
  )
  git.push(
    workspaceId,
    { "service/email.md": page("service/email", "Email") },
    "Add the email service",
  )
  git.push(
    workspaceId,
    {
      "machine/musashi.md": `${fixtures.musashi}\nRechecked.\n`,
      "machine/daedalus.md": `${fixtures.daedalus}\nRechecked.\n`,
    },
    "Recheck Musashi and Daedalus",
  )
  git.push(
    workspaceId,
    { "service/email.md": null, "README.md": "# Our catalog\n" },
    "Remove the email service",
  )
  git.push(
    workspaceId,
    Object.fromEntries(
      [1, 2, 3, 4, 5].map((i) => [
        `project/p${i}.md`,
        page(`project/p${i}`, `Project ${i}`),
      ]),
    ),
    "Add five projects \u202Egnp.exe",
  )
  indexed = (await git.getRepository(workspaceId))!.main
  await updateWorkspaceIndex(db, git, workspaceId)
})

const list = (
  input: { after?: string; limit?: number } = {},
  who = owner,
  workspace = workspaceId,
) => listCatalogChanges(asPerson(db, who), git, workspace, input, cursors)

describe("recent changes", () => {
  it("lists main's commits newest first, with up to three pages each by title", async () => {
    const answer = await list()
    expect(answer.catalog_commit).toBe(indexed)
    expect(answer.next_after).toBeNull()
    expect(answer.changes.map((c) => c.subject)).toEqual([
      "Add five projects \u202Egnp.exe",
      "Remove the email service",
      "Recheck Musashi and Daedalus",
      "Add the email service",
      "Change 1",
    ])
    const [five, removed, recheck, added] = answer.changes
    expect(five).toMatchObject({
      pages: [
        { path: "project/p1.md", id: "project/p1", title: "Project 1" },
        { path: "project/p2.md", id: "project/p2", title: "Project 2" },
        { path: "project/p3.md", id: "project/p3", title: "Project 3" },
      ],
      page_count: 5,
      page_count_at_least: false,
      merge: false,
      pushed_by: null,
    })
    // A deleted page and a file that isn't a page show by file name.
    expect(removed!.pages).toEqual(
      expect.arrayContaining([
        { path: "README.md", id: null, title: null },
        { path: "service/email.md", id: null, title: null },
      ]),
    )
    expect(recheck!.pages.map((p) => p.title).sort()).toEqual([
      "Daedalus",
      "Musashi",
    ])
    expect(added!.page_count).toBe(1)
  })

  it("pages by a cursor it signed, and refuses any other", async () => {
    const first = await list({ limit: 2 })
    expect(first.changes).toHaveLength(2)
    const second = await list({ limit: 2, after: first.next_after! })
    expect(second.changes.map((c) => c.subject)).toEqual([
      "Recheck Musashi and Daedalus",
      "Add the email service",
    ])
    const last = await list({ limit: 2, after: second.next_after! })
    expect(last.changes.map((c) => c.subject)).toEqual(["Change 1"])
    expect(last.next_after).toBeNull()

    // A commit only on a branch, and cursors not given out for this list.
    const branchOnly = git.push(
      workspaceId,
      { "machine/musashi.md": `${fixtures.musashi}\nSecret.\n` },
      "Branch only",
    )
    git.setMain(workspaceId, indexed)
    for (const after of [
      branchOnly,
      `${branchOnly}.1.forged`,
      first.next_after!.replace(/\.\d+\./, ".3."),
      cursors.issue({
        workspaceId,
        path: "machine/musashi.md",
        start: branchOnly,
        position: 1,
      }),
      historyCursors("other key").issue({
        workspaceId,
        path: "\u0000recent changes",
        start: branchOnly,
        position: 1,
      }),
    ])
      await expect(list({ after })).rejects.toBeInstanceOf(InvalidInputError)
    await expect(list({ limit: 31 })).rejects.toBeInstanceOf(InvalidInputError)
  })

  it("takes the workspace ID in any case, and is for members only", async () => {
    expect(
      (await list({}, owner, workspaceId.toUpperCase())).changes,
    ).toHaveLength(5)
    await expect(list({}, stranger)).rejects.toBeInstanceOf(NotFoundError)
  })
})
