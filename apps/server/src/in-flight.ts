import { IncomingMessage } from "node:http"
import type { ServerResponse } from "node:http"
import type { Context, Env, MiddlewareHandler } from "hono"

/**
 * Counts how many requests each client has in flight at once, by a key (a
 * token, a network address), in this process. One counter can be shared by
 * several endpoints, so their requests count together.
 */
export interface InFlightCounter {
  readonly max: number
  /** Takes a place for `key`: its release, or null when `key` holds `max`. */
  take(key: string): (() => void) | null
}

export function inFlightCounter(max: number): InFlightCounter {
  const counts = new Map<string, number>()
  return {
    max,
    take(key) {
      const held = counts.get(key) ?? 0
      if (held >= max) return null
      counts.set(key, held + 1)
      let released = false
      return () => {
        if (released) return
        released = true
        const left = (counts.get(key) ?? 1) - 1
        if (left === 0) counts.delete(key)
        else counts.set(key, left)
      }
    },
  }
}

/**
 * Limits how many requests one client has in flight at once, counted by
 * `key` (a token, a network address), in this process. Rate limits count
 * requests as they start; this counts the ones not yet answered, so a
 * client that sends large bodies slowly holds at most `max` of them in
 * memory (architecture §10.1, security checklist 1.11). A request with no
 * key is not counted. Above `max`, `refuse` answers at once, before the
 * body is read. `counter` shares the count with other endpoints.
 */
export function limitInFlight<E extends Env>(options: {
  max?: number
  counter?: InFlightCounter
  key: (c: Context<E>) => string | null | undefined
  refuse: (c: Context<E>) => Response
}): MiddlewareHandler<E> {
  const counter = options.counter ?? inFlightCounter(options.max ?? 1)
  return async (c, next) => {
    const key = options.key(c)
    if (!key) return next()
    const release = counter.take(key)
    if (!release) return options.refuse(c)
    try {
      await next()
    } finally {
      release()
    }
  }
}

/**
 * How long a client has to send a whole request, headers and body: 30
 * seconds (**proposed**, M2-12). Bodies are at most 512 KB (`/mcp`), so an
 * honest client needs far less; a client that stalls is cut off with 408
 * and its partly received body freed, instead of after Node's default of
 * 300 seconds. It does not limit how long an answer takes. A push to the
 * Git endpoint has longer (`pushReceiveSeconds`).
 */
export const requestReceiveSeconds = 30

/**
 * How long a push's body may take to arrive at `web` and at the Git
 * container: 120 seconds (Git-based catalog plan §2.10), for a large push
 * on a slow link.
 */
export const pushReceiveSeconds = 120

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

/** The Node.js request and response, when served by `@hono/node-server`. */
export interface NodeBindings {
  incoming?: IncomingMessage
  outgoing?: ServerResponse
}

/**
 * A shorter time to receive a request than the listener's own, for every
 * request `longer` does not pick: `web`'s listener allows a push's 120
 * seconds (`pushReceiveSeconds`), and this keeps every other request to
 * `seconds`, counted from when its headers arrived. A request whose body
 * has not all arrived by then has its connection closed, which frees what
 * was received of it.
 */
export function receiveDeadline(
  seconds: number,
  longer: (c: Context) => boolean,
): MiddlewareHandler {
  return async (c, next) => {
    const incoming = (c.env as NodeBindings | undefined)?.incoming
    if (
      !(incoming instanceof IncomingMessage) ||
      incoming.complete ||
      longer(c)
    )
      return next()
    const timer = setTimeout(() => {
      if (!incoming.complete) incoming.socket?.destroy()
    }, seconds * 1000)
    timer.unref()
    const clear = () => clearTimeout(timer)
    incoming.once("end", clear)
    incoming.once("close", clear)
    await next()
  }
}
