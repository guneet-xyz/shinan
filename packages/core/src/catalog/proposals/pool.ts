import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { Worker } from "node:worker_threads"

import {
  BusyError,
  InvalidInputError,
  RuleViolationError,
} from "../../errors.js"
import { cacheKey } from "./protocol.js"
import type {
  LoadedText,
  WorkerOptions,
  WorkerRequest,
  WorkerResponse,
} from "./protocol.js"
import type { Prepared, PrepareInput } from "./work.js"

/**
 * Limits of the catalog workers. **Proposed (M2-4):** the numbers below,
 * sized so that a workspace at its catalog size limit (`catalogLimits`)
 * fits in one worker's cache and heap.
 */
export interface CatalogWorkerOptions {
  /** How long one proposal may take to apply, validate and classify, once its documents are parsed. */
  timeLimitMs?: number
  /** How long one batch of stored texts may take to parse. */
  loadLimitMs?: number
  /** Stored texts read and parsed per batch. */
  loadBatch?: number
  /** Each worker's parse cache, in estimated bytes (`estimatedBytes`). */
  cacheBytes?: number
  /** Each worker's heap limit (`resourceLimits.maxOldGenerationSizeMb`). */
  heapMb?: number
  /** Workers kept at once, one per workspace; an idle one makes way for another workspace. */
  workers?: number
  /** Requests one workspace may have running or waiting. */
  queuePerWorkspace?: number
  /** Requests all workspaces may have running or waiting. */
  queueTotal?: number
}

export const defaultWorkerOptions: Required<CatalogWorkerOptions> = {
  /**
   * 20 s. A proposal on the trial's catalog takes milliseconds; the slowest
   * one within the limits (a 100-fact recheck of a 54 KB document) took
   * about 8 s on a busy Daedalus.
   */
  timeLimitMs: 20_000,
  /** 60 s for 100 texts: about 2 s for 100 documents of 57 KB. */
  loadLimitMs: 60_000,
  loadBatch: 100,
  /** 768 MiB: a workspace at its size limit, 100 MiB of text, estimates at most about 720 MiB. */
  cacheBytes: 768 * 1024 * 1024,
  /** 1.5 GiB: the cache, and one proposal's work on top. */
  heapMb: 1536,
  workers: 2,
  queuePerWorkspace: 8,
  queueTotal: 32,
}

/** How long a refused request is told to wait before sending again. */
const retryAfterSeconds = 5

/** The stored documents a proposal applies to: their IDs and revisions. */
export interface LatestDocument {
  documentId: string
  revision: number
}

/** Reads the stored text of the given documents at the given revisions. */
export type TextLoader = (
  documents: readonly LatestDocument[],
) => Promise<LoadedText[]>

/**
 * The catalog workers (security checklist 10.8): one worker thread per
 * workspace with proposals, up to `workers` at once, each keeping that
 * workspace's catalog parsed.
 *
 * - **Loading is not charged to a proposal.** Documents a worker has not
 *   parsed are read and parsed first, in batches of `loadBatch`, each with
 *   its own limit, and kept as they come; a proposal's time limit starts
 *   once every document it needs is parsed.
 * - **A proposal past its time limit** stops only its own workspace's
 *   worker; the next proposal there loads the catalog again.
 * - **Memory** is bounded by each cache's byte budget and each worker's
 *   heap limit; a worker out of memory is stopped like one out of time.
 * - **Queues are bounded**, per workspace and in all; a request beyond them
 *   is refused at once with `BusyError`, to send again later.
 *
 * Callers hold no database connection or lock while they wait: texts are
 * read through `TextLoader`, in short reads of their own.
 */
export class CatalogWorkers {
  private readonly options: Required<CatalogWorkerOptions>
  private readonly slots = new Map<string, Slot>()
  /** Requests waiting for a worker of their own, oldest first. */
  private readonly waiting: (() => void)[] = []
  private total = 0

