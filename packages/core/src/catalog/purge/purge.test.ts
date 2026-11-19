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
import type { CatalogOperation, CheckInput } from "../document/index.js"
import { compareWorkspaceIndex } from "../index/indexer.js"
import {
  getCatalogChanges,
  getCatalogEntity,
  searchCatalog,
} from "../index/queries.js"
import { CatalogWorkers, replaceCatalogWorkers } from "../proposals/pool.js"
import type { Prepare, Turn } from "../proposals/pool.js"
import {
  getCatalogProposal,
  proposeCatalogChange,
  rejectCatalogProposal,
} from "../proposals/proposals.js"
import type {
  CatalogProposal,
  ProposalOutcome,
} from "../proposals/proposals.js"
import {
  commentOnCatalogProposal,
  listCatalogProposalComments,
} from "../proposals/review.js"
import { getCatalogDocumentText, listCatalogHistory } from "../wiki.js"
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

async function propose(
  ctx: Context,
  operations: CatalogOperation[],
  explanation = "A test change.",
): Promise<CatalogProposal> {
  return stored(
    await proposeCatalogChange(ctx, workspaceId, { explanation, operations }),
  )
}

function stored(outcome: ProposalOutcome): CatalogProposal {
  if (!("proposal" in outcome))
    throw new Error(`Not stored: ${JSON.stringify(outcome, null, 2)}`)
  return outcome.proposal
}

/**
 * The secret, planted wherever the catalog stores text: in Musashi's first
 * revision only, in Daedalus's latest text, in proposals (applied, waiting
 * and rejected: operations, explanations, a rejection reason), in a comment
 * on a proposal, and in a timeline event (the rejection's reason).
 */
async function plant(): Promise<{
  waiting: CatalogProposal
  rejected: CatalogProposal
}> {
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
          fact: { key: "hostname", state: "observed", value: "musashi" },
          check,
        },
      ],
      body: `# Musashi\n\nThe shared production host.\n\n## Access\n\nThe console passphrase is ${secret} for now.\n`,
    },
  ])
  await propose(
    asOwnersAgent,
    [
      {
        op: "edit-body",
        document: "machine/musashi",
        section: "access",
        text: "## Access\n\nAsk the owner for console access.\n",
        expect: {
          text: `## Access\n\nThe console passphrase is ${secret} for now.\n`,
        },
      },
    ],
    `Took ${secret} out of the page.`,
  )
  await propose(asOwnersAgent, [
    {
      op: "create-entity",
      id: "machine/daedalus",
      title: "Daedalus",
      summary: `The build host; its old passphrase was ${secret}.`,
      owner: person,
      facts: [
        {
          fact: {
            key: "hostname",
            state: "observed",
            value: "daedalus",
            note: `Reached with ${secret}`,
          },
          check,
        },
      ],
      body: `# Daedalus\n\nLog in with ${secret} until it is rotated.\n`,
    },
  ])
  const waiting = await propose(
    asOwnersAgent,
    [
      {
        op: "set-field",
        document: "machine/daedalus",
        field: "status",
        value: "deprecated",
        expect: { value: "active" },
      },
    ],
    `Daedalus is going away; ${secret} goes with it.`,
  )
  expect(waiting.state).toBe("pending")
  const rejected = await propose(
    asOwnersAgent,
    [
      {
        op: "set-field",
        document: "machine/musashi",
        field: "status",
        value: "deprecated",
        expect: { value: "active" },
      },
    ],
    "Musashi is going away.",
  )
  await rejectCatalogProposal(asOwner, workspaceId, {
    proposalId: rejected.id,
    reason: `Not before ${secret} is rotated.`,
  })
  await commentOnCatalogProposal(asOwnersAgent, workspaceId, {
    proposalId: waiting.id,
    text: `The old passphrase ${secret}\nstill works.`,
    idempotencyKey: "comment-1",
  })
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

