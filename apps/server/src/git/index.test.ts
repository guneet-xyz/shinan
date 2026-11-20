import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { serve } from "@hono/node-server"
import type { ServerType } from "@hono/node-server"
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest"

import {
  checkCatalogIndexes,
  createGitClient,
  createWorkspace,
  searchCatalog,
  shinan,
  updateCatalogIndex,
} from "@shinan/core"
import type { GitClient, Person } from "@shinan/core"
import { eq, schema, sql } from "@shinan/db"
import { connectTestDatabase } from "@shinan/db/testing"
import { createGit } from "@shinan/git"
import { commitFiles } from "@shinan/git/testing"

import { insertPerson } from "../../test/people.js"
import { runCommand } from "../commands.js"
import { createGitApp } from "./app.js"
import { openJournal } from "./journal.js"
import { createRepositoryStore } from "./store.js"

// The agent index built from `main` of a real repository, read through the
// Git container's API over HTTP, as the worker reads it (Git-based catalog
// plan §2.7): core's tests use an in-memory stand-in for the same client.
const token = "service-token-for-tests-0123456789abcdef"
const git = createGit()
const { db, pool } = connectTestDatabase()
let root: string
let hooks: string
let server: ServerType
let url: string
let client: GitClient
let owner: Person
let workspaceId: string

const machine = (slug: string, summary: string) => `---
id: machine/${slug}
type: machine
title: ${slug}
summary: ${summary}
status: active
owner: person/guneet
---

# ${slug}

Runs the shared stacks.
`

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "shinan-git-index-"))
  hooks = mkdtempSync(join(tmpdir(), "shinan-git-hooks-"))
  const app = createGitApp({
    serviceToken: token,
    store: createRepositoryStore({ root, git, hooksDirectory: hooks }),
    journal: openJournal(root),
    log: () => {},
  })
  url = await new Promise<string>((resolve) => {
    server = serve(
      { fetch: app.fetch, hostname: "127.0.0.1", port: 0 },
      (info) => resolve(`http://127.0.0.1:${info.port}`),
    )
  })
  client = createGitClient({ url, serviceToken: token })
  owner = await insertPerson(db, "owner")
  workspaceId = (
    await createWorkspace(
      { db, actor: { kind: "person", personId: owner.id } },
      { name: "Indexed" },
    )
  ).workspace.id
  const made = await client.createRepository(workspaceId, {
    message: "Start\n",
    files: [{ path: "README.md", content: new TextEncoder().encode("# C\n") }],
  })
  await db
    .update(schema.catalogRepositories)
    .set({ createdAt: sql`now()`, firstCommit: made.main })
    .where(eq(schema.catalogRepositories.workspaceId, workspaceId))
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  await pool.end()
  rmSync(root, { recursive: true, force: true })
  rmSync(hooks, { recursive: true, force: true })
})

/** Commits exactly `files` on `main`, as an accepted push leaves it. */
async function commitOnMain(files: Record<string, string>): Promise<string> {
  const main = (await client.getRepository(workspaceId))!.main
  return commitFiles(git, join(root, `${workspaceId}.git`), files, {
    parents: [main],
    ref: "refs/heads/main",
  })
}

const ctx = () => ({ db, actor: shinan })
const reader = () => ({
  db,
  actor: { kind: "person" as const, personId: owner.id },
})

describe("the agent index from a repository in the Git container", () => {
  it("builds from main, updates from the diff, and checks against main", async () => {
    expect(
      await updateCatalogIndex(ctx(), { workspaceId }, client),
    ).toMatchObject({ outcome: "rebuilt", documents: 0 })

    const first = await commitOnMain({
      "README.md": "# C\n",
      "machine/musashi.md": machine("musashi", "The production host."),
      "machine/daedalus.md": machine("daedalus", "The development host."),
    })
    expect(await updateCatalogIndex(ctx(), { workspaceId }, client)).toEqual({
      outcome: "updated",
      commit: first,
      documents: 2,
    })

    const second = await commitOnMain({
      "README.md": "# C\n",
      "machine/musashi.md": machine("musashi", "The production host, resized."),
    })
    expect(await updateCatalogIndex(ctx(), { workspaceId }, client)).toEqual({
      outcome: "updated",
      commit: second,
      documents: 1,
    })

    const found = await searchCatalog(reader(), workspaceId, {
      text: "host",
    })
    expect(found).toMatchObject({ catalog_commit: second, index_behind: false })
    expect(found.items.map((i) => i.entity.id)).toEqual(["machine/musashi"])

    const [checked] = await checkCatalogIndexes(ctx(), client, {
      workspaceIds: [workspaceId],
    })
    expect(checked).toMatchObject({
      outcome: "matched",
      commit: second,
      documents: 1,
    })
  })

  it("rebuilds and checks on an operator's command", async () => {
    const env = {
      DATABASE_URL: inject("databaseUrl"),
      SHINAN_GIT_URL: url,
      SHINAN_GIT_SERVICE_TOKEN: token,
    }
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    const main = (await client.getRepository(workspaceId))!.main
    await expect(
      runCommand(["catalog-index", "rebuild", workspaceId], env),
    ).resolves.toBe(0)
    expect(info).toHaveBeenCalledWith(
      `Rebuilt the agent index of workspace ${workspaceId} at ${main} (1 documents)`,
    )
    await expect(
      runCommand(["catalog-index", "check", workspaceId], env),
    ).resolves.toBe(0)
    expect(info).toHaveBeenCalledWith(`Workspace ${workspaceId}: matched`)
    info.mockRestore()
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    await expect(
      runCommand(["catalog-index", "rebuild", crypto.randomUUID()], env),
    ).resolves.toBe(1)
    expect(error).toHaveBeenCalledWith("No workspace has that ID")
    error.mockRestore()
  })
})
