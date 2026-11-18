import { parseCatalogDocument } from "../document/index.js"
import type { CatalogDocument, CatalogValidation } from "../document/index.js"
import { estimatedBytes } from "./estimate.js"
import { cacheKey } from "./protocol.js"
import type { LoadedText } from "./protocol.js"
import { prepareChangeIncrementally } from "./work.js"
import type { Prepared, PrepareInput, StoredDocument } from "./work.js"

interface Cached {
  documentId: string
  document: CatalogDocument
  bytes: number
}

/** A ready proposal's work, kept until the next proposal shows whether it was stored. */
interface Written {
  /** The validation of the catalog the proposal would make. */
  after: CatalogValidation
  /** The documents it writes, parsed, by their text. */
  byText: Map<
    string,
    { documentId: string | null; document: CatalogDocument }[]
  >
}

export type CacheResult =
  | { outcome: "done"; result: Prepared }
  /** Documents the cache does not hold. */
  | { outcome: "missing"; missing: string[] }

/**
 * One workspace's catalog as its catalog worker keeps it (`worker.ts`):
 * the parsed documents, by `documentId@revision`, least recently used
 * first, within a budget of estimated bytes (`estimatedBytes`); and the
 * validation of the latest revision (#116, catalog §8.3 "Cost"), which
 * `estimatedBytes` also counts.
 *
 * - **What is kept.** Each proposal validates the latest revision from the
 *   kept validation and keeps the result, so a revision stored by another
 *   process is caught up with on the next proposal. A proposal ready to
 *   store leaves its parsed documents and the validation of the catalog it
 *   would make; they are kept only if the next proposal finds them stored.
 * - **How "stored" is told.** By the text, never by revision numbers: when
 *   the stored text of a document the cache lacks is the very text the
 *   last proposal wrote, its parsed document is used rather than parsed
 *   again, and when the latest revision then holds exactly the documents
 *   the last proposal would make, its validation becomes the latest
 *   revision's. A proposal that was not stored (it waits for approval, its
 *   transaction rolled back, or another revision came first and its turn
 *   starts over) is dropped by the next proposal, and the latest
 *   revision's validation stays as it was.
 * - **Any validation is a correct base**, of any revision: the result is
 *   the same as validating every document (`validateChange`). Keeping the
 *   latest one only saves work.
 * - **Dropped** when documents are evicted for the budget (the catalog
 *   does not fit, so the next proposal starts over in full), and with the
 *   whole worker on a time limit, out of memory, or `CatalogWorkers.forget`
 *   (purge rewrites stored text in place). A new parser or rules version
 *   comes with new code, so a new process and new workers.
 */
export class CatalogCache {
  private readonly cache = new Map<string, Cached>()
  /** The cached revision of each document: one at a time. */
  private readonly revisions = new Map<string, number>()
  private bytes = 0
  private latest: CatalogValidation | undefined
  private written: Written | undefined
  /** Stored texts parsed, and those taken from the last proposal instead. */
  readonly counts = { parsed: 0, reused: 0 }

  constructor(private readonly budget: number) {}

  /** The validation of the latest revision a proposal was worked out on. */
  get validation(): CatalogValidation | undefined {
    return this.latest
  }

  /** The validation of the catalog the last proposal would make, until the next one. */
  get waiting(): CatalogValidation | undefined {
    return this.written?.after
  }

  /**
   * Parses and keeps stored texts, taking the parsed documents of the last
   * proposal for its texts. Adds the keys it drops to `evicted`.
   */
  load(texts: readonly LoadedText[], evicted: string[] = []): string[] {
    const keep = new Set<string>()
    for (const { documentId, revision, text } of texts) {
      const key = cacheKey(documentId, revision)
      keep.add(key)
      if (this.cache.has(key)) continue
      // A document's earlier revision is not needed again.
      const earlier = this.revisions.get(documentId)
      if (earlier !== undefined) {
        this.drop(cacheKey(documentId, earlier))
        evicted.push(cacheKey(documentId, earlier))
      }
      let document = this.writtenAs(documentId, text)
      if (document) this.counts.reused++
      else {
        document = parseCatalogDocument(text)
        this.counts.parsed++
      }
      const bytes = estimatedBytes(document)
      this.cache.set(key, { documentId, document, bytes })
      this.revisions.set(documentId, revision)
      this.bytes += bytes
    }
    let over = false
    for (const key of [...this.cache.keys()]) {
      if (this.bytes <= this.budget) break
      if (keep.has(key)) continue
      this.drop(key)
      evicted.push(key)
      over = true
    }
    // The kept validations would hold on to evicted documents, and the
    // catalog does not fit anyway.
    if (over) this.latest = this.written = undefined
    return evicted
  }

  /** Applies a proposal to these documents, which must all be loaded. */
  prepare(
    documents: readonly { documentId: string; revision: number }[],
    input: PrepareInput,
  ): CacheResult {
    const keys = documents.map((d) => cacheKey(d.documentId, d.revision))
    const missing = keys.filter((key) => !this.cache.has(key))
    if (missing.length > 0) return { outcome: "missing", missing }
    const stored: StoredDocument[] = keys.map((key) => {
      const entry = this.cache.get(key)!
      this.cache.delete(key)
      this.cache.set(key, entry)
      return { documentId: entry.documentId, document: entry.document }
    })
    if (this.written) {
      if (holdsExactly(this.written.after, stored))
        this.latest = this.written.after
      this.written = undefined
    }
    const { prepared, before, after } = prepareChangeIncrementally(
      stored,
      input,
      this.latest,
    )
    if (before) this.latest = before
    if (after && prepared.outcome === "ready") {
      const byText = new Map<
        string,
        { documentId: string | null; document: CatalogDocument }[]
      >()
      for (const { documentId, parsed } of prepared.documents) {
        const list = byText.get(parsed.text) ?? []
        list.push({ documentId, document: parsed })
        byText.set(parsed.text, list)
      }
      this.written = { after, byText }
    }
    return { outcome: "done", result: prepared }
  }

  /**
   * The last proposal's parsed document for this stored text: one it wrote
   * to this document, or a new one. Each is taken once.
   */
  private writtenAs(
    documentId: string,
    text: string,
  ): CatalogDocument | undefined {
    const list = this.written?.byText.get(text)
    if (!list) return undefined
    const i = list.findIndex(
      (w) => w.documentId === documentId || w.documentId === null,
    )
    if (i < 0) return undefined
    return list.splice(i, 1)[0]!.document
  }

  private drop(key: string) {
    const entry = this.cache.get(key)
    if (!entry) return
    this.cache.delete(key)
    this.bytes -= entry.bytes
    if (this.revisions.get(entry.documentId) === Number(key.split("@")[1]))
      this.revisions.delete(entry.documentId)
  }
}

/** Whether a validation is of exactly these documents, in any order. */
function holdsExactly(
  validation: CatalogValidation,
  stored: readonly StoredDocument[],
): boolean {
  if (validation.documents.length !== stored.length) return false
  const documents = new Set(validation.documents)
  return stored.every((s) => documents.has(s.document))
}
