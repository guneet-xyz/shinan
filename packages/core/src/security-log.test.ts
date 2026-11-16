import { describe, expect, it } from "vitest"

import { networkAddress } from "./security-log.js"

describe("networkAddress", () => {
  it("keeps IPv4 and IPv6 addresses", () => {
    expect(networkAddress("192.0.2.1")).toBe("192.0.2.1")
    expect(networkAddress("2001:db8::1")).toBe("2001:db8::1")
  })

  it("removes an IPv6 zone ID", () => {
    expect(networkAddress("fe80::1%eth0")).toBe("fe80::1")
  })

  it("drops anything that is not an IP address", () => {
    for (const value of [undefined, "", "not-an-address", "192.0.2.1%eth0"]) {
      expect(networkAddress(value)).toBeNull()
    }
  })
})
