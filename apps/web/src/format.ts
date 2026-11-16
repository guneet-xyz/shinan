import type { Role } from "@shinan/api-client"

export const roleNames: Record<Role, string> = {
  owner: "Workspace owner",
  contributor: "Contributor",
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })
const timeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso))
}

export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso))
}

/**
 * Only same-site paths are followed after sign-in, so a crafted link cannot
 * send someone to another site. The value is parsed the way a browser would
 * (which drops tabs and newlines and reads `\` as `/`), then kept only if it
 * stays on this origin.
 */
export function safeNextPath(
  next: string | null,
  origin: string = window.location.origin,
): string {
  if (!next) return "/"
  let url: URL
  try {
    url = new URL(next, origin)
  } catch {
    return "/"
  }
  if (url.origin !== origin) return "/"
  const path = url.pathname + url.search + url.hash
  // The parser's normalised path can itself start with `//` (for example
  // from `/.//evil.example`), which a browser would read as another host.
  // Keep only a path with exactly one leading slash that, read again, still
  // stays on this origin.
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.startsWith("/\\")
  ) {
    return "/"
  }
  if (new URL(path, origin).origin !== origin) return "/"
  return path
}
