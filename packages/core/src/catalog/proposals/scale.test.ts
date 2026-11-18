import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { schema } from "@shinan/db"

import {
  asAgent,
  asPerson,
  newPerson,
  testDatabase,
} from "../../../test/helpers.js"
import type { Context } from "../../context.js"
import { BusyError } from "../../errors.js"
import type { Person } from "../../identity/people.js"
import { createWorkspace } from "../../identity/workspaces.js"
import type { CatalogOperation } from "../document/index.js"
import { CatalogWorkers, replaceCatalogWorkers } from "./pool.js"
import type { Prepare } from "./pool.js"
import { listCatalogProposals, proposeCatalogChange } from "./proposals.js"
import type { ProposalOutcome } from "./proposals.js"

/**
 * The catalog workers after a restart (security checklist 10.8): a new
 * worker reads and parses every stored document before the first
 * proposal, which may take longer than a proposal's time limit, and
 * proposals waiting for it hold no database connection.
 *
 * By default a small catalog whose reading is slowed down to take longer
 * than a 1.5 s limit, so the run stays short. Set
 * SHINAN_PROPOSAL_SCALE_DOCUMENTS (such as 1500) for that many documents
 * of about 57 KB, read at full speed under the usual 20 s limit; with
 * SHINAN_PROPOSAL_SCALE_SHAPE=facts, documents of 100 facts instead, the
 * shape that takes the most memory (1,550 of them are at the catalog's
 * limit).
 */

const { db, pool } = testDatabase()

afterAll(async () => {
  await pool.end()
})

const large = process.env.SHINAN_PROPOSAL_SCALE_DOCUMENTS
const count = Number(large ?? 60)
/** The limit of the small run, and how long each batch of 10 texts takes to read. */
const smallLimitMs = 1500
const slowReadMs = 400

let owner: Person
let workspaceId: string
let otherWorkspaceId: string
let agent: Context

const facts = process.env.SHINAN_PROPOSAL_SCALE_SHAPE === "facts"

function machine(i: number, person: string): string {
  if (facts) {
    let written = ""
    for (let k = 0; k < 100; k++)
      written += `      x${k}: { value: v${k}, note: n }\n`
    return `---\nid: machine/m${i}\ntype: machine\ntitle: Machine ${i}\nsummary: M.\nstatus: active\nowner: ${person}\nfacts:\n  - checked: 2026-11-14\n    by: ${owner.handle}\n    scope: All\n    source: ssh\n    observed:\n${written}---\n\n# M\n`
  }
  let body = `# Machine ${i}\n\n`
  for (let s = 0; body.length < (large ? 55_000 : 2_000); s++)
    body += `## Section ${s}\n\nThis machine runs service ${s} for the fleet, next to [machine ${(i + 1) % count}](machine/m${(i + 1) % count}), with ordinary prose to fill the paragraph, number ${s}.\n\n- one ${s}\n- two ${s}\n\n`
  return `---
id: machine/m${i}
type: machine
title: Machine ${i}
summary: Machine number ${i} of the fleet.
status: active
owner: ${person}
facts:
  - checked: 2026-11-14
    by: ${owner.handle}
    scope: Everything
    source: ssh
    observed:
      role: Host ${i}
      environment: production
      access.method: ssh
      hostname: m${i}
---

${body}`
}

/** Stores the catalog as one revision, as an import would, without indexing it. */
async function seed() {
  const person = `person/${owner.handle}`
  const texts = [
    `---\nid: ${person}\ntype: person\ntitle: Owner\nsummary: Owns it.\nstatus: active\nowner: ${person}\n---\n\n# Owner\n`,
    ...Array.from({ length: count }, (_, i) => machine(i, person)),
  ]
  await db.transaction(async (tx) => {
    await tx.insert(schema.catalogRevisions).values({
      workspaceId,
      number: 1,
      actorKind: "person",
      actorPersonId: owner.id,
      actorLabel: owner.handle,
      confidence: "recorded",
    })
    for (let i = 0; i < texts.length; i += 100) {
      const batch = texts.slice(i, i + 100)
      const rows = await tx
        .insert(schema.catalogDocuments)
        .values(batch.map(() => ({ workspaceId, currentRevision: 1 })))
        .returning({ id: schema.catalogDocuments.id })
      await tx.insert(schema.catalogRevisionDocuments).values(
        batch.map((text, j) => ({
          workspaceId,
          revision: 1,
          documentId: rows[j]!.id,
          text,
        })),
      )
    }
  })
}

