/*
 * Catalog proposals (catalog §8): the operations the wiki's editors send,
 * the same ones agents send, and what becomes of a proposal. The operation
 * types are a copy of core's (`packages/core/src/catalog/document/
 * operations.ts`); the server's typecheck keeps the two the same.
 */

import type {
  CatalogAnswer,
  CatalogFact,
  CatalogTypeSchemaKey,
  EntityStatus,
  FactState,
  ScalarValue,
  StartHereList,
} from "./catalog.js"
import type { ActorKind } from "./index.js"

/** One operation of a catalog proposal (catalog §8.1). */
export type CatalogOperation =
  | CreateEntity
  | SetFact
  | RemoveFact
  | RecheckFacts
  | AcceptDiscrepancy
  | EditBody
  | SetField
  | Retire
  | ChangeId
  | CreateSchema
  | SetSchemaKey
  | CreateStartHere
  | SetStartHerePath
  | RestoreDocument

export interface FactInput {
  key: string
  state: FactState
  value?: Exclude<ScalarValue, null>
  to?: string
  attributes?: Readonly<Record<string, Exclude<ScalarValue, null>>>
  via?: string
  note?: string
  task?: string
  remove?: boolean
}

/** A fact check sent with an operation; Shinan writes `by`. */
export interface CheckInput {
  checked: string
  scope: string
  source: string
  limits?: string
}

export type FactExpectation = { identity: string; absent: true } | PresentFact

/** A fact as it is now, as an operation expects it (catalog §8.5). */
export interface PresentFact {
  identity: string
  value: string
  check: ExpectedCheck | null
  via?: string
  note?: string
  task?: string
  remove?: boolean
  accepted?: string
  attributes?: Readonly<Record<string, Exclude<ScalarValue, null>>>
}

export interface ExpectedCheck {
  checked: string | null
  by?: string
  scope?: string
  source?: string
  limits?: string | null
}

export interface CreateEntity {
  op: "create-entity"
  id: string
  title: string
  summary: string
  status?: EntityStatus
  owner: string
  decision?: {
    state: string
    decidedOn?: string
    decidedBy?: string
  }
  facts?: readonly { fact: FactInput; check?: CheckInput }[]
  body?: string
}

export interface SetFact {
  op: "set-fact"
  document: string
  fact: FactInput
  check?: CheckInput
  expect: FactExpectation
  supersedes?: PresentFact
}

export interface RemoveFact {
  op: "remove-fact"
  document: string
  expect: PresentFact
}

export interface AcceptDiscrepancy {
  op: "accept-discrepancy"
  document: string
  key: string
  note: string
  expect: readonly PresentFact[]
}

export interface RecheckFacts {
  op: "recheck-facts"
  document: string
  facts: readonly PresentFact[]
  check: CheckInput
}

export interface EditBody {
  op: "edit-body"
  document: string
  section?: string | null
  text: string
  expect: { text: string } | { absent: true }
}

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

export interface SetField {
  op: "set-field"
  document: string
  field: DocumentField
  value: string | readonly string[] | null
  expect: { value: string | readonly string[] | null }
}

export interface Retire {
  op: "retire"
  document: string
  replacedBy?: string
  expect: { status: EntityStatus }
}

export interface ChangeId {
  op: "change-id"
  document: string
  id: string
}

export interface KeyOptions {
  many?: boolean
  relation?: readonly string[]
  identifiedBy?: readonly string[]
  inverse?: string
  recheck?: string
}

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

export interface SetSchemaKey {
  op: "set-schema-key"
  document: string
  key: string
  options: KeyOptions | null
  expect: { absent: true } | { options: KeyOptions }
}

export type StartHereStepInput =
  | { to: string; note: string }
  | { list: StartHereList; note: string }
  | { url: string; note: string }

export interface CreateStartHere {
  op: "create-start-here"
  title: string
  summary?: string
  owner?: string
  people: readonly StartHereStepInput[]
  agents: readonly StartHereStepInput[]
  body?: string
}

export interface SetStartHerePath {
  op: "set-start-here-path"
  path: "people" | "agents"
  steps: readonly StartHereStepInput[]
  expect: { steps: readonly StartHereStepInput[] }
}

/**
 * Puts a document back as an earlier revision left it; only a revert makes
 * it (catalog §8.2). It expects the document's current text by its SHA-256.
 */
export interface RestoreDocument {
  op: "restore-document"
  document: string
  /** The text to put back. */
  text: string
  expect: { sha256: string }
}

/** A catalog proposal as sent (catalog §8.1). */
export interface CatalogProposalInput {
  explanation: string
  relatedTask?: string | null
  operations: CatalogOperation[]
  idempotencyKey?: string | null
}

/** Catalog §8.2's approval classes. */
export type ApprovalClass =
  | "recheck"
  | "observed-or-unknown"
  | "intended"
  | "planned"
  | "body-and-bookkeeping"
  | "rules"
  | "lifecycle"
  | "people-and-agents"
  | "doubtful"

export type CatalogProposalState =
  "pending" | "applied" | "rejected" | "withdrawn"

/** A problem validation found (catalog §8.3). */
export interface CatalogProblem {
  code: string
  severity: "blocking" | "warning"
  message: string
  documentId: string | null
  range?: { start: number; end: number }
}

