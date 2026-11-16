import type { PersonActor } from "@shinan/core"

import type { SignIn } from "../src/api/sign-in.js"

/**
 * Sign-in for tests: the `x-test-person` header names the signed-in person's
 * ID, and `x-test-reauthenticated: false` makes their sign-in too old for
 * sensitive actions.
 */
export const testSignIn: SignIn = {
  currentPerson(request) {
    const personId = request.headers.get("x-test-person")
    if (!personId) return Promise.resolve(null)
    const person: PersonActor = {
      kind: "person",
      personId,
      reauthenticated:
        request.headers.get("x-test-reauthenticated") !== "false",
    }
    return Promise.resolve(person)
  },
}

/** Request headers that sign in as a person. */
export function as(
  person: { id: string },
  options: { reauthenticated?: boolean } = {},
): Record<string, string> {
  return {
    "x-test-person": person.id,
    "x-test-reauthenticated": String(options.reauthenticated ?? true),
  }
}
