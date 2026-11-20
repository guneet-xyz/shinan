import { createHash } from "node:crypto"

import { discrepancies } from "./analysis.js"
import type { Catalog } from "./catalog.js"
import { dayMillis } from "./dates.js"
import type { Fact, ResolvedEntity } from "./entity.js"
import { canonicalValue } from "./identity.js"
import {
  isEntityId,
  schemaId,
  schemaType,
  startHereId,
  taskIdPattern,
  workspaceTarget,
} from "./ids.js"
import type {
  CatalogDocument,
  EntityDocument,
  FactCheck,
  SchemaDocument,
  StartHereDocument,
} from "./model.js"
import { maxDocumentBytes } from "./parse.js"
import { blocking, warning } from "./problems.js"
import type { Problem, ProblemCode } from "./problems.js"
import { anyTarget, taskTarget } from "./schemas.js"
import type { TypeRegistry } from "./schemas.js"
import { excerpt, scanSecrets } from "./secrets.js"
import type { SecretMatch } from "./secrets.js"
import { utf8Length } from "./source.js"
import type { Range } from "./source.js"
import type { YamlNode } from "./yaml.js"

/**
 * Validation of catalog documents (catalog §8.3). It runs on the Markdown a
 * proposal would produce, never on the operations that produced it
 * (catalog §2.1, rule 2).
 */
export interface ValidationContext {
  /** The time "not in the future" is judged against. */
  now: Date | number
  /**
   * The handles of the workspace's current members. When given, owners whose
   * `person` entity has no current `member` fact naming one are warned about
   * (catalog §2.3).
   */
  memberHandles?: ReadonlySet<string>
  /**
   * Secret scans kept between validations, so a document whose text was
   * scanned before is not scanned again (`SecretScans`). The result is the
   * same without them.
   */
  secretScans?: SecretScans
}

export interface ValidationResult {
  problems: Problem[]
  /** Any blocking problem: the proposal cannot apply. */
  blocked: boolean
  /** Any warning: the proposal needs catalog approval, with the reasons shown (catalog §8.2, "Doubtful"). */
  needsApproval: boolean
}

export interface Change {
  /** The catalog before the change; null for a first proposal into an empty catalog. */
  before: Catalog | null
  /** The catalog the change would produce. */
  after: Catalog
  /** The documents in `after` the change writes. */
  changed: readonly CatalogDocument[]
  /** Other text the change carries, such as the proposal's explanation, checked for secrets. */
  texts?: readonly { label: string; text: string }[]
  /**
   * A workspace owner's repair of a document that reads with problems
   * (catalog §8.3): the documents it writes are charged only with problems
   * they did not already have, so a repair may leave some of them and fix
   * the rest. A secret-looking value is charged all the same.
   */
  repair?: boolean
}

/**
 * Validates a change (catalog §8.3):
 *
 * - in the documents it writes, every blocking problem, and the warnings
 *   they did not already have (an accepted warning is not charged again);
 * - in documents it does not write, any problem it newly causes, such as a
 *   reference it breaks;
 * - a type schema change that adds problems a schema can cause to entities
 *   of its type is blocked and lists them (catalog §3.9).
 *
 * No message repeats a secret-looking value found in the catalog or the
 * change's text: each is cut to its excerpt.
 *
 * `base`, a validation of the catalog before the change or of any earlier
 * revision, saves validating the documents the change cannot affect; the
 * result is the same with or without it. Without one, the catalog before
 * the change is validated in full.
 */
export function validateChange(
  change: Change,
  context: ValidationContext,
  base?: CatalogValidation,
): ValidationResult {
  return validateChangeIncrementally(change, context, base).result
}

/**
 * `validateChange`, also giving the validation of the catalog after the
 * change, to pass as `base` for the next change once this one is stored.
 */
export function validateChangeIncrementally(
  change: Change,
  context: ValidationContext,
  base?: CatalogValidation,
): { result: ValidationResult; after: CatalogValidation } {
  checkChanged(change)
  const before = change.before
    ? base
      ? updateCatalogValidation(base, change.before, context)
      : prepareCatalogValidation(change.before, context)
    : null
  const after = before
    ? updateCatalogValidation(before, change.after, context)
    : prepareCatalogValidation(change.after, context)
  // Each document of `before` gives its earlier problems to one unwritten
  // document with the same text, in order.
  const taken = new Map<string, number>()
  const byId = (document: CatalogDocument) =>
    document.id === null ? undefined : before?.firstById.get(document.id)
  const result = assemble(change, after, {
    written: (document) => byId(document) ?? [],
    unwritten: (document) => {
      const sameText = before?.byText.get(document.text)
      const index = taken.get(document.text) ?? 0
      if (sameText && index < sameText.length) {
        taken.set(document.text, index + 1)
        return sameText[index] as Problem[]
      }
      return byId(document) ?? []
    },
  })
  return { result, after }
}

/**
 * `validateChange` without a base: both catalogs validated in full, every
 * document. Exported for tests only, as the oracle the incremental
 * validation must agree with.
 */
