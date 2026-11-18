import type { FactIdentityKey } from "./identity.js"
import type { EntityStatus, FactState, WorkspaceList } from "./model.js"
import type { ScalarValue } from "./yaml.js"

/**
 * The operations of a catalog proposal (catalog §8.1). Agents send them
 * through MCP, and the web editor produces the same ones. Each names the
 * document it changes by its ID and states what it expects to find there
 * (catalog §8.5); `applyOperations` checks every expectation against the
 * latest revision and applies the operation as a text edit.
 *
 * `by` is never part of an operation: the applier writes the actor's
 * written form from the request (identity §8.7).
 */
export type CatalogOperation =
  | CreateEntity
  | SetFact
  | RemoveFact
  | RecheckFacts
  | EditBody
  | SetField
  | Retire
  | ChangeId
  | CreateSchema
  | SetSchemaKey
  | CreateStartHere
  | SetStartHerePath

/** A fact as an operation writes it (catalog §4.3). */
export interface FactInput {
  key: string
  state: FactState
  /** The value of a key that is not a relation. Not for `unknown` facts. */
  value?: Exclude<ScalarValue, null>
  /** A relation's target entity. */
  to?: string
  /** A relation's attributes, such as a checkout's `path`. */
  attributes?: Readonly<Record<string, Exclude<ScalarValue, null>>>
  /** The means of observation, for a second observation of a single-valued key. */
  via?: string
  /** A note; on an `unknown` fact, required: why it is unknown. */
  note?: string
  /** The task ID, or accepted `decision` entity, behind a `planned` fact. */
  task?: string
  /** On a `planned` fact: the plan is to remove the value. */
  remove?: boolean
  /** The `person` entity accepting the discrepancy this fact is part of (catalog §4.7). */
  accepted?: string
}

/**
 * A fact check sent with an operation (catalog §4.5). `by` is not part of
 * it: the applier writes the actor.
 */
export interface CheckInput {
  /** When the check happened: a date, or a date and time with a UTC offset. */
  checked: string
  scope: string
  source: string
  limits?: string
}

/**
 * What an operation expects of one fact identity (catalog §8.5): either that
 * no current fact has it, or the current fact's value and fact check.
 */
export type FactExpectation =
  | { identity: FactIdentityKey; absent: true }
  | {
      identity: FactIdentityKey
      /**
       * The fact's value as text, as `factValueText` gives it: a value as
       * written (`128`, `true`), a relation's target, an `unknown` fact's note.
       */
      value: string
      /**
       * The fact check of its group: `checked` as written (null for an
       * imported `checked: null`), and any other field given must match.
       * Null for a fact with no fact check.
       */
      check: ExpectedCheck | null
    }

export type PresentFact = Extract<FactExpectation, { value: string }>

export interface ExpectedCheck {
  checked: string | null
  by?: string
  scope?: string
  source?: string
  limits?: string | null
}

/** Creates an entity document (catalog §2). Expects no document with its ID or alias. */
export interface CreateEntity {
  op: "create-entity"
  /** `<type>/<slug>`; the type is taken from it. */
  id: string
  title: string
  summary: string
  /** Defaults to `active`. */
  status?: EntityStatus
  owner: string
  /** For `decision` entities. */
  decision?: {
    state: string
    decidedOn?: string
    decidedBy?: string
  }
  /** Facts, each with its fact check, written as `set-fact` would. */
  facts?: readonly { fact: FactInput; check?: CheckInput }[]
  /** The Markdown body, written after a blank line. */
  body?: string
}

/**
 * Writes a fact (catalog §4.2): it replaces the current fact with the same
 * identity, or is added beside the others. `expect` names that identity.
 *
 * A change of state (a `planned` fact becoming `intended` or `observed`, an
 * `unknown` fact becoming known) names the fact it settles in `supersedes`,
 * which is removed in the same operation. A known value also removes, without
 * being named, the `unknown` facts it settles: the one of a single-valued key,
 * or a relation's that names the same target.
 */
