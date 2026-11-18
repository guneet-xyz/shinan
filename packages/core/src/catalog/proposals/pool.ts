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
 * fits in one worker's cache and heap with margin.
 */
export interface CatalogWorkerOptions {
  /** How long one proposal may take to apply, validate and classify, once its documents are parsed. */
  timeLimitMs?: number
  /** How long one batch of stored texts may take to parse. */
  loadLimitMs?: number
  /** How long validating the latest revision may take, once it is parsed. */
  validateLimitMs?: number
  /** Stored texts read from the database at a time. */
  readBatch?: number
  /** Bytes of stored text parsed per batch, each batch with its own limit. */
  loadBatchBytes?: number
  /** Each worker's parse cache, in estimated bytes (`estimatedBytes`). */
  cacheBytes?: number
  /** Each worker's heap limit (`resourceLimits.maxOldGenerationSizeMb`). */
  heapMb?: number
  /** Workers at once, each keeping one workspace's catalog. */
  workers?: number
  /** Requests one workspace may have running or waiting. */
  queuePerWorkspace?: number
  /** Requests all workspaces may have running or waiting. */
  queueTotal?: number
}

export const defaultWorkerOptions: Required<CatalogWorkerOptions> = {
  /**
   * 20 s. On a catalog at its limits, on Daedalus under a load of 6 to 10
   * on 2 cores, a one-field change took 0.1 to 2 s, and extending the type
   * of every document 0.1 to 1.3 s, the latest revision being validated
   * while loading; the slowest proposal within the operation limits (a
   * 100-fact recheck of a 54 KB document) took about 8 s under a load of 4
   * to 5.
   */
  timeLimitMs: 20_000,
  /**
   * 60 s per batch of 512 KiB: parsing took at most about 2 ms per KB
   * (documents full of facts, or of links), so about 1 s a batch.
   */
  loadLimitMs: 60_000,
  /**
   * 60 s. Validating every document of a catalog at its limits, as after a
   * start, took 1 to 6 s on Daedalus under a load of 6 to 9, and 14 s for
   * 49 MiB of prose under a load of 9 to 18, most of it the secret check.
   */
  validateLimitMs: 60_000,
  readBatch: 100,
  loadBatchBytes: 512 * 1024,
  /**
   * 384 MiB of parsed documents (`estimatedBytes` without the validation):
   * a catalog at its limit estimates at most 320 MiB, its kept validation
   * included.
   */
  cacheBytes: 384 * 1024 * 1024,
  /**
   * 768 MiB. Loading a catalog at its limits, validating it and applying
   * one-field changes to it ran within a 384 MiB heap for every shape
   * measured, keeping 65 to 263 MiB after collection (#116); 640 MiB is
   * the least the server accepts. Operators set it with
   * `SHINAN_CATALOG_WORKER_HEAP_MB`.
   */
  heapMb: 768,
  /**
   * One: the reference host shares 8 GiB with other services. Operators
   * set it with `SHINAN_CATALOG_WORKERS`.
   */
  workers: 1,
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

/** Applies a proposal to these documents in the workspace's worker. */
export type Prepare = (
  documents: readonly LatestDocument[],
  load: TextLoader,
  input: PrepareInput,
) => Promise<Prepared>

/**
 * The catalog workers (security checklist 10.8): worker threads, `workers`
 * of them, each keeping one workspace's catalog parsed.
 *
 * - **One turn at a time per workspace, first come first served.** A turn
 *   (`run`) is a whole proposal: reading the latest revision, applying in
 *   the worker and storing. So within a process no proposal works on a
 *   revision that another one replaces before it is stored.
 * - **Workers are shared fairly.** A turn takes one of `workers` permits,
 *   first come first served across workspaces. A workspace without a
 *   worker then takes over the one least recently used.
 * - **Loading is not charged to a proposal.** Documents a worker has not
 *   parsed are read and parsed first, in batches of `loadBatchBytes`, each
 *   with its own limit, and kept as they come; then the latest revision is
 *   validated, under `validateLimitMs` (`CatalogCache.validate`). A
 *   proposal's time limit starts once that is done.
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
  private readonly permits: Permits
  private total = 0

  constructor(options: CatalogWorkerOptions = {}) {
    this.options = { ...defaultWorkerOptions, ...options }
    this.permits = new Permits(this.options.workers)
  }

  /**
   * Takes a turn in the workspace's queue: `work` runs when every earlier
   * turn of the workspace has finished, with the workspace's worker.
   * Throws `BusyError` at once when the queues are full.
   */
  async run<T>(
    workspaceId: string,
    work: (prepare: Prepare) => Promise<T>,
  ): Promise<T> {
    const queued = this.slots.get(workspaceId)?.requests ?? 0
    if (
      queued >= this.options.queuePerWorkspace ||
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
        await this.permits.acquire()
        slot.inTurn = true
        try {
          await this.claim(slot)
          return await work((documents, load, input) =>
            slot.prepare(documents, load, input),
          )
        } finally {
          slot.inTurn = false
          this.permits.release()
        }
      })
    } finally {
      slot.requests--
      this.total--
      if (
        slot.requests === 0 &&
        !slot.started &&
        this.slots.get(workspaceId) === slot
      )
        this.slots.delete(workspaceId)
    }
  }

  /** Applies a proposal to a workspace's documents, in a turn of its own. */
  prepare(
    workspaceId: string,
    documents: readonly LatestDocument[],
    load: TextLoader,
    input: PrepareInput,
  ): Promise<Prepared> {
    return this.run(workspaceId, (prepare) => prepare(documents, load, input))
  }

  /**
   * Drops what the workspace's worker keeps parsed and validated, stopping
   * it; the next proposal there reads the catalog again. For a change to
   * stored text that keeps its revision number, such as purge (catalog
   * §9): make it within the workspace's turn (`run`), so that no proposal
   * works on the old text meanwhile.
   */
  async forget(workspaceId: string): Promise<void> {
    await this.slots.get(workspaceId)?.stop()
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
   * Gives the slot a worker of its own, taking over the least recently
   * used one that is not in a turn when all are taken. One always is:
   * this turn holds one of the `workers` permits.
   */
  private async claim(slot: Slot): Promise<void> {
    if (slot.started) return
    const started = [...this.slots.values()].filter((s) => s.started)
    if (started.length >= this.options.workers) {
      const idle = started
        .filter((s) => !s.inTurn)
        .sort((a, b) => a.lastUsed - b.lastUsed)[0]!
      idle.started = false
      if (idle.requests === 0) this.slots.delete(idle.workspaceId)
      await idle.stop()
    }
    slot.started = true
  }
}

