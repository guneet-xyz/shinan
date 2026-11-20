import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { history, listTree } from "./read.js"
import { createGit } from "./run.js"
import type { GitError } from "./run.js"
import { createFixtureRepository } from "./testing.js"
import { checkObjects, writeCommit } from "./write.js"

const git = createGit()
let repository: Awaited<ReturnType<typeof createFixtureRepository>>

beforeAll(async () => {
  repository = await createFixtureRepository(git)
})
afterAll(() => repository.remove())

const identity = {
  name: "Shinan",
  email: "shinan@shinan.invalid",
  time: 1_790_000_000,
}

describe("writeCommit", () => {
  it("writes 20,000 files with a few Git processes, in seconds", async () => {
    const files = Array.from({ length: 20_000 }, (_, i) => ({
      path: `thing/n-${i}.md`,
      content: `# Thing ${i}\n`,
    }))
    const started = Date.now()
    const commit = await writeCommit(git, repository.gitDir, {
      files,
      message: "Many\n",
      identity,
    })
    expect(Date.now() - started).toBeLessThan(20_000)
    const entries = await listTree(git, repository.gitDir, commit)
    expect(entries).toHaveLength(20_000)
    expect(entries.find((e) => e.path === "thing/n-19999.md")).toMatchObject({
      size: "# Thing 19999\n".length,
    })
  })

  it("writes a commit with no files", async () => {
    const commit = await writeCommit(git, repository.gitDir, {
      files: [],
      message: "Empty\n",
      identity,
    })
    expect(await listTree(git, repository.gitDir, commit)).toEqual([])
  })

  it("writes exactly the files given, in folders, with a parent", async () => {
    const first = await writeCommit(git, repository.gitDir, {
      files: [{ path: "README.md", content: "# Catalog\n" }],
      message: "First\n",
      identity,
    })
    const second = await writeCommit(git, repository.gitDir, {
      files: [
        { path: "README.md", content: "# Catalog\n" },
        { path: "machine/musashi.md", content: new Uint8Array([109, 10]) },
        { path: "name with spaces.md", content: "x\n" },
      ],
      message: "Second\n\nWith a body.\n",
      identity,
      parents: [first],
    })
    expect(
      (await listTree(git, repository.gitDir, second)).map((e) => e.path),
    ).toEqual(["README.md", "machine/musashi.md", "name with spaces.md"])
    const [commit] = await history(git, repository.gitDir, second, { limit: 1 })
    expect(commit).toMatchObject({
      parents: [first],
      message: "Second\n\nWith a body.\n",
      author: {
        name: "Shinan",
        email: "shinan@shinan.invalid",
        time: 1_790_000_000,
      },
      committer: { name: "Shinan", time: 1_790_000_000 },
    })
  })

  it("refuses paths, parents and identities that are not plain", async () => {
    const write = (input: Partial<Parameters<typeof writeCommit>[2]>) =>
      writeCommit(git, repository.gitDir, {
        files: [{ path: "a.md", content: "a" }],
        message: "m",
        identity,
        ...input,
      })
    for (const path of ["../x", "/x", "a//b", "a/", "a\nb"]) {
      await expect(
        write({ files: [{ path, content: "a" }] }),
        path,
      ).rejects.toMatchObject({
        kind: "start",
      })
    }
    await expect(
      write({
        files: [
          { path: "a.md", content: "a" },
          { path: "a.md", content: "b" },
        ],
      }),
    ).rejects.toMatchObject({ kind: "start" })
    for (const path of [
      ".git/config",
      "a/.GIT/hooks/pre-receive",
      "a/.git./x",
      "a/.git /x",
      "GIT~1/config",
    ]) {
      await expect(
        write({ files: [{ path, content: "a" }] }),
        path,
      ).rejects.toMatchObject({ kind: "start" })
    }
    await expect(
      write({ files: [{ path: ".gitmodules", content: "x", mode: "120000" }] }),
    ).rejects.toMatchObject({ kind: "start" })
    await expect(
      write({ files: [{ path: "a/.gitignore.md", content: "x" }] }),
    ).resolves.toMatch(/^[0-9a-f]{40}$/)
    await expect(write({ parents: ["main"] })).rejects.toMatchObject({
      kind: "start",
    })
    await expect(
      write({
        identity: { name: "A <b@c> 1 +0000\ncommitter x", email: "a@b" },
      }),
    ).rejects.toMatchObject({ kind: "start" })
  })
})

describe("names Git refuses", () => {
  const write = (gitDir: string, path: string, mode?: "120000") =>
    writeCommit(git, gitDir, {
      files: [{ path, content: "x", ...(mode ? { mode } : {}) }],
      message: "m",
      identity,
    })

  it("are refused when deeper than Git reads", async () => {
    const own = await createFixtureRepository(git)
    try {
      await expect(
        write(own.gitDir, `${Array(2100).fill("d").join("/")}/f.md`),
      ).rejects.toMatchObject({
        kind: "start",
        message: expect.stringContaining("deeper") as string,
      })
    } finally {
      own.remove()
    }
  })

  it("are refused when Git would drop them from the tree", async () => {
    const own = await createFixtureRepository(git)
    try {
      for (const path of [
        ".git::$INDEX_ALLOCATION",
        ".git:x",
        "a/.git::$DATA/b",
      ]) {
        await expect(write(own.gitDir, path), path).rejects.toMatchObject({
          kind: "start",
          message: expect.stringContaining("Git does not take") as string,
        })
      }
    } finally {
      own.remove()
    }
  })

  it("are refused by Git as it writes, or found by its fsck, in the forms macOS and Windows read as .git or .gitmodules", async () => {
    for (const [path, mode, code] of [
      [".g\u200cit", undefined, "hasDotgit"],
      [".git\u200d", undefined, "hasDotgit"],
      ["a/.g\u200cit/b", undefined, "hasDotgit"],
      ["gitmod~1", "120000", "gitmodulesSymlink"],
      ["GITMOD~1", "120000", "gitmodulesSymlink"],
      [".gitmodu\u200cles", "120000", "gitmodulesSymlink"],
    ] as const) {
      const own = await createFixtureRepository(git)
      try {
        const written = await write(own.gitDir, path, mode).then(
          () => "written",
          (error: GitError) => error.message,
        )
        if (written === "written") {
          expect(await checkObjects(git, own.gitDir), path).toContain(code)
        } else {
          expect(written, path).toContain("Git does not take")
        }
      } finally {
        own.remove()
      }
    }
    const clean = await createFixtureRepository(git)
    try {
      await write(clean.gitDir, "README.md")
      expect(await checkObjects(git, clean.gitDir)).toEqual([])
    } finally {
      clean.remove()
    }
  })
})
