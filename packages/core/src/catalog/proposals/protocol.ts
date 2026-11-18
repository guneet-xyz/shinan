import type { Prepared, PrepareInput } from "./work.js"

/** The messages between `pool.ts` and a catalog worker (`worker.ts`). */

/** Stored text to parse and keep: its document, revision and text. */
export interface LoadedText {
  documentId: string
  revision: number
  text: string
}

export type WorkerRequest =
  /** Parse and keep these stored texts. */
  | { id: number; type: "load"; texts: LoadedText[] }
  /** Apply a proposal to these documents, which the worker has parsed. */
  | {
      id: number
      type: "prepare"
      documents: { documentId: string; revision: number }[]
      input: PrepareInput
    }

export type WorkerResponse = (
  | { outcome: "loaded" }
  | { outcome: "done"; result: Prepared }
  /** Documents the worker does not have parsed. */
  | { outcome: "missing"; missing: string[] }
  | { outcome: "failed"; message: string }
) & {
  id: number
  /** Keys dropped from the parse cache, so the sender loads them again. */
  evicted: string[]
}

export interface WorkerOptions {
  /** The parse cache's budget, in estimated bytes. */
  cacheBytes: number
}

export const cacheKey = (documentId: string, revision: number) =>
  `${documentId}@${revision}`
