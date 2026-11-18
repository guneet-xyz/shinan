import { comparableValue, discrepancies } from "./analysis.js"
import { readCatalog } from "./catalog.js"
import type { Catalog } from "./catalog.js"
import { parseCatalogTime } from "./dates.js"
import { factsWithIdentity, resolveEntity } from "./entity.js"
import type { Fact, ResolvedEntity } from "./entity.js"
import {
  checkMatches,
  factOut,
  factText,
  insertFactEdit,
  keyOptionsOut,
  removeFactEdit,
  removeFieldEdit,
  replaceFactEdit,
  setFieldEdit,
  stepOut,
  stripAcceptedEdit,
  writtenValueText,
} from "./fact-edits.js"
import type { CheckFields } from "./fact-edits.js"
import { factIdentityKey, parseFactIdentityKey } from "./identity.js"
import {
  factKeyPattern,
  isAttributeName,
  isEntityId,
  parseEntityId,
  schemaId,
  startHereId,
  typeNamePattern,
} from "./ids.js"
import { decisionStates, entityStatuses, factStates } from "./model.js"
import type { CatalogDocument, EntityDocument, FactCheck } from "./model.js"
import type {
  CatalogOperation,
  ChangeId,
  CheckInput,
  CreateEntity,
  CreateSchema,
  CreateStartHere,
  DocumentField,
  EditBody,
  ExpectedCheck,
  FactExpectation,
  FactInput,
  KeyOptions,
  PresentFact,
  RecheckFacts,
  RemoveFact,
  Retire,
  SetFact,
  SetField,
  SetSchemaKey,
  SetStartHerePath,
  StartHereStepInput,
} from "./operations.js"
import { maxDocumentBytes, parseCatalogDocument } from "./parse.js"
import type { Problem } from "./problems.js"
import { buildTypeRegistry, factOptions, keySchema } from "./schemas.js"
import type { TypeRegistry } from "./schemas.js"
import { utf8Length } from "./source.js"
import {
  appendListItem,
  applyEdit,
  insertMapEntry,
  lineBreak,
  removeMapEntry,
  replaceEntryValue,
  replaceListItem,
  replaceRange,
  UnsupportedLayoutError,
} from "./text-edit.js"
import type { Edit } from "./text-edit.js"
import { blockLines, blockList, blockMap, flowList, scalar } from "./write.js"
import type { Out } from "./write.js"

/** Who the operations are applied for. */
export interface ApplyContext {
  /**
   * The actor's written form (identity §8.7), such as
   * `guneet via opencode-daedalus`: written as `by` of every new fact check.
   * Callers never send it; it comes from the request's actor.
   */
  by: string
}

/**
 * Why an operation did not apply:
 *
 * - `conflict`: an expectation no longer holds on the latest revision
 *   (catalog §8.5); the author can refresh the proposal;
 * - `invalid`: the operation cannot be applied as written.
 */
export interface OperationProblem {
  /** The operation's position in the proposal. */
  operation: number
  kind: "conflict" | "invalid"
  code: OperationProblemCode
  message: string
  documentId: string | null
}

export type OperationProblemCode =
  /** A document with the ID (or alias) to create already exists. */
  | "document-exists"
  /** The document the operation changes does not exist. */
  | "document-missing"
  /** A fact expected to be absent exists. */
  | "fact-exists"
  /** A fact expected to exist does not. */
  | "fact-missing"
  /** A fact's value or fact check is not what the operation expects. */
  | "fact-changed"
  /** The fact as written has another identity than the operation names, for example after a type schema change. */
  | "identity-changed"
  /** A field, body section, schema key or start-here path is not what the operation expects. */
  | "changed"
  /** The operation does not fit its document or its own rules. */
  | "operation-invalid"
  /** The document's frontmatter cannot be read, so it cannot be edited. */
  | "document-unreadable"
  /** The result would be longer than a catalog document may be (64 KiB of UTF-8). */
  | "too-large"
  /** The result would not read as the operation intends; the messages say why. */
  | "result-invalid"
  /** The document's YAML is laid out in a way the edits do not handle. */
  | "unsupported-layout"

/** One document the operations wrote. */
export interface DocumentChange {
  /** As it was in the latest revision; null for a new document. */
  before: CatalogDocument | null
  after: CatalogDocument
}

export type ApplyResult =
  | {
      applied: true
      before: Catalog
      /** The whole catalog after the operations, for validation (`validateChange`). */
      after: Catalog
      /** The documents whose text changed or that are new, in the order of `after.documents`. */
      changes: DocumentChange[]
    }
  | {
      applied: false
      before: Catalog
      /** Every operation that did not apply, in proposal order. */
      problems: OperationProblem[]
    }

/**
 * Applies a catalog proposal's operations to the latest revision, as text
 * edits (catalog §8.1; architecture §5.2, rule 2): each operation changes
 * only the bytes it targets, new content is written in one canonical style
 * (`write.ts`), and every other byte stays as it was.
 *
 * All or nothing: if any operation conflicts or is invalid, nothing applies
 * and every problem is listed. Operations apply in proposal order, except
 * that those on type schema documents go first and those on the start-here
 * document last, so one proposal can create a type and entities of it. Each
 * operation's expectations are checked against the documents as the earlier
 * operations left them.
 *
 * This function only makes the text. The result is then validated as a
 * whole (catalog §8.3), on the Markdown and not on the operations:
 * `validateChange({ before, after, changed: changes.map((c) => c.after) },
 * context)`.
 */
