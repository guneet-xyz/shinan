import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { eq, schema } from "@shinan/db"

import {
  asAgent,
  asPerson,
  newPerson,
  testDatabase,
} from "../../../test/helpers.js"
import type { Context } from "../../context.js"
import { BusyError, InvalidInputError, NotFoundError } from "../../errors.js"
import { addMember } from "../../identity/members.js"
import type { Person } from "../../identity/people.js"
import { createWorkspace } from "../../identity/workspaces.js"
import { rateLimits } from "../../rate-limits.js"
import type { CatalogOperation, CheckInput } from "../document/index.js"
import {
  getCatalogProposal,
  listCatalogProposals,
  previewCatalogChange,
  proposeCatalogChange,
  strictReason,
} from "./proposals.js"
import { setCatalogStrict } from "./review.js"

/**
 * "Before saving, the screen says whether the change applies at once or
 * waits for approval, and shows validation's results" (human experience,
 * changing the catalog from the wiki): a proposal checked without being
 * made.
 */

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
let workspaceId: string
let asOwner: Context
let asOwnersAgent: Context
let asViewer: Context
let person: string

beforeEach(async () => {
  owner = await newPerson(db, "owner")
  const contributor = await newPerson(db, "contributor")
  asOwner = asPerson(db, owner)
  asViewer = asPerson(db, await newPerson(db, "outsider"))
  const created = await createWorkspace(asOwner, { name: "Team" })
  workspaceId = created.workspace.id
  await addMember(asOwner, {
    workspaceId,
    personId: contributor.id,
    role: "contributor",
  })
  asOwnersAgent = await asAgent(db, owner, workspaceId)
  person = `person/${owner.handle}`
  const seeded = await proposeCatalogChange(asOwner, workspaceId, {
    explanation: "The first entities.",
    operations: [
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
            fact: { key: "hostname", state: "observed", value: "musashi" },
            check,
          },
        ],
      },
    ],
  })
  expect(seeded.outcome).toBe("applied")
})

const preview = (
  ctx: Context,
  operations: CatalogOperation[],
  explanation = "A change.",
) => previewCatalogChange(ctx, workspaceId, { explanation, operations })

const deprecate: CatalogOperation = {
  op: "set-field",
  document: "machine/musashi",
  field: "status",
  value: "deprecated",
  expect: { value: "active" },
}

const retitle: CatalogOperation = {
  op: "set-field",
  document: "machine/musashi",
  field: "title",
  value: "Musashi (production)",
  expect: { value: "Musashi" },
}

async function stored() {
  return {
    proposals: await listCatalogProposals(asOwner, workspaceId),
    revisions: await db
      .select()
      .from(schema.catalogRevisions)
      .where(eq(schema.catalogRevisions.workspaceId, workspaceId)),
  }
}

