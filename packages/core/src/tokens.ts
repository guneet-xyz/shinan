import { createHash, randomBytes } from "node:crypto"

/**
 * The prefix every agent token starts with (identity §7.4), so leak scanners
 * and Shinan's own secret check (catalog) can spot one in text. Tokens made
 * from it look like `shinan_agent_` followed by 43 URL-safe characters.
 */
export const agentTokenPrefix = "shinan_agent_"

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