export interface SetFact {
  op: "set-fact"
  document: string
  fact: FactInput
  /** Required for `intended` and `observed` facts, optional for `unknown`, never for `planned`. */
  check?: CheckInput
  expect: FactExpectation
  supersedes?: PresentFact
}

/** Removes a fact, never by omission (catalog §4.2). */
export interface RemoveFact {
  op: "remove-fact"
  document: string
  expect: PresentFact
}

/** Records a new fact check for facts whose values did not change (catalog §4.5). */
export interface RecheckFacts {
  op: "recheck-facts"
  document: string
  facts: readonly PresentFact[]
  check: CheckInput
}

/**
 * Edits the whole body, or one section of it (catalog §2.5). A section is
 * named by its anchor (`cautions`), or null for the text before the first
 * heading. With `expect: { absent: true }`, a section that does not exist
 * yet is added: at the end of the body, or for null at its start.
 */
export interface EditBody {
  op: "edit-body"
  document: string
  /** Omitted for the whole body. */
  section?: string | null
  /** The new Markdown; for a section, including its heading line. Empty removes a section. */
  text: string
  expect: { text: string } | { absent: true }
}

/** Fields `set-field` changes; `id`, `type`, `aliases` and `imported_from` have their own rules. */
export type DocumentField =
  | "title"
  | "summary"
  | "status"
  | "owner"
  | "decision_state"
  | "decided_on"
  | "decided_by"
  | "required"
  | "sections"

/**
 * Changes a document field (catalog §2.3): an entity's title, summary,
 * status (not to `retired`, which is `retire`), owner and decision fields; a
 * type schema document's title, summary, status, owner, `required` and
 * `sections`; the start-here document's title, summary and owner. Null
 * removes an optional field; `expect.value` null means it is not there.
 */
export interface SetField {
  op: "set-field"
  document: string
  field: DocumentField
  value: string | readonly string[] | null
  expect: { value: string | readonly string[] | null }
}

/** Retires an entity or a type schema document, naming any replacement (catalog §9). */
export interface Retire {
  op: "retire"
  document: string
  /** An entity's replacement, written as `replaced_by`. */
  replacedBy?: string
  expect: { status: EntityStatus }
}

/**
 * Changes an entity's ID (catalog §2.4): the old ID moves to `aliases` and
 * keeps resolving. The type stays; expects no document to have the new ID or
 * alias.
 */
export interface ChangeId {
  op: "change-id"
  document: string
  id: string
}

/** A type schema key's options (catalog §3.9). */
export interface KeyOptions {
  many?: boolean
  relation?: readonly string[]
  identifiedBy?: readonly string[]
  inverse?: string
  /** A whole number of days, such as `30d`. */
  recheck?: string
}

/** Creates a type schema document `schema/<type>` (catalog §3.9). */
export interface CreateSchema {
  op: "create-schema"
  type: string
  title: string
  summary: string
  owner: string
  status?: EntityStatus
  keys?: Readonly<Record<string, KeyOptions>>
  required?: readonly string[]
  sections?: readonly string[]
  body?: string
}

/** Adds, changes or (with null) removes one key of a type schema document. */
export interface SetSchemaKey {
  op: "set-schema-key"
  document: string
  key: string
  options: KeyOptions | null
  expect: { absent: true } | { options: KeyOptions }
}

export type StartHereStepInput =
  | { to: string; note: string }
  | { list: WorkspaceList; note: string }
  | { url: string; note: string }

/** Creates the start-here document (catalog §11). */
export interface CreateStartHere {
  op: "create-start-here"
  title: string
  summary?: string
  owner?: string
  people: readonly StartHereStepInput[]
  agents: readonly StartHereStepInput[]
  body?: string
}

/** Replaces one of the start-here document's two paths. */
export interface SetStartHerePath {
  op: "set-start-here-path"
  path: "people" | "agents"
  steps: readonly StartHereStepInput[]
  expect: { steps: readonly StartHereStepInput[] }
}
