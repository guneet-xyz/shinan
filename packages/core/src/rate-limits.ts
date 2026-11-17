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
): Promise<RateLimitOutcome> {
  const limit: RateLimit = rateLimits[name]
  const address = throttleAddress(ctx.request?.networkAddress) ?? "unknown"
  return atInstallation(ctx, "rate-limit", async (scope) => {
    const t = schema.rateLimits
    const expired = sql`${t.windowStart} <= now() - make_interval(secs => ${limit.windowSeconds})`
    // The count stops just above the limit, so it can never overflow and
    // the first refusal is exactly `max + 1`.
    const [row] = await scope.tx
      .insert(t)
      .values({ key: `${name}:${address}`, windowStart: sql`now()`, count: 1 })
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
            : { limit: name },
      })
    }
    return { allowed: false, retryAfterSeconds }
  })
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