  constructor(options: CatalogWorkerOptions = {}) {
    this.options = { ...defaultWorkerOptions, ...options }
  }

  /** Applies a proposal to a workspace's documents, in that workspace's worker. */
  async prepare(
    workspaceId: string,
    documents: readonly LatestDocument[],
    load: TextLoader,
    input: PrepareInput,
  ): Promise<Prepared> {
    const counted = this.slots.get(workspaceId)?.requests ?? 0
    if (
      counted >= this.options.queuePerWorkspace ||
      this.total >= this.options.queueTotal
    )
      throw new BusyError(
        "catalog-busy",
        "Shinan is applying other catalog proposals; send this one again in a few seconds",
        retryAfterSeconds,
      )
    this.total++
    const slot = this.slotFor(workspaceId)
    slot.requests++
    try {
      return await slot.run(async () => {
        await this.claim(slot)
        return slot.prepare(documents, load, input)
      })
    } finally {
      slot.requests--
      this.total--
      if (slot.requests === 0) {
        if (!slot.started && this.slots.get(workspaceId) === slot)
          this.slots.delete(workspaceId)
        this.release()
      }
    }
  }

  /** Stops every worker; the next request starts new ones. */
  async close(): Promise<void> {
    const slots = [...this.slots.values()]
    this.slots.clear()
    await Promise.all(slots.map((slot) => slot.stop()))
  }

  private slotFor(workspaceId: string): Slot {
    let slot = this.slots.get(workspaceId)
    if (!slot) {
      slot = new Slot(workspaceId, this.options)
      this.slots.set(workspaceId, slot)
    }
    return slot
  }

  /**
   * Waits until the slot may have a worker: it has one, or fewer than
   * `workers` slots do, or an idle slot gives its worker up.
   */
  private async claim(slot: Slot): Promise<void> {
    for (;;) {
      if (slot.started) return
      const started = [...this.slots.values()].filter((s) => s.started)
      if (started.length < this.options.workers) {
        slot.started = true
        return
      }
      const idle = started
        .filter((s) => s.requests === 0)
        .sort((a, b) => a.lastUsed - b.lastUsed)[0]
      if (idle) {
        this.slots.delete(idle.workspaceId)
        await idle.stop()
        continue
      }
      await new Promise<void>((resolve) => this.waiting.push(resolve))
    }
  }

  private release() {
    for (const resolve of this.waiting.splice(0)) resolve()
  }
}

/** One workspace's worker and its requests, one at a time. */
class Slot {
  worker: Worker | null = null
  /** The worker, once it has started and said so. */
  private ready: Promise<Worker> | null = null
  started = false
  requests = 0
  lastUsed = 0
  /** Keys whose parsed text the current worker holds. */
  private readonly known = new Set<string>()
  private queue: Promise<unknown> = Promise.resolve()
  private nextId = 1
  private pending: {
    id: number
    resolve: (response: WorkerResponse) => void
    reject: (error: Error) => void
  } | null = null

  constructor(
    readonly workspaceId: string,
    private readonly options: Required<CatalogWorkerOptions>,
  ) {}