export function applyOperations(
  documents: Iterable<CatalogDocument | string>,
  operations: readonly CatalogOperation[],
  context: ApplyContext,
): ApplyResult {
  const before = readCatalog(documents)
  const working = new Working(before, context)
  const problems: OperationProblem[] = []
  const order = operations
    .map((operation, index) => ({ operation, index }))
    .sort(
      (a, b) => phase(a.operation) - phase(b.operation) || a.index - b.index,
    )
  for (const { operation, index } of order) {
    try {
      working.apply(operation)
    } catch (error) {
      const documentId = targetOf(operation)
      if (error instanceof OperationFailure)
        problems.push({
          operation: index,
          kind: error.kind,
          code: error.code,
          message: error.message,
          documentId,
        })
      else if (error instanceof UnsupportedLayoutError)
        problems.push({
          operation: index,
          kind: "invalid",
          code: "unsupported-layout",
          message: `The document's YAML is laid out in a way Shinan cannot edit (${error.message}); rewrite the document in the usual block style`,
          documentId,
        })
      else throw error
    }
  }
  if (problems.length > 0) {
    problems.sort((a, b) => a.operation - b.operation)
    return { applied: false, before, problems }
  }
  const after = readCatalog(working.entries.map((e) => e.document))
  const changes = working.entries
    .filter((e) => e.before === null || e.before.text !== e.document.text)
    .map((e) => ({ before: e.before, after: e.document }))
  return { applied: true, before, after, changes }
}

/** A fact's value as text, as `FactExpectation.value` names it. */
export function factValueText(fact: Fact): string {
  return writtenValueText(fact)
}

/** What an operation expects of a fact, read from the fact as it is now. */
export function expectationOf(fact: Fact): PresentFact {
  const check = fact.check
  return {
    identity: fact.identity,
    value: factValueText(fact),
    check: check === null ? null : expectedCheckOf(check),
  }
}

function expectedCheckOf(check: FactCheck): ExpectedCheck {
  const expected: ExpectedCheck = {
    checked: check.checked === null ? null : (check.checked?.text ?? null),
  }
  if (check.by !== undefined) expected.by = check.by
  if (check.scope !== undefined) expected.scope = check.scope
  if (check.source !== undefined) expected.source = check.source
  expected.limits = check.limits ?? null
  return expected
}

function phase(operation: CatalogOperation): number {
  const target = targetOf(operation)
  if (target?.startsWith("schema/")) return 0
  if (target === startHereId) return 2
  return 1
}

function targetOf(operation: CatalogOperation): string | null {
  switch (operation.op) {
    case "create-entity":
      return operation.id
    case "create-schema":
      return typeNamePattern.test(operation.type)
        ? schemaId(operation.type)
        : null
    case "create-start-here":
    case "set-start-here-path":
      return startHereId
    default:
      return typeof operation.document === "string" ? operation.document : null
  }
}

class OperationFailure extends Error {
  constructor(
    readonly kind: "conflict" | "invalid",
    readonly code: OperationProblemCode,
    message: string,
  ) {
    super(message)
  }
}

const conflict = (code: OperationProblemCode, message: string) =>
  new OperationFailure("conflict", code, message)
const invalid = (
  message: string,
  code: OperationProblemCode = "operation-invalid",
) => new OperationFailure("invalid", code, message)

interface Entry {
  before: CatalogDocument | null
  document: CatalogDocument
}

/** The documents as the operations applied so far left them. */
class Working {
  readonly entries: Entry[]
  registry: TypeRegistry

  constructor(
    catalog: Catalog,
    private readonly context: ApplyContext,
  ) {
    this.entries = catalog.documents.map((d) => ({ before: d, document: d }))
    this.registry = catalog.registry
  }

  apply(operation: CatalogOperation) {
    switch (operation.op) {
      case "create-entity":
        return this.createEntity(operation)
      case "set-fact":
        return this.edit(operation.document, "entity", (d) =>
          setFact(d, operation, this.context.by),
        )
      case "remove-fact":
        return this.edit(operation.document, "entity", (d) =>
          removeFact(d, operation),
        )
      case "recheck-facts":
        return this.edit(operation.document, "entity", (d) =>
          recheckFacts(d, operation, this.context.by),
        )
      case "edit-body":
        return this.edit(operation.document, null, (d) =>
          editBody(d, operation),
        )
      case "set-field":
        return this.edit(operation.document, null, (d) =>
          setField(d, operation),
        )
      case "retire":
        return this.edit(operation.document, null, (d) => retire(d, operation))
      case "change-id":
        return this.changeId(operation)
      case "create-schema":
        return this.create(schemaId(checkType(operation.type)), () =>
          schemaText(operation),
        )
      case "set-schema-key":
        return this.edit(operation.document, "schema", (d) =>
          setSchemaKey(d, operation),
        )
      case "create-start-here":
        return this.create(startHereId, () => startHereText(operation))
      case "set-start-here-path":
        return this.edit(startHereId, "start-here", (d) =>
          setStartHerePath(d, operation),
        )
      default:
        throw invalid(
          `"${String((operation as { op?: unknown }).op)}" is not a catalog operation`,
        )
    }
  }

  private find(id: string): Entry {
    const entry = this.entries.find((e) => e.document.id === id)
    if (entry) return entry
    const moved = this.entries.find(
      (e) => e.document.kind === "entity" && e.document.aliases.includes(id),
    )
    throw conflict(
      "document-missing",
      moved
        ? `"${id}" is now "${moved.document.id}"; the proposal names its old ID`
        : `There is no document "${id}"`,
    )
  }

  /** Whether any document has this ID or alias. */
  private taken(name: string): boolean {
    return this.entries.some(
      (e) =>
        e.document.id === name ||
        (e.document.kind === "entity" && e.document.aliases.includes(name)),
    )
  }

  private edit(
    id: string,
    kind: CatalogDocument["kind"] | null,
    change: (editor: Editor) => void,
  ) {
    const entry = this.find(id)
    if (kind && entry.document.kind !== kind)
      throw invalid(`"${id}" is not ${kindName[kind]}`)
    const editor = new Editor(entry.document, this.registry)
    change(editor)
    this.commit(entry, editor.finish(entry.document))
  }

