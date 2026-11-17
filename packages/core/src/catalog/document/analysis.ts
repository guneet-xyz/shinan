import { dayMillis } from "./dates.js"
import type { Fact, ResolvedEntity } from "./entity.js"
import { canonicalValue } from "./identity.js"

/**
 * A discrepancy (catalog §4.7): a single-valued key with two or more current
 * `intended` or `observed` facts whose values differ. Every such fact of the
 * key is part of it, so both sides' evidence is shown.
 */
export interface Discrepancy {
  key: string
  facts: Fact[]
  /** The distinct values, as text. */
  values: string[]
  /**
   * Whether the difference has been accepted: every fact in it names, with
   * `accepted`, the person who accepted it (and says why in its `note`). An
   * accepted discrepancy stays visible but is not flagged as needing
   * attention. A new fact in it (for example a recheck) needs accepting again.
   */
  accepted: boolean
}

/** The value a fact compares by: its value, or a relation's target and identifying attributes. */
export function comparableValue(fact: Fact): string {
  if (fact.schema.relation) {
    const attributes = fact.schema.relation.identifiedBy.map((a) => {
      const v = fact.attributes[a]
      return v === undefined ? "" : `${a}=${canonicalValue(v)}`
    })
    return [fact.to ?? "", ...attributes].filter((p) => p !== "").join(" ")
  }
  return fact.value === undefined ? "" : canonicalValue(fact.value)
}

export function discrepancies(entity: ResolvedEntity): Discrepancy[] {
  const byKey = new Map<string, Fact[]>()
  for (const fact of entity.facts) {
    if (fact.schema.many) continue
    if (fact.state !== "intended" && fact.state !== "observed") continue
    const list = byKey.get(fact.key) ?? []
    list.push(fact)
    byKey.set(fact.key, list)
  }
  const found: Discrepancy[] = []
  for (const [key, facts] of byKey) {
    const values = [...new Set(facts.map(comparableValue))]
    if (values.length < 2) continue
    found.push({
      key,
      facts,
      values,
      accepted: facts.every((f) => f.accepted !== undefined),
    })
  }
  return found
}

/** Facts written as `unknown`, deliberately (catalog §4.8). */
export function knownUnknowns(entity: ResolvedEntity): Fact[] {
  return entity.facts.filter((f) => f.state === "unknown")
}

export interface NotYetRecorded {
  /** Required keys of the type schema the entity does not mention at all, in any state. */
  missingKeys: string[]
  /** Facts whose fact check says `checked: null`: imported, never checked. */
  notChecked: Fact[]
}

/** The quieter list of catalog §4.8, kept apart from known unknowns. */
export function notYetRecorded(entity: ResolvedEntity): NotYetRecorded {
  const mentioned = new Set(entity.facts.map((f) => f.key))
  return {
    missingKeys: (entity.schema?.required ?? []).filter(
      (k) => !mentioned.has(k),
    ),
    notChecked: entity.facts.filter((f) => f.check?.checked === null),
  }
}

/**
 * How fresh a fact is, computed when read and never stored (catalog §4.6,
 * §12.2). A risk signal, not a verdict.
 *
 * - `none`: a `planned` fact, which has no freshness;
 * - `not-checked`: no fact check, or `checked: null`;
 * - `due`: the key has a recheck interval and it has passed;
 * - `fresh`: otherwise.
 */
export interface Freshness {
  status: "none" | "not-checked" | "fresh" | "due"
  /** When it was last checked (milliseconds since 1970). For a date, the start of that day in UTC. */
  checkedAt: number | null
  /** Whole days since it was checked. */
  ageDays: number | null
  recheckDays: number | null
  /** When it becomes due for recheck, if its key has an interval. */
  dueAt: number | null
}

export function freshness(fact: Fact, now: Date | number): Freshness {
  const at = typeof now === "number" ? now : now.getTime()
  const recheckDays = fact.schema.recheckDays
  const checked = fact.check?.checked
  if (fact.state === "planned")
    return {
      status: "none",
      checkedAt: null,
      ageDays: null,
      recheckDays,
      dueAt: null,
    }
  if (!checked)
    return {
      status: "not-checked",
      checkedAt: null,
      ageDays: null,
      recheckDays,
      dueAt: null,
    }
  const dueAt =
    recheckDays === null ? null : checked.at + recheckDays * dayMillis
  return {
    status: dueAt !== null && at >= dueAt ? "due" : "fresh",
    checkedAt: checked.at,
    ageDays: Math.max(0, Math.floor((at - checked.at) / dayMillis)),
    recheckDays,
    dueAt,
  }
}
