import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { serve } from "@hono/node-server"
import type { ServerType } from "@hono/node-server"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createGitClient, GitServiceError } from "@shinan/core"
import type { GitClient } from "@shinan/core"
import { createGit } from "@shinan/git"

import { createGitApp } from "./app.js"
import { openJournal } from "./journal.js"
import type { Journal } from "./journal.js"
import { createRepositoryStore } from "./store.js"

// Core's typed client against the git role's API over HTTP, as `web`,
// `worker` and `migrate` reach the Git container.
const token = "service-token-for-tests-0123456789abcdef"
const workspaceId = "8b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d"
let root: string
let hooks: string
let server: ServerType
let journal: Journal
let client: GitClient
let url: string

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "shinan-git-client-"))
  hooks = mkdtempSync(join(tmpdir(), "shinan-git-hooks-"))
  journal = openJournal(root)
  const app = createGitApp({
    serviceToken: token,
    store: createRepositoryStore({
      root,
      git: createGit(),
      hooksDirectory: hooks,
    }),
    journal,
    log: () => {},
  })
  url = await new Promise<string>((resolve) => {
    server = serve(
      { fetch: app.fetch, hostname: "127.0.0.1", port: 0 },
      (info) => resolve(`http://127.0.0.1:${info.port}`),
    )
  })
  client = createGitClient({ url, serviceToken: token })
})
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  rmSync(root, { recursive: true, force: true })
  rmSync(hooks, { recursive: true, force: true })
})

const text = (value: string) => new TextEncoder().encode(value)

describe("the Git container's client", () => {
  it("creates a repository once and reads it back", async () => {
    expect(await client.getRepository(workspaceId)).toBeNull()
    const made = await client.createRepository(workspaceId, {
      message: "Start\n",
      files: [
        { path: "README.md", content: text("# Catalog\n") },
        { path: "machine/musashi.md", content: new Uint8Array([0, 255, 10]) },
      ],
    })
    expect(made).toMatchObject({ workspaceId, created: true })
    expect(
      await client.createRepository(workspaceId, {
        message: "Again\n",
        files: [],
      }),
    ).toEqual({ workspaceId, created: false, main: made.main })
    expect(await client.getRepository(workspaceId)).toEqual({
      workspaceId,
      main: made.main,
    })

    const tree = await client.listTree(workspaceId, { commit: "main" })
    expect(tree.entries.map((e) => e.path)).toEqual([
      "README.md",
      "machine/musashi.md",
    ])
    const { documents } = await client.readDocuments(workspaceId, {
      commit: made.main,
      paths: ["machine/musashi.md", "nothing.md"],
    })
    expect(documents[0]).toMatchObject({ path: "machine/musashi.md", size: 3 })
    expect("content" in documents[0]! && [...documents[0].content]).toEqual([
      0, 255, 10,
    ])
    expect(documents[1]).toEqual({ path: "nothing.md", missing: true })
    const diff = await client.diff(workspaceId, { from: null, to: "main" })
    expect(diff.changes.map((c) => c.path)).toEqual([
      "README.md",
      "machine/musashi.md",
    ])
    const history = await client.history(workspaceId, {
      commit: "main",
      limit: 10,
    })
    expect(history.commits.map((c) => c.message)).toEqual(["Start\n"])
  })

  it("reads and acknowledges the journal", async () => {
    await journal.append("push.test", { a: 1 })
    await journal.append("push.test", { a: 2 })
    const read = await client.readJournal({ after: 0 })
    expect(read.entries.map((e) => e.data)).toEqual([{ a: 1 }, { a: 2 }])
    expect(read).toMatchObject({ journalId: journal.id, last: 2 })
    const journalId = read.journalId
    expect(await client.acknowledgeJournal({ journalId, through: 1 })).toEqual({
      deleted: 1,
    })
    expect(await client.acknowledgeJournal({ journalId, through: 1 })).toEqual({
      deleted: 0,
    })
    await expect(
      client.acknowledgeJournal({
        journalId: "9b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d",
        through: 2,
      }),
    ).rejects.toMatchObject({ status: 409, code: "other-journal" })
    expect(
      (await client.readJournal({ after: 0 })).entries.map((e) => e.number),
    ).toEqual([2])
  })

  it("reports refusals by status and code", async () => {
    const wrong = createGitClient({ url, serviceToken: "x".repeat(40) })
    await expect(wrong.getRepository(workspaceId)).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
    })
    await expect(
      client.listTree(workspaceId, { commit: "HEAD" }),
    ).rejects.toMatchObject({ status: 400, code: "invalid-request" })
    await expect(
      client.history("9b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d", {
        commit: "main",
        limit: 1,
      }),
    ).rejects.toMatchObject({ status: 404 })
    const gone = createGitClient({
      url: "http://127.0.0.1:1",
      serviceToken: token,
    })
    const error = await gone.getRepository(workspaceId).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GitServiceError)
    expect(error).toMatchObject({ status: 0, code: "unreachable" })
  })
})
