import { afterAll, beforeEach, describe, expect, it } from "vitest"

import {
  asAgent,
  asPerson,
  newPerson,
  testDatabase,
} from "../../test/helpers.js"
import type { Context } from "../context.js"
import type { Person } from "../identity/people.js"
import { createWorkspace } from "../identity/workspaces.js"
import type { CatalogOperation } from "./document/index.js"
import { getCatalogChanges } from "./index/queries.js"
import { proposeCatalogChange } from "./proposals/proposals.js"
import type { CatalogProposal } from "./proposals/proposals.js"
import { listCatalogHistory } from "./wiki.js"

/**
 * What the wiki shows of catalog proposals beside a page (human
 * experience, an entity page): for each revision, who approved it and
 * which proposal applied it. The waiting ones are the entity answer's
 * `pending_proposals` (M2-4b).
 */

const { db, pool } = testDatabase()

afterAll(async () => {
  await pool.end()
})

const today = new Date().toISOString().slice(0, 10)
const check = { checked: today, scope: "A look", source: "ssh musashi" }

let owner: Person
let workspaceId: string
let asOwner: Context
let asOwnersAgent: Context

beforeEach(async () => {
  owner = await newPerson(db, "owner")
  asOwner = asPerson(db, owner)
  workspaceId = (await createWorkspace(asOwner, { name: "Team" })).workspace.id
  asOwnersAgent = await asAgent(db, owner, workspaceId)
})

async function propose(
  ctx: Context,
  operations: CatalogOperation[],
): Promise<CatalogProposal> {
  const outcome = await proposeCatalogChange(ctx, workspaceId, {
    explanation: "A change.",
    operations,
  })
  if (!("proposal" in outcome)) throw new Error(JSON.stringify(outcome))
  return outcome.proposal
}

const person = () => `person/${owner.handle}`

async function seed() {
  // A person entity is gated (people and agents): the owner's own edit is
  // their approval.
  const first = await propose(asOwner, [
    {
      op: "create-entity",
      id: person(),
      title: "Owner",
      summary: "Owns it.",
      owner: person(),
      facts: [
        {
          fact: { key: "member", state: "observed", value: owner.handle },
          check,
        },
      ],
    },
    {
      op: "create-entity",
      id: "machine/musashi",
      title: "Musashi",
      summary: "The production host.",
      owner: person(),
    },
    {
      op: "create-entity",
      id: "machine/daedalus",
      title: "Daedalus",
      summary: "The build host.",
      owner: person(),
    },
  ])
  // An agent's retitle applies on its own: nobody approved it.
  const second = await propose(asOwnersAgent, [
    {
      op: "set-field",
      document: "machine/musashi",
      field: "title",
      value: "Musashi (production)",
      expect: { value: "Musashi" },
    },
  ])
  // An agent's change of status waits.
  const waiting = await propose(asOwnersAgent, [
    {
      op: "set-field",
      document: "machine/musashi",
      field: "status",
      value: "deprecated",
      expect: { value: "active" },
    },
  ])
  return { first, second, waiting }
}

describe("catalog proposals beside a page", () => {
  it("says who approved each revision and which proposal applied it", async () => {
    const { first, second, waiting } = await seed()
    expect(waiting.state).toBe("pending")
    const history = await listCatalogHistory(asOwner, workspaceId, {
      id: "machine/musashi",
    })
    expect(
      history.items.map((i) => [i.revision, i.approved_by, i.proposal]),
    ).toEqual([
      [2, null, { id: second.id, number: 2 }],
      [1, owner.handle, { id: first.id, number: 1 }],
    ])
    const changes = await getCatalogChanges(asOwner, workspaceId, {
      since: 0,
    })
    expect(changes.items.map((i) => [i.revision, i.approved_by])).toEqual([
      [1, owner.handle],
      [2, null],
    ])
  })
})
