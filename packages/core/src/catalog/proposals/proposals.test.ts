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
import type {
  CatalogOperation,
  CheckInput,
  PresentFact,
} from "../document/index.js"
import {
  compareWorkspaceIndex,
  rebuildWorkspaceIndex,
} from "../index/indexer.js"
import { getCatalogEntity } from "../index/queries.js"
import { CatalogWorker, replaceCatalogWorker } from "./pool.js"
import {
  approveCatalogProposal,
  getCatalogProposal,
  listCatalogProposals,
  proposeCatalogChange,
  rejectCatalogProposal,
  withdrawCatalogProposal,
} from "./proposals.js"
import type { CatalogProposal, ProposalOutcome } from "./proposals.js"

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
let asOwnersAgent: Context
let person: string

beforeEach(async () => {
  owner = await newPerson(db, "owner")
  contributor = await newPerson(db, "contributor")
  asOwner = asPerson(db, owner)
  asContributor = asPerson(db, contributor)
  const created = await createWorkspace(asOwner, { name: "Team" })
  workspaceId = created.workspace.id
  await addMember(asOwner, {
    workspaceId,
    personId: contributor.id,
    role: "contributor",
  })
  asOwnersAgent = await asAgent(db, owner, workspaceId)
  person = `person/${owner.handle}`
})

function propose(
  ctx: Context,
  operations: CatalogOperation[],
  extra: { idempotencyKey?: string; explanation?: string } = {},
): Promise<ProposalOutcome> {
  return proposeCatalogChange(ctx, workspaceId, {
    explanation: extra.explanation ?? "A test change.",
    operations,
    ...(extra.idempotencyKey ? { idempotencyKey: extra.idempotencyKey } : {}),
  })
}

function stored(outcome: ProposalOutcome): CatalogProposal {
  if (!("proposal" in outcome))
    throw new Error(`Not stored: ${JSON.stringify(outcome, null, 2)}`)
  return outcome.proposal
}

const fact = (key: string, value: string): PresentFact => ({
  identity: `${key}|observed`,
  value,
  check: { checked: today },
})

