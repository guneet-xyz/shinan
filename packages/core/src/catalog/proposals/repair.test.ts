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
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  ReauthenticationRequiredError,
} from "../../errors.js"
import { addMember } from "../../identity/members.js"
import type { Person } from "../../identity/people.js"
import { createWorkspace } from "../../identity/workspaces.js"
import { storeCatalogRevision } from "../../testing.js"
import type { CheckInput } from "../document/index.js"
import { compareWorkspaceIndex } from "../index/indexer.js"
import { getCatalogEntity } from "../index/queries.js"
import { findCatalogDocument } from "../revisions.js"
import { proposeCatalogChange } from "./proposals.js"
import type { CatalogProposal, ProposalOutcome } from "./proposals.js"
import { repairCatalogDocument } from "./repair.js"

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

function stored(outcome: ProposalOutcome): CatalogProposal {
  if (!("proposal" in outcome))
    throw new Error(`Not stored: ${JSON.stringify(outcome, null, 2)}`)
  return outcome.proposal
}

/**
 * Musashi as an earlier parser wrote it, checked by the owner's agent: a
 * relation attribute named `by`, unreadable since #130.
 */
const unreadable = (title = "Musashi") => `---
id: machine/musashi
type: machine
title: ${title}
summary: The production host.
status: active
owner: ${person}
facts:
  - checked: ${today}
    by: ${owner.handle} via opencode-daedalus
    scope: A look at the machine
    source: ssh musashi
    observed:
      hostname: musashi
      contact: { to: ${person}, by: someone }
---

# Musashi

The shared production host.
`

const repaired = () =>
  unreadable().replace(
    "      contact: { to: " + person + ", by: someone }\n",
    "",
  )

/** The stored revision Musashi is at. */
async function musashiRevision(): Promise<number> {
  const id = await db.transaction((tx) =>
    findCatalogDocument(tx, workspaceId, "machine/musashi"),
  )
  const [row] = await db
    .select({ revision: schema.catalogDocuments.currentRevision })
    .from(schema.catalogDocuments)
    .where(eq(schema.catalogDocuments.id, id!))
  return row!.revision
}

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
    await proposeCatalogChange(asOwner, workspaceId, {
      explanation: "The owner and Musashi.",
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
    }),
  )
  // Stored before the parser refused it, as text an older release wrote.
  const id = await db.transaction((tx) =>
    findCatalogDocument(tx, workspaceId, "machine/musashi"),
  )
  await storeCatalogRevision(
    db,
    workspaceId,
    {
      kind: "person",
      personId: owner.id,
      agentId: null,
      agentSessionId: null,
      label: owner.handle,
      confidence: "recorded",
    },
    [{ documentId: id!, text: unreadable() }],
  )
})

const repair = (
  ctx: Context,
  input: Partial<Parameters<typeof repairCatalogDocument>[2]> = {},
) =>
  musashiRevision().then((revision) =>
    repairCatalogDocument(ctx, workspaceId, {
      id: "machine/musashi",
      revision,
      text: repaired(),
      explanation: "Drop the unreadable contact fact.",
      ...input,
    }),
  )

