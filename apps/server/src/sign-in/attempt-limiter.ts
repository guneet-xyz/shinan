export type Attempt = "allowed" | "refused" | "first-refusal"

/**
 * Counts attempts per key (a network address) in fixed windows, in this
 * process's memory. Says which refusal is the first in its window, so a
 * caller can record one entry per flood rather than one per attempt.
 */
export function createAttemptLimiter(options: {
  max: number
  windowMs: number
  now?: () => number
}) {
  const now = options.now ?? Date.now
  const windows = new Map<
    string,
    { start: number; count: number; refused: boolean }
  >()

  return {
    take(key: string): Attempt {
      const time = now()
      if (windows.size > 10_000) {
        for (const [k, w] of windows) {
          if (time - w.start >= options.windowMs) windows.delete(k)
        }
      }
      let window = windows.get(key)
      if (!window || time - window.start >= options.windowMs) {
        window = { start: time, count: 0, refused: false }
        windows.set(key, window)
      }
      window.count++
      if (window.count <= options.max) return "allowed"
      if (window.refused) return "refused"
      window.refused = true
      return "first-refusal"
    },
  }
}
