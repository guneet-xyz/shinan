import { sameSitePath } from "@shinan/api-client"
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
 * send someone to another site. The rule is shared with the server
 * (`sameSitePath`).
 */
export function safeNextPath(
  next: string | null,
  origin: string = window.location.origin,
): string {
  if (!next) return "/"
  return sameSitePath(next, origin) ?? "/"
}
