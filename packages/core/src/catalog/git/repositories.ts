import { and, eq, isNull, schema, sql } from "@shinan/db"
import type { Transaction } from "@shinan/db"

import { atInstallation } from "../../authorize.js"
import type { Context } from "../../context.js"
import { NotFoundError } from "../../errors.js"
import { addJob } from "../../jobs.js"
import type { JobQueue, QueueDefinition } from "../../jobs.js"
import { isId } from "../../validation.js"
import type { GitClient } from "./client.js"

/**
 * Making workspaces' repositories (Git-based catalog plan §2.4): the
 * worker asks the Git container, through a job added in the same
 * transaction that creates the workspace, so a workspace that exists always
 * gets its repository, even if the Git container was down at that moment.
 */
export const catalogRepositoryQueue = {
  name: "catalog-repository-create",
  options: {
    policy: "stately",
    retryLimit: 20,
    retryDelay: 15,
    retryBackoff: true,
    expireInSeconds: 10 * 60,
  },
} as const satisfies QueueDefinition

/** What a repository job carries. */
export interface CatalogRepositoryJob {
  workspaceId: string
}

/** The first commit's only file in a new workspace's repository. */
export const repositoryReadme = `# Catalog

This repository is a Shinan workspace's catalog. Its \`main\` branch is the
catalog: one Markdown document per entity, at \`<type>/<slug>.md\` (its ID
plus \`.md\`), type schemas at \`schema/<type>.md\`, and \`start-here.md\`.
Shinan checks every push; the \`shinan\` skill explains how to change the
catalog and what a refused push means.
`

/** The first commit's message in a new workspace's repository. */
export const repositoryFirstCommitMessage = "Start the catalog\n"

/**
 * Asks for the workspace's repository, inside the transaction that creates
 * the workspace: records the request, and queues the job when a job queue
 * is there (the worker also picks up requests whose job was lost).
 */
export async function requestCatalogRepository(target: {
  tx: Transaction
  jobs: JobQueue | undefined
  workspaceId: string
}): Promise<void> {
  await target.tx
    .insert(schema.catalogRepositories)
    .values({ workspaceId: target.workspaceId })
    .onConflictDoNothing()
  if (target.jobs) {
    await addJob(
      target,
      catalogRepositoryQueue,
      { workspaceId: target.workspaceId } satisfies CatalogRepositoryJob,
      { singletonKey: target.workspaceId },
    )
  }
}

/**
 * Makes the workspace's repository in the Git container, if it was asked
 * for and is not made yet, and records its first commit. Safe to repeat:
 * the Git container makes a repository only once.
 */
export async function createCatalogRepository(
  ctx: Context,
  input: { workspaceId: string },
  git: GitClient,
): Promise<{ created: boolean; firstCommit: string }> {
  if (!isId(input.workspaceId)) throw new NotFoundError()
  const workspaceId = input.workspaceId.toLowerCase()
  const r = schema.catalogRepositories
  const row = await atInstallation(
    ctx,
    "catalog-repository.create",
    async (scope) =>
      (
        await scope.tx.select().from(r).where(eq(r.workspaceId, workspaceId))
      )[0],
  )
  if (!row) throw new NotFoundError()
  if (row.firstCommit) return { created: false, firstCommit: row.firstCommit }

  // Outside any transaction: the Git container may take a while.
  const made = await git.createRepository(workspaceId, {
    files: [
      {
        path: "README.md",
        content: new TextEncoder().encode(repositoryReadme),
      },
    ],
    message: repositoryFirstCommitMessage,
  })
  await atInstallation(ctx, "catalog-repository.create", (scope) =>
    scope.tx
      .update(r)
      .set({ createdAt: sql`now()`, firstCommit: made.main })
      .where(and(eq(r.workspaceId, workspaceId), isNull(r.firstCommit))),
  )
  return { created: made.created, firstCommit: made.main }
}

/**
 * Queues a job for every repository asked for and not made yet, such as
 * one whose job ran out of retries while the Git container was down. The
 * worker does this when it starts. Returns the workspaces.
 */
export async function requestPendingCatalogRepositories(
  ctx: Context,
): Promise<string[]> {
  return atInstallation(ctx, "catalog-repository.create", async (scope) => {
    const r = schema.catalogRepositories
    const pending = await scope.tx
      .select({ workspaceId: r.workspaceId })
      .from(r)
      .where(isNull(r.firstCommit))
      .orderBy(r.workspaceId)
    for (const { workspaceId } of pending) {
      await addJob(
        scope,
        catalogRepositoryQueue,
        { workspaceId } satisfies CatalogRepositoryJob,
        { singletonKey: workspaceId },
      )
    }
    return pending.map((p) => p.workspaceId)
  })
}
