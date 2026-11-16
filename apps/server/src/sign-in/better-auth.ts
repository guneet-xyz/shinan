import { betterAuth } from "better-auth"
import type { BetterAuthOptions } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError, createAuthMiddleware, getOAuthState } from "better-auth/api"
import { magicLink } from "better-auth/plugins/magic-link"
import { parse, serialize } from "hono/utils/cookie"
import type { CookieOptions } from "hono/utils/cookie"

import {
  clientDescription,
  findPendingGitHubSignIn,
  hashToken,
  maySignIn,
  openSignInLink,
  pendingGitHubMinutes,
  reauthenticationMinutes,
  recordGitHubAdded,
  recordSignIn,
  recordSignInFailure,
  recordSignOut,
  sendSignInLink,
  shinan,
  signInLinkMinutes,
  startGitHubSignIn,
} from "@shinan/core"
import type { Context, JobQueue, RequestInfo } from "@shinan/core"
import { eq, schema } from "@shinan/db"
import type { Database } from "@shinan/db"

import type { SignIn } from "../api/sign-in.js"
import { isSafeReturnPath, signInErrorPath } from "./paths.js"
import { requestStore, withRequestStore } from "./request-store.js"
import type { RequestStore } from "./request-store.js"
import { hashSessionTokens } from "./session-tokens.js"

export interface SessionLimits {
  /** A sign-in session ends after this long without activity (§3.3). */
  idleMinutes: number
  /** And after this long in any case (§3.3). */
  maxHours: number
}

export interface BetterAuthSignInOptions {
  db: Database
  jobs: JobQueue
  /** The installation's public address, such as `https://shinan.guneet.dev`. */
  installationUrl: string
  /** Signs cookies and encrypts sign-in state (architecture §10.3). */
  secret: string
  /** The GitHub App's client ID and secret, used for sign-in only. */
  github?: { clientId: string; clientSecret: string }
  sessions: SessionLimits
  /** Better Auth's own per-address rate limits; on unless turned off. */
  rateLimit?: boolean
}

export interface BetterAuthSignIn extends SignIn {
  /** Resolves when work started in the background has finished (tests). */
  idle(): Promise<void>
}

/**
 * Paths under `/api/auth` the web app uses; Better Auth's others are not
 * served. Magic links are opened only through `openLink` (a POST from the
 * confirm page), never by a GET that a mail scanner could fetch.
 */
const servedPaths: Record<string, readonly string[]> = {
  "/sign-in/magic-link": ["POST"],
  "/sign-in/social": ["POST"],
  "/callback/github": ["GET", "POST"],
  "/sign-out": ["POST"],
}

/**
 * The network address Better Auth records and rate-limits by. Shinan sets it
 * from the connection itself, replacing anything the client sent, so it
 * cannot be forged with a header.
 */
const clientAddressHeader = "x-shinan-client-address"

/**
 * Sign-in with Better Auth: email magic links and GitHub (identity §3, D-044).
 * Better Auth runs the protocols (magic-link tokens, GitHub's OAuth flow, the
 * session cookie); every rule is core's, through Better Auth's hooks:
 *
 * - accounts are created only by core, when a magic link sent to an
 *   allowlisted address is opened (`openSignInLink`); Better Auth may never
 *   create or change people;
 * - a GitHub account nobody has linked starts a pending GitHub sign-in, and
 *   the person confirms their email address with a magic link first;
 * - a sign-in session starts only for a person still on the allowlist;
 * - sign-in session and magic-link tokens are stored only as hashes, and no
 *   GitHub token is ever stored.
 */
