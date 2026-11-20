import type { schema } from "@shinan/db"

import { dayMillis } from "../document/dates.js"
import type {
  FactState,
  ScalarValue,
  StartHereStep,
  TypeSchema,
  WorkspaceList,
} from "../document/index.js"

/*
 * The agent index's JSON format (catalog §12.4). Field names follow the
 * documents' own (`replaced_by`, `checked`, `via`, `to`), so agents learn
 * one vocabulary; fields the index adds are in the same style.
 */

/** What every answer from the agent index carries (catalog §12.2). */
export interface CatalogAnswer {
  /**
   * The commit of `main` the answer was built from; null until the index
   * has first been built from the workspace's repository.
   */
  catalog_commit: string | null
  /**
   * The index is behind `main`, or is being rebuilt (for example after a
   * release changed the parser), so the answer may be out of date.
   */
  index_behind: boolean
}

/** An entity in a list, a search result or a relation. */
export interface EntitySummaryJson {
  id: string
  type: string | null
  title: string | null
  summary: string | null
  status: string | null
  owner: string | null
}

/** A fact check (catalog §4.5); `checked` as written, `null` for "not checked". */
export interface FactCheckJson {
  checked: string | null
  by: string | null
  scope: string | null
  source: string | null
  limits: string | null
}

/** Computed when read, never stored (catalog §4.6, §12.2). */
export interface FreshnessJson {
  /**
   * `none` for a `planned` fact; `not-checked` with no fact check or
   * `checked: null`; `due` once the key's recheck interval has passed;
   * otherwise `fresh`.
   */
  status: "none" | "not-checked" | "fresh" | "due"
  /** Whole days since it was checked. */
  age_days: number | null
  /** The key's recheck interval from the type schema, in days. */
  recheck_days: number | null
  /** When it is or was due for recheck (ISO 8601). */
  due_at: string | null
}

/**
 * One fact (catalog §4). The long-form fields (`value`, `to`, `via`,
 * `note`, `task`, `remove`, `accepted`) appear only when written.
 */
export interface FactJson {
  /** The fact identity key (catalog §4.2). */
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
  /** A relation's attributes, such as `path`. */
  attributes?: Record<string, ScalarValue>
  /** Multi-valued, per the type schema. */
  many: boolean
  relation: boolean
  /** Whether the type schema names the key (catalog §3.9). */
  in_schema: boolean
  check: FactCheckJson | null
  freshness: FreshnessJson
}

/** A relation written on this entity (catalog §5). */
export interface OutgoingRelationJson {
  key: string
  /** The target as written. */
  to: string
  state: FactState
  identity: string
  attributes: Record<string, ScalarValue>
  /** The target entity, or null when it is not an entity (`schema/<type>`, `workspace`, a task ID) or does not resolve. */
  entity: EntitySummaryJson | null
}

/**
 * A relation written on another entity that points here, shown under its
 * inverse name (catalog §5), such as `checkouts`. The `owner` and
 * `replaced_by` fields of other entities are included as `owns` and
 * `replaces`, with no state or identity.
 */
export interface IncomingRelationJson {
  key: string
  inverse: string | null
  from: EntitySummaryJson
  state: FactState | null
  identity: string | null
  attributes: Record<string, ScalarValue>
}

export interface DiscrepancyJson {
  key: string
  /** The values that differ, as text. */
  values: string[]
  /** All its facts carry `accepted` (catalog §4.7). */
  accepted: boolean
  /** The identity keys of its facts, which are in `facts`. */
  facts: string[]
}

/** A policy or runbook that applies to an entity through `applies-to`. */
export interface AppliesJson {
  entity: EntitySummaryJson
  /** Whether it names the entity itself, its type (`schema/<type>`) or the whole workspace. */
  through: "entity" | "type" | "workspace"
  state: FactState | null
  identity: string | null
}

/** One section of a body, split by heading (catalog §2.5, §12.1). */
export interface SectionJson {
  /** Null for the text before the first heading. */
  heading: string | null
  level: number
  anchor: string | null
  /** The section's exact Markdown, heading line included. */
  text: string
}

export interface ProblemJson {
  code: string
  message: string
}

/** One entity, with everything an agent needs to decide whether to rely on it (catalog §12.1). */
export interface EntityJson extends EntitySummaryJson {
  replaced_by: string | null
  aliases: string[]
  imported_from: string | null
  /** On `decision` entities only. */
  decision_state?: string | null
  decided_on?: string | null
  decided_by?: string | null
  /** The document's path on `main`, such as `machine/musashi.md`. */
  path: string
  /** The Git blob ID of the document's text on `main`. */
  blob: string
  facts: FactJson[]
  relations: {
    outgoing: OutgoingRelationJson[]
    incoming: IncomingRelationJson[]
  }
  discrepancies: DiscrepancyJson[]
  /** Facts written as `unknown`, by identity key (catalog §4.8). */
  known_unknowns: string[]
  not_yet_recorded: {
    /** Required keys of the type schema the entity does not mention. */
    missing_keys: string[]
    /** Identity keys of facts whose fact check says `checked: null`. */
    not_checked: string[]
  }
  /** Policies and runbooks that apply to it (catalog §12.1). */
  applies: {
    policies: AppliesJson[]
    runbooks: AppliesJson[]
  }
  body: SectionJson[]
  /** What kept the text from being read as catalog §2 describes; normally empty. */
  problems: ProblemJson[]
}