// Each test applies proposals in catalog worker threads, which start slowly
// on a busy machine.
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
    const daedalus = await getCatalogEntity(asOwner, workspaceId, {
      id: "machine/daedalus",
    })
    expect(daedalus).toMatchObject({
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
    expect(
      await getCatalogProposal(asOwner, workspaceId, waiting.id),
    ).toMatchObject({
      state: "rejected",
      explanation: `Daedalus is going away; ${purgeMarker} goes with it.`,
      rejectionReason: `Rejected by purge 1: it held text a workspace owner purged`,
      decidedBy: owner.handle,
    })
    const [comment] = await listCatalogProposalComments(
      asOwner,
      workspaceId,
      waiting.id,
    ).then((page) => page.items)
    expect(comment).toMatchObject({
      text: `The old passphrase ${purgeMarker}\nstill works.`,
    })
    const [stored] = await db
      .select({ key: schema.catalogProposalComments.idempotencyKey })
      .from(schema.catalogProposalComments)
      .where(eq(schema.catalogProposalComments.proposalId, waiting.id))
    expect(stored!.key).toBeNull()
    expect(
      await getCatalogProposal(asOwner, workspaceId, rejected.id),
    ).toMatchObject({
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
    const after = await propose(asOwnersAgent, [
      {
        op: "set-field",
        document: "machine/daedalus",
        field: "summary",
        value: "The build host.",
        expect: {
          value: `The build host; its old passphrase was ${purgeMarker}.`,
        },
      },
    ])
    expect(after).toMatchObject({ state: "applied", appliedRevision: 5 })
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
    ])
    await propose(
      asOwnersAgent,
      [
        {
          op: "create-entity",
          id: "machine/daedalus",
          title: "Daedalus",
          summary: `Contact ${address}.`,
          owner: person,
          body: `# Daedalus\n\nAsk Jane Q Example, 12 Baker\nStreet, Springfield for the key.\n\n    Indented:  Jane Q\r\n  Example, 12   Baker Street,\tSpringfield\n\nThe passphrase is ${split} for now.\n`,
        },
      ],
      `Contact ${address.replaceAll(" ", "  ")}.`,
    )
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
    await commentOnCatalogProposal(asOwnersAgent, workspaceId, {
      proposalId: waiting.id,
      text: "Looks fine to me.",
      idempotencyKey: `review-${secret}`,
    })
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

  it("makes a proposal worked out before a purge be worked out again, even when no latest text changed", async () => {
    await plant()
    // Musashi's latest text no longer holds it; only its first revision does.
    const text = "The console passphrase is"
    let purged = false
    let prepared = 0
    class Racing extends CatalogWorkers {
      override run<T>(
        workspace: string,
        work: (prepare: Prepare, turn: Turn) => Promise<T>,
      ): Promise<T> {
        return super.run(workspace, (prepare, turn) =>
          work(async (...args) => {
            const result = await prepare(...args)
            prepared++
            if (!purged) {
              purged = true
              await purgeCatalogText(asOwner, workspaceId, {
                text,
                reason: "Old wording.",
              })
            }
            return result
          }, turn),
        )
      }
    }
    const workers = new Racing()
    const previous = replaceCatalogWorkers(workers)
    try {
      const proposal = await propose(asOwnersAgent, [
        {
          op: "recheck-facts",
          document: "machine/musashi",
          facts: [
            {
              identity: "hostname|observed",
              value: "musashi",
              check: { checked: today },
            },
          ],
          check: { ...check, scope: "Recheck of hostname" },
        },
      ])
      expect(proposal).toMatchObject({ state: "applied", basedOnRevision: 3 })
    } finally {
      replaceCatalogWorkers(previous!)
      await workers.close()
    }
    expect(prepared).toBe(2)
    expect(await listCatalogPurges(asOwner, workspaceId)).toMatchObject([
      { number: 1, revision: null, counts: { latestDocuments: 0 } },
    ])
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
