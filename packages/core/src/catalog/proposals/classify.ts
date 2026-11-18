import { resolveEntity } from "../document/index.js"
import type {
  Catalog,
  CatalogDocument,
  DocumentChange,
  EntityDocument,
  Fact,
  Problem,
} from "../document/index.js"

/**
 * The approval classes of catalog §8.2, in the order of its table. The
 * last four are gated: a proposal in any of them needs catalog approval.
 */
export const approvalClasses = [
  "recheck",
  "observed-or-unknown",
  "intended",
  "planned",
  "body-and-bookkeeping",
  "rules",
  "lifecycle",
  "people-and-agents",
  "doubtful",
] as const
export type ApprovalClass = (typeof approvalClasses)[number]

export const gatedClasses: readonly ApprovalClass[] = [
  "rules",
  "lifecycle",
  "people-and-agents",
  "doubtful",
]

export interface Classification {
  /** Every class the change is in, in the order of catalog §8.2. */
  classes: ApprovalClass[]
  /** Why it is in each gated class, for the reviewer (catalog §8.2, §8.3). */
  reasons: string[]
  /** The `person` entities that new `accepted` fields name (catalog §4.7). */
  accepts: string[]
}

/**
 * Sorts a change into the approval classes of catalog §8.2, from the
 * documents it writes, before and after, never from its operations: the
 * Markdown is what applies (catalog §2.1). Validation warnings make it
 * doubtful (catalog §8.3).
 */
export function classifyChange(
  before: Catalog,
  after: Catalog,
  changes: readonly DocumentChange[],
  warnings: readonly Problem[],
): Classification {
  const classes = new Set<ApprovalClass>()
  const reasons: string[] = []
  const accepts: string[] = []
  const gate = (kind: ApprovalClass, reason: string) => {
    classes.add(kind)
    reasons.push(reason)
  }
  for (const { before: was, after: now } of changes) {
    const name = now.id ?? was?.id ?? "a document"
    if (now.kind === "schema" || was?.kind === "schema") {
      gate(
        "rules",
        `${was ? "Changes" : "Creates"} the type schema document ${name}`,
      )
      continue
    }
    if (now.kind === "start-here" || was?.kind === "start-here") {
      gate("rules", "Changes the start-here document")
      continue
    }
    const entity = now
    const earlier = was
    const types = new Set([entity.type, earlier?.type])
    if (types.has("person") || types.has("agent"))
      gate(
        "people-and-agents",
        `Changes the ${[...types].filter((t) => t === "person" || t === "agent").join(" and ")} entity ${name}`,
      )
    if (types.has("policy"))
      gate("rules", `${earlier ? "Changes" : "Creates"} the policy ${name}`)
    if (decisionSettled(earlier, entity))
      gate(
        "rules",
        `Records the decision ${name} as ${entity.decision?.state ?? earlier?.decision?.state}`,
      )
    if ((earlier?.status ?? "active") !== (entity.status ?? "active"))
      gate(
        "lifecycle",
        `Changes the status of ${name} from ${earlier?.status ?? "active"} to ${entity.status ?? "active"}`,
      )
    if (earlier && earlier.id !== entity.id)
      gate("lifecycle", `Changes the ID ${earlier.id} to ${entity.id}`)
    if (earlier && earlier.owner !== entity.owner)
      gate(
        "lifecycle",
        `Changes the owner of ${name} from ${earlier.owner ?? "none"} to ${entity.owner ?? "none"}`,
      )
    if (
      earlier &&
      (earlier.replacedBy !== entity.replacedBy ||
        earlier.aliases.join("\n") !== entity.aliases.join("\n")) &&
      earlier.id === entity.id
    )
      gate("lifecycle", `Changes the aliases or replacement of ${name}`)
    if (
      !earlier ||
      earlier.title !== entity.title ||
      earlier.summary !== entity.summary ||
      earlier.body.text !== entity.body.text
    )
      classes.add("body-and-bookkeeping")

    const factClasses = compareFacts(
      earlier ? resolveEntity(earlier, before.registry).facts : [],
      resolveEntity(entity, after.registry).facts,
    )
    for (const kind of factClasses.classes) classes.add(kind)
    accepts.push(...factClasses.accepts)
    if (factClasses.accepts.length > 0)
      gate("doubtful", `Accepts a discrepancy on ${name}`)
  }
  for (const problem of warnings)
    gate(
      "doubtful",
      problem.documentId
        ? `${problem.documentId}: ${problem.message}`
        : problem.message,
    )
  if (classes.size === 0) classes.add("body-and-bookkeeping")
  return {
    classes: approvalClasses.filter((c) => classes.has(c)),
    reasons,
    accepts: [...new Set(accepts)],
  }
}

