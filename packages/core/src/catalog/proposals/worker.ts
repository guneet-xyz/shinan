import { parentPort, workerData } from "node:worker_threads"

import { parseCatalogDocument } from "../document/index.js"
import type { CatalogDocument } from "../document/index.js"
import { estimatedBytes } from "./estimate.js"
import { cacheKey } from "./protocol.js"
import type {
  LoadedText,
  WorkerOptions,
  WorkerRequest,
  WorkerResponse,
} from "./protocol.js"
import { prepareChange } from "./work.js"
import type { StoredDocument } from "./work.js"

/**
 * A catalog worker: a worker thread that keeps one workspace's catalog
 * parsed and applies, validates and classifies its proposals, so text from
 * outside never runs on the main event loop (security checklist 10.8).
 * `pool.ts` sends it stored texts to parse, in batches, and proposals, each
 * with a time limit after which it stops the thread.
 */

const options = workerData as WorkerOptions

interface Cached {
  documentId: string
  document: CatalogDocument
  bytes: number
}

/** Parsed documents by `documentId@revision`, least recently used first. */
const cache = new Map<string, Cached>()
/** The cached revision of each document: one at a time. */
const revisions = new Map<string, number>()
let cachedBytes = 0

function drop(key: string, evicted: string[]) {
  const entry = cache.get(key)
  if (!entry) return
  cache.delete(key)
  cachedBytes -= entry.bytes
  if (revisions.get(entry.documentId) === Number(key.split("@")[1]))
    revisions.delete(entry.documentId)
  evicted.push(key)
}

/** Least recently used first, never the documents `keep` names. */
function evictOver(
  budget: number,
  keep: ReadonlySet<string>,
  evicted: string[],
) {
  for (const key of [...cache.keys()]) {
    if (cachedBytes <= budget) return
    if (!keep.has(key)) drop(key, evicted)
  }
}

function load(texts: readonly LoadedText[], evicted: string[]) {
  const keep = new Set<string>()
  for (const { documentId, revision, text } of texts) {
    const key = cacheKey(documentId, revision)
    keep.add(key)
    if (cache.has(key)) continue
    // A document's earlier revision is not needed again.
    const earlier = revisions.get(documentId)
    if (earlier !== undefined) drop(cacheKey(documentId, earlier), evicted)
    const document = parseCatalogDocument(text)
    const bytes = estimatedBytes(document)
    cache.set(key, { documentId, document, bytes })
    revisions.set(documentId, revision)
    cachedBytes += bytes
  }
  evictOver(options.cacheBytes, keep, evicted)
}

function handle(request: WorkerRequest): WorkerResponse {
  const evicted: string[] = []
  try {
    if (request.type === "load") {
      load(request.texts, evicted)
      return { id: request.id, outcome: "loaded", evicted }
    }
    const keys = request.documents.map((d) =>
      cacheKey(d.documentId, d.revision),
    )
    const missing = keys.filter((key) => !cache.has(key))
    if (missing.length > 0)
      return { id: request.id, outcome: "missing", missing, evicted }
    const stored: StoredDocument[] = keys.map((key) => {
      const entry = cache.get(key)!
      cache.delete(key)
      cache.set(key, entry)
      return { documentId: entry.documentId, document: entry.document }
    })
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
parentPort?.postMessage({ ready: true })
