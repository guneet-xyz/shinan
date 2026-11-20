import type {
  CatalogDiscrepancy,
  CatalogEntity,
  CatalogFact,
} from "@shinan/api-client"

import { agoText, andList, countWord, factLabel, valueText } from "./format"

/** How a fact was known, for a disagreement's sentence. */
const stateVerb: Record<CatalogFact["state"], string> = {
  observed: "seen",
  intended: "written as should be",
  planned: "planned",
  unknown: "recorded as unknown",
}

/** The facts that disagree and are not accepted, by key. */
export function disagreeingKeys(entity: CatalogEntity): Set<string> {
  return new Set(
    entity.discrepancies.filter((d) => !d.accepted).map((d) => d.key),
  )
}

/** A fact's value as text, for sentences. */
function plainValue(fact: CatalogFact): string {
  return valueText(fact.value ?? fact.to)
}

/**
 * One disagreement as a sentence: "Two checks disagree about disk data
 * size: 128 GiB and 64 GB (both seen 5 days ago)."
 */
export function disagreementSentence(
  d: CatalogDiscrepancy,
  facts: readonly CatalogFact[],
): string {
  const sides = d.facts
    .map((identity) => facts.find((f) => f.identity === identity))
    .filter((f): f is CatalogFact => f !== undefined)
  const label = factLabel(d.key).toLocaleLowerCase()
  const count = Math.max(sides.length, d.values.length)
  const when = (f: CatalogFact) =>
    `${stateVerb[f.state]} ${
      f.freshness.age_days === null
        ? "without a date"
        : agoText(f.freshness.age_days)
    }`
  const start = `${countWord(count)} checks disagree about ${label}`
  if (sides.length === 0) return `${start}: ${andList(d.values)}.`
  const times = new Set(sides.map(when))
  if (times.size === 1) {
    const all = sides.length === 2 ? "both" : "all"
    return `${start}: ${andList(sides.map(plainValue))} (${all} ${[...times][0]}).`
  }
  return `${start}: ${andList(sides.map((f) => `${plainValue(f)} (${when(f)})`))}.`
}