/** Whether a change needs catalog approval: it is in a gated class. */
export function isGated(classes: readonly ApprovalClass[]): boolean {
  return classes.some((c) => gatedClasses.includes(c))
}

const settledStates = new Set(["accepted", "rejected", "superseded"])

/** A decision becoming, or changed while, accepted, rejected or superseded. */
function decisionSettled(
  was: EntityDocument | null,
  now: EntityDocument,
): boolean {
  if (now.type !== "decision" && was?.type !== "decision") return false
  const a = was?.decision ?? null
  const b = now.decision
  const changed =
    a?.state !== b?.state ||
    a?.decidedBy !== b?.decidedBy ||
    a?.decidedOn?.text !== b?.decidedOn?.text
  return (
    changed &&
    (settledStates.has(a?.state ?? "") || settledStates.has(b?.state ?? ""))
  )
}

/**
 * Compares an entity's current facts, before and after, by identity. A fact
 * whose value and other content stay and only its fact check changes is a
 * recheck; any other change is in the class of its fact state.
 */
function compareFacts(
  before: readonly Fact[],
  after: readonly Fact[],
): { classes: Set<ApprovalClass>; accepts: string[] } {
  const classes = new Set<ApprovalClass>()
  const accepts: string[] = []
  const byIdentity = (facts: readonly Fact[]) => {
    const map = new Map<string, Fact[]>()
    for (const fact of facts) {
      const list = map.get(fact.identity) ?? []
      list.push(fact)
      map.set(fact.identity, list)
    }
    return map
  }
  const was = byIdentity(before)
  const now = byIdentity(after)
  for (const identity of new Set([...was.keys(), ...now.keys()])) {
    const a = was.get(identity) ?? []
    const b = now.get(identity) ?? []
    const acceptedBefore = new Set(a.map((f) => f.accepted))
    for (const fact of b)
      if (fact.accepted !== undefined && !acceptedBefore.has(fact.accepted))
        accepts.push(fact.accepted)
    const content = (facts: Fact[]) => facts.map(contentOf).sort().join("\n")
    const whole = (facts: Fact[]) =>
      facts
        .map((f) => `${contentOf(f)}\n${checkOf(f)}\n${f.accepted ?? ""}`)
        .sort()
        .join("\n\n")
    if (whole(a) === whole(b)) continue
    if (content(a) === content(b)) {
      if (a.map(checkOf).sort().join() !== b.map(checkOf).sort().join())
        classes.add("recheck")
      continue
    }
    for (const fact of [...a, ...b]) classes.add(stateClass(fact.state))
  }
  return { classes, accepts }
}

function stateClass(state: Fact["state"]): ApprovalClass {
  switch (state) {
    case "planned":
      return "planned"
    case "intended":
      return "intended"
    default:
      return "observed-or-unknown"
  }
}

/** A fact's content without its fact check or acceptance. */
function contentOf(fact: Fact): string {
  return JSON.stringify([
    fact.value ?? null,
    fact.to ?? null,
    fact.via ?? null,
    fact.note ?? null,
    fact.task ?? null,
    fact.remove,
    Object.entries(fact.attributes).sort(([x], [y]) => (x < y ? -1 : 1)),
  ])
}

function checkOf(fact: Fact): string {
  const check = fact.check
  if (!check) return "null"
  return JSON.stringify([
    check.checked === null ? null : (check.checked?.text ?? null),
    check.by ?? null,
    check.scope ?? null,
    check.source ?? null,
    check.limits ?? null,
  ])
}

/** The catalog IDs a change touches, before and after, for showing pending proposals on entities. */
export function touchedIds(changes: readonly DocumentChange[]): string[] {
  const ids = new Set<string>()
  const add = (document: CatalogDocument | null) => {
    if (document?.id) ids.add(document.id)
  }
  for (const change of changes) {
    add(change.before)
    add(change.after)
  }
  return [...ids].sort()
}