  private create(id: string, text: () => string) {
    if (this.taken(id))
      throw conflict("document-exists", `A document "${id}" already exists`)
    const editor = Editor.create(text(), this.registry)
    const entry: Entry = { before: null, document: editor.document }
    this.commit(entry, editor.finish(null), true)
  }

  private createEntity(operation: CreateEntity) {
    const parsed = parseEntityId(operation.id)
    if (!parsed || parsed.type === "schema")
      throw invalid(
        `"${operation.id}" is not an entity ID: <type>/<slug>, in lowercase kebab-case`,
      )
    if (this.taken(operation.id))
      throw conflict(
        "document-exists",
        `A document "${operation.id}" already exists`,
      )
    const editor = Editor.create(
      entityText(operation, parsed.type),
      this.registry,
    )
    for (const { fact, check } of operation.facts ?? []) {
      const key = keySchema(editor.typeSchema(), fact.key)
      setFact(
        editor,
        {
          op: "set-fact",
          document: operation.id,
          fact,
          ...(check ? { check } : {}),
          expect: { identity: identityOf(fact, key), absent: true },
        },
        this.context.by,
      )
    }
    const entry: Entry = { before: null, document: editor.document }
    this.commit(entry, editor.finish(null), true)
  }

  private changeId(operation: ChangeId) {
    const entry = this.find(operation.document)
    const document = entry.document
    if (document.kind !== "entity")
      throw invalid(
        `"${operation.document}" is not an entity; only entities change ID`,
      )
    const parsed = parseEntityId(operation.id)
    if (!parsed || parsed.type !== document.type)
      throw invalid(
        `"${operation.id}" is not an ID of the ${document.type ?? "same"} type; the type is part of the ID and does not change`,
      )
    if (operation.id === document.id)
      throw invalid(`The entity's ID is already "${operation.id}"`)
    if (
      this.entries.some(
        (e) =>
          e !== entry &&
          (e.document.id === operation.id ||
            (e.document.kind === "entity" &&
              e.document.aliases.includes(operation.id))),
      )
    )
      throw conflict(
        "document-exists",
        `A document already has the ID or alias "${operation.id}"`,
      )
    const editor = new Editor(document, this.registry)
    changeId(editor, operation.id)
    this.commit(entry, editor.finish(document))
  }

  private commit(entry: Entry, document: CatalogDocument, created = false) {
    entry.document = document
    if (created) this.entries.push(entry)
    if (document.kind === "schema" || entry.before?.kind === "schema")
      this.registry = buildTypeRegistry(
        this.entries.flatMap((e) =>
          e.document.kind === "schema" ? [e.document] : [],
        ),
      )
  }
}

const kindName: Record<CatalogDocument["kind"], string> = {
  entity: "an entity",
  schema: "a type schema document",
  "start-here": "the start-here document",
}

/** One document being edited by one operation: its text after each step, read again. */
class Editor {
  document: CatalogDocument

  constructor(
    document: CatalogDocument,
    private readonly registry: TypeRegistry,
    created = false,
  ) {
    this.document = document
    if (created) return
    const unreadable = document.problems.find(
      (p) =>
        p.code === "frontmatter-invalid" ||
        p.code === "too-large" ||
        p.code === "read-failed",
    )
    if (unreadable || document.frontmatter === null)
      throw invalid(
        `"${document.id ?? "(no ID)"}" cannot be read, so it cannot be edited: ${unreadable?.message ?? "it has no frontmatter"}`,
        "document-unreadable",
      )
  }

  static create(text: string, registry: TypeRegistry): Editor {
    return new Editor(read(text), registry, true)
  }

  get text(): string {
    return this.document.text
  }

  get entity(): EntityDocument {
    if (this.document.kind !== "entity") throw invalid("Not an entity")
    return this.document
  }

  typeSchema() {
    const type = this.entity.type
    return type === null ? null : (this.registry.types.get(type) ?? null)
  }

  resolved(): ResolvedEntity {
    return resolveEntity(this.entity, this.registry)
  }

  apply(edit: Edit) {
    this.document = read(applyEdit(this.text, edit))
  }

  /**
   * The document after the operation, if it reads without any problem the
   * operation added: an edit that reads back differently is refused rather
   * than stored.
   */
  finish(before: CatalogDocument | null): CatalogDocument {
    const added = subtract(
      this.problems(this.document),
      before ? this.problems(before) : [],
    )
    if (added.length > 0)
      throw invalid(
        `The result would not read as intended: ${added.map((p) => p.message).join("; ")}`,
        "result-invalid",
      )
    return this.document
  }

  private problems(document: CatalogDocument): Problem[] {
    return [
      ...document.problems,
      ...(document.kind === "entity"
        ? resolveEntity(document, this.registry).problems
        : []),
    ]
  }
}

function read(text: string): CatalogDocument {
  const bytes = utf8Length(text)
  if (bytes > maxDocumentBytes)
    throw invalid(
      `The result would be ${bytes} bytes long; a catalog document holds at most ${maxDocumentBytes} bytes (64 KiB)`,
      "too-large",
    )
  return parseCatalogDocument(text)
}

function subtract(found: Problem[], earlier: Problem[]): Problem[] {
  const counts = new Map<string, number>()
  const key = (p: Problem) => `${p.code}\u0000${p.message}`
  for (const p of earlier) counts.set(key(p), (counts.get(key(p)) ?? 0) + 1)
  return found.filter((p) => {
    const n = counts.get(key(p)) ?? 0
    if (n === 0) return true
    counts.set(key(p), n - 1)
    return false
  })
}

// Facts.

function identityOf(fact: FactInput, key: ReturnType<typeof keySchema>) {
  return factIdentityKey({
    key: fact.key,
    state: fact.state,
    many: key.many,
    relation: key.relation,
    value: fact.value,
    to: fact.to,
    via: fact.via,
    attributes: fact.attributes ?? {},
  })
}

