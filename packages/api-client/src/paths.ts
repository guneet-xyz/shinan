/**
 * The one rule for where Shinan may send a browser after sign-in, shared by
 * the web app and the server: a path on this site. The value is resolved
 * the way a browser would (which drops tabs and newlines and reads `\` as
 * `/`) and kept only if it stays on `origin`. The resolved path must start
 * with exactly one `/`: a path such as `/.//evil.example` resolves to
 * `//evil.example`, which a browser would read as another host. Returns the
 * resolved path, or null.
 */
export function sameSitePath(value: string, origin: string): string | null {
  let url: URL
  try {
    url = new URL(value, origin)
  } catch {
    return null
  }
  if (url.origin !== origin) return null
  const path = url.pathname + url.search + url.hash
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.startsWith("/\\")
  ) {
    return null
  }
  // Read again, it must still stay on this origin.
  if (new URL(path, origin).origin !== origin) return null
  return path
}
