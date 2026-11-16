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
  return url.pathname + url.search + url.hash
}
