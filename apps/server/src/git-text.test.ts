import { describe, expect, it } from "vitest"

import { gitMessages } from "./git-text.js"

// The product review of GC-2 (D-067): one voice for every text a `git`
// client shows. `remote: ` comes before each and Git does not wrap.

const texts = Object.entries(gitMessages).map(([name, text]) => [
  name,
  typeof text === "function" ? text(600, 600, 600) : text,
])

describe("the texts a git client shows", () => {
  it.each(texts)(
    "%s starts with Shinan, ends with a full stop and fits in 115 characters",
    (_, text) => {
      expect(text).toMatch(/^Shinan: /)
      expect(text).toMatch(/\.$/)
      expect(text.length).toBeLessThanOrEqual(115)
    },
  )

  it("say a refused push changed nothing, and give waits in seconds", () => {
    for (const text of [
      gitMessages.readOnly,
      gitMessages.pushTooLarge(64),
      gitMessages.pushRate(60, 10, 42),
    ])
      expect(text).toContain("Nothing was changed")
    expect(gitMessages.pushRate(60, 10, 42)).toContain(
      "try again in 42 seconds",
    )
    expect(gitMessages.rate(17)).toBe(
      "Shinan: too many requests. Try again in 17 seconds.",
    )
  })

  it("name the Git service one way", () => {
    for (const [, text] of texts)
      expect(text).not.toMatch(/catalog's Git service|Git could not/)
  })
})