/** A first-come, first-served semaphore. */
class Permits {
  private readonly waiting: (() => void)[] = []

  constructor(private free: number) {}

  async acquire(): Promise<void> {
    if (this.free > 0) {
      this.free--
      return
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve))
  }

  release(): void {
    const next = this.waiting.shift()
    if (next) next()
    else this.free++
  }
}

/** One workspace's worker and its requests, one at a time. */
class Slot {
  worker: Worker | null = null
  /** The worker, once it has started and said so. */
  private ready: Promise<Worker> | null = null
  /** Whether the slot holds one of the workers. */
  started = false
  /** Whether one of its turns is running. */
  inTurn = false
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
      const keys = documents.map((d) => ({
        documentId: d.documentId,
        revision: d.revision,
      }))
      // Validating the latest revision is part of loading it, with a
      // limit of its own: after a start it validates every document.
      const validated = await this.post(
        {
          id: this.nextId++,
          type: "validate",
          documents: keys,
          input: { now: input.now, memberHandles: input.memberHandles },
        },
        this.options.validateLimitMs,
        () =>
          new RuleViolationError(
            "catalog-unreadable",
            "Shinan could not validate this workspace's stored catalog in time",
          ),
      )
      if (validated.outcome === "failed")
        throw new Error(`The catalog worker failed: ${validated.message}`)
      if (validated.outcome === "missing") {
        for (const key of validated.missing) this.known.delete(key)
        continue
      }
      const response = await this.post(
        {
          id: this.nextId++,
          type: "prepare",
          documents: keys,
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

  /**
   * Reads stored texts in batches of `readBatch` and parses them in
   * batches of at most `loadBatchBytes`, keeping each as it comes.
   */
  private async load(
    documents: readonly LatestDocument[],
    load: TextLoader,
  ): Promise<void> {
    for (let i = 0; i < documents.length; i += this.options.readBatch) {
      const texts = await load(documents.slice(i, i + this.options.readBatch))
      let batch: LoadedText[] = []
      let bytes = 0
      for (const text of [...texts, null]) {
        const size = text ? Buffer.byteLength(text.text, "utf8") : 0
        if (
          batch.length > 0 &&
          (text === null || bytes + size > this.options.loadBatchBytes)
        ) {
          await this.post(
            { id: this.nextId++, type: "load", texts: batch },
            this.options.loadLimitMs,
            () =>
              new RuleViolationError(
                "catalog-unreadable",
                "Shinan could not read this workspace's stored catalog in time",
              ),
          )
          for (const loaded of batch)
            this.known.add(cacheKey(loaded.documentId, loaded.revision))
          batch = []
          bytes = 0
        }
        if (text) {
          batch.push(text)
          bytes += size
        }
      }
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

/**
 * Sets the limits of the process's catalog workers, when it starts: the
 * server reads `SHINAN_CATALOG_WORKERS` and `SHINAN_CATALOG_WORKER_HEAP_MB`.
 */
export function configureCatalogWorkers(options: CatalogWorkerOptions): void {
  shared = new CatalogWorkers(options)
}

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
