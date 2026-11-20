import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  changedPaths,
  diffTrees,
  emptyTree,
  history,
  listTree,
  newCommits,
  parseCommit,
} from "./read.js"
import { createGit } from "./run.js"
import { commitFiles, createFixtureRepository } from "./testing.js"
import { writeCommit } from "./write.js"

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
    const entries = await listTree(git, repository.gitDir, "refs/heads/main")
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
    for (const treeish of [
      "--output=/tmp/x",
      "-r",
      "",
      "main",
      "refs/heads/main\n",
      ":/Change",
      "refs/heads/main~1",
      "refs/heads/main@{0}",
    ]) {
      await expect(
        listTree(git, repository.gitDir, treeish),
      ).rejects.toMatchObject({
        kind: "start",
      })
    }
    for (const path of ["../x", "/etc", "a//b", "a/./b", "a\nb"]) {
      await expect(
        listTree(git, repository.gitDir, "refs/heads/main", { path }),
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
    const commits = await history(git, repository.gitDir, "refs/heads/main", {
      limit: 10,
    })
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
    const page = await history(git, repository.gitDir, "refs/heads/main", {
      limit: 1,
      skip: 1,
    })
    expect(page.map((c) => c.oid)).toEqual([second])
  })

  it("follows one path", async () => {
    const commits = await history(git, repository.gitDir, "refs/heads/main", {
      limit: 10,
      path: "machine/musashi.md",
    })
    expect(commits.map((c) => c.oid)).toEqual([second])
    expect(
      await history(git, repository.gitDir, "refs/heads/main", {
        limit: 10,
        path: "nothing.md",
      }),
    ).toEqual([])
  })

  it("starts only from a full object ID or a branch, never a search", async () => {
    for (const rev of [":/Change", "main", "refs/heads/main^", "HEAD"]) {
      await expect(
        history(git, repository.gitDir, rev, { limit: 10 }),
      ).rejects.toMatchObject({ kind: "start" })
    }
    expect(
      (await history(git, repository.gitDir, third, { limit: 1 }))[0]!.oid,
    ).toBe(third)
  })

  it("reads only the start of a commit above its limit, and says so", async () => {
    const long = await writeCommit(git, repository.gitDir, {
      files: [{ path: "README.md", content: "# Catalog\n" }],
      message: `Long\n\n${"é".repeat(300_000)}\n`,
      identity: {
        name: "Fixture Author",
        email: "a@example.com",
        time: 1_790_000_400,
      },
      parents: [third],
    })
    const [read, before] = await history(git, repository.gitDir, long, {
      limit: 2,
      maxCommitBytes: 4096,
    })
    expect(read).toMatchObject({
      oid: long,
      parents: [third],
      author: { name: "Fixture Author", time: 1_790_000_400 },
      truncated: true,
    })
    expect(read!.message.startsWith("Long\n\néé")).toBe(true)
    expect(Buffer.byteLength(read!.message)).toBeLessThan(4096)
    expect(read!.message).not.toContain("\uFFFD")
    expect(before).toMatchObject({ oid: third, truncated: false })
    const whole = await history(git, repository.gitDir, long, { limit: 1 })
    expect(whole[0]!.truncated).toBe(true)
    expect(Buffer.byteLength(whole[0]!.message)).toBeLessThanOrEqual(256 * 1024)
  })

  it("refuses counts that are not whole numbers", async () => {
    await expect(
      history(git, repository.gitDir, "refs/heads/main", { limit: -1 }),
    ).rejects.toMatchObject({ kind: "start" })
    await expect(
      history(git, repository.gitDir, "refs/heads/main", { limit: 1.5 }),
    ).rejects.toMatchObject({ kind: "start" })
  })
})

describe("changedPaths", () => {
  it("lists what each commit changed against its first parent, in the order asked", async () => {
    const merge = await commitFiles(
      git,
      repository.gitDir,
      { "README.md": "# Branch\n", "merged.md": "m\n" },
      { parents: [third, branch], message: "Merge\n" },
    )
    const changes = await changedPaths(git, repository.gitDir, [
      third,
      first,
      merge,
      second,
    ])
    expect([...changes.keys()]).toEqual([third, first, merge, second])
    expect(changes.get(first)).toEqual({
      changes: [{ status: "added", path: "README.md" }],
      count: 1,
      truncated: false,
    })
    expect(changes.get(third)!.changes).toEqual([
      { status: "modified", path: "README.md" },
      { status: "added", path: "link.md" },
      { status: "deleted", path: "machine/daedalus.md" },
      { status: "added", path: "service/email.md" },
      { status: "modified", path: "start-here.md" },
    ])
    // A merge: against its first parent only.
    expect(changes.get(merge)!.changes.map((c) => c.path)).toEqual([
      "README.md",
      "link.md",
      "machine/musashi.md",
      "merged.md",
      "service/email.md",
      "start-here.md",
    ])
  })

  it("keeps only the first paths of a commit that changed many, and counts the rest", async () => {
    const many = await commitFiles(
      git,
      repository.gitDir,
      Object.fromEntries(
        Array.from({ length: 300 }, (_, i) => [
          `thing/${String(i).padStart(3, "0")}.md`,
          `${i}\n`,
        ]),
      ),
      { parents: [first], message: "Many\n" },
    )
    const changes = (
      await changedPaths(git, repository.gitDir, [many], { maxPerCommit: 3 })
    ).get(many)!
    expect(changes).toMatchObject({ count: 301, truncated: true })
    expect(changes.changes.map((c) => c.path)).toEqual([
      "README.md",
      "thing/000.md",
      "thing/001.md",
    ])
  })

  it("lists nothing for a commit that changed nothing, wherever it is in the list", async () => {
    const same = await commitFiles(
      git,
      repository.gitDir,
      { "README.md": "# Catalog\n" },
      { parents: [first], message: "Nothing\n" },
    )
    const changes = await changedPaths(git, repository.gitDir, [
      first,
      same,
      second,
      same,
    ])
    expect(changes.get(same)).toEqual({
      changes: [],
      count: 0,
      truncated: false,
    })
    expect(changes.get(first)!.count).toBe(1)
    expect(changes.get(second)!.count).toBe(3)
    expect(
      (await changedPaths(git, repository.gitDir, [same])).get(same),
    ).toEqual({ changes: [], count: 0, truncated: false })
  })

  it("takes object IDs only, and nothing for nothing", async () => {
    await expect(
      changedPaths(git, repository.gitDir, ["refs/heads/main"]),
    ).rejects.toMatchObject({ kind: "start" })
    expect((await changedPaths(git, repository.gitDir, [])).size).toBe(0)
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
      truncated: false,
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
