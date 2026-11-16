import type { MiddlewareHandler } from "hono"

import type { PersonActor, RequestInfo } from "@shinan/core"

import { errorResponse } from "./errors.js"

/**
 * How the API learns who is signed in. This is the one seam between the API
 * and the sign-in layer: `src/sign-in` implements it with sign-in sessions,
 * and tests use a simpler one.
 */
export interface SignIn {
  /**
   * Who is signed in on this request. `person` is null when nobody is; it
   * sets `reauthenticated` when the person signed in again recently enough
   * for sensitive actions (identity §3.3), and core decides which actions
   * need that.
   */
  currentPerson(request: Request): Promise<SignInResult>
  /**
   * Serves the sign-in routes under `/api/auth` (email magic link, GitHub,
   * sign-out), which the web app's sign-in pages call. Without it, those
   * routes answer 404.
   */
  handle?(request: Request, info: RequestInfo): Promise<Response>
  /** The sign-in methods this installation offers besides email. */
  methods: { github: boolean }
  /**
   * Starts adding GitHub as a sign-in method for the signed-in person, once
   * core has allowed it. Returns GitHub's authorization address, and headers
   * to add to the response.
   */
  startGitHubLink?(
    request: Request,
    input: { callbackURL: string },
  ): Promise<{ url: string; headers?: Headers }>
  /**
   * Emails a sign-in link to an operator address during the first start,
   * once core has accepted the setup link.
   */
  sendSetupLink?(request: Request, input: { email: string }): Promise<void>
  /** The GitHub sign-in waiting in this browser for an email address. */
  pendingGitHub?(request: Request): Promise<{ login: string | null } | null>
}

export interface SignInResult {
  person: PersonActor | null
  /**
   * Headers to add to the response, whoever is signed in: for example a
   * refreshed or cleared sign-in session cookie (`Set-Cookie`).
   */
  headers?: Headers
}

/** Nobody is ever signed in, for example while testing public routes. */
export const noSignIn: SignIn = {
  currentPerson: () => Promise.resolve({ person: null }),
  methods: { github: false },
}

export interface SignedInEnv {
  Variables: { person: PersonActor }
}

/**
 * Lets a request through only with a signed-in person, who is then available
 * as `c.var.person`. Who may do what is still decided by core. Headers from
 * the sign-in layer are added to the response, including error responses.
 */
export function requirePerson(signIn: SignIn): MiddlewareHandler<SignedInEnv> {
  return async (c, next) => {
    const { person, headers } = await signIn.currentPerson(c.req.raw)
    if (!person) {
      const response = errorResponse(c, 401, {
        error: "sign-in-required",
        message: "Sign in to continue",
      })
      appendHeaders(response.headers, headers)
      return response
    }
    c.set("person", person)
    await next()
    appendHeaders(c.res.headers, headers)
  }
}

export function appendHeaders(
  target: Headers,
  extra: Headers | undefined,
): void {
  // Iterating Headers yields each Set-Cookie value separately.
  for (const [name, value] of extra ?? []) target.append(name, value)
}
