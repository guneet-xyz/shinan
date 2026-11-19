/*
 * The operations the wiki's editors send (catalog §8.1): the same ones
 * agents send, built from what the person changed. Each states what it
 * expects to find (catalog §8.5), from the document's editable form and
 * the entity page's facts, so a page changed meanwhile conflicts instead of
 * being overwritten.
 */

import { factIdentity, presentFact } from "@shinan/api-client"
import type {
  CatalogEditableAnswer,
  CatalogFact,
  CatalogOperation,
  CatalogTypeSchemaKey,
  CheckInput,
  DocumentField,
  FactInput,
  FactState,
  KeyOptions,
  StartHereStepInput,
} from "@shinan/api-client"

export type Editable = CatalogEditableAnswer["document"]

/** Today as a date, the way a fact check's `checked` is usually written. */
export function today(now = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

export function emptyCheck(): CheckInput {
  return { checked: today(), scope: "", source: "" }
}

/** What is missing from a fact check before it can be saved, in words; empty when complete. */
export function checkProblems(check: CheckInput): string[] {
  const problems: string[] = []
  if (!/^\d{4}-\d{2}-\d{2}/.test(check.checked))
    problems.push("Say when it was checked.")
  if (check.scope.trim() === "") problems.push("Say what was checked.")
  if (check.source.trim() === "") problems.push("Say how it was checked.")
  return problems
}

/** A fact check without blank optional parts. */
export function cleanCheck(check: CheckInput): CheckInput {
  return {
    checked: check.checked.trim(),
    scope: check.scope.trim(),
    source: check.source.trim(),
    ...(check.limits?.trim() ? { limits: check.limits.trim() } : {}),
  }
}

/** `set-field` for each field whose value changed. */
export function fieldOperations(
  document: string,
  editable: Editable,
  values: Partial<Record<DocumentField, string | string[] | null>>,
): CatalogOperation[] {
  const operations: CatalogOperation[] = []
  for (const [name, value] of Object.entries(values) as [
    DocumentField,
    string | string[] | null,
  ][]) {
    if (!(name in editable.fields)) continue
    const was = editable.fields[name] ?? null
    if (sameValue(was, value)) continue
    operations.push({
      op: "set-field",
      document,
      field: name,
      value,
      expect: { value: was },
    })
  }
  return operations
}

function sameValue(
  a: string | readonly string[] | null,
  b: string | readonly string[] | null,
): boolean {
  if (a === null || b === null) return a === b
  if (typeof a === "string" || typeof b === "string") return a === b
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/** The whole body, when it changed. */
export function bodyOperation(
  document: string,
  editable: Editable,
  text: string,
): CatalogOperation[] {
  if (text === editable.body.text) return []
  return [
    {
      op: "edit-body",
      document,
      text,
      expect: { text: editable.body.text },
    },
  ]
}

/** A fact as the editor holds it while it is being written. */
export interface FactDraft {
  key: string
  state: FactState
  /** The value, or a relation's target. */
  value: string
  note: string
  task: string
}

export function emptyFact(): FactDraft {
  return { key: "", state: "observed", value: "", note: "", task: "" }
}

export function draftOf(fact: CatalogFact): FactDraft {
  return {
    key: fact.key,
    state: fact.state,
    value:
      fact.to ??
      (fact.value === undefined || fact.value === null
        ? ""
        : String(fact.value)),
    note: fact.note ?? "",
    task: fact.task ?? "",
  }
}

/** Whether a fact in this state needs a fact check (catalog §4.5). */
export function needsCheck(state: FactState): boolean {
  return state === "intended" || state === "observed"
}

/** What is missing from a fact before it can be saved, in words. */
export function factProblems(draft: FactDraft): string[] {
  const problems: string[] = []
  if (!/^[a-z][a-z0-9_]*(?:[.-][a-z0-9_]+)*$/.test(draft.key))
    problems.push(
      `"${draft.key}" is not a key: lowercase words joined by ".", "-" or "_".`,
    )
  if (draft.state === "unknown") {
    if (draft.note.trim() === "") problems.push("Say why it is unknown.")
  } else if (draft.value.trim() === "") problems.push("Give the value.")
  if (draft.state === "planned" && draft.task.trim() === "")
    problems.push(
      "Name the task or accepted decision behind the plan, such as SHN-12.",
    )
  return problems
}

/** The fact an operation writes, from a draft and what the fact had before. */
export function factInput(
  draft: FactDraft,
  key: CatalogTypeSchemaKey | null,
  before?: CatalogFact,
): FactInput {
  const fact: FactInput = { key: draft.key.trim(), state: draft.state }
  const value = draft.value.trim()
  if (draft.state !== "unknown" && value !== "") {
    if (key?.relation) fact.to = value
    else fact.value = value
  }
  if (draft.note.trim() !== "") fact.note = draft.note.trim()
  if (draft.state === "planned" && draft.task.trim() !== "")
    fact.task = draft.task.trim()
  // What the editor does not show stays as it was.
  if (before?.via !== undefined) fact.via = before.via
  const attributes = Object.entries(before?.attributes ?? {}).filter(
    (e): e is [string, string | number | boolean] => e[1] !== null,
  )
  if (attributes.length > 0) fact.attributes = Object.fromEntries(attributes)
  if (before?.remove && draft.state === "planned") fact.remove = true
  return fact
}

/**
 * A changed fact: `set-fact` in its place when it keeps its identity,
 * otherwise the old one removed and the new one added (catalog §4.2).
 */
export function changeFactOperations(
  document: string,
  before: CatalogFact,
  draft: FactDraft,
  key: CatalogTypeSchemaKey | null,
  check: CheckInput | null,
): CatalogOperation[] {
  const fact = factInput(draft, key, before)
  const identity = factIdentity(fact, key)
  const withCheck = needsCheck(fact.state) && check ? { check } : {}
  if (identity === before.identity)
    return [
      {
        op: "set-fact",
        document,
        fact,
        ...withCheck,
        expect: presentFact(before),
      },
    ]
  // A plan carried out or an unknown found out settles the fact it replaces
  // (catalog §4.4).
  if (
    (before.state === "planned" || before.state === "unknown") &&
    needsCheck(fact.state)
  )
    return [
      {
        op: "set-fact",
        document,
        fact,
        ...withCheck,
        expect: { identity, absent: true },
        supersedes: presentFact(before),
      },
    ]
  return [
    { op: "remove-fact", document, expect: presentFact(before) },
    {
      op: "set-fact",
      document,
      fact,
      ...withCheck,
      expect: { identity, absent: true },
    },
  ]
}

export function addFactOperation(
  document: string,
  draft: FactDraft,
  key: CatalogTypeSchemaKey | null,
  check: CheckInput | null,
): CatalogOperation {
  const fact = factInput(draft, key)
  return {
    op: "set-fact",
    document,
    fact,
    ...(needsCheck(fact.state) && check ? { check } : {}),
    expect: { identity: factIdentity(fact, key), absent: true },
  }
}

export function removeFactOperation(
  document: string,
  fact: CatalogFact,
): CatalogOperation {
  return { op: "remove-fact", document, expect: presentFact(fact) }
}

/** A new fact check for facts whose values did not change (catalog §4.5). */
export function recheckOperation(
  document: string,
  facts: readonly CatalogFact[],
  check: CheckInput,
): CatalogOperation {
  return {
    op: "recheck-facts",
    document,
    facts: facts.map(presentFact),
    check: cleanCheck(check),
  }
}

/** A list written as text, one item per comma or line. */
export function listOf(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s !== "")
}

/** A type schema key as the editor holds it. */
export interface KeyDraft {
  key: string
  many: boolean
  /** Target types, comma-separated; empty for a key that is not a relation. */
  relation: string
  inverse: string
  /** Days, empty for no interval. */
  recheck: string
}

export function emptyKey(): KeyDraft {
  return { key: "", many: false, relation: "", inverse: "", recheck: "" }
}

export function keyDraftOf(key: string, options: KeyOptions): KeyDraft {
  return {
    key,
    // A relation is many-valued unless written otherwise (catalog §3.9).
    many: options.many ?? options.relation !== undefined,
    relation: (options.relation ?? []).join(", "),
    inverse: options.inverse ?? "",
    recheck: options.recheck?.replace(/d$/, "") ?? "",
  }
}

export function keyOptions(draft: KeyDraft, was?: KeyOptions): KeyOptions {
  const options: KeyOptions = {}
  const relation = listOf(draft.relation)
  // A relation is many-valued unless written otherwise (catalog §3.9).
  if (relation.length > 0) {
    options.relation = relation
    if (!draft.many) options.many = false
    if (draft.inverse.trim()) options.inverse = draft.inverse.trim()
    if (was?.identifiedBy) options.identifiedBy = was.identifiedBy
  } else if (draft.many) options.many = true
  else if (was?.many === false) options.many = false
  if (draft.recheck.trim()) options.recheck = `${draft.recheck.trim()}d`
  return options
}

export function sameOptions(a: KeyOptions, b: KeyOptions): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b))
}

