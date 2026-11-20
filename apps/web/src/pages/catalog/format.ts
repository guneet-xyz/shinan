import type {
  CatalogPusher,
  CatalogSearchResult,
  FactState,
  ScalarValue,
} from "@shinan/api-client"

/**
 * A page's title in a list (search results, Needs attention): a link that
 * looks like one without hovering, which a phone cannot do, with a quiet
 * underline (product review of #190).
 */
export const listLinkClass =
  "rounded-sm font-medium text-primary underline decoration-muted-foreground/40 underline-offset-4 outline-none hover:decoration-current focus-visible:ring-3 focus-visible:ring-ring"

/** An ID in an address, each part encoded, its slashes kept. */
function idPath(id: string): string {
  return id.split("/").map(encodeURIComponent).join("/")
}

/**
 * The catalog page a catalog ID names (an ID may hold `/`), such as
 * `…/catalog/p/machine/musashi`; type schema documents are pages too
 * (`…/p/schema/machine`); `start-here` is Start here.
 */
export function entityPath(workspaceId: string, id: string): string {
  if (id === "start-here") return catalogPath(workspaceId)
  return catalogPath(workspaceId, `/p/${idPath(id)}`)
}

/** A page's History: the changes of its file. */
export function historyPath(workspaceId: string, id: string): string {
  return catalogPath(workspaceId, `/history/${idPath(id)}`)
}

/** A page's View source: its file as it is. */
export function sourcePath(workspaceId: string, id: string): string {
  return catalogPath(workspaceId, `/source/${idPath(id)}`)
}

/** An address in a workspace's catalog, such as `/search`. */
export function catalogPath(workspaceId: string, path = ""): string {
  return `/w/${workspaceId}/catalog${path}`
}

/**
 * A fact's key as a label: dots, underscores and dashes become spaces, in
 * sentence case, so `disk.data.size` reads "Disk data size". The key
 * itself is in the page's source.
 */
export function factLabel(key: string): string {
  const words = key.replace(/[._-]+/g, " ").trim()
  return words.charAt(0).toLocaleUpperCase() + words.slice(1)
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

/** How long ago, in days, in words: "today", "5 days ago", "3 months ago". */
export function agoText(days: number): string {
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 60) return `${days} days ago`
  if (days < 730) return `${Math.round(days / 30.44)} months ago`
  return `${Math.round(days / 365.25)} years ago`
}

/** An age in words, such as "checked 3 days ago". */
export function ageText(days: number): string {
  return `checked ${agoText(days)}`
}

/**
 * When something happened, in words, from an ISO time: "just now",
 * "12 minutes ago", "2 hours ago", then as `agoText`.
 */
export function relativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60)
    return minutes === 1 ? "a minute ago" : `${minutes} minutes ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`
  return agoText(daysSince(iso, now))
}

/**
 * Who checked a fact, as its check's `by` says (agent-written text such as
 * `guneet via opencode-daedalus`), with "via" in words: "guneet, through
 * opencode-daedalus". Real names come with the push log (GC-3a).
 */
export function byText(by: string): string {
  return by.replace(/^(\S+) via (\S+)$/, "$1, through $2")
}

/**
 * Who first pushed a change, as people read it: "Guneet, through OpenCode
 * on Daedalus", or "Shinan" for a change Shinan made itself.
 */
export function pusherText(pusher: CatalogPusher): string {
  return pusher.kind === "shinan"
    ? "Shinan"
    : `${pusher.person}, through ${pusher.agent}`
}

/** Values in a sentence: "a", "a and b", "a, b and c". */
export function andList(values: readonly string[]): string {
  if (values.length <= 1) return values.join("")
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`
}

/** A count as a word at the start of a sentence: "Two", "Three", … "12". */
export function countWord(count: number): string {
  const words = [
    "No",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
  ]
  return words[count] ?? String(count)
}

/** Days from an ISO time to now, in whole days. */
export function daysSince(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 86_400_000))
}

export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`
}

export function valueText(value: ScalarValue | undefined): string {
  if (value === undefined) return ""
  return value === null ? "null" : String(value)
}

/** An `http:` or `https:` address, which the catalog may link to. */
export function isWebAddress(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim())
}

/**
 * One line of a search result: the best matching section's words, else
 * the page's summary, without Markdown's marks, cut at about 160
 * characters.
 */
export function snippet(result: CatalogSearchResult): string {
  const section = result.sections[0]
  const text = section
    ? section.text
        .split("\n")
        .filter((line, i) => !(i === 0 && /^#{1,6}\s/.test(line)))
        .join(" ")
    : (result.entity.summary ?? "")
  const plain = text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#|~]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
  return plain.length > 160 ? `${plain.slice(0, 159).trimEnd()}…` : plain
}
