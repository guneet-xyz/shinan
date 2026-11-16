import { describe, expect, it } from "vitest"

import { formatFrom } from "./sender.js"

describe("formatFrom", () => {
  it("formats an address with a display name", () => {
    expect(formatFrom({ address: "shinan@guneet.dev", name: "Shinan" })).toBe(
      '"Shinan" <shinan@guneet.dev>',
    )
  })

  it("leaves a bare address alone", () => {
    expect(formatFrom({ address: " shinan@guneet.dev " })).toBe(
      "shinan@guneet.dev",
    )
  })

  it("escapes quotes and removes line breaks in the name", () => {
    expect(
      formatFrom({ address: "a@example.com", name: 'Say "hi"\r\nBcc: x' }),
    ).toBe('"Say \\"hi\\" Bcc: x" <a@example.com>')
  })

  it("encodes a name outside ASCII", () => {
    expect(formatFrom({ address: "a@example.com", name: "指南" })).toBe(
      `=?UTF-8?B?${Buffer.from("指南").toString("base64")}?= <a@example.com>`,
    )
  })

  it("rejects something that is not an address", () => {
    expect(() => formatFrom({ address: "Shinan <a@example.com>" })).toThrow(
      /From address/,
    )
    expect(() => formatFrom({ address: "nobody" })).toThrow(/From address/)
  })
})