function checkFact(fact: FactInput, key: ReturnType<typeof keySchema>) {
  if (!factKeyPattern.test(fact.key))
    throw invalid(
      `"${fact.key}" is not a fact key: lowercase words joined by ".", "-" or "_"`,
    )
  if (!factStates.includes(fact.state))
    throw invalid(`"${String(fact.state)}" is not a fact state`)
  const text = (name: string, value: unknown) => {
    if (
      value !== undefined &&
      (typeof value !== "string" || value.trim() === "")
    )
      throw invalid(`The fact's \`${name}\` is text`)
  }
  text("to", fact.to)
  text("via", fact.via)
  text("note", fact.note)
  text("task", fact.task)
  text("accepted", fact.accepted)
  const value = fact.value
  if (
    value !== undefined &&
    !(
      (typeof value === "string" && value !== "") ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    )
  )
    throw invalid(
      `The value of "${fact.key}" is text, a finite number, or true or false`,
    )
  for (const [name, v] of Object.entries(fact.attributes ?? {})) {
    if (!isAttributeName(name) || factOptions.has(name))
      throw invalid(`"${name}" cannot name a relation attribute`)
    if (!(
      (typeof v === "string" && v !== "") ||
      typeof v === "boolean" ||
      (typeof v === "number" && Number.isFinite(v))
    ))
      throw invalid(`The attribute "${name}" holds one value`)
  }
  if (fact.remove !== undefined && typeof fact.remove !== "boolean")
    throw invalid("`remove` is true or false")
  if (fact.remove && fact.state !== "planned")
    throw invalid("Only a planned fact can plan a removal (`remove: true`)")
  if (key.relation) {
    if (fact.value !== undefined)
      throw invalid(`"${fact.key}" is a relation; name its target with \`to\``)
    if (fact.to === undefined && fact.state !== "unknown")
      throw invalid(`The relation "${fact.key}" needs its target, \`to\``)
  } else {
    if (fact.to !== undefined)
      throw invalid(
        `"${fact.key}" is not a relation, so it has a \`value\`, not \`to\``,
      )
    if (Object.keys(fact.attributes ?? {}).length > 0)
      throw invalid(`"${fact.key}" is not a relation, so it has no attributes`)
    if (fact.value === undefined && fact.state !== "unknown")
      throw invalid(
        `The fact "${fact.key}" needs a \`value\`; record it as unknown instead`,
      )
  }
  if (fact.state === "unknown") {
    if (fact.value !== undefined)
      throw invalid(
        `An unknown fact has no value; its \`note\` says why "${fact.key}" is unknown`,
      )
    if (fact.note === undefined)
      throw invalid(
        `The unknown fact "${fact.key}" needs a \`note\` saying why it is unknown`,
      )
  }
}

function checkFields(
  state: FactInput["state"],
  check: CheckInput | undefined,
  by: string,
): CheckFields | null {
  if (state === "planned") {
    if (check) throw invalid("`planned` facts have no fact check")
    return null
  }
  if (!check) {
    if (state === "unknown") return null
    throw invalid(
      `An \`${state}\` fact needs its fact check: when, what and where from`,
    )
  }
  if (typeof check.checked !== "string" || !parseCatalogTime(check.checked))
    throw invalid(
      "`checked` is a date (2026-11-14) or a date and time with a UTC offset (2026-11-14T09:30Z)",
    )
  for (const name of ["scope", "source", "limits"] as const) {
    const value = check[name]
    if (
      (value !== undefined || name !== "limits") &&
      (typeof value !== "string" || value.trim() === "")
    )
      throw invalid(`The fact check's \`${name}\` is one line of text`)
  }
  return {
    checked: check.checked,
    by,
    scope: check.scope,
    source: check.source,
    ...(check.limits !== undefined ? { limits: check.limits } : {}),
  }
}

/** Checks an expectation; returns the current facts with its identity. */
function expectFact(resolved: ResolvedEntity, expect: FactExpectation): Fact[] {
  if (parseFactIdentityKey(expect.identity) === null)
    throw invalid(`"${expect.identity}" is not a fact identity key`)
  const found = factsWithIdentity(resolved, expect.identity)
  if ("absent" in expect) {
    if (found.length > 0)
      throw conflict(
        "fact-exists",
        `The fact ${expect.identity} exists, but the operation expects it not to`,
      )
    return []
  }
  const fact = found[0]
  if (!fact)
    throw conflict(
      "fact-missing",
      `The fact ${expect.identity} is not there any more`,
    )
  if (factValueText(fact) !== expect.value)
    throw conflict(
      "fact-changed",
      `The value of ${expect.identity} has changed since the operation was written`,
    )
  if (!checkExpected(fact.check, expect.check))
    throw conflict(
      "fact-changed",
      `The fact check of ${expect.identity} has changed since the operation was written`,
    )
  return found
}

function checkExpected(
  check: FactCheck | null,
  expected: ExpectedCheck | null,
): boolean {
  if (expected === null || check === null) return expected === check
  const checked =
    check.checked === null ? null : (check.checked?.text ?? undefined)
  if (checked !== expected.checked) return false
  if (expected.by !== undefined && expected.by !== check.by) return false
  if (expected.scope !== undefined && expected.scope !== check.scope)
    return false
  if (expected.source !== undefined && expected.source !== check.source)
    return false
  if (
    expected.limits !== undefined &&
    (expected.limits ?? undefined) !== check.limits
  )
    return false
  return true
}

/** Removes every current fact with this identity, one edit at a time. */
function removeIdentity(editor: Editor, identity: string) {
  for (;;) {
    const fact = factsWithIdentity(editor.resolved(), identity)[0]
    if (!fact) return
    editor.apply(removeFactEdit(editor.entity, fact))
  }
}

/** The facts of a single-valued key's discrepancy, with their values, as one string. */
function discrepancyOf(resolved: ResolvedEntity, key: string): string {
  const found = discrepancies(resolved).find((d) => d.key === key)
  if (!found) return ""
  return found.facts
    .map((f) => `${f.identity}\u0000${comparableValue(f)}`)
    .sort()
    .join("\n")
}

