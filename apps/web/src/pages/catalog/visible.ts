/**
 * Characters that change how text looks, or are not seen at all: every
 * control and format character (Unicode categories Cc and Cf, which include
 * bidirectional overrides and isolates, zero-width characters, the soft
 * hyphen, the byte-order mark and the tag characters U+E0000–U+E007F), the
 * line and paragraph separators (Zl, Zp), and characters that draw as
 * blank: the combining grapheme joiner, the Mongolian vowel separator,
 * variation selectors, Hangul fillers and the braille blank. Line breaks,
 * carriage returns and tabs are text as usual.
 */
const hidden =
  /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u00ad\u180e\u115f\u1160\u3164\uffa0\u2800]|\u034f|[\ufe00-\ufe0f]|[\u{e0100}-\u{e01ef}]/gu

const ordinary = new Set(["\n", "\r", "\t"])

/** The marker `visible` puts in place of a hidden character, such as `⟨U+202E⟩`. */
export function marker(c: string): string {
  return `⟨U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}⟩`
}

/**
 * Text written by agents, as the catalog shows it in commit messages,
 * branch and file names: every hidden character as a visible marker such
 * as `⟨U+202E⟩`, so the text cannot disguise what it says (a right-to-left
 * override can make `gnp.exe` read as `exe.png`) or carry words a person
 * cannot see but an agent reads (tag characters). In a name
 * (`oneLine`), line breaks and tabs are marked too: a name has none.
 */
export function visible(
  text: string,
  options: { oneLine?: boolean } = {},
): string {
  return text.replace(hidden, (c) =>
    ordinary.has(c) && !options.oneLine ? c : marker(c),
  )
}

/** Whether text holds any character `visible` marks. */
export function hasHidden(
  text: string,
  options: { oneLine?: boolean } = {},
): boolean {
  for (const match of text.matchAll(hidden))
    if (options.oneLine || !ordinary.has(match[0])) return true
  return false
}

/** A hidden character, as `visibleParts` gives it. */
export interface HiddenCharacter {
  marker: string
  /** Its name in words, such as "right-to-left override". */
  name: string
}

/**
 * Text split where `visible` would put markers: plain runs as strings, each
 * hidden character with its marker and name, so a page can show the name on
 * hover and to screen readers.
 */
export function visibleParts(
  text: string,
  options: { oneLine?: boolean } = {},
): (string | HiddenCharacter)[] {
  const parts: (string | HiddenCharacter)[] = []
  let from = 0
  for (const match of text.matchAll(hidden)) {
    const c = match[0]
    if (ordinary.has(c) && !options.oneLine) continue
    if (match.index > from) parts.push(text.slice(from, match.index))
    parts.push({ marker: marker(c), name: hiddenName(c) })
    from = match.index + c.length
  }
  if (from < text.length) parts.push(text.slice(from))
  return parts
}

const names: Record<number, string> = {
  0x09: "tab",
  0x0a: "line break",
  0x0d: "carriage return",
  0xad: "soft hyphen",
  0x34f: "combining grapheme joiner",
  0x61c: "Arabic letter mark",
  0x115f: "Hangul filler",
  0x1160: "Hangul filler",
  0x180e: "Mongolian vowel separator",
  0x200b: "zero-width space",
  0x200c: "zero-width non-joiner",
  0x200d: "zero-width joiner",
  0x200e: "left-to-right mark",
  0x200f: "right-to-left mark",
  0x2028: "line separator",
  0x2029: "paragraph separator",
  0x202a: "left-to-right embedding",
  0x202b: "right-to-left embedding",
  0x202c: "pop directional formatting",
  0x202d: "left-to-right override",
  0x202e: "right-to-left override",
  0x2060: "word joiner",
  0x2066: "left-to-right isolate",
  0x2067: "right-to-left isolate",
  0x2068: "first strong isolate",
  0x2069: "pop directional isolate",
  0x2800: "braille blank",
  0x3164: "Hangul filler",
  0xfeff: "zero-width no-break space",
  0xffa0: "Hangul filler",
}

/** A hidden character's name in words, for people and screen readers. */
export function hiddenName(c: string): string {
  const code = c.codePointAt(0)!
  const named = names[code]
  if (named) return named
  if (
    (code >= 0xfe00 && code <= 0xfe0f) ||
    (code >= 0xe0100 && code <= 0xe01ef)
  )
    return "variation selector"
  if (code >= 0xe0000 && code <= 0xe007f) return "tag character"
  if (code >= 0x2061 && code <= 0x2064) return "invisible operator"
  if (/\p{Cc}/u.test(c)) return "control character"
  return "invisible formatting character"
}
