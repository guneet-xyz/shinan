import { setImmediate } from "node:timers/promises"

/**
 * How long work may hold the event loop before it gives it back
 * (**proposed**, #135): 50 ms. A rebuild of the agent index, or the daily
 * round-trip check, runs for minutes in the worker's process beside every
 * other job (email, invitations, clean-ups); giving the loop back this
 * often keeps those jobs, and their timers, on time, at a cost of a few
 * hundred yields a second, which is too small to measure.
 */
export const eventLoopBudgetMs = 50

/**
 * A pause point for long synchronous work: call it between steps (between
 * documents, between revisions of a document's history), and it yields to
 * the event loop once the work since the last yield has taken `budgetMs`.
 * Yielding never changes what the work produces, only when it runs.
 */
export function pauser(
  budgetMs: number = eventLoopBudgetMs,
): () => Promise<void> {
  let since = performance.now()
  return async () => {
    if (performance.now() - since < budgetMs) return
    await setImmediate()
    since = performance.now()
  }
}
