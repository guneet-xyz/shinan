import type { PgBoss } from "pg-boss"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { eq, schema } from "@shinan/db"

import {
  asPerson,
  asShinan,
  newPerson,
  startTestJobQueue,
  testDatabase,
} from "../../../test/helpers.js"
import { ForbiddenError, NotFoundError } from "../../errors.js"
import { createWorkspace } from "../../identity/workspaces.js"
import type { GitClient } from "./client.js"
import { GitServiceError } from "./client.js"
import {
  catalogRepositoryQueue,
  createCatalogRepository,
  repositoryFirstCommitMessage,
  repositoryReadme,
  requestPendingCatalogRepositories,
} from "./repositories.js"

const { db, pool } = testDatabase()
let boss: PgBoss

beforeAll(async () => {
  boss = await startTestJobQueue()
})
afterAll(async () => {
  await boss.stop({ graceful: false })
  await pool.end()
})

/** A Git container that records what it was asked. */
function fakeGit(main = "c".repeat(40)) {
  const calls: {
    workspaceId: string
    files: { path: string; content: string }[]
    message: string
  }[] = []
  let failing = false
  const client = {
    createRepository(
      workspaceId: string,
      input: Parameters<GitClient["createRepository"]>[1],
    ) {
      if (failing)
        return Promise.reject(new GitServiceError(0, "unreachable", "down"))
      calls.push({
        workspaceId,
        message: input.message,
        files: input.files.map((f) => ({
          path: f.path,
          content: new TextDecoder().decode(f.content),
        })),
      })
      return Promise.resolve({ workspaceId, main, created: calls.length === 1 })
    },
  } as unknown as GitClient
  return { client, calls, fail: (value: boolean) => (failing = value) }
}

const row = async (workspaceId: string) =>
  (
    await db
      .select()
      .from(schema.catalogRepositories)
      .where(eq(schema.catalogRepositories.workspaceId, workspaceId))
  )[0]

let workspaceId: string

beforeEach(async () => {
  const owner = await newPerson(db, "owner")
  const created = await createWorkspace(
    { ...asPerson(db, owner), jobs: boss },
    { name: "Repositories" },
  )
  workspaceId = created.workspace.id
})

describe("a new workspace's repository", () => {
  it("is asked for in the same transaction, with a job", async () => {
    expect(await row(workspaceId)).toMatchObject({
      workspaceId,
      createdAt: null,
      firstCommit: null,
    })
    const jobs = await boss.findJobs(catalogRepositoryQueue.name, {
      data: { workspaceId },
    })
    expect(jobs.filter((j) => j.state === "created")).toHaveLength(1)
  })

  it("is asked for without a job queue too (the worker picks it up)", async () => {
    const owner = await newPerson(db, "owner")
    const { workspace } = await createWorkspace(asPerson(db, owner), {
      name: "No queue",
    })
    expect(await row(workspace.id)).toMatchObject({ firstCommit: null })
    const asked = await requestPendingCatalogRepositories({
      ...asShinan(db),
      jobs: boss,
    })
    expect(asked).toContain(workspace.id)
    expect(asked).toEqual([...asked].sort())
  })

  it("is made by the Git container with Shinan's README, and recorded once", async () => {
    const git = fakeGit()
    expect(
      await createCatalogRepository(asShinan(db), { workspaceId }, git.client),
    ).toEqual({
      created: true,
      firstCommit: "c".repeat(40),
    })
    expect(git.calls).toEqual([
      {
        workspaceId,
        message: repositoryFirstCommitMessage,
        files: [{ path: "README.md", content: repositoryReadme }],
      },
    ])
    expect(await row(workspaceId)).toMatchObject({
      firstCommit: "c".repeat(40),
    })
    expect((await row(workspaceId))!.createdAt).toBeInstanceOf(Date)

    expect(
      await createCatalogRepository(asShinan(db), { workspaceId }, git.client),
    ).toEqual({
      created: false,
      firstCommit: "c".repeat(40),
    })
    expect(git.calls).toHaveLength(1)
    expect(
      await requestPendingCatalogRepositories({ ...asShinan(db), jobs: boss }),
    ).not.toContain(workspaceId)
  })

  it("stays asked for while the Git container is down", async () => {
    const git = fakeGit()
    git.fail(true)
    await expect(
      createCatalogRepository(asShinan(db), { workspaceId }, git.client),
    ).rejects.toBeInstanceOf(GitServiceError)
    expect(await row(workspaceId)).toMatchObject({ firstCommit: null })
    git.fail(false)
    await createCatalogRepository(asShinan(db), { workspaceId }, git.client)
    expect(await row(workspaceId)).toMatchObject({
      firstCommit: "c".repeat(40),
    })
  })

  it("is made only for a workspace that asked, and only by Shinan", async () => {
    const git = fakeGit()
    await expect(
      createCatalogRepository(
        asShinan(db),
        { workspaceId: "0b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d" },
        git.client,
      ),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      createCatalogRepository(
        asShinan(db),
        { workspaceId: "not-an-id" },
        git.client,
      ),
    ).rejects.toBeInstanceOf(NotFoundError)
    const person = await newPerson(db)
    await expect(
      createCatalogRepository(
        asPerson(db, person),
        { workspaceId },
        git.client,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(git.calls).toHaveLength(0)
  })
})
