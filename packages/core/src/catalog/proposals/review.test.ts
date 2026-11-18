import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { and, asc, eq, schema } from "@shinan/db"

import {
  asAgent,
  asPerson,
  newPerson,
  testDatabase,
} from "../../../test/helpers.js"
import type { Context } from "../../context.js"
import {
  ForbiddenError,
  InvalidInputError,
  RuleViolationError,
} from "../../errors.js"
import { addMember } from "../../identity/members.js"
import type { Person } from "../../identity/people.js"
import { createWorkspace } from "../../identity/workspaces.js"
import type { CatalogOperation, CheckInput } from "../document/index.js"
import { compareWorkspaceIndex } from "../index/indexer.js"
import { getCatalogEntity } from "../index/queries.js"
import {
  getCatalogProposal,
  proposeCatalogChange,
  strictReason,
  withdrawCatalogProposal,
} from "./proposals.js"
import type { CatalogProposal, ProposalOutcome } from "./proposals.js"
import {
  approveCatalogProposals,
  commentOnCatalogProposal,
  getCatalogSettings,
  listCatalogProposalComments,
  listRecentCatalogChanges,
  revertCatalogProposal,
  setCatalogStrict,
} from "./review.js"

const { db, pool } = testDatabase()

afterAll(async () => {
  await pool.end()
})

const today = new Date().toISOString().slice(0, 10)
const check: CheckInput = {
  checked: today,
  scope: "A look at the machine",
  source: "ssh musashi",
}

let owner: Person
let contributor: Person
let workspaceId: string
let asOwner: Context
let asContributor: Context
let agent: Context
let person: string

beforeEach(async () => {
  owner = await newPerson(db, "owner")
  contributor = await newPerson(db, "contributor")
  asOwner = asPerson(db, owner)
  asContributor = asPerson(db, contributor)
  workspaceId = (await createWorkspace(asOwner, { name: "Team" })).workspace.id
  await addMember(asOwner, {
    workspaceId,
    personId: contributor.id,
    role: "contributor",
  })
  agent = await asAgent(db, owner, workspaceId)
  person = `person/${owner.handle}`
  stored(
    await propose(asOwner, [
      {
        op: "create-entity",
        id: person,
        title: "Owner",
        summary: "Owns the workspace.",
        owner: person,
        facts: [
          {
            fact: { key: "member", state: "observed", value: owner.handle },
            check: { ...check, scope: "Membership", source: "Shinan" },
          },
        ],
      },
      {
        op: "create-entity",
        id: "machine/musashi",
        title: "Musashi",
        summary: "The production host.",
        owner: person,
        facts: [
          {
            fact: { key: "role", state: "observed", value: "Production host" },
            check,
          },
          {
            fact: { key: "hostname", state: "observed", value: "musashi" },
            check,
          },
        ],
        body: "# Musashi\n\nThe shared production host.\n",
      },
    ]),
  )
})

function propose(
  ctx: Context,
  operations: CatalogOperation[],
  extra: { relatedTask?: string } = {},
): Promise<ProposalOutcome> {
  return proposeCatalogChange(ctx, workspaceId, {
    explanation: "A test change.",
    operations,
    ...extra,
  })
}

function stored(outcome: ProposalOutcome): CatalogProposal {
  if (!("proposal" in outcome))
    throw new Error(`Not stored: ${JSON.stringify(outcome, null, 2)}`)
  return outcome.proposal
}

const rename = (from: string, to: string): CatalogOperation => ({
  op: "set-field",
  document: "machine/musashi",
  field: "title",
  value: to,
  expect: { value: from },
})

const retire: CatalogOperation = {
  op: "retire",
  document: "machine/musashi",
  expect: { status: "active" },
}

const setRole = (value: string): CatalogOperation => ({
  op: "set-fact",
  document: "machine/musashi",
  fact: { key: "role", state: "observed", value },
  check,
  expect: {
    identity: "role|observed",
    value: "Production host",
    check: { checked: today },
  },
})

const recheckHostname: CatalogOperation = {
  op: "recheck-facts",
  document: "machine/musashi",
  facts: [
    {
      identity: "hostname|observed",
      value: "musashi",
      check: { checked: today },
    },
  ],
  check: { ...check, scope: "Hostname again" },
}

async function latestText(catalogId: string): Promise<string> {
  const [row] = await db
    .select({ text: schema.catalogRevisionDocuments.text })
    .from(schema.catalogIndexDocuments)
    .innerJoin(
      schema.catalogDocuments,
      eq(schema.catalogDocuments.id, schema.catalogIndexDocuments.documentId),
    )
    .innerJoin(
      schema.catalogRevisionDocuments,
      and(
        eq(
          schema.catalogRevisionDocuments.documentId,
          schema.catalogDocuments.id,
        ),
        eq(
          schema.catalogRevisionDocuments.revision,
          schema.catalogDocuments.currentRevision,
        ),
      ),
    )
    .where(
      and(
        eq(schema.catalogIndexDocuments.workspaceId, workspaceId),
        eq(schema.catalogIndexDocuments.catalogId, catalogId),
      ),
    )
  return row!.text
}

