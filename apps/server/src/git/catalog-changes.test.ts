import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  createGitClient,
  createWorkspace,
  getCatalogPageHistory,
  historyCursors,
  listCatalogChanges,
  rebuildCatalogIndex,
  shinan,
} from "@shinan/core"
import type { Context, GitClient, Person } from "@shinan/core"
import { connectTestDatabase } from "@shinan/db/testing"
import { createGit } from "@shinan/git"
import { commitFiles } from "@shinan/git/testing"

import { insertPerson } from "../../test/people.js"
import { createGitApp } from "./app.js"
import { openJournal } from "./journal.js"
import { createRepositoryStore } from "./store.js"

// Recent changes and a page's History against a real repository with
// merges, compared with Git's own `rev-list` and combined diff (review of
// #194: paging from "the last commit shown" lost merged branches' commits).

const { db, pool } = connectTestDatabase()
const git = createGit()
const token = "service-token-for-tests-0123456789abcdef"
const cursors = historyCursors("test key")
let root: string
let hooks: string
let client: GitClient
let owner: Person
let ctx: Context
let workspaceId: string
let gitDir: string
let head: string

const page = (id: string, text: string) => `---
id: ${id}
type: ${id.split("/")[0]}
title: ${id.split("/")[1]}
summary: ${text}
status: active
owner: person/guneet
---
`

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "shinan-catalog-changes-"))
  hooks = mkdtempSync(join(tmpdir(), "shinan-git-hooks-"))
  const store = createRepositoryStore({ root, git, hooksDirectory: hooks })
  const app = createGitApp({
    serviceToken: token,
    store,
    journal: openJournal(root),
    log: () => {},
  })
  client = createGitClient({
    url: "http://git.test",
    serviceToken: token,
    fetch: (input, init) =>
      Promise.resolve(app.fetch(new Request(input, init))),
  })
  owner = await insertPerson(db, "owner")
  ctx = { db, actor: { kind: "person", personId: owner.id } }
  workspaceId = (await createWorkspace(ctx, { name: "Merges" })).workspace.id
  await client.createRepository(workspaceId, {
    files: [{ path: "README.md", content: new TextEncoder().encode("# C\n") }],
    message: "Start the catalog\n",
  })
  gitDir = store.pathOf(workspaceId)

  // Commits a minute apart, each holding exactly its files.
  let time = 1_790_000_000
  const commit = (
    files: Record<string, string>,
    parents: string[],
    message: string,
  ) => commitFiles(git, gitDir, files, { parents, message, time: (time += 60) })
  const start = (await client.getRepository(workspaceId))!.main
  const base = {
    "README.md": "# C\n",
    "machine/a.md": page("machine/a", "A one."),
    "machine/b.md": page("machine/b", "B one."),
  }
  const c1 = await commit(base, [start], "Add A and B")
  // A branch editing B twice, merged cleanly after main edits A.
  const x1 = await commit(
    { ...base, "machine/b.md": page("machine/b", "B two.") },
    [c1],
    "Branch x: B two",
  )
  const x2 = await commit(
    { ...base, "machine/b.md": page("machine/b", "B three.") },
    [x1],
    "Branch x: B three",
  )
  const t2 = { ...base, "machine/a.md": page("machine/a", "A two.") }
  const c2 = await commit(t2, [c1], "Main: A two")
  const t3 = { ...t2, "machine/b.md": page("machine/b", "B three.") }
  const m1 = await commit(t3, [c2, x2], "Merge branch x (clean)")
  // A branch editing A too: the merge resolves the conflict in A.
  const y1 = await commit(
    { ...t3, "machine/a.md": page("machine/a", "A from y.") },
    [m1],
    "Branch y: A from y",
  )
  const t4 = { ...t3, "machine/a.md": page("machine/a", "A three.") }
  const c3 = await commit(t4, [m1], "Main: A three")
  const t5 = { ...t4, "machine/a.md": page("machine/a", "A both.") }
  const m2 = await commit(t5, [c3, y1], "Merge branch y, resolving A")
  // An octopus merge of two branches, clean.
  const z1 = await commit(
    { ...t5, "machine/d.md": page("machine/d", "D.") },
    [m2],
    "Branch z1: D",
  )
  const z2 = await commit(
    { ...t5, "machine/e.md": page("machine/e", "E.") },
    [m2],
    "Branch z2: E",
  )
  const t6 = {
    ...t5,
    "machine/d.md": page("machine/d", "D."),
    "machine/e.md": page("machine/e", "E."),
  }
  const m3 = await commit(t6, [m2, z1, z2], "Merge branches z1 and z2")
  // A branch of 60 files; the merge also writes a page of its own, which
  // sorts after them: past the first 50 changed paths.
  const bulk = Object.fromEntries(
    Array.from({ length: 60 }, (_, i) => [
      `0-bulk/${String(i).padStart(2, "0")}.txt`,
      `${i}\n`,
    ]),
  )
  const w1 = await commit({ ...t6, ...bulk }, [m3], "Branch w: 60 files")
  const t7 = { ...t6, "machine/b.md": page("machine/b", "B four.") }
  const c4 = await commit(t7, [m3], "Main: B four")
  const t8 = {
    ...t7,
    ...bulk,
    "machine/late.md": page("machine/late", "Written in the merge."),
  }
  const m4 = await commit(t8, [c4, w1], "Merge branch w, adding Late")
  head = await commit(
    { ...t8, "machine/a.md": page("machine/a", "A four.") },
    [m4],
    "Main: A four",
  )
  await git.run(["update-ref", "refs/heads/main", head], { gitDir })
  await rebuildCatalogIndex({ db, actor: shinan }, { workspaceId }, client)
})

