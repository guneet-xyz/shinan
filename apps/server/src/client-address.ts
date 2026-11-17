import { BlockList, isIP } from "node:net"

import { SettingsError } from "./settings-error.js"

/**
 * The reverse proxies whose `X-Forwarded-For` header is believed, such as
 * Caddy in front of Shinan (architecture §11.3). Without any, the client
 * address is always the connecting socket's.
 */
export interface TrustedProxies {
  has(address: string): boolean
  /** Whether any proxy is trusted at all. */
  readonly any: boolean
}

export const noTrustedProxies: TrustedProxies = { has: () => false, any: false }

/**
 * Reads `SHINAN_TRUSTED_PROXIES`: IP addresses and CIDR ranges, separated by
 * commas or spaces, such as `172.20.0.0/16, ::1`. Throws on anything else,
 * naming the entry, so a typo cannot silently trust nobody or everybody.
 */
export function parseTrustedProxies(value: string): TrustedProxies {
  const list = new BlockList()
  const entries = value.split(/[\s,]+/).filter(Boolean)
  for (const entry of entries) {
    const [address = "", prefix, ...rest] = entry.split("/")
    const family = isIP(address)
    if (family === 0 || rest.length > 0) {
      throw new SettingsError(
        `SHINAN_TRUSTED_PROXIES has an entry that is not an IP address or range: ${entry}`,
      )
    }
    const type = family === 4 ? "ipv4" : "ipv6"
    if (prefix === undefined) {
      list.addAddress(address, type)
      continue
    }
    const bits = Number(prefix)
    if (!/^\d{1,3}$/.test(prefix) || bits > (family === 4 ? 32 : 128)) {
      throw new SettingsError(
        `SHINAN_TRUSTED_PROXIES has a range with a wrong prefix length: ${entry}`,
      )
    }
    list.addSubnet(address, bits, type)
  }
  return {
    any: entries.length > 0,
    has(address) {
      const plain = unmapped(address)
      const family = isIP(plain)
      if (family === 0) return false
      return list.check(plain, family === 4 ? "ipv4" : "ipv6")
    },
  }
}

/**
 * The client's network address, for the security log, rate limits and
 * new-browser alerts. It is the socket's address, unless that is a trusted
 * proxy: then `X-Forwarded-For` is read from the right, each entry having
 * been added by the hop before it, skipping further trusted proxies, and the
 * first address no trusted proxy vouches for is the client. Entries to the
 * left of it were written by the client and are never believed. A missing or
 * malformed entry ends the walk at the last address known to be real.
 */
export function clientAddress(
  socketAddress: string | undefined,
  forwardedFor: string | undefined,
  trusted: TrustedProxies,
): string | undefined {
  if (socketAddress === undefined) return undefined
  let current = unmapped(socketAddress)
  if (!trusted.any || !forwardedFor) return current
  const hops = forwardedFor.split(",").map((hop) => hop.trim())
  while (trusted.has(current)) {
    const hop = hops.pop()
    if (hop === undefined || isIP(hop) === 0) break
    current = unmapped(hop)
  }
  return current
}

/** An IPv4-mapped IPv6 address (`::ffff:192.0.2.1`) as plain IPv4. */
function unmapped(address: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
  return mapped ? mapped[1]! : address
}
