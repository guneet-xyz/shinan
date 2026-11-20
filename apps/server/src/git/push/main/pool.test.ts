import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createGit } from "@shinan/git"
import { commitFiles, createFixtureRepository } from "@shinan/git/testing"

import type { MainCheckInput } from "./checks.js"
import { createMainChecker, MainCheckTimeoutError } from "./pool.js"

// The worker thread of the checks of main: its time limit stops it, and
// the next check starts a new one.

const git = createGit()
let repository: Awaited<ReturnType<typeof createFixtureRepository>>
let input: MainCheckInput
let home: string

const page = (id: string) => `---
id: ${id}
type: machine
title: ${id}
summary: A page for tests.
status: active
owner: unknown
---

# ${id}
`

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "shinan-main-home-"))
  repository = await createFixtureRepository(git)
  const from = await commitFiles(git, repository.gitDir, {
    "README.md": "# Catalog\n",
  })
  const to = await commitFiles(
    git,
    repository.gitDir,
    { "README.md": "# Catalog\n", "machine/one.md": page("machine/one") },
    { parents: [from] },
  )
  input = {
    gitBinary: git.binary,
    gitHome: home,
    gitDir: repository.gitDir,
    env: {},
    from,
    to,
    now: Date.now(),
    memberHandles: [],
    firstPushers: { [to]: "guneet via opencode-daedalus" },
    groupsEver: [],
    limits: { documents: 20_000, textBytes: 50 * 1024 * 1024 },
  }
})
afterAll(() => {
  repository.remove()
  rmSync(home, { recursive: true, force: true })
})

describe("the main checks' worker", () => {
  it("checks main in a worker thread, stops at the time limit, and starts again for the next", async () => {
    const checker = createMainChecker({ heapMb: 256 })
    try {
      expect(await checker.check(input, Date.now() + 30_000)).toEqual({
        problems: [],
        warnings: [],
        groups: [],
      })
      await expect(checker.check(input, Date.now())).rejects.toBeInstanceOf(
        MainCheckTimeoutError,
      )
      expect(await checker.check(input, Date.now() + 30_000)).toMatchObject({
        problems: [],
      })
    } finally {
      await checker.stop()
    }
  }, 60_000)

  it("refuses a document whose path is not its id, from the worker", async () => {
    const checker = createMainChecker()
    const to = await commitFiles(
      git,
      repository.gitDir,
      {
        "README.md": "# Catalog\n",
        "machine/two.md": page("machine/other"),
      },
      { parents: [input.from] },
    )
    try {
      const output = await checker.check(
        { ...input, to, firstPushers: { [to]: "x" } },
        Date.now() + 30_000,
      )
      expect(output.problems).toEqual([
        {
          code: "path-id-mismatch",
          where: "machine/two.md",
          message:
            'its id is "machine/other": a document\'s path is its id plus .md',
        },
      ])
    } finally {
      await checker.stop()
    }
  }, 60_000)
})
