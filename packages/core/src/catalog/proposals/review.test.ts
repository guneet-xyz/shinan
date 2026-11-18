import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { and, asc, eq, schema, sql } from "@shinan/db"

import {
  asAgent,
  asPerson,
  newPerson,
  testDatabase,
} from "../../../test/helpers.js"
import type { Context } from "../../context.js"
import {
  BusyError,
  ForbiddenError,
  InvalidInputError,
  RuleViolationError,
} from "../../errors.js"
import { addMember } from "../../identity/members.js"
import type { Person } from "../../identity/people.js"
import { createWorkspace } from "../../identity/workspaces.js"
import { rateLimits } from "../../rate-limits.js"
import type { CatalogOperation, CheckInput } from "../document/index.js"
import { compareWorkspaceIndex } from "../index/indexer.js"
import { getCatalogEntity } from "../index/queries.js"
import { CatalogWorkers, replaceCatalogWorkers } from "./pool.js"
import type { Prepare } from "./pool.js"
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
  rejectCatalogProposals,
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
  it("approves the waiting proposals of one task the person saw, each in its own turn", async () => {
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
    // Added to the task after the person looked: not approved with it.
    const later = stored(
      await propose(
        agent,
        [
          {
            op: "set-field",
            document: person,
            field: "summary",
            value: "Owns everything.",
            expect: { value: "Owns the workspace." },
          },
        ],
        { relatedTask: "SHN-7" },
      ),
    )
    const { results } = await approveCatalogProposals(
      asContributor,
      workspaceId,
      { relatedTask: "SHN-7", seenUpTo: other.number },
    )
    expect(results.map((r) => [r.number, r.outcome])).toEqual([
      [first.number, "applied"],
      [second.number, "applied"],
    ])
    expect(
      (await getCatalogProposal(asOwner, workspaceId, later.id)).state,
    ).toBe("pending")
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

  it("returns what it did so far when Shinan is busy, and the rest to send again", async () => {
    await setCatalogStrict(asOwner, { workspaceId, strict: true })
    const ids = [
      stored(await propose(agent, [setRole("Build host")])).id,
      stored(await propose(agent, [rename("Musashi", "Musashi I")])).id,
      stored(await propose(agent, [retire])).id,
    ]
    let turns = 0
    class BusyAfterOne extends CatalogWorkers {
      override run<T>(
        workspace: string,
        work: (prepare: Prepare) => Promise<T>,
      ): Promise<T> {
        if (++turns > 1)
          return Promise.reject(new BusyError("catalog-busy", "Busy", 5))
        return super.run(workspace, work)
      }
    }
    const busy = new BusyAfterOne()
    const previous = replaceCatalogWorkers(busy)
    try {
      expect(
        (
          await approveCatalogProposals(asContributor, workspaceId, {
            proposalIds: ids,
          })
        ).results,
      ).toMatchObject([
        { proposalId: ids[0], outcome: "applied" },
        { proposalId: ids[1], outcome: "not-attempted", retryAfterSeconds: 5 },
        { proposalId: ids[2], outcome: "not-attempted", retryAfterSeconds: 5 },
      ])
    } finally {
      replaceCatalogWorkers(previous!)
      await busy.close()
    }
  })

  it("rejects what the person saw, with one reason", async () => {
    const first = stored(await propose(agent, [retire]))
    const second = stored(await propose(agent, [retire]))
    await expect(
      rejectCatalogProposals(asContributor, workspaceId, {
        proposalIds: [first.id],
        reason: " ",
      }),
    ).rejects.toMatchObject({ rule: "reason-blank" })
    const { results } = await rejectCatalogProposals(
      asContributor,
      workspaceId,
      {
        proposalIds: [first.id, second.id],
        reason: "The agent was disabled.",
      },
    )
    expect(results.map((r) => r.outcome)).toEqual(["rejected", "rejected"])
    await expect(
      rejectCatalogProposals(agent, workspaceId, {
        proposalIds: [first.id],
        reason: "No",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("is for people only, with at most 50 at a time", async () => {
    await expect(
      approveCatalogProposals(agent, workspaceId, {
        relatedTask: "SHN-7",
        seenUpTo: 1,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      approveCatalogProposals(asOwner, workspaceId, {
        proposalIds: Array.from({ length: 51 }, () => crypto.randomUUID()),
      }),
    ).rejects.toMatchObject({ rule: "too-many" })
    await expect(
      approveCatalogProposals(asOwner, workspaceId, {
        relatedTask: "nope",
        seenUpTo: 1,
      }),
    ).rejects.toBeInstanceOf(InvalidInputError)
    // A task's proposals only up to what the person saw.
    await expect(
      approveCatalogProposals(asOwner, workspaceId, {
        relatedTask: "SHN-7",
      } as never),
    ).rejects.toMatchObject({ rule: "seen-up-to" })
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

describe("review fixes", () => {
  it("gives a retried revert its stored proposal back, by its idempotency key", async () => {
    const renamed = stored(
      await propose(agent, [rename("Musashi", "Musashi I")]),
    )
    const first = stored(
      await revertCatalogProposal(agent, workspaceId, {
        proposalId: renamed.id,
        idempotencyKey: "revert-1",
      }),
    )
    const again = await revertCatalogProposal(agent, workspaceId, {
      proposalId: renamed.id,
      idempotencyKey: "revert-1",
    })
    expect(again).toMatchObject({
      outcome: "applied",
      proposal: { id: first.id },
    })
    await expect(
      revertCatalogProposal(agent, workspaceId, {
        proposalId: renamed.id,
        explanation: "Another reason.",
        idempotencyKey: "revert-1",
      }),
    ).rejects.toMatchObject({ rule: "idempotency-key-reused" })
  })

  it("works a revert out from the text read in its turn, so a purge committed meanwhile is respected", async () => {
    const secret = "hunter2-not-a-real-one"
    stored(
      await propose(asOwner, [
        {
          op: "set-field",
          document: "machine/musashi",
          field: "summary",
          value: `The production host. Note: ${secret}.`,
          expect: { value: "The production host." },
        },
      ]),
    )
    const removed = stored(
      await propose(asOwner, [
        {
          op: "set-field",
          document: "machine/musashi",
          field: "summary",
          value: "The production host.",
          expect: { value: `The production host. Note: ${secret}.` },
        },
      ]),
    )
    // As purge (M2-10) will: the stored text rewritten in place, after the
    // revert was asked for and before its turn.
    class PurgeFirst extends CatalogWorkers {
      override async run<T>(
        workspace: string,
        work: (prepare: Prepare) => Promise<T>,
      ): Promise<T> {
        await db.transaction(async (tx) => {
          await tx.execute(
            sql`alter table catalog_revision_documents disable trigger catalog_revision_documents_append_only`,
          )
          await tx.execute(
            sql`update catalog_revision_documents set text = replace(text, ${secret}, '(purged)') where workspace_id = ${workspaceId}`,
          )
          await tx.execute(
            sql`alter table catalog_revision_documents enable trigger catalog_revision_documents_append_only`,
          )
        })
        return super.run(workspace, work)
      }
    }
    const workers = new PurgeFirst()
    const previous = replaceCatalogWorkers(workers)
    try {
      const revert = stored(
        await revertCatalogProposal(asOwner, workspaceId, {
          proposalId: removed.id,
        }),
      )
      expect(JSON.stringify(revert.operations)).not.toContain(secret)
      expect(JSON.stringify(revert.operations)).toContain("(purged)")
    } finally {
      replaceCatalogWorkers(previous!)
      await workers.close()
    }
    expect(await latestText("machine/musashi")).not.toContain(secret)
  })

  it("holds a recheck bundled with a change the classifier does not otherwise sort, under the strict setting", async () => {
    stored(
      await propose(asOwner, [
        {
          op: "create-entity",
          id: "decision/use-shinan",
          title: "Use Shinan",
          summary: "Whether the team uses Shinan.",
          owner: person,
          decision: { state: "proposed", decidedOn: "2026-11-01" },
        },
      ]),
    )
    await setCatalogStrict(asOwner, { workspaceId, strict: true })
    const bundled = stored(
      await propose(agent, [
        recheckHostname,
        {
          op: "set-field",
          document: "decision/use-shinan",
          field: "decided_on",
          value: "2026-11-02",
          expect: { value: "2026-11-01" },
        },
      ]),
    )
    expect(bundled).toMatchObject({
      state: "pending",
      approvalClasses: ["recheck", "body-and-bookkeeping"],
      approvalReasons: [strictReason],
    })
  })

  it("stores a retried comment once, and limits how many an agent sends", async () => {
    const waiting = stored(await propose(agent, [retire]))
    const first = await commentOnCatalogProposal(agent, workspaceId, {
      proposalId: waiting.id,
      text: "Checked.",
      idempotencyKey: "c-1",
    })
    const again = await commentOnCatalogProposal(agent, workspaceId, {
      proposalId: waiting.id,
      text: "Checked.",
      idempotencyKey: "c-1",
    })
    expect(again.id).toBe(first.id)
    await expect(
      commentOnCatalogProposal(agent, workspaceId, {
        proposalId: waiting.id,
        text: "Something else.",
        idempotencyKey: "c-1",
      }),
    ).rejects.toMatchObject({ rule: "idempotency-key-reused" })
    expect(
      await listCatalogProposalComments(asOwner, workspaceId, waiting.id),
    ).toHaveLength(1)

    const actor = agent.actor as { agentId: string }
    await db
      .update(schema.rateLimits)
      .set({ count: rateLimits["catalog-comment"].max })
      .where(eq(schema.rateLimits.key, `catalog-comment:${actor.agentId}`))
    await expect(
      commentOnCatalogProposal(agent, workspaceId, {
        proposalId: waiting.id,
        text: "One more.",
      }),
    ).rejects.toMatchObject({ rule: "catalog-comment" })
    // A retry is not counted.
    await expect(
      commentOnCatalogProposal(agent, workspaceId, {
        proposalId: waiting.id,
        text: "Checked.",
        idempotencyKey: "c-1",
      }),
    ).resolves.toMatchObject({ id: first.id })
  })

  it("says when a proposal's author is a disabled agent or a member who left", async () => {
    const waiting = stored(await propose(agent, [retire]))
    const own = stored(
      await propose(asContributor, [rename("Musashi", "Musashi I")]),
    )
    const status = async (id: string) =>
      (await getCatalogProposal(asOwner, workspaceId, id)).authorStatus
    expect(await status(waiting.id)).toBe("current")
    const actor = agent.actor as { agentId: string }
    await db
      .update(schema.agents)
      .set({ enabled: false, disabledAt: new Date() })
      .where(eq(schema.agents.id, actor.agentId))
    expect(await status(waiting.id)).toBe("agent-disabled")
    await db
      .update(schema.members)
      .set({ removedAt: new Date() })
      .where(
        and(
          eq(schema.members.workspaceId, workspaceId),
          eq(schema.members.personId, contributor.id),
        ),
      )
    expect(await status(own.id)).toBe("member-left")
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
