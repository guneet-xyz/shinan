import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  diffTrees,
  emptyTree,
  history,
  listTree,
  newCommits,
  parseCommit,
} from "./read.js"
import { createGit } from "./run.js"
import { commitFiles, createFixtureRepository } from "./testing.js"

const git = createGit()
let repository: Awaited<ReturnType<typeof createFixtureRepository>>
let first: string
let second: string
let third: string
let branch: string

beforeAll(async () => {
  repository = await createFixtureRepository(git)
  const { gitDir } = repository
  first = await commitFiles(
    git,
    gitDir,
    { "README.md": "# Catalog\n" },
    { message: "First commit\n", time: 1_790_000_000 },
  )
  second = await commitFiles(
    git,
    gitDir,
    {
      "README.md": "# Catalog\n",
      "machine/musashi.md": "musashi\n",
      "machine/daedalus.md": "daedalus\n",
      "start-here.md": "start\n",
    },
    {
      parents: [first],
      message: "Add machines\n\nWith a body.\n",
      time: 1_790_000_100,
    },
  )
  third = await commitFiles(
    git,
    gitDir,
    {
      "README.md": "# Catalog, changed\n",
      "machine/musashi.md": "musashi\n",
      "service/email.md": "email\n",
      "start-here.md": { content: "start\n", mode: "100755" },
      "link.md": { content: "README.md", mode: "120000" },
    },
    {
      parents: [second],
      message: "Change things\n",
      time: 1_790_000_200,
      ref: "refs/heads/main",
    },
  )
  branch = await commitFiles(
    git,
    gitDir,
    { "README.md": "# Branch\n" },
    { parents: [third], message: "On a branch\n", time: 1_790_000_300 },
  )
})
afterAll(() => repository.remove())

describe("listTree", () => {
  it("lists every file of a commit's tree, with modes, types and sizes", async () => {
    const entries = await listTree(git, repository.gitDir, "main")
    expect(entries.map((e) => [e.path, e.mode, e.type, e.size])).toEqual([
      ["README.md", "100644", "blob", 19],
      ["link.md", "120000", "blob", 9],
      ["machine/musashi.md", "100644", "blob", 8],
      ["service/email.md", "100644", "blob", 6],
      ["start-here.md", "100755", "blob", 6],
    ])
    expect(entries[0]!.oid).toMatch(/^[0-9a-f]{40}$/)
  })

  it("lists one folder, or one level", async () => {
    const machines = await listTree(git, repository.gitDir, second, {
      path: "machine/",
    })
    expect(machines.map((e) => e.path)).toEqual([
      "machine/daedalus.md",
      "machine/musashi.md",
    ])
    const top = await listTree(git, repository.gitDir, second, {
      recursive: false,
    })
    expect(top.map((e) => [e.path, e.type, e.size])).toEqual([
      ["README.md", "blob", 10],
      ["machine", "tree", null],
      ["start-here.md", "blob", 6],
    ])
  })

  it("reads a path literally, never as a pattern", async () => {
    expect(
      await listTree(git, repository.gitDir, second, { path: "machine/*" }),
    ).toEqual([])
  })

  it("refuses revisions and paths that are not plain ones", async () => {
    for (const treeish of ["--output=/tmp/x", "-r", "", "main\n"]) {
      await expect(
        listTree(git, repository.gitDir, treeish),
      ).rejects.toMatchObject({
        kind: "start",
      })
    }
    for (const path of ["../x", "/etc", "a//b", "a/./b", "a\nb"]) {
      await expect(
        listTree(git, repository.gitDir, "main", { path }),
      ).rejects.toMatchObject({
        kind: "start",
      })
    }
  })
})

describe("diffTrees", () => {
  it("lists additions, changes, deletions and type changes, without renames", async () => {
    const changes = await diffTrees(git, repository.gitDir, second, third)
    expect(
      changes.map((c) => [c.status, c.path, c.oldMode, c.newMode]),
    ).toEqual([
      ["modified", "README.md", "100644", "100644"],
      ["added", "link.md", null, "120000"],
      ["deleted", "machine/daedalus.md", "100644", null],
      ["added", "service/email.md", null, "100644"],
      ["modified", "start-here.md", "100644", "100755"],
    ])
    const deleted = changes.find((c) => c.status === "deleted")!
    expect(deleted.oldOid).toMatch(/^[0-9a-f]{40}$/)
    expect(deleted.newOid).toBeNull()
  })

  it("compares with the empty tree", async () => {
    const changes = await diffTrees(git, repository.gitDir, null, first)
    expect(changes).toMatchObject([{ status: "added", path: "README.md" }])
    expect(await emptyTree(git, repository.gitDir)).toBe(
      "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
    )
  })
})