/**
 * When a single-valued key's discrepancy changed (a value changed, or a fact
 * joined or left it), removes `accepted` from every fact of the key, except
 * one the operation accepts explicitly (catalog §4.7).
 */
function unaccept(
  editor: Editor,
  key: string,
  before: string,
  keep: string | null,
) {
  if (discrepancyOf(editor.resolved(), key) === before) return
  for (;;) {
    const fact = editor
      .resolved()
      .facts.find(
        (f) =>
          f.key === key &&
          !f.schema.many &&
          (f.state === "intended" || f.state === "observed") &&
          f.accepted !== undefined &&
          f.identity !== keep,
      )
    if (!fact) return
    editor.apply(stripAcceptedEdit(editor.entity, fact))
  }
}

function setFact(editor: Editor, operation: SetFact, by: string) {
  const key = keySchema(editor.typeSchema(), operation.fact.key)
  checkFact(operation.fact, key)
  const target = checkFields(operation.fact.state, operation.check, by)
  const identity = identityOf(operation.fact, key)
  if (operation.expect.identity !== identity)
    throw conflict(
      "identity-changed",
      `The fact as written has the identity ${identity}, not ${operation.expect.identity}`,
    )
  const start = editor.resolved()
  const current = expectFact(start, operation.expect)
  let fact = operation.fact
  if (operation.supersedes) {
    const superseded = parseFactIdentityKey(operation.supersedes.identity)
    if (
      superseded?.key !== fact.key ||
      operation.supersedes.identity === identity
    )
      throw invalid(
        "A change of state supersedes a fact of the same key with another identity",
      )
    if (!("value" in operation.supersedes))
      throw invalid(
        "`supersedes` names a current fact, with its value and check",
      )
    expectFact(start, operation.supersedes)
  }

  // A recheck of a value that did not change keeps the acceptance of its
  // discrepancy, with the note that says why (catalog §4.7).
  const old = current[0]
  if (
    old?.accepted !== undefined &&
    fact.accepted === undefined &&
    writtenValueText(old) === writtenValueText(fact)
  )
    fact = {
      ...fact,
      accepted: old.accepted,
      ...(fact.note === undefined && old.note !== undefined
        ? { note: old.note }
        : {}),
    }

  const before = discrepancyOf(start, fact.key)
  if (operation.supersedes)
    removeIdentity(editor, operation.supersedes.identity)

  // A known value settles the `unknown` fact of a single-valued key, or a
  // relation's that names the same target (catalog §4.2).
  if (fact.state === "intended" || fact.state === "observed") {
    for (;;) {
      const settled = editor
        .resolved()
        .facts.find(
          (f) =>
            f.key === fact.key &&
            f.state === "unknown" &&
            (!key.many ||
              (key.relation !== null &&
                fact.to !== undefined &&
                f.to === fact.to)),
        )
      if (!settled) break
      editor.apply(removeFactEdit(editor.entity, settled))
    }
  }

  const value = factOut(fact, key)
  const existing = factsWithIdentity(editor.resolved(), identity)
  const first = existing[0]
  if (first && checkMatches(first.check, target)) {
    editor.apply(replaceFactEdit(editor.entity, first, value))
    // A document that repeats the fact keeps only the first.
    for (;;) {
      const repeated = factsWithIdentity(editor.resolved(), identity)[1]
      if (!repeated) break
      editor.apply(removeFactEdit(editor.entity, repeated))
    }
  } else {
    removeIdentity(editor, identity)
    editor.apply(
      insertFactEdit(
        editor.entity,
        target,
        fact.state,
        fact.key,
        key.many,
        value,
      ),
    )
  }
  unaccept(
    editor,
    fact.key,
    before,
    operation.fact.accepted !== undefined ? identity : null,
  )
  verifyFact(editor, identity, fact, target)
}

/** Checks that the written fact reads back as given: a guard against a bad edit. */
function verifyFact(
  editor: Editor,
  identity: string,
  fact: FactInput,
  check: CheckFields | null,
) {
  const found = factsWithIdentity(editor.resolved(), identity)
  const written = found[0]
  const same = (
    a: string | number | boolean | null | undefined,
    b: string | number | boolean | null | undefined,
  ) => a === b
  const attributes = fact.attributes ?? {}
  if (
    found.length !== 1 ||
    !written ||
    !checkMatches(written.check, check) ||
    !same(written.value, fact.value) ||
    !same(written.to, fact.to) ||
    !same(written.via, fact.via) ||
    !same(written.note, fact.note) ||
    !same(written.task, fact.task) ||
    written.remove !== (fact.remove ?? false) ||
    !same(written.accepted, fact.accepted) ||
    Object.keys(written.attributes).length !== Object.keys(attributes).length ||
    Object.entries(attributes).some(
      ([k, v]) =>
        !Object.hasOwn(written.attributes, k) || written.attributes[k] !== v,
    )
  )
    throw invalid(
      `The fact ${identity} would not read back as written`,
      "result-invalid",
    )
}

function removeFact(editor: Editor, operation: RemoveFact) {
  if (!("value" in operation.expect))
    throw invalid(
      "`remove-fact` names a current fact, with its value and check",
    )
  const start = editor.resolved()
  const found = expectFact(start, operation.expect)
  const key = found[0]?.key ?? ""
  const before = discrepancyOf(start, key)
  removeIdentity(editor, operation.expect.identity)
  unaccept(editor, key, before, null)
}

