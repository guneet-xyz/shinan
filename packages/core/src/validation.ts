import { schema } from "@shinan/db"
import type { Role } from "@shinan/db"

import { InvalidInputError } from "./errors.js"

const idPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Whether a value has the shape of a record ID (a UUID). */
export function isId(value: string): boolean {
  return idPattern.test(value)
}

/** Lowercase letters, digits and hyphens (identity §8.7). */
const handlePattern = /^[a-z0-9-]+$/

/**
 * Written forms identity §8.7 gives to actors that are not people: Shinan
 * itself and unknown imported actors. A person's handle is their written
 * form, so it may never be one of these.
 */
export const reservedHandles: readonly string[] = ["shinan", "unknown"]

export function checkHandle(handle: string): string {
  if (!handlePattern.test(handle)) {
    throw new InvalidInputError(
      "handle-format",
      "A handle uses only lowercase letters, digits and hyphens",
    )
  }
  if (reservedHandles.includes(handle)) {
    throw new InvalidInputError(
      "handle-reserved",
      "That handle is the written form of another kind of actor",
    )
  }
  return handle
}

/** The longest name or title accepted, such as a workspace's name. */
export const nameLengthLimit = 100

/**
 * Checks a name or title, returning it without surrounding spaces. Names are
 * copied into events and the security log, which is kept forever, so they
 * are kept short.
 */
export function checkName(value: string, what: string): string {
  const trimmed = value.trim()
  if (trimmed === "") {
    throw new InvalidInputError("name-blank", `${what} must not be blank`)
  }
  if ([...trimmed].length > nameLengthLimit) {
    throw new InvalidInputError(
      "name-too-long",
      `${what} must be at most ${nameLengthLimit} characters`,
    )
  }
  return trimmed
}

/**
 * The email addresses Shinan accepts: the same rule as the sign-in layer's
 * (zod's `z.email()`, which Better Auth uses), so an address Shinan stores
 * can always be sent a sign-in link. A domain needs a dot, so addresses
 * such as `you@localhost` are refused.
 */
const emailPattern =
  /^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/

export function isEmailAddress(value: string): boolean {
  return emailPattern.test(value)
}

/** Email addresses are compared without regard to case. */
export function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase()
  if (!isEmailAddress(normalized)) {
    throw new InvalidInputError("email-format", "Not an email address")
  }
  return normalized
}

/** A workspace role (D-045), checked at run time for input from outside. */
export function checkRole(value: unknown): Role {
  if (!schema.roles.includes(value as Role)) {
    throw new InvalidInputError(
      "role-unknown",
      "A role is either owner or contributor",
    )
  }
  return value as Role
}
