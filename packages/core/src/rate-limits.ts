import { lt, schema, sql } from "@shinan/db"

import { atInstallation } from "./authorize.js"
import type { Context } from "./context.js"
import { throttleAddress } from "./email/queue.js"
import { recordSecurityEntry } from "./security-log.js"

export interface RateLimit {
  /** Requests allowed in one window. */
  max: number
  windowSeconds: number
  /**
   * What the security log records for the first refused request in a
   * window, or nothing. Only the first: the log is kept forever (O-47), so
   * a flood must not fill it.
   */
  record?:
    | { action: "sign-in.failed"; method: "email" | "github" }
    | { action: "request.throttled" }
}

/**
 * Rate limits per network address (architecture §10.1, identity §10),
 * counted in PostgreSQL so they hold across every `web` process. Proposed
 * values; the documents leave the numbers open. The sign-in limits match
 * what Better Auth applied before Shinan counted them itself (5 sign-in
 * links a minute).
 */
export const rateLimits = {
  /**
   * Every API request: a ceiling against floods, far above what the web app
   * sends. Not recorded: a flood from many addresses would fill the log.
   */
  api: { max: 300, windowSeconds: 60 },
  /** Asking for a sign-in link, including the first start's (identity §10). */
  "sign-in-link": {
    max: 5,
    windowSeconds: 60,
    record: { action: "sign-in.failed", method: "email" },
  },
  /** Opening a sign-in link: guessing tokens (identity §10). */
  "sign-in-link-open": {
    max: 5,
    windowSeconds: 60,
    record: { action: "sign-in.failed", method: "email" },
  },
  /** Starting GitHub sign-in or adding GitHub, and GitHub's callback. */
  "github-sign-in": {
    max: 10,
    windowSeconds: 60,
    record: { action: "sign-in.failed", method: "github" },
  },
  /** Using an invitation token: failed token use (identity §10). */
  "invitation-token": {
    max: 10,
    windowSeconds: 60,
    record: { action: "request.throttled" },
  },
  /**
   * Failed agent token use per network address (identity §10): unknown,
   * revoked or otherwise refused tokens. Only failures count, and only
   * failures are refused: a working token from the same address still goes
   * through, so nobody sharing an address can lock it out.
   */
  "agent-token-failure": {
    max: 10,
    windowSeconds: 60,
    record: { action: "request.throttled" },
  },
  /**
   * Requests with one agent token, from anywhere (architecture §10.1,
   * per-token limits), counted by the token rather than the address: a
   * stolen token used from many addresses is still limited.
   */
  "agent-token": {
    max: 600,
    windowSeconds: 60,
    record: { action: "request.throttled" },
  },
  /**
   * Pushes to the catalog by one agent (Git-based catalog plan §2.10),
   * counted by the agent: pushes are the expensive requests (a pack of up
   * to 64 MiB, then the push checks). Like M2's proposals.
   */
  "catalog-push": {
    max: 60,
    windowSeconds: 600,
    record: { action: "request.throttled" },
  },
  /**
   * Asking to change one's email address, counted by the person (identity
   * §3.4, **proposed**): each request emails the new address and alerts the
   * old one, so a person (or someone in their sign-in session) cannot use
   * it to flood either mailbox. Far above real use.
   */
  "email-change": {
    max: 5,
    windowSeconds: 3600,
    record: { action: "request.throttled" },
  },
} as const satisfies Record<string, RateLimit>

export type RateLimitName = keyof typeof rateLimits

export type RateLimitOutcome =
  | { allowed: true }
  /** Refused; the window ends in `retryAfterSeconds` (at least 1). */
  | { allowed: false; retryAfterSeconds: number }

/**
 * Counts one request against a rate limit for the request's network address
 * (an IPv6 address by its /64, as for email throttling), and says whether it
 * may go ahead. The count is one atomic statement, so concurrent requests
 * from any number of processes are counted exactly. Windows are fixed: the
 * first request starts one, and the count starts again after it.
 */
export async function takeRateLimit(
  ctx: Context,
  name: RateLimitName,
  options: RateLimitOptions = {},
): Promise<RateLimitOutcome> {
  const limit: RateLimit = rateLimits[name]
  const key = options.key ?? addressKey(ctx)
  return atInstallation(ctx, "rate-limit", async (scope) => {
    const t = schema.rateLimits
    const expired = sql`${t.windowStart} <= now() - make_interval(secs => ${limit.windowSeconds})`
    // The count stops just above the limit, so it can never overflow and
    // the first refusal is exactly `max + 1`.
    const [row] = await scope.tx
      .insert(t)
      .values({ key: `${name}:${key}`, windowStart: sql`now()`, count: 1 })
      .onConflictDoUpdate({
        target: t.key,
        set: {
          windowStart: sql`case when ${expired} then now() else ${t.windowStart} end`,
          count: sql`case when ${expired} then 1 else least(${t.count} + 1, ${limit.max + 2}) end`,
        },
      })
      .returning({
        count: t.count,
        retryAfterSeconds: sql<number>`greatest(1, ceil(extract(epoch from ${t.windowStart} + make_interval(secs => ${limit.windowSeconds}) - now())))::int`,
      })
    const { count, retryAfterSeconds } = row!
    if (count <= limit.max) return { allowed: true }
    if (count === limit.max + 1 && limit.record) {
      await recordSecurityEntry(scope.tx, {
        workspaceId: null,
        action: limit.record.action,
        outcome:
          limit.record.action === "sign-in.failed" ? "failed" : "refused",
        actor: scope.actor,
        request: scope.request,
        details:
          limit.record.action === "sign-in.failed"
            ? { method: limit.record.method, reason: "throttled" }
            : { limit: name, ...(options.key ? { key: options.key } : {}) },
      })
    }
    return { allowed: false, retryAfterSeconds }
  })
}

export interface RateLimitOptions {
  /**
   * What to count by instead of the request's network address, such as an
   * agent token's ID. Never a secret: it is stored and may be logged.
   */
  key?: string
}

function addressKey(ctx: Context): string {
  return throttleAddress(ctx.request?.networkAddress) ?? "unknown"
}

/**
 * Deletes counts whose window has ended for every limit; the worker runs
 * this hourly. Returns how many were deleted.
 */
export async function pruneRateLimits(ctx: Context): Promise<number> {
  const longest = Math.max(
    ...Object.values(rateLimits).map((l: RateLimit) => l.windowSeconds),
  )
  return atInstallation(ctx, "rate-limit", async (scope) => {
    const t = schema.rateLimits
    const deleted = await scope.tx
      .delete(t)
      .where(lt(t.windowStart, sql`now() - make_interval(secs => ${longest})`))
      .returning({ key: t.key })
    return deleted.length
  })
}