async function events(kind: string) {
  return db
    .select()
    .from(schema.events)
    .where(
      and(
        eq(schema.events.workspaceId, workspaceId),
        eq(schema.events.kind, kind),
      ),
    )
    .orderBy(asc(schema.events.id))
}

async function securityEntries(action: string) {
  return db
    .select()
    .from(schema.securityLog)
    .where(
      and(
        eq(schema.securityLog.workspaceId, workspaceId),
        eq(schema.securityLog.action, action),
      ),
    )
}

describe("comments on catalog proposals", () => {
  it("lets members and agents with catalog:propose comment, oldest first", async () => {
    const waiting = stored(await propose(agent, [retire]))
    const first = await commentOnCatalogProposal(agent, workspaceId, {
      proposalId: waiting.id,
      text: "  Checked: nothing still runs on Musashi.  ",
    })
    await commentOnCatalogProposal(asContributor, workspaceId, {
      proposalId: waiting.id,
      text: "Thanks.",
    })
    expect(first).toMatchObject({
      proposalId: waiting.id,
      author: { kind: "agent", personId: owner.id },
      text: "Checked: nothing still runs on Musashi.",
    })
    expect(
      (await listCatalogProposalComments(asOwner, workspaceId, waiting.id)).map(
        (c) => [c.author.kind, c.text],
      ),
    ).toEqual([
      ["agent", "Checked: nothing still runs on Musashi."],
      ["person", "Thanks."],
    ])
    const [event] = await events("catalog.proposal-commented")
    expect(event).toMatchObject({
      actorKind: "agent",
      data: { proposalId: waiting.id, commentId: first.id },
    })
    expect(event!.summary).not.toContain("nothing still runs")
  })

  it("refuses blank and long comments, unknown proposals, and agents without catalog:propose", async () => {
    const waiting = stored(await propose(agent, [retire]))
    await expect(
      commentOnCatalogProposal(asOwner, workspaceId, {
        proposalId: waiting.id,
        text: " ",
      }),
    ).rejects.toMatchObject({ rule: "comment-blank" })
    await expect(
      commentOnCatalogProposal(asOwner, workspaceId, {
        proposalId: waiting.id,
        text: "x".repeat(4001),
      }),
    ).rejects.toMatchObject({ rule: "comment-too-long" })
    await expect(
      commentOnCatalogProposal(asOwner, workspaceId, {
        proposalId: crypto.randomUUID(),
        text: "Hello",
      }),
    ).rejects.toThrow("Not found")
    const reader = await asAgent(db, owner, workspaceId, ["catalog:read"])
    await expect(
      commentOnCatalogProposal(reader, workspaceId, {
        proposalId: waiting.id,
        text: "Hello",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    // Reading comments needs only catalog:read.
    await expect(
      listCatalogProposalComments(reader, workspaceId, waiting.id),
    ).resolves.toEqual([])
  })
})

describe("the strict setting", () => {
  it("is off by default, and only an owner who signed in again turns it on", async () => {
    expect(await getCatalogSettings(agent, workspaceId)).toEqual({
      strict: false,
    })
    await expect(
      setCatalogStrict(asContributor, { workspaceId, strict: true }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      setCatalogStrict(asPerson(db, owner, { reauthenticated: false }), {
        workspaceId,
        strict: true,
      }),
    ).rejects.toThrow()
    expect(
      await setCatalogStrict(asOwner, { workspaceId, strict: true }),
    ).toEqual({ strict: true })
    expect(await getCatalogSettings(asContributor, workspaceId)).toEqual({
      strict: true,
    })
    expect(await events("catalog.strict-changed")).toMatchObject([
      { actorPersonId: owner.id, data: { strict: true } },
    ])
    expect(await securityEntries("catalog.strict-changed")).toMatchObject([
      { details: { strict: true } },
    ])
    // Setting it to what it is records nothing.
    await setCatalogStrict(asOwner, { workspaceId, strict: true })
    expect(await events("catalog.strict-changed")).toHaveLength(1)
  })

  it("holds every agent change except a recheck for approval, and lets a person's own edit apply", async () => {
    await setCatalogStrict(asOwner, { workspaceId, strict: true })
    const changed = stored(await propose(agent, [setRole("Build host")]))
    expect(changed).toMatchObject({
      state: "pending",
      approvalClasses: ["observed-or-unknown"],
      approvalReasons: [strictReason],
    })
    expect(stored(await propose(agent, [recheckHostname]))).toMatchObject({
      state: "applied",
      approvalClasses: ["recheck"],
      approvalReasons: [],
    })
    const own = stored(
      await propose(asContributor, [rename("Musashi", "Musashi I")]),
    )
    expect(own).toMatchObject({
      state: "applied",
      approvalReasons: [strictReason],
      decidedBy: contributor.handle,
    })

    // Turned off, what waits keeps waiting.
    await setCatalogStrict(asOwner, { workspaceId, strict: false })
    expect(
      (await getCatalogProposal(asOwner, workspaceId, changed.id)).state,
    ).toBe("pending")
    expect(
      stored(await propose(agent, [rename("Musashi I", "Musashi II")])).state,
    ).toBe("applied")
  })
})

describe("bulk approval", () => {
  it("approves every waiting proposal of one task, each in its own turn", async () => {
    await setCatalogStrict(asOwner, { workspaceId, strict: true })
    const first = stored(
      await propose(agent, [setRole("Build host")], { relatedTask: "SHN-7" }),
    )
    const second = stored(
      await propose(agent, [rename("Musashi", "Musashi I")], {
        relatedTask: "SHN-7",
      }),
    )
    const other = stored(
      await propose(agent, [
        {
          op: "set-field",
          document: "machine/musashi",
          field: "summary",
          value: "The shared host.",
          expect: { value: "The production host." },
        },
      ]),
    )
    const { results } = await approveCatalogProposals(
      asContributor,
      workspaceId,
      { relatedTask: "SHN-7" },
    )
    expect(results.map((r) => [r.number, r.outcome])).toEqual([
      [first.number, "applied"],
      [second.number, "applied"],
    ])
    expect(
      (await getCatalogProposal(asOwner, workspaceId, other.id)).state,
    ).toBe("pending")
    expect(await securityEntries("catalog-proposal.approved")).toHaveLength(3)
  })

  it("reports each proposal of a list it cannot approve, and goes on", async () => {
    const waiting = stored(await propose(agent, [retire]))
    const withdrawn = stored(await propose(agent, [retire]))
    await withdrawCatalogProposal(agent, workspaceId, withdrawn.id)
    const unknown = crypto.randomUUID()
    const { results } = await approveCatalogProposals(
      asContributor,
      workspaceId,
      { proposalIds: [unknown, withdrawn.id, waiting.id] },
    )
    expect(results).toMatchObject([
      { proposalId: waiting.id, outcome: "applied" },
      {
        proposalId: withdrawn.id,
        outcome: "refused",
        rule: "proposal-not-pending",
      },
      {
        proposalId: unknown,
        number: null,
        outcome: "refused",
        rule: "not-found",
      },
    ])
    // A person's own agent's proposals go to another member (D-024, O-46).
    const mine = stored(await propose(agent, [rename("Musashi", "Musashi I")]))
    await setCatalogStrict(asOwner, { workspaceId, strict: true })
    const held = stored(await propose(agent, [setRole("Build host")]))
    expect(mine.state).toBe("applied")
    expect(
      (
        await approveCatalogProposals(asOwner, workspaceId, {
          proposalIds: [held.id],
        })
      ).results,
    ).toMatchObject([{ outcome: "refused", rule: "own-agent" }])
  })

  it("is for people only, with at most 50 at a time", async () => {
    await expect(
      approveCatalogProposals(agent, workspaceId, { relatedTask: "SHN-7" }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      approveCatalogProposals(asOwner, workspaceId, {
        proposalIds: Array.from({ length: 51 }, () => crypto.randomUUID()),
      }),
    ).rejects.toMatchObject({ rule: "too-many" })
    await expect(
      approveCatalogProposals(asOwner, workspaceId, { relatedTask: "nope" }),
    ).rejects.toBeInstanceOf(InvalidInputError)
  })
})

describe("the recent-changes feed and revert", () => {
  it("lists changes that applied without approval, newest first, and whether each can be reverted", async () => {
    const recheck = stored(await propose(agent, [recheckHostname]))
    const renamed = stored(
      await propose(agent, [rename("Musashi", "Musashi I")]),
    )
    const feed = await listRecentCatalogChanges(asContributor, workspaceId)
    // The seed was the owner's own gated edit, approved by the owner.
    expect(feed.items.map((i) => [i.proposal.id, i.revertible])).toEqual([
      [renamed.id, true],
      [recheck.id, false],
    ])
    expect(feed.nextCursor).toBeNull()
    const all = await listRecentCatalogChanges(asContributor, workspaceId, {
      approval: "any",
      limit: 2,
    })
    expect(all.items.map((i) => i.revision)).toEqual([3, 2])
    expect(all.nextCursor).toBe(2)
    const rest = await listRecentCatalogChanges(asContributor, workspaceId, {
      approval: "any",
      cursor: 2,
    })
    expect(rest.items).toMatchObject([
      { revision: 1, approvedBy: owner.handle },
    ])
  })

  it("reverts a change with a new proposal that puts the earlier text back", async () => {
    const before = await latestText("machine/musashi")
    const renamed = stored(
      await propose(agent, [rename("Musashi", "Musashi I")]),
    )
    const outcome = await revertCatalogProposal(asContributor, workspaceId, {
      proposalId: renamed.id,
    })
    const revert = stored(outcome)
    expect(revert).toMatchObject({
      state: "applied",
      revertsProposalId: renamed.id,
      explanation: `Reverts catalog proposal ${renamed.number}.`,
      approvalClasses: ["body-and-bookkeeping"],
      author: { kind: "person", label: contributor.handle },
      operations: [{ op: "restore-document", document: "machine/musashi" }],
    })
    expect(await latestText("machine/musashi")).toBe(before)

    const feed = await listRecentCatalogChanges(asOwner, workspaceId)
    expect(feed.items.find((i) => i.proposal.id === renamed.id)).toMatchObject({
      revertible: false,
      revertedBy: { id: revert.id, number: revert.number, state: "applied" },
    })
    // A revert is a change like any other: it can be reverted in turn.
    stored(
      await revertCatalogProposal(asOwner, workspaceId, {
        proposalId: revert.id,
      }),
    )
    expect(
      (await getCatalogEntity(asOwner, workspaceId, { id: "machine/musashi" }))
        .entity.title,
    ).toBe("Musashi I")

    const comparison = await db.transaction(
      (tx) => compareWorkspaceIndex(tx, workspaceId),
      { isolationLevel: "repeatable read" },
    )
    expect(comparison.differences).toEqual([])
  })

  it("classes a revert by what it changes, so an agent's revert of a new entity waits", async () => {
    const created = stored(
      await propose(agent, [
        {
          op: "create-entity",
          id: "machine/kojiro",
          title: "Kojiro",
          summary: "A spare.",
          owner: person,
        },
      ]),
    )
    const revert = stored(
      await revertCatalogProposal(agent, workspaceId, {
        proposalId: created.id,
        explanation: "Kojiro was never bought.",
      }),
    )
    expect(revert).toMatchObject({
      state: "pending",
      approvalClasses: ["lifecycle"],
      operations: [
        {
          op: "retire",
          document: "machine/kojiro",
          expect: { status: "active" },
        },
      ],
    })
  })

  it("refuses to revert a change made over since, a waiting proposal, or by sending restore-document", async () => {
    const renamed = stored(
      await propose(agent, [rename("Musashi", "Musashi I")]),
    )
    stored(await propose(agent, [rename("Musashi I", "Musashi II")]))
    expect(
      await revertCatalogProposal(asOwner, workspaceId, {
        proposalId: renamed.id,
      }),
    ).toMatchObject({
      outcome: "conflict",
      problems: [
        { kind: "conflict", code: "changed", documentId: "machine/musashi" },
      ],
    })

    await setCatalogStrict(asOwner, { workspaceId, strict: true })
    const waiting = stored(await propose(agent, [setRole("Build host")]))
    await expect(
      revertCatalogProposal(asOwner, workspaceId, { proposalId: waiting.id }),
    ).rejects.toBeInstanceOf(RuleViolationError)

    await expect(
      propose(agent, [
        {
          op: "restore-document",
          document: "machine/musashi",
          text: "---\nid: machine/musashi\n---\n",
          expect: { sha256: "0" },
        },
      ]),
    ).rejects.toMatchObject({ rule: "restore-document" })
  })
})

describe("pending proposals on an entity", () => {
  it("are listed in the entity's JSON until they are decided", async () => {
    const waiting = stored(
      await propose(agent, [retire], { relatedTask: "SHN-9" }),
    )
    const entity = async () =>
      (await getCatalogEntity(asOwner, workspaceId, { id: "machine/musashi" }))
        .entity
    expect((await entity()).pending_proposals).toEqual([
      {
        proposal_id: waiting.id,
        number: waiting.number,
        author: waiting.author.label,
        author_kind: "agent",
        created_at: waiting.createdAt.toISOString(),
        approval_classes: ["lifecycle"],
        related_task: "SHN-9",
      },
    ])
    await withdrawCatalogProposal(agent, workspaceId, waiting.id)
    expect((await entity()).pending_proposals).toEqual([])
  })
})
