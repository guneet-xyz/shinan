import { randomBytes } from "node:crypto"
import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { and, asc, eq, schema, sql } from "@shinan/db"

import * as fixtures from "../../../test/catalog-index-fixtures.js"
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
  ReauthenticationRequiredError,
  RuleViolationError,
} from "../../errors.js"
import { addMember } from "../../identity/members.js"
import type { Person } from "../../identity/people.js"
import { createWorkspace } from "../../identity/workspaces.js"
import { storeCatalogRevision } from "../../testing.js"
import { compareWorkspaceIndex } from "../index/indexer.js"
import {
  getCatalogChanges,
  getCatalogEntity,
  searchCatalog,
} from "../index/queries.js"
import { findCatalogDocument } from "../revisions.js"
import type { RevisionActor } from "../revisions.js"
import { getCatalogDocumentText, listCatalogHistory } from "../wiki.js"
import { PurgeMatcher } from "./matcher.js"
import {
  listCatalogPurges,
  previewCatalogPurge,
  purgeCatalogText,
  purgeMarker,
} from "./purge.js"

const { db, pool } = testDatabase()

afterAll(async () => {
  await pool.end()
})

const today = new Date().toISOString().slice(0, 10)

let owner: Person
let contributor: Person
let workspaceId: string
let asOwner: Context
let asContributor: Context
let asOwnersAgent: Context
let person: string
/** A leaked passphrase, unique to each test, that the secret check does not catch. */
let secret: string

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
  secret = `plum-otter-${randomBytes(4).toString("hex")}-lantern`
})

// M2's catalog proposals and their comments are gone as operations, but
// their rows stay in the database until GC-6 moves the catalog into Git, and
// purge must still clean them; the tests store them directly.

/** A stored M2 catalog proposal, as purge sees it. */
interface StoredProposal {
  id: string
  number: number
}

function actorOf(ctx: Context): RevisionActor {
  if (ctx.actor.kind === "agent")
    return {
      kind: "agent",
      personId: ctx.actor.personId,
      agentId: ctx.actor.agentId,
      agentSessionId: null,
      label: `${owner.handle} via ${ctx.actor.agentHandle}`,
      confidence: "recorded",
    }
  return {
    kind: "person",
    personId: owner.id,
    agentId: null,
    agentSessionId: null,
    label: owner.handle,
    confidence: "recorded",
  }
}

/**
 * Stores a catalog revision of these documents, by this actor: a new
 * revision of a document already stored under the same ID.
 */
async function store(ctx: Context, texts: string[]): Promise<number> {
  const documents = []
  for (const text of texts) {
    const id = /^id: (.+)$/m.exec(text)![1]!
    const documentId = await db.transaction((tx) =>
      findCatalogDocument(tx, workspaceId, id),
    )
    documents.push(documentId ? { documentId, text } : { text })
  }
  const applied = await storeCatalogRevision(
    db,
    workspaceId,
    actorOf(ctx),
    documents,
  )
  return applied.revision
}

/** Stores an M2 catalog proposal's row. */
async function storeProposal(
  ctx: Context,
  input: {
    explanation: string
    operations: unknown[]
    touches: string[]
    state: "applied" | "pending" | "rejected"
    basedOnRevision: number
    appliedRevision?: number
    rejectionReason?: string
  },
): Promise<StoredProposal> {
  const actor = actorOf(ctx)
  const [{ next }] = (
    await db.execute<{ next: number }>(
      sql`select coalesce(max(number), 0) + 1 as next from catalog_proposals where workspace_id = ${workspaceId}`,
    )
  ).rows as [{ next: number }]
  const decided = input.state !== "pending"
  const [row] = await db
    .insert(schema.catalogProposals)
    .values({
      workspaceId,
      number: next,
      actorKind: actor.kind,
      actorPersonId: actor.personId,
      actorAgentId: actor.agentId,
      actorLabel: actor.label,
      confidence: actor.confidence,
      explanation: input.explanation,
      operations: input.operations,
      basedOnRevision: input.basedOnRevision,
      state: input.state,
      approvalClasses: ["body-and-bookkeeping"],
      approvalReasons: [],
      touches: input.touches,
      validation: [],
      requestHash: randomBytes(8).toString("hex"),
      appliedRevision: input.appliedRevision ?? null,
      decidedAt: decided ? new Date() : null,
      decidedByPersonId: decided ? owner.id : null,
      decidedByLabel: decided ? owner.handle : null,
      rejectionReason: input.rejectionReason ?? null,
    })
    .returning({ id: schema.catalogProposals.id })
  return { id: row!.id, number: next }
}

