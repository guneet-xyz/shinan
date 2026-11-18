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
import { listCatalogProposals, proposeCatalogChange } from "./proposals.js"
import type { ProposalOutcome } from "./proposals.js"

/**
 * The catalog workers with a large catalog (security checklist 10.8): a
 * worker that has just started parses every stored document before the
 * first proposal, which takes longer than a proposal's time limit, and
 * proposals waiting for it hold no database connection.
 *
 * 1,500 documents of about 57 KB by default; set
 * SHINAN_PROPOSAL_SCALE_DOCUMENTS to try other sizes.
 */

const { db, pool } = testDatabase()

afterAll(async () => {
  await pool.end()
})

const count = Number(process.env.SHINAN_PROPOSAL_SCALE_DOCUMENTS ?? 1500)

let owner: Person
let workspaceId: string
let otherWorkspaceId: string
let agent: Context

function machine(i: number, person: string): string {
  let body = `# Machine ${i}\n\n`
  for (let s = 0; body.length < 55_000; s++)
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

describe("proposals on a large catalog", () => {
  it("applies the first proposals after a restart, with nobody else waiting on them", async () => {
    // A new set of workers, as after a restart: nothing is parsed yet.
    const workers = new CatalogWorkers({ queuePerWorkspace: 3 })
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
      if (count >= 1000) expect(firstDone).toBe(0)
      expect(readMs).toBeLessThan(2000)

      const results = await settled
      const coldMs = firstDone - started
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