export function createBetterAuthSignIn(
  options: BetterAuthSignInOptions,
): BetterAuthSignIn {
  const { db, jobs, installationUrl } = options
  const base = new URL(installationUrl)
  const secure = base.protocol === "https:"
  const cookieNames = {
    browser: `${secure ? "__Host-" : ""}shinan.browser`,
    pendingGitHub: `${secure ? "__Host-" : ""}shinan.github_pending`,
  }
  const cookieOptions: CookieOptions = {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "Lax",
  }

  const asShinan = (): Context => ({
    db,
    actor: shinan,
    request: currentRequest(),
    jobs,
    installationUrl,
  })

  const auth = betterAuth({
    appName: "Shinan",
    baseURL: installationUrl,
    basePath: "/api/auth",
    secret: options.secret,
    telemetry: { enabled: false },
    trustedOrigins: [base.origin],
    database: (betterAuthOptions: BetterAuthOptions) =>
      hashSessionTokens(
        drizzleAdapter(db, {
          provider: "pg",
          schema: {
            people: schema.people,
            signInSessions: schema.signInSessions,
            signInAccounts: schema.signInAccounts,
            signInVerifications: schema.signInVerifications,
          },
        })(betterAuthOptions),
      ),
    user: { modelName: "people" },
    session: {
      modelName: "signInSessions",
      fields: { userId: "personId", token: "tokenHash" },
      expiresIn: options.sessions.idleMinutes * 60,
      updateAge: Math.min(300, options.sessions.idleMinutes * 15),
      freshAge: reauthenticationMinutes * 60,
    },
    account: {
      modelName: "signInAccounts",
      fields: { userId: "personId" },
      accountLinking: {
        enabled: true,
        // Never link by a matching email address (identity §3.1); GitHub
        // is added only while signed in, through linkSocial.
        disableImplicitLinking: true,
        allowDifferentEmails: true,
        trustedProviders: ["github"],
        updateUserInfoOnLink: false,
      },
      updateAccountOnSignIn: false,
      storeAccountCookie: false,
    },
    verification: {
      modelName: "signInVerifications",
      storeIdentifier: "hashed",
    },
    advanced: {
      database: { generateId: "uuid" },
      ipAddress: { ipAddressHeaders: [clientAddressHeader] },
      cookiePrefix: "shinan",
      useSecureCookies: secure,
    },
    rateLimit: { enabled: options.rateLimit ?? true, storage: "memory" },
    logger: {
      level: "warn",
      // Only Better Auth's own message, never its extra values, which can
      // hold provider answers or request details (architecture §10.3). A
      // GitHub account nobody has linked is expected, not an error.
      log: (level, message) => {
        if (message === "signup_disabled") return
        const line = `Sign-in (${level}): ${String(message).slice(0, 200)}`
        if (level === "error") console.error(line)
        else console.warn(line)
      },
    },
    onAPIError: { errorURL: new URL("/sign-in", base).href },
    socialProviders: options.github
      ? {
          github: {
            clientId: options.github.clientId,
            clientSecret: options.github.clientSecret,
            disableDefaultScope: true,
            disableImplicitSignUp: true,
            disableSignUp: true,
            // Better Auth's type wants GitHub's whole profile; only the
            // account number and login are read.
            getUserInfo: readGitHubAccount as never,
          },
        }
      : {},
    plugins: [
      magicLink({
        storeToken: "hashed",
        expiresIn: signInLinkMinutes * 60,
        disableSignUp: true,
        sendMagicLink: ({ email, url, token, metadata }, ctx) => {
          // The emailed link opens a page that asks for one click; the token
          // is in the fragment, so it reaches no server log and a mail
          // scanner fetching the link uses nothing up.
          const next = new URL(url).searchParams.get("callbackURL") ?? "/"
          const fragment = new URLSearchParams({ token, next }).toString()
          const link = `${new URL("/sign-in/link", base).href}#${fragment}`
          // Only the GitHub email step binds a waiting GitHub sign-in, so a
          // later sign-in on a shared computer never picks it up.
          const pendingGitHubToken =
            metadata?.github === true
              ? cookie(
                  ctx?.request?.headers ?? ctx?.headers,
                  cookieNames.pendingGitHub,
                )
              : undefined
          const ctxForCore = asShinan()
          // Answer before core decides, so the reply takes the same time
          // whether or not the address may have a link (identity §10).
          inBackground("Sign-in link not sent", () =>
            sendSignInLink(ctxForCore, {
              email,
              link,
              expiresAt: new Date(Date.now() + signInLinkMinutes * 60_000),
              pendingGitHubToken,
            }),
          )
          return Promise.resolve()
        },
      }),
    ],
    databaseHooks: {
      // Only core creates and changes people (identity §3.2).
      user: {
        create: { before: () => Promise.resolve(false) },
        update: { before: () => Promise.resolve(false) },
      },
      session: {
        create: {
          before: async (session) =>
            (await maySignIn(asShinan(), { personId: session.userId }))
              ? {
                  data: {
                    ...session,
                    userAgent: clientDescription(
                      session.userAgent ?? undefined,
                    ),
                  },
                }
              : false,
        },
      },
      account: {
        create: {
          before: (account) => Promise.resolve(withoutCredentials(account)),
        },
        update: {
          before: (account) => Promise.resolve(withoutCredentials(account)),
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        switch (ctx.path) {
          case "/sign-in/magic-link":
          case "/sign-in/social":
          case "/link-social":
            return { context: { body: checkSignInRequest(ctx.path, ctx.body) } }
          case "/magic-link/verify":
            return openLink(ctx)
          case "/sign-out":
            return signOut(ctx)
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (
          ctx.context.newSession &&
          (ctx.path === "/magic-link/verify" || ctx.path === "/callback/:id")
        ) {
          return signedIn(ctx, ctx.context.newSession.session)
        }
        const error = errorOf(ctx.context.returned)
        if (ctx.path === "/callback/:id") return afterGitHub(ctx, error)
        if (ctx.path === "/magic-link/verify" && error) {
          await recordSignInFailure(asShinan(), {
            method: "email",
            reason: error,
          })
        }
      }),
    },
  })

  type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]

  /** The sign-in requests' return paths must stay on this site. */
  function checkSignInRequest(path: string, body: unknown) {
    const input = (body ?? {}) as Record<string, unknown>
    const allowed =
      path === "/sign-in/magic-link"
        ? ["email", "callbackURL", "errorCallbackURL", "metadata"]
        : ["provider", "callbackURL", "errorCallbackURL", "disableRedirect"]
    const unexpected = Object.keys(input).filter(
      (key) => !allowed.includes(key),
    )
    if (unexpected.length > 0) {
      throw new APIError("BAD_REQUEST", {
        message: `Unexpected fields: ${unexpected.join(", ")}`,
      })
    }
    if (
      input.metadata !== undefined &&
      JSON.stringify(input.metadata) !== JSON.stringify({ github: true })
    ) {
      throw new APIError("BAD_REQUEST", { message: "Unexpected metadata" })
    }
    if (path !== "/sign-in/magic-link" && input.provider !== "github") {
      throw new APIError("BAD_REQUEST", { message: "Only GitHub is offered" })
    }
    const callbackURL = input.callbackURL ?? "/"
    if (!isSafeReturnPath(callbackURL, installationUrl)) {
      throw new APIError("BAD_REQUEST", {
        message: "callbackURL must be a path on this site",
      })
    }
    return {
      ...input,
      callbackURL,
      errorCallbackURL:
        path === "/link-social"
          ? "/account"
          : signInErrorPath(callbackURL as string),
    }
  }

  /**
   * Before Better Auth opens a magic link: core decides whether the address
   * may sign in, and creates the account on first use (identity §3.2).
   */
  async function openLink(ctx: HookContext) {
    const query = (ctx.query ?? {}) as Record<string, unknown>
    // Without a return path Better Auth would answer with the session token
    // itself; Shinan always gives one.
    if (query.callbackURL === undefined) {
      throw ctx.redirect(`${signInErrorPath(undefined)}?error=invalid_link`)
    }
    for (const key of [
      "callbackURL",
      "errorCallbackURL",
      "newUserCallbackURL",
    ]) {
      if (
        query[key] !== undefined &&
        !isSafeReturnPath(query[key], installationUrl)
      ) {
        throw ctx.redirect(`${signInErrorPath(undefined)}?error=invalid_link`)
      }
    }
    if (typeof query.token !== "string") return
    const identifier = `magic-link:${hashToken(query.token)}`
    const pending =
      await ctx.context.internalAdapter.findVerificationValue(identifier)
    if (!pending || pending.expiresAt.getTime() < Date.now()) return
    const email = magicLinkEmail(pending.value)
    if (!email) return
    const opened = await openSignInLink(asShinan(), { email })
    if (!opened.allowed) {
      await ctx.context.internalAdapter.deleteVerificationByIdentifier(
        identifier,
      )
      const errorPath =
        typeof query.errorCallbackURL === "string"
          ? query.errorCallbackURL
          : signInErrorPath(undefined)
      const url = new URL(errorPath, base)
      url.searchParams.set("error", "sign_in_refused")
      throw ctx.redirect(url.pathname + url.search)
    }
    currentStore().accountCreated = opened.accountCreated
  }

  async function signOut(ctx: HookContext) {
    const token = await ctx.getSignedCookie(
      ctx.context.authCookies.sessionToken.name,
      ctx.context.secret,
    )
    if (!token) return
    const found = await ctx.context.internalAdapter.findSession(token)
    if (!found) return
    await recordSignOut(
      {
        db,
        actor: { kind: "person", personId: found.session.userId },
        request: currentRequest(),
      },
      { sessionId: found.session.id },
    )
  }

  /** A sign-in session started: record it, and the browser it came from. */
  async function signedIn(
    ctx: HookContext,
    session: { id: string; userId: string },
  ) {
    const headers = ctx.request?.headers ?? ctx.headers
    const previousToken = await ctx.getSignedCookie(
      ctx.context.authCookies.sessionToken.name,
      ctx.context.secret,
    )
    const previous = previousToken
      ? await ctx.context.internalAdapter.findSession(previousToken)
      : null
    const pendingGitHubToken = cookie(headers, cookieNames.pendingGitHub)
    const { browserToken } = await recordSignIn(asShinan(), {
      personId: session.userId,
      sessionId: session.id,
      method: ctx.path === "/magic-link/verify" ? "email" : "github",
      accountCreated: currentStore().accountCreated ?? false,
      previousSessionId: previous?.session.id,
      browserToken: cookie(headers, cookieNames.browser),
      pendingGitHubToken,
    })
    ctx.setCookie(cookieNames.browser, browserToken, {
      ...cookieOptions,
      // Browsers cap cookies at 400 days.
      maxAge: 400 * 24 * 60 * 60,
    })
    if (pendingGitHubToken) {
      ctx.setCookie(cookieNames.pendingGitHub, "", {
        ...cookieOptions,
        maxAge: 0,
      })
    }
  }

  /**
   * After GitHub's callback. A GitHub account nobody has linked becomes a
   * pending GitHub sign-in, and the person is asked for their email address
   * (identity §3.2). A finished link to a signed-in person is recorded.
   */
  async function afterGitHub(ctx: HookContext, error: string | undefined) {
    const state = await getOAuthState()
    const github = currentStore().github
    if (state?.link) {
      if (error || !github) {
        await recordSignInFailure(asShinan(), {
          method: "github",
          reason: error ?? "github-link-failed",
        })
        return
      }
      await recordGitHubAdded(asShinan(), {
        personId: state.link.userId,
        githubAccountId: github.accountId,
        login: github.login,
      })
      return
    }
    if (error === "signup_disabled" && github) {
      const token = await startGitHubSignIn(asShinan(), {
        githubAccountId: github.accountId,
        login: github.login,
      })
      ctx.setCookie(cookieNames.pendingGitHub, token, {
        ...cookieOptions,
        maxAge: pendingGitHubMinutes * 60,
      })
      const next =
        typeof state?.callbackURL === "string" &&
        isSafeReturnPath(state.callbackURL, installationUrl) &&
        state.callbackURL !== "/"
          ? `?next=${encodeURIComponent(state.callbackURL)}`
          : ""
      throw ctx.redirect(`/sign-in/github${next}`)
    }
    if (error) {
      await recordSignInFailure(asShinan(), { method: "github", reason: error })
    }
  }

  /**
   * Reads who signed in from GitHub's `/user`, with the user access token
   * from the authorization, which is then dropped: Shinan keeps no GitHub
   * token (identity §3.1, O-1). Only the stable account number identifies the
   * person; the email address Better Auth needs is a placeholder that matches
   * no account, so nothing is ever matched by email.
   */
  async function readGitHubAccount(tokens: { accessToken?: string }) {
    if (!tokens.accessToken) return null
    const response = await fetch("https://api.github.com/user", {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${tokens.accessToken}`,
        "user-agent": "Shinan",
        "x-github-api-version": "2022-11-28",
      },
    })
    if (!response.ok) return null
    const profile = (await response.json()) as {
      id?: unknown
      login?: unknown
      name?: unknown
    }
    if (typeof profile.id !== "number" || !Number.isSafeInteger(profile.id)) {
      return null
    }
    const accountId = String(profile.id)
    const login = typeof profile.login === "string" ? profile.login : undefined
    currentStore().github = { accountId, login }
    const accessToken = tokens.accessToken
    inBackground("GitHub token not revoked", () =>
      revokeGitHubToken(accessToken),
    )
    return {
      user: {
        id: accountId,
        name: (typeof profile.name === "string" && profile.name) || login || "",
        email: `${accountId}@github.invalid`,
        emailVerified: true,
      },
      data: { id: profile.id, login },
    }
  }

  /**
   * The user token is not needed after `/user` was read, so it is revoked at
   * GitHub at once rather than left valid until it expires.
   */
  async function revokeGitHubToken(accessToken: string): Promise<void> {
    const { clientId, clientSecret } = options.github!
    const response = await fetch(
      `https://api.github.com/applications/${encodeURIComponent(clientId)}/token`,
      {
        method: "DELETE",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
          "content-type": "application/json",
          "user-agent": "Shinan",
          "x-github-api-version": "2022-11-28",
        },
        body: JSON.stringify({ access_token: accessToken }),
      },
    )
    if (!response.ok && response.status !== 404) {
      throw new Error(`GitHub answered ${response.status}`)
    }
  }

  /**
   * Work that must not hold up the answer. Failures are logged by kind
   * only (no values, which could hold an address or a token).
   */
  const inFlight = new Set<Promise<void>>()
  function inBackground(what: string, task: () => Promise<void>): void {
    const running: Promise<void> = task()
      .catch((error: unknown) => {
        const kind = error instanceof Error ? error.name : "Error"
        const status =
          error instanceof Error && /^GitHub answered \d+$/.test(error.message)
            ? `, ${error.message}`
            : ""
        console.error(`${what} (${kind}${status})`)
      })
      .finally(() => inFlight.delete(running))
    inFlight.add(running)
  }

  return {
    methods: { github: options.github !== undefined },

    async idle() {
      while (inFlight.size > 0) await Promise.all([...inFlight])
    },

    async currentPerson(request) {
      return withRequestStore({ request: {} }, async () => {
        const { headers, response } = await auth.api.getSession({
          headers: forwardHeaders(request.headers),
          returnHeaders: true,
        })
        if (!response) return { person: null, headers }
        const { session } = response
        const age = Date.now() - new Date(session.createdAt).getTime()
        if (age > options.sessions.maxHours * 3_600_000) {
          await db
            .delete(schema.signInSessions)
            .where(eq(schema.signInSessions.id, session.id))
          return { person: null, headers: await clearSessionCookie(headers) }
        }
        return {
          person: {
            kind: "person",
            personId: session.userId,
            reauthenticated: age < reauthenticationMinutes * 60_000,
            signInSessionId: session.id,
          },
          headers,
        }
      })
    },

    async handle(request, info) {
      const url = new URL(request.url)
      const path = url.pathname.replace(/^\/api\/auth/, "")
      if (!servedPaths[path]?.includes(request.method)) {
        return Response.json(
          { error: "not-found", message: "Not found" },
          { status: 404 },
        )
      }
      const forwarded = new Request(request, {
        headers: forwardHeaders(request.headers, info),
      })
      return withRequestStore({ request: info }, () => auth.handler(forwarded))
    },

    async openLink(request, info, input) {
      return withRequestStore({ request: info }, async () => {
        let answer: unknown
        try {
          answer = await auth.api.magicLinkVerify({
            query: {
              token: input.token,
              callbackURL: input.callbackURL,
              errorCallbackURL: signInErrorPath(input.callbackURL),
            },
            headers: forwardHeaders(request.headers, info),
            asResponse: true,
          })
        } catch (error) {
          // A redirect from Shinan's own hook, such as a refused address.
          answer = error
        }
        const headers = headersOf(answer)
        const location = headers?.get("location")
        if (!headers || !location) {
          throw new Error("Opening a sign-in link gave no redirect")
        }
        const cookies = new Headers()
        for (const value of headers.getSetCookie()) {
          cookies.append("set-cookie", value)
        }
        const target = new URL(location, base)
        return {
          location:
            target.origin === base.origin
              ? target.pathname + target.search + target.hash
              : "/",
          headers: cookies,
        }
      })
    },

    async startGitHubLink(request, info, input) {
      return withRequestStore({ request: info }, async () => {
        const { headers, response } = await auth.api.linkSocialAccount({
          body: {
            provider: "github",
            callbackURL: input.callbackURL,
            disableRedirect: true,
          },
          headers: forwardHeaders(request.headers, info),
          returnHeaders: true,
        })
        return { url: response.url, headers }
      })
    },

    async sendSetupLink(request, info, input) {
      await withRequestStore({ request: info }, () =>
        auth.api.signInMagicLink({
          body: { email: input.email, callbackURL: "/" },
          headers: forwardHeaders(request.headers, info),
        }),
      )
    },

    async pendingGitHub(request) {
      const token = cookie(request.headers, cookieNames.pendingGitHub)
      if (!token) return null
      return findPendingGitHubSignIn(
        { db, actor: shinan, request: {} },
        { token },
      )
    },
  }

  async function clearSessionCookie(headers: Headers): Promise<Headers> {
    const context = await auth.$context
    const { name, attributes } = context.authCookies.sessionToken
    const cleared = new Headers(headers)
    cleared.append(
      "set-cookie",
      serialize(name, "", {
        path: attributes.path ?? "/",
        httpOnly: true,
        secure: attributes.secure,
        sameSite: "Lax",
        maxAge: 0,
      }),
    )
    return cleared
  }

  function currentStore(): RequestStore {
    return requestStore()
  }

  function currentRequest(): RequestInfo {
    try {
      return requestStore().request
    } catch {
      return {}
    }
  }
}

