import type { Database } from "@shinan/db"

import { createMemoryGit } from "../test/memory-git.js"
import type { FileContent, MemoryGit } from "../test/memory-git.js"
import { updateWorkspaceIndex } from "./catalog/index/indexer.js"
import { appendCatalogRevision } from "./catalog/revisions.js"
import type {
  AppliedRevision,
  RevisionActor,
  RevisionDocument,
} from "./catalog/revisions.js"

/**
 * For other packages' tests and local screen checks only (not in the built
 * package).
 */

/**
 * Stores a catalog revision directly in M2's revision store, which only
 * purge (until GC-8) and the move into Git (GC-6) still read. The agent
 * index does not: use `pushCatalogFiles` for catalog content.
 */
export async function storeCatalogRevision(
  db: Database,
  workspaceId: string,
  actor: RevisionActor,
  documents: readonly RevisionDocument[],
): Promise<AppliedRevision> {
  return db.transaction((tx) =>
    appendCatalogRevision(tx, workspaceId, actor, documents),
  )
}

const git = createMemoryGit()

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
export type { FileContent, MemoryGit, RevisionActor, RevisionDocument }

/** An agent of `person` in the workspace, with every scope, as a context. */
export { asAgent } from "../test/helpers.js"
