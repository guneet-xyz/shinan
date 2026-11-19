import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { openCatFile } from "./cat-file.js"
import { createGit } from "./run.js"
import { commitFiles, createFixtureRepository } from "./testing.js"

const git = createGit()
let repository: Awaited<ReturnType<typeof createFixtureRepository>>
let commit: string

beforeAll(async () => {
  repository = await createFixtureRepository(git)
  commit = await commitFiles(
    git,
    repository.gitDir,
    {
      "README.md": "# Catalog\n",
      "binary.bin": { content: new Uint8Array([0, 10, 10, 255, 10, 0]) },
      "large.txt": "y".repeat(5000),
      "name with spaces.md": "spaces\n",
    },
    { ref: "refs/heads/main" },
  )
})
afterAll(() => repository.remove())

describe("cat-file --batch-command", () => {
  it("reads objects with their type, size and exact content", async () => {
    const reader = openCatFile(git, repository.gitDir)
    try {
      const readme = await reader.read("main:README.md")
      expect(readme).toMatchObject({ type: "blob", size: 10 })
      expect(typeof readme !== "string" && readme.content.toString()).toBe(
        "# Catalog\n",
      )
      const binary = await reader.read(`${commit}:binary.bin`)
      expect(typeof binary !== "string" && [...binary.content]).toEqual([
        0, 10, 10, 255, 10, 0,
      ])
      const spaced = await reader.read("main:name with spaces.md")
      expect(typeof spaced !== "string" && spaced.content.toString()).toBe(
        "spaces\n",
      )
      const head = await reader.read(commit)
      expect(head).toMatchObject({ oid: commit, type: "commit" })
    } finally {
      await reader.close()
    }
  })

  it("answers many requests at once in the order asked", async () => {
    const reader = openCatFile(git, repository.gitDir)
    try {
      const names = [
        "main:README.md",
        "main:nothing",
        "main:large.txt",
        "main",
        "main:binary.bin",
      ]
      const answers = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          reader.read(names[i % names.length]!),
        ),
      )
      answers.forEach((answer, i) => {
        const name = names[i % names.length]!
        if (name === "main:nothing") expect(answer).toBe("missing")
        else expect(typeof answer).toBe("object")
      })
      expect(typeof answers[2] !== "string" && answers[2]!.content.length).toBe(
        5000,
      )
    } finally {
      await reader.close()
    }
  })

  it("gives information without content, and null for a missing object", async () => {
    const reader = openCatFile(git, repository.gitDir)
    try {
      expect(await reader.info("main:large.txt")).toMatchObject({
        type: "blob",
        size: 5000,
      })
      expect(await reader.info("0".repeat(40))).toBeNull()
      expect(await reader.read("0".repeat(40))).toBe("missing")
    } finally {
      await reader.close()
    }
  })

  it("reads past an object above its limit and goes on", async () => {
    const reader = openCatFile(git, repository.gitDir, { maxObjectBytes: 1000 })
    try {
      expect(await reader.read("main:large.txt")).toBe("too-large")
      const after = await reader.read("main:README.md")
      expect(typeof after !== "string" && after.content.toString()).toBe(
        "# Catalog\n",
      )
    } finally {
      await reader.close()
    }
  })

  it("refuses a name that would be two requests", async () => {
    const reader = openCatFile(git, repository.gitDir)
    try {
      await expect(
        reader.read("main:README.md\ninfo main"),
      ).rejects.toMatchObject({
        kind: "start",
      })
      await expect(reader.read("")).rejects.toMatchObject({ kind: "start" })
      expect(await reader.info("main")).toMatchObject({ type: "commit" })
    } finally {
      await reader.close()
    }
  })

  it("fails waiting requests when Git ends", async () => {
    const reader = openCatFile(git, "/nonexistent/repository.git")
    await expect(reader.read("main")).rejects.toMatchObject({ kind: "exit" })
    await expect(reader.read("main")).rejects.toMatchObject({ kind: "exit" })
  })
})
