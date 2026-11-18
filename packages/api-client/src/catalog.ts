// The catalog as the REST API serves it to the wiki (human experience, the
// wiki). The answers are the agent index's own JSON format (catalog §12.4),
// so field names follow the catalog documents (`replaced_by`, `checked`,
// `via`); every answer names the catalog revision it was built from and
// says when the index is behind.

import type { ActorKind, Confidence } from "./index.js"

export type FactState = "intended" | "observed" | "planned" | "unknown"
export type EntityStatus = "active" | "deprecated" | "retired"
export type ScalarValue = string | number | boolean | null

/** What every catalog answer carries (catalog §12.2). */
export interface CatalogAnswer {
  catalog_revision: number
  /** The index is behind the latest revision or being rebuilt: the answer may be out of date. */
  index_behind: boolean
}

export interface CatalogEntitySummary {
  id: string
  type: string | null
  title: string | null
  summary: string | null
  status: string | null
  owner: string | null
}

export interface CatalogFactCheck {
  checked: string | null
  by: string | null
  scope: string | null
  source: string | null
  limits: string | null
}

export interface CatalogFreshness {
  status: "none" | "not-checked" | "fresh" | "due"
  age_days: number | null
  recheck_days: number | null
  due_at: string | null
}

export interface CatalogFact {
  identity: string
  key: string
  state: FactState
  value?: ScalarValue
  to?: string
  via?: string
  note?: string
  task?: string
  remove?: true
  accepted?: string
  attributes?: Record<string, ScalarValue>
  many: boolean
  relation: boolean
  in_schema: boolean
  check: CatalogFactCheck | null
  freshness: CatalogFreshness
}

export interface CatalogOutgoingRelation {
  key: string
  to: string
  state: FactState
  identity: string
  attributes: Record<string, ScalarValue>
  entity: CatalogEntitySummary | null
}

export interface CatalogIncomingRelation {
  key: string
  inverse: string | null
  from: CatalogEntitySummary
  state: FactState | null
  identity: string | null
  attributes: Record<string, ScalarValue>
}

export interface CatalogDiscrepancy {
  key: string
  values: string[]
  accepted: boolean
  /** Identity keys of its facts. */
  facts: string[]
}

export interface CatalogApplies {
  entity: CatalogEntitySummary
  through: "entity" | "type" | "workspace"
  state: FactState | null
  identity: string | null
}

export interface CatalogSection {
  heading: string | null
  level: number
  anchor: string | null
  /** The section's exact Markdown, heading line included. */
  text: string
  changed_in: number
  changed_by: string
  changed_by_kind: ActorKind
  written_by: string
  written_by_kind: ActorKind
}

export interface CatalogEntity extends CatalogEntitySummary {
  replaced_by: string | null
  aliases: string[]
  imported_from: string | null
  decision_state?: string | null
  decided_on?: string | null
  decided_by?: string | null
  /** The catalog revision that last changed it. */
  revision: number
  facts: CatalogFact[]
  relations: {
    outgoing: CatalogOutgoingRelation[]
    incoming: CatalogIncomingRelation[]
  }
  discrepancies: CatalogDiscrepancy[]
  known_unknowns: string[]
  not_yet_recorded: { missing_keys: string[]; not_checked: string[] }
  applies: { policies: CatalogApplies[]; runbooks: CatalogApplies[] }
  body: CatalogSection[]
  problems: { code: string; message: string }[]
}

export interface CatalogEntityAnswer extends CatalogAnswer {
  entity: CatalogEntity
}

export interface CatalogTypeSchemaKey {
  key: string
  many: boolean
  relation: {
    targets: string[]
    identified_by: string[]
    inverse: string | null
  } | null
  recheck_days: number | null
  built_in: boolean
}

export interface CatalogTypeSchema {
  type: string
  built_in: boolean
  extended: boolean
  document: string | null
  status: string
  keys: CatalogTypeSchemaKey[]
  required: string[]
  sections: string[]
}

export interface CatalogTypeSchemaDetails extends CatalogTypeSchema {
  title: string | null
  summary: string | null
  body: CatalogSection[]
}

export interface CatalogTypeSchemasAnswer extends CatalogAnswer {
  items: CatalogTypeSchema[]
}

export interface CatalogTypeSchemaAnswer extends CatalogAnswer {
  schema: CatalogTypeSchemaDetails
}

/** An entity's freshness summary: one line on its page and in its type's index. */
export interface CatalogFreshnessSummary {
  facts: number
  oldest_checked_at: string | null
  due: number
  not_checked: number
  unknown: number
}

export interface CatalogTypeIndexAnswer extends CatalogAnswer {
  items: { entity: CatalogEntitySummary; freshness: CatalogFreshnessSummary }[]
  /** More entities than shown (the index lists at most 1,000). */
  truncated: boolean
}

export interface CatalogSearchResult {
  entity: CatalogEntitySummary
  rank: number
  sections: CatalogSection[]
}

export interface CatalogSearchAnswer extends CatalogAnswer {
  items: CatalogSearchResult[]
}

/** The workspace-wide lists (catalog §10). */
export type CatalogList =
  "discrepancies" | "due-for-recheck" | "known-unknowns" | "not-yet-recorded"

export const catalogLists: readonly CatalogList[] = [
  "discrepancies",
  "due-for-recheck",
  "known-unknowns",
  "not-yet-recorded",
]

export interface CatalogDiscrepancyItem extends CatalogDiscrepancy {
  entity: CatalogEntitySummary
  fact_details: CatalogFact[]
}

export interface CatalogFactItem {
  entity: CatalogEntitySummary
  fact: CatalogFact
}

export interface CatalogNotYetRecordedItem {
  entity: CatalogEntitySummary
  missing_keys: string[]
  not_checked: CatalogFact[]
}

export type CatalogListItem =
  CatalogDiscrepancyItem | CatalogFactItem | CatalogNotYetRecordedItem

export interface CatalogListAnswer<T = CatalogListItem> extends CatalogAnswer {
  items: T[]
  next_offset: number | null
}

export interface CatalogChange {
  revision: number
  at: string
  changed_by: string
  changed_by_kind: string
  documents: { id: string | null; kind: string | null }[]
}

export interface CatalogChangesAnswer extends CatalogAnswer {
  since: number
  items: CatalogChange[]
  next_since: number | null
}

/** The workspace lists a start-here step may point to (catalog §11). */
export type StartHereList =
  | "discrepancies"
  | "due-for-recheck"
  | "known-unknowns"
  | "recent-changes"
  | "waiting-for-approval"

export type StartHereStep =
  | { to: string; note: string; entity: CatalogEntitySummary | null }
  | { list: StartHereList; note: string }
  | { url: string; note: string }

export interface StartHereAnswer extends CatalogAnswer {
  start_here: {
    path: "people" | "agents"
    title: string | null
    summary: string | null
    revision: number
    steps: StartHereStep[]
  } | null
}

export interface CatalogHistoryItem {
  revision: number
  at: string
  changed_by: string
  changed_by_kind: ActorKind
  confidence: Confidence
}

export interface CatalogHistoryAnswer extends CatalogAnswer {
  id: string
  kind: string
  items: CatalogHistoryItem[]
  next_before: number | null
}

export interface CatalogDocumentTextAnswer extends CatalogAnswer {
  id: string
  kind: string
  revision: number
  at: string
  changed_by: string
  changed_by_kind: ActorKind
  text: string
}

export interface CatalogPageOpened {
  id: string
  revision: number
  opened_revision: number | null
  opened_at: string | null
}