/**
 * Headers for a call into Better Auth: the client address header is only
 * ever Shinan's own, set from the connection, never one the client sent.
 */
function forwardHeaders(headers: Headers, info?: RequestInfo): Headers {
  const forwarded = new Headers(headers)
  forwarded.delete(clientAddressHeader)
  if (info?.networkAddress) {
    forwarded.set(clientAddressHeader, info.networkAddress)
  }
  return forwarded
}

function headersOf(value: unknown): Headers | undefined {
  if (typeof value !== "object" || value === null || !("headers" in value)) {
    return undefined
  }
  const { headers } = value
  if (headers instanceof Headers) return headers
  if (typeof headers === "object" && headers !== null) {
    return new Headers(headers)
  }
  return undefined
}

function cookie(
  headers: Headers | undefined,
  name: string,
): string | undefined {
  const header = headers?.get("cookie")
  if (!header) return undefined
  return parse(header, name)[name] || undefined
}

/** The address a magic link was sent to, from Better Auth's stored value. */
function magicLinkEmail(value: string): string | undefined {
  try {
    const parsed = JSON.parse(value) as { type?: unknown; email?: unknown }
    return parsed.type === "magic-link" && typeof parsed.email === "string"
      ? parsed.email
      : undefined
  } catch {
    return undefined
  }
}

/** GitHub sign-in only; no credential from GitHub is ever kept. */
function withoutCredentials(account: Record<string, unknown>) {
  if (account.providerId !== undefined && account.providerId !== "github") {
    return false as const
  }
  return {
    data: {
      ...account,
      accessToken: null,
      refreshToken: null,
      idToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      scope: null,
      password: null,
    },
  }
}

/** The `error` of a redirect Better Auth answered with, if any. */
function errorOf(returned: unknown): string | undefined {
  // Better Auth's and better-call's error classes differ; both carry headers.
  const headers =
    typeof returned === "object" && returned !== null && "headers" in returned
      ? returned.headers
      : undefined
  const location =
    headers instanceof Headers
      ? headers.get("location")
      : typeof headers === "object" && headers !== null
        ? ((headers as Record<string, string>).location ?? null)
        : null
  if (!location) return undefined
  try {
    return (
      new URL(location, "http://localhost").searchParams.get("error") ??
      undefined
    )
  } catch {
    return undefined
  }
}
