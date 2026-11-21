import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createGit } from "@shinan/git"
import { commitFiles } from "@shinan/git/testing"

import { openJournal } from "./journal.js"
import {
  createPruner,
  createRepositoryGate,
  unreachableObjects,
} from "./prune.js"
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

function setup(
  paused?: (workspaceId: string) => boolean,
  wait: { quietMs?: number; longestWaitMs?: number } = { quietMs: 0 },
) {
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
  const pruner = createPruner({
    store,
    push,
    gate,
    paused,
    ...wait,
    log: () => {},
  })
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

  it("counts the objects a repository holds as one byte each, never by name", async () => {
    const { store, git } = setup()
    await store.create(workspaceId, {
      files: [{ path: "README.md", content: new TextEncoder().encode("Hi\n") }],
      message: "First",
    })
    const gitDir = store.pathOf(workspaceId)
    const main = (await store.main(workspaceId))!
    const files = Object.fromEntries(
      Array.from({ length: 200 }, (_, i) => [`p/${i}.md`, `Page ${i}\n`]),
    )
    await commitFiles(git, gitDir, files, {
      parents: [main],
      ref: "refs/heads/main",
    })
    await git.run(["repack", "-a", "-d", "-q", "--write-bitmap-index"], {
      gitDir,
    })
    const outputs: number[] = []
    const counting = {
      git: {
        ...git,
        run: async (...args: Parameters<typeof git.run>) => {
          const result = await git.run(...args)
          if (args[0][0] === "cat-file") outputs.push(result.stdout.length)
          return result
        },
      },
    }
    // The README and 200 pages, their folder, two root trees, two commits.
    expect(await unreachableObjects(counting, gitDir)).toBe(false)
    expect(outputs).toEqual([206])

    const gone = await commitFiles(
      git,
      gitDir,
      { "b.md": "b\n" },
      { parents: [main], ref: "refs/heads/gone" },
    )
    await git.run(["update-ref", "-d", "refs/heads/gone"], { gitDir })
    expect(await has(git, gitDir, gone)).toBe(true)
    expect(await unreachableObjects(counting, gitDir)).toBe(true)
  })

  it("joins pushed packs only, keeping the whole pack, when nothing is unreachable; repacks whole when something is", async () => {
    const { store, git, pruner } = setup()
    await store.create(workspaceId, {
      files: [{ path: "README.md", content: new TextEncoder().encode("Hi\n") }],
      message: "First",
    })
    const gitDir = store.pathOf(workspaceId)
    const packs = () =>
      readdirSync(join(gitDir, "objects", "pack")).filter((f) =>
        f.endsWith(".pack"),
      )
    // The first time, with no bitmap: whole, which writes one.
    pruner.soon(workspaceId)
    expect(await pruner.run()).toEqual([workspaceId])
    const [whole] = packs()
    expect(
      readdirSync(join(gitDir, "objects", "pack")).some((f) =>
        f.endsWith(".bitmap"),
      ),
    ).toBe(true)
    // A push that leaves nothing unreachable: the whole pack stays.
    const main = (await store.main(workspaceId))!
    const next = await commitFiles(
      git,
      gitDir,
      { "a.md": "a\n" },
      { parents: [main], ref: "refs/heads/main" },
    )
    pruner.soon(workspaceId)
    expect(await pruner.run()).toEqual([workspaceId])
    expect(packs()).toContain(whole)
    expect(await has(git, gitDir, next)).toBe(true)
    // A branch deleted: its commit goes, by a whole repack.
    const gone = await commitFiles(
      git,
      gitDir,
      { "b.md": "b\n" },
      { parents: [next], ref: "refs/heads/gone" },
    )
    await git.run(["update-ref", "-d", "refs/heads/gone"], { gitDir })
    await git.run(["repack", "-d", "-q"], { gitDir })
    pruner.soon(workspaceId)
    expect(await pruner.run()).toEqual([workspaceId])
    expect(await has(git, gitDir, gone)).toBe(false)
    expect(packs()).not.toContain(whole)
  })

  it("removes a failed repack's half-written pack, and tries again only after a wait, pushes or not", async () => {
    const root = mkdtempSync(join(work, "catalog-"))
    const real = createGit()
    let failing = true
    let repacks = 0
    const git: typeof real = {
      ...real,
      run: async (args, options) => {
        if (args[0] === "repack") {
          repacks++
          if (failing) {
            // As a repack stopped half-way leaves it.
            writeFileSync(
              join(options!.gitDir!, "objects", "pack", "tmp_pack_x"),
              "half a pack",
            )
            throw new Error("pack-objects died of signal 9")
          }
        }
        return real.run(args, options)
      },
    }
    const store = createRepositoryStore({ root, git })
    const push = createPushService({
      store,
      journal: openJournal(root),
      records: openRecords(root),
      locks: createPushLocks(),
    })
    const logged: string[] = []
    const pruner = createPruner({
      store,
      push,
      gate: createRepositoryGate(),
      quietMs: 0,
      failedWaitMs: 300,
      log: (line) => logged.push(line),
    })
    await store.create(workspaceId, {
      files: [{ path: "README.md", content: new TextEncoder().encode("Hi\n") }],
      message: "First",
    })
    const packs = join(store.pathOf(workspaceId), "objects", "pack")

    pruner.soon(workspaceId)
    expect(await pruner.run()).toEqual([])
    expect(repacks).toBe(1)
    expect(readdirSync(packs).filter((f) => f.startsWith("tmp_"))).toEqual([])
    expect(logged).toHaveLength(1)
    expect(logged[0]).toContain(
      `Pruning the repository of workspace ${workspaceId} failed`,
    )

    // Another push meanwhile: still not before the wait is over.
    pruner.soon(workspaceId)
    expect(await pruner.run()).toEqual([])
    expect(repacks).toBe(1)

    failing = false
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(await pruner.run()).toEqual([workspaceId])
    expect(repacks).toBe(2)
  })

  it("leaves a repository pushed to just now for later, unless it waited long enough", async () => {
    const { store, pruner } = setup(undefined, {
      quietMs: 60_000,
      longestWaitMs: 60_000,
    })
    await store.create(workspaceId, {
      files: [{ path: "README.md", content: new TextEncoder().encode("Hi\n") }],
      message: "First",
    })
    pruner.soon(workspaceId)
    expect(await pruner.run()).toEqual([])
    const waited = setup(undefined, { quietMs: 60_000, longestWaitMs: 0 })
    await waited.store.create(workspaceId, {
      files: [{ path: "README.md", content: new TextEncoder().encode("Hi\n") }],
      message: "First",
    })
    waited.pruner.soon(workspaceId)
    expect(await waited.pruner.run()).toEqual([workspaceId])
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

  it("leaves a repository a purge is reading for a later round", async () => {
    let purging = true
    const { store, pruner } = setup(() => purging)
    await store.create(workspaceId, {
      files: [{ path: "README.md", content: new TextEncoder().encode("Hi\n") }],
      message: "First",
    })
    pruner.soon(workspaceId)
    expect(await pruner.run()).toEqual([])
    purging = false
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

  it("ends the Git processes running at a purge's swap, and holds back new ones until it is done", async () => {
    const gate = createRepositoryGate()
    let killed = 0
    const held: { leave?: () => void } = {}
    held.leave = await gate.enter(workspaceId, () => {
      killed++
      held.leave?.()
    })
    const reopen = await gate.drain(workspaceId, 1000)
    expect(killed).toBe(1)
    let entered = false
    const waiting = gate.enter(workspaceId).then((l) => {
      entered = true
      return l
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(entered).toBe(false)
    reopen()
    ;(await waiting)()
    expect(entered).toBe(true)
  })
})
