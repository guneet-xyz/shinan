import { and, asc, eq, inArray, schema, sql } from "@shinan/db"
import type { Transaction } from "@shinan/db"

import type { RevisionAuthor } from "./attribution.js"

/**
 * Reading stored catalog text and revision records, for the indexer. Only
 * the stored text is read to build the index (architecture §5.2, rule 3).
 */

export interface StoredText {
  documentId: string
  revision: number
  text: string
}

/** Each document's latest text, ordered by document ID. */
export async function latestTexts(
  tx: Transaction,
  workspaceId: string,
  documentIds?: readonly string[],
): Promise<StoredText[]> {
  if (documentIds?.length === 0) return []
  const d = schema.catalogDocuments
  const r = schema.catalogRevisionDocuments
  return tx
    .select({ documentId: d.id, revision: r.revision, text: r.text })
    .from(d)
    .innerJoin(
      r,
      and(eq(r.documentId, d.id), eq(r.revision, d.currentRevision)),
    )
    .where(
      and(
        eq(d.workspaceId, workspaceId),
        documentIds ? inArray(d.id, [...documentIds]) : undefined,
      ),
    )
    .orderBy(asc(d.id))
}

/** Every revision of the given documents' text, by document and then revision. */
export async function textHistory(
  tx: Transaction,
  workspaceId: string,
  documentIds: readonly string[],
  upToRevision?: number,
): Promise<StoredText[]> {
  if (documentIds.length === 0) return []
  const r = schema.catalogRevisionDocuments
  return tx
    .select({ documentId: r.documentId, revision: r.revision, text: r.text })
    .from(r)
    .where(
      and(
        eq(r.workspaceId, workspaceId),
        inArray(r.documentId, [...documentIds]),
        upToRevision === undefined
          ? undefined
          : sql`${r.revision} <= ${upToRevision}`,
      ),
    )
    .orderBy(asc(r.documentId), asc(r.revision))
}

/** Who made each of the workspace's catalog revisions. */
export async function revisionAuthors(
  tx: Transaction,
  workspaceId: string,
  revisions?: readonly number[],
): Promise<Map<number, RevisionAuthor>> {
  const t = schema.catalogRevisions
  const rows = await tx
    .select({
      revision: t.number,
      authorKind: t.actorKind,
      author: t.actorLabel,
    })
    .from(t)
    .where(
      and(
        eq(t.workspaceId, workspaceId),
        revisions ? inArray(t.number, [...revisions]) : undefined,
      ),
    )
  return new Map(rows.map((row) => [row.revision, row]))
}

/** The workspace's latest applied catalog revision, or 0 before the first. */
export async function latestRevision(
  tx: Transaction,
  workspaceId: string,
): Promise<number> {
  const [row] = await tx
    .select({
      latest: sql<number>`coalesce(max(${schema.catalogRevisions.number}), 0)::int`,
    })
    .from(schema.catalogRevisions)
    .where(eq(schema.catalogRevisions.workspaceId, workspaceId))
  return row?.latest ?? 0
}
