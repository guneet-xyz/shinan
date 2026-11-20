import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createGit } from "@shinan/git"
import { commitFiles } from "@shinan/git/testing"

import { openJournal } from "./journal.js"
import { createPruner, createRepositoryGate } from "./prune.js"
import { createPushLocks } from "./push/lock.js"
import { openRecords } from "./push/records.js"
import { createPushService } from "./push/service.js"
import { createRepositoryStore } from "./store.js"

const workspaceId = "6f0c1b9e-3d4a-4b5c-8d7e-0123456789ab"
let work: string

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "shinan-prune-"))
})
afterAll(() => rmSync(work, { recursive: true, force: true }))

function setup() {
  const root = mkdtempSync(join(work, "catalog-"))
  const git = createGit()
  const store = createRepositoryStore({ root, git })
  const locks = createPushLocks()
  const push = createPushService({
    store,
    journal: openJournal(root),
    records: openRecords(root),
    locks,
  })
  const gate = createRepositoryGate()
  const pruner = createPruner({ store, push, gate, log: () => {} })
  return { store, git, locks, gate, pruner }
}

const has = async (
  git: ReturnType<typeof createGit>,
  gitDir: string,
  oid: string,
) =>
  (await git.run(["cat-file", "-e", oid], { gitDir, okExitCodes: [0, 1, 128] }))
    .exitCode === 0

describe("pruning repositories after pushes", () => {
  it("removes objects no branch reaches, and keeps every one a branch does", async () => {
    const { store, git, pruner } = setup()
    await store.create(workspaceId, {
      files: [{ path: "README.md", content: new TextEncoder().encode("Hi\n") }],
      message: "First",
    })
    const gitDir = store.pathOf(workspaceId)
    const main = (await store.main(workspaceId))!
    const kept = await commitFiles(
      git,
      gitDir,
      { "a.md": "kept\n" },
      {
        parents: [main],
        ref: "refs/heads/kept",
      },
    )
    const gone = await commitFiles(
      git,
      gitDir,
      { "b.md": "gone\n" },
      {
        parents: [main],
        ref: "refs/heads/gone",
      },
    )
    await git.run(["update-ref", "-d", "refs/heads/gone"], { gitDir })
    expect(await has(git, gitDir, gone)).toBe(true)

    pruner.soon(workspaceId)
    expect(await pruner.run()).toEqual([workspaceId])
    expect(await has(git, gitDir, gone)).toBe(false)
    expect(await has(git, gitDir, kept)).toBe(true)
    expect(await has(git, gitDir, main)).toBe(true)
    // Done: nothing is pruned again until the next push.
    expect(await pruner.run()).toEqual([])
  })

  it("waits for a push being checked and for Git processes, and tries again later", async () => {
    const { store, locks, gate, pruner } = setup()
    await store.create(workspaceId, {
      files: [{ path: "README.md", content: new TextEncoder().encode("Hi\n") }],
      message: "First",
    })
    const release = (await locks.acquire(workspaceId, 0))!
    pruner.soon(workspaceId)
    expect(await pruner.run()).toEqual([])
    release()

    const leave = await gate.enter(workspaceId)
    expect(await pruner.run()).toEqual([])
    leave()
    expect(await pruner.run()).toEqual([workspaceId])
  })

  it("holds back Git processes while a repository is pruned", async () => {
    const gate = createRepositoryGate()
    let finish!: () => void
    const pruning = gate.whenIdle(
      workspaceId,
      () => new Promise<string>((resolve) => (finish = () => resolve("done"))),
    )
    let entered = false
    const entering = gate.enter(workspaceId).then((leave) => {
      entered = true
      return leave
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(entered).toBe(false)
    expect(await gate.whenIdle(workspaceId, () => Promise.resolve(1))).toBe(
      null,
    )
    finish()
    expect(await pruning).toBe("done")
    ;(await entering)()
    expect(entered).toBe(true)
  })
})
