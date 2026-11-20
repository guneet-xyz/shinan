import { and, asc, eq, inArray, schema, sql } from "@shinan/db"
import type { Transaction } from "@shinan/db"

import type { ResolvedActor } from "../actor.js"
import { readDocumentId } from "./document/parse.js"

/** Who a revision is credited to: the columns events use (architecture §5.3). */
export type RevisionActor = Pick<
  ResolvedActor,
  "kind" | "personId" | "agentId" | "agentSessionId" | "label" | "confidence"
>

export interface RevisionDocument {
  /** The document's stable ID; leave out for a new document. */
  documentId?: string
  /** The document's full new text (architecture §5.2, rule 1). */
  text: string
}

/** What a revision came from, recorded with it (architecture §5.3). */
export type RevisionSource = ProposalSource | PurgeSource

/** A catalog proposal applied. */
export interface ProposalSource {
  /** The catalog proposal it applies (M2-4). */
  proposalId: string
  /** The revision the proposal was made against. */
  basedOnRevision: number
  /** The person whose catalog approval applied it, if it needed one. */
  approvedBy?: { personId: string; label: string }
}

/**
 * A purge (catalog §9), storing the latest text of the documents whose
 * latest text it changed, so the revision number tells agents and the
 * catalog workers that the text changed.
 */
export interface PurgeSource {
  purgeId: string
}

export interface AppliedRevision {
  revision: number
  /** The stable IDs of the documents, in the order given. */
  documentIds: string[]
}

/**
 * Takes the lock of a workspace's revision store until the transaction
 * ends: revisions are numbered one at a time, and a purge rewrites the
 * stored text with no revision appended meanwhile.
 */
export async function lockCatalogRevisions(
  tx: Transaction,
  workspaceId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`catalog-revisions:${workspaceId}`}))`,
  )
}

/** A document's latest text in M2's revision store. */
export interface StoredText {
  documentId: string
  revision: number
  text: string
}

/** Each document's latest stored text, ordered by document ID. */
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

/**
 * Stores a new catalog revision and the full text of each document it
 * changes in M2's revision store, in the caller's transaction. Its callers
 * are purge (until GC-8 rewrites it for Git) and the tests' seam; M2's
 * catalog proposals, which were its other caller, are gone (GC-5), and this
 * store goes when GC-6 moves the catalog into Git. The agent index no
 * longer reads it: the index is built from `main` (GC-4). Revisions of one
 * workspace are numbered one at a time under a lock of their own.
 */
export async function appendCatalogRevision(
  tx: Transaction,
  workspaceId: string,
  actor: RevisionActor,
  documents: readonly RevisionDocument[],
  source?: RevisionSource,
): Promise<AppliedRevision> {
  if (documents.length === 0)
    throw new Error("A catalog revision changes at least one document")
  const given = documents.flatMap((d) => (d.documentId ? [d.documentId] : []))
  if (new Set(given).size !== given.length)
    throw new Error("A catalog revision changes each document once")

  await lockCatalogRevisions(tx, workspaceId)
  const [next] = await tx
    .select({
      number: sql<number>`coalesce(max(${schema.catalogRevisions.number}), 0)::int + 1`,
    })
    .from(schema.catalogRevisions)
    .where(eq(schema.catalogRevisions.workspaceId, workspaceId))
  const revision = next!.number
  await tx.insert(schema.catalogRevisions).values({
    workspaceId,
    number: revision,
    actorKind: actor.kind,
    actorPersonId: actor.personId,
    actorAgentId: actor.agentId,
    actorAgentSessionId: actor.agentSessionId,
    actorLabel: actor.label,
    confidence: actor.confidence,
    ...(source && "purgeId" in source
      ? { purgeId: source.purgeId }
      : {
          proposalId: source?.proposalId ?? null,
          basedOnRevision: source?.basedOnRevision ?? null,
          approvedByPersonId: source?.approvedBy?.personId ?? null,
          approvedByLabel: source?.approvedBy?.label ?? null,
        }),
  })

  if (given.length > 0) {
    const updated = await tx
      .update(schema.catalogDocuments)
      .set({ currentRevision: revision })
      .where(
        and(
          eq(schema.catalogDocuments.workspaceId, workspaceId),
          inArray(schema.catalogDocuments.id, given),
        ),
      )
      .returning({ id: schema.catalogDocuments.id })
    if (updated.length !== given.length)
      throw new Error(
        "A catalog revision can only change documents of its workspace",
      )
  }
  const documentIds: string[] = []
  for (const document of documents) {
    if (document.documentId) {
      documentIds.push(document.documentId)
      continue
    }
    const [created] = await tx
      .insert(schema.catalogDocuments)
      .values({ workspaceId, currentRevision: revision })
      .returning({ id: schema.catalogDocuments.id })
    documentIds.push(created!.id)
  }
  await tx.insert(schema.catalogRevisionDocuments).values(
    documents.map((d, i) => ({
      workspaceId,
      revision,
      documentId: documentIds[i]!,
      text: d.text,
    })),
  )
  return { revision, documentIds }
}

/**
 * The stable ID of the document whose latest text in M2's revision store
 * has this catalog ID, for tests of what still reads that store (purge,
 * until GC-8).
 */
export async function findCatalogDocument(
  tx: Transaction,
  workspaceId: string,
  catalogId: string,
): Promise<string | null> {
  const rows = await latestTexts(tx, workspaceId)
  return (
    rows.find((row) => readDocumentId(row.text) === catalogId)?.documentId ??
    null
  )
}
