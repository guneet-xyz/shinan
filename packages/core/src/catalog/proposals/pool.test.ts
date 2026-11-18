import { afterEach, describe, expect, it } from "vitest"

import * as fixtures from "../../../test/catalog-index-fixtures.js"
import { CatalogWorker } from "./pool.js"
import type { LatestDocument } from "./pool.js"
import type { PrepareInput } from "./work.js"

const texts = new Map([
  ["a", fixtures.guneet],
  ["b", fixtures.daedalus],
])

const input: PrepareInput = {
  operations: [
    {
      op: "set-field",
      document: "machine/daedalus",
      field: "title",
      value: "Daedalus II",
      expect: { value: "Daedalus" },
    },
  ],
  by: "guneet",
  explanation: "Rename.",
  now: Date.now(),
  memberHandles: [],
}

let worker: CatalogWorker | null = null

afterEach(async () => {
  await worker?.close()
})

describe("the catalog worker", () => {
  it("sends only the texts the worker has not parsed, and again after it drops them", async () => {
    worker = new CatalogWorker({ cacheSize: 1 })
    const loaded: string[][] = []
    const load = (documents: readonly LatestDocument[]) => {
      loaded.push(documents.map((d) => d.documentId))
      return Promise.resolve(
        new Map(documents.map((d) => [d.documentId, texts.get(d.documentId)!])),
      )
    }
    const documents = [
      { documentId: "a", revision: 1 },
      { documentId: "b", revision: 1 },
    ]
    const first = await worker.prepare(documents, load, input)
    expect(first).toMatchObject({
      outcome: "ready",
      documents: [{ documentId: "b" }],
    })
    // The cache holds one document, so the worker dropped `a` and said so.
    await worker.prepare(documents, load, input)
    await worker.prepare(
      [documents[0]!, { documentId: "b", revision: 2 }],
      load,
      input,
    )
    expect(loaded).toEqual([["a", "b"], ["a"], ["a", "b"]])
  })

  it("starts a new thread after one is stopped", async () => {
    worker = new CatalogWorker({ timeLimitMs: 1 })
    const load = () => Promise.resolve(new Map([["b", fixtures.daedalus]]))
    const documents = [{ documentId: "b", revision: 1 }]
    await expect(worker.prepare(documents, load, input)).rejects.toMatchObject({
      rule: "too-complex",
    })
    await expect(worker.prepare(documents, load, input)).rejects.toMatchObject({
      rule: "too-complex",
    })
  })
})
