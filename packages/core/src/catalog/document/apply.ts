import { createHash } from "node:crypto"

import { comparableValue, discrepancies } from "./analysis.js"
import type { Section } from "./body.js"
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
import type { CheckFields, FactToWrite } from "./fact-edits.js"
import { factIdentityKey, parseFactIdentityKey } from "./identity.js"
import {
  attributeNameProblem,
  isEntityId,
  isFactKey,
  parseEntityId,
  schemaId,
  startHereId,
  typeNamePattern,
} from "./ids.js"
import { decisionStates, entityStatuses, factStates } from "./model.js"
import type { CatalogDocument, EntityDocument, FactCheck } from "./model.js"
import { checkOperationShape, ShapeError } from "./operation-shape.js"
import type {
  AcceptDiscrepancy,
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
  RestoreDocument,
  Retire,
  SetFact,
  SetField,
  SetSchemaKey,
  SetStartHerePath,
  StartHereStepInput,
} from "./operations.js"
import { maxDocumentBytes, parseCatalogDocument } from "./parse.js"
import type { Problem } from "./problems.js"
import { buildTypeRegistry, keySchema } from "./schemas.js"
import type { KeySchema, TypeRegistry } from "./schemas.js"
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
import type { ScalarValue, YamlMap, YamlNode } from "./yaml.js"

/** Who the operations are applied for. */
export interface ApplyContext {
  /**
   * The actor's written form (identity §8.7), such as
   * `guneet via opencode-daedalus`: written as `by` of every new fact check.
   * Callers never send it; it comes from the request's actor.
   */
  by: string
  /**
   * The `person` entity of the person approving the proposal, when one is.
   * Only `accept-discrepancy` uses it, writing it as `accepted` (catalog
   * §4.7); an operation never names the person itself.
   */
  acceptedBy?: string
}

/**
 * Limits on one proposal (**proposed**, M2-2). Every operation reads its
 * document again after each edit, so the work grows with the facts a
 * proposal writes; these bound it well above real use (a full recheck of
 * Musashi, the largest trial entity, names 22 facts; seeding a group of
 * entities writes a few dozen). Applying also runs off the main event loop
 * with a time limit (security checklist 10.8).
 */
export const maxOperations = 50
/**
 * The most facts a proposal names in all: one per `set-fact` and
 * `remove-fact`, and each fact of a `create-entity`, `recheck-facts` or
 * `accept-discrepancy`.
 */
export const maxFacts = 100

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
  /** The proposal has more operations, or an operation more facts, than Shinan applies at once. */
  | "too-many"
  /** The operation applies only when a person approves it (accepting a discrepancy). */
  | "needs-approval"

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
  const problems: OperationProblem[] = []
  if (!Array.isArray(operations))
    return {
      applied: false,
      before,
      problems: [
        {
          operation: 0,
          kind: "invalid",
          code: "operation-invalid",
          message: "A proposal's operations are a list",
          documentId: null,
        },
      ],
    }
  if (operations.length > maxOperations)
    return {
      applied: false,
      before,
      problems: [
        {
          operation: maxOperations,
          kind: "invalid",
          code: "too-many",
          message: `A proposal holds at most ${maxOperations} operations; split it`,
          documentId: null,
        },
      ],
    }
  const valid: { operation: CatalogOperation; index: number }[] = []
  operations.forEach((operation: unknown, index) => {
    try {
      checkOperationShape(operation)
      valid.push({ operation: operation as CatalogOperation, index })
    } catch (error) {
      if (!(error instanceof ShapeError)) throw error
      problems.push({
        operation: index,
        kind: "invalid",
        code: "operation-invalid",
        message: error.message,
        documentId: null,
      })
    }
  })
  if (problems.length > 0) return { applied: false, before, problems }
  const named = valid.reduce((n, { operation }) => n + factsNamed(operation), 0)
  if (named > maxFacts)
    return {
      applied: false,
      before,
      problems: [
        {
          operation: 0,
          kind: "invalid",
          code: "too-many",
          message: `A proposal names at most ${maxFacts} facts in all; this one names ${named}. Split it`,
          documentId: null,
        },
      ],
    }
  const working = new Working(before, context)
  const order = valid
    .slice()
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

/** What an operation expects of a fact: the whole fact as it is now. */
export function expectationOf(fact: Fact): PresentFact {
  const check = fact.check
  const expected: PresentFact = {
    identity: fact.identity,
    value: factValueText(fact),
    check: check === null ? null : expectedCheckOf(check),
  }
  if (fact.via !== undefined) expected.via = fact.via
  if (fact.note !== undefined) expected.note = fact.note
  if (fact.task !== undefined) expected.task = fact.task
  if (fact.remove) expected.remove = true
  if (fact.accepted !== undefined) expected.accepted = fact.accepted
  const attributes = Object.entries(fact.attributes).filter(
    (e): e is [string, Exclude<ScalarValue, null>] => e[1] !== null,
  )
  if (attributes.length > 0)
    expected.attributes = Object.fromEntries(attributes)
  return expected
}