  run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work)
    this.queue = result.catch(() => undefined)
    return result
  }

  async prepare(
    documents: readonly LatestDocument[],
    load: TextLoader,
    input: PrepareInput,
  ): Promise<Prepared> {
    this.lastUsed = Date.now()
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.load(
        documents.filter(
          (d) => !this.known.has(cacheKey(d.documentId, d.revision)),
        ),
        load,
      )
      const response = await this.post(
        {
          id: this.nextId++,
          type: "prepare",
          documents: documents.map((d) => ({
            documentId: d.documentId,
            revision: d.revision,
          })),
          input,
        },
        this.options.timeLimitMs,
        () =>
          new InvalidInputError(
            "too-complex",
            `Shinan stopped applying this proposal after ${this.options.timeLimitMs / 1000} seconds. Split it into smaller proposals.`,
          ),
      )
      if (response.outcome === "done") return response.result
      if (response.outcome === "failed")
        throw new Error(`The catalog worker failed: ${response.message}`)
      if (response.outcome === "missing")
        for (const key of response.missing) this.known.delete(key)
    }
    throw new RuleViolationError(
      "catalog-too-large",
      "This workspace's catalog does not fit in the catalog worker's memory",
    )
  }

  /** Reads and parses stored texts in batches, keeping each as it comes. */
  private async load(
    documents: readonly LatestDocument[],
    load: TextLoader,
  ): Promise<void> {
    for (let i = 0; i < documents.length; i += this.options.loadBatch) {
      const texts = await load(documents.slice(i, i + this.options.loadBatch))
      await this.post(
        { id: this.nextId++, type: "load", texts },
        this.options.loadLimitMs,
        () =>
          new RuleViolationError(
            "catalog-unreadable",
            "Shinan could not read this workspace's stored catalog in time",
          ),
      )
      for (const text of texts)
        this.known.add(cacheKey(text.documentId, text.revision))
    }
  }

  private async post(
    request: WorkerRequest,
    limitMs: number,
    timeout: () => Error,
  ): Promise<WorkerResponse> {
    // Starting a thread is not charged to the request either.
    const worker = await this.start()
    return new Promise<WorkerResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null
        void this.stop()
        reject(timeout())
      }, limitMs)
      const settle = () => {
        clearTimeout(timer)
        worker.unref()
      }
      this.pending = {
        id: request.id,
        resolve: (response) => {
          settle()
          for (const key of response.evicted) this.known.delete(key)
          resolve(response)
        },
        reject: (error) => {
          settle()
          reject(error)
        },
      }
      worker.ref()
      worker.postMessage(request)
    })
  }

  private start(): Promise<Worker> {
    if (this.worker && this.ready) return this.ready
    const source = import.meta.url.endsWith(".ts")
    const workerOptions: WorkerOptions = { cacheBytes: this.options.cacheBytes }
    const worker = new Worker(
      new URL(source ? "./worker.ts" : "./worker.js", import.meta.url),
      {
        workerData: workerOptions,
        resourceLimits: { maxOldGenerationSizeMb: this.options.heapMb },
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
    this.ready = new Promise<Worker>((resolve, reject) => {
      worker.once("message", () => resolve(worker))
      worker.once("error", reject)
      worker.once("exit", (code) =>
        reject(new Error(`The catalog worker stopped (exit code ${code})`)),
      )
    })
    worker.on("message", (response: WorkerResponse | { ready: true }) => {
      if ("ready" in response) return
      const pending = this.pending
      if (!pending || pending.id !== response.id) return
      this.pending = null
      pending.resolve(response)
    })
    const fail = (error: Error) => {
      if (this.worker !== worker) return
      const pending = this.pending
      this.discard()
      pending?.reject(
        (error as { code?: string }).code === "ERR_WORKER_OUT_OF_MEMORY"
          ? new RuleViolationError(
              "catalog-too-large",
              "The catalog worker ran out of memory applying this proposal",
            )
          : error,
      )
    }
    worker.on("error", fail)
    worker.on("exit", (code) =>
      fail(new Error(`The catalog worker stopped (exit code ${code})`)),
    )
    this.worker = worker
    return this.ready
  }

  /** Stops the worker; the next request starts a new one, with an empty cache. */
  async stop(): Promise<void> {
    const worker = this.worker
    this.discard()
    await worker?.terminate()
  }

  private discard() {
    this.worker = null
    this.ready = null
    this.pending = null
    this.known.clear()
  }
}

let shared: CatalogWorkers | null = null

/** The process's catalog workers. */
export function catalogWorkers(): CatalogWorkers {
  shared ??= new CatalogWorkers()
  return shared
}

/** Replaces the process's catalog workers, for tests. */
export function replaceCatalogWorkers(
  workers: CatalogWorkers,
): CatalogWorkers | null {
  const previous = shared
  shared = workers
  return previous
}
