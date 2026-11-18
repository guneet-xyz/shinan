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
    return anchor === "" ? null : { kind: "section", anchor }
  }
  // An entity reference has no scheme and does not start with `/`, `.` or
  // `?` (catalog §2.4); a `#section` part names a section of that page.
  if (/^[/.?]/.test(url)) return null
  const hash = url.indexOf("#")
  const id = decode(hash < 0 ? url : url.slice(0, hash))
  if (!/^[a-z0-9][a-z0-9/_.-]*$/.test(id) || !id.includes("/")) return null
  const anchor = hash < 0 ? null : decode(url.slice(hash + 1)) || null
  return { kind: "entity", id, anchor }
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