/** One key of a type schema (catalog §3, §3.9). */
export interface TypeSchemaKeyJson {
  key: string
  many: boolean
  relation: {
    /** Entity types, or `*` for any entity, type or the whole workspace, or `task`. */
    targets: string[]
    identified_by: string[]
    inverse: string | null
  } | null
  recheck_days: number | null
  /** One of Shinan's built-in keys, which cannot be changed. */
  built_in: boolean
}

export interface TypeSchemaJson {
  type: string
  built_in: boolean
  /** A built-in type that the workspace extends with its own schema document. */
  extended: boolean
  /** The type schema document, such as `schema/domain`; null for a built-in type not extended. */
  document: string | null
  status: string
  keys: TypeSchemaKeyJson[]
  required: string[]
  /** Body section conventions. */
  sections: string[]
}

/** A type schema with its document's text, when it has one. */
export interface TypeSchemaAnswerJson extends TypeSchemaJson {
  title: string | null
  summary: string | null
  body: SectionJson[]
}

/** A step of a start-here path (catalog §11), as written. */
export type StepJson =
  | { to: string; note: string }
  | { list: WorkspaceList; note: string }
  | { url: string; note: string }

/** A step with its entity, when it names one. */
export type ResolvedStepJson =
  | { to: string; note: string; entity: EntitySummaryJson | null }
  | { list: WorkspaceList; note: string }
  | { url: string; note: string }

export function stepJson(step: StartHereStep): StepJson {
  switch (step.target.kind) {
    case "entity":
      return { to: step.target.id, note: step.note }
    case "list":
      return { list: step.target.list, note: step.note }
    case "url":
      return { url: step.target.url, note: step.note }
  }
}

export function typeSchemaJson(type: TypeSchema): TypeSchemaJson {
  return {
    type: type.type,
    built_in: type.builtIn,
    extended: type.extended,
    document: type.documentId,
    status: type.status,
    keys: [...type.keys.values()].map((k) => ({
      key: k.key,
      many: k.many,
      relation: k.relation
        ? {
            targets: [...k.relation.targets],
            identified_by: [...k.relation.identifiedBy],
            inverse: k.relation.inverse,
          }
        : null,
      recheck_days: k.recheckDays,
      built_in: k.builtIn,
    })),
    required: [...type.required],
    sections: [...type.sections],
  }
}

type DocumentRecord = typeof schema.catalogIndexDocuments.$inferSelect
type FactRecord = typeof schema.catalogIndexFacts.$inferSelect
type SectionRecord = typeof schema.catalogIndexSections.$inferSelect

export function summaryJson(
  row: Pick<
    DocumentRecord,
    "catalogId" | "type" | "title" | "summary" | "status" | "owner"
  >,
): EntitySummaryJson {
  return {
    id: row.catalogId ?? "",
    type: row.type,
    title: row.title,
    summary: row.summary,
    status: row.status,
    owner: row.owner,
  }
}

export function freshnessJson(
  fact: Pick<FactRecord, "state" | "checkedAt" | "recheckDays" | "dueAt">,
  now: number,
): FreshnessJson {
  const recheck = fact.recheckDays
  if (fact.state === "planned")
    return {
      status: "none",
      age_days: null,
      recheck_days: recheck,
      due_at: null,
    }
  if (fact.checkedAt === null)
    return {
      status: "not-checked",
      age_days: null,
      recheck_days: recheck,
      due_at: null,
    }
  const checkedAt = fact.checkedAt.getTime()
  const dueAt = fact.dueAt?.getTime() ?? null
  return {
    status: dueAt !== null && now >= dueAt ? "due" : "fresh",
    age_days: Math.max(0, Math.floor((now - checkedAt) / dayMillis)),
    recheck_days: recheck,
    due_at: dueAt === null ? null : new Date(dueAt).toISOString(),
  }
}

export function factJson(fact: FactRecord, now: number): FactJson {
  const json: FactJson = {
    identity: fact.identity,
    key: fact.key,
    state: fact.state as FactState,
    many: fact.many,
    relation: fact.relation,
    in_schema: fact.inSchema,
    check: fact.hasCheck
      ? {
          checked: fact.checked,
          by: fact.by,
          scope: fact.scope,
          source: fact.source,
          limits: fact.limits,
        }
      : null,
    freshness: freshnessJson(fact, now),
  }
  if (fact.value !== null) json.value = fact.value[0]
  if (fact.to !== null) json.to = fact.to
  if (fact.via !== null) json.via = fact.via
  if (fact.note !== null) json.note = fact.note
  if (fact.task !== null) json.task = fact.task
  if (fact.remove) json.remove = true
  if (fact.accepted !== null) json.accepted = fact.accepted
  if (Object.keys(fact.attributes).length > 0)
    json.attributes = { ...fact.attributes }
  return json
}

export function sectionJson(section: SectionRecord): SectionJson {
  return {
    heading: section.heading,
    level: section.level,
    anchor: section.anchor,
    text: section.text,
  }
}