/** Stores a comment on a proposal. */
async function storeComment(
  ctx: Context,
  proposal: StoredProposal,
  text: string,
  idempotencyKey: string | null = null,
): Promise<void> {
  const actor = actorOf(ctx)
  await db.insert(schema.catalogProposalComments).values({
    workspaceId,
    proposalId: proposal.id,
    actorKind: actor.kind,
    actorPersonId: actor.personId,
    actorAgentId: actor.agentId,
    actorLabel: actor.label,
    confidence: actor.confidence,
    text,
    idempotencyKey,
  })
}

/** A proposal's row as stored. */
async function proposalRow(proposal: StoredProposal) {
  const [row] = await db
    .select()
    .from(schema.catalogProposals)
    .where(eq(schema.catalogProposals.id, proposal.id))
  return row!
}

const ownerEntity = () => `---
id: ${person}
type: person
title: Owner
summary: Owns the workspace.
status: active
owner: ${person}
facts:
  - checked: ${today}
    by: ${owner.handle}
    scope: Membership
    source: Shinan
    observed:
      member: ${owner.handle}
---

# Owner
`

const musashi = (access: string) => `---
id: machine/musashi
type: machine
title: Musashi
summary: The production host.
status: active
owner: ${person}
facts:
  - checked: ${today}
    by: ${owner.handle}
    scope: A look at the machine
    source: ssh musashi
    observed:
      hostname: musashi
---

# Musashi

The shared production host.

## Access

${access}
`

const daedalus = (summary: string, passphrase = secret) => `---
id: machine/daedalus
type: machine
title: Daedalus
summary: ${summary}
status: active
owner: ${person}
facts:
  - checked: ${today}
    by: ${owner.handle} via opencode-daedalus
    scope: A look at the machine
    source: ssh musashi
    observed:
      hostname:
        value: daedalus
        note: Reached with ${passphrase}
---

# Daedalus

Log in with ${passphrase} until it is rotated.
`

/**
 * The secret, planted wherever the catalog stores text: in Musashi's first
 * revision only, in Daedalus's latest text, in M2 proposals (applied,
 * waiting and rejected: operations, explanations, a rejection reason), in a
 * comment on a proposal, and in a timeline event (the rejection's reason).
 */
async function plant(): Promise<{
  waiting: StoredProposal
  rejected: StoredProposal
}> {
  const first = await store(asOwner, [
    ownerEntity(),
    musashi(`The console passphrase is ${secret} for now.`),
  ])
  await storeProposal(asOwner, {
    explanation: "A test change.",
    operations: [
      {
        op: "create-entity",
        id: "machine/musashi",
        body: `# Musashi\n\nThe console passphrase is ${secret} for now.\n`,
      },
    ],
    touches: [person, "machine/musashi"],
    state: "applied",
    basedOnRevision: 0,
    appliedRevision: first,
  })
  const second = await store(asOwnersAgent, [
    musashi("Ask the owner for console access."),
  ])
  await storeProposal(asOwnersAgent, {
    explanation: `Took ${secret} out of the page.`,
    operations: [
      {
        op: "edit-body",
        document: "machine/musashi",
        expect: {
          text: `## Access\n\nThe console passphrase is ${secret} for now.\n`,
        },
      },
    ],
    touches: ["machine/musashi"],
    state: "applied",
    basedOnRevision: first,
    appliedRevision: second,
  })
  const third = await store(asOwnersAgent, [
    daedalus(`The build host; its old passphrase was ${secret}.`),
  ])
  await storeProposal(asOwnersAgent, {
    explanation: "A test change.",
    operations: [
      { op: "create-entity", id: "machine/daedalus", summary: secret },
    ],
    touches: ["machine/daedalus"],
    state: "applied",
    basedOnRevision: second,
    appliedRevision: third,
  })
  const waiting = await storeProposal(asOwnersAgent, {
    explanation: `Daedalus is going away; ${secret} goes with it.`,
    operations: [{ op: "set-field", document: "machine/daedalus" }],
    touches: ["machine/daedalus"],
    state: "pending",
    basedOnRevision: third,
  })
  const reason = `Not before ${secret} is rotated.`
  const rejected = await storeProposal(asOwnersAgent, {
    explanation: "Musashi is going away.",
    operations: [{ op: "set-field", document: "machine/musashi" }],
    touches: ["machine/musashi"],
    state: "rejected",
    basedOnRevision: third,
    rejectionReason: reason,
  })
  await db.insert(schema.events).values({
    workspaceId,
    kind: "catalog.proposal-rejected",
    origin: "shinan_action",
    actorKind: "person",
    actorPersonId: owner.id,
    actorLabel: owner.handle,
    confidence: "recorded",
    subjects: [{ type: "catalog-proposal", id: rejected.id }],
    summary: `${owner.handle} rejected catalog proposal ${rejected.number}`,
    data: { proposalId: rejected.id, reason },
  })
  await storeComment(
    asOwnersAgent,
    waiting,
    `The old passphrase ${secret}\nstill works.`,
    "comment-1",
  )
  return { waiting, rejected }
}

