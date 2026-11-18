import { describe, expect, it } from "vitest"

import * as fixtures from "../../../test/catalog-index-fixtures.js"
import { parseCatalogDocument } from "../document/index.js"
import type { CatalogOperation } from "../document/index.js"
import { CatalogCache } from "./cache.js"
import { estimatedBytes } from "./estimate.js"
import type { LoadedText } from "./protocol.js"
import { prepareChange } from "./work.js"
import type { Prepared, PrepareInput } from "./work.js"

/** The fixtures' catalog, stored as revision 1 of documents d0, d1, ... */
const texts = fixtures.allDocuments
const revision1: LoadedText[] = texts.map((text, i) => ({
  documentId: `d${i}`,
  revision: 1,
  text,
}))
const daedalus = revision1.find((t) => t.text === fixtures.daedalus)!

const now = Date.now()
const proposal = (...operations: CatalogOperation[]): PrepareInput => ({
  operations,
  by: "guneet",
  explanation: "A test change.",
  now,
  memberHandles: ["guneet"],
})
const rename = (from: string, to: string): PrepareInput =>
  proposal({
    op: "set-field",
    document: "machine/daedalus",
    field: "title",
    value: to,
    expect: { value: from },
  })

const keys = (loaded: readonly LoadedText[]) =>
  loaded.map(({ documentId, revision }) => ({ documentId, revision }))

/** Replaces documents in a revision, as storing a proposal does. */
function store(
  latest: readonly LoadedText[],
  revision: number,
  written: readonly LoadedText[],
): LoadedText[] {
  const next = latest.map(
    (t) =>
      written.find((w) => w.documentId === t.documentId) ?? {
        ...t,
      },
  )
  for (const w of written)
    if (!latest.some((t) => t.documentId === w.documentId)) next.push(w)
  return next.map((t) => ({
    ...t,
    revision: written.some((w) => w.documentId === t.documentId)
      ? revision
      : t.revision,
  }))
}

/** What `prepareChange` gives with no kept validation, parsing everything afresh. */
function fresh(latest: readonly LoadedText[], input: PrepareInput): Prepared {
  return prepareChange(
    latest.map((t) => ({
      documentId: t.documentId,
      document: parseCatalogDocument(t.text),
    })),
    input,
  )
}

function ready(cache: CatalogCache, latest: LoadedText[], input: PrepareInput) {
  const done = cache.prepare(keys(latest), input)
  if (done.outcome !== "done") throw new Error(done.outcome)
  // A kept validation never changes the result.
  expect(done.result).toEqual(fresh(latest, input))
  if (done.result.outcome !== "ready") throw new Error(done.result.outcome)
  return done.result
}

describe("a catalog worker's kept catalog and validation (#116)", () => {
  it("keeps the latest revision's validation, and a proposal's once it is stored", () => {
    const cache = new CatalogCache(Infinity)
    cache.load(revision1)
    expect(cache.validation).toBeUndefined()
    const first = ready(cache, revision1, rename("Daedalus", "Daedalus II"))
    const latest = cache.validation
    const after = cache.waiting
    expect(latest).toBeDefined()
    expect(after).toBeDefined()

    // Stored as revision 2: the stored text is the very text written, so
    // its parsed document is taken rather than parsed again.
    const revision2 = store(revision1, 2, [
      {
        documentId: daedalus.documentId,
        revision: 2,
        text: first.documents[0]!.text,
      },
    ])
    cache.load([revision2.find((t) => t.revision === 2)!])
    expect(cache.counts).toEqual({ parsed: texts.length, reused: 1 })
    ready(cache, revision2, rename("Daedalus II", "Daedalus III"))
    // The same documents at the same time: the stored proposal's
    // validation is the latest revision's, as it was.
    expect(cache.validation).toBe(after)
    expect(cache.waiting).not.toBe(after)
  })

  it("drops a proposal that was not stored, keeping the latest revision's validation", () => {
    const cache = new CatalogCache(Infinity)
    cache.load(revision1)
    ready(cache, revision1, rename("Daedalus", "Daedalus II"))
    const latest = cache.validation
    const after = cache.waiting
    // It waits for approval, or its transaction rolled back: the next
    // proposal is made on revision 1 again.
    ready(cache, revision1, rename("Daedalus", "Daedalus 2"))
    expect(cache.validation).toBe(latest)
    expect(cache.waiting).not.toBe(after)
  })

  it("catches up with a revision another process stored first", () => {
    const cache = new CatalogCache(Infinity)
    cache.load(revision1)
    ready(cache, revision1, rename("Daedalus", "Daedalus II"))
    const latest = cache.validation
    // Another process stored its own change first; this one's turn starts
    // over on revision 2, whose text it did not write.
    const other = fixtures.daedalus.replace(
      "title: Daedalus",
      "title: Daedalus (dev)",
    )
    const revision2 = store(revision1, 2, [
      { documentId: daedalus.documentId, revision: 2, text: other },
    ])
    cache.load([revision2.find((t) => t.revision === 2)!])
    expect(cache.counts.reused).toBe(0)
    ready(cache, revision2, rename("Daedalus (dev)", "Daedalus II"))
    expect(cache.validation).not.toBe(latest)
    expect(cache.validation!.documents).toHaveLength(texts.length)
  })

  it("takes a new document's parse once it is stored", () => {
    const cache = new CatalogCache(Infinity)
    cache.load(revision1)
    const created = ready(
      cache,
      revision1,
      proposal({
        op: "create-entity",
        id: "machine/kojiro",
        title: "Kojiro",
        summary: "A new machine.",
        owner: "person/guneet",
      }),
    )
    const after = cache.waiting
    const revision2 = store(revision1, 2, [
      { documentId: "new", revision: 2, text: created.documents[0]!.text },
    ])
    cache.load([revision2.at(-1)!])
    expect(cache.counts.reused).toBe(1)
    ready(cache, revision2, rename("Daedalus", "Daedalus II"))
    expect(cache.validation).toBe(after)
  })

  it("drops its validations when documents are evicted for its budget", () => {
    const bytes = texts.reduce(
      (n, text) => n + estimatedBytes(parseCatalogDocument(text)),
      0,
    )
    const cache = new CatalogCache(bytes)
    cache.load(revision1)
    ready(cache, revision1, rename("Daedalus", "Daedalus II"))
    expect(cache.validation).toBeDefined()
    const evicted = cache.load([
      { documentId: "other", revision: 1, text: fixtures.daedalus },
    ])
    expect(evicted.length).toBeGreaterThan(0)
    expect(cache.validation).toBeUndefined()
    expect(cache.waiting).toBeUndefined()
  })

  it("keeps its validation when the outcome is not ready", () => {
    const cache = new CatalogCache(Infinity)
    cache.load(revision1)
    // A conflict: nothing is validated, so nothing changes.
    const done = cache.prepare(keys(revision1), rename("Kojiro", "Daedalus II"))
    expect(done).toMatchObject({ result: { outcome: "problems" } })
    expect(cache.validation).toBeUndefined()
    ready(cache, revision1, rename("Daedalus", "Daedalus II"))
    const latest = cache.validation
    cache.prepare(keys(revision1), rename("Daedalus", "Daedalus"))
    expect(cache.validation).toBe(latest)
    expect(cache.waiting).toBeUndefined()
  })
})
