import type { MiddlewareHandler } from "hono"

import type { PersonActor } from "@shinan/core"

import { errorResponse } from "./errors.js"

/**
 * How the API learns who is signed in. This is the one seam between the API
 * and the sign-in layer: sign-in (M1-4) provides the real implementation,
 * backed by sign-in sessions; until then development uses the placeholder in
 * `placeholder-sign-in.ts`.
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
  handle?(request: Request): Promise<Response>
}

export interface SignInResult {
  person: PersonActor | null
  /**
   * Headers to add to the response, whoever is signed in: for example a
   * refreshed or cleared sign-in session cookie (`Set-Cookie`).
   */
  headers?: Headers
}

/** Nobody is ever signed in: the default until sign-in exists. */
export const noSignIn: SignIn = {
  currentPerson: () => Promise.resolve({ person: null }),
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

function appendHeaders(target: Headers, extra: Headers | undefined): void {
  // Iterating Headers yields each Set-Cookie value separately.
  for (const [name, value] of extra ?? []) target.append(name, value)
}
