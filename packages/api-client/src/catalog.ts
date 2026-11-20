// The catalog as the REST API serves it to the catalog pages (human
// experience, the catalog). The answers are the agent index's own JSON
// format (catalog §12.4), so field names follow the catalog documents
// (`replaced_by`, `checked`, `via`); every answer names the commit of
// `main` it was built from and says when the index is behind.

export type FactState = "intended" | "observed" | "planned" | "unknown"
export type EntityStatus = "active" | "deprecated" | "retired"
export type ScalarValue = string | number | boolean | null

/**
 * What every catalog answer carries (catalog §12.2, §12.4). For a screen:
 * `catalog_commit` null and not `index_behind` means the workspace has no
 * repository yet (being set up); null and `index_behind` means it is being
 * indexed for the first time; a commit means ready, catching up while
 * `index_behind`.
 */
export interface CatalogAnswer {
  /** The commit of `main` the answer was built from; null before the index's first build. */
  catalog_commit: string | null
  /** The index is behind `main` or being rebuilt: the answer may be out of date. */
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
}

export interface CatalogEntity extends CatalogEntitySummary {
  replaced_by: string | null
  aliases: string[]
  imported_from: string | null
  decision_state?: string | null
  decided_on?: string | null
  decided_by?: string | null
  /** Its path on `main`, such as `machine/musashi.md`. */
  path: string
  /** The Git blob ID of its text on `main`. */
  blob: string
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

/** One file of `main` in the catalog's tree. */
export interface CatalogTreeItem {
  /** Its path on `main`, such as `machine/musashi.md`. */
  path: string
  /** Its catalog ID; null when the file could not be read. */
  id: string | null
  title: string | null
  kind: string
  status: string | null
}

/** The start-here document or a type schema document, as a page. */
export interface CatalogDocument {
  id: string
  kind: string
  path: string
  blob: string
  title: string | null
  summary: string | null
  status: string | null
  owner: string | null
  body: CatalogSection[]
  problems: { code: string; message: string }[]
}

export interface CatalogDocumentAnswer extends CatalogAnswer {
  document: CatalogDocument
}

/** Who first pushed a change: an agent for a person, or Shinan itself. */
export type CatalogPusher =
  { kind: "agent"; person: string; agent: string } | { kind: "shinan" }

/** One change of a page: a commit of `main` that changed its file. */
export interface CatalogChange {
  commit: string
  /** The commit message's first line (its start, if very long). */
  subject: string
  /** The start of the rest of the message, about 1,000 characters at most. */
  body: string
  /** When it reached `main`, from the push log; else its commit time. */
  time: string | null
  time_source: "main" | "commit"
  merge: boolean
  /** Who first pushed it, from the push log; null when it has no record. */
  pushed_by: CatalogPusher | null
}

export interface CatalogHistoryAnswer extends CatalogAnswer {
  path: string
  title: string | null
  changes: CatalogChange[]
  /**
   * The cursor for older changes, or null at the first change: opaque,
   * signed by Shinan for this page.
   */
  next_after: string | null
}

/** A file a change touched: a page by its ID and title, or just a file. */
export interface CatalogChangedPage {
  path: string
  /** The page's catalog ID, or null for a file that isn't a page now. */
  id: string | null
  title: string | null
}

/** One change of Recent changes, with the first few files it changed. */
export interface CatalogRecentChange extends CatalogChange {
  pages: CatalogChangedPage[]
  /** How many files it changed in all; at least that many if `_at_least`. */
  page_count: number
  page_count_at_least: boolean
}

export interface CatalogChangesAnswer extends CatalogAnswer {
  changes: CatalogRecentChange[]
  /** The cursor for older changes, or null at the first: opaque, signed. */
  next_after: string | null
}

/** A file's text as it is on `main`; `text` null when too large to show. */
export interface CatalogSource {
  path: string
  text: string | null
  size: number
}

export interface CatalogSourceAnswer extends CatalogAnswer {
  title: string | null
  source: CatalogSource
}

export interface CatalogReadmeAnswer extends CatalogAnswer {
  readme: CatalogSource | null
}

/** The catalog's tree for the sidebar, and how many things need attention. */
export interface CatalogTreeAnswer extends CatalogAnswer {
  items: CatalogTreeItem[]
  attention: number
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

/** The workspace lists a start-here step may point to (catalog §11). */
export type StartHereList =
  "discrepancies" | "due-for-recheck" | "known-unknowns" | "recent-changes"

export type StartHereStep =
  | { to: string; note: string; entity: CatalogEntitySummary | null }
  | { list: StartHereList; note: string }
  | { url: string; note: string }

export interface StartHereAnswer extends CatalogAnswer {
  start_here: {
    path: "people" | "agents"
    title: string | null
    summary: string | null
    /** The start-here document's path on `main` and the Git blob ID of its text. */
    document: { path: string; blob: string }
    steps: StartHereStep[]
  } | null
}
