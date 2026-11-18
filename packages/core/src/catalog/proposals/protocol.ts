import type { Prepared, PrepareInput } from "./work.js"

/** The messages between `pool.ts` and the catalog worker (`worker.ts`). */

export interface WorkerDocument {
  documentId: string
  /** The revision holding this text; with the ID, the key of the parse cache. */
  revision: number
  /** Left out when the worker is expected to have it parsed already. */
  text?: string
}

export interface WorkerRequest {
  id: number
  documents: WorkerDocument[]
  input: PrepareInput
}

export type WorkerResponse =
  | {
      id: number
      outcome: "done"
      result: Prepared
      /** Keys dropped from the parse cache, so the sender stops leaving their text out. */
      evicted: string[]
    }
  /** Texts the worker no longer has: send them again. */
  | { id: number; outcome: "missing"; missing: string[]; evicted: string[] }
  | { id: number; outcome: "failed"; message: string; evicted: string[] }

export const cacheKey = (documentId: string, revision: number) =>
  `${documentId}@${revision}`