/** The first field of the written fact that differs from the expectation, if any. */
function differentField(fact: Fact, expected: PresentFact): string | null {
  if (factValueText(fact) !== expected.value) return "value"
  for (const name of ["via", "note", "task", "accepted"] as const)
    if (fact[name] !== expected[name]) return name
  if (fact.remove !== (expected.remove ?? false)) return "remove"
  const written = Object.entries(fact.attributes)
  const wanted = expected.attributes ?? {}
  if (
    written.length !== Object.keys(wanted).length ||
    written.some(([k, v]) => !Object.hasOwn(wanted, k) || wanted[k] !== v)
  )
    return "attributes"
  return null
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

/** How many facts an operation names, for the limit on a proposal. */
function factsNamed(operation: CatalogOperation): number {
  switch (operation.op) {
    case "set-fact":
    case "remove-fact":
      return 1
    case "create-entity":
      return operation.facts?.length ?? 0
    case "recheck-facts":
      return operation.facts.length
    case "accept-discrepancy":
      return operation.expect.length
    default:
      return 0
  }
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

/**
 * What an operation may change in its document: these top-level fields, or
 * the body. Everything else must read the same afterwards.
 */
type Touched = readonly string[] | "body"

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
    const facts = ["facts"]
    switch (operation.op) {
      case "create-entity":
        return this.createEntity(operation)
      case "set-fact":
        return this.edit(operation.document, "entity", facts, (d) =>
          setFact(d, operation, this.context.by),
        )
      case "remove-fact":
        return this.edit(operation.document, "entity", facts, (d) =>
          removeFact(d, operation),
        )
      case "recheck-facts":
        return this.edit(operation.document, "entity", facts, (d) =>
          recheckFacts(d, operation, this.context.by),
        )
      case "accept-discrepancy":
        return this.edit(operation.document, "entity", facts, (d) =>
          acceptDiscrepancy(d, operation, this.context.acceptedBy),
        )
      case "edit-body":
        return this.edit(operation.document, null, "body", (d) =>
          editBody(d, operation),
        )
      case "set-field":
        return this.edit(operation.document, null, [operation.field], (d) =>
          setField(d, operation),
        )
      case "retire":
        return this.edit(
          operation.document,
          null,
          ["status", "replaced_by"],
          (d) => retire(d, operation),
        )
      case "change-id":
        return this.changeId(operation)
      case "restore-document":
        return this.restore(operation)
      case "create-schema":
        return this.create(schemaId(checkType(operation.type)), () =>
          schemaText(operation),
        )
      case "set-schema-key":
        return this.edit(operation.document, "schema", ["keys"], (d) =>
          setSchemaKey(d, operation),
        )
      case "create-start-here":
        return this.create(startHereId, () => startHereText(operation))
      case "set-start-here-path":
        return this.edit(startHereId, "start-here", [operation.path], (d) =>
          setStartHerePath(d, operation),
        )
      default:
        throw invalid("Not a catalog operation")
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

  /** Whether any document other than `except` has this ID or alias. */
  private taken(name: string, except?: Entry): boolean {
    return this.entries.some(
      (e) =>
        e !== except &&
        (e.document.id === name ||
          (e.document.kind === "entity" && e.document.aliases.includes(name))),
    )
  }

  private edit(
    id: string,
    kind: CatalogDocument["kind"] | null,
    touched: Touched,
    change: (editor: Editor) => void,
  ) {
    const entry = this.find(id)
    if (kind && entry.document.kind !== kind)
      throw invalid(`"${id}" is not ${kindName[kind]}`)
    const editor = new Editor(entry.document, this.registry)
    change(editor)
    this.commit(entry, editor.finish(entry.document, touched))
  }

  private create(id: string, written: () => Written) {
    if (this.taken(id))
      throw conflict("document-exists", `A document "${id}" already exists`)
    const { text, entries } = written()
    const editor = Editor.create(text, this.registry)
    verifyFields(editor.document, entries)
    const entry: Entry = { before: null, document: editor.document }
    this.commit(entry, editor.finish(null, "body"), true)
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
    const { text, entries } = entityText(operation, parsed.type)
    const editor = Editor.create(text, this.registry)
    verifyFields(editor.document, entries)
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
    this.commit(entry, editor.finish(null, "body"), true)
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
    if (this.taken(operation.id, entry))
      throw conflict(
        "document-exists",
        `A document already has the ID or alias "${operation.id}"`,
      )
    const editor = new Editor(document, this.registry)
    changeId(editor, operation.id)
    this.commit(entry, editor.finish(document, ["id", "aliases"]))
  }

  /** Replaces a document's whole text: a revert, or an owner's repair. */
  private restore(operation: RestoreDocument) {
    const entry = this.find(operation.document)
    const current = createHash("sha256")
      .update(entry.document.text)
      .digest("hex")
    if (current !== operation.expect.sha256)
      throw conflict(
        "changed",
        `"${operation.document}" has changed since the text being put back was read`,
      )
    if (utf8Length(operation.text) > maxDocumentBytes)
      throw invalid(
        "The text is longer than a catalog document may be",
        "too-large",
      )
    const document = parseCatalogDocument(operation.text)
    if (document.kind !== entry.document.kind)
      throw invalid(
        `The new text of "${operation.document}" is ${kindName[document.kind]}, not ${kindName[entry.document.kind]}`,
      )
    for (const name of [
      document.id,
      ...(document.kind === "entity" ? document.aliases : []),
    ])
      if (name !== null && this.taken(name, entry))
        throw conflict(
          "document-exists",
          `Another document now has the ID or alias "${name}"`,
        )
    this.commit(entry, document)
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

  private resolvedFor: {
    document: CatalogDocument
    entity: ResolvedEntity
  } | null = null

  resolved(): ResolvedEntity {
    if (this.resolvedFor?.document !== this.document)
      this.resolvedFor = {
        document: this.document,
        entity: resolveEntity(this.entity, this.registry),
      }
    return this.resolvedFor.entity
  }

  apply(edit: Edit) {
    this.document = read(applyEdit(this.text, edit))
  }

  /**
   * The document after the operation, if it reads as intended: no problem
   * the document did not have before, and nothing outside what the
   * operation touches reads differently. An edit that reads back otherwise
   * is refused rather than stored.
   */
  finish(before: CatalogDocument | null, touched: Touched): CatalogDocument {
    const added = subtract(
      this.problems(this.document),
      before ? this.problems(before) : [],
    )
    if (added.length > 0)
      throw invalid(
        `The result would not read as intended: ${added.map((p) => p.message).join("; ")}`,
        "result-invalid",
      )
    if (before) untouched(before, this.document, touched)
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

function readsWrong(what: string): OperationFailure {
  return invalid(
    `The result would not read as intended: ${what}`,
    "result-invalid",
  )
}

/** Checks that everything an operation does not touch reads as before. */
function untouched(
  before: CatalogDocument,
  after: CatalogDocument,
  touched: Touched,
) {
  if (touched === "body") {
    const range = (d: CatalogDocument) =>
      d.frontmatter ? d.text.slice(0, d.frontmatter.end) : null
    if (range(before) !== range(after))
      throw readsWrong("the frontmatter would change")
    return
  }
  if (after.body.text !== before.body.text)
    throw readsWrong("the body would change")
  const names = new Set([...before.fields.keys(), ...after.fields.keys()])
  for (const name of names) {
    if (touched.includes(name)) continue
    const was = before.fields.get(name)
    const now = after.fields.get(name)
    if (!was || !now || plain(was.value) !== plain(now.value))
      throw readsWrong(`\`${name}\` would change`)
  }
}

/** A YAML value as comparable text. */
function plain(node: YamlNode): string {
  const value = (n: YamlNode): unknown =>
    n.kind === "scalar"
      ? n.value
      : n.kind === "list"
        ? n.items.map(value)
        : n.entries.map((e) => [e.key, value(e.value)])
  return JSON.stringify(value(node))
}

/** What Shinan meant to write, as comparable text, in the shape `plain` reads. */
function plainOut(out: Out): string {
  const value = (o: Out): unknown => {
    switch (o.kind) {
      case "scalar":
        return o.value
      case "list":
        return o.items.map(value)
      case "map":
        return o.entries.map(([k, v]) => [k, value(v)])
      default:
        return JSON.parse(plain(o.node)) as unknown
    }
  }
  return JSON.stringify(value(out))
}

/** A new document's text and the top-level fields it was written with. */
interface Written {
  text: string
  entries: [string, Out][]
}

/** Checks that each field reads back as written. */
function verifyFields(document: CatalogDocument, entries: [string, Out][]) {
  for (const [name, out] of entries) verifyField(document, [name], out)
}

/**
 * Checks that a field (or a key inside one, such as a schema key under
 * `keys`) reads back as written, or is gone when `out` is null.
 */
function verifyField(
  document: CatalogDocument,
  path: readonly string[],
  out: Out | null,
) {
  let node: YamlNode | undefined = document.fields.get(path[0] ?? "")?.value
  for (const key of path.slice(1))
    node =
      node?.kind === "map"
        ? node.entries.find((e) => e.key === key)?.value
        : undefined
  const ok =
    out === null
      ? node === undefined
      : node !== undefined && plain(node) === plainOut(out)
  if (!ok) throw readsWrong(`\`${path.join(".")}\` would not read as written`)
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

function identityOf(fact: FactInput, key: KeySchema) {
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

function checkFact(fact: FactInput, key: KeySchema) {
  if (Object.hasOwn(fact, "accepted"))
    throw invalid(
      "`accepted` is not sent with a fact: Shinan writes it, naming the person who approves an `accept-discrepancy` operation",
    )
  if (!isFactKey(fact.key))
    throw invalid(
      `"${fact.key}" is not a fact key: lowercase words joined by ".", "-" or "_", and not a name such as "constructor"`,
    )
  if (!factStates.includes(fact.state))
    throw invalid(`"${fact.state}" is not a fact state`)
  const text = (name: string, value: string | undefined) => {
    if (value !== undefined && value.trim() === "")
      throw invalid(`The fact's \`${name}\` is text`)
  }
  text("to", fact.to)
  text("via", fact.via)
  text("note", fact.note)
  text("task", fact.task)
  if (fact.value === "")
    throw invalid(
      `The fact "${fact.key}" has no value; record it as unknown instead`,
    )
  for (const [name, v] of Object.entries(fact.attributes ?? {})) {
    const problem = attributeNameProblem(name)
    if (problem !== null) throw invalid(problem)
    if (v === "") throw invalid(`The attribute "${name}" holds one value`)
  }
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
  if (!parseCatalogTime(check.checked))
    throw invalid(
      "`checked` is a date (2026-11-14) or a date and time with a UTC offset (2026-11-14T09:30Z)",
    )
  for (const name of ["scope", "source", "limits"] as const) {
    const value = check[name]
    if ((value !== undefined || name !== "limits") && !value?.trim())
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
  const changed = differentField(fact, expect)
  if (changed)
    throw conflict(
      "fact-changed",
      `The ${changed === "value" ? "value" : `\`${changed}\``} of ${expect.identity} has changed since the operation was written`,
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

/**
 * Removes every current fact with this identity, one edit at a time, except
 * the first that `keep` matches, if any.
 */
function removeIdentity(
  editor: Editor,
  identity: string,
  keep: (fact: Fact) => boolean = () => false,
) {
  for (;;) {
    const facts = factsWithIdentity(editor.resolved(), identity)
    const kept = facts.find(keep)
    const fact = facts.find((f) => f !== kept)
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
 * joined or left it), removes `accepted` from every fact of the key (catalog
 * §4.7): the discrepancy needs accepting again.
 */
function unaccept(editor: Editor, key: string, before: string) {
  if (discrepancyOf(editor.resolved(), key) === before) return
  for (;;) {
    const fact = editor
      .resolved()
      .facts.find(
        (f) =>
          f.key === key &&
          !f.schema.many &&
          (f.state === "intended" || f.state === "observed") &&
          f.accepted !== undefined,
      )
    if (!fact) return
    editor.apply(stripAcceptedEdit(editor.entity, fact))
  }
}

/** A fact as written, to write again with changes. */
function writtenOf(fact: Fact): FactToWrite {
  const written: FactToWrite = { key: fact.key, state: fact.state }
  if (fact.value !== undefined && fact.value !== null && !fact.schema.relation)
    written.value = fact.value
  if (fact.to !== undefined) written.to = fact.to
  const attributes = Object.entries(fact.attributes).filter(
    (e): e is [string, Exclude<ScalarValue, null>] => e[1] !== null,
  )
  if (attributes.length > 0) written.attributes = Object.fromEntries(attributes)
  if (fact.via !== undefined) written.via = fact.via
  if (fact.note !== undefined) written.note = fact.note
  if (fact.task !== undefined) written.task = fact.task
  if (fact.remove) written.remove = true
  if (fact.accepted !== undefined) written.accepted = fact.accepted
  return written
}

/**
 * Checks that facts of keys the operation does not touch read as before.
 * Facts in `moved` may have a new fact check.
 */
function otherFactsUnchanged(
  before: ResolvedEntity,
  after: ResolvedEntity,
  keys: ReadonlySet<string>,
  moved: ReadonlySet<string> = new Set(),
) {
  const model = (f: Fact, withCheck: boolean) =>
    JSON.stringify([
      f.identity,
      f.value,
      f.to,
      f.via,
      f.note,
      f.task,
      f.remove,
      f.accepted,
      Object.entries(f.attributes),
      withCheck
        ? [
            f.check?.checked?.text,
            f.check?.by,
            f.check?.scope,
            f.check?.source,
            f.check?.limits,
          ]
        : null,
    ])
  const now = new Map<string, string[]>()
  for (const f of after.facts) {
    if (keys.has(f.key) && !moved.has(f.identity)) continue
    const list = now.get(f.identity) ?? []
    list.push(model(f, !moved.has(f.identity)))
    now.set(f.identity, list)
  }
  for (const f of before.facts) {
    if (keys.has(f.key) && !moved.has(f.identity)) continue
    const list = now.get(f.identity) ?? []
    const index = list.indexOf(model(f, !moved.has(f.identity)))
    if (index < 0) throw readsWrong(`the fact ${f.identity} would change`)
    list.splice(index, 1)
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
  let fact: FactToWrite = operation.fact
  if (operation.supersedes) {
    const superseded = parseFactIdentityKey(operation.supersedes.identity)
    if (
      superseded?.key !== fact.key ||
      operation.supersedes.identity === identity
    )
      throw invalid(
        "A change of state supersedes a fact of the same key with another identity",
      )
    // Catalog §4.2, §4.4: a plan or an unknown settled by what is now
    // declared or seen. Taking away an intended or observed fact is a
    // removal of its own (`remove-fact`), not part of writing another.
    if (
      !(superseded.state === "planned" || superseded.state === "unknown") ||
      !(fact.state === "intended" || fact.state === "observed")
    )
      throw invalid(
        "A change of state settles a planned or unknown fact with an intended or observed one; remove other facts with `remove-fact`",
      )
  }
  const start = editor.resolved()
  const current = expectFact(start, operation.expect)
  if (operation.supersedes) expectFact(start, operation.supersedes)

  // A recheck of a value that did not change keeps the acceptance of its
  // discrepancy, with the note that says why (catalog §4.7).
  const old = current[0]
  if (
    old?.accepted !== undefined &&
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
  const first = factsWithIdentity(editor.resolved(), identity)[0]
  if (first && checkMatches(first.check, target)) {
    editor.apply(replaceFactEdit(editor.entity, first, value))
  } else {
    // Written first and the old fact removed after, so a group or `facts`
    // the move empties is dropped without `facts` being written anew.
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
  // Only the fact just written stays; a document that repeated it keeps one.
  removeIdentity(editor, identity, (f) => checkMatches(f.check, target))
  unaccept(editor, fact.key, before)
  verifyFact(editor, identity, fact, target)
  otherFactsUnchanged(start, editor.resolved(), new Set([fact.key]))
}

/** Checks that the written fact reads back as given: a guard against a bad edit. */
function verifyFact(
  editor: Editor,
  identity: string,
  fact: FactToWrite,
  check: CheckFields | null,
) {
  const found = factsWithIdentity(editor.resolved(), identity)
  const written = found[0]
  const attributes = fact.attributes ?? {}
  if (
    found.length !== 1 ||
    !written ||
    !checkMatches(written.check, check) ||
    written.value !== (fact.state === "unknown" ? undefined : fact.value) ||
    written.to !== fact.to ||
    written.via !== fact.via ||
    written.note !== fact.note ||
    written.task !== fact.task ||
    written.remove !== (fact.remove ?? false) ||
    (written.accepted !== undefined && written.accepted !== fact.accepted) ||
    Object.keys(written.attributes).length !== Object.keys(attributes).length ||
    Object.entries(attributes).some(
      ([k, v]) =>
        !Object.hasOwn(written.attributes, k) || written.attributes[k] !== v,
    )
  )
    throw readsWrong(`the fact ${identity} would not read back as written`)
}

function removeFact(editor: Editor, operation: RemoveFact) {
  const start = editor.resolved()
  const found = expectFact(start, operation.expect)
  const key = found[0]?.key ?? ""
  const before = discrepancyOf(start, key)
  removeIdentity(editor, operation.expect.identity)
  unaccept(editor, key, before)
  otherFactsUnchanged(start, editor.resolved(), new Set([key]))
}

/** The map of the group at `index` in the `facts` list. */
function groupMap(document: EntityDocument, index: number): YamlMap {
  const list = document.fields.get("facts")?.value
  const node = list?.kind === "list" ? list.items[index] : undefined
  if (node?.kind !== "map")
    throw new UnsupportedLayoutError("A group is not where the model says")
  return node
}

/**
 * Rewrites a group's fact check in place, for a recheck of every fact in
 * it: the facts, their text and comments stay where they are.
 */
function retargetGroup(editor: Editor, index: number, target: CheckFields) {
  const eol = lineBreak(editor.text)
  for (const field of ["checked", "by", "scope", "source"] as const) {
    const map = groupMap(editor.entity, index)
    const entry = map.entries.find((e) => e.key === field)
    if (!entry)
      throw new UnsupportedLayoutError("A fact check field is missing")
    editor.apply(
      replaceEntryValue(
        editor.text,
        entry,
        scalar(target[field]),
        map.flow,
        eol,
      ),
    )
  }
  const map = groupMap(editor.entity, index)
  const limits = map.entries.findIndex((e) => e.key === "limits")
  const entry = map.entries[limits]
  if (entry && target.limits !== undefined)
    editor.apply(
      replaceEntryValue(
        editor.text,
        entry,
        scalar(target.limits),
        map.flow,
        eol,
      ),
    )
  else if (entry) editor.apply(removeMapEntry(editor.text, map, limits))
  else if (target.limits !== undefined)
    editor.apply(
      insertMapEntry(
        editor.text,
        map,
        "limits",
        scalar(target.limits),
        eol,
        map.entries.findIndex((e) => e.key === "source") + 1,
      ),
    )
}

function recheckFacts(editor: Editor, operation: RecheckFacts, by: string) {
  if (operation.facts.length === 0)
    throw invalid("A recheck names at least one fact")
  const named = new Set(operation.facts.map((f) => f.identity))
  if (named.size !== operation.facts.length)
    throw invalid("A recheck names each fact once")
  const start = editor.resolved()
  for (const expect of operation.facts) {
    const [fact] = expectFact(start, expect)
    if (fact?.state === "planned")
      throw invalid(
        `${expect.identity} is planned; planned facts have no fact check`,
      )
  }
  const target = checkFields("observed", operation.check, by) as CheckFields

  // A group whose facts are all rechecked keeps its place and its text:
  // only its fact check is rewritten. Later moves then merge into it.
  if (!editor.entity.groups.some((g) => checkMatches(g.check, target))) {
    const whole = editor.entity.groups.find((group) => {
      const entries = group.check?.entries
      const facts = start.facts.filter((f) => f.group === group.index)
      return (
        entries?.checked &&
        entries.by &&
        entries.scope &&
        entries.source &&
        group.check?.checked &&
        facts.length > 0 &&
        facts.every((f) => named.has(f.identity))
      )
    })
    if (whole) retargetGroup(editor, whole.index, target)
  }

  for (const expect of operation.facts) {
    const fact = factsWithIdentity(editor.resolved(), expect.identity)[0]
    if (!fact || checkMatches(fact.check, target)) continue
    const value = factText(editor.entity, fact)
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
    removeIdentity(editor, expect.identity, (f) =>
      checkMatches(f.check, target),
    )
  }
  const after = editor.resolved()
  for (const expect of operation.facts) {
    const moved = factsWithIdentity(after, expect.identity)
    if (
      moved.length !== 1 ||
      !checkMatches(moved[0]?.check ?? null, target) ||
      differentField(moved[0] as Fact, expect)
    )
      throw readsWrong(
        `the fact ${expect.identity} would not read back as written`,
      )
  }
  otherFactsUnchanged(start, after, new Set(), named)
}

function acceptDiscrepancy(
  editor: Editor,
  operation: AcceptDiscrepancy,
  acceptedBy: string | undefined,
) {
  if (operation.note.trim() === "")
    throw invalid("Say why the difference is accepted, in `note`")
  const start = editor.resolved()
  const found = discrepancies(start).find((d) => d.key === operation.key)
  if (!found)
    throw conflict("changed", `"${operation.key}" has no discrepancy any more`)
  const named = new Set(operation.expect.map((e) => e.identity))
  if (
    named.size !== found.facts.length ||
    found.facts.some((f) => !named.has(f.identity))
  )
    throw conflict(
      "changed",
      `The facts of the discrepancy of "${operation.key}" have changed since the operation was written`,
    )
  for (const expect of operation.expect) expectFact(start, expect)
  const person = acceptedBy === undefined ? null : parseEntityId(acceptedBy)
  if (person?.type !== "person")
    throw invalid(
      "Accepting a discrepancy is written when a person approves the proposal, and names that person",
      "needs-approval",
    )
  for (const identity of named) {
    const fact = factsWithIdentity(editor.resolved(), identity)[0] as Fact
    editor.apply(
      replaceFactEdit(
        editor.entity,
        fact,
        factOut(
          {
            ...writtenOf(fact),
            note: operation.note,
            accepted: acceptedBy,
          },
          fact.schema,
        ),
      ),
    )
  }
  const after = editor.resolved()
  const accepted = discrepancies(after).find((d) => d.key === operation.key)
  if (
    !accepted?.accepted ||
    discrepancyOf(after, operation.key) !==
      discrepancyOf(start, operation.key) ||
    accepted.facts.some(
      (f) => f.accepted !== acceptedBy || f.note !== operation.note,
    )
  )
    throw readsWrong(
      `the discrepancy of "${operation.key}" would not read as accepted`,
    )
  otherFactsUnchanged(start, after, new Set([operation.key]))
}

// Entities and fields.

function entityText(operation: CreateEntity, type: string): Written {
  const text = (name: string, value: string) => {
    if (value.trim() === "") throw invalid(`\`${name}\` is text`)
    return value
  }
  const status = choice("status", operation.status ?? "active", entityStatuses)
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
  return { text: documentText(entries, operation.body), entries }
}

function documentText(entries: [string, Out][], body: string | undefined) {
  const lines = ["---", ...blockLines(blockMap(entries), 0), "---"]
  let text = lines.join("\n") + "\n"
  if (body !== undefined && body !== "")
    text += "\n" + withBreak(lineBreaks(body, "\n"), "\n")
  return text
}

function reference(name: string, value: string, unknownAllowed: boolean) {
  if ((unknownAllowed && value === "unknown") || isEntityId(value)) return value
  throw invalid(
    `\`${name}\` is an entity ID such as person/guneet${unknownAllowed ? ", or unknown" : ""}`,
  )
}

function choice<T extends string>(
  name: string,
  value: string,
  choices: readonly T[],
): T {
  const found = choices.find((c) => c === value)
  if (found === undefined)
    throw invalid(`\`${name}\` is one of ${choices.join(", ")}`)
  return found
}

function time(name: string, value: string): string {
  if (parseCatalogTime(value)) return value
  throw invalid(
    `\`${name}\` is a date (2026-11-14) or a date and time with a UTC offset (2026-11-14T09:30Z)`,
  )
}

/** The fields each kind of document lets `set-field` change, and whether each is required. */
export const settable: Record<
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

/** A field's value as `set-field` expects it; undefined when it has a form no operation expects. */
export function currentField(
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
  const rule = Object.hasOwn(settable[document.kind], operation.field)
    ? settable[document.kind][operation.field]
    : undefined
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
    verifyField(editor.document, [operation.field], null)
    return
  }
  let out: Out
  if (rule.list) {
    if (typeof value === "string" || value.some((v) => v === ""))
      throw invalid(`\`${operation.field}\` is a list of text`)
    out = flowList(value.map(scalar))
  } else {
    if (typeof value !== "string" || value.trim() === "")
      throw invalid(`\`${operation.field}\` is text`)
    switch (operation.field) {
      case "status":
        // Lifecycle changes are gated and have their own operations:
        // `retire`, and no way back from retired (catalog §8.1).
        if (value === "retired")
          throw invalid("Retiring is its own operation, `retire`")
        if (document.kind !== "start-here" && document.status === "retired")
          throw invalid(
            "A retired document stays retired; `set-field` does not bring it back",
          )
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
    out = scalar(value)
  }
  editor.apply(setFieldEdit(document, operation.field, out))
  verifyField(editor.document, [operation.field], out)
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
  verifyField(editor.document, ["status"], scalar("retired"))
  if (operation.replacedBy !== undefined) {
    if (editor.document.kind !== "entity")
      throw invalid("Only an entity names a replacement")
    if (operation.replacedBy === editor.document.id)
      throw invalid("An entity cannot replace itself")
    const out = scalar(reference("replacedBy", operation.replacedBy, false))
    editor.apply(setFieldEdit(editor.document, "replaced_by", out))
    verifyField(editor.document, ["replaced_by"], out)
  }
}

function changeId(editor: Editor, id: string) {
  const old = editor.entity.id as string
  editor.apply(setFieldEdit(editor.document, "id", scalar(id)))
  verifyField(editor.document, ["id"], scalar(id))
  const document = editor.entity
  const aliases = document.aliases
  const entry = document.fields.get("aliases")
  const node = entry?.value
  const eol = lineBreak(document.text)
  if (node?.kind === "list") {
    const index = node.items.findIndex(
      (i) => i.kind === "scalar" && i.value === id,
    )
    const item = node.items[index]
    // Changing back to a former ID: that alias becomes the old ID.
    if (item)
      editor.apply(replaceListItem(document.text, item, scalar(old), node.flow))
    else editor.apply(appendListItem(document.text, node, scalar(old), eol))
  } else if (!entry || (node?.kind === "scalar" && node.value === null)) {
    editor.apply(setFieldEdit(document, "aliases", flowList([scalar(old)])))
  } else {
    throw invalid(
      "`aliases` is not a list, so the old ID cannot be added to it",
    )
  }
  const expected = [...aliases.filter((a) => a !== id), old].sort()
  if (
    JSON.stringify([...editor.entity.aliases].sort()) !==
    JSON.stringify(expected)
  )
    throw readsWrong("`aliases` would not read as written")
}

// Body.

function editBody(editor: Editor, operation: EditBody) {
  const document = editor.document
  const body = document.body
  const eol = lineBreak(document.text)
  // New text takes the document's line breaks.
  const given = lineBreaks(operation.text, eol)
  // A document that ends right after its closing `---` gets the line break
  // its body starts after.
  const lead =
    body.range.start === document.text.length && !document.text.endsWith("\n")
      ? eol
      : ""
  if (operation.section === undefined) {
    if (!("text" in operation.expect))
      throw invalid("The whole body is always there; expect its text")
    if (body.text !== operation.expect.text)
      throw conflict(
        "changed",
        "The body has changed since the operation was written",
      )
    editor.apply(replaceRange(body.range, given === "" ? "" : lead + given))
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
    const at = name === null ? body.range.start : body.range.end
    const gap =
      name === null || body.text === ""
        ? lead
        : /(\r?\n){2}$/.test(body.text)
          ? ""
          : body.text.endsWith("\n")
            ? eol
            : eol + eol
    editor.apply(replaceRange({ start: at, end: at }, gap + text))
    sectionReads(editor, at + gap.length, text.length, name, label)
    // Added at the end, the blank line before it joins the last section.
    const last = body.sections[body.sections.length - 1]
    otherSectionsUnchanged(
      name !== null && last
        ? [...body.sections.slice(0, -1), { ...last, text: last.text + gap }]
        : body.sections,
      null,
      editor.document.body.sections,
      at + gap.length,
      text.length,
    )
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
  if (text !== "")
    sectionReads(editor, section.range.start, text.length, name, label)
  otherSectionsUnchanged(
    body.sections,
    section,
    editor.document.body.sections,
    section.range.start,
    text.length,
  )
}

/**
 * Checks that a section edit left every other section as it was: the same
 * headings, levels and text, in the same order, and the same anchors. New
 * text that leaves a block open (an unclosed code fence) would otherwise
 * swallow the sections after it into the edited one, and the wiki, the
 * index and later section edits would lose them. When a section is
 * removed, a later section with the same heading may take its anchor, so
 * anchors are compared only otherwise.
 */
function otherSectionsUnchanged(
  before: readonly Section[],
  edited: Section | null,
  after: readonly Section[],
  start: number,
  length: number,
) {
  const removed = length === 0
  const key = (s: Section) =>
    JSON.stringify([s.heading, s.level, s.text, removed ? null : s.anchor])
  // An empty body reads as one empty section before any heading; it is no
  // section to keep.
  const real = (s: Section) => s.heading !== null || s.text.trim() !== ""
  const expected = before.filter((s) => s !== edited && real(s)).map(key)
  const actual = after
    .filter(
      (s) =>
        real(s) && !(s.range.start >= start && s.range.start < start + length),
    )
    .map(key)
  if (
    expected.length !== actual.length ||
    expected.some((k, i) => k !== actual[i])
  )
    throw readsWrong(
      "the sections around the edited one would change (is a code block or other block left open?)",
    )
}

/**
 * Checks that the text written at `start` reads as the one section it is
 * for: starting with that section's heading (or, for the text before the
 * first heading, with no heading), and holding no other heading. Otherwise
 * the edit would quietly join it to the section before, or add sections
 * (even a second one with a heading already used); adding sections is an
 * edit of the whole body.
 */
function sectionReads(
  editor: Editor,
  start: number,
  length: number,
  name: string | null,
  label: string,
) {
  const sections = editor.document.body.sections
  const section = sections.find((s) => s.range.start === start)
  const ok =
    name === null
      ? section?.heading === null
      : section !== undefined && section.anchor === name
  if (!ok)
    throw invalid(
      name === null
        ? `${label} cannot start with a heading`
        : `${label}'s new text starts with its own heading`,
    )
  if (
    sections.some(
      (s) => s.range.start > start && s.range.start < start + length,
    )
  )
    throw invalid(
      `${label}'s new text holds another heading; one section edit writes one section, so add sections by editing the whole body`,
    )
}

function lineBreaks(text: string, eol: string): string {
  return text.replace(/\r\n|\n/g, eol)
}

function withBreak(text: string, eol: string): string {
  return text.endsWith("\n") ? text : text + eol
}

// Type schema documents.

function checkType(type: string): string {
  if (!typeNamePattern.test(type))
    throw invalid("A type name is lowercase kebab-case, such as dns-zone")
  return type
}

function schemaText(operation: CreateSchema): Written {
  const text = (name: string, value: string) => {
    if (value.trim() === "") throw invalid(`\`${name}\` is text`)
    return value
  }
  const status = choice("status", operation.status ?? "active", entityStatuses)
  const entries: [string, Out][] = [
    ["id", scalar(schemaId(checkType(operation.type)))],
    ["title", scalar(text("title", operation.title))],
    ["summary", scalar(text("summary", operation.summary))],
    ["status", scalar(status)],
    ["owner", scalar(reference("owner", operation.owner, true))],
  ]
  const keys = Object.entries(operation.keys ?? {})
  for (const [key] of keys)
    if (!isFactKey(key))
      throw invalid(
        `"${key}" is not a fact key: lowercase words joined by ".", "-" or "_", and not a name such as "constructor"`,
      )
  if (keys.length > 0)
    entries.push([
      "keys",
      blockMap(keys.map(([k, o]) => [k, keyOptionsOut(o)])),
    ])
  if (operation.required?.length)
    entries.push(["required", flowList(operation.required.map(scalar))])
  if (operation.sections?.length)
    entries.push(["sections", flowList(operation.sections.map(scalar))])
  return { text: documentText(entries, operation.body), entries }
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
  if (!isFactKey(operation.key))
    throw invalid(
      `"${operation.key}" is not a fact key: lowercase words joined by ".", "-" or "_", and not a name such as "constructor"`,
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
    verifyField(editor.document, ["keys", operation.key], null)
    return
  }
  const value = keyOptionsOut(operation.options)
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
  verifyField(editor.document, ["keys", operation.key], value)
}

// The start-here document.

function stepsOut(steps: readonly StartHereStepInput[]): Out {
  return steps.length === 0 ? flowList([]) : blockList(steps.map(stepOut))
}

function startHereText(operation: CreateStartHere): Written {
  if (operation.title.trim() === "") throw invalid("`title` is text")
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
  return { text: documentText(entries, operation.body), entries }
}

/** A start-here step as `set-start-here-path` compares it. */
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
  const out = stepsOut(operation.steps)
  editor.apply(setFieldEdit(document, operation.path, out))
  verifyField(editor.document, [operation.path], out)
}