describe("newCommits", () => {
  it("lists commits no ref reaches, up to a limit", async () => {
    expect(
      await newCommits(git, repository.gitDir, [branch], { limit: 10 }),
    ).toEqual({
      commits: [branch],
      truncated: false,
    })
    expect(
      await newCommits(git, repository.gitDir, [third], { limit: 10 }),
    ).toEqual({
      commits: [],
      truncated: false,
    })
    const unreferenced = await commitFiles(
      git,
      repository.gitDir,
      { "a.md": "a\n" },
      { parents: [branch] },
    )
    expect(
      await newCommits(git, repository.gitDir, [unreferenced], { limit: 1 }),
    ).toEqual({
      commits: [unreferenced],
      truncated: true,
    })
  })

  it("takes object IDs only", async () => {
    await expect(
      newCommits(git, repository.gitDir, ["main"], { limit: 1 }),
    ).rejects.toMatchObject({ kind: "start" })
    await expect(
      newCommits(git, repository.gitDir, ["--all"], { limit: 1 }),
    ).rejects.toMatchObject({ kind: "start" })
  })
})

describe("history", () => {
  it("lists commits newest first, with parents, people and messages", async () => {
    const commits = await history(git, repository.gitDir, "main", { limit: 10 })
    expect(commits.map((c) => c.oid)).toEqual([third, second, first])
    expect(commits[1]).toMatchObject({
      parents: [first],
      message: "Add machines\n\nWith a body.\n",
      author: {
        name: "Fixture Author",
        email: "author@example.com",
        time: 1_790_000_100,
        timezone: "+0000",
      },
      committer: { name: "Fixture Committer" },
    })
    expect(commits[2]!.parents).toEqual([])
  })

  it("pages with a limit and a skip", async () => {
    const page = await history(git, repository.gitDir, "main", {
      limit: 1,
      skip: 1,
    })
    expect(page.map((c) => c.oid)).toEqual([second])
  })

  it("follows one path", async () => {
    const commits = await history(git, repository.gitDir, "main", {
      limit: 10,
      path: "machine/musashi.md",
    })
    expect(commits.map((c) => c.oid)).toEqual([second])
    expect(
      await history(git, repository.gitDir, "main", {
        limit: 10,
        path: "nothing.md",
      }),
    ).toEqual([])
  })

  it("refuses counts that are not whole numbers", async () => {
    await expect(
      history(git, repository.gitDir, "main", { limit: -1 }),
    ).rejects.toMatchObject({ kind: "start" })
    await expect(
      history(git, repository.gitDir, "main", { limit: 1.5 }),
    ).rejects.toMatchObject({ kind: "start" })
  })
})

describe("parseCommit", () => {
  it("reads a signed merge commit", () => {
    const tree = "a".repeat(40)
    const content = Buffer.from(
      [
        `tree ${tree}`,
        `parent ${"b".repeat(40)}`,
        `parent ${"c".repeat(40)}`,
        "author Some One <one@example.com> 1790000000 +0530",
        "committer Some One <one@example.com> 1790000001 -0700",
        "gpgsig -----BEGIN PGP SIGNATURE-----",
        " ",
        " abc",
        " -----END PGP SIGNATURE-----",
        "",
        "Merge\n\nbody with\n\nblank lines\n",
      ].join("\n"),
    )
    expect(parseCommit("d".repeat(40), content)).toEqual({
      oid: "d".repeat(40),
      tree,
      parents: ["b".repeat(40), "c".repeat(40)],
      author: {
        name: "Some One",
        email: "one@example.com",
        time: 1_790_000_000,
        timezone: "+0530",
      },
      committer: {
        name: "Some One",
        email: "one@example.com",
        time: 1_790_000_001,
        timezone: "-0700",
      },
      message: "Merge\n\nbody with\n\nblank lines\n",
    })
  })

  it("keeps going when an identity cannot be read", () => {
    const commit = parseCommit(
      "d".repeat(40),
      Buffer.from(`tree ${"a".repeat(40)}\nauthor nobody\n\nmessage`),
    )
    expect(commit.author).toBeNull()
    expect(commit.message).toBe("message")
    expect(() =>
      parseCommit("d".repeat(40), Buffer.from("author x\n\nm")),
    ).toThrow()
  })
})
