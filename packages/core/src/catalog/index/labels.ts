import { and, eq, inArray, schema, sql } from "@shinan/db"
import type { ActorKind, Transaction } from "@shinan/db"

/**
 * Trust labels (agent integrations, "Trust labels"): who wrote a piece of
 * text and whether it may instruct the agent reading it. Set by Shinan
 * from its own records, never from claims in the text. All catalog text is
 * `instruction: no`.
 */
export interface TrustLabel {
  author_kind: "member" | "agent" | "outside" | "shinan"
  /** The written form (identity §8.7), where known. */
  author: string | null
  instruction: "yes" | "request" | "no"
}

/** How far each author kind is trusted, least first. */
const trust: Record<TrustLabel["author_kind"], number> = {
  outside: 0,
  agent: 1,
  shinan: 2,
  member: 3,
}

export const shinanLabel: TrustLabel = Object.freeze({
  author_kind: "shinan",
  author: "shinan",
  instruction: "no",
})

/** The less trusted of two labels; the first when they are as trusted. */
export function lessTrusted(a: TrustLabel, b: TrustLabel): TrustLabel {
  return trust[b.author_kind] < trust[a.author_kind] ? b : a
}

/**
 * The label for text an actor wrote, by its kind: a person is a `member`;
 * an actor Shinan cannot name (`unknown`, as on imports) counts as
 * `outside`, the least trusted.
 */
export function labelForActor(
  kind: ActorKind,
  author: string | null,
): TrustLabel {
  switch (kind) {
    case "person":
      return { author_kind: "member", author, instruction: "no" }
    case "agent":
      return { author_kind: "agent", author, instruction: "no" }
    case "shinan":
      return { author_kind: "shinan", author: "shinan", instruction: "no" }
    default:
      return { author_kind: "outside", author, instruction: "no" }
  }
}

/**
 * The label for a fact check's `by` (identity §8.7). Shinan writes `by`
 * itself from the actor of the request that applied the check (M2-2), so
 * it is a record, not a claim. `unknown` (imported checks) and anything
 * that is not a written actor count as `outside`.
 */
export function labelForWrittenActor(
  by: string | null | undefined,
): TrustLabel {
  if (by === "shinan") return shinanLabel
  if (by && /^[a-z0-9-]+ via [a-z0-9-]+$/.test(by))
    return { author_kind: "agent", author: by, instruction: "no" }
  if (by && by !== "unknown" && /^[a-z0-9-]+$/.test(by))
    return { author_kind: "member", author: by, instruction: "no" }
  return { author_kind: "outside", author: by ?? null, instruction: "no" }
}

/**
 * For each document named by its catalog ID, the least-trusted author of
 * any of its revisions: the label of the text that has no finer credit of
 * its own (titles, summaries, start-here notes, schema keys). Cautious on
 * purpose: one agent revision of a document labels its entity fields
 * `agent` from then on.
 */
export async function documentLabels(
  tx: Transaction,
  workspaceId: string,
  catalogIds: readonly string[],
): Promise<Map<string, TrustLabel>> {
  const labels = new Map<string, TrustLabel>()
  const ids = [...new Set(catalogIds)]
  if (ids.length === 0) return labels
  const d = schema.catalogIndexDocuments
  const rd = schema.catalogRevisionDocuments
  const r = schema.catalogRevisions
  const rows = await tx
    .selectDistinct({
      catalogId: d.catalogId,
      kind: r.actorKind,
      author: r.actorLabel,
    })
    .from(d)
    .innerJoin(rd, eq(rd.documentId, d.documentId))
    .innerJoin(
      r,
      and(eq(r.workspaceId, rd.workspaceId), eq(r.number, rd.revision)),
    )
    .where(and(eq(d.workspaceId, workspaceId), inArray(d.catalogId, ids)))
    .orderBy(sql`1, 2, 3`)
  for (const row of rows) {
    if (row.catalogId === null) continue
    const label = labelForActor(row.kind, row.author)
    const known = labels.get(row.catalogId)
    labels.set(row.catalogId, known ? lessTrusted(known, label) : label)
  }
  return labels
}

/** A JSON value with a trust label added to objects that hold text. */
export type Labelled<T> = T & { label: TrustLabel }

/**
 * Whether a JSON object holds text of its own (strings, or lists of
 * strings), and so needs a label.
 */
export function holdsText(value: object): boolean {
  return Object.entries(value).some(
    ([key, v]) =>
      key !== "label" &&
      (typeof v === "string" ||
        (Array.isArray(v) && v.some((x) => typeof x === "string"))),
  )
}

/**
 * Gives every object below `value` that holds text and has no label yet the
 * label of the nearest labelled object above it, starting from `label`.
 * Labels set more precisely beforehand stay.
 */
export function inheritLabels(value: unknown, label: TrustLabel): void {
  if (Array.isArray(value)) {
    for (const item of value) inheritLabels(item, label)
    return
  }
  if (value === null || typeof value !== "object") return
  const object = value as Record<string, unknown>
  let own = object.label as TrustLabel | undefined
  if (!own && holdsText(object)) {
    object.label = label
    own = label
  }
  for (const [key, child] of Object.entries(object))
    if (key !== "label") inheritLabels(child, own ?? label)
}
