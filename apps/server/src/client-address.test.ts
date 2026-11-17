import { describe, expect, it } from "vitest"

import {
  clientAddress,
  noTrustedProxies,
  parseTrustedProxies,
} from "./client-address.js"

describe("parseTrustedProxies", () => {
  it("reads addresses and ranges of both families", () => {
    const trusted = parseTrustedProxies(" 10.0.0.1,172.20.0.0/16  fd00::/8 ")
    expect(trusted.any).toBe(true)
    for (const address of ["10.0.0.1", "172.20.255.1", "fd00::5"]) {
      expect(trusted.has(address), address).toBe(true)
    }
    for (const address of ["10.0.0.2", "172.21.0.1", "2001:db8::1", "x"]) {
      expect(trusted.has(address), address).toBe(false)
    }
    // A socket's IPv4-mapped form counts as the IPv4 address.
    expect(trusted.has("::ffff:172.20.0.9")).toBe(true)
  })

  it("trusts nobody when empty", () => {
    expect(parseTrustedProxies("").any).toBe(false)
    expect(parseTrustedProxies(" , ").any).toBe(false)
  })

  it("refuses anything that is not an address or range", () => {
    for (const value of [
      "caddy",
      "10.0.0.0/33",
      "10.0.0.0/",
      "10.0.0.0/8/1",
      "::/129",
      "10.0.0.0/x",
    ]) {
      expect(() => parseTrustedProxies(value), value).toThrow(
        "SHINAN_TRUSTED_PROXIES",
      )
    }
  })
})

describe("clientAddress", () => {
  const caddy = parseTrustedProxies("172.20.0.2")

  it("is the socket's address when no proxy is trusted", () => {
    expect(clientAddress("172.20.0.2", "203.0.113.9", noTrustedProxies)).toBe(
      "172.20.0.2",
    )
    expect(clientAddress("::ffff:192.0.2.1", undefined, noTrustedProxies)).toBe(
      "192.0.2.1",
    )
    expect(clientAddress(undefined, "203.0.113.9", caddy)).toBeUndefined()
  })

  it("ignores the header from an address that is not a trusted proxy", () => {
    expect(clientAddress("198.51.100.7", "203.0.113.9", caddy)).toBe(
      "198.51.100.7",
    )
  })

  it("reads the address the trusted proxy added", () => {
    expect(clientAddress("172.20.0.2", "203.0.113.9", caddy)).toBe(
      "203.0.113.9",
    )
    expect(clientAddress("::ffff:172.20.0.2", "2001:db8::1", caddy)).toBe(
      "2001:db8::1",
    )
  })

  it("never believes entries the client wrote itself", () => {
    // The client sent "10.0.0.1"; Caddy appended the real address.
    expect(clientAddress("172.20.0.2", "10.0.0.1, 203.0.113.9", caddy)).toBe(
      "203.0.113.9",
    )
  })

  it("walks past further trusted proxies", () => {
    const proxies = parseTrustedProxies("172.20.0.0/16, 192.0.2.10")
    expect(
      clientAddress("172.20.0.2", "10.0.0.1, 203.0.113.9, 192.0.2.10", proxies),
    ).toBe("203.0.113.9")
  })

  it("stops at the last real address when the header is missing or malformed", () => {
    expect(clientAddress("172.20.0.2", undefined, caddy)).toBe("172.20.0.2")
    expect(clientAddress("172.20.0.2", "", caddy)).toBe("172.20.0.2")
    expect(clientAddress("172.20.0.2", "203.0.113.9, nonsense", caddy)).toBe(
      "172.20.0.2",
    )
    expect(clientAddress("172.20.0.2", "203.0.113.9:443", caddy)).toBe(
      "172.20.0.2",
    )
  })
})
