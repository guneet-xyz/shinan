import { and, eq, inArray, schema, sql } from "@shinan/db"
import type { Transaction } from "@shinan/db"

import type { ResolvedActor } from "../actor.js"
import { parserVersion } from "./document/index.js"
import type { CatalogDocument } from "./document/index.js"
import { indexRulesVersion } from "./index/derive.js"
import { indexRevision, lockIndexState } from "./index/indexer.js"

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
  /** The text already parsed, if the caller has it, so it is not read again. */
  parsed?: CatalogDocument
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
 * Stores a new catalog revision, the full text of each document it
 * changes, and indexes them, all in the caller's transaction (architecture
 * §5.2, rule 4). The caller (applying a catalog proposal, M2-4) has already
 * produced the text by text edits (rule 2), validated it and checked its
 * conflicts; this only stores and indexes. Revisions of one workspace are
 * numbered one at a time under the index lock.
 */
export async function appendCatalogRevision(
  tx: Transaction,
  workspaceId: string,
  actor: RevisionActor,
  documents: readonly RevisionDocument[],
  source?: RevisionSource,
  options: {
    /**
     * False when the caller derives the documents' index rows itself in
     * the same transaction, as a purge does (`reindexDocuments`).
     */
    index?: boolean
  } = {},
): Promise<AppliedRevision> {
  if (documents.length === 0)
    throw new Error("A catalog revision changes at least one document")
  const given = documents.flatMap((d) => (d.documentId ? [d.documentId] : []))
  if (new Set(given).size !== given.length)
    throw new Error("A catalog revision changes each document once")
  // A parse handed in is used as it is, so it must be of this very text.
  if (documents.some((d) => d.parsed && d.parsed.text !== d.text))
    throw new Error("A parsed document must be the parse of its text")

  const state = await lockIndexState(tx, workspaceId)
  // A process still running an older parser than the one that last built
  // the index (during a rolling deployment) would add rows of its older
  // version: answers say the index is behind until the next rebuild.
  if (
    (state.parserVersion > parserVersion ||
      state.rulesVersion > indexRulesVersion) &&
    state.rebuildRequestedAt === null
  )
    await tx
      .update(schema.catalogIndexState)
      .set({ rebuildRequestedAt: sql`now()` })
      .where(eq(schema.catalogIndexState.workspaceId, workspaceId))
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

  if (options.index === false) return { revision, documentIds }
  await indexRevision(
    tx,
    workspaceId,
    { revision, authorKind: actor.kind, author: actor.label },
    documents.map((d, i) => ({
      documentId: documentIds[i]!,
      text: d.text,
      ...(d.parsed ? { parsed: d.parsed } : {}),
    })),
  )
  return { revision, documentIds }
}

/**
 * The stable ID of the document with this catalog ID or alias, from the
 * index, for operations that change an existing document (M2-4).
 */
export async function findCatalogDocument(
  tx: Transaction,
  workspaceId: string,
  catalogId: string,
): Promise<string | null> {
  const t = schema.catalogIndexDocuments
  const [row] = await tx
    .select({ documentId: t.documentId })
    .from(t)
    .where(
      and(
        eq(t.workspaceId, workspaceId),
        sql`(${t.catalogId} = ${catalogId} or ${t.aliases} @> array[${catalogId}]::text[])`,
      ),
    )
    .orderBy(sql`${t.catalogId} = ${catalogId} desc`, t.documentId)
    .limit(1)
  return row?.documentId ?? null
}