export function validateChangeFully(
  change: Change,
  context: ValidationContext,
): ValidationResult {
  checkChanged(change)
  const before = change.before
    ? prepareCatalogValidation(change.before, context)
    : null
  // The earlier problems found as before #116, without the kept indexes.
  const byText = new Map<string, Problem[][]>()
  const byId = new Map<string, Problem[]>()
  for (const [document, { problems }] of before?.entries ?? []) {
    const list = byText.get(document.text) ?? []
    list.push(problems)
    byText.set(document.text, list)
    if (document.id !== null && !byId.has(document.id))
      byId.set(document.id, problems)
  }
  return assemble(change, prepareCatalogValidation(change.after, context), {
    written: (document) =>
      document.id === null ? [] : (byId.get(document.id) ?? []),
    unwritten: (document) =>
      byText.get(document.text)?.shift() ??
      (document.id === null ? undefined : byId.get(document.id)) ??
      [],
  })
}

/** Validates every document of a catalog, as if all were new. */
export function validateCatalog(
  catalog: Catalog,
  context: ValidationContext,
): ValidationResult {
  const v = prepareCatalogValidation(catalog, context)
  return result(redact([...v.problems()], [...v.secrets()]))
}

function checkChanged(change: Change) {
  const known = new Set(change.after.documents)
  for (const document of change.changed)
    if (!known.has(document))
      throw new Error(
        `A changed document is not in the catalog after the change: ${document.id ?? "(no ID)"}`,
      )
}

/** Where a document's problems before the change are found. */
interface Earlier {
  /** For a document the change writes. */
  written(document: CatalogDocument): readonly Problem[]
  /**
   * For a document it does not write, whose text is unchanged, so they are
   * found by text: this also works for documents with no readable ID. Each
   * earlier document's problems are given once.
   */
  unwritten(document: CatalogDocument): readonly Problem[]
}

/** Charges the change with the problems it adds (see `validateChange`). */
function assemble(
  change: Change,
  after: CatalogValidation,
  earlierOf: Earlier,
): ValidationResult {
  const changed = new Set(change.changed)
  const problems: Problem[] = []
  const broken = new Map<string, string[]>()
  for (const [document, { problems: found }] of after.entries) {
    if (changed.has(document)) {
      const earlier = earlierOf.written(document)
      problems.push(
        ...(change.repair
          ? [
              ...found.filter((p) => p.code === "secret"),
              ...subtract(
                found.filter((p) => p.code !== "secret"),
                earlier,
              ),
            ]
          : [
              ...found.filter((p) => p.severity === "blocking"),
              ...subtract(
                found.filter((p) => p.severity === "warning"),
                earlier.filter((p) => p.severity === "warning"),
              ),
            ]),
      )
      continue
    }
    const earlier = earlierOf.unwritten(document)
    // A document the change could not affect keeps its very problems.
    if (earlier === found) continue
    const caused = subtract(found, earlier)
    problems.push(...caused)
    if (
      document.kind === "entity" &&
      document.type &&
      caused.some((p) => schemaCaused.has(p.code))
    ) {
      const list = broken.get(document.type) ?? []
      list.push(document.id ?? "")
      broken.set(document.type, list)
    }
  }
  for (const document of changed) {
    if (document.kind !== "schema" || document.describes === null) continue
    const entities = broken.get(document.describes)
    if (entities)
      problems.push(
        blocking(
          "schema-breaks-entities",
          `This change to the ${document.describes} type would break ${entities.length === 1 ? "an entity" : `${entities.length} entities`}: ${entities.join(", ")}`,
          document.id,
        ),
      )
  }

  if (change.before) {
    for (const document of changed) {
      if (document.kind !== "entity" || document.id === null) continue
      const now = change.after.entities.get(document.id)
      const was = change.before.entities.get(document.id)
      if (now && was) problems.push(...olderChecks(was, now))
    }
  }

  const secrets = [...after.secrets()]
  for (const { label, text } of change.texts ?? []) {
    if (utf8Length(text) > maxDocumentBytes)
      problems.push(tooLarge(null, `${label}: `))
    for (const finding of scanSecrets(text)) {
      secrets.push({ ...finding, documentId: null })
      problems.push(secretProblem(finding, null, `${label}: `))
    }
  }

  return result(redact(problems, secrets))
}

function result(problems: Problem[]): ValidationResult {
  return {
    problems,
    blocked: problems.some((p) => p.severity === "blocking"),
    needsApproval: problems.some((p) => p.severity === "warning"),
  }
}

/**
 * Problems a type schema can cause in an entity it does not write: what
 * `schema-breaks-entities` counts (catalog §3.9).
 */
const schemaCaused: ReadonlySet<ProblemCode> = new Set([
  "type-unknown",
  "key-not-in-schema",
  "cardinality",
  "reference-type",
  "identity-duplicate",
  "fact-invalid",
])

/**
 * What tells two problems apart when comparing before and after: the
 * matched value for secret findings (a hash, never the value), the message
 * otherwise. In memory only: if these hashes are ever stored, they must
 * become an HMAC with an installation key, since a plain hash of a weak
 * password can be guessed.
 */
const fingerprints = new WeakMap<Problem, string>()