function sortKeys(options: KeyOptions): [string, unknown][] {
  return Object.entries(options).sort(([x], [y]) => (x < y ? -1 : 1))
}

/** A start-here step as the editor holds it. */
export interface StepDraft {
  kind: "to" | "list" | "url"
  target: string
  note: string
}

export function stepDraftOf(step: StartHereStepInput): StepDraft {
  if ("to" in step) return { kind: "to", target: step.to, note: step.note }
  if ("list" in step)
    return { kind: "list", target: step.list, note: step.note }
  return { kind: "url", target: step.url, note: step.note }
}

export function stepInput(draft: StepDraft): StartHereStepInput {
  const note = draft.note.trim()
  const target = draft.target.trim()
  if (draft.kind === "to") return { to: target, note }
  if (draft.kind === "list")
    return {
      list: target as Extract<StartHereStepInput, { list: unknown }>["list"],
      note,
    }
  return { url: target, note }
}

export function sameSteps(
  a: readonly StartHereStepInput[],
  b: readonly StartHereStepInput[],
): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** A fact in a few words, to tell apart facts of one key in labels. */
export function factShortText(fact: CatalogFact): string {
  const text =
    fact.state === "unknown"
      ? (fact.note ?? "unknown")
      : (fact.to ??
        (fact.value === undefined || fact.value === null
          ? ""
          : String(fact.value)))
  const via = fact.via ? ` via ${fact.via}` : ""
  return `${text.length > 60 ? `${text.slice(0, 59)}…` : text}${via}`
}
