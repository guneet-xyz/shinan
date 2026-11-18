import { parentPort, workerData } from "node:worker_threads"

import { parseCatalogDocument } from "../document/index.js"
import type { CatalogDocument } from "../document/index.js"
import { cacheKey } from "./protocol.js"
import type { WorkerRequest, WorkerResponse } from "./protocol.js"
import { prepareChange } from "./work.js"
import type { StoredDocument } from "./work.js"

/**
 * The catalog worker: a worker thread that parses, applies and validates
 * catalog proposals, so text from outside never runs on the main event
 * loop (security checklist 10.8). `pool.ts` sends it work and stops it when
 * it runs past its time limit.
 */

const cacheSize: number =
  (workerData as { cacheSize?: number } | null)?.cacheSize ?? 10_000

/** Parsed documents by `documentId@revision`, least recently used first. */
const cache = new Map<string, CatalogDocument>()

function handle(request: WorkerRequest): WorkerResponse {
  const evicted: string[] = []
  const missing = request.documents
    .filter(
      (d) =>
        d.text === undefined && !cache.has(cacheKey(d.documentId, d.revision)),
    )
    .map((d) => cacheKey(d.documentId, d.revision))
  if (missing.length > 0)
    return { id: request.id, outcome: "missing", missing, evicted }
  try {
    const stored: StoredDocument[] = request.documents.map((d) => {
      const key = cacheKey(d.documentId, d.revision)
      let document = cache.get(key)
      if (document) cache.delete(key)
      else document = parseCatalogDocument(d.text!)
      cache.set(key, document)
      return { documentId: d.documentId, document }
    })
    while (cache.size > cacheSize) {
      const oldest = cache.keys().next().value!
      cache.delete(oldest)
      evicted.push(oldest)
    }
    return {
      id: request.id,
      outcome: "done",
      result: prepareChange(stored, request.input),
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
