import { describe, expect, it } from "vitest"

import { InvalidInputError } from "../../errors.js"
import { purgeMarker, PurgeScanner } from "./scanner.js"

const secret = "plum-otter-velvetlanternorbit-1234"

describe("matching a purge text in what Git stores", () => {
  it("finds it in UTF-8 text by M2's rules, across line breaks too", () => {
    const scanner = new PurgeScanner(secret)
    const wrapped = Buffer.from(
      "Use plum-otter-velvetlantern\n    orbit-1234 for now.\n",
    )
    expect(scanner.places(wrapped)).toEqual({ count: 1, acrossLines: true })
    expect(scanner.replace(wrapped, purgeMarker).toString()).toBe(
      `Use ${purgeMarker} for now.\n`,
    )
    // A short word must be whole: no line break inside it.
    const short = new PurgeScanner("plum otter")
    expect(short.holds(Buffer.from("plum ot\nter"))).toBe(false)
    expect(short.holds(Buffer.from("plum\n  otter"))).toBe(true)
  })

  it("finds it byte for byte in a file that is not UTF-8, and keeps the other bytes", () => {
    const scanner = new PurgeScanner(`café ${secret}`)
    const binary = Buffer.concat([
      Buffer.from([0xff, 0x00, 0xfe]),
      Buffer.from(`café ${secret}`, "utf8"),
      Buffer.from([0x80]),
    ])
    expect(scanner.holds(binary)).toBe(true)
    expect(scanner.replace(binary, purgeMarker)).toEqual(
      Buffer.concat([
        Buffer.from([0xff, 0x00, 0xfe]),
        Buffer.from(purgeMarker),
        Buffer.from([0x80]),
      ]),
    )
  })

  it("leaves what does not hold it as it was, byte for byte, a byte order mark included", () => {
    const scanner = new PurgeScanner(secret)
    const value = Buffer.from("\ufeffNothing here.\r\n", "utf8")
    expect(scanner.replace(value, purgeMarker)).toBe(value)
  })

  it("renames names with plain letters", () => {
    const scanner = new PurgeScanner(secret)
    expect(scanner.rename(`notes-${secret}`)).toBe("notes-purged")
    expect(scanner.rename("main")).toBe("main")
  })

  it("finds encoded forms, percent-encoding in any case", () => {
    const scanner = new PurgeScanner("a b&c")
    expect(scanner.formsIn(Buffer.from("x a%20b%26c y"))).toEqual(["url"])
    expect(scanner.formsIn(Buffer.from("x a b&amp;c y"))).toEqual(["html"])
    expect(scanner.formsIn(Buffer.from("x A%20B%26C"))).toEqual(["url"])
  })

  it("says where removing it changes a document's structure", () => {
    const scanner = new PurgeScanner("velvetlantern")
    const document = Buffer.from(
      "---\nid: machine/velvetlantern\ntype: machine\ntitle: Leaky\nsummary: x\n---\n\n# Leaky\n",
    )
    expect(scanner.structure(document)).toEqual(["id"])
  })

  it("gives a page's title as the catalog will show it", () => {
    const scanner = new PurgeScanner("velvetlantern")
    const page = (title: string) =>
      Buffer.from(
        `---\nid: machine/x\ntype: machine\ntitle: ${title}\nsummary: x\n---\n\n# X\n`,
      )
    expect(scanner.title(page("Musashi"))).toBe("Musashi")
    expect(scanner.title(page("Host velvetlantern"))).toBe(
      `Host ${purgeMarker}`,
    )
    expect(scanner.title(Buffer.from([0xff, 0xfe]))).toBeNull()
  })

  it("checks the text as M2 did", () => {
    expect(() => new PurgeScanner("abc")).toThrow(InvalidInputError)
    expect(() => new PurgeScanner("urged")).toThrow(InvalidInputError)
  })
})
