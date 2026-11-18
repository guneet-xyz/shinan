import { createHash } from "node:crypto"

import { discrepancies } from "./analysis.js"
import type { Catalog } from "./catalog.js"
import { dayMillis } from "./dates.js"
import type { Fact, ResolvedEntity } from "./entity.js"
import { canonicalValue } from "./identity.js"
import {
  isEntityId,
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
 */
export function validateChange(
  change: Change,
  context: ValidationContext,
): ValidationResult {
  const known = new Set(change.after.documents)
  for (const document of change.changed)
    if (!known.has(document))
      throw new Error(
        `A changed document is not in the catalog after the change: ${document.id ?? "(no ID)"}`,
      )

  const after = new Validation(change.after, context)
  const before = change.before ? new Validation(change.before, context) : null
  const beforeByText = new Map<string, Problem[][]>()
  const beforeById = new Map<string, Problem[]>()
  for (const [document, problems] of before?.byDocument ?? []) {
    const list = beforeByText.get(document.text) ?? []
    list.push(problems)
    beforeByText.set(document.text, list)
    if (document.id !== null && !beforeById.has(document.id))
      beforeById.set(document.id, problems)
  }

  const changed = new Set(change.changed)
  const problems: Problem[] = []
  const broken = new Map<string, string[]>()
  for (const [document, found] of after.byDocument) {
    if (changed.has(document)) {
      const earlier =
        document.id === null ? [] : (beforeById.get(document.id) ?? [])
      problems.push(
        ...found.filter((p) => p.severity === "blocking"),
        ...subtract(
          found.filter((p) => p.severity === "warning"),
          earlier.filter((p) => p.severity === "warning"),
        ),
      )
      continue
    }
    // An unwritten document's text is unchanged, so its earlier problems are
    // found by text: this also works for documents with no readable ID.
    const earlier =
      beforeByText.get(document.text)?.shift() ??
      (document.id === null ? undefined : beforeById.get(document.id)) ??
      []
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

  for (const { label, text } of change.texts ?? []) {
    if (utf8Length(text) > maxDocumentBytes)
      problems.push(tooLarge(null, `${label}: `))
    for (const finding of scanSecrets(text)) {
      after.secrets.push({ ...finding, documentId: null })
      problems.push(after.secretProblem(finding, null, `${label}: `))
    }
  }

  return result(redact(problems, after.secrets))
}

/** Validates every document of a catalog, as if all were new. */
export function validateCatalog(
  catalog: Catalog,
  context: ValidationContext,
): ValidationResult {
  const v = new Validation(catalog, context)
  return result(redact([...v.byDocument.values()].flat(), v.secrets))
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
function subtract(found: Problem[], earlier: Problem[]): Problem[] {
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
    `${where}This text is longer than ${maxDocumentBytes / 1024} KiB of UTF-8, the most a catalog document or proposal text may hold`,
    documentId,
  )
}

/** The problems of every document of one catalog, and the secret values found in them. */
class Validation {
  readonly byDocument = new Map<CatalogDocument, Problem[]>()
  readonly secrets: FoundSecret[] = []

  constructor(catalog: Catalog, context: ValidationContext) {
    const v = new Validator(catalog, context, this)
    for (const document of catalog.documents)
      this.byDocument.set(document, v.document(document))
  }

  secretProblem(
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
  private readonly names = new Map<string, CatalogDocument[]>()
  private readonly now: number

  constructor(
    private readonly catalog: Catalog,
    private readonly context: ValidationContext,
    private readonly validation: Validation,
  ) {
    this.now =
      typeof context.now === "number" ? context.now : context.now.getTime()
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

  document(document: CatalogDocument): Problem[] {
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
    for (const finding of secretsIn(document)) {
      this.validation.secrets.push({ ...finding, documentId: document.id })
      problems.push(this.validation.secretProblem(finding, document.id))
    }

    if (document.kind === "entity") this.entity(document, check, add, problems)
    else if (document.kind === "schema") this.schema(document, problems)
    else this.startHere(document, add)
    return problems
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

  get types() {
    return this.catalog.registry.types
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
        if (!this.v.types.has(type))
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