/** The problems of `found` that `earlier` does not have, counting repeats. */
function subtract(
  found: readonly Problem[],
  earlier: readonly Problem[],
): Problem[] {
  const counts = new Map<string, number>()
  const key = (p: Problem) =>
    `${p.code}\u0000${p.severity}\u0000${fingerprints.get(p) ?? p.message}`
  for (const p of earlier) counts.set(key(p), (counts.get(key(p)) ?? 0) + 1)
  return found.filter((p) => {
    const n = counts.get(key(p)) ?? 0
    if (n === 0) return true
    counts.set(key(p), n - 1)
    return false
  })
}

/** A secret found while validating, with where it was found. */
type FoundSecret = SecretMatch & { documentId: string | null }

/**
 * Cuts secret-looking values to their excerpt in every message, so problems
 * can be stored and shown (catalog §7.3). Done once, here, rather than in
 * each message:
 *
 * - a near-certain secret is cut wherever it appears;
 * - a weaker sign (such as the value after `token:`) is cut only from
 *   problems about the text where it was found, so an ordinary word that
 *   happens to follow `token:` is not cut from unrelated messages;
 * - finally each message is checked itself, which catches a secret written
 *   with YAML escapes (`\x41`) that a message repeats decoded.
 */
function redact(
  problems: Problem[],
  secrets: readonly FoundSecret[],
): Problem[] {
  const everywhere = values(
    secrets.filter((s) => s.severity === "blocking").map((s) => s.secret),
  )
  const local = secrets.filter((s) => s.severity === "warning")
  return problems.map((p) => {
    const near = p.range
      ? local
          .filter(
            (s) =>
              s.documentId === p.documentId &&
              s.range.start < (p.range as Range).end &&
              (p.range as Range).start < s.range.end &&
              // The warning that reports the value already shows only its
              // excerpt; cutting the value again would garble its words.
              !(
                p.code === "secret-suspected" &&
                p.range?.start === s.range.start &&
                p.range.end === s.range.end
              ),
          )
          .map((s) => s.secret)
      : []
    let message = cut(p.message, [...everywhere, ...values(near)])
    message = cut(message, values(scanSecrets(message).map((s) => s.secret)))
    return message === p.message ? p : { ...p, message }
  })
}

function values(secrets: readonly string[]): string[] {
  return [...new Set(secrets)]
    .filter((s) => s.length >= 4)
    .sort((a, b) => b.length - a.length)
}

function cut(message: string, secrets: readonly string[]): string {
  let result = message
  for (const value of secrets)
    if (result.includes(value))
      result = result.split(value).join(excerpt(value))
  return result
}

function tooLarge(documentId: string | null, where = ""): Problem {
  return blocking(
    "too-large",
    `${where}This text is longer than ${maxDocumentBytes / 1024} KiB of UTF-8, the most a catalog document may hold`,
    documentId,
  )
}

/** One document's validation, kept so a later revision need not repeat it. */
interface DocumentValidation {
  problems: Problem[]
  secrets: readonly FoundSecret[]
  /**
   * The names its validation looked up: IDs and aliases it references, and
   * `schema/<type>` for the types it checked exist.
   */
  references: readonly string[]
  /** Whether a fact check was in the future, which a later time may change. */
  future: boolean
}

/**
 * The validation of one catalog's documents, kept by the catalog worker
 * for its latest revision so the next change only validates what it can
 * affect (`validateChange`'s `base`). Opaque outside this module.
 *
 * It holds each document's problems and the secrets found in it, and an
 * index of which documents reference each ID, alias and type. Each
 * revision gets its own: a validation is never changed once made, and the
 * `Problem` objects in it are shared with every result made from it, so
 * nothing may change those either. It keeps the catalog's documents and
 * type registry, but not its resolved entities, so keeping it costs little
 * beyond the parsed documents (catalog worker, `estimatedBytes`).
 */
export class CatalogValidation {
  #byText?: Map<string, Problem[][]>
  #firstById?: Map<string, Problem[]>
  #types?: Map<string, string>
  /** The documents validated, in the catalog's order. */
  readonly documents: readonly CatalogDocument[]
  /** @internal The catalog's type schema documents. */
  readonly schemas: readonly CatalogDocument[]
  /** @internal */
  readonly registry: TypeRegistry

  /** @internal Use `prepareCatalogValidation` and `updateCatalogValidation`. */
  constructor(
    /** The catalog validated, or one with the very same documents. */
    catalog: Catalog,
    /** @internal By document, in the catalog's order. */
    readonly entries: ReadonlyMap<CatalogDocument, DocumentValidation>,
    /** @internal The documents that reference each name. */
    readonly referrers: ReadonlyMap<string, ReadonlySet<CatalogDocument>>,
    /** @internal */
    readonly now: number,
    /** @internal `memberHandles`, as one string; null when not given. */
    readonly members: string | null,
  ) {
    this.documents = catalog.documents
    this.schemas = catalog.schemas
    this.registry = catalog.registry
  }

  /**
   * What the validation keeps for one document, for the catalog worker's
   * memory estimate: its problems, the secrets found in it and the names
   * it references. Zeros for a document it does not hold.
   */
  counts(document: CatalogDocument): {
    problems: number
    secrets: number
    references: number
  } {
    const entry = this.entries.get(document)
    return {
      problems: entry?.problems.length ?? 0,
      secrets: entry?.secrets.length ?? 0,
      references: entry?.references.length ?? 0,
    }
  }

