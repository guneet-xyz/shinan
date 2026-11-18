import { describe, expect, it } from "vitest"

import { PurgeMatcher } from "./matcher.js"

const marker = "(purged)"

/** Runs `run` and says how long it took, in milliseconds. */
function timed<T>(run: () => T): [T, number] {
  const started = performance.now()
  const result = run()
  return [result, performance.now() - started]
}

/** A PEM block of a 4096-bit key and its certificate: 6,147 characters. */
function pemBlock(): string {
  const lines: string[] = ["-----BEGIN PRIVATE KEY-----"]
  let seed = 7
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  let body = ""
  while (body.length < 6000) {
    seed = (seed * 1103515245 + 12345) % 2147483648
    body += alphabet[seed % 64]
  }
  for (let i = 0; i < body.length; i += 64) lines.push(body.slice(i, i + 64))
  lines.push("-----END PRIVATE KEY-----")
  const text = lines.join("\n")
  return text.slice(0, 6147)
}

describe("matching a purge text", () => {
  it("takes any run of whitespace for any other", () => {
    const match = new PurgeMatcher("Jane Q Example, 12 Baker Street")
    expect(
      match.replace(
        "Ask Jane Q Example, 12 Baker\nStreet for it; also  Jane\r\n    Q\tExample,  12 Baker Street.",
        marker,
      ),
    ).toBe("Ask (purged) for it; also  (purged).")
    expect(match.test("Jane Q Example, 12 BakerStreet")).toBe(false)
  })

  it("allows a line break inside a long word only", () => {
    const key = new PurgeMatcher("plum-otter-5150-lantern-x")
    expect(key.matches("The key is plum-otter-5150-\n  lantern-x.")).toEqual([
      { start: 11, end: 39, acrossLines: true },
    ])
    // Not a space within a line, even in a long word.
    expect(key.test("plum-otter-5150- lantern-x")).toBe(false)
    // Short words must be whole.
    expect(new PurgeMatcher("abcd").test("grab\ncdrom")).toBe(false)
    expect(new PurgeMatcher("data").test("Aida\nta")).toBe(false)
    expect(new PurgeMatcher("to be").matches("nothing to\nbe done")).toEqual([
      { start: 8, end: 13, acrossLines: true },
    ])
  })

  it("finds each place once, from the start, and replaces until none is left", () => {
    const match = new PurgeMatcher("abab")
    expect(match.find("ababab abab")).toEqual([
      { index: 0, text: "abab" },
      { index: 7, text: "abab" },
    ])
    expect(match.replace("ababab abab", marker)).toBe("(purged)ab (purged)")
  })

  it("purges a whole key block, wrapped or indented differently, quickly", () => {
    const pem = pemBlock()
    expect(pem.length).toBe(6147)
    const match = new PurgeMatcher(pem)
    const stored = `key: |\n  ${pem.replaceAll("\n", "\r\n  ")}\nnote: rotated\n`
    const [replaced, ms] = timed(() => match.replace(stored, marker))
    expect(replaced).toBe("key: |\n  (purged)\nnote: rotated\n")
    expect(ms).toBeLessThan(500)
  })

  it("stays linear on repetitive text", () => {
    const value = "a".repeat(64 * 1024)
    const cases: [string, string, number][] = [
      // A long word of a's and a b, against 64 KiB of a's.
      ["a".repeat(5000) + "b", value, 0],
      ["a".repeat(5000), value, 13],
      // Many short words, against the same words.
      ["a ".repeat(2000) + "b", "a ".repeat(32 * 1024), 0],
      ["a ".repeat(4999) + "b", "a ".repeat(32 * 1024), 0],
      // A repeated phrase that never ends as the text does.
      [
        "the cat sat on the mat ".repeat(300) + "dog",
        "the cat sat on the mat ".repeat(2900),
        0,
      ],
      // Places that almost match, failing at their last character.
      ["a".repeat(5000), ("a".repeat(4999) + " ").repeat(13), 0],
    ]
    for (const [text, stored, places] of cases) {
      const [found, ms] = timed(() =>
        new PurgeMatcher(text.trim()).matches(stored),
      )
      expect(found).toHaveLength(places)
      expect(ms).toBeLessThan(500)
    }
  })
})
