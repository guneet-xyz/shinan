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
   * The person signed in on this request, or null when nobody is. Sets
   * `reauthenticated` when the person signed in again recently enough for
   * sensitive actions (identity §3.3); core decides which actions need it.
   */
  currentPerson(request: Request): Promise<PersonActor | null>
  /**
   * Serves the sign-in routes under `/api/auth` (email magic link, GitHub,
   * sign-out), which the web app's sign-in pages call. Without it, those
   * routes answer 404.
   */
  handle?(request: Request): Promise<Response>
}

/** Nobody is ever signed in: the default until sign-in exists. */
export const noSignIn: SignIn = {
  currentPerson: () => Promise.resolve(null),
}

export interface SignedInEnv {
  Variables: { person: PersonActor }
}

/**
 * Lets a request through only with a signed-in person, who is then available
 * as `c.var.person`. Who may do what is still decided by core.
 */
export function requirePerson(signIn: SignIn): MiddlewareHandler<SignedInEnv> {
  return async (c, next) => {
    const person = await signIn.currentPerson(c.req.raw)
    if (!person) {
      return errorResponse(c, 401, {
        error: "sign-in-required",
        message: "Sign in to continue",
      })
    }
    c.set("person", person)
    await next()
  }
}
