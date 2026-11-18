import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { Worker } from "node:worker_threads"

import { InvalidInputError } from "../../errors.js"
import { cacheKey } from "./protocol.js"
import type {
  WorkerDocument,
  WorkerRequest,
  WorkerResponse,
} from "./protocol.js"
import type { Prepared, PrepareInput } from "./work.js"

export interface CatalogWorkerOptions {
  /** How long one proposal may take to apply and validate. */
  timeLimitMs?: number
  /** How many parsed documents the worker keeps. */
  cacheSize?: number
}

/** **Proposed (M2-4):** 10 seconds; a proposal on the trial's catalog takes milliseconds. */
export const defaultTimeLimitMs = 10_000

/** The stored documents a proposal applies to: their IDs and revisions. */
export interface LatestDocument {
  documentId: string
  revision: number
}

/** Loads the stored text of the given documents at their latest revisions. */
export type TextLoader = (
  documents: readonly LatestDocument[],
) => Promise<Map<string, string>>

/**
 * Runs catalog work in one worker thread, one request at a time, and stops
 * the thread when a request runs past the time limit (security checklist
 * 10.8): a pathological text costs that request, never the server. The
 * worker keeps parsed documents between requests, so each proposal sends
 * only the texts it does not have.
 */
export class CatalogWorker {
  private worker: Worker | null = null
  /** Keys whose parsed text the current worker holds. */
  private readonly known = new Set<string>()
  private queue: Promise<unknown> = Promise.resolve()
  private nextId = 1
  private pending: {
    id: number
    resolve: (response: WorkerResponse) => void
    reject: (error: Error) => void
  } | null = null

  constructor(private readonly options: CatalogWorkerOptions = {}) {}

  /** Applies and validates a proposal against the given documents. */
  prepare(
    documents: readonly LatestDocument[],
    load: TextLoader,
    input: PrepareInput,
  ): Promise<Prepared> {
    const run = this.queue.then(() => this.run(documents, load, input))
    this.queue = run.catch(() => undefined)
    return run
  }

  /** Stops the worker thread; the next request starts a new one. */
  async close(): Promise<void> {
    const worker = this.worker
    this.discard()
    await worker?.terminate()
  }

  private async run(
    documents: readonly LatestDocument[],
    load: TextLoader,
    input: PrepareInput,
  ): Promise<Prepared> {
    let send = await this.withTexts(
      documents,
      documents.filter(
        (d) => !this.known.has(cacheKey(d.documentId, d.revision)),
      ),
      load,
    )
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await this.post({
        id: this.nextId++,
        documents: send,
        input,
      })
      for (const key of response.evicted) this.known.delete(key)
      if (response.outcome === "done") return response.result
      if (response.outcome === "failed")
        throw new Error(`The catalog worker failed: ${response.message}`)
      const missing = new Set(response.missing)
      for (const key of missing) this.known.delete(key)
      send = await this.withTexts(
        documents,
        documents.filter((d) =>
          missing.has(cacheKey(d.documentId, d.revision)),
        ),
        load,
      )
    }
    throw new Error("The catalog worker kept losing parsed documents")
  }

  private async withTexts(
    documents: readonly LatestDocument[],
    unknown: readonly LatestDocument[],
    load: TextLoader,
  ): Promise<WorkerDocument[]> {
    const texts =
      unknown.length === 0 ? new Map<string, string>() : await load(unknown)
    return documents.map((d) => {
      const text = texts.get(d.documentId)
      return text === undefined
        ? { documentId: d.documentId, revision: d.revision }
        : { documentId: d.documentId, revision: d.revision, text }
    })
  }

  private post(request: WorkerRequest): Promise<WorkerResponse> {
    const worker = this.start()
    const limit = this.options.timeLimitMs ?? defaultTimeLimitMs
    return new Promise<WorkerResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null
        void this.close()
        reject(
          new InvalidInputError(
            "too-complex",
            `Shinan stopped applying this proposal after ${limit / 1000} seconds. Split it into smaller proposals.`,
          ),
        )
      }, limit)
      this.pending = {
        id: request.id,
        resolve: (response) => {
          clearTimeout(timer)
          resolve(response)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      }
      worker.ref()
      for (const document of request.documents)
        if (document.text !== undefined)
          this.known.add(cacheKey(document.documentId, document.revision))
      worker.postMessage(request)
    })
  }

  private start(): Worker {
    if (this.worker) return this.worker
    const source = import.meta.url.endsWith(".ts")
    const worker = new Worker(
      new URL(source ? "./worker.ts" : "./worker.js", import.meta.url),
      {
        workerData: { cacheSize: this.options.cacheSize },
        // From source (tests and development), the worker loads TypeScript
        // the way the server does there.
        execArgv: source
          ? [
              "--import",
              pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
              "--conditions=@shinan/source",
            ]
          : [],
      },
    )
    worker.unref()
    worker.on("message", (response: WorkerResponse) => {
      const pending = this.pending
      if (!pending || pending.id !== response.id) return
      this.pending = null
      worker.unref()
      pending.resolve(response)
    })
    const fail = (error: Error) => {
      if (this.worker !== worker) return
      const pending = this.pending
      this.discard()
      pending?.reject(error)
    }
    worker.on("error", fail)
    worker.on("exit", (code) =>
      fail(new Error(`The catalog worker stopped (exit code ${code})`)),
    )
    this.worker = worker
    return worker
  }

  private discard() {
    this.worker = null
    this.pending = null
    this.known.clear()
  }
}

let shared: CatalogWorker | null = null

/** The process's catalog worker. */
export function catalogWorker(): CatalogWorker {
  shared ??= new CatalogWorker()
  return shared
}

/** Replaces the process's catalog worker, for tests of the time limit. */
export function replaceCatalogWorker(
  worker: CatalogWorker,
): CatalogWorker | null {
  const previous = shared
  shared = worker
  return previous
}
