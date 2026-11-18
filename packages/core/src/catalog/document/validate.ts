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
import { blocking, warning } from "./problems.js"
import type { Problem, ProblemCode } from "./problems.js"
import { anyTarget, taskTarget } from "./schemas.js"
import { findSecrets } from "./secrets.js"
import type { Range } from "./source.js"

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
 * Validates a change: every problem in the documents it writes, and any new
 * problem it causes in documents it does not write (for example a reference
 * it breaks). A type schema change that adds problems to entities of its
 * type is blocked and lists them (catalog §3.9).
 */
export function validateChange(
  change: Change,
  context: ValidationContext,
): ValidationResult {
  const after = problemsByDocument(change.after, context)
  const before = change.before
    ? problemsByDocument(change.before, context)
    : new Map<CatalogDocument, Problem[]>()
  const beforeById = new Map<string, Problem[]>()
  for (const [document, problems] of before)
    if (document.id !== null && !beforeById.has(document.id))
      beforeById.set(document.id, problems)

  const changed = new Set(change.changed)
  const problems: Problem[] = []
  const broken = new Map<string, string[]>()
  for (const [document, found] of after) {
    if (changed.has(document)) {
      problems.push(...found)
      continue
    }
    const caused = subtract(found, beforeById.get(document.id ?? "") ?? [])
    problems.push(...caused)
    if (caused.length > 0 && document.kind === "entity" && document.type) {
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

  for (const { label, text } of change.texts ?? [])
    for (const finding of findSecrets(text))
      problems.push(secretProblem(finding, null, `${label}: `))

  return result(problems)
}

/** Validates every document of a catalog, as if all were new. */
export function validateCatalog(
  catalog: Catalog,
  context: ValidationContext,
): ValidationResult {
  return result([...problemsByDocument(catalog, context).values()].flat())
}

function result(problems: Problem[]): ValidationResult {
  return {
    problems,
    blocked: problems.some((p) => p.severity === "blocking"),
    needsApproval: problems.some((p) => p.severity === "warning"),
  }
}

/** The problems of `found` that `earlier` does not have, counting repeats. */
function subtract(found: Problem[], earlier: Problem[]): Problem[] {
  const counts = new Map<string, number>()
  const key = (p: Problem) => `${p.code}\u0000${p.severity}\u0000${p.message}`
  for (const p of earlier) counts.set(key(p), (counts.get(key(p)) ?? 0) + 1)
  return found.filter((p) => {
    const n = counts.get(key(p)) ?? 0
    if (n === 0) return true
    counts.set(key(p), n - 1)
    return false
  })
}

function problemsByDocument(
  catalog: Catalog,
  context: ValidationContext,
): Map<CatalogDocument, Problem[]> {
  const v = new Validator(catalog, context)
  const all = new Map<CatalogDocument, Problem[]>()
  for (const document of catalog.documents)
    all.set(document, v.document(document))
  return all
}

/** Task statuses (tasks §7.2), which never belong in catalog facts. */
const taskStatuses = new Set([
  "triage",
  "to do",
  "todo",
  "in progress",
  "in review",
  "verifying",
  "done",
  "cancelled",
  "canceled",
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
    for (const finding of findSecrets(document.text))
      problems.push(secretProblem(finding, document.id))

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
          `"${canonicalValue(fact.value)}" is a task status; task status stays on tasks, not in the catalog`,
          fact.valueRange,
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
          `The link to "${link.reference}" does not name an entity in this catalog`,
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

function secretProblem(
  finding: ReturnType<typeof findSecrets>[number],
  documentId: string | null,
  where = "",
): Problem {
  return finding.severity === "blocking"
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
}
