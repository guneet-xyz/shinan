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
    ordinary.has(c) && !options.oneLine
      ? c
      : `⟨U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}⟩`,
  )
}

/** Whether text holds any character `visible` marks. */
export function hasHidden(text: string): boolean {
  for (const match of text.matchAll(hidden))
    if (!ordinary.has(match[0])) return true
  return false
}
