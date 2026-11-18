import { afterEach, describe, expect, it } from "vitest"

import * as fixtures from "../../../test/catalog-index-fixtures.js"
import { BusyError } from "../../errors.js"
import { parseCatalogDocument } from "../document/index.js"
import { estimatedBytes } from "./estimate.js"
import { CatalogWorkers } from "./pool.js"
import type { CatalogWorkerOptions, LatestDocument } from "./pool.js"
import type { PrepareInput } from "./work.js"

const texts: Record<string, string> = {
  a: fixtures.guneet,
  b: fixtures.daedalus,
}

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

const documents: LatestDocument[] = [
  { documentId: "a", revision: 1 },
  { documentId: "b", revision: 1 },
]

let workers: CatalogWorkers | null = null

afterEach(async () => {
  await workers?.close()
  workers = null
})

/** Catalog workers, and a loader that records what it was asked for. */
function setUp(options: CatalogWorkerOptions = {}) {
  workers = new CatalogWorkers(options)
  const loaded: string[][] = []
  const load = (wanted: readonly LatestDocument[]) => {
    loaded.push(wanted.map((d) => `${d.documentId}@${d.revision}`))
    return Promise.resolve(
      wanted.map((d) => ({ ...d, text: texts[d.documentId]! })),
    )
  }
  return { workers, loaded, load }
}

describe("the catalog workers", () => {
  it("parse stored texts in batches before a proposal, and only those they lack", async () => {
    const { workers, loaded, load } = setUp({ readBatch: 1 })
    const first = await workers.prepare("w1", documents, load, input)
    expect(first).toMatchObject({
      outcome: "ready",
      documents: [{ documentId: "b" }],
    })
    // What comes back by structured clone is the parse of its own text, as
    // appendCatalogRevision requires.
    if (first.outcome !== "ready") throw new Error(first.outcome)
    const [written] = first.documents
    expect(written!.parsed.text).toBe(written!.text)
    expect(written!.parsed).toEqual(parseCatalogDocument(written!.text))

    await workers.prepare("w1", documents, load, input)
    await workers.prepare(
      "w1",
      [documents[0]!, { documentId: "b", revision: 2 }],
      load,
      input,
    )
    expect(loaded).toEqual([["a@1"], ["b@1"], ["b@2"]])
  })

  it("refuses a catalog larger than a worker's cache", async () => {
    const { workers, load } = setUp({
      readBatch: 1,
      cacheBytes: estimatedBytes(parseCatalogDocument(texts.b!)),
    })
    await expect(
      workers.prepare("w1", documents, load, input),
    ).rejects.toMatchObject({ rule: "catalog-too-large" })
  })

  it("stops only the workspace whose proposal ran out of time", async () => {
    const { workers, loaded, load } = setUp({ timeLimitMs: 1 })
    const other = new CatalogWorkers()
    try {
      await other.prepare("w2", documents, load, input)
      await expect(
        workers.prepare("w1", documents, load, input),
      ).rejects.toMatchObject({ rule: "too-complex" })
      await expect(
        workers.prepare("w1", documents, load, input),
      ).rejects.toMatchObject({ rule: "too-complex" })
      await other.prepare("w2", documents, load, input)
    } finally {
      await other.close()
    }
    // w1 loaded twice, once per new worker; w2 once.
    expect(loaded).toEqual([
      ["a@1", "b@1"],
      ["a@1", "b@1"],
      ["a@1", "b@1"],
    ])
  })

  it("parse stored text in batches of bytes", async () => {
    const { workers, loaded, load } = setUp({ loadBatchBytes: 1 })
    await workers.prepare("w1", documents, load, input)
    // One read of both, parsed one by one: each batch holds at least one text.
    expect(loaded).toEqual([["a@1", "b@1"]])
  })

  it("serve a workspace's turns in order, and share one worker fairly between workspaces", async () => {
    const { workers, load } = setUp({ workers: 1 })
    const order: string[] = []
    const turn = (workspace: string, name: string) =>
      workers.run(workspace, async (prepare) => {
        order.push(`${name} start`)
        await prepare(documents, load, input)
        order.push(`${name} end`)
      })
    await Promise.all([
      turn("w1", "a1"),
      turn("w1", "a2"),
      turn("w2", "b1"),
      turn("w1", "a3"),
      turn("w2", "b2"),
    ])
    // Turns never overlap; w2's first turn comes right after w1's first,
    // not after all of w1's.
    expect(order).toEqual([
      "a1 start",
      "a1 end",
      "b1 start",
      "b1 end",
      "a2 start",
      "a2 end",
      "b2 start",
      "b2 end",
      "a3 start",
      "a3 end",
    ])
  })

  it("keep one worker per workspace, up to their number, giving up idle ones", async () => {
    const { workers, loaded, load } = setUp({ workers: 1 })
    await workers.prepare("w1", documents, load, input)
    await workers.prepare("w2", documents, load, input)
    await workers.prepare("w2", documents, load, input)
    await workers.prepare("w1", documents, load, input)
    expect(loaded).toHaveLength(3)
  })

  it("refuse requests beyond their queues at once, as busy", async () => {
    const { workers, load } = setUp({ queuePerWorkspace: 2, queueTotal: 3 })
    const results = await Promise.allSettled([
      workers.prepare("w1", documents, load, input),
      workers.prepare("w1", documents, load, input),
      workers.prepare("w1", documents, load, input),
      workers.prepare("w2", documents, load, input),
      workers.prepare("w2", documents, load, input),
    ])
    expect(results.map((r) => r.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "rejected",
      "fulfilled",
      "rejected",
    ])
    for (const result of results)
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(BusyError)
        expect(result.reason).toMatchObject({ rule: "catalog-busy" })
      }
    await expect(
      workers.prepare("w1", documents, load, input),
    ).resolves.toMatchObject({ outcome: "ready" })
  })

  it("stop a worker that runs out of memory, and start a new one", async () => {
    const big = Array.from({ length: 400 }, (_, i) => ({
      documentId: `m${i}`,
      revision: 1,
    }))
    const body = "Words of a long section about the machine.\n\n".repeat(1200)
    workers = new CatalogWorkers({
      heapMb: 24,
      readBatch: 400,
      loadBatchBytes: 64 * 1024 * 1024,
    })
    const load = (wanted: readonly LatestDocument[]) =>
      Promise.resolve(
        wanted.map((d) => ({
          ...d,
          text: `---\nid: machine/${d.documentId}\ntype: machine\ntitle: M\nsummary: M.\nowner: person/guneet\n---\n\n# M\n\n${body}`,
        })),
      )
    await expect(workers.prepare("w1", big, load, input)).rejects.toMatchObject(
      { rule: "catalog-too-large" },
    )
    await expect(
      workers.prepare(
        "w1",
        documents,
        (wanted) =>
          Promise.resolve(
            wanted.map((d) => ({ ...d, text: texts[d.documentId]! })),
          ),
        input,
      ),
    ).resolves.toMatchObject({ outcome: "ready" })
  })
})
