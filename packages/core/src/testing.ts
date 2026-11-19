import type { Database } from "@shinan/db"

import { appendCatalogRevision } from "./catalog/revisions.js"
import type {
  AppliedRevision,
  RevisionActor,
  RevisionDocument,
} from "./catalog/revisions.js"

/**
 * For other packages' tests and local screen checks only (not in the built
 * package): stores and indexes a catalog revision directly, as applying a
 * catalog proposal does, without the proposal. Production code changes the
 * catalog only through catalog proposals (catalog §8.1).
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

export type { RevisionActor, RevisionDocument }

/** An agent of `person` in the workspace, with every scope, as a context. */
export { asAgent } from "../test/helpers.js"