/** An operation that conflicts or cannot apply as written (catalog §8.5). */
export interface CatalogOperationProblem {
  /** The operation's position in the proposal, from 0. */
  operation: number
  kind: "conflict" | "invalid"
  code: string
  message: string
  documentId: string | null
}

export interface CatalogProposal {
  id: string
  number: number
  state: CatalogProposalState
  createdAt: string
  author: {
    kind: ActorKind
    label: string
    personId: string | null
    agentId: string | null
  }
  explanation: string
  relatedTask: string | null
  operations: CatalogOperation[]
  basedOnRevision: number
  approvalClasses: ApprovalClass[]
  approvalReasons: string[]
  warnings: CatalogProblem[]
  touches: string[]
  appliedRevision: number | null
  decidedAt: string | null
  decidedBy: string | null
  rejectionReason: string | null
  /** The applied proposal this one reverts, for a revert. */
  revertsProposalId: string | null
  /**
   * Whether its author is still a current member, or an enabled agent of
   * one; given when proposals are read (a proposal, a list, recent changes).
   */
  authorStatus?: "current" | "agent-disabled" | "member-left"
}

/** Why a proposal did not apply; nothing was stored. */
export type CatalogNotApplied =
  | { outcome: "conflict" | "invalid"; problems: CatalogOperationProblem[] }
  | { outcome: "blocked"; problems: CatalogProblem[] }
  | { outcome: "unchanged" }

export type CatalogProposalOutcome =
  | { outcome: CatalogProposalState; proposal: CatalogProposal }
  | CatalogNotApplied

export type CatalogApprovalOutcome = CatalogProposalOutcome

/** What a proposal would do, checked without making it. */
export type CatalogPreviewOutcome =
  | {
      outcome: "applies" | "waits"
      approvalClasses: ApprovalClass[]
      approvalReasons: string[]
      warnings: CatalogProblem[]
      touches: string[]
      /** Gated, but applies at once as your own approval. */
      asApproval: boolean
    }
  | CatalogNotApplied

export interface CatalogProposalList {
  items: CatalogProposal[]
}

/**
 * What an operation expects of a fact the catalog shows (catalog §8.5): the
 * whole fact as it is now, built from the agent index's answer the way core
 * builds it from the document (`expectationOf`). A fact changed since the
 * answer was read makes the proposal conflict, which is what it should do.
 */
export function presentFact(fact: CatalogFact): PresentFact {
  const expected: PresentFact = {
    identity: fact.identity,
    value:
      fact.state === "unknown"
        ? (fact.note ?? "")
        : fact.to !== undefined
          ? fact.to
          : fact.value === undefined
            ? ""
            : String(fact.value),
    check:
      fact.check === null
        ? null
        : {
            checked: fact.check.checked,
            ...(fact.check.by === null ? {} : { by: fact.check.by }),
            ...(fact.check.scope === null ? {} : { scope: fact.check.scope }),
            ...(fact.check.source === null
              ? {}
              : { source: fact.check.source }),
            limits: fact.check.limits,
          },
  }
  if (fact.via !== undefined) expected.via = fact.via
  if (fact.note !== undefined) expected.note = fact.note
  if (fact.task !== undefined) expected.task = fact.task
  if (fact.remove) expected.remove = true
  if (fact.accepted !== undefined) expected.accepted = fact.accepted
  const attributes = Object.entries(fact.attributes ?? {}).filter(
    (e): e is [string, Exclude<ScalarValue, null>] => e[1] !== null,
  )
  if (attributes.length > 0)
    expected.attributes = Object.fromEntries(attributes)
  return expected
}

/** A document as the wiki's editors write operations against it. */
export interface CatalogEditableAnswer extends CatalogAnswer {
  id: string
  /** The revision that last changed it. */
  revision: number
  document: {
    kind: "entity" | "schema" | "start-here"
    /** Each field `set-field` changes, as `expect.value` names it. */
    fields: Partial<Record<DocumentField, string | string[] | null>>
    body: {
      text: string
      sections: {
        anchor: string | null
        heading: string | null
        level: number
        text: string
      }[]
    }
    keys?: { key: string; options: KeyOptions }[]
    paths?: { people: StartHereStepInput[]; agents: StartHereStepInput[] }
  }
}

/**
 * The fact identity key of a fact an editor writes (catalog §4.2), as core
 * makes it (`factIdentityKey`), from the key's type schema: needed to name
 * a new fact in `expect`. Core checks it again: a wrong one conflicts.
 */
export function factIdentity(
  fact: FactInput,
  key: Pick<CatalogTypeSchemaKey, "many" | "relation"> | null,
): string {
  const escape = (text: string) =>
    text.replace(/[%|\n\r]/g, (c) =>
      c === "%" ? "%25" : c === "|" ? "%7C" : c === "\n" ? "%0A" : "%0D",
    )
  const parts = [escape(fact.key), fact.state]
  const add = (name: string, value: ScalarValue | undefined) => {
    if (value !== undefined && value !== null)
      parts.push(`${name}=${escape(String(value))}`)
  }
  const many = key?.many ?? false
  if (!many) add("via", fact.via)
  else if (key?.relation) {
    add("to", fact.to)
    for (const attribute of key.relation.identified_by)
      add(
        attribute,
        fact.attributes && Object.hasOwn(fact.attributes, attribute)
          ? fact.attributes[attribute]
          : undefined,
      )
  } else if (fact.state !== "unknown") add("value", fact.value)
  return parts.join("|")
}
