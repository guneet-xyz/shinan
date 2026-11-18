import { RuleViolationError } from "../../errors.js"

/** Whitespace, the same characters in JavaScript and in PostgreSQL. */
export const spaces =
  " \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"

const spaceCodes = new Set<number>()
for (const [, from, to] of spaces.matchAll(/([\s\S])(?:-([\s\S]))?/gu))
  for (let c = from!.charCodeAt(0); c <= (to ?? from!).charCodeAt(0); c++)
    spaceCodes.add(c)
const lineBreaks = new Set([0x0a, 0x0d, 0x2028, 0x2029])

/**
 * The shortest word a line break may stand inside: keys, tokens and
 * addresses wrapped by an editor. Shorter words must be whole, so `abcd`
 * does not match `grab` and `cdrom` on two lines.
 */
export const longWord = 20

/** How long matching may take, in all, for one preview or purge. */
const matchingLimitMs = 15_000

/** One place a value holds the text: its span in the value. */
export interface PurgeMatch {
  start: number
  end: number
  /** Whether the span crosses a line break. */
  acrossLines: boolean
}

/**
 * A purge text as it is matched (catalog §9): exactly, except for
 * whitespace. Any run of whitespace in it matches any run of whitespace,
 * and a line break, with the whitespace around it, may stand inside one of
 * its long words (`longWord` characters or more), so text wrapped across
 * lines, indented, with other line endings, or a key split by an editor is
 * found too.
 *
 * Matching takes time linear in the value and the text: the value's
 * characters other than whitespace are searched for the text's (with the
 * Knuth-Morris-Pratt algorithm), and each place found is checked against
 * the whitespace around it with counts kept per position. All matching
 * for one preview or purge stops after `matchingLimitMs`.
 */
export class PurgeMatcher {
  /** The text's words, split at whitespace. */
  readonly words: string[]
  /** The text without whitespace. */
  private readonly pattern: string
  /** The words' positions in `pattern`, and whether each is long. */
  private readonly spans: { start: number; end: number; long: boolean }[]
  private readonly failure: Int32Array
  private spentMs = 0

  constructor(readonly text: string) {
    this.words = []
    let word = ""
    for (const c of text) {
      if (spaceCodes.has(c.charCodeAt(0))) {
        if (word !== "") this.words.push(word)
        word = ""
      } else word += c
    }
    if (word !== "") this.words.push(word)
    this.pattern = this.words.join("")
    this.spans = []
    let at = 0
    for (const w of this.words) {
      this.spans.push({
        start: at,
        end: at + w.length,
        long: [...w].length >= longWord,
      })
      at += w.length
    }
    // The Knuth-Morris-Pratt failure function of `pattern`.
    const p = this.pattern
    this.failure = new Int32Array(p.length)
    for (let i = 1, k = 0; i < p.length; i++) {
      while (k > 0 && p.charCodeAt(i) !== p.charCodeAt(k))
        k = this.failure[k - 1]!
      if (p.charCodeAt(i) === p.charCodeAt(k)) k++
      this.failure[i] = k
    }
  }

  /** Each place `value` holds the text, from the start, not overlapping. */
  matches(value: string): PurgeMatch[] {
    const started = performance.now()
    try {
      return this.search(value, started)
    } finally {
      this.spentMs += performance.now() - started
    }
  }

  private search(value: string, started: number): PurgeMatch[] {
    const p = this.pattern
    const m = p.length
    if (m === 0) return []
    // The value without whitespace: each character's place in the value,
    // and the whitespace before it: 0 none, 1 within a line, 2 a line break.
    const n = value.length
    const codes = new Uint16Array(n)
    const places = new Int32Array(n)
    // Running counts of gaps with whitespace, with whitespace within a
    // line only, and with a line break, up to each position.
    const spaced = new Int32Array(n + 1)
    const inline = new Int32Array(n + 1)
    const broken = new Int32Array(n + 1)
    let length = 0
    let run = 0
    for (let i = 0; i < n; i++) {
      const c = value.charCodeAt(i)
      if (spaceCodes.has(c)) {
        if (lineBreaks.has(c)) run = 2
        else if (run === 0) run = 1
        continue
      }
      const gap = length === 0 ? 0 : run
      codes[length] = c
      places[length] = i
      spaced[length + 1] = spaced[length]! + (gap > 0 ? 1 : 0)
      inline[length + 1] = inline[length]! + (gap === 1 ? 1 : 0)
      broken[length + 1] = broken[length]! + (gap === 2 ? 1 : 0)
      length++
      run = 0
    }
    // Gaps j..k-1 of the stripped value, as counts: gap j lies before
    // character j, counted at index j + 1.
    const count = (sums: Int32Array, from: number, to: number) =>
      to > from ? sums[to]! - sums[from]! : 0
    const gapAt = (j: number) =>
      count(broken, j, j + 1) > 0 ? 2 : count(spaced, j, j + 1) > 0 ? 1 : 0

    const fits = (at: number): boolean => {
      for (const span of this.spans) {
        // The gaps inside the word, between its first and last character.
        const from = at + span.start + 1
        const to = at + span.end
        if (
          span.long ? count(inline, from, to) > 0 : count(spaced, from, to) > 0
        )
          return false
        if (span.start > 0 && gapAt(at + span.start) === 0) return false
      }
      return true
    }

    const found: PurgeMatch[] = []
    let next = 0
    for (let j = 0, k = 0; j < length; j++) {
      if (
        (j & 0xffff) === 0 &&
        this.spentMs + performance.now() - started > matchingLimitMs
      )
        throw tooSlow()
      const c = codes[j]
      while (k > 0 && c !== p.charCodeAt(k)) k = this.failure[k - 1]!
      if (c === p.charCodeAt(k)) k++
      if (k < m) continue
      const at = j - m + 1
      k = this.failure[k - 1]!
      if (at < next || !fits(at)) continue
      found.push({
        start: places[at]!,
        end: places[j]! + 1,
        acrossLines: count(broken, at + 1, j + 1) > 0,
      })
      next = j + 1
    }
    return found
  }

  /** Whether `value` holds the text. */
  test(value: string): boolean {
    return this.matches(value).length > 0
  }

  /** Each place `value` holds the text: where it starts and what it covers. */
  find(value: string): { index: number; text: string }[] {
    return this.matches(value).map((m) => ({
      index: m.start,
      text: value.slice(m.start, m.end),
    }))
  }

  /**
   * `value` with every occurrence replaced by `marker`, again until none is
   * left: a replacement next to other text could complete a new one.
   */
  replace(value: string, marker: string): string {
    let result = value
    for (let pass = 0; ; pass++) {
      const found = this.matches(result)
      if (found.length === 0) return result
      if (pass === 10) throw new Error("Purging a text did not finish")
      let out = ""
      let from = 0
      for (const m of found) {
        out += result.slice(from, m.start) + marker
        from = m.end
      }
      result = out + result.slice(from)
    }
  }
}

function tooSlow(): RuleViolationError {
  return new RuleViolationError(
    "purge-too-slow",
    "Looking for this text took too long; purge a shorter part of it",
  )
}
