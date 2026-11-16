/**
 * Where the sign-in layer may send a browser after signing in: a path on
 * this site. The value is checked exactly as it was received and never
 * decoded again: `/%2f/evil.example` stays a same-site path, but a decoded
 * copy would not.
 */
export function isSafeReturnPath(value: unknown, base: string): boolean {
  if (typeof value !== "string" || value.length > 2048) return false
  if (!value.startsWith("/") || value.startsWith("//")) return false
  // Browsers treat a backslash as a slash and drop tabs and newlines.
  if (value.includes("\\") || hasControlCharacter(value)) return false
  try {
    const origin = new URL(base).origin
    return new URL(value, origin).origin === origin
  } catch {
    return false
  }
}

/** The sign-in page, as the place failed sign-ins land (`?error=…`). */
export function signInErrorPath(next: string | undefined): string {
  return next && next !== "/"
    ? `/sign-in?next=${encodeURIComponent(next)}`
    : "/sign-in"
}

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}
