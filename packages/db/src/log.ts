/**
 * Logging errors without their values (architecture §10.3). An error's
 * message and details can quote a query's text and parameters, such as an
 * email address, a network address or a token hash, so only an error's name,
 * its code and, for unexpected errors, its stack frames are ever written.
 */

/**
 * A database error's code, such as a SQLSTATE (`57P01`) or a network error
 * (`ECONNRESET`), looking through wrappers (`cause`, and the first of an
 * `AggregateError`'s errors).
 */
export function databaseErrorCode(error: unknown): string {
  let current: unknown = error
  for (let depth = 0; depth < 5; depth++) {
    if (typeof current !== "object" || current === null) break
    const { code, cause, errors } = current as {
      code?: unknown
      cause?: unknown
      errors?: unknown
    }
    if (typeof code === "string" && /^[A-Za-z0-9_]{1,32}$/.test(code)) {
      return code
    }
    current = cause ?? (Array.isArray(errors) ? errors[0] : undefined)
  }
  return "unknown"
}

/**
 * An error as it may be logged: its name, and its code if it has one, such
 * as `DrizzleQueryError 22P02` or `TypeError`. Never its message.
 */
export function errorSummary(error: unknown): string {
  const valid = (name: unknown): name is string =>
    typeof name === "string" && /^[A-Za-z0-9_]{1,64}$/.test(name)
  // Some libraries' errors keep the name "Error" (pg's: "error"); their
  // class says more.
  const named =
    error instanceof Error && valid(error.name) ? error.name : "Error"
  const className = (error as { constructor?: { name?: unknown } } | null)
    ?.constructor?.name
  const name =
    named.toLowerCase() === "error" &&
    error instanceof Error &&
    valid(className)
      ? className
      : named
  const code = databaseErrorCode(error)
  return code === "unknown" ? name : `${name} ${code}`
}

/**
 * An error's stack frames, without the first line (which repeats the
 * message): where the error happened, never what it was about. At most 10.
 */
export function errorFrames(error: unknown): string {
  if (!(error instanceof Error) || typeof error.stack !== "string") return ""
  return error.stack
    .split("\n")
    .filter((line) => /^\s+at /.test(line))
    .slice(0, 10)
    .join("\n")
}

export interface LimitedLog {
  /**
   * Writes `text` (by default `key`), unless the same `key` was written in
   * the last interval; repeats are counted and the count is written with
   * the next line for that key.
   */
  (key: string, text?: string): void
}

/**
 * A log that writes the same line at most once a minute, so a database that
 * is down, which fails every request, cannot flood the log.
 */
export function createLimitedLog(
  options: {
    intervalMs?: number
    now?: () => number
    write?: (line: string) => void
  } = {},
): LimitedLog {
  const intervalMs = options.intervalMs ?? 60_000
  const now = options.now ?? Date.now
  // Looked up at each call, so tests can watch console.error.
  const write = options.write ?? ((line: string) => console.error(line))
  const seen = new Map<string, { at: number; repeats: number }>()
  return (key, text = key) => {
    const time = now()
    const last = seen.get(key)
    if (last && time - last.at < intervalMs) {
      last.repeats++
      return
    }
    if (seen.size >= 1000) {
      for (const [k, v] of seen) if (time - v.at >= intervalMs) seen.delete(k)
    }
    seen.set(key, { at: time, repeats: 0 })
    const repeats = last?.repeats ?? 0
    if (repeats === 0) return write(text)
    const [first, ...rest] = text.split("\n")
    write(
      [`${first} (and ${repeats} more like it since then)`, ...rest].join("\n"),
    )
  }
}