function recheckFacts(editor: Editor, operation: RecheckFacts, by: string) {
  if (operation.facts.length === 0)
    throw invalid("A recheck names at least one fact")
  const start = editor.resolved()
  for (const expect of operation.facts) {
    if (!("value" in expect))
      throw invalid(
        "A recheck names current facts, with their values and checks",
      )
    const [fact] = expectFact(start, expect)
    if (fact?.state === "planned")
      throw invalid(
        `${expect.identity} is planned; planned facts have no fact check`,
      )
  }
  const target = checkFields("observed", operation.check, by)
  for (const expect of operation.facts) {
    const fact = factsWithIdentity(editor.resolved(), expect.identity)[0]
    if (!fact || checkMatches(fact.check, target)) continue
    const value = factText(editor.entity, fact)
    editor.apply(removeFactEdit(editor.entity, fact))
    editor.apply(
      insertFactEdit(
        editor.entity,
        target,
        fact.state,
        fact.key,
        fact.schema.many,
        value,
      ),
    )
    const moved = factsWithIdentity(editor.resolved(), expect.identity)
    if (
      moved.length !== 1 ||
      !checkMatches(moved[0]?.check ?? null, target) ||
      factValueText(moved[0] as Fact) !== expect.value
    )
      throw invalid(
        `The fact ${expect.identity} would not read back as written`,
        "result-invalid",
      )
  }
}

// Entities and fields.

function entityText(operation: CreateEntity, type: string): string {
  const text = (name: string, value: unknown) => {
    if (typeof value !== "string" || value.trim() === "")
      throw invalid(`\`${name}\` is text`)
    return value
  }
  const status = operation.status ?? "active"
  if (!entityStatuses.includes(status))
    throw invalid(`\`status\` is one of ${entityStatuses.join(", ")}`)
  const entries: [string, Out][] = [
    ["id", scalar(operation.id)],
    ["type", scalar(type)],
    ["title", scalar(text("title", operation.title))],
    ["summary", scalar(text("summary", operation.summary))],
    ["status", scalar(status)],
    ["owner", scalar(reference("owner", operation.owner, true))],
  ]
  if (type === "decision") {
    const decision = operation.decision
    if (!decision) throw invalid("A decision entity needs its decision state")
    entries.push([
      "decision_state",
      scalar(choice("decision_state", decision.state, decisionStates)),
    ])
    if (decision.decidedOn !== undefined)
      entries.push([
        "decided_on",
        scalar(time("decided_on", decision.decidedOn)),
      ])
    if (decision.decidedBy !== undefined)
      entries.push([
        "decided_by",
        scalar(reference("decided_by", decision.decidedBy, true)),
      ])
  } else if (operation.decision) {
    throw invalid("Only decision entities have a decision state")
  }
  return documentText(entries, operation.body)
}

function documentText(entries: [string, Out][], body: string | undefined) {
  const lines = ["---", ...blockLines(blockMap(entries), 0), "---"]
  let text = lines.join("\n") + "\n"
  if (body !== undefined && body !== "")
    text += "\n" + withBreak(lineBreaks(body, "\n"), "\n")
  return text
}

function reference(name: string, value: unknown, unknownAllowed: boolean) {
  if (
    typeof value === "string" &&
    ((unknownAllowed && value === "unknown") || isEntityId(value))
  )
    return value
  throw invalid(
    `\`${name}\` is an entity ID such as person/guneet${unknownAllowed ? ", or unknown" : ""}`,
  )
}

function choice<T extends string>(
  name: string,
  value: unknown,
  choices: readonly T[],
): T {
  const found = choices.find((c) => c === value)
  if (found === undefined)
    throw invalid(`\`${name}\` is one of ${choices.join(", ")}`)
  return found
}

function time(name: string, value: unknown): string {
  if (typeof value === "string" && parseCatalogTime(value)) return value
  throw invalid(
    `\`${name}\` is a date (2026-11-14) or a date and time with a UTC offset (2026-11-14T09:30Z)`,
  )
}

/** The fields each kind of document lets `set-field` change, and whether each is required. */
const settable: Record<
  CatalogDocument["kind"],
  Partial<Record<DocumentField, { required: boolean; list?: true }>>
> = {
  entity: {
    title: { required: true },
    summary: { required: true },
    status: { required: true },
    owner: { required: true },
    decision_state: { required: true },
    decided_on: { required: false },
    decided_by: { required: false },
  },
  schema: {
    title: { required: true },
    summary: { required: true },
    status: { required: true },
    owner: { required: true },
    required: { required: false, list: true },
    sections: { required: false, list: true },
  },
  "start-here": {
    title: { required: true },
    summary: { required: false },
    owner: { required: false },
  },
}

const decisionFields: ReadonlySet<string> = new Set([
  "decision_state",
  "decided_on",
  "decided_by",
])

function currentField(
  document: CatalogDocument,
  name: string,
): string | string[] | null | undefined {
  const entry = document.fields.get(name)
  if (!entry) return null
  const node = entry.value
  if (node.kind === "scalar")
    return node.value === null ? null : String(node.value)
  if (node.kind === "list") {
    const items = node.items.flatMap((i) =>
      i.kind === "scalar" && typeof i.value === "string" ? [i.value] : [],
    )
    return items.length === node.items.length ? items : undefined
  }
  return undefined
}

