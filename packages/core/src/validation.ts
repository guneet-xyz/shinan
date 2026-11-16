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

export function checkHandle(handle: string): string {
  if (!handlePattern.test(handle)) {
    throw new InvalidInputError(
      "handle-format",
      "A handle uses only lowercase letters, digits and hyphens",
    )
  }
  return handle
}

/** Checks a name or title, returning it without surrounding spaces. */
export function checkName(value: string, what: string): string {
  const trimmed = value.trim()
  if (trimmed === "") {
    throw new InvalidInputError("name-blank", `${what} must not be blank`)
  }
  return trimmed
}

/** Email addresses are compared without regard to case. */
export function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+$/.test(normalized)) {
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
