import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { CatalogTreeItem } from "@shinan/api-client"

import { catalogFolders, pollCatalogState, pollDelayMs } from "./catalog-tree"
import type { CatalogStateAnswer } from "./catalog-tree"

const commit = "1234567890abcdef1234567890abcdef12345678"

describe("the catalog's folders at 20,000 pages", () => {
  it("are built in one pass, sorted by title with numbers by value, well within a second", () => {
    const items: CatalogTreeItem[] = []
    for (let i = 19_999; i >= 0; i--)
      items.push({
        path: `machine/m${i}.md`,
        id: `machine/m${i}`,
        title: `Machine ${i}`,
        kind: "entity",
        status: "active",
      })
    for (let i = 0; i < 50; i++)
      items.push({
        path: `f${i}/p.md`,
        id: `f${i}/p`,
        title: `Folder page ${i}`,
        kind: "entity",
        status: "active",
      })
    const started = performance.now()
    const folders = catalogFolders(items)
    const ms = performance.now() - started
    expect(folders).toHaveLength(51)
    const machine = folders.find((f) => f.name === "machine")!
    expect(machine.items).toHaveLength(20_000)
    expect(machine.items.slice(0, 3).map((i) => i.title)).toEqual([
      "Machine 0",
      "Machine 1",
      "Machine 2",
    ])
    expect(machine.items[10_000]!.title).toBe("Machine 10000")
    // About 60 ms on a laptop; the quadratic version took seconds.
    expect(ms).toBeLessThan(1000)
  })
})

/** A page whose visibility a test sets. */
function fakeDocument() {
  const listeners = new Set<() => void>()
  return {
    visibilityState: "visible" as DocumentVisibilityState,
    addEventListener: (_: string, listener: () => void) => {
      listeners.add(listener)
    },
    removeEventListener: (_: string, listener: () => void) => {
      listeners.delete(listener)
    },
    show(state: DocumentVisibilityState) {
      this.visibilityState = state
      for (const listener of listeners) listener()
    },
    listeners,
  }
}

describe("asking where the catalog stands while it waits", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const settingUp: CatalogStateAnswer = {
    catalog_commit: null,
    index_behind: false,
  }

  it("waits 3 seconds, doubling to a minute", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 10].map(pollDelayMs)).toEqual([
      3000, 6000, 12_000, 24_000, 48_000, 60_000, 60_000, 60_000,
    ])
  })

  it("backs off while nothing changes, and calls back once when it does", async () => {
    let answer = settingUp
    const read = vi.fn(() => Promise.resolve(answer))
    const changed = vi.fn()
    const doc = fakeDocument()
    const stop = pollCatalogState({
      read,
      known: settingUp,
      changed,
      document: doc,
    })
    await vi.advanceTimersByTimeAsync(2999)
    expect(read).toHaveBeenCalledTimes(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(read).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(6000)
    expect(read).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(11_999)
    expect(read).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(read).toHaveBeenCalledTimes(3)
    expect(changed).not.toHaveBeenCalled()

    answer = { catalog_commit: commit, index_behind: false }
    await vi.advanceTimersByTimeAsync(24_000)
    expect(read).toHaveBeenCalledTimes(4)
    expect(changed).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(600_000)
    expect(read).toHaveBeenCalledTimes(4)
    stop()
    expect(doc.listeners.size).toBe(0)
  })

  it("does not ask while the page is hidden, and asks at once when it is shown", async () => {
    const read = vi.fn(() => Promise.resolve(settingUp))
    const doc = fakeDocument()
    const stop = pollCatalogState({
      read,
      known: settingUp,
      changed: vi.fn(),
      document: doc,
    })
    await vi.advanceTimersByTimeAsync(3000)
    expect(read).toHaveBeenCalledTimes(1)
    doc.visibilityState = "hidden"
    await vi.advanceTimersByTimeAsync(6000)
    // The timer already set runs once more, then no new one is set.
    expect(read).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(600_000)
    expect(read).toHaveBeenCalledTimes(2)
    doc.show("visible")
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(3)
    stop()
  })

  it("keeps asking after a failed request, and stops when told", async () => {
    const read = vi.fn(() => Promise.reject(new Error("offline")))
    const stop = pollCatalogState({
      read,
      known: settingUp,
      changed: vi.fn(),
      document: fakeDocument(),
    })
    await vi.advanceTimersByTimeAsync(3000 + 6000)
    expect(read).toHaveBeenCalledTimes(2)
    stop()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(read).toHaveBeenCalledTimes(2)
  })
})
