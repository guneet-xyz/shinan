import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { createGit } from "@shinan/git"

import { openJournal } from "../journal.js"
import { createRepositoryStore } from "../store.js"
import { createPushLocks } from "./lock.js"
import { openRecords } from "./records.js"
import { createPushService } from "./service.js"

const workspaceId = "0b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d"
const folders: string[] = []
const folder = () => {
  const made = mkdtempSync(join(tmpdir(), "shinan-records-"))
  folders.push(made)
  return made
}
afterEach(() => {
  for (const made of folders.splice(0))
    rmSync(made, { recursive: true, force: true })
})

const row = (commit: string, by = "guneet via opencode-daedalus") => ({
  commit: commit.repeat(40),
  push: "7b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d",
  ref: "refs/heads/main",
  by,
  at: "2026-11-20T00:00:00.000Z",
})

describe("the first-pusher record", () => {
  it("records each commit once and never changes it, across restarts", () => {
    const root = folder()
    const records = openRecords(root)
    expect(
      records.addFirstPushes(workspaceId, [row("a"), row("a")]),
    ).toHaveLength(1)
    expect(
      records.addFirstPushes(workspaceId, [row("a", "other"), row("b")]),
    ).toEqual([row("b")])
    const again = openRecords(root)
    expect(again.firstPush(workspaceId, "a".repeat(40))?.by).toBe(
      "guneet via opencode-daedalus",
    )
    expect(again.firstPush(workspaceId, "c".repeat(40))).toBeUndefined()
  })

  it("drops a line a stop cut short, and keeps the rest", () => {
    const root = folder()
    openRecords(root).addFirstPushes(workspaceId, [row("a")])
    const file = join(root, "records", workspaceId, "first-pushes.jsonl")
    appendFileSync(file, '{"commit":"bbbb')
    const records = openRecords(root)
    expect(records.firstPush(workspaceId, "a".repeat(40))).toBeDefined()
    expect(readFileSync(file, "utf8").endsWith("\n")).toBe(true)
    records.addFirstPushes(workspaceId, [row("b")])
    expect(
      openRecords(root).firstPush(workspaceId, "b".repeat(40)),
    ).toBeDefined()
  })

  it("is made whole after a restart from the journal, and holds every repository's first commit", async () => {
    const root = folder()
    const git = createGit()
    const store = createRepositoryStore({ root, git, hooksDirectory: folder() })
    const { main } = await store.create(workspaceId, {
      files: [{ path: "README.md", content: Buffer.from("# Catalog\n") }],
      message: "Start\n",
    })
    const journal = openJournal(root)
    // A push confirmed in the journal whose record was never written.
    await journal.append("push.confirmed", {
      push: "7b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d",
      workspaceId,
      by: "guneet via opencode-daedalus",
      confirmed: [0],
      firstPushes: [{ commit: "d".repeat(40), ref: "refs/heads/x" }],
      main: null,
    })
    const records = openRecords(root)
    await createPushService({ store, journal, records }).recover()
    expect(records.firstPush(workspaceId, "d".repeat(40))).toMatchObject({
      ref: "refs/heads/x",
      by: "guneet via opencode-daedalus",
    })
    expect(records.firstPush(workspaceId, main)).toMatchObject({
      by: "shinan",
      push: null,
    })
    // And the journal says so, for web.
    expect(journal.read(0).map((e) => e.kind)).toEqual([
      "push.confirmed",
      "repository.created",
    ])
  })

  it("leaves alone a repository whose main was rewritten outside Shinan", async () => {
    const root = folder()
    const git = createGit()
    const store = createRepositoryStore({ root, git, hooksDirectory: folder() })
    const journal = openJournal(root)
    const records = openRecords(root)
    const service = createPushService({ store, journal, records })
    const { main } = await store.create(workspaceId, {
      files: [{ path: "README.md", content: Buffer.from("# Catalog\n") }],
      message: "Start\n",
    })
    await service.repositoryCreated(workspaceId, main)
    // A new root commit on main, written straight to the volume.
    const gitDir = store.pathOf(workspaceId)
    const tree = (
      await git.run(["rev-parse", `${main}^{tree}`], { gitDir })
    ).stdout
      .toString()
      .trim()
    const other = (
      await git.run(["commit-tree", "-m", "Elsewhere\n", tree], {
        gitDir,
        env: {
          GIT_AUTHOR_NAME: "x",
          GIT_AUTHOR_EMAIL: "x@example.com",
          GIT_COMMITTER_NAME: "x",
          GIT_COMMITTER_EMAIL: "x@example.com",
        },
      })
    ).stdout
      .toString()
      .trim()
    await git.run(["update-ref", "refs/heads/main", other], { gitDir })
    await createPushService({
      store,
      journal,
      records: openRecords(root),
    }).recover()
    expect(openRecords(root).firstPush(workspaceId, other)).toBeUndefined()
    expect(journal.read(0).map((e) => e.kind)).toEqual(["repository.created"])
  })
})

describe("the push lock", () => {
  it("lets one push in at a time per repository, in turn, and gives up after the wait", async () => {
    const locks = createPushLocks()
    const first = (await locks.acquire(workspaceId, 0))!
    expect(locks.held(workspaceId)).toBe(true)
    expect(await locks.acquire(workspaceId, 0)).toBeNull()
    expect(await locks.acquire("other", 0)).not.toBeNull()
    const order: string[] = []
    const second = locks.acquire(workspaceId, 5000).then((r) => {
      order.push("second")
      return r
    })
    const third = locks.acquire(workspaceId, 5000).then((r) => {
      order.push("third")
      return r
    })
    const late = await locks.acquire(workspaceId, 50)
    expect(late).toBeNull()
    first()
    const releaseSecond = (await second)!
    expect(order).toEqual(["second"])
    releaseSecond()
    ;(await third)!()
    expect(order).toEqual(["second", "third"])
    expect(locks.held(workspaceId)).toBe(false)
  })
})
