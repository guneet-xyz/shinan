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
 * send someone to another site.
 */
export function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/"
  if (next.startsWith("/\\")) return "/"
  return next
}