/**
 * Every table in the database, in every schema (the job queue's too), that
 * has a row holding `text`: what a full dump would show.
 */
async function tablesHolding(text: string): Promise<string[]> {
  const tables = await db.execute<{ schema: string; name: string }>(
    sql`select table_schema as schema, table_name as name from information_schema.tables where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema') order by 1, 2`,
  )
  const found: string[] = []
  for (const table of tables.rows) {
    const name = sql`${sql.identifier(table.schema)}.${sql.identifier(table.name)}`
    const { rows } = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${name} t where strpos(t::text, ${text}) > 0 or strpos(to_jsonb(t)::text, ${text}) > 0`,
    )
    if (rows[0]!.n > 0) found.push(`${table.schema}.${table.name}`)
  }
  return found
}

async function securityLog() {
  return db
    .select()
    .from(schema.securityLog)
    .where(eq(schema.securityLog.workspaceId, workspaceId))
    .orderBy(asc(schema.securityLog.id))
}

// Each test stores and indexes several revisions, slowly on a busy machine.
describe("purging catalog text", { timeout: 60_000 }, () => {
  it("removes a leaked secret from everything the database stores, keeping the security log", async () => {
    const { waiting, rejected } = await plant()
    expect(await tablesHolding(secret)).toEqual(
      expect.arrayContaining([
        "public.catalog_revision_documents",
        "public.catalog_proposals",
        "public.events",
        "public.catalog_index_documents",
        "public.catalog_index_facts",
        "public.catalog_index_sections",
      ]),
    )
    const logBefore = await securityLog()

    expect(
      await previewCatalogPurge(asOwner, workspaceId, { text: secret }),
    ).toEqual({
      revisionTexts: 2,
      documents: 2,
      latestDocuments: ["machine/daedalus"],
      proposals: 5,
      waitingProposals: 1,
      events: 1,
      comments: 1,
      writtenDifferently: [],
      acrossLines: { revisionTexts: 0, latestDocuments: [] },
      alsoWrittenAs: [],
      structure: [],
    })
    const purge = await purgeCatalogText(asOwner, workspaceId, {
      text: ` ${secret}\n`,
      reason: "A passphrase was written into the catalog.",
    })
    expect(purge).toMatchObject({
      number: 1,
      purgedBy: owner.handle,
      reason: "A passphrase was written into the catalog.",
      revision: 4,
      counts: {
        revisionTexts: 2,
        documents: 2,
        latestDocuments: 1,
        proposals: 5,
        rejectedProposals: 1,
        events: 1,
        comments: 1,
      },
      newProblems: [],
    })

    // Nothing in the database holds it any more, not even the earlier
    // versions of index rows or the job queue.
    expect(await tablesHolding(secret)).toEqual([])

    // The security log keeps every entry as it was, and records the purge
    // without the text.
    const logAfter = await securityLog()
    expect(logAfter.slice(0, logBefore.length)).toEqual(logBefore)
    const added = logAfter.slice(logBefore.length)
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({
      action: "catalog.purged",
      outcome: "succeeded",
      actorPersonId: owner.id,
      details: {
        purgeId: purge.id,
        number: 1,
        revision: 4,
        counts: purge.counts,
      },
    })

    // The purge is on the timeline, with who, what and why.
    const [event] = await db
      .select()
      .from(schema.events)
      .where(
        and(
          eq(schema.events.workspaceId, workspaceId),
          eq(schema.events.kind, "catalog.purged"),
        ),
      )
    expect(event).toMatchObject({
      actorPersonId: owner.id,
      data: {
        purgeId: purge.id,
        reason: "A passphrase was written into the catalog.",
        revision: 4,
      },
    })
    expect(event!.subjects).toContainEqual({
      type: "catalog-purge",
      id: purge.id,
    })
    expect(event!.subjects).toContainEqual({
      type: "catalog-proposal",
      id: waiting.id,
    })

    // Earlier text, as the wiki's history comparison reads it, shows the
    // marker; the document keeps its shape.
    const first = await getCatalogDocumentText(asOwner, workspaceId, {
      id: "machine/musashi",
      revision: 1,
    })
    expect(first.revision).toBe(1)
    expect(first.text).toContain(
      `The console passphrase is ${purgeMarker} for now.`,
    )
    const entity = await getCatalogEntity(asOwner, workspaceId, {
      id: "machine/daedalus",
    })
    expect(entity).toMatchObject({
      catalog_revision: 4,
      entity: {
        summary: `The build host; its old passphrase was ${purgeMarker}.`,
      },
    })
    const history = await listCatalogHistory(asOwner, workspaceId, {
      id: "machine/daedalus",
    })
    expect(history.items.map((i) => [i.revision, i.purge])).toEqual([
      [4, 1],
      [3, null],
    ])
    const changes = await getCatalogChanges(asOwnersAgent, workspaceId, {
      since: 3,
    })
    expect(changes.items).toMatchObject([
      { revision: 4, documents: [{ id: "machine/daedalus" }] },
    ])
    const found = await searchCatalog(asOwnersAgent, workspaceId, {
      text: secret.split("-")[2]!,
    })
    expect(found.items).toEqual([])

    // Proposals keep their shape; the waiting one was rejected.
    expect(await proposalRow(waiting)).toMatchObject({
      state: "rejected",
      explanation: `Daedalus is going away; ${purgeMarker} goes with it.`,
      rejectionReason: `Rejected by purge 1: it held text a workspace owner purged`,
      decidedByLabel: owner.handle,
    })
    const [stored] = await db
      .select({
        text: schema.catalogProposalComments.text,
        key: schema.catalogProposalComments.idempotencyKey,
      })
      .from(schema.catalogProposalComments)
      .where(eq(schema.catalogProposalComments.proposalId, waiting.id))
    expect(stored).toEqual({
      text: `The old passphrase ${purgeMarker}\nstill works.`,
      key: null,
    })
    expect(await proposalRow(rejected)).toMatchObject({
      state: "rejected",
      rejectionReason: `Not before ${purgeMarker} is rotated.`,
    })

    // D-006: the index is what the purged text gives, and stays so as
    // proposals apply on top.
    const compare = () =>
      db.transaction((tx) => compareWorkspaceIndex(tx, workspaceId), {
        isolationLevel: "repeatable read",
      })
    expect((await compare()).differences).toEqual([])
    // A later revision on top of the purged text.
    const after = await store(asOwnersAgent, [
      daedalus("The build host.", purgeMarker),
    ])
    expect(after).toBe(5)
    expect((await compare()).differences).toEqual([])
    expect(await tablesHolding(secret)).toEqual([])

    const { newProblems, ...listed } = purge
    expect(newProblems).toEqual([])
    expect(await listCatalogPurges(asContributor, workspaceId)).toEqual([
      listed,
    ])
  })

  it("is only for workspace owners who signed in again recently, never agents", async () => {
    await plant()
    const input = { text: secret, reason: "Leaked." }
    await expect(
      purgeCatalogText(asContributor, workspaceId, input),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      previewCatalogPurge(asContributor, workspaceId, input),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      purgeCatalogText(asOwnersAgent, workspaceId, input),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      purgeCatalogText(
        asPerson(db, owner, { reauthenticated: false }),
        workspaceId,
        input,
      ),
    ).rejects.toBeInstanceOf(ReauthenticationRequiredError)

    const refusals = await db
      .select()
      .from(schema.securityLog)
      .where(
        and(
          eq(schema.securityLog.workspaceId, workspaceId),
          eq(schema.securityLog.action, "request.refused"),
        ),
      )
    expect(refusals.map((r) => r.details)).toEqual([
      { action: "catalog.purge", reason: "role" },
      { action: "catalog.purge", reason: "role" },
      { action: "catalog.purge", reason: "people-only" },
      { action: "catalog.purge", reason: "reauthentication" },
    ])
    // Nothing was purged.
    expect(await listCatalogPurges(asOwner, workspaceId)).toEqual([])
    expect(await tablesHolding(secret)).toContain(
      "public.catalog_revision_documents",
    )
  })

  it("checks the text and the reason", async () => {
    await plant()
    const purge = (text: unknown, reason: unknown = "Leaked.") =>
      purgeCatalogText(asOwner, workspaceId, { text, reason })
    const refused = async (promise: Promise<unknown>, rule: string) => {
      const error: unknown = await promise.then(
        () => null,
        (e: unknown) => e,
      )
      expect(error).toBeInstanceOf(RuleViolationError)
      expect((error as RuleViolationError).rule).toBe(rule)
      // An error never repeats the text.
      expect((error as Error).message).not.toContain(secret)
    }
    await refused(purge(42), "text")
    await refused(purge(" abc "), "text-too-short")
    await refused(purge("x".repeat(10_001)), "text-too-long")
    await refused(purge("urged"), "text-in-marker")
    await refused(purge(secret, "  "), "reason-blank")
    await refused(purge(secret, `Leaked ${secret}`), "reason-holds-text")
    await refused(purge("not anywhere at all"), "nothing-to-purge")
    await expect(purge(42)).rejects.toBeInstanceOf(InvalidInputError)
    expect(await listCatalogPurges(asOwner, workspaceId)).toEqual([])
  })

  it("says when the index holds a text that the stored text writes differently", async () => {
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
      [
        {
          text: `---\nid: machine/escaped\ntype: machine\ntitle: Escaped\nsummary: "Key \\x41${secret}"\nowner: ${person}\n---\n`,
        },
      ],
    )
    const text = `A${secret}`
    expect(
      await previewCatalogPurge(asOwner, workspaceId, { text }),
    ).toMatchObject({
      revisionTexts: 0,
      writtenDifferently: ["machine/escaped"],
    })
    const refusal: unknown = await purgeCatalogText(asOwner, workspaceId, {
      text,
      reason: "Leaked.",
    }).catch((e: unknown) => e)
    expect(refusal).toMatchObject({ rule: "written-differently" })
    expect((refusal as Error).message).toContain("machine/escaped")
    expect((refusal as Error).message).not.toContain(secret)
    expect(await listCatalogPurges(asOwner, workspaceId)).toEqual([])
  })

  it("matches any run of whitespace, so wrapped text and split secrets go too", async () => {
    const address = "Jane Q Example, 12 Baker Street, Springfield"
    const split = secret.replace("-lantern", "-\nlantern")
    const body = `# Daedalus\n\nAsk Jane Q Example, 12 Baker\nStreet, Springfield for the key.\n\n    Indented:  Jane Q\r\n  Example, 12   Baker Street,\tSpringfield\n\nThe passphrase is ${split} for now.\n`
    const first = await store(asOwner, [ownerEntity()])
    const second = await store(asOwnersAgent, [
      `---
id: machine/daedalus
type: machine
title: Daedalus
summary: Contact ${address}.
status: active
owner: ${person}
---

${body}`,
    ])
    await storeProposal(asOwnersAgent, {
      explanation: `Contact ${address.replaceAll(" ", "  ")}.`,
      operations: [{ op: "create-entity", id: "machine/daedalus", body }],
      touches: ["machine/daedalus"],
      state: "applied",
      basedOnRevision: first,
      appliedRevision: second,
    })
    const words = ["Baker", "Springfield", "Jane Q"]
    const preview = await previewCatalogPurge(asOwner, workspaceId, {
      text: "Jane Q Example,\n12 Baker Street, Springfield",
    })
    expect(preview).toMatchObject({
      revisionTexts: 1,
      latestDocuments: ["machine/daedalus"],
      proposals: 1,
      acrossLines: { revisionTexts: 1, latestDocuments: ["machine/daedalus"] },
    })
    await purgeCatalogText(asOwner, workspaceId, {
      text: address,
      reason: "Personal data.",
    })
    await purgeCatalogText(asOwner, workspaceId, {
      text: secret,
      reason: "A passphrase, split by a line break.",
    })
    for (const word of [...words, "-\nlantern", secret.split("-")[2]!])
      expect([word, await tablesHolding(word)]).toEqual([word, []])
    const found = await searchCatalog(asOwnersAgent, workspaceId, {
      text: "Baker Street Springfield",
    })
    expect(found.items).toEqual([])
    const compared = await db.transaction(
      (tx) => compareWorkspaceIndex(tx, workspaceId),
      { isolationLevel: "repeatable read" },
    )
    expect(compared.differences).toEqual([])
  })

  it("purges a comment's idempotency key that holds the text", async () => {
    const { waiting } = await plant()
    await storeComment(
      asOwnersAgent,
      waiting,
      "Looks fine to me.",
      `review-${secret}`,
    )
    expect(
      await previewCatalogPurge(asOwner, workspaceId, { text: secret }),
    ).toMatchObject({ comments: 2 })
    const purge = await purgeCatalogText(asOwner, workspaceId, {
      text: secret,
      reason: "Leaked.",
    })
    expect(purge.counts.comments).toBe(2)
    expect(await tablesHolding(secret)).toEqual([])
    const comments = await db
      .select({
        text: schema.catalogProposalComments.text,
        key: schema.catalogProposalComments.idempotencyKey,
      })
      .from(schema.catalogProposalComments)
      .where(eq(schema.catalogProposalComments.proposalId, waiting.id))
    expect(comments).toContainEqual({ text: "Looks fine to me.", key: null })
  })

  it("purges a whole key block, as long as the text may be, in little time", async () => {
    let body = ""
    for (let i = 0; body.length < 6000; i++)
      body += randomBytes(48).toString("base64")
    const lines = ["-----BEGIN PRIVATE KEY-----"]
    for (let i = 0; i < 6000; i += 64) lines.push(body.slice(i, i + 64))
    lines.push("-----END PRIVATE KEY-----")
    const pem = lines.join("\n").slice(0, 6147)
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
      [
        {
          // Indented as a Markdown code block, with Windows line endings.
          text: `---\nid: machine/keyed\ntype: machine\ntitle: Keyed\nsummary: Holds a key.\nowner: ${person}\n---\n\n# Keyed\n\n    ${pem.replaceAll("\n", "\r\n    ")}\n`,
        },
      ],
    )
    const started = performance.now()
    expect(
      await previewCatalogPurge(asOwner, workspaceId, { text: pem }),
    ).toMatchObject({ revisionTexts: 1, latestDocuments: ["machine/keyed"] })
    await purgeCatalogText(asOwner, workspaceId, {
      text: pem,
      reason: "A private key in a page.",
    })
    expect(performance.now() - started).toBeLessThan(10_000)
    expect(await tablesHolding(lines[3]!)).toEqual([])
  })

  it("gives the event loop back between the values it matches (#149)", async () => {
    // A contrived worst case: many words of the text, then a word that
    // breaks them, over and over, so every place found fails late.
    const text = "a ".repeat(4999) + "a"
    const value = ("a ".repeat(4997) + "aa ").repeat(2)
    const started = performance.now()
    expect(new PurgeMatcher(text).test(value)).toBe(false)
    const single = performance.now() - started

    const documents = 12
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
      Array.from({ length: documents }, (_, i) => ({
        text: `---\nid: machine/m${i}\ntype: machine\ntitle: M${i}\nsummary: A host.\nowner: ${person}\n---\n\n${value}\n`,
      })),
    )

    // How long the event loop is held at most while the preview matches.
    let longest = 0
    let last = performance.now()
    const probe = setInterval(() => {
      const now = performance.now()
      longest = Math.max(longest, now - last)
      last = now
    }, 5)
    const previewStarted = performance.now()
    try {
      expect(
        await previewCatalogPurge(asOwner, workspaceId, { text }),
      ).toMatchObject({ revisionTexts: 0, writtenDifferently: [] })
    } finally {
      clearInterval(probe)
    }
    const total = performance.now() - previewStarted
    // Without the pauses, each query's values are matched in one stretch:
    // twelve values, at least. With them, about one value (a row can cost
    // a little more than `single`) and the pause's budget. Half the
    // documents leaves room either way, also on a busy machine.
    expect(total).toBeGreaterThan(documents * single)
    expect(longest).toBeLessThan((documents / 2) * single)
  })

  it("shows copies in encoded forms, and warns where purging changes a document's structure", async () => {
    const as = {
      kind: "person" as const,
      personId: owner.id,
      agentId: null,
      agentSessionId: null,
      label: owner.handle,
      confidence: "recorded" as const,
    }
    const percent = secret.replaceAll("-", "%2D")
    const word = secret.split("-")[2]!
    await storeCatalogRevision(db, workspaceId, as, [
      {
        text: `---\nid: machine/m-${word}\ntype: machine\ntitle: Leaky\nsummary: The key is\n  ${secret}\nstatus: active\nowner: ${person}\naliases: [machine/old-${word}]\n---\n\n# Leaky\n\n[Log in](https://example.test/?p=${percent}) with ${secret}.\n`,
      },
    ])
    const preview = await previewCatalogPurge(asOwner, workspaceId, {
      text: word,
    })
    expect(preview.structure).toEqual([
      { id: "machine/m-(purged)", where: "id" },
      { id: "machine/m-(purged)", where: "alias" },
    ])
    const full = await previewCatalogPurge(asOwner, workspaceId, {
      text: `The key is ${secret}\nstatus`,
    })
    expect(full.structure).toEqual([
      { id: `machine/m-${word}`, where: "key" },
      { id: `machine/m-${word}`, where: "frontmatter" },
    ])
    const encoded = await previewCatalogPurge(asOwner, workspaceId, {
      text: secret,
    })
    expect(encoded.alsoWrittenAs).toEqual([
      {
        form: "percent",
        text: percent,
        revisionTexts: 1,
        proposals: 0,
        events: 0,
        comments: 0,
      },
    ])

    // Purging the ID's word leaves the document with an invalid ID: the
    // purge says so, for the owner to repair.
    const purge = await purgeCatalogText(asOwner, workspaceId, {
      text: word,
      reason: "A key in an ID.",
    })
    expect(purge.newProblems).toEqual([
      {
        id: "machine/m-(purged)",
        problems: [
          expect.stringContaining('The ID "machine/m-(purged)"'),
          expect.stringContaining('The alias "machine/old-(purged)"'),
        ],
      },
    ])
    expect(JSON.stringify(purge)).not.toContain(word)
  })

  it("rebuilds the whole index when a type schema document held the text", async () => {
    const as = {
      kind: "person" as const,
      personId: owner.id,
      agentId: null,
      agentSessionId: null,
      label: owner.handle,
      confidence: "recorded" as const,
    }
    const leaked = fixtures.domainSchema.replace(
      "One entity per registered domain.",
      `One entity per registered domain. The registrar login is ${secret}.`,
    )
    const { documentIds } = await storeCatalogRevision(db, workspaceId, as, [
      { text: leaked },
      { text: fixtures.guneetDev },
    ])
    await storeCatalogRevision(db, workspaceId, as, [
      { documentId: documentIds[0]!, text: fixtures.domainSchema },
    ])
    const purge = await purgeCatalogText(asOwner, workspaceId, {
      text: secret,
      reason: "A login in a schema's body.",
    })
    expect(purge.counts).toMatchObject({ revisionTexts: 1, latestDocuments: 0 })
    expect(await tablesHolding(secret)).toEqual([])
    const compared = await db.transaction(
      (tx) => compareWorkspaceIndex(tx, workspaceId),
      { isolationLevel: "repeatable read" },
    )
    expect(compared).toMatchObject({ documents: 2, differences: [] })
  })
})

