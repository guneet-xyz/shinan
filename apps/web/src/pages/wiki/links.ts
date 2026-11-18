/*
 * Which link destinations in catalog Markdown the wiki follows (security
 * checklist 10.3): web and mail addresses, entity references (catalog
 * §2.4) and sections of the page. Everything else is shown as text.
 */

/** Where a destination leads, or null when it is not followed. */
export type LinkTarget =
  | { kind: "external"; href: string }
  | { kind: "entity"; id: string; anchor: string | null }
  | { kind: "section"; anchor: string }

const scheme = /^([a-z][a-z0-9+.-]*):/i

/**
 * An entity or type schema ID (catalog §2.4; `ids.ts` in core): a type and
 * a slug, both lowercase kebab-case. Nothing else, so no `.` or `..`
 * segment, empty segment or extra `/` can make a link leave the wiki.
 * Besides entities, it names type schema documents (`schema/<type>`), and
 * `start-here` is the one ID without a type; `entityPath` leads each to
 * its own page.
 */
const entityId = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/

/** A section anchor as the body reader makes them (`AnchorMaker` in core). */
const sectionAnchor = /^[\p{L}\p{N}\p{M}_-]+$/u

export function linkTarget(destination: string): LinkTarget | null {
  const url = destination.trim()
  if (url === "") return null
  const match = scheme.exec(url)
  if (match) {
    const name = match[1]!.toLowerCase()
    return name === "http" || name === "https" || name === "mailto"
      ? { kind: "external", href: url }
      : null
  }
  if (url.startsWith("#")) {
    const anchor = decode(url.slice(1))
    return sectionAnchor.test(anchor) ? { kind: "section", anchor } : null
  }
  // An entity reference is an ID, optionally with a `#section` part naming
  // a section of that page (catalog §2.4).
  const hash = url.indexOf("#")
  const id = hash < 0 ? url : url.slice(0, hash)
  // The start-here document is the one catalog ID without a type.
  if (!entityId.test(id) && id !== "start-here") return null
  if (hash < 0) return { kind: "entity", id, anchor: null }
  const anchor = decode(url.slice(hash + 1))
  if (anchor === "") return { kind: "entity", id, anchor: null }
  return sectionAnchor.test(anchor) ? { kind: "entity", id, anchor } : null
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** The element ID of a body section, kept apart from the app's own IDs. */
export function sectionElementId(anchor: string): string {
  return `section-${anchor}`
}
