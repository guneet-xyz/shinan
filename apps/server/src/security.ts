import type { Context as HonoContext, MiddlewareHandler } from "hono"

import { shinan, takeRateLimit } from "@shinan/core"
import type { RateLimitName, RequestInfo } from "@shinan/core"
import type { Database } from "@shinan/db"

import { errorResponse } from "./api/errors.js"

/**
 * The Content Security Policy for everything Shinan serves (architecture
 * §10.2). The web app is built into files with no inline script or style,
 * so nothing inline is allowed; it talks only to its own origin, and no
 * other site may frame it.
 */
export const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ")

/** Browser features Shinan never uses, turned off for its pages. */
export const permissionsPolicy = [
  "accelerometer=()",
  "browsing-topics=()",
  "camera=()",
  "display-capture=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "usb=()",
].join(", ")

/** Two years, as browsers' HSTS preload lists expect. */
const hstsMaxAgeSeconds = 2 * 365 * 24 * 60 * 60

/**
 * Security headers on every response (architecture §10.2). HSTS is sent only
 * when the installation's address is HTTPS: over plain HTTP, in
 * development, browsers ignore it, and `upgrade-insecure-requests` would
 * break the page.
 */
export function securityHeaders(options: {
  https: boolean
}): MiddlewareHandler {
  const headers: [string, string][] = [
    [
      "content-security-policy",
      options.https
        ? `${contentSecurityPolicy}; upgrade-insecure-requests`
        : contentSecurityPolicy,
    ],
    ["cross-origin-opener-policy", "same-origin"],
    ["cross-origin-resource-policy", "same-origin"],
    ["permissions-policy", permissionsPolicy],
    ["referrer-policy", "no-referrer"],
    ["x-content-type-options", "nosniff"],
    ["x-frame-options", "DENY"],
    ...(options.https
      ? ([
          [
            "strict-transport-security",
            `max-age=${hstsMaxAgeSeconds}; includeSubDomains`,
          ],
        ] as [string, string][])
      : []),
  ]
  return async (c, next) => {
    await next()
    for (const [name, value] of headers) c.res.headers.set(name, value)
  }
}

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"])

/**
 * Cross-site request forgery protection for every state-changing request
 * (architecture §10.1): a request with any other method than GET, HEAD or
 * OPTIONS must come from the installation's own pages. Browsers mark that
 * with `Sec-Fetch-Site: same-origin` and an `Origin` header naming the site;
 * scripts on other sites cannot change either. Any `Origin` must be the
 * installation's, any `Sec-Fetch-Site` must be `same-origin`, and at least
 * one must be present.
 *
 * Reason for a check rather than tokens: every state-changing request comes
 * from the web app's `fetch`, which always sends these headers, so a check
 * needs no state and no change to the web app. `SameSite=Lax` cookies alone
 * are not enough: other sites under the same domain (other services on
 * `guneet.dev`) count as the same site, and forms can post without a body.
 *
 * Agent endpoints are not behind this check: they are routed ahead of it
 * and take no cookie at all (`requireAgent`), so a forged browser request
 * has no credential to use there. Everything else stays behind it.
 */
export function sameOriginOnly(
  installationUrl: string | undefined,
): MiddlewareHandler {
  const configured = installationUrl
    ? new URL(installationUrl).origin
    : undefined
  return async (c, next) => {
    if (safeMethods.has(c.req.method)) return next()
    const expected = configured ?? new URL(c.req.url).origin
    const origin = c.req.header("origin")
    const site = c.req.header("sec-fetch-site")
    const sameOrigin =
      (origin !== undefined || site !== undefined) &&
      (origin === undefined || origin === expected) &&
      (site === undefined || site === "same-origin")
    if (!sameOrigin) {
      return errorResponse(c, 403, {
        error: "forbidden",
        message: "Requests from other sites are refused",
        reason: "cross-site",
      })
    }
    await next()
  }
}

/**
 * Counts each request against a rate limit for its network address and
 * answers 429 once the limit is reached (architecture §10.1). The counts
 * are in PostgreSQL, shared by every `web` process.
 */
export function rateLimited(
  db: Database,
  name: RateLimitName,
  requestInfo: (c: HonoContext) => RequestInfo,
  methods: readonly string[] = ["POST"],
): MiddlewareHandler {
  return async (c, next) => {
    if (!methods.includes(c.req.method)) return next()
    const outcome = await takeRateLimit(
      { db, actor: shinan, request: requestInfo(c) },
      name,
    )
    if (!outcome.allowed) {
      const response = errorResponse(c, 429, {
        error: "too-many-requests",
        message: "Too many attempts. Wait a minute and try again.",
      })
      response.headers.set("retry-after", String(outcome.retryAfterSeconds))
      return response
    }
    await next()
  }
}
