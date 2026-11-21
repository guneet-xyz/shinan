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

  it("writes the text as `purged` where it is part of a catalog ID, and `(purged)` elsewhere", () => {
    const scanner = new PurgeScanner("quibbleworth")
    const page = Buffer.from(
      "---\nid: machine/quibbleworth-box\naliases: [machine/old-quibbleworth]\nsummary: Was quibbleworth.\n---\n\nSee [it](machine/quibbleworth-box).\n",
    )
    expect(scanner.replace(page, purgeMarker).toString()).toBe(
      `---\nid: machine/purged-box\naliases: [machine/old-purged]\nsummary: Was ${purgeMarker}.\n---\n\nSee [it](machine/purged-box).\n`,
    )
  })

  it("reports encodings it does not remove: base64, every byte percent-encoded, quoted-printable, UTF-16 and another case", () => {
    const text = "quibbleworthsecret"
    const scanner = new PurgeScanner(text)
    const raw = Buffer.from(text)
    const encodedIn = (value: Buffer) => scanner.encodingsIn(value)
    for (const pad of ["", "a", "ab"])
      expect(
        encodedIn(Buffer.from(Buffer.from(pad + text).toString("base64"))),
      ).toContain("base64")
    expect(
      encodedIn(
        Buffer.from([...raw].map((b) => `%${b.toString(16)}`).join("")),
      ),
    ).toEqual(["percent-every-byte"])
    expect(encodedIn(Buffer.from("x quibble=\nworthsecret y"))).toEqual([
      "quoted-printable",
    ])
    expect(encodedIn(Buffer.from(text, "utf16le"))).toEqual(["utf-16"])
    expect(encodedIn(Buffer.from(text, "utf16le").swap16())).toEqual(["utf-16"])
    expect(encodedIn(Buffer.from(text.toUpperCase()))).toEqual(["other-case"])
    expect(encodedIn(Buffer.from(`plain ${text}`))).toEqual([])
  })

  it("reports encoded copies in a value that also holds the text, and base64 wrapped across lines", () => {
    const text = "pitayaflambe"
    const scanner = new PurgeScanner(text)
    const encodedIn = (value: string) => scanner.encodingsIn(Buffer.from(value))
    // Found by what is left once the text itself is removed (review of #197).
    expect(encodedIn("pitayaflambe and PITAYAFLAMBE and Pitayaflambe")).toEqual(
      ["other-case"],
    )
    expect(encodedIn("pitayaflambe, then pitaya=\nflambe")).toEqual([
      "quoted-printable",
    ])
    expect(encodedIn("pitayaflambe twice: pitayaflambe")).toEqual([])
    // As in mail or a certificate: 76-character lines.
    const long = `${"x".repeat(50)}${text}${"y".repeat(50)}`
    const wrapped = (
      Buffer.from(long)
        .toString("base64")
        .match(/.{1,76}/g) ?? []
    ).join("\n  ")
    expect(encodedIn(`key: |\n  ${wrapped}\n`)).toEqual(["base64"])
  })

  it("reports a short text in another case only as a word of its own", () => {
    const scanner = new PurgeScanner("Mark")
    const encodedIn = (value: string) => scanner.encodingsIn(Buffer.from(value))
    expect(encodedIn("markdown, bookmark and Watermark")).toEqual([])
    expect(encodedIn("Ask MARK about it")).toEqual(["other-case"])
    // A longer text is reported inside a word too.
    expect(
      new PurgeScanner("quibbleworthsecret").encodingsIn(
        Buffer.from("xQUIBBLEWORTHSECRETx"),
      ),
    ).toEqual(["other-case"])
  })

  it("names an ID in a link written with a leading slash", () => {
    const scanner = new PurgeScanner("quibbleworth")
    expect(
      scanner
        .replace(
          Buffer.from("See [it](/machine/quibbleworth-box)."),
          purgeMarker,
          (plain) =>
            plain === "machine/purged-box" ? "machine/purged-box-2" : plain,
        )
        .toString(),
    ).toBe("See [it](/machine/purged-box-2).")
  })

  it("names catalog IDs by the plan it is given, and keeps other places as before", () => {
    const scanner = new PurgeScanner("quibbleworth")
    const page = Buffer.from(
      "---\nid: machine/quibbleworth-box\nsummary: Was quibbleworth.\n---\n\nSee [it](machine/quibbleworth-box) and [x](machine/purged-box).\n",
    )
    const named = scanner.replace(page, purgeMarker, (plain) =>
      plain === "machine/purged-box" ? "machine/purged-box-2" : plain,
    )
    expect(named.toString()).toBe(
      `---\nid: machine/purged-box-2\nsummary: Was ${purgeMarker}.\n---\n\nSee [it](machine/purged-box-2) and [x](machine/purged-box).\n`,
    )
  })

  it("checks the text as M2 did", () => {
    expect(() => new PurgeScanner("abc")).toThrow(InvalidInputError)
    expect(() => new PurgeScanner("urged")).toThrow(InvalidInputError)
  })
})
