import { monitorEventLoopDelay } from "node:perf_hooks"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  asAgent,
  asPerson,
  asShinan,
  newPerson,
  testDatabase,
} from "../../../test/helpers.js"
import type { Person } from "../../identity/people.js"
import { createWorkspace } from "../../identity/workspaces.js"
import { appendCatalogRevision } from "../revisions.js"
import type { RevisionActor } from "../revisions.js"
import { compareWorkspaceIndex, deriveWorkspace } from "./indexer.js"
import { rebuildCatalogIndex } from "./maintain.js"
import { pauser } from "./pause.js"

/**
 * A rebuild of the agent index runs in the worker's process, beside every
 * other job (email, invitations, clean-ups): it must give the event loop
 * back often, however large the catalog (#135). This seeds a catalog and
 * measures the longest the event loop is held during a rebuild, and how
 * late a job scheduled meanwhile runs.
 *
 * 300 documents by default, to keep the test run short; set
 * SHINAN_REBUILD_SCALE_DOCUMENTS to measure larger catalogs (5,000 and
 * 20,000, the catalog limits, are what #135 measured).
 */
const documents = Number(process.env.SHINAN_REBUILD_SCALE_DOCUMENTS ?? 300)

/**
 * The longest the event loop may be held at once during a rebuild, and how
 * late a job may start (**proposed**, #135): about a second, so email and
 * other jobs wait at most that long. The bound is loose for slow machines;
 * at the catalog limits the measured blocks are far below it.
 */
const maxBlockMs = 1000

const { db, pool } = testDatabase()

afterAll(async () => {
  await pool.end()
})

function machine(i: number): string {
  return `---
id: machine/r${i}
type: machine
title: Machine ${i}
summary: Machine number ${i} of the fleet.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-14
    by: guneet
    scope: Platform and disks
    source: Read-only SSH
    observed:
      role: Worker ${i}
      environment: production
      platform.os: Ubuntu 24.04
      disk.data.size: ${i} GiB
  - unknown:
      access.method: Not checked
---

# Machine ${i}

Runs batch work for the fleet, number ${i}. Drain it before a restart, and
check the queue first; the owner approves any change to its disks.

## Cautions

Never restart it during the nightly build window. Backups run at ${i % 24}:00.

## Access prerequisites

Read-only SSH from the build hosts; the key lives in the secrets manager.
`
}

let owner: Person
let workspaceId: string

beforeAll(async () => {
  owner = await newPerson(db, "owner")
  workspaceId = (await createWorkspace(asPerson(db, owner), { name: "Fleet" }))
    .workspace.id
  const agent = await asAgent(db, owner, workspaceId)
  if (agent.actor.kind !== "agent") throw new Error("Expected an agent")
  const actor: RevisionActor = {
    kind: "agent",
    personId: owner.id,
    agentId: agent.actor.agentId,
    agentSessionId: null,
    label: `${owner.handle} via ${agent.actor.agentHandle}`,
    confidence: "recorded",
  }
  for (let start = 0; start < documents; start += 1000) {
    const batch = Array.from(
      { length: Math.min(1000, documents - start) },
      (_, i) => ({ text: machine(start + i) }),
    )
    await db.transaction((tx) =>
      appendCatalogRevision(tx, workspaceId, actor, batch),
    )
  }
}, 3_600_000)

describe("pauser", () => {
  it("gives the event loop back once its budget is spent, and not before", async () => {
    const pause = pauser(20)
    let ran = false
    setImmediate(() => (ran = true))
    await pause()
    // Within the budget: no yield, so the callback has not run.
    expect(ran).toBe(false)
    const until = performance.now() + 25
    while (performance.now() < until) {
      // Busy, as parsing is.
    }
    await pause()
    expect(ran).toBe(true)
  })
})

describe("deriving a workspace's index", () => {
  it("pauses before every document, whatever the batch", async () => {
    let pauses = 0
    let derived = 0
    await db.transaction((tx) =>
      deriveWorkspace(
        tx,
        workspaceId,
        (rows) => {
          derived += rows.length
          return Promise.resolve()
        },
        7,
        () => {
          pauses++
          return Promise.resolve()
        },
      ),
    )
    expect(derived).toBe(documents)
    // Once before reading each document's frontmatter for its kind, and
    // once before deriving each document's rows: never two documents
    // without a chance to yield.
    expect(pauses).toBeGreaterThanOrEqual(2 * documents)
  })
})

describe("rebuilding the agent index", () => {
  it("gives the event loop back often, so other jobs run on time", async () => {
    const delay = monitorEventLoopDelay({ resolution: 10 })
    // A job scheduled every 50 ms, as the job queue's own timers are: how
    // late does it run while the rebuild works?
    let latest = 0
    let last = performance.now()
    const ticker = setInterval(() => {
      const now = performance.now()
      latest = Math.max(latest, now - last - 50)
      last = now
    }, 50)
    const heapBefore = process.memoryUsage().heapUsed
    let heapPeak = heapBefore
    const heap = setInterval(() => {
      heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed)
    }, 100)
    delay.enable()
    const started = performance.now()
    const rebuilt = await rebuildCatalogIndex(asShinan(db), { workspaceId })
    const took = performance.now() - started
    delay.disable()
    clearInterval(ticker)
    clearInterval(heap)

    const blockMs = delay.max / 1e6
    console.info(
      `Rebuild of ${documents} documents: ${(took / 1000).toFixed(1)} s; longest event-loop delay ${blockMs.toFixed(0)} ms (p99 ${(delay.percentile(99) / 1e6).toFixed(0)} ms); a 50 ms job ran at most ${latest.toFixed(0)} ms late; heap ${(heapBefore / 2 ** 20).toFixed(0)} → peak ${(heapPeak / 2 ** 20).toFixed(0)} MiB`,
    )
    expect(rebuilt.documents).toBe(documents)
    expect(blockMs).toBeLessThan(maxBlockMs)
    expect(latest).toBeLessThan(maxBlockMs)

    // And the index is exactly what the text gives (D-006).
    const compared = await db.transaction((tx) =>
      compareWorkspaceIndex(tx, workspaceId),
    )
    expect(compared.differences).toEqual([])
  }, 3_600_000)
})
