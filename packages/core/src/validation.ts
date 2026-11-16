import { RuleViolationError } from "./errors.js"

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
    throw new RuleViolationError(
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
    throw new RuleViolationError("name-blank", `${what} must not be blank`)
  }
  return trimmed
}

/** Email addresses are compared without regard to case. */
export function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+$/.test(normalized)) {
    throw new RuleViolationError("email-format", "Not an email address")
  }
  return normalized
}