describe("repairing a document that reads with problems", () => {
  it("is needed: no operation can change the document while it reads with a problem", async () => {
    const entity = await getCatalogEntity(asOwner, workspaceId, {
      id: "machine/musashi",
    })
    expect(entity.entity.problems.map((p) => p.code)).toEqual(["fact-invalid"])
    const outcome = await proposeCatalogChange(asOwner, workspaceId, {
      explanation: "A new title.",
      operations: [
        {
          op: "set-field",
          document: "machine/musashi",
          field: "title",
          value: "Musashi (production)",
          expect: { value: "Musashi" },
        },
      ],
    })
    expect(outcome).toMatchObject({
      outcome: "blocked",
      problems: [{ code: "fact-invalid", documentId: "machine/musashi" }],
    })
  })

  it("lets a workspace owner replace the whole text, recorded as their approval", async () => {
    const before = await musashiRevision()
    const outcome = await repair(asOwner)
    expect(outcome).toMatchObject({
      outcome: "applied",
      proposal: {
        author: { kind: "person", label: owner.handle },
        decidedBy: owner.handle,
        operations: [{ op: "restore-document", document: "machine/musashi" }],
      },
    })
    const proposal = stored(outcome)
    expect(proposal.appliedRevision).toBe(before + 1)

    const entity = await getCatalogEntity(asOwner, workspaceId, {
      id: "machine/musashi",
    })
    expect(entity.entity.problems).toEqual([])
    expect(entity.entity.facts.map((f) => f.key)).toEqual(["hostname"])

    const [approval] = await db
      .select()
      .from(schema.securityLog)
      .where(
        and(
          eq(schema.securityLog.workspaceId, workspaceId),
          eq(schema.securityLog.action, "catalog-proposal.approved"),
          sql`${schema.securityLog.details}->>'proposalId' = ${proposal.id}`,
        ),
      )
    expect(approval).toMatchObject({
      actorPersonId: owner.id,
      details: { repair: true, revision: before + 1 },
    })
    // The text is not in the security log or the event.
    expect(JSON.stringify(approval)).not.toContain("hostname")
    const [event] = await db
      .select()
      .from(schema.events)
      .where(
        and(
          eq(schema.events.workspaceId, workspaceId),
          eq(schema.events.kind, "catalog.changed"),
        ),
      )
      .orderBy(sql`${schema.events.id} desc`)
      .limit(1)
    expect(event).toMatchObject({
      actorPersonId: owner.id,
      data: { revision: before + 1, approvedBy: owner.handle },
    })

    // Ordinary changes apply again.
    expect(
      await proposeCatalogChange(asOwner, workspaceId, {
        explanation: "A new title.",
        operations: [
          {
            op: "set-field",
            document: "machine/musashi",
            field: "title",
            value: "Musashi (production)",
            expect: { value: "Musashi" },
          },
        ],
      }),
    ).toMatchObject({ outcome: "applied" })
    const compared = await db.transaction(
      (tx) => compareWorkspaceIndex(tx, workspaceId),
      { isolationLevel: "repeatable read" },
    )
    expect(compared.differences).toEqual([])
  })

  it("allows the problems the document already had, and refuses new ones", async () => {
    // Fixing something else while the unreadable fact stays is allowed.
    expect(
      await repair(asOwner, { text: unreadable("Musashi (production)") }),
    ).toMatchObject({ outcome: "applied" })

    // A new problem in the document is not.
    expect(
      await repair(asOwner, {
        text: unreadable("Musashi (production)").replace(
          `owner: ${person}`,
          "owner: person/nobody",
        ),
      }),
    ).toMatchObject({
      outcome: "blocked",
      problems: [{ code: "reference-unresolved" }],
    })
    // Nor is a secret, even one the document held before.
    expect(
      await repair(asOwner, {
        text: unreadable("Musashi (production)").replace(
          "The shared production host.",
          "The shared production host. Token ghp_abcdefghijklmnopqrstuvwxyz0123456789.",
        ),
      }),
    ).toMatchObject({ outcome: "blocked", problems: [{ code: "secret" }] })
    // Nor a text the parser cannot read as the same kind of document.
    expect(
      await repair(asOwner, {
        text: "---\nid: schema/machine\ntitle: Machine\nsummary: A host.\nstatus: active\nowner: person/x\n---\n",
      }),
    ).toMatchObject({ outcome: "invalid" })
  })

  it("is only for a document that reads with problems", async () => {
    stored(await repair(asOwner))
    // Repaired: it now reads without problems, so ordinary proposals change it.
    await expect(
      repair(asOwner, { text: repaired().replace("Musashi", "Musashi II") }),
    ).rejects.toMatchObject({ rule: "not-needed" })
    // Nor any other document that reads well, such as a person entity.
    const revision = await db
      .select({ revision: schema.catalogDocuments.currentRevision })
      .from(schema.catalogDocuments)
      .where(
        eq(
          schema.catalogDocuments.id,
          (await db.transaction((tx) =>
            findCatalogDocument(tx, workspaceId, person),
          ))!,
        ),
      )
      .then((rows) => rows[0]!.revision)
    await expect(
      repairCatalogDocument(asOwner, workspaceId, {
        id: person,
        revision,
        text:
          "---\nid: " + person + "\ntype: person\ntitle: Someone else\n---\n",
        explanation: "A new title.",
      }),
    ).rejects.toMatchObject({ rule: "not-needed" })
  })

  it("never credits a fact check to anyone but the repairing owner (identity §8.7)", async () => {
    const agentCheck = `by: ${owner.handle} via opencode-daedalus`
    const refused = async (text: string) =>
      expect(await repair(asOwner, { text })).toMatchObject({
        outcome: "invalid",
        problems: [
          { code: "operation-invalid", documentId: "machine/musashi" },
        ],
      })
    // Another agent's name, or another member's.
    await refused(
      repaired().replace(agentCheck, `by: ${owner.handle} via opencode-forged`),
    )
    await refused(repaired().replace(agentCheck, `by: ${contributor.handle}`))
    // The agent's fact check with another scope, or with a fact it did not cover.
    await refused(
      repaired().replace(
        "scope: A look at the machine",
        "scope: Something else",
      ),
    )
    await refused(
      repaired().replace(
        "      hostname: musashi\n",
        "      hostname: musashi\n      role: Production host\n",
      ),
    )
    // Removing a fact from it, or naming yourself, is fine.
    expect(
      await repair(asOwner, {
        text: repaired()
          .replace(agentCheck, `by: ${owner.handle}`)
          .replace(
            "      hostname: musashi\n",
            "      hostname: musashi\n      role: Production host\n",
          ),
      }),
    ).toMatchObject({ outcome: "applied" })
  })

  it("refuses characters PostgreSQL cannot store, as input", async () => {
    for (const input of [
      { text: repaired() + "\u0000" },
      { text: repaired() + "\ud800" },
      { explanation: "Fix \u0000 it." },
      { idempotencyKey: "key-\ud800" },
    ])
      await expect(repair(asOwner, input)).rejects.toMatchObject({
        rule: "text-characters",
      })
  })

  it("applies only to the text the owner read", async () => {
    const revision = await musashiRevision()
    await repair(asOwner, { text: unreadable("Musashi (production)") })
    expect(
      await repairCatalogDocument(asOwner, workspaceId, {
        id: "machine/musashi",
        revision,
        text: repaired(),
        explanation: "Drop the unreadable contact fact.",
      }),
    ).toMatchObject({
      outcome: "conflict",
      problems: [{ code: "changed", documentId: "machine/musashi" }],
    })
  })

  it("is stored once when retried with the same idempotency key", async () => {
    const first = stored(await repair(asOwner, { idempotencyKey: "fix-1" }))
    const again = await repairCatalogDocument(asOwner, workspaceId, {
      id: "machine/musashi",
      revision: first.basedOnRevision,
      text: repaired(),
      explanation: "Drop the unreadable contact fact.",
      idempotencyKey: "fix-1",
    })
    expect(again).toMatchObject({
      outcome: "applied",
      proposal: { id: first.id },
    })
  })

  it("is for workspace owners who signed in again recently, never agents", async () => {
    await expect(repair(asContributor)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(repair(agent)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      repair(asPerson(db, owner, { reauthenticated: false })),
    ).rejects.toBeInstanceOf(ReauthenticationRequiredError)
    const refusals = await db
      .select({ details: schema.securityLog.details })
      .from(schema.securityLog)
      .where(
        and(
          eq(schema.securityLog.workspaceId, workspaceId),
          eq(schema.securityLog.action, "request.refused"),
        ),
      )
      .orderBy(asc(schema.securityLog.id))
    expect(refusals.map((r) => r.details)).toEqual([
      { action: "catalog.repair", reason: "role" },
      { action: "catalog.repair", reason: "people-only" },
      { action: "catalog.repair", reason: "reauthentication" },
    ])

    // Nor can anyone send the operation as an ordinary proposal.
    await expect(
      proposeCatalogChange(agent, workspaceId, {
        explanation: "Sneaky.",
        operations: [
          {
            op: "restore-document",
            document: "machine/musashi",
            text: repaired(),
            expect: { sha256: "0".repeat(64) },
          },
        ],
      }),
    ).rejects.toMatchObject({ rule: "restore-document" })
  })

  it("checks its input", async () => {
    await expect(repair(asOwner, { explanation: " " })).rejects.toMatchObject({
      rule: "explanation-blank",
    })
    await expect(repair(asOwner, { revision: 0 })).rejects.toBeInstanceOf(
      InvalidInputError,
    )
    await expect(repair(asOwner, { text: 5 })).rejects.toMatchObject({
      rule: "text",
    })
    await expect(
      repair(asOwner, { id: "machine/nowhere" }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