beforeAll(async () => {
  owner = await newPerson(db, "owner")
  workspaceId = (await createWorkspace(asPerson(db, owner), { name: "Big" }))
    .workspace.id
  otherWorkspaceId = (
    await createWorkspace(asPerson(db, owner), { name: "Other" })
  ).workspace.id
  agent = await asAgent(db, owner, workspaceId)
  await seed()
}, 300_000)

const rename = (i: number): CatalogOperation => ({
  op: "set-field",
  document: `machine/m${i}`,
  field: "title",
  value: `Machine ${i} renamed`,
  expect: { value: `Machine ${i}` },
})

/** Catalog workers whose reading of stored text takes `slowReadMs` a batch. */
class SlowReading extends CatalogWorkers {
  override run<T>(
    workspace: string,
    work: (prepare: Prepare) => Promise<T>,
  ): Promise<T> {
    return super.run(workspace, (prepare) =>
      work((documents, load, input) =>
        prepare(
          documents,
          async (wanted) => {
            await new Promise((resolve) => setTimeout(resolve, slowReadMs))
            return load(wanted)
          },
          input,
        ),
      ),
    )
  }
}

describe("proposals after a restart", () => {
  it("applies the first proposals after a restart, with nobody else waiting on them", async () => {
    // A new set of workers, as after a restart: nothing is parsed yet.
    const workers = large
      ? new CatalogWorkers({ queuePerWorkspace: 3 })
      : new SlowReading({
          queuePerWorkspace: 3,
          readBatch: 10,
          timeLimitMs: smallLimitMs,
        })
    const previous = replaceCatalogWorkers(workers)
    try {
      const started = Date.now()
      let firstDone = 0
      const proposals = [0, 1, 2, 3, 4].map((i) =>
        proposeCatalogChange(agent, workspaceId, {
          explanation: `Rename machine ${i}.`,
          operations: [rename(i)],
        }).then((outcome: ProposalOutcome) => {
          firstDone ||= Date.now()
          return outcome
        }),
      )
      const settled = Promise.allSettled(proposals)

      // While the worker parses the catalog, other requests go through:
      // waiting proposals hold no database connection.
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const read = Date.now()
      await listCatalogProposals(asPerson(db, owner), otherWorkspaceId)
      for (let i = 0; i < 12; i++)
        await listCatalogProposals(asPerson(db, owner), otherWorkspaceId)
      const readMs = Date.now() - read
      if (!large) expect(firstDone).toBe(0)
      expect(readMs).toBeLessThan(2000)

      const results = await settled
      const coldMs = firstDone - started
      // Reading took longer than a proposal's limit, so it was not counted.
      if (!large) expect(coldMs).toBeGreaterThan(smallLimitMs)
      console.log(
        `${count} documents: first proposal after a restart took ${coldMs} ms; 13 reads elsewhere meanwhile took ${readMs} ms`,
      )
      // Three fit the workspace's queue; the others are refused at once.
      const outcomes = results.map((r) =>
        r.status === "fulfilled" ? r.value.outcome : (r.reason as unknown),
      )
      expect(outcomes.filter((o) => o === "applied")).toHaveLength(3)
      expect(outcomes.filter((o) => o instanceof BusyError)).toHaveLength(2)
      const revisions = results.flatMap((r) =>
        r.status === "fulfilled" && "proposal" in r.value
          ? [r.value.proposal.appliedRevision]
          : [],
      )
      expect(revisions.sort()).toEqual([2, 3, 4])
    } finally {
      replaceCatalogWorkers(previous!)
      await workers.close()
    }
  }, 600_000)
})
