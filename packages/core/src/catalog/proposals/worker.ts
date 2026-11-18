import { parentPort, workerData } from "node:worker_threads"

import { CatalogCache } from "./cache.js"
import type {
  WorkerOptions,
  WorkerRequest,
  WorkerResponse,
} from "./protocol.js"

/**
 * A catalog worker: a worker thread that keeps one workspace's catalog
 * parsed and validated (`CatalogCache`) and applies, validates and
 * classifies its proposals, so text from outside never runs on the main
 * event loop (security checklist 10.8). `pool.ts` sends it stored texts to
 * parse, in batches, and proposals, each with a time limit after which it
 * stops the thread.
 */

const options = workerData as WorkerOptions
const cache = new CatalogCache(options.cacheBytes)

function handle(request: WorkerRequest): WorkerResponse {
  const evicted: string[] = []
  try {
    if (request.type === "load") {
      cache.load(request.texts, evicted)
      return { id: request.id, outcome: "loaded", evicted }
    }
    if (request.type === "validate")
      return {
        id: request.id,
        ...cache.validate(request.documents, request.input),
        evicted,
      }
    return {
      id: request.id,
      ...cache.prepare(request.documents, request.input),
      evicted,
    }
  } catch (error) {
    return {
      id: request.id,
      outcome: "failed",
      message: error instanceof Error ? error.message : String(error),
      evicted,
    }
  }
}

parentPort?.on("message", (request: WorkerRequest) => {
  parentPort!.postMessage(handle(request))
})
parentPort?.postMessage({ ready: true })