function sameValue(
  a: string | readonly string[] | null | undefined,
  b: string | readonly string[] | null,
): boolean {
  if (a === undefined) return false
  if (a === null || b === null) return a === b
  if (typeof a === "string" || typeof b === "string") return a === b
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function setField(editor: Editor, operation: SetField) {
  const document = editor.document
  const rule = settable[document.kind][operation.field]
  if (
    !rule ||
    (decisionFields.has(operation.field) &&
      document.kind === "entity" &&
      document.type !== "decision")
  )
    throw invalid(
      `\`${operation.field}\` is not a field this operation changes on ${kindName[document.kind]}`,
    )
  if (
    !sameValue(currentField(document, operation.field), operation.expect.value)
  )
    throw conflict(
      "changed",
      `\`${operation.field}\` has changed since the operation was written`,
    )
  const value = operation.value
  if (value === null) {
    if (rule.required) throw invalid(`\`${operation.field}\` is required`)
    if (document.fields.has(operation.field))
      editor.apply(removeFieldEdit(document, operation.field))
    return
  }
  if (rule.list) {
    if (
      !Array.isArray(value) ||
      value.some((v) => typeof v !== "string" || v === "")
    )
      throw invalid(`\`${operation.field}\` is a list of text`)
    editor.apply(
      setFieldEdit(document, operation.field, flowList(value.map(scalar))),
    )
    return
  }
  if (typeof value !== "string" || value.trim() === "")
    throw invalid(`\`${operation.field}\` is text`)
  switch (operation.field) {
    case "status":
      if (value === "retired")
        throw invalid("Retiring is its own operation, `retire`")
      choice("status", value, entityStatuses)
      break
    case "owner":
    case "decided_by":
      reference(operation.field, value, true)
      break
    case "decision_state":
      choice("decision_state", value, decisionStates)
      break
    case "decided_on":
      time("decided_on", value)
      break
  }
  editor.apply(setFieldEdit(document, operation.field, scalar(value)))
}

function retire(editor: Editor, operation: Retire) {
  const document = editor.document
  if (document.kind === "start-here")
    throw invalid("The start-here document cannot be retired")
  if (document.status !== operation.expect.status)
    throw conflict(
      "changed",
      "The status has changed since the operation was written",
    )
  if (document.status === "retired") throw invalid("It is already retired")
  editor.apply(setFieldEdit(document, "status", scalar("retired")))
  if (operation.replacedBy !== undefined) {
    if (editor.document.kind !== "entity")
      throw invalid("Only an entity names a replacement")
    if (operation.replacedBy === editor.document.id)
      throw invalid("An entity cannot replace itself")
    editor.apply(
      setFieldEdit(
        editor.document,
        "replaced_by",
        scalar(reference("replacedBy", operation.replacedBy, false)),
      ),
    )
  }
}

function changeId(editor: Editor, id: string) {
  const old = editor.entity.id as string
  editor.apply(setFieldEdit(editor.document, "id", scalar(id)))
  const document = editor.entity
  const entry = document.fields.get("aliases")
  const node = entry?.value
  const eol = lineBreak(document.text)
  if (node?.kind === "list") {
    const index = node.items.findIndex(
      (i) => i.kind === "scalar" && i.value === id,
    )
    const item = node.items[index]
    // Changing back to a former ID: that alias becomes the old ID.
    if (item) editor.apply(replaceListItem(item, scalar(old), node.flow))
    else editor.apply(appendListItem(document.text, node, scalar(old), eol))
  } else if (!entry || (node?.kind === "scalar" && node.value === null)) {
    editor.apply(setFieldEdit(document, "aliases", flowList([scalar(old)])))
  } else {
    throw invalid(
      "`aliases` is not a list, so the old ID cannot be added to it",
    )
  }
}

// Body.

function editBody(editor: Editor, operation: EditBody) {
  const document = editor.document
  const body = document.body
  const eol = lineBreak(document.text)
  if (typeof operation.text !== "string")
    throw invalid("`text` is Markdown text")
  // New text takes the document's line breaks.
  const given = lineBreaks(operation.text, eol)
  if (operation.section === undefined) {
    if (!("text" in operation.expect))
      throw invalid("The whole body is always there; expect its text")
    if (body.text !== operation.expect.text)
      throw conflict(
        "changed",
        "The body has changed since the operation was written",
      )
    editor.apply(replaceRange(body.range, given))
    return
  }
  const name = operation.section
  const section = body.sections.find((s) =>
    name === null ? s.heading === null : s.anchor === name,
  )
  const label =
    name === null
      ? "The text before the first heading"
      : `The section "${name}"`
  if ("absent" in operation.expect) {
    if (section)
      throw conflict(
        "changed",
        `${label} exists, but the operation expects it not to`,
      )
    if (given === "") return
    const text = withBreak(given, eol)
    if (name === null) {
      editor.apply(
        replaceRange({ start: body.range.start, end: body.range.start }, text),
      )
    } else {
      const gap =
        body.text === ""
          ? eol
          : /(\r?\n){2}$/.test(body.text)
            ? ""
            : body.text.endsWith("\n")
              ? eol
              : eol + eol
      editor.apply(
        replaceRange(
          { start: body.range.end, end: body.range.end },
          gap + text,
        ),
      )
      if (!editor.document.body.sections.some((s) => s.anchor === name))
        throw invalid(
          `The text does not start a section "${name}"; it starts with its heading`,
        )
    }
    return
  }
  if (!section) throw conflict("changed", `${label} is not there any more`)
  if (section.text !== operation.expect.text)
    throw conflict(
      "changed",
      `${label} has changed since the operation was written`,
    )
  const text =
    given !== "" && section.text.endsWith("\n") ? withBreak(given, eol) : given
  editor.apply(replaceRange(section.range, text))
}

function lineBreaks(text: string, eol: string): string {
  return text.replace(/\r\n|\n/g, eol)
}

function withBreak(text: string, eol: string): string {
  return text.endsWith("\n") ? text : text + eol
}

// Type schema documents.

function checkType(type: unknown): string {
  if (typeof type !== "string" || !typeNamePattern.test(type))
    throw invalid("A type name is lowercase kebab-case, such as dns-zone")
  return type
}

function keyOptions(options: KeyOptions): Out {
  if (typeof options !== "object" || options === null)
    throw invalid("A key's options are a map, such as { many: true }")
  return keyOptionsOut(options)
}

function schemaText(operation: CreateSchema): string {
  const text = (name: string, value: unknown) => {
    if (typeof value !== "string" || value.trim() === "")
      throw invalid(`\`${name}\` is text`)
    return value
  }
  const status = operation.status ?? "active"
  if (!entityStatuses.includes(status))
    throw invalid(`\`status\` is one of ${entityStatuses.join(", ")}`)
  const entries: [string, Out][] = [
    ["id", scalar(schemaId(checkType(operation.type)))],
    ["title", scalar(text("title", operation.title))],
    ["summary", scalar(text("summary", operation.summary))],
    ["status", scalar(status)],
    ["owner", scalar(reference("owner", operation.owner, true))],
  ]
  const keys = Object.entries(operation.keys ?? {})
  for (const [key] of keys)
    if (!factKeyPattern.test(key))
      throw invalid(
        `"${key}" is not a fact key: lowercase words joined by ".", "-" or "_"`,
      )
  if (keys.length > 0)
    entries.push(["keys", blockMap(keys.map(([k, o]) => [k, keyOptions(o)]))])
  if (operation.required?.length)
    entries.push(["required", flowList(operation.required.map(scalar))])
  if (operation.sections?.length)
    entries.push(["sections", flowList(operation.sections.map(scalar))])
  return documentText(entries, operation.body)
}

function sameOptions(
  written: {
    many: boolean | undefined
    relation: string[] | undefined
    identifiedBy: string[] | undefined
    inverse: string | undefined
    recheck: string | undefined
  },
  expected: KeyOptions,
): boolean {
  const list = (
    a: readonly string[] | undefined,
    b: readonly string[] | undefined,
  ) =>
    a === undefined || b === undefined
      ? a === b
      : a.length === b.length && a.every((v, i) => v === b[i])
  return (
    written.many === expected.many &&
    list(written.relation, expected.relation) &&
    list(written.identifiedBy, expected.identifiedBy) &&
    written.inverse === expected.inverse &&
    written.recheck === expected.recheck
  )
}

function setSchemaKey(editor: Editor, operation: SetSchemaKey) {
  const document = editor.document
  if (document.kind !== "schema") throw invalid("Not a type schema document")
  if (!factKeyPattern.test(operation.key))
    throw invalid(
      `"${operation.key}" is not a fact key: lowercase words joined by ".", "-" or "_"`,
    )
  const keysEntry = document.fields.get("keys")
  const keysMap = keysEntry?.value.kind === "map" ? keysEntry.value : null
  const entry = keysMap?.entries.find((e) => e.key === operation.key)
  const definition = document.keys.find((k) => k.key === operation.key)
  if ("absent" in operation.expect) {
    if (entry)
      throw conflict(
        "changed",
        `The key "${operation.key}" exists, but the operation expects it not to`,
      )
  } else if (
    !definition ||
    !sameOptions(definition, operation.expect.options)
  ) {
    throw conflict(
      "changed",
      `The key "${operation.key}" has changed since the operation was written`,
    )
  }
  const eol = lineBreak(document.text)
  if (operation.options === null) {
    if (!entry || !keysMap) return
    if (keysMap.entries.length === 1)
      editor.apply(removeFieldEdit(document, "keys"))
    else
      editor.apply(
        removeMapEntry(document.text, keysMap, keysMap.entries.indexOf(entry)),
      )
    return
  }
  const value = keyOptions(operation.options)
  if (entry && keysMap)
    editor.apply(
      replaceEntryValue(document.text, entry, value, keysMap.flow, eol),
    )
  else if (keysMap && keysMap.entries.length > 0)
    editor.apply(
      insertMapEntry(document.text, keysMap, operation.key, value, eol),
    )
  else
    editor.apply(
      setFieldEdit(document, "keys", blockMap([[operation.key, value]])),
    )
}

// The start-here document.

function stepsOut(steps: readonly StartHereStepInput[]): Out {
  if (!Array.isArray(steps)) throw invalid("A path is a list of steps")
  return steps.length === 0 ? flowList([]) : blockList(steps.map(stepOut))
}

function startHereText(operation: CreateStartHere): string {
  if (typeof operation.title !== "string" || operation.title.trim() === "")
    throw invalid("`title` is text")
  const entries: [string, Out][] = [
    ["id", scalar(startHereId)],
    ["title", scalar(operation.title)],
  ]
  if (operation.summary !== undefined)
    entries.push(["summary", scalar(operation.summary)])
  if (operation.owner !== undefined)
    entries.push(["owner", scalar(reference("owner", operation.owner, true))])
  entries.push(["people", stepsOut(operation.people)])
  entries.push(["agents", stepsOut(operation.agents)])
  return documentText(entries, operation.body)
}

function stepInput(step: {
  target:
    | { kind: "entity"; id: string }
    | { kind: "list"; list: string }
    | { kind: "url"; url: string }
  note: string
}): string {
  const t = step.target
  return JSON.stringify([
    t.kind === "entity" ? "to" : t.kind,
    t.kind === "entity" ? t.id : t.kind === "list" ? t.list : t.url,
    step.note,
  ])
}

function inputKey(step: StartHereStepInput): string {
  const [kind, value] =
    "to" in step
      ? ["to", step.to]
      : "list" in step
        ? ["list", step.list]
        : ["url", step.url]
  return JSON.stringify([kind, value, step.note])
}

function setStartHerePath(editor: Editor, operation: SetStartHerePath) {
  const document = editor.document
  if (document.kind !== "start-here")
    throw invalid("Not the start-here document")
  if (operation.path !== "people" && operation.path !== "agents")
    throw invalid("The start-here document's paths are people and agents")
  const current = document[operation.path].map(stepInput)
  const expected = operation.expect.steps.map(inputKey)
  const entry = document.fields.get(operation.path)
  const written =
    entry?.value.kind === "list"
      ? entry.value.items.length
      : entry && !(entry.value.kind === "scalar" && entry.value.value === null)
        ? -1
        : 0
  if (
    written !== current.length ||
    current.length !== expected.length ||
    current.some((s, i) => s !== expected[i])
  )
    throw conflict(
      "changed",
      `The ${operation.path} path has changed since the operation was written`,
    )
  editor.apply(
    setFieldEdit(document, operation.path, stepsOut(operation.steps)),
  )
}
