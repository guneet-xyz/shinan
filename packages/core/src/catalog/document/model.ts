import type { Body } from "./body.js"
import type { CatalogTime } from "./dates.js"
import type { Problem } from "./problems.js"
import type { Range } from "./source.js"
import type { ScalarValue, YamlEntry } from "./yaml.js"

/** Entity status (catalog §2.3): describes the thing, not the page's accuracy. */
export const entityStatuses = ["active", "deprecated", "retired"] as const
export type EntityStatus = (typeof entityStatuses)[number]

/** Fact states (catalog §4.4, D-025). */
export const factStates = [
  "intended",
  "observed",
  "planned",
  "unknown",
] as const
export type FactState = (typeof factStates)[number]

/** A `decision` entity's own state (catalog §3, decision). */
export const decisionStates = [
  "proposed",
  "accepted",
  "rejected",
  "superseded",
] as const
export type DecisionState = (typeof decisionStates)[number]

/** The fields of a fact check (catalog §4.5). */
export const checkFields = [
  "checked",
  "by",
  "scope",
  "source",
  "limits",
] as const
export type CheckField = (typeof checkFields)[number]

/**
 * Any catalog document: an entity, a type schema document or the start-here
 * document (catalog §2, §3.9, §11). Which one is decided by its `id`:
 * `schema/<type>` is a type schema document, `start-here` the start-here
 * document, anything else an entity.
 */
export type CatalogDocument =
  EntityDocument | SchemaDocument | StartHereDocument

interface DocumentCommon {
  /** The document's full text, exactly as stored. */
  text: string
  /** The YAML between the `---` lines; null if there is no frontmatter. */
  frontmatter: Range | null
  body: Body
  id: string | null
  title: string | null
  summary: string | null
  /** A reference to a `person` entity, or `unknown`. */
  owner: string | null
  importedFrom: string | null
  /** Every top-level frontmatter field as written, for edits. */
  fields: ReadonlyMap<string, YamlEntry>
  /** What stops the document from being read as catalog §2 describes. All are blocking. */
  problems: Problem[]
}

export interface EntityDocument extends DocumentCommon {
  kind: "entity"
  type: string | null
  status: EntityStatus | null
  replacedBy: string | null
  aliases: string[]
  /** Only on `decision` entities. */
  decision: DecisionFields | null
  groups: FactGroup[]
  /** Every fact in document order, as written (before the type schema is applied). */
  facts: WrittenFact[]
}

export interface DecisionFields {
  state: DecisionState | null
  decidedOn: CatalogTime | null
  decidedBy: string | null
}

/**
 * One item of `facts` (catalog §4.3): a fact check with the facts it covers,
 * or facts with no fact check.
 */
export interface FactGroup {
  /** Position in the `facts` list. */
  index: number
  range: Range
  /** Null when the group has none of the fact check fields. */
  check: FactCheck | null
  /** The state maps in the group, in the order written. */
  states: { state: FactState; entry: YamlEntry }[]
}

export interface FactCheck {
  /**
   * When the check happened. `null` when written as `null` (an imported fact
   * that was never checked); `undefined` when missing or not a valid date.
   */
  checked: CatalogTime | null | undefined
  by: string | undefined
  scope: string | undefined
  source: string | undefined
  limits: string | undefined
  /** Each field as written, for edits and to tell "missing" from "invalid". */
  entries: Partial<Record<CheckField, YamlEntry>>
}

/**
 * One fact as written, before its key's type schema is applied. Relations
 * written in short form (`provides: service/x`) have their target in `value`
 * here; `resolveEntity` moves it to `to`.
 */
export interface WrittenFact {
  key: string
  state: FactState
  /**
   * Its group's position in the `facts` list: the `index` of a group in
   * `groups`. Not a position in `groups`, which leaves out list items that
   * are not groups.
   */
  group: number
  /** Its position when the key holds a list; null when the key holds one value. */
  item: number | null
  form: "short" | "long"
  /** The value. Never set on `unknown` facts, which have a `note` instead. */
  value: ScalarValue | undefined
  /** A relation's target, from the long form. */
  to: string | undefined
  via: string | undefined
  /** For `unknown` facts, why it is unknown. */
  note: string | undefined
  /** A task ID, or the ID of an accepted `decision` entity, behind a `planned` fact. */
  task: string | undefined
  /** On a `planned` fact: the plan is to remove the value. */
  remove: boolean
  /** The `person` entity who accepted the discrepancy this fact is part of (catalog §4.7). */
  accepted: string | undefined
  /** Any other long-form fields: a relation's attributes, such as `path` or `item`. */
  attributes: Readonly<Record<string, ScalarValue>>
  /** The whole fact: the `key: value` entry, or the list item. */
  range: Range
  keyRange: Range
  /** The value: the scalar, or the long-form map. */
  valueRange: Range
}

export interface SchemaDocument extends DocumentCommon {
  kind: "schema"
  /** The type it describes or extends: `domain` for `schema/domain`. */
  describes: string | null
  status: EntityStatus | null
  keys: SchemaKeyDefinition[]
  required: string[]
  sections: string[]
}

/** One key of a type schema document, as written (catalog §3.9). */
export interface SchemaKeyDefinition {
  key: string
  many: boolean | undefined
  /** Target types, making the key a relation. */
  relation: string[] | undefined
  identifiedBy: string[] | undefined
  inverse: string | undefined
  /** The recheck interval as written, such as `30d`. */
  recheck: string | undefined
  range: Range
}

export interface StartHereDocument extends DocumentCommon {
  kind: "start-here"
  people: StartHereStep[]
  agents: StartHereStep[]
}

/** One step of a start-here path (catalog §11). */
export interface StartHereStep {
  target: StartHereTarget
  /** The sentence shown with the step. */
  note: string
  range: Range
}

export type StartHereTarget =
  | { kind: "entity"; id: string }
  | { kind: "list"; list: WorkspaceList }
  | { kind: "url"; url: string }

/** The generated workspace-wide lists a start-here step may point to (catalog §10). */
export const workspaceLists = [
  "discrepancies",
  "due-for-recheck",
  "known-unknowns",
  "recent-changes",
] as const
export type WorkspaceList = (typeof workspaceLists)[number]
