import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { history, listTree } from "./read.js"
import { createGit } from "./run.js"
import { createFixtureRepository } from "./testing.js"
import { writeCommit } from "./write.js"

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