describe("checking a change before saving it", () => {
  it("says a person's change applies at once, and stores nothing", async () => {
    const before = await stored()
    expect(await preview(asOwner, [retitle])).toEqual({
      outcome: "applies",
      approvalClasses: ["body-and-bookkeeping"],
      approvalReasons: [],
      warnings: [],
      touches: ["machine/musashi"],
      asApproval: false,
    })
    // A gated change applies too, as the person's own approval.
    expect(await preview(asOwner, [deprecate])).toMatchObject({
      outcome: "applies",
      approvalClasses: ["lifecycle"],
      approvalReasons: [
        "Changes the status of machine/musashi from active to deprecated",
      ],
      asApproval: true,
    })
    expect(await stored()).toEqual(before)
  })

  it("says an agent's gated change waits for approval", async () => {
    expect(await preview(asOwnersAgent, [deprecate])).toMatchObject({
      outcome: "waits",
      approvalClasses: ["lifecycle"],
      asApproval: false,
    })
    expect(await preview(asOwnersAgent, [retitle])).toMatchObject({
      outcome: "applies",
    })
  })

  it("decides as a proposal would with the strict setting on", async () => {
    await setCatalogStrict(asOwner, { workspaceId, strict: true })
    // An agent's change that would apply on its own now waits, and says why.
    expect(await preview(asOwnersAgent, [retitle])).toMatchObject({
      outcome: "waits",
      approvalClasses: ["body-and-bookkeeping"],
      approvalReasons: [strictReason],
      asApproval: false,
    })
    // A person's applies at once, as their approval, with the same reason.
    expect(await preview(asOwner, [retitle])).toMatchObject({
      outcome: "applies",
      approvalReasons: [strictReason],
      asApproval: true,
    })
    // And it is what proposing does.
    const made = await proposeCatalogChange(asOwnersAgent, workspaceId, {
      explanation: "A change.",
      operations: [retitle],
    })
    expect(made).toMatchObject({
      outcome: "pending",
      proposal: { approvalReasons: [strictReason] },
    })
  })

  it("shows validation's warnings and blocking problems, and conflicts", async () => {
    const warned = await preview(asOwner, [
      {
        op: "set-fact",
        document: "machine/musashi",
        fact: { key: "ups.model", state: "observed", value: "X1" },
        check,
        expect: { identity: "ups.model|observed", absent: true },
      },
    ])
    expect(warned).toMatchObject({
      outcome: "applies",
      approvalClasses: ["observed-or-unknown", "doubtful"],
      warnings: [{ code: "key-not-in-schema" }],
      asApproval: true,
    })
    expect(
      await preview(asOwner, [
        { ...retitle, value: "Musashi", expect: { value: "Musashi" } },
      ]),
    ).toEqual({ outcome: "unchanged" })
    expect(
      await preview(asOwner, [
        {
          op: "set-field",
          document: "machine/musashi",
          field: "owner",
          value: "person/nobody",
          expect: { value: person },
        },
      ]),
    ).toMatchObject({
      outcome: "blocked",
      problems: [{ code: "reference-unresolved" }],
    })
    expect(
      await preview(asOwner, [{ ...retitle, expect: { value: "Old title" } }]),
    ).toMatchObject({ outcome: "conflict", problems: [{ operation: 0 }] })
  })

  it("refuses a restore-document sent from outside, as a proposal does", async () => {
    await expect(
      preview(asOwner, [
        {
          op: "restore-document",
          document: "machine/musashi",
          text: "---\nid: machine/musashi\n---\n",
          expect: { sha256: "ab".repeat(32) },
        },
      ]),
    ).rejects.toBeInstanceOf(InvalidInputError)
  })

  it("is for those who may propose, and checks the explanation", async () => {
    // Not a member: the workspace is not found.
    await expect(preview(asViewer, [retitle])).rejects.toThrow(NotFoundError)
    await expect(preview(asOwner, [retitle], " ")).rejects.toMatchObject({
      rule: "explanation-blank",
    })
  })

  it("counts a person's checks, and an agent's as its proposals, and records the refusal", async () => {
    const before = await preview(asOwner, [retitle])
    expect(before.outcome).toBe("applies")
    const counted = async (key: string) =>
      (
        await db
          .select()
          .from(schema.rateLimits)
          .where(eq(schema.rateLimits.key, key))
      )[0]?.count ?? 0
    expect(await counted(`catalog-check:${owner.id}`)).toBe(1)
    const agentId = (asOwnersAgent.actor as { agentId: string }).agentId
    await preview(asOwnersAgent, [retitle])
    expect(await counted(`catalog-proposal:${agentId}`)).toBe(1)

    // At the limit, the next check is refused at once, and recorded once.
    await db
      .update(schema.rateLimits)
      .set({ count: rateLimits["catalog-check"].max })
      .where(eq(schema.rateLimits.key, `catalog-check:${owner.id}`))
    await expect(preview(asOwner, [retitle])).rejects.toMatchObject({
      rule: "catalog-check-rate",
    })
    await expect(preview(asOwner, [retitle])).rejects.toBeInstanceOf(BusyError)
    const throttled = await db
      .select()
      .from(schema.securityLog)
      .where(eq(schema.securityLog.action, "request.throttled"))
    expect(
      throttled.filter(
        (e) =>
          (e.details as { limit?: string } | null)?.limit === "catalog-check",
      ),
    ).toHaveLength(1)

    await db
      .update(schema.rateLimits)
      .set({ count: rateLimits["catalog-proposal"].max })
      .where(eq(schema.rateLimits.key, `catalog-proposal:${agentId}`))
    await expect(preview(asOwnersAgent, [retitle])).rejects.toMatchObject({
      rule: "catalog-proposal-rate",
    })
  })

  it("gives each proposal's author, person and agent", async () => {
    const made = await proposeCatalogChange(asOwnersAgent, workspaceId, {
      explanation: "Deprecated.",
      operations: [deprecate],
    })
    if (!("proposal" in made)) throw new Error("not stored")
    const read = await getCatalogProposal(
      asOwner,
      workspaceId,
      made.proposal.id,
    )
    expect(read.author).toMatchObject({
      kind: "agent",
      personId: owner.id,
      agentId: expect.any(String) as unknown,
    })
    const [first] = await listCatalogProposals(asOwner, workspaceId, {
      oldestFirst: true,
    })
    expect(first!.author).toEqual({
      kind: "person",
      label: owner.handle,
      personId: owner.id,
      agentId: null,
    })
  })
})
