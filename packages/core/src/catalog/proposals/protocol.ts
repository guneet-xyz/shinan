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

/**
 * What a parsed document is estimated to take in memory: four times its
 * text, plus 16 KiB. **Proposed (M2-4):** measured on Daedalus at about
 * 1 to 3.5 times the text for documents of 57 KB, and 3 to 5 times for
 * documents of 5 KB; the fixed part covers the small ones.
 */
export function estimatedBytes(text: string): number {
  return 4 * Buffer.byteLength(text, "utf8") + 16 * 1024
}
