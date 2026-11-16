/**
 * The constraint a unique violation (SQLSTATE 23505) broke, or undefined for
 * any other error. Drizzle wraps the driver's error, so causes are checked
 * too.
 */
export function violatedUniqueConstraint(error: unknown): string | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 5 && isObject(current); depth++) {
    if (current.code === "23505") {
      return typeof current.constraint === "string" ? current.constraint : ""
    }
    current = current.cause
  }
  return undefined
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
