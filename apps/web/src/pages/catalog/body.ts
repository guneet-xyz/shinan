import type { CatalogSection } from "@shinan/api-client"

/** A page's body as the page renders it, after its title and facts. */
export interface PageBody {
  text: string
  /** The anchors of the headings left, in order. */
  anchors: (string | null)[]
  /** Added to each heading's level, so the body's top headings are `h2`. */
  headingOffset: number
}

const loose = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase()

/**
 * The body without a first heading that repeats the page's title (product
 * brief on #169: "Musashi" appeared twice), with its top headings at the
 * level of the page's own sections. Null when nothing is left to show.
 */
export function pageBody(
  sections: readonly CatalogSection[],
  title: string | null,
): PageBody | null {
  const kept = [...sections]
  const first = kept.findIndex((s) => s.heading !== null)
  const before = kept.slice(0, Math.max(first, 0))
  if (
    first >= 0 &&
    title !== null &&
    before.every((s) => s.text.trim() === "") &&
    loose(kept[first]!.heading!) === loose(title)
  ) {
    const section = kept[first]!
    // The heading's line: an ATX heading's one line, or a setext heading's
    // text and its underline.
    const lines = section.text.split("\n")
    const drop = /^ {0,3}(=+|-+)\s*$/.test(lines[1] ?? "") ? 2 : 1
    kept[first] = {
      ...section,
      heading: null,
      anchor: null,
      text: lines.slice(drop).join("\n"),
    }
  }
  const text = kept.map((s) => s.text).join("")
  if (text.trim() === "") return null
  const headings = kept.filter((s) => s.heading !== null)
  const top = Math.min(...headings.map((s) => s.level), 2)
  return {
    text,
    anchors: headings.map((s) => s.anchor),
    headingOffset: Math.max(0, 2 - top),
  }
}
