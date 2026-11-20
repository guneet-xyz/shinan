import type {
  CatalogFact,
  CatalogFreshnessSummary,
  FactState,
  ScalarValue,
} from "@shinan/api-client"

/**
 * The wiki page a catalog ID names (an ID may hold `/`): an entity's page;
 * for a type schema document (`schema/<type>`) its type's page; for
 * `start-here`, Start here.
 */
export function entityPath(workspaceId: string, id: string): string {
  if (id === "start-here") return `/w/${workspaceId}/wiki/start-here`
  const type = /^schema\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/.exec(id)?.[1]
  if (type) return `/w/${workspaceId}/wiki/types/${type}`
  return `/w/${workspaceId}/wiki/e/${id.split("/").map(encodeURIComponent).join("/")}`
}

export function wikiPath(workspaceId: string, path = ""): string {
  return `/w/${workspaceId}/wiki${path}`
}

/**
 * Fact states in words (human experience, how freshness is shown):
 * intended "should be", observed "seen", planned and unknown as they are.
 */
export const stateLabels: Record<FactState, string> = {
  intended: "should be",
  observed: "seen",
  planned: "planned",
  unknown: "unknown",
}

/** An age in words, such as "checked 3 days ago". */
export function ageText(days: number): string {
  if (days <= 0) return "checked today"
  if (days === 1) return "checked yesterday"
  if (days < 60) return `checked ${days} days ago`
  if (days < 730) return `checked ${Math.round(days / 30.44)} months ago`
  return `checked ${Math.round(days / 365.25)} years ago`
}

/** Days from an ISO time to now, in whole days. */
export function daysSince(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 86_400_000))
}

/**
 * An entity's freshness summary from its facts, as the server computes it
 * for type indexes: how many facts, the oldest last checked, how many due,
 * how many never checked, how many unknown.
 */
export function freshnessSummary(
  facts: readonly CatalogFact[],
  now = Date.now(),
): CatalogFreshnessSummary {
  let oldest: number | null = null
  let due = 0
  let notChecked = 0
  let unknown = 0
  for (const fact of facts) {
    if (fact.state === "unknown") unknown++
    if (fact.freshness.status === "due") due++
    if (fact.freshness.status === "not-checked") notChecked++
    if (fact.freshness.age_days !== null) {
      const at = now - fact.freshness.age_days * 86_400_000
      oldest = oldest === null ? at : Math.min(oldest, at)
    }
  }
  return {
    facts: facts.length,
    oldest_checked_at: oldest === null ? null : new Date(oldest).toISOString(),
    due,
    not_checked: notChecked,
    unknown,
  }
}

/** The summary as one line. */
export function summaryParts(
  summary: CatalogFreshnessSummary,
  now = Date.now(),
): string[] {
  const parts = [plural(summary.facts, "fact")]
  if (summary.oldest_checked_at)
    parts.push(`oldest ${ageText(daysSince(summary.oldest_checked_at, now))}`)
  if (summary.due > 0) parts.push(`${summary.due} due for recheck`)
  if (summary.not_checked > 0)
    parts.push(`${summary.not_checked} never checked`)
  if (summary.unknown > 0) parts.push(`${summary.unknown} unknown`)
  return parts
}

export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`
}

export function valueText(value: ScalarValue | undefined): string {
  if (value === undefined) return ""
  return value === null ? "null" : String(value)
}

/** An `http:` or `https:` address, which the wiki may link to. */
export function isWebAddress(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim())
}
