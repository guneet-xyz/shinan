import { createHash, randomBytes } from "node:crypto"

/**
 * The prefix every agent token starts with (identity §7.4), so leak scanners
 * and Shinan's own secret check (catalog) can spot one in text.
 */
export const agentTokenPrefix = "shinan_agent_"

/** How many random characters follow the prefix in an agent token. */
export const agentTokenRandomLength = 43

/**
 * What matches exactly one agent token in text (identity §7.4): the prefix
 * and 43 letters or digits. Not anchored and not global; build a new
 * RegExp from its source to search with flags.
 */
export const agentTokenPattern = new RegExp(
  `${agentTokenPrefix}[A-Za-z0-9]{${agentTokenRandomLength}}`,
)

const base62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

/**
 * A new agent token (identity §7.4): the prefix and 43 random letters and
 * digits, about 256 bits. Letters and digits only, so the whole token is
 * one word for selection and scanners. Each character is drawn uniformly:
 * random bytes of 248 or more are discarded, since 248 is the largest
 * multiple of 62 a byte can hold.
 */
export function newAgentToken(): string {
  let random = ""
  while (random.length < agentTokenRandomLength) {
    for (const byte of randomBytes(64)) {
      if (byte >= 248) continue
      random += base62[byte % 62]
      if (random.length === agentTokenRandomLength) break
    }
  }
  return `${agentTokenPrefix}${random}`
}

/** A new random secret for a link or cookie: 32 bytes, URL-safe. */
export function newToken(): string {
  return randomBytes(32).toString("base64url")
}

/**
 * The one-way hash Shinan stores instead of a token (identity §7.4,
 * architecture §10.3): SHA-256, URL-safe. Tokens are random, so no salt is
 * needed.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url")
}