afterAll(async () => {
  await pool.end()
  rmSync(root, { recursive: true, force: true })
  rmSync(hooks, { recursive: true, force: true })
})

const lines = async (args: string[]) =>
  (await git.run(args, { gitDir })).stdout
    .toString()
    .split("\n")
    .filter(Boolean)

/** What Git lists, newest first: every commit, or those changing `path`. */
const revList = (path?: string) =>
  lines(["rev-list", head, ...(path ? ["--", path] : [])])

/** The files a commit changed itself: Git's combined diff for a merge. */
const ownFiles = (commit: string) =>
  lines([
    "diff-tree",
    "-c",
    "--name-only",
    "-r",
    "--root",
    "--no-commit-id",
    commit,
  ])

describe("recent changes against a real repository", () => {
  it.each([1, 2, 3, 30])(
    "lists every commit Git does, but merges that changed nothing themselves, %i at a time",
    async (limit) => {
      const expected: string[] = []
      for (const commit of await revList()) {
        const parents = await lines([
          "rev-list",
          "--parents",
          "-n",
          "1",
          commit,
        ])
        const merge = parents[0]!.split(" ").length > 2
        if (merge && (await ownFiles(commit)).length === 0) continue
        expected.push(commit)
      }
      const listed: string[] = []
      let after: string | undefined
      do {
        const answer = await listCatalogChanges(
          ctx,
          client,
          workspaceId,
          { after, limit },
          cursors,
        )
        // A page offering older changes is never empty.
        if (answer.next_after) expect(answer.changes.length).toBeGreaterThan(0)
        listed.push(...answer.changes.map((c) => c.commit))
        after = answer.next_after ?? undefined
      } while (after)
      expect(listed).toEqual(expected)
    },
  )

  it("names a merge's own files, as Git's combined diff does, past the first 50", async () => {
    const { changes } = await listCatalogChanges(
      ctx,
      client,
      workspaceId,
      {},
      cursors,
    )
    const bySubject = new Map(changes.map((c) => [c.subject, c]))
    expect(bySubject.get("Merge branch w, adding Late")).toMatchObject({
      merge: true,
      pages: [{ path: "machine/late.md", id: "machine/late", title: "late" }],
      page_count: 1,
      page_count_at_least: false,
    })
    expect(
      bySubject.get("Merge branch y, resolving A")!.pages.map((p) => p.path),
    ).toEqual(["machine/a.md"])
    expect(bySubject.has("Merge branch x (clean)")).toBe(false)
    expect(bySubject.has("Merge branches z1 and z2")).toBe(false)
    expect(bySubject.get("Branch w: 60 files")).toMatchObject({
      page_count: 60,
    })
  })
})

describe("a page's history against a real repository", () => {
  it.each([1, 2, 50])(
    "lists every change Git does to the file, %i at a time",
    async (limit) => {
      for (const id of ["machine/a", "machine/b"]) {
        const listed: string[] = []
        let after: string | undefined
        do {
          const answer = await getCatalogPageHistory(
            ctx,
            client,
            workspaceId,
            { id, after, limit },
            cursors,
          )
          listed.push(...answer.changes.map((c) => c.commit))
          after = answer.next_after ?? undefined
        } while (after)
        expect(listed, id).toEqual(await revList(`${id}.md`))
      }
    },
  )
})