/** The owner's person entity and Musashi, made by the owner. */
async function seed(): Promise<CatalogProposal> {
  return stored(
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
            fact: {
              key: "environment",
              state: "observed",
              value: "production",
            },
            check,
          },
          {
            fact: { key: "access.method", state: "observed", value: "ssh" },
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
}

const recheck = (key: string, value: string): CatalogOperation => ({
  op: "recheck-facts",
  document: "machine/musashi",
  facts: [fact(key, value)],
  check: { ...check, scope: `Recheck of ${key}` },
})

const setOwner = (to: string): CatalogOperation => ({
  op: "set-field",
  document: "machine/musashi",
  field: "owner",
  value: to,
  expect: { value: person },
})

async function revisions() {
  return db
    .select()
    .from(schema.catalogRevisions)
    .where(eq(schema.catalogRevisions.workspaceId, workspaceId))
    .orderBy(asc(schema.catalogRevisions.number))
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
    .orderBy(asc(schema.securityLog.id))
}

async function proposalCount(): Promise<number> {
  return (await listCatalogProposals(asOwner, workspaceId)).length
}

describe("making catalog proposals", () => {
  it("applies a person's own gated edit at once, as a revision recording the proposal and approver", async () => {
    const proposal = await seed()
    expect(proposal).toMatchObject({
      number: 1,
      state: "applied",
      author: { kind: "person", label: owner.handle },
      basedOnRevision: 0,
      appliedRevision: 1,
      decidedBy: owner.handle,
      touches: ["machine/musashi", person],
    })
    expect(proposal.approvalClasses).toContain("people-and-agents")
    expect(proposal.approvalReasons).toContain(
      `Changes the person entity ${person}`,
    )

    const [revision] = await revisions()
    expect(revision).toMatchObject({
      number: 1,
      actorLabel: owner.handle,
      proposalId: proposal.id,
      basedOnRevision: 0,
      approvedByPersonId: owner.id,
      approvedByLabel: owner.handle,
    })
    const [changed] = await events("catalog.changed")
    expect(changed).toMatchObject({
      actorKind: "person",
      actorLabel: owner.handle,
      data: { proposalId: proposal.id, number: 1, revision: 1 },
    })
    expect(changed!.subjects).toContainEqual({
      type: "catalog-proposal",
      id: proposal.id,
    })
    expect(await securityEntries("catalog-proposal.approved")).toMatchObject([
      {
        actorPersonId: owner.id,
        subjectPersonId: null,
        details: { proposalId: proposal.id, revision: 1 },
      },
    ])

    const musashi = await getCatalogEntity(asOwnersAgent, workspaceId, {
      id: "machine/musashi",
    })
    expect(musashi.catalog_revision).toBe(1)
  })

  it("applies an agent's recheck on its own, credited to the agent", async () => {
    await seed()
    const outcome = await propose(asOwnersAgent, [
      recheck("hostname", "musashi"),
    ])
    const proposal = stored(outcome)
    expect(outcome.outcome).toBe("applied")
    expect(proposal).toMatchObject({
      author: { kind: "agent" },
      approvalClasses: ["recheck"],
      approvalReasons: [],
      basedOnRevision: 1,
      appliedRevision: 2,
    })
    const [, revision] = await revisions()
    expect(revision).toMatchObject({
      actorKind: "agent",
      proposalId: proposal.id,
      basedOnRevision: 1,
      approvedByPersonId: null,
    })
    expect(await securityEntries("catalog-proposal.approved")).toHaveLength(1)
  })

  it("holds an agent's gated change for a person's approval, then applies it credited to the agent", async () => {
    await seed()
    const outcome = await propose(asOwnersAgent, [setOwner("person/nobody")])
    // A reference that does not resolve is blocking, so nothing is stored.
    expect(outcome).toMatchObject({
      outcome: "blocked",
      problems: [{ code: "reference-unresolved" }],
    })

    const waiting = stored(
      await propose(asOwnersAgent, [
        {
          op: "set-field",
          document: "machine/musashi",
          field: "status",
          value: "deprecated",
          expect: { value: "active" },
        },
      ]),
    )
    expect(waiting).toMatchObject({
      state: "pending",
      approvalClasses: ["lifecycle"],
      approvalReasons: [
        "Changes the status of machine/musashi from active to deprecated",
      ],
      appliedRevision: null,
    })
    expect(await revisions()).toHaveLength(1)
    expect(await events("catalog.proposal-waiting")).toMatchObject([
      { actorKind: "agent", data: { proposalId: waiting.id } },
    ])

    const approved = await approveCatalogProposal(
      asContributor,
      workspaceId,
      waiting.id,
    )
    expect(approved).toMatchObject({
      outcome: "applied",
      proposal: {
        state: "applied",
        appliedRevision: 2,
        decidedBy: contributor.handle,
      },
    })
    const [, revision] = await revisions()
    expect(revision).toMatchObject({
      actorKind: "agent",
      actorPersonId: owner.id,
      approvedByPersonId: contributor.id,
      approvedByLabel: contributor.handle,
      basedOnRevision: 1,
    })
    const [, changed] = await events("catalog.changed")
    expect(changed).toMatchObject({
      actorKind: "agent",
      data: { approvedBy: contributor.handle, revision: 2 },
    })
    expect(
      (await securityEntries("catalog-proposal.approved")).at(-1),
    ).toMatchObject({
      actorPersonId: contributor.id,
      subjectPersonId: owner.id,
    })
  })

  it("lets a person approve their own agent's proposal (O-46)", async () => {
    await seed()
    const waiting = stored(
      await propose(asOwnersAgent, [
        {
          op: "retire",
          document: "machine/musashi",
          expect: { status: "active" },
        },
      ]),
    )
    expect(waiting.state).toBe("pending")
    await expect(
      approveCatalogProposal(asOwner, workspaceId, waiting.id),
    ).resolves.toMatchObject({ outcome: "applied" })
  })

  it("never lets an agent approve or reject, and records the refusal", async () => {
    await seed()
    const waiting = stored(
      await propose(asOwnersAgent, [
        {
          op: "change-id",
          document: "machine/musashi",
          id: "machine/miyamoto",
        },
      ]),
    )
    await expect(
      approveCatalogProposal(asOwnersAgent, workspaceId, waiting.id),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      rejectCatalogProposal(asOwnersAgent, workspaceId, {
        proposalId: waiting.id,
        reason: "No",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(await securityEntries("request.refused")).toMatchObject([
      { details: { action: "catalog.approve", reason: "people-only" } },
      { details: { action: "catalog.approve", reason: "people-only" } },
    ])
    expect(
      (await getCatalogProposal(asOwner, workspaceId, waiting.id)).state,
    ).toBe("pending")
  })

  it("refuses conflicting and invalid proposals without storing them", async () => {
    await seed()
    expect(
      await propose(asOwnersAgent, [recheck("hostname", "takezo")]),
    ).toMatchObject({
      outcome: "conflict",
      problems: [{ operation: 0, kind: "conflict", code: "fact-changed" }],
    })
    expect(
      await propose(asOwnersAgent, [
        { op: "change-id", document: "machine/musashi", id: "not an id" },
      ]),
    ).toMatchObject({ outcome: "invalid" })
    expect(
      await propose(asOwnersAgent, [
        {
          op: "set-field",
          document: "machine/musashi",
          field: "title",
          value: "Musashi",
          expect: { value: "Musashi" },
        },
      ]),
    ).toEqual({ outcome: "unchanged" })
    expect(await proposalCount()).toBe(1)
  })

  it("checks the input's shape after permission", async () => {
    await seed()
    await expect(
      proposeCatalogChange(asOwnersAgent, workspaceId, {
        explanation: "x",
        operations: [{ ...recheck("role", "x"), by: "someone" }],
      }),
    ).rejects.toThrow("is written by Shinan")
    const reader = await asAgent(db, owner, workspaceId, ["catalog:read"])
    await expect(
      proposeCatalogChange(reader, workspaceId, { nonsense: true }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("applies two agents' proposals on different facts of one entity, made at once", async () => {
    await seed()
    const other = await asAgent(db, owner, workspaceId)
    const [a, b] = await Promise.all([
      propose(asOwnersAgent, [recheck("hostname", "musashi")]),
      propose(other, [recheck("role", "Production host")]),
    ])
    expect([a.outcome, b.outcome]).toEqual(["applied", "applied"])
    expect(
      [stored(a).appliedRevision, stored(b).appliedRevision].sort(),
    ).toEqual([2, 3])
    const entity = await getCatalogEntity(asOwner, workspaceId, {
      id: "machine/musashi",
    })
    expect(entity.catalog_revision).toBe(3)
  })

  it("stores a retried proposal once, by its idempotency key", async () => {
    await seed()
    const first = await propose(
      asOwnersAgent,
      [recheck("hostname", "musashi")],
      {
        idempotencyKey: "recheck-1",
      },
    )
    const again = await propose(
      asOwnersAgent,
      [recheck("hostname", "musashi")],
      {
        idempotencyKey: "recheck-1",
      },
    )
    expect(stored(again)).toEqual(stored(first))
    expect(await revisions()).toHaveLength(2)
    await expect(
      propose(asOwnersAgent, [recheck("role", "Production host")], {
        idempotencyKey: "recheck-1",
      }),
    ).rejects.toMatchObject({ rule: "idempotency-key-reused" })
  })

  it("stops a proposal that runs past the worker's time limit", async () => {
    await seed()
    const slow = new CatalogWorker({ timeLimitMs: 1 })
    const previous = replaceCatalogWorker(slow)
    try {
      const error = await propose(asOwnersAgent, [
        recheck("hostname", "musashi"),
      ]).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(InvalidInputError)
      expect(error).toMatchObject({ rule: "too-complex" })
    } finally {
      replaceCatalogWorker(previous!)
      await slow.close()
    }
    expect(await proposalCount()).toBe(1)
    await expect(
      propose(asOwnersAgent, [recheck("hostname", "musashi")]),
    ).resolves.toMatchObject({ outcome: "applied" })
  })
})

describe("approval, rejection and withdrawal", () => {
  it("writes `accepted` only when the person it names approves", async () => {
    await seed()
    // A second observation of the hostname makes a discrepancy to accept.
    const discrepancy = await propose(asOwnersAgent, [
      {
        op: "set-fact",
        document: "machine/musashi",
        fact: {
          key: "hostname",
          state: "observed",
          value: "musashi-old",
          via: "dns",
        },
        check: { ...check, source: "dig" },
        expect: { identity: "hostname|observed|via=dns", absent: true },
      },
    ])
    expect(discrepancy.outcome).toBe("applied")
    const accept = stored(
      await propose(asOwnersAgent, [
        {
          op: "set-fact",
          document: "machine/musashi",
          fact: {
            key: "hostname",
            state: "observed",
            value: "musashi-old",
            via: "dns",
            accepted: person,
          },
          check: { ...check, source: "dig" },
          expect: {
            identity: "hostname|observed|via=dns",
            value: "musashi-old",
            check: { checked: today },
          },
        },
      ]),
    )
    expect(accept.state).toBe("pending")
    expect(accept.approvalClasses).toContain("doubtful")

    await expect(
      approveCatalogProposal(asContributor, workspaceId, accept.id),
    ).rejects.toMatchObject({ rule: "accepted-not-approver" })
    await expect(
      approveCatalogProposal(asOwner, workspaceId, accept.id),
    ).resolves.toMatchObject({ outcome: "applied" })

    // A person's own edit may not accept in another person's name.
    await expect(
      propose(asContributor, [
        {
          op: "set-fact",
          document: "machine/musashi",
          fact: {
            key: "hostname",
            state: "observed",
            value: "musashi",
            accepted: person,
          },
          check,
          expect: fact("hostname", "musashi"),
        },
      ]),
    ).rejects.toBeInstanceOf(RuleViolationError)
  })

  it("leaves a proposal waiting when it conflicts by the time it is approved", async () => {
    await seed()
    const waiting = stored(
      await propose(asOwnersAgent, [
        {
          op: "change-id",
          document: "machine/musashi",
          id: "machine/miyamoto",
        },
      ]),
    )
    await propose(asOwner, [
      { op: "change-id", document: "machine/musashi", id: "machine/kojiro" },
    ])
    expect(
      await approveCatalogProposal(asOwner, workspaceId, waiting.id),
    ).toMatchObject({ outcome: "conflict" })
    expect(
      (await getCatalogProposal(asOwner, workspaceId, waiting.id)).state,
    ).toBe("pending")
  })

  it("rejects with a reason, and only waiting proposals", async () => {
    await seed()
    const waiting = stored(
      await propose(asOwnersAgent, [
        {
          op: "retire",
          document: "machine/musashi",
          expect: { status: "active" },
        },
      ]),
    )
    await expect(
      rejectCatalogProposal(asOwner, workspaceId, {
        proposalId: waiting.id,
        reason: " ",
      }),
    ).rejects.toMatchObject({ rule: "reason-blank" })
    const rejected = await rejectCatalogProposal(asOwner, workspaceId, {
      proposalId: waiting.id,
      reason: "Musashi stays in service.",
    })
    expect(rejected).toMatchObject({
      state: "rejected",
      rejectionReason: "Musashi stays in service.",
      decidedBy: owner.handle,
    })
    expect(await events("catalog.proposal-rejected")).toMatchObject([
      {
        actorLabel: owner.handle,
        data: { reason: "Musashi stays in service." },
      },
    ])
    expect(await securityEntries("catalog-proposal.rejected")).toMatchObject([
      { subjectPersonId: owner.id, details: { proposalId: waiting.id } },
    ])
    await expect(
      approveCatalogProposal(asOwner, workspaceId, waiting.id),
    ).rejects.toMatchObject({ rule: "proposal-not-pending" })
  })

  it("lets only the author, or the person behind an agent, withdraw", async () => {
    await seed()
    const retire: CatalogOperation = {
      op: "retire",
      document: "machine/musashi",
      expect: { status: "active" },
    }
    const first = stored(await propose(asOwnersAgent, [retire]))
    const second = stored(await propose(asOwnersAgent, [retire]))
    await expect(
      withdrawCatalogProposal(asContributor, workspaceId, first.id),
    ).rejects.toMatchObject({ rule: "not-author" })
    const otherAgent = await asAgent(db, owner, workspaceId)
    await expect(
      withdrawCatalogProposal(otherAgent, workspaceId, first.id),
    ).rejects.toMatchObject({ rule: "not-author" })
    await expect(
      withdrawCatalogProposal(asOwnersAgent, workspaceId, first.id),
    ).resolves.toMatchObject({ state: "withdrawn" })
    await expect(
      withdrawCatalogProposal(asOwner, workspaceId, second.id),
    ).resolves.toMatchObject({ state: "withdrawn", decidedBy: owner.handle })
    expect(await events("catalog.proposal-withdrawn")).toHaveLength(2)
  })

  it("lists proposals newest first, or waiting ones oldest first", async () => {
    await seed()
    const retire: CatalogOperation = {
      op: "retire",
      document: "machine/musashi",
      expect: { status: "active" },
    }
    await propose(asOwnersAgent, [retire])
    await propose(asOwnersAgent, [retire])
    expect(
      (await listCatalogProposals(asOwnersAgent, workspaceId)).map(
        (p) => p.number,
      ),
    ).toEqual([3, 2, 1])
    expect(
      (
        await listCatalogProposals(asOwnersAgent, workspaceId, {
          state: "pending",
          oldestFirst: true,
        })
      ).map((p) => p.number),
    ).toEqual([2, 3])
  })
})

describe("the D-006 invariant", () => {
  it("rebuilds the index applied proposals left from the stored text alone", async () => {
    await seed()
    await propose(asOwnersAgent, [recheck("hostname", "musashi")])
    await propose(asOwnersAgent, [
      {
        op: "edit-body",
        document: "machine/musashi",
        text: "# Musashi\n\nThe shared production host.\n\n## Cautions\n\nAsk first.\n",
        expect: { text: "# Musashi\n\nThe shared production host.\n" },
      },
    ])
    const waiting = stored(
      await propose(asOwnersAgent, [
        {
          op: "change-id",
          document: "machine/musashi",
          id: "machine/miyamoto",
        },
      ]),
    )
    await approveCatalogProposal(asOwner, workspaceId, waiting.id)

    const compare = () =>
      db.transaction((tx) => compareWorkspaceIndex(tx, workspaceId), {
        isolationLevel: "repeatable read",
      })
    expect((await compare()).differences).toEqual([])
    const before = await getCatalogEntity(asOwner, workspaceId, {
      id: "machine/miyamoto",
    })
    await db.transaction((tx) => rebuildWorkspaceIndex(tx, workspaceId))
    expect((await compare()).differences).toEqual([])
    expect(
      await getCatalogEntity(asOwner, workspaceId, { id: "machine/miyamoto" }),
    ).toEqual(before)
  })
})
