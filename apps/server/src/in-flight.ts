import type { Context, Env, MiddlewareHandler } from "hono"

/**
 * Limits how many requests one client has in flight at once, counted by
 * `key` (a token, a network address), in this process. Rate limits count
 * requests as they start; this counts the ones not yet answered, so a
 * client that sends large bodies slowly holds at most `max` of them in
 * memory (architecture §10.1, security checklist 1.11). A request with no
 * key is not counted. Above `max`, `refuse` answers at once, before the
 * body is read.
 */
export function limitInFlight<E extends Env>(options: {
  max: number
  key: (c: Context<E>) => string | null | undefined
  refuse: (c: Context<E>) => Response
}): MiddlewareHandler<E> {
  const counts = new Map<string, number>()
  return async (c, next) => {
    const key = options.key(c)
    if (!key) return next()
    const held = counts.get(key) ?? 0
    if (held >= options.max) return options.refuse(c)
    counts.set(key, held + 1)
    try {
      await next()
    } finally {
      const left = (counts.get(key) ?? 1) - 1
      if (left === 0) counts.delete(key)
      else counts.set(key, left)
    }
  }
}

/**
 * How long a client has to send a whole request, headers and body: 30
 * seconds (**proposed**, M2-12). Bodies are at most 512 KB (`/mcp`), so an
 * honest client needs far less; a client that stalls is cut off with 408
 * and its partly received body freed, instead of after Node's default of
 * 300 seconds. It does not limit how long an answer takes.
 */
export const requestReceiveSeconds = 30

/** Node's server options for Shinan's listeners (`requestReceiveSeconds`). */
export function listenerOptions(receiveSeconds = requestReceiveSeconds) {
  return {
    requestTimeout: receiveSeconds * 1000,
    // Must not be longer than requestTimeout.
    headersTimeout: Math.min(20, receiveSeconds) * 1000,
    // How often Node checks those two; its default of 30 s would let a
    // stalled request live up to twice as long.
    connectionsCheckingInterval: Math.min(5, receiveSeconds) * 1000,
  }
}