describe("the database's append-only rules", () => {
  async function event(): Promise<number> {
    const [row] = await db
      .insert(schema.events)
      .values({
        workspaceId,
        kind: "test.event",
        origin: "shinan_action",
        actorKind: "shinan",
        actorLabel: "shinan",
        confidence: "recorded",
        summary: `Mentions ${secret}`,
      })
      .returning({ id: schema.events.id })
    return row!.id
  }

  const emptyCounts = {
    revisionTexts: 0,
    documents: 0,
    latestDocuments: 0,
    proposals: 0,
    rejectedProposals: 0,
    events: 0,
    comments: 0,
  }

  async function recordPurge(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    workspace = workspaceId,
  ) {
    await tx.insert(schema.catalogPurges).values({
      workspaceId: workspace,
      number: 1,
      actorKind: "person",
      actorPersonId: owner.id,
      actorLabel: owner.handle,
      confidence: "recorded",
      reason: "Test.",
      counts: emptyCounts,
    })
  }

  const refused = (promise: Promise<unknown>) =>
    expect(promise).rejects.toMatchObject({
      cause: { code: "42501" },
    })

  it("keep a purge's record: never deleted, and only its counts filled in, by its own transaction", async () => {
    const id = await event()
    const e = schema.events
    const p = schema.catalogPurges
    // Rewriting history and then removing the record that allowed it fails
    // as a whole.
    await refused(
      db.transaction(async (tx) => {
        await recordPurge(tx)
        await tx.update(e).set({ summary: "Changed" }).where(eq(e.id, id))
        await tx.delete(p).where(eq(p.workspaceId, workspaceId))
      }),
    )
    const [unchanged] = await db.select().from(e).where(eq(e.id, id))
    expect(unchanged!.summary).toBe(`Mentions ${secret}`)

    // Only its counts, even in its own transaction.
    await refused(
      db.transaction(async (tx) => {
        await recordPurge(tx)
        await tx
          .update(p)
          .set({ reason: "Other." })
          .where(eq(p.workspaceId, workspaceId))
      }),
    )
    await db.transaction(async (tx) => {
      await recordPurge(tx)
      await tx
        .update(p)
        .set({ counts: { ...emptyCounts, events: 1 } })
        .where(eq(p.workspaceId, workspaceId))
    })
    // Afterwards, nothing at all.
    await refused(
      db
        .update(p)
        .set({ reason: "Other." })
        .where(eq(p.workspaceId, workspaceId)),
    )
    await refused(
      db
        .update(p)
        .set({ counts: emptyCounts })
        .where(eq(p.workspaceId, workspaceId)),
    )
    await refused(db.delete(p).where(eq(p.workspaceId, workspaceId)))
    await refused(db.execute(sql`truncate catalog_purges cascade`))
  })

  it("let a purge change only events' summary and data, and only in its own transaction", async () => {
    const id = await event()
    const e = schema.events
    // Outside a purge: refused.
    await refused(db.update(e).set({ summary: "Changed" }).where(eq(e.id, id)))
    // In a transaction that records a purge of another workspace: refused.
    const other = await createWorkspace(asOwner, { name: "Other" })
    await refused(
      db.transaction(async (tx) => {
        await recordPurge(tx, other.workspace.id)
        await tx.update(e).set({ summary: "Changed" }).where(eq(e.id, id))
      }),
    )
    // In the purge's transaction: other columns and deletes are refused.
    await refused(
      db.transaction(async (tx) => {
        await recordPurge(tx)
        await tx.update(e).set({ kind: "other" }).where(eq(e.id, id))
      }),
    )
    await refused(
      db.transaction(async (tx) => {
        await recordPurge(tx)
        await tx.delete(e).where(eq(e.id, id))
      }),
    )
    await db.transaction(async (tx) => {
      await recordPurge(tx)
      await tx
        .update(e)
        .set({ summary: "Purged", data: { purged: true } })
        .where(eq(e.id, id))
    })
    const [row] = await db.select().from(e).where(eq(e.id, id))
    expect(row).toMatchObject({ summary: "Purged", data: { purged: true } })
  })

  it("let a purge change only revision text, and never the security log", async () => {
    await plant()
    const r = schema.catalogRevisionDocuments
    await refused(
      db
        .update(r)
        .set({ text: "Changed" })
        .where(eq(r.workspaceId, workspaceId)),
    )
    await refused(
      db.transaction(async (tx) => {
        await recordPurge(tx)
        await tx
          .update(r)
          .set({ revision: 99 })
          .where(eq(r.workspaceId, workspaceId))
      }),
    )
    await refused(
      db.transaction(async (tx) => {
        await recordPurge(tx)
        await tx
          .update(schema.catalogRevisions)
          .set({ actorLabel: "someone" })
          .where(eq(schema.catalogRevisions.workspaceId, workspaceId))
      }),
    )
    await refused(
      db.transaction(async (tx) => {
        await recordPurge(tx)
        await tx
          .update(schema.securityLog)
          .set({ details: {} })
          .where(eq(schema.securityLog.workspaceId, workspaceId))
      }),
    )
    await refused(
      db.transaction(async (tx) => {
        await recordPurge(tx)
        await tx
          .delete(schema.securityLog)
          .where(eq(schema.securityLog.workspaceId, workspaceId))
      }),
    )
  })
})
