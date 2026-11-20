import { parentPort } from "node:worker_threads"

import { checkMain } from "./checks.js"
import type { MainCheckInput } from "./checks.js"

/**
 * The worker thread that runs the checks of `main` (`checks.ts`), so the
 * text agents push is parsed and validated off the `git` role's event
 * loop, within a heap limit, and can be stopped at its time limit. It keeps
 * its parsed documents by blob ID between pushes.
 */
parentPort?.on("message", (request: { id: number; input: MainCheckInput }) => {
  checkMain(request.input).then(
    (output) => parentPort!.postMessage({ id: request.id, output }),
    (error: unknown) =>
      parentPort!.postMessage({
        id: request.id,
        error: error instanceof Error ? error.message : String(error),
      }),
  )
})
parentPort?.postMessage({ ready: true })
