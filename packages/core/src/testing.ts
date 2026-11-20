import type { Database } from "@shinan/db"

import { createMemoryGit } from "../test/memory-git.js"
import type { FileContent, MemoryGit } from "../test/memory-git.js"
import { updateWorkspaceIndex } from "./catalog/index/indexer.js"

/**
 * For other packages' tests and local screen checks only (not in the built
 * package).
 */

const git = createMemoryGit()

/**
 * The in-memory repositories `pushCatalogFiles` commits to, as a Git
 * client: for tests of what reads the repository (a page's history and
 * source).
 */
export const catalogTestGit: MemoryGit = git

/**
 * Commits files to `main` of an in-memory repository standing in for the
 * workspace's catalog repository (made on first use), then brings the
 * workspace's agent index up to it, as the worker's index job does after a
 * push. `null` deletes a file. Returns the new commit of `main`.
 */
export async function pushCatalogFiles(
  db: Database,
  workspaceId: string,
  files: Record<string, FileContent | null>,
): Promise<string> {
  const commit = (await git.getRepository(workspaceId))
    ? git.push(workspaceId, files)
    : git.create(workspaceId, {
        "README.md": "# Catalog\n",
        ...Object.fromEntries(
          Object.entries(files).flatMap(([path, file]) =>
            file === null ? [] : [[path, file] as const],
          ),
        ),
      })
  await updateWorkspaceIndex(db, git, workspaceId)
  return commit
}

export { createMemoryGit }
export type { FileContent, MemoryGit }

/** An agent of `person` in the workspace, with every scope, as a context. */
export { asAgent } from "../test/helpers.js"