  /**
   * Whether this is the validation of exactly these documents, in any
   * order, with the context's member handles, at its time or before: then
   * validating them again for the context only re-checks fact checks that
   * were in the future.
   */
  covers(
    documents: readonly CatalogDocument[],
    context: ValidationContext,
  ): boolean {
    if (
      this.members !== membersKey(context) ||
      millis(context.now) < this.now ||
      documents.length !== this.documents.length
    )
      return false
    const held = new Set(this.documents)
    return documents.every((d) => held.has(d))
  }

  /** @internal Every problem, by document in order. */
  *problems(): Iterable<Problem> {
    for (const entry of this.entries.values()) yield* entry.problems
  }

  /** @internal Every secret found, by document in order. */
  *secrets(): Iterable<FoundSecret> {
    for (const entry of this.entries.values()) yield* entry.secrets
  }

  /** @internal Each document's problems by its text, in order. */
  get byText(): ReadonlyMap<string, readonly Problem[][]> {
    if (!this.#byText) {
      this.#byText = new Map()
      for (const [document, { problems }] of this.entries) {
        const list = this.#byText.get(document.text) ?? []
        list.push(problems)
        this.#byText.set(document.text, list)
      }
    }
    return this.#byText
  }

  /** @internal The problems of the first document with each ID. */
  get firstById(): ReadonlyMap<string, Problem[]> {
    if (!this.#firstById) {
      this.#firstById = new Map()
      for (const [document, { problems }] of this.entries)
        if (document.id !== null && !this.#firstById.has(document.id))
          this.#firstById.set(document.id, problems)
    }
    return this.#firstById
  }

  /** @internal Each type schema, written out to compare. */
  get types(): ReadonlyMap<string, string> {
    this.#types ??= typeTexts(this.registry)
    return this.#types
  }
}

/** Validates every document of a catalog, for `validateChange`'s `base`. */
export function prepareCatalogValidation(
  catalog: Catalog,
  context: ValidationContext,
): CatalogValidation {
  const v = new Validator(catalog, context)
  const entries = new Map<CatalogDocument, DocumentValidation>()
  for (const document of catalog.documents)
    entries.set(document, v.document(document))
  const referrers = new Map<string, Set<CatalogDocument>>()
  for (const [document, entry] of entries)
    for (const name of entry.references) {
      const set = referrers.get(name) ?? new Set()
      set.add(document)
      referrers.set(name, set)
    }
  return new CatalogValidation(
    catalog,
    entries,
    referrers,
    v.now,
    membersKey(context),
  )
}

/**
 * The validation of `catalog`, from the validation of another revision:
 * only the documents the difference can affect are validated again, and
 * the result is the same as `prepareCatalogValidation(catalog, context)`.
 *
 * Validated again: documents not in `base`; documents sharing an ID or
 * alias with one added or removed, or with another document; when type
 * schemas change, every schema document and the entities of the changed
 * types; documents referencing any of those; and, when `now` is later,
 * documents whose fact checks were in the future. An earlier `now` or
 * other member handles validate everything again.
 */
export function updateCatalogValidation(
  base: CatalogValidation,
  catalog: Catalog,
  context: ValidationContext,
): CatalogValidation {
  const now = millis(context.now)
  if (membersKey(context) !== base.members || now < base.now)
    return prepareCatalogValidation(catalog, context)
  const documents = catalog.documents
  if (now === base.now && sameList(documents, base.documents)) return base
  const present = new Set(documents)

  const v = new Validator(catalog, context)
  const dirty = new Set<CatalogDocument>()
  const names = new Set<string>()
  const touch = (document: CatalogDocument) => {
    dirty.add(document)
    for (const name of namesOf(document)) names.add(name)
  }
  for (const document of documents)
    if (!base.entries.has(document)) touch(document)
  const gone: CatalogDocument[] = []
  for (const document of base.entries.keys())
    if (!present.has(document)) {
      gone.push(document)
      for (const name of namesOf(document)) names.add(name)
    }
  // Which document a name resolves to, and which entity an ID's is, depends
  // on the other documents with that name.
  for (const name of [...names])
    for (const document of v.names.get(name) ?? []) touch(document)
  for (const list of v.names.values())
    if (list.length > 1) for (const document of list) touch(document)

  if (!sameList(catalog.schemas, base.schemas)) {
    const was = base.types
    const is = typeTexts(catalog.registry)
    const types = new Set<string>()
    for (const [type, text] of is) if (was.get(type) !== text) types.add(type)
    for (const type of was.keys()) if (!is.has(type)) types.add(type)
    for (const document of catalog.schemas) dirty.add(document)
    for (const document of documents)
      if (
        document.kind === "entity" &&
        document.type !== null &&
        types.has(document.type)
      )
        touch(document)
    for (const type of types) names.add(schemaId(type))
  }

  for (const name of names)
    for (const document of base.referrers.get(name) ?? [])
      if (present.has(document)) dirty.add(document)
  if (now > base.now)
    for (const [document, entry] of base.entries)
      if (entry.future && present.has(document)) dirty.add(document)

  const entries = new Map<CatalogDocument, DocumentValidation>()
  for (const document of documents)
    entries.set(
      document,
      dirty.has(document)
        ? v.document(document)
        : (base.entries.get(document) as DocumentValidation),
    )

  const referrers = new Map(base.referrers)
  const copied = new Set<string>()
  const edit = (name: string) => {
    let set = referrers.get(name) as Set<CatalogDocument> | undefined
    if (!copied.has(name)) {
      set = new Set(set)
      referrers.set(name, set)
      copied.add(name)
    }
    return set as Set<CatalogDocument>
  }
  for (const document of [...gone, ...dirty]) {
    for (const name of base.entries.get(document)?.references ?? [])
      edit(name).delete(document)
    for (const name of entries.get(document)?.references ?? [])
      edit(name).add(document)
  }
  for (const name of copied)
    if (referrers.get(name)?.size === 0) referrers.delete(name)

  return new CatalogValidation(catalog, entries, referrers, now, base.members)
}

function millis(at: Date | number): number {
  return typeof at === "number" ? at : at.getTime()
}

function membersKey(context: ValidationContext): string | null {
  return context.memberHandles
    ? [...context.memberHandles].sort().join("\n")
    : null
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

/** A document's ID and aliases. */
function namesOf(document: CatalogDocument): string[] {
  const names = document.id === null ? [] : [document.id]
  if (document.kind === "entity") names.push(...document.aliases)
  return names
}

/** Each type schema as text, to tell which a change to the schemas changed. */
function typeTexts(registry: TypeRegistry): Map<string, string> {
  const texts = new Map<string, string>()
  for (const [type, schema] of registry.types)
    texts.set(
      type,
      JSON.stringify(schema, (_, value: unknown) =>
        value instanceof Map ? [...value.entries()] : value,
      ),
    )
  return texts
}

function secretProblem(
  finding: SecretMatch,
  documentId: string | null,
  where = "",
): Problem {
  const problem =
    finding.severity === "blocking"
      ? blocking(
          "secret",
          `${where}This looks like a ${finding.kind} (${finding.excerpt}). Secret values never go in the catalog: record where the secret lives with \`secrets-in\`, then rotate it, since it may already have been seen`,
          documentId,
          documentId === null ? undefined : finding.range,
        )
      : warning(
          "secret-suspected",
          `${where}This may be a secret (${finding.kind}, ${finding.excerpt}); a person confirms it is not before it applies`,
          documentId,
          documentId === null ? undefined : finding.range,
        )
  fingerprints.set(
    problem,
    createHash("sha256").update(finding.secret).digest("base64url"),
  )
  return problem
}

/**
 * Task workflow statuses (tasks §7.2) that mean little outside a task, so
 * a fact holding one was probably copied from a task. Words with ordinary
 * meanings (`done`, `cancelled`) are left out: `subscription.status:
 * cancelled` is a real fact.
 */
const taskStatuses = new Set([
  "triage",
  "to do",
  "todo",
  "in progress",
  "in review",
  "verifying",
])

const writtenActor =
  /^(?:[a-z0-9]+(?:-[a-z0-9]+)*)(?: via [a-z0-9]+(?:-[a-z0-9]+)*)?$/

/** Leeway for "not in the future": clocks differ, and a date may already have started east of UTC. */
const clockSkewMillis = 5 * 60 * 1000
const earliestOffsetMillis = 14 * 60 * 60 * 1000

class Validator {
  /** Each ID and alias, with the documents that have it, in order. */
  readonly names = new Map<string, CatalogDocument[]>()
  readonly now: number
  private references = new Set<string>()

  constructor(
    private readonly catalog: Catalog,
    private readonly context: ValidationContext,
  ) {
    this.now = millis(context.now)
    for (const document of catalog.documents) {
      const names = new Set<string>()
      if (document.id !== null) names.add(document.id)
      if (document.kind === "entity")
        for (const a of document.aliases) names.add(a)
      for (const name of names) {
        const list = this.names.get(name) ?? []
        list.push(document)
        this.names.set(name, list)
      }
    }
  }

  document(document: CatalogDocument): DocumentValidation {
    this.references = new Set()
    const problems: Problem[] = [...document.problems]
    const add = (
      code: ProblemCode,
      message: string,
      range?: Range,
      severity: "blocking" | "warning" = "blocking",
    ) =>
      problems.push(
        (severity === "blocking" ? blocking : warning)(
          code,
          message,
          document.id,
          range,
        ),
      )
    const check = new Checks(this, document, add)

    this.uniqueNames(document, add)
    check.owner(document.owner, "owner")
    check.body()
    const scan = this.context.secretScans
      ? this.context.secretScans.of(document)
      : scanOf(document)
    problems.push(...scan.problems)

    if (document.kind === "entity") this.entity(document, check, add, problems)
    else if (document.kind === "schema") this.schema(document, problems)
    else this.startHere(document, add)
    return {
      problems,
      secrets: scan.secrets,
      references: [...this.references],
      future: problems.some((p) => p.code === "checked-in-future"),
    }
  }

  private uniqueNames(document: CatalogDocument, add: Adder) {
    const names = new Set<string>()
    if (document.id !== null) names.add(document.id)
    if (document.kind === "entity")
      for (const a of document.aliases) {
        if (a === document.id)
          add(
            "id-duplicate",
            `The alias "${a}" is the entity's own ID`,
            field(document, "aliases"),
          )
        names.add(a)
      }
    for (const name of names) {
      const others = (this.names.get(name) ?? []).filter((d) => d !== document)
      if (others.length > 0)
        add(
          "id-duplicate",
          `"${name}" is also the ID or an alias of ${others.map((d) => d.id ?? "another document").join(", ")}`,
          field(document, name === document.id ? "id" : "aliases"),
        )
    }
  }

  private entity(
    document: EntityDocument,
    check: Checks,
    add: Adder,
    problems: Problem[],
  ) {
    const resolved =
      document.id === null ? undefined : this.catalog.entities.get(document.id)
    const entity = resolved?.document === document ? resolved : undefined
    if (document.type !== null) {
      const type = this.catalog.registry.types.get(document.type)
      if (!type)
        add(
          "type-unknown",
          `"${document.type}" is neither a built-in type nor a type with a schema document`,
          field(document, "type"),
        )
      else if (type.status === "retired" && document.status !== "retired")
        add(
          "type-unknown",
          `The type "${document.type}" is retired, so only retired entities may use it`,
          field(document, "type"),
        )
    }
    check.reference(
      document.replacedBy,
      "replaced_by",
      field(document, "replaced_by"),
    )
    if (document.decision)
      check.owner(document.decision.decidedBy, "decided_by")

    for (const group of document.groups) {
      if (group.check) this.factCheck(document, group.check, group.range, add)
    }
    if (!entity) return
    problems.push(...entity.problems)

    const seen = new Map<string, Fact>()
    const outside = new Set<string>()
    for (const fact of entity.facts) {
      if (
        (fact.state === "intended" || fact.state === "observed") &&
        !fact.check
      )
        add(
          "fact-check-missing",
          `The ${fact.state} fact "${fact.key}" needs a fact check: put it in a group with checked, by, scope and source`,
          fact.range,
        )
      // A list on a single-valued key is already a cardinality problem.
      const listed = !fact.schema.many && fact.item !== null
      if (seen.has(fact.identity) && !listed)
        add(
          "identity-duplicate",
          `"${fact.key}" is written twice as the same fact (${fact.identity}); a fact appears in exactly one group`,
          fact.range,
        )
      else seen.set(fact.identity, fact)
      if (!fact.schema.inSchema && !outside.has(fact.key)) {
        outside.add(fact.key)
        add(
          "key-not-in-schema",
          `"${fact.key}" is not a key of the ${document.type ?? "entity's"} type schema`,
          fact.keyRange,
          "warning",
        )
      }
      if (fact.state === "planned") check.plannedTask(fact)
      if (fact.accepted !== undefined)
        check.reference(fact.accepted, "accepted", fact.range, ["person"])
      if (fact.schema.relation && fact.to !== undefined) check.relation(fact)
      if (
        fact.value !== undefined &&
        /(?:^|[._-])(?:status|state)$/.test(fact.key) &&
        taskStatuses.has(
          canonicalValue(fact.value).toLowerCase().replace(/[_-]/g, " ").trim(),
        )
      )
        add(
          "task-status",
          `"${canonicalValue(fact.value)}" looks like a task status; task status stays on tasks, not in the catalog`,
          fact.valueRange,
          "warning",
        )
    }
  }

  private factCheck(
    document: EntityDocument,
    check: FactCheck,
    range: Range,
    add: Adder,
  ) {
    const missing = (["checked", "by", "scope", "source"] as const).filter(
      (f) => !check.entries[f],
    )
    if (missing.length > 0)
      add(
        "fact-check-incomplete",
        `The fact check needs ${missing.join(", ")}`,
        range,
      )
    const imported = document.importedFrom !== null
    if (check.checked === null && !imported)
      add(
        "unchecked-not-imported",
        "`checked: null` is only for imported facts that were never checked",
        check.entries.checked?.range,
      )
    if (check.by === "unknown" && !imported)
      add(
        "unchecked-not-imported",
        "`by: unknown` is only for imported fact checks",
        check.entries.by?.range,
      )
    if (
      check.by !== undefined &&
      check.by !== "unknown" &&
      !writtenActor.test(check.by)
    )
      add(
        "fact-check-invalid",
        `"${check.by}" is not how an actor is written: a handle, "<handle> via <agent>", or shinan`,
        check.entries.by?.value.range,
      )
    if (check.checked) {
      const latest = check.checked.dateOnly
        ? startOfDay(this.now + earliestOffsetMillis)
        : this.now + clockSkewMillis
      if (check.checked.at > latest)
        add(
          "checked-in-future",
          `The fact check is dated ${check.checked.text}, which is in the future`,
          check.entries.checked?.value.range,
        )
    }
  }

  private schema(document: SchemaDocument, problems: Problem[]) {
    problems.push(
      ...this.catalog.registry.problems.filter(
        (p) => p.documentId === document.id,
      ),
    )
  }

  private startHere(document: StartHereDocument, add: Adder) {
    for (const step of [...document.people, ...document.agents]) {
      if (step.target.kind !== "entity") continue
      const target = this.resolve(step.target.id)
      if (!target) {
        add(
          "reference-unresolved",
          `"${step.target.id}" is not an entity in this catalog`,
          step.range,
        )
        continue
      }
      const entity = this.entityOf(target)
      if (!entity) continue
      if (entity.document.status === "retired")
        add(
          "start-here-retired",
          `The step "${step.target.id}" points to a retired entity`,
          step.range,
          "warning",
        )
      if (discrepancies(entity).some((d) => !d.accepted))
        add(
          "start-here-discrepancy",
          `The step "${step.target.id}" points to an entity with discrepancies`,
          step.range,
          "warning",
        )
    }
  }

  /** The document an ID or alias names; built-in type schemas exist without a document. */
  resolve(name: string): CatalogDocument | "built-in" | undefined {
    this.references.add(name)
    const found = this.names.get(name)?.[0]
    if (found) return found
    const type = schemaType(name)
    if (type !== null && this.catalog.registry.types.get(type)?.builtIn)
      return "built-in"
    return undefined
  }

  entityOf(found: CatalogDocument | "built-in"): ResolvedEntity | undefined {
    if (found === "built-in" || found.kind !== "entity" || found.id === null)
      return undefined
    const entity = this.catalog.entities.get(found.id)
    return entity?.document === found ? entity : undefined
  }

  get members(): ReadonlySet<string> | undefined {
    return this.context.memberHandles
  }

  hasType(type: string): boolean {
    this.references.add(schemaId(type))
    return this.catalog.registry.types.has(type)
  }
}

type Adder = (
  code: ProblemCode,
  message: string,
  range?: Range,
  severity?: "blocking" | "warning",
) => void

/** Reference checks for one document. */
class Checks {
  constructor(
    private readonly v: Validator,
    private readonly document: CatalogDocument,
    private readonly add: Adder,
  ) {}

  /** A reference to an entity, optionally of given types. */
  reference(
    id: string | null | undefined,
    what: string,
    range: Range | undefined,
    types?: readonly string[],
  ): ResolvedEntity | undefined {
    if (id === null || id === undefined) return undefined
    const found = this.v.resolve(id)
    if (!found || found === "built-in" || found.kind !== "entity") {
      this.add(
        "reference-unresolved",
        `\`${what}\` names "${id}", which is not an entity in this catalog`,
        range,
      )
      return undefined
    }
    if (types && found.type !== null && !types.includes(found.type))
      this.add(
        "reference-type",
        `\`${what}\` names "${id}", a ${found.type}; it must be a ${types.join(" or ")}`,
        range,
      )
    return this.v.entityOf(found)
  }

  /** `owner` and `decided_by`: a person, or `unknown`; warns if not a current member. */
  owner(id: string | null, what: string) {
    if (id === null || id === "unknown") return
    const range = field(this.document, what)
    const person = this.reference(id, what, range, ["person"])
    const members = this.v.members
    if (!person || !members || what !== "owner") return
    const linked = person.facts.some(
      (f) =>
        f.key === "member" &&
        (f.state === "intended" || f.state === "observed") &&
        typeof f.value === "string" &&
        members.has(f.value),
    )
    if (!linked)
      this.add(
        "owner-not-member",
        `The owner "${id}" is not linked to a current member (its \`member\` fact)`,
        range,
        "warning",
      )
  }

  body() {
    for (const link of this.document.body.links) {
      if (link.reference === null) continue
      if (link.reference === startHereId && this.v.resolve(startHereId))
        continue
      if (!this.v.resolve(link.reference))
        this.add(
          "reference-unresolved",
          `The link to "${link.reference}" does not name an entity in this catalog${/^[^/]+\.[^/]+/.test(link.reference) ? "; for a web address, start it with https://" : ""}`,
          link.range,
        )
    }
  }

  plannedTask(fact: Fact) {
    const task = fact.task
    if (task === undefined) {
      this.add(
        "planned-without-task",
        `The planned fact "${fact.key}" names the task (or accepted decision) behind it with \`task\``,
        fact.range,
      )
      return
    }
    if (taskIdPattern.test(task)) return
    if (!isEntityId(task)) {
      this.add(
        "planned-without-task",
        `"${task}" is neither a task ID (such as T-12) nor a decision`,
        fact.range,
      )
      return
    }
    const decision = this.reference(task, "task", fact.range, ["decision"])
    if (decision && decision.document.decision?.state !== "accepted")
      this.add(
        "planned-without-task",
        `The decision "${task}" behind a planned fact must be accepted`,
        fact.range,
      )
  }

  relation(fact: Fact) {
    const relation = fact.schema.relation
    const to = fact.to
    if (!relation || to === undefined) return
    if (relation.targets.includes(taskTarget)) {
      if (!taskIdPattern.test(to))
        this.add(
          "reference-unresolved",
          `"${fact.key}" names a task by its ID, such as T-12; "${to}" is not one`,
          fact.range,
        )
      return
    }
    if (relation.targets.includes(anyTarget)) {
      if (to === workspaceTarget) return
      const type = schemaType(to)
      if (type !== null) {
        if (!this.v.hasType(type))
          this.add(
            "reference-unresolved",
            `"${to}" is not a type in this catalog`,
            fact.range,
          )
        return
      }
      this.reference(to, fact.key, fact.range)
      return
    }
    this.reference(to, fact.key, fact.range, relation.targets)
  }
}

/** What the secret check finds in one document's text. */
interface SecretScan {
  secrets: readonly FoundSecret[]
  /** A `secret` or `secret-suspected` problem for each. */
  problems: readonly Problem[]
}

function scanOf(document: CatalogDocument): SecretScan {
  const secrets = secretsIn(document).map((finding) => ({
    ...finding,
    documentId: document.id,
  }))
  return {
    secrets,
    problems: secrets.map((finding) => secretProblem(finding, document.id)),
  }
}

/**
 * Secret scans by the SHA-256 of the document's text (#116), which they
 * depend on alone: a document validated again, as a referrer or an entity
 * of a changed type, or parsed again from the same text, is not scanned
 * again. Scanning is most of validating long prose.
 *
 * The catalog worker keeps one for its workspace and keeps it bounded with
 * `keepOnly`, to the texts of the validations it keeps; those share the
 * kept findings and problems, so they cost nothing beyond what the
 * validation's estimate counts (`CatalogValidation.counts`). A hash, not
 * the text, is the key: V8 hashes strings over 16,383 characters by their
 * length alone.
 */
export class SecretScans {
  readonly #scans = new Map<string, SecretScan>()
  readonly #hashes = new WeakMap<CatalogDocument, string>()
  /** Texts scanned, for tests. */
  scanned = 0

  /** The scan of the document's text, made once per text. */
  of(document: CatalogDocument): SecretScan {
    const hash = this.#hash(document)
    let scan = this.#scans.get(hash)
    if (!scan) {
      scan = scanOf(document)
      this.#scans.set(hash, scan)
      this.scanned++
    }
    return scan
  }

  /** Forgets the scans of every text but those of these documents. */
  keepOnly(documents: Iterable<CatalogDocument>): void {
    const keep = new Set<string>()
    for (const document of documents) keep.add(this.#hash(document))
    for (const hash of [...this.#scans.keys()])
      if (!keep.has(hash)) this.#scans.delete(hash)
  }

  get size(): number {
    return this.#scans.size
  }

  #hash(document: CatalogDocument): string {
    let hash = this.#hashes.get(document)
    if (hash === undefined) {
      hash = createHash("sha256").update(document.text).digest("base64url")
      this.#hashes.set(document, hash)
    }
    return hash
  }
}

/**
 * Secrets in a document's text, and in frontmatter values and keys whose
 * YAML escapes (such as `\x41` in a quoted string) make the read value
 * differ from the written text. A decoded finding points at the value.
 */
function secretsIn(document: CatalogDocument): SecretMatch[] {
  const found = scanSecrets(document.text)
  const seen = new Set(found.map((f) => f.secret))
  const decoded = (value: string, range: Range) => {
    if (document.text.slice(range.start, range.end) === value) return
    for (const f of scanSecrets(value)) {
      if (seen.has(f.secret)) continue
      seen.add(f.secret)
      found.push({ ...f, range })
    }
  }
  const stack: YamlNode[] = [...document.fields.values()].map((e) => {
    decoded(e.key, e.keyRange)
    return e.value
  })
  while (stack.length > 0) {
    const node = stack.pop() as YamlNode
    if (node.kind === "scalar") {
      if (typeof node.value === "string") decoded(node.value, node.range)
    } else if (node.kind === "list") {
      stack.push(...node.items)
    } else {
      for (const e of node.entries) {
        decoded(e.key, e.keyRange)
        stack.push(e.value)
      }
    }
  }
  return found
}

function field(document: CatalogDocument, name: string): Range | undefined {
  return document.fields.get(name)?.value.range
}

function startOfDay(at: number): number {
  return Math.floor(at / dayMillis) * dayMillis
}

/**
 * Warns where a changed fact's new fact check is older than the one it
 * replaces (catalog §8.3; "Doubtful" in §8.2). Dates are compared by day when
 * either check has only a date.
 */
function olderChecks(was: ResolvedEntity, now: ResolvedEntity): Problem[] {
  const previous = new Map(was.facts.map((f) => [f.identity, f]))
  const problems: Problem[] = []
  for (const fact of now.facts) {
    const old = previous.get(fact.identity)
    const a = old?.check?.checked
    const b = fact.check?.checked
    if (!a || !b || sameCheck(old?.check ?? null, fact.check)) continue
    const day = a.dateOnly || b.dateOnly
    const older = day ? startOfDay(b.at) < startOfDay(a.at) : b.at < a.at
    if (older)
      problems.push(
        warning(
          "check-older",
          `The new fact check of "${fact.key}" (${b.text}) is older than the one it replaces (${a.text})`,
          now.document.id,
          fact.range,
        ),
      )
  }
  return problems
}

function sameCheck(a: FactCheck | null, b: FactCheck | null): boolean {
  if (!a || !b) return a === b
  return (
    a.checked?.text === b.checked?.text &&
    a.by === b.by &&
    a.scope === b.scope &&
    a.source === b.source &&
    a.limits === b.limits
  )
}
