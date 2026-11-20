/**
 * Names that break a checkout on Windows or macOS although Git accepts
 * them (#165, from the review of GC-1b): refused on every branch, so every
 * agent can clone every workspace's catalog.
 */

/** Windows' reserved device names, with or without an extension, in any case. */
const reserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

/** Characters Windows does not allow in a name, and control characters. */
// eslint-disable-next-line no-control-regex
const forbidden = /[<>:"|?*\\\u0000-\u001f]/

/** The longest name (one part of a path), in bytes, as most file systems allow. */
export const maxNameBytes = 255

/**
 * Why `name` (one entry of a folder, as its bytes) cannot be checked out
 * everywhere, or null if it can.
 */
export function nameProblem(name: Buffer): string | null {
  const text = name.toString("utf8")
  if (!Buffer.from(text, "utf8").equals(name)) return "is not UTF-8"
  if (name.length > maxNameBytes) {
    return `is longer than ${maxNameBytes} bytes`
  }
  if (forbidden.test(text)) {
    return 'holds a character Windows does not allow (< > : " | ? * \\ or a control character)'
  }
  if (/[. ]$/.test(text)) return "ends with a dot or a space"
  if (text.startsWith(" ")) return "starts with a space"
  if (reserved.test(text)) return "is a name Windows reserves"
  return null
}

/** The form under which Windows and macOS see two names as one. */
export function foldedName(name: string): string {
  return name.normalize("NFC").toLowerCase()
}

/**
 * Pairs of names in one folder that Windows or macOS would see as one: the
 * same but for letter case, or for Unicode normalisation (NFC and NFD).
 */
export function clashingNames(names: readonly string[]): [string, string][] {
  const seen = new Map<string, string>()
  const clashes: [string, string][] = []
  for (const name of names) {
    const key = foldedName(name)
    const other = seen.get(key)
    if (other === undefined) seen.set(key, name)
    else clashes.push([other, name])
  }
  return clashes
}
