import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { asc, eq, schema, sql } from "@shinan/db"
import type { Transaction } from "@shinan/db"

import * as fixtures from "../../../test/catalog-index-fixtures.js"
import {
  asAgent,
  asPerson,
  asShinan,
  newPerson,
  testDatabase,
} from "../../../test/helpers.js"
import type { ResolvedActor } from "../../actor.js"
import {
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
} from "../../errors.js"
import { addMember } from "../../identity/members.js"
import type { Person } from "../../identity/people.js"
import { createWorkspace } from "../../identity/workspaces.js"
import type { JobQueue } from "../../jobs.js"
import { parserVersion } from "../document/index.js"
import { appendCatalogRevision, findCatalogDocument } from "../revisions.js"
import type { RevisionActor } from "../revisions.js"
import { compareWorkspaceIndex, rebuildWorkspaceIndex } from "./indexer.js"
import {
  checkCatalogIndexes,
  getCatalogIndexHealth,
  rebuildCatalogIndex,
  requestCatalogIndexRebuilds,
} from "./maintain.js"
import {
  getCatalogChanges,
  getCatalogEntity,
  getCatalogList,
  getCatalogNeighbours,
  getCatalogPoliciesFor,
  getCatalogStartHere,
  getCatalogTypeSchema,
  listCatalogEntities,
  listCatalogTypeSchemas,
  searchCatalog,
} from "./queries.js"

const { db, pool } = testDatabase()

afterAll(async () => {
  await pool.end()
})

let owner: Person
let workspaceId: string

function personActor(person: Person): RevisionActor {
  return {
    kind: "person",
    personId: person.id,
    agentId: null,
    agentSessionId: null,
    label: person.handle,
    confidence: "recorded",
  }
}

const shinanActor: RevisionActor = {
  kind: "shinan",
  personId: null,
  agentId: null,
  agentSessionId: null,
  label: "shinan",
  confidence: "recorded",
}

async function apply(
  actor: RevisionActor,
  documents: { documentId?: string; text: string }[],
) {
  return db.transaction((tx) =>
    appendCatalogRevision(tx, workspaceId, actor, documents),
  )
}

async function documentId(catalogId: string): Promise<string> {
  const id = await db.transaction((tx) =>
    findCatalogDocument(tx, workspaceId, catalogId),
  )
  if (!id) throw new Error(`No document ${catalogId}`)
  return id
}

/** Every index row of the workspace, in a stable form, without the generated search columns. */
async function snapshot(): Promise<string> {
  const tables = [
    schema.catalogIndexDocuments,
    schema.catalogIndexFacts,
    schema.catalogIndexRelations,
    schema.catalogIndexDiscrepancies,
    schema.catalogIndexSections,
  ] as const
  const all: unknown[] = []
  for (const table of tables) {
    const rows: Record<string, unknown>[] = await db
      .select()
      .from(table)
      .where(eq(table.workspaceId, workspaceId))
    const stable = rows
      .map((row) => {
        const stored = { ...row }
        delete stored.search
        return JSON.stringify(sortKeys(stored))
      })
      .sort()
    all.push(stable)
  }
  return JSON.stringify(all)
}

function sortKeys(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((k) => [k, value[k]]),
  )
}

beforeEach(async () => {
  owner = await newPerson(db, "owner")
  const created = await createWorkspace(asPerson(db, owner), { name: "Team" })
  workspaceId = created.workspace.id
})

describe("appending revisions", () => {
  it("numbers revisions from 1 and indexes their documents", async () => {
    const first = await apply(personActor(owner), [
      { text: fixtures.guneet },
      { text: fixtures.musashi },
    ])
    const second = await apply(personActor(owner), [
      { text: fixtures.daedalus },
    ])
    expect(first.revision).toBe(1)
    expect(second.revision).toBe(2)
    expect(first.documentIds).toHaveLength(2)

    const answer = await getCatalogEntity(asPerson(db, owner), workspaceId, {
      id: "machine/musashi",
    })
    expect(answer.catalog_revision).toBe(2)
    expect(answer.index_behind).toBe(false)
    expect(answer.entity).toMatchObject({
      id: "machine/musashi",
      type: "machine",
      title: "Musashi",
      status: "active",
      revision: 1,
      aliases: ["machine/takezo-old"],
    })
  })

  it("refuses to change a document of another workspace", async () => {
    const other = await createWorkspace(asPerson(db, owner), { name: "Other" })
    const [id] = (
      await db.transaction((tx) =>
        appendCatalogRevision(tx, other.workspace.id, personActor(owner), [
          { text: fixtures.guneet },
        ]),
      )
    ).documentIds
    await expect(
      apply(personActor(owner), [{ documentId: id!, text: fixtures.guneet }]),
    ).rejects.toThrow(/documents of its workspace/)
  })

  it("never edits a stored revision", async () => {
    await apply(personActor(owner), [{ text: fixtures.guneet }])
    await expect(
      db
        .update(schema.catalogRevisionDocuments)
        .set({ text: "changed" })
        .where(eq(schema.catalogRevisionDocuments.workspaceId, workspaceId)),
    ).rejects.toThrow()
    await expect(
      db
        .delete(schema.catalogRevisions)
        .where(eq(schema.catalogRevisions.workspaceId, workspaceId)),
    ).rejects.toThrow()
  })
})

/** Builds the fixture catalog over several revisions by different authors. */
async function buildCatalog(agentActor: RevisionActor) {
  await apply(
    personActor(owner),
    fixtures.allDocuments.map((text) => ({ text })),
  )
  // An agent changes only Musashi's Cautions section.
  await apply(agentActor, [
    {
      documentId: await documentId("machine/musashi"),
      text: fixtures.musashi.replace(
        "Every deployment change needs the owner's approval.",
        "Every deployment change needs the owner's approval. Ask first.",
      ),
    },
  ])
  // Shinan changes only frontmatter: the body's credits stay.
  await apply(shinanActor, [
    {
      documentId: await documentId("machine/musashi"),
      text: fixtures.musashi
        .replace("disk.data.free: 74 GiB", "disk.data.free: 70 GiB")
        .replace(
          "Every deployment change needs the owner's approval.",
          "Every deployment change needs the owner's approval. Ask first.",
        ),
    },
  ])
  // A built-in type is extended: machines are indexed again.
  await apply(personActor(owner), [{ text: fixtures.machineExtension }])
}

async function agentRevisionActor(): Promise<RevisionActor> {
  const ctx = await asAgent(db, owner, workspaceId)
  if (ctx.actor.kind !== "agent") throw new Error("Expected an agent")
  return {
    kind: "agent",
    personId: owner.id,
    agentId: ctx.actor.agentId,
    agentSessionId: null,
    label: `${owner.handle} via ${ctx.actor.agentHandle}`,
    confidence: "recorded",
  } satisfies Partial<ResolvedActor>
}

describe("the D-006 invariant", () => {
  it("indexes text the same way, applied revision by revision or rebuilt from the text", async () => {
    await buildCatalog(await agentRevisionActor())
    const compared = await db.transaction((tx) =>
      compareWorkspaceIndex(tx, workspaceId),
    )
    expect(compared.differences).toEqual([])
    expect(compared.documents).toBe(fixtures.allDocuments.length + 1)
  })

  it("gives the same rows after deleting every index row and rebuilding", async () => {
    await buildCatalog(await agentRevisionActor())
    const before = await snapshot()
    await db
      .delete(schema.catalogIndexDocuments)
      .where(eq(schema.catalogIndexDocuments.workspaceId, workspaceId))
    expect(
      await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.catalogIndexFacts)
        .where(eq(schema.catalogIndexFacts.workspaceId, workspaceId)),
    ).toEqual([{ count: 0 }])

    const rebuilt = await db.transaction((tx) =>
      rebuildWorkspaceIndex(tx, workspaceId),
    )
    expect(rebuilt).toEqual({
      revision: 4,
      documents: fixtures.allDocuments.length + 1,
    })
    expect(await snapshot()).toBe(before)
  })

  it("records the parser version on every row", async () => {
    await apply(personActor(owner), [{ text: fixtures.musashi }])
    for (const table of [
      schema.catalogIndexDocuments,
      schema.catalogIndexFacts,
      schema.catalogIndexRelations,
      schema.catalogIndexDiscrepancies,
      schema.catalogIndexSections,
    ]) {
      const versions = await db
        .selectDistinct({ version: table.parserVersion })
        .from(table)
        .where(eq(table.workspaceId, workspaceId))
      expect(versions).toEqual([{ version: parserVersion }])
    }
  })
})

describe("section credits", () => {
  it("credits each section to the revision that last changed it", async () => {
    const agent = await agentRevisionActor()
    await buildCatalog(agent)
    const { entity } = await getCatalogEntity(
      asPerson(db, owner),
      workspaceId,
      { id: "machine/musashi" },
    )
    expect(
      entity.body.map((s) => [
        s.heading,
        s.changed_in,
        s.changed_by,
        s.changed_by_kind,
      ]),
    ).toEqual([
      [null, 1, owner.handle, "person"],
      ["Musashi", 1, owner.handle, "person"],
      ["Cautions", 2, agent.label, "agent"],
    ])
    expect(entity.body.map((s) => s.written_by_kind)).toEqual([
      "person",
      "person",
      "agent",
    ])
  })

  it("credits a renamed section to whoever renamed it", async () => {
    await apply(personActor(owner), [{ text: fixtures.musashi }])
    await apply(shinanActor, [
      {
        documentId: await documentId("machine/musashi"),
        text: fixtures.musashi.replace("## Cautions", "## Warnings"),
      },
    ])
    const { entity } = await getCatalogEntity(
      asPerson(db, owner),
      workspaceId,
      { id: "machine/musashi" },
    )
    expect(entity.body.map((s) => [s.anchor, s.changed_in])).toEqual([
      [null, 1],
      ["musashi", 1],
      ["warnings", 2],
    ])
  })
})

describe("type schema changes", () => {
  it("indexes the type's entities again when its schema document changes", async () => {
    await apply(personActor(owner), [
      { text: fixtures.domainSchema },
      { text: fixtures.guneetDev },
    ])
    const before = await getCatalogEntity(asPerson(db, owner), workspaceId, {
      id: "domain/guneet-dev",
    })
    expect(
      before.entity.facts.find((f) => f.key === "expires_on")?.freshness
        .recheck_days,
    ).toBe(30)

    await apply(personActor(owner), [
      {
        documentId: await documentId("schema/domain"),
        text: fixtures.domainSchema.replace(
          "expires_on: { recheck: 30d }",
          "expires_on: { recheck: 60d }",
        ),
      },
    ])
    const after = await getCatalogEntity(asPerson(db, owner), workspaceId, {
      id: "domain/guneet-dev",
    })
    expect(
      after.entity.facts.find((f) => f.key === "expires_on")?.freshness
        .recheck_days,
    ).toBe(60)
    // The entity's own text did not change.
    expect(after.entity.revision).toBe(1)
    const compared = await db.transaction((tx) =>
      compareWorkspaceIndex(tx, workspaceId),
    )
    expect(compared.differences).toEqual([])
  })
})

describe("type schemas kept between revisions", () => {
  const withTags = fixtures.domainSchema.replace(
    "  registrar: {}\n",
    "  registrar: {}\n  tags: { many: true }\n",
  )
  const withNotes = fixtures.domainSchema.replace(
    "  registrar: {}\n",
    "  registrar: {}\n  notes: {}\n",
  )
  const tagged = fixtures.guneetDev.replace(
    "      registrar: Cloudflare\n",
    "      registrar: Cloudflare\n      tags: main\n",
  )

  async function tagsFact() {
    const { entity } = await getCatalogEntity(
      asPerson(db, owner),
      workspaceId,
      {
        id: "domain/guneet-dev",
      },
    )
    return entity.facts.find((f) => f.key === "tags")
  }

  it("never come back from a revision that was rolled back", async () => {
    await apply(personActor(owner), [
      { text: fixtures.domainSchema },
      { text: tagged },
    ])
    const schemaId = await documentId("schema/domain")
    await expect(
      db.transaction(async (tx) => {
        await appendCatalogRevision(tx, workspaceId, personActor(owner), [
          { documentId: schemaId, text: withTags },
        ])
        throw new Error("Something later in the apply failed")
      }),
    ).rejects.toThrow(/later in the apply/)
    // The next revision takes the same number, with another schema.
    const next = await apply(personActor(owner), [
      { documentId: schemaId, text: withNotes },
    ])
    expect(next.revision).toBe(2)

    expect(await tagsFact()).toMatchObject({ many: false, in_schema: false })
    const compared = await db.transaction((tx) =>
      compareWorkspaceIndex(tx, workspaceId),
    )
    expect(compared.differences).toEqual([])
  })

  it("follow a schema document's text when it is rewritten in place, as purge does", async () => {
    await apply(personActor(owner), [{ text: withTags }, { text: tagged }])
    const schemaId = await documentId("schema/domain")
    // Purge (M2-10) replaces content in a stored revision; here the schema's
    // text loses the key that a revision applied earlier had cached.
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`alter table catalog_revision_documents disable trigger catalog_revision_documents_append_only`,
      )
      await tx
        .update(schema.catalogRevisionDocuments)
        .set({ text: fixtures.domainSchema })
        .where(eq(schema.catalogRevisionDocuments.documentId, schemaId))
      await tx.execute(
        sql`alter table catalog_revision_documents enable trigger catalog_revision_documents_append_only`,
      )
    })
    // A later revision of the entity is read with the schema as now stored.
    await apply(personActor(owner), [
      {
        documentId: await documentId("domain/guneet-dev"),
        text: tagged.replace("The main domain.", "The main domain, still."),
      },
    ])
    expect(await tagsFact()).toMatchObject({ many: false, in_schema: false })
  })

  it("follow which of two schema documents defines a type", async () => {
    const second = fixtures.domainSchema.replace(
      "  registrar: {}\n",
      "  registrar: {}\n  tags: { many: true }\n",
    )
    await apply(personActor(owner), [
      { text: fixtures.domainSchema },
      { text: second },
      { text: tagged },
    ])
    // The schema that defines `domain` is the first by document ID; move
    // that one to another type, so the other one takes over.
    const [first] = (
      await db
        .select({ id: schema.catalogIndexDocuments.documentId })
        .from(schema.catalogIndexDocuments)
        .where(
          sql`${schema.catalogIndexDocuments.workspaceId} = ${workspaceId} and ${schema.catalogIndexDocuments.kind} = 'schema'`,
        )
        .orderBy(asc(schema.catalogIndexDocuments.documentId))
    ).map((r) => r.id)
    const [firstText] = await db
      .select({ text: schema.catalogRevisionDocuments.text })
      .from(schema.catalogRevisionDocuments)
      .where(eq(schema.catalogRevisionDocuments.documentId, first!))
    await apply(personActor(owner), [
      {
        documentId: first!,
        text: firstText!.text.replace("id: schema/domain", "id: schema/area"),
      },
    ])
    const compared = await db.transaction((tx) =>
      compareWorkspaceIndex(tx, workspaceId),
    )
    expect(compared.differences).toEqual([])
    const domain = await getCatalogTypeSchema(
      asPerson(db, owner),
      workspaceId,
      {
        type: "domain",
      },
    )
    expect(domain.schema.document).toBe("schema/domain")
  })
})

describe("queries", () => {
  beforeEach(async () => {
    await apply(
      personActor(owner),
      fixtures.allDocuments.map((text) => ({ text })),
    )
  })

  it("gets an entity by an alias, with facts, freshness and discrepancies", async () => {
    const { entity } = await getCatalogEntity(
      asPerson(db, owner),
      workspaceId,
      { id: "machine/takezo-old" },
    )
    expect(entity.id).toBe("machine/musashi")
    const size = entity.facts.find(
      (f) => f.identity === "disk.data.size|observed|via=filesystem",
    )
    expect(size).toMatchObject({
      key: "disk.data.size",
      state: "observed",
      value: "128 GiB",
      via: "filesystem",
      many: false,
      relation: false,
      in_schema: true,
      check: {
        checked: "2026-11-14",
        by: "guneet via opencode-daedalus",
        scope: "Online data-disk grow",
        limits: null,
      },
      freshness: { recheck_days: 30 },
    })
    expect(entity.discrepancies).toEqual([
      {
        key: "disk.data.size",
        values: ["128 GiB", "64 GB"],
        accepted: false,
        facts: [
          "disk.data.size|observed|via=filesystem",
          "disk.data.size|observed|via=instance-metadata",
        ],
      },
    ])
    expect(entity.known_unknowns).toEqual(["network.public_ipv6|unknown"])
    expect(entity.not_yet_recorded.missing_keys).toEqual([
      "environment",
      "access.method",
    ])
  })

  it("shows relations in both directions, through aliases", async () => {
    const { entity } = await getCatalogEntity(
      asPerson(db, owner),
      workspaceId,
      { id: "machine/musashi" },
    )
    expect(
      entity.relations.incoming.map((r) => [r.key, r.inverse, r.from.id]),
    ).toEqual([
      ["checkout-on", "checkouts", "project/dockyard"],
      ["applies-to", "runbooks", "runbook/rebuild-musashi"],
      ["runs-on", "services", "service/container-registry"],
    ])
    const dockyard = await getCatalogNeighbours(
      asPerson(db, owner),
      workspaceId,
      { id: "project/dockyard" },
    )
    expect(
      dockyard.outgoing.map((r) => [r.key, r.to, r.entity?.id ?? null]),
    ).toEqual([
      ["checkout-on", "machine/daedalus", "machine/daedalus"],
      ["checkout-on", "machine/takezo-old", "machine/musashi"],
      ["provides", "service/container-registry", "service/container-registry"],
    ])
    const person = await getCatalogNeighbours(
      asPerson(db, owner),
      workspaceId,
      { id: "person/guneet" },
    )
    // Every entity names an owner; the schema and start-here documents are not entities.
    expect(person.incoming.filter((r) => r.inverse === "owns")).toHaveLength(
      fixtures.allDocuments.length - 2,
    )
  })

  it("lists the policies and runbooks that apply, by entity, type and workspace", async () => {
    const applies = await getCatalogPoliciesFor(
      asPerson(db, owner),
      workspaceId,
      { id: "machine/musashi" },
    )
    expect(
      applies.policies.map((p) => [p.entity.id, p.through]).sort(),
    ).toEqual([
      ["policy/deploy-approval", "type"],
      ["policy/no-secrets", "workspace"],
    ])
    expect(applies.runbooks.map((p) => [p.entity.id, p.through])).toEqual([
      ["runbook/rebuild-musashi", "entity"],
    ])
    const project = await getCatalogPoliciesFor(
      asPerson(db, owner),
      workspaceId,
      { id: "project/dockyard" },
    )
    expect(project.policies.map((p) => p.entity.id)).toEqual([
      "policy/no-secrets",
    ])
  })

  it("searches titles, summaries, facts and body sections, leaving out retired entities", async () => {
    const ctx = asPerson(db, owner)
    const byBody = await searchCatalog(ctx, workspaceId, {
      text: "submodule",
    })
    expect(byBody.items.map((i) => i.entity.id)).toEqual(["project/dockyard"])
    expect(byBody.items[0]!.sections.map((s) => s.anchor)).toEqual(["cautions"])

    const byFact = await searchCatalog(ctx, workspaceId, {
      text: "instance-metadata",
    })
    expect(byFact.items.map((i) => i.entity.id)).toEqual(["machine/musashi"])

    const byTitle = await searchCatalog(ctx, workspaceId, { text: "machines" })
    expect(byTitle.items.map((i) => i.entity.id)).not.toContain(
      "machine/takezo",
    )
    const retired = await searchCatalog(ctx, workspaceId, {
      text: "takezo",
      includeRetired: true,
    })
    expect(retired.items.map((i) => i.entity.id)).toContain("machine/takezo")
    const hidden = await searchCatalog(ctx, workspaceId, { text: "takezo" })
    expect(hidden.items.map((i) => i.entity.id)).not.toContain("machine/takezo")
  })

  it("leaves out entities with a word after a minus, wherever the word is", async () => {
    const entity = (slug: string, summary: string, body: string) => `---
id: project/${slug}
type: project
title: Alpha ${slug}
summary: ${summary}
status: active
owner: person/guneet
---

# Alpha ${slug}

## Notes

${body}
`
    await apply(personActor(owner), [
      { text: entity("one", "Keeps running all day.", "Quiet.") },
      { text: entity("two", "Quiet.", "Keeps running all day.") },
      { text: entity("three", "Quiet.", "Quiet.") },
    ])
    const found = await searchCatalog(asPerson(db, owner), workspaceId, {
      text: "alpha -running",
    })
    expect(found.items.map((i) => i.entity.id)).toEqual(["project/three"])
  })

  it("refuses control characters in what it is asked, before the database sees them", async () => {
    const ctx = asPerson(db, owner)
    await expect(
      searchCatalog(ctx, workspaceId, { text: "a\u0000b" }),
    ).rejects.toThrow(InvalidInputError)
    await expect(
      getCatalogEntity(ctx, workspaceId, { id: "machine/\u0000musashi" }),
    ).rejects.toThrow(InvalidInputError)
  })

  it("lists entities by type and status", async () => {
    const ctx = asPerson(db, owner)
    const machines = await listCatalogEntities(ctx, workspaceId, {
      type: "machine",
    })
    expect(machines.items.map((e) => e.id)).toEqual([
      "machine/daedalus",
      "machine/musashi",
    ])
    const retired = await listCatalogEntities(ctx, workspaceId, {
      status: "retired",
    })
    expect(retired.items.map((e) => e.id)).toEqual(["machine/takezo"])
    const first = await listCatalogEntities(ctx, workspaceId, { limit: 2 })
    expect(first.items).toHaveLength(2)
    expect(first.next_offset).toBe(2)
  })

  it("gives the workspace lists", async () => {
    const ctx = asPerson(db, owner)
    const found = await getCatalogList(ctx, workspaceId, {
      list: "discrepancies",
    })
    expect(found.items).toMatchObject([
      { entity: { id: "machine/musashi" }, key: "disk.data.size" },
    ])

    const due = await getCatalogList(ctx, workspaceId, {
      list: "due-for-recheck",
    })
    expect(
      due.items.map((i) => ("fact" in i ? i.fact.identity : null)),
    ).toEqual(["expires_on|observed"])

    const unknowns = await getCatalogList(ctx, workspaceId, {
      list: "known-unknowns",
    })
    expect(
      unknowns.items.map((i) => ("fact" in i ? i.fact.identity : null)),
    ).toEqual(["network.public_ipv6|unknown", "last_successful_run|unknown"])

    const missing = await getCatalogList(ctx, workspaceId, {
      list: "not-yet-recorded",
    })
    expect(missing.items.map((i) => i.entity.id)).toContain("domain/guneet-dev")
  })

  it("gives type schemas, built-in, extended and custom", async () => {
    const ctx = asPerson(db, owner)
    const domain = await getCatalogTypeSchema(ctx, workspaceId, {
      type: "domain",
    })
    expect(domain.schema).toMatchObject({
      type: "domain",
      built_in: false,
      document: "schema/domain",
      title: "Domain",
      required: ["registrar", "served-by"],
    })
    expect(domain.schema.keys.map((k) => k.key)).toEqual([
      "registrar",
      "expires_on",
      "served-by",
    ])
    const project = await getCatalogTypeSchema(ctx, workspaceId, {
      type: "project",
    })
    expect(project.schema).toMatchObject({ built_in: true, document: null })
    await expect(
      getCatalogTypeSchema(ctx, workspaceId, { type: "nothing" }),
    ).rejects.toThrow(NotFoundError)

    await apply(personActor(owner), [{ text: fixtures.machineExtension }])
    const machine = await getCatalogTypeSchema(ctx, workspaceId, {
      type: "machine",
    })
    expect(machine.schema).toMatchObject({
      built_in: true,
      extended: true,
      document: "schema/machine",
    })
    expect(machine.schema.keys.map((k) => k.key)).toContain("ups")
    const all = await listCatalogTypeSchemas(ctx, workspaceId)
    expect(all.items.map((s) => s.type)).toEqual([
      "agent",
      "decision",
      "domain",
      "machine",
      "person",
      "policy",
      "project",
      "runbook",
      "service",
    ])
  })

  it("gives the agents' start-here path with its entities", async () => {
    const answer = await getCatalogStartHere(asPerson(db, owner), workspaceId)
    expect(answer.start_here).toMatchObject({
      path: "agents",
      title: "Start here",
      steps: [
        {
          to: "policy/deploy-approval",
          entity: {
            id: "policy/deploy-approval",
            title: "Deployment approval",
          },
        },
        { list: "discrepancies", note: "Facts that disagree." },
        { url: "https://git.guneet.dev/guneet/workspace" },
      ],
    })
    const people = await getCatalogStartHere(asPerson(db, owner), workspaceId, {
      path: "people",
    })
    expect(people.start_here?.steps).toHaveLength(1)
  })

  it("lists changes since a revision", async () => {
    await apply(shinanActor, [
      {
        documentId: await documentId("machine/daedalus"),
        text: fixtures.daedalus.replace("Agents work here.", "Agents work."),
      },
    ])
    const changes = await getCatalogChanges(asPerson(db, owner), workspaceId, {
      since: 1,
    })
    expect(changes.items).toEqual([
      expect.objectContaining({
        revision: 2,
        changed_by: "shinan",
        changed_by_kind: "shinan",
        documents: [{ id: "machine/daedalus", kind: "entity" }],
      }),
    ])
    expect(changes.next_since).toBeNull()
    const first = await getCatalogChanges(asPerson(db, owner), workspaceId, {
      since: 0,
      limit: 1,
    })
    expect(first.items.map((c) => c.revision)).toEqual([1])
    expect(first.next_since).toBe(1)
  })

  it("lets agents with catalog:read read, and nobody outside the workspace", async () => {
    const reader = await asAgent(db, owner, workspaceId, ["catalog:read"])
    const read = await getCatalogEntity(reader, workspaceId, {
      id: "machine/musashi",
    })
    expect(read.entity.id).toBe("machine/musashi")

    const tasksOnly = await asAgent(db, owner, workspaceId, ["tasks:read"])
    await expect(
      getCatalogEntity(tasksOnly, workspaceId, { id: "machine/musashi" }),
    ).rejects.toThrow(ForbiddenError)

    const stranger = await newPerson(db, "stranger")
    await expect(
      getCatalogEntity(asPerson(db, stranger), workspaceId, {
        id: "machine/musashi",
      }),
    ).rejects.toThrow(NotFoundError)

    const contributor = await newPerson(db, "contributor")
    await addMember(asPerson(db, owner), {
      workspaceId,
      personId: contributor.id,
      role: "contributor",
    })
    await expect(
      searchCatalog(asPerson(db, contributor), workspaceId, {
        text: "Musashi",
      }),
    ).resolves.toMatchObject({ index_behind: false })
  })

  it("keeps workspaces apart", async () => {
    const other = await createWorkspace(asPerson(db, owner), { name: "Other" })
    await expect(
      getCatalogEntity(asPerson(db, owner), other.workspace.id, {
        id: "machine/musashi",
      }),
    ).rejects.toThrow(NotFoundError)
    const found = await searchCatalog(asPerson(db, owner), other.workspace.id, {
      text: "Musashi",
    })
    expect(found.items).toEqual([])
  })
})

describe("rebuilds and the round-trip check", () => {
  async function stateOf(tx: Transaction | typeof db = db) {
    const [state] = await tx
      .select()
      .from(schema.catalogIndexState)
      .where(eq(schema.catalogIndexState.workspaceId, workspaceId))
    return state!
  }

  it("says the index is behind while built by another parser version, until rebuilt", async () => {
    await apply(personActor(owner), [{ text: fixtures.musashi }])
    await db
      .update(schema.catalogIndexState)
      .set({ parserVersion: parserVersion - 1 })
      .where(eq(schema.catalogIndexState.workspaceId, workspaceId))
    const behind = await getCatalogEntity(asPerson(db, owner), workspaceId, {
      id: "machine/musashi",
    })
    expect(behind.index_behind).toBe(true)

    const checks = await checkCatalogIndexes(asShinan(db), {
      workspaceIds: [workspaceId],
    })
    expect(checks).toMatchObject([{ outcome: "behind" }])

    expect(await rebuildCatalogIndex(asShinan(db), { workspaceId })).toEqual({
      revision: 1,
      documents: 1,
    })
    const after = await getCatalogEntity(asPerson(db, owner), workspaceId, {
      id: "machine/musashi",
    })
    expect(after.index_behind).toBe(false)
    expect(await stateOf()).toMatchObject({
      parserVersion,
      rebuildRequestedAt: null,
    })
  })

  it("finds stored rows that differ from the text, and reports them as health", async () => {
    await apply(
      personActor(owner),
      fixtures.allDocuments.map((text) => ({ text })),
    )
    const clean = await checkCatalogIndexes(asShinan(db), {
      workspaceIds: [workspaceId],
    })
    expect(clean).toMatchObject([{ outcome: "matched", differenceCount: 0 }])

    const musashi = await documentId("machine/musashi")
    await db
      .update(schema.catalogIndexFacts)
      .set({ value: ["1 TiB"] })
      .where(
        sql`${schema.catalogIndexFacts.documentId} = ${musashi} and ${schema.catalogIndexFacts.position} = 0`,
      )
    const [checked] = await checkCatalogIndexes(asShinan(db), {
      workspaceIds: [workspaceId],
    })
    expect(checked).toMatchObject({
      outcome: "differs",
      differenceCount: 1,
      differences: [{ documentId: musashi, tables: ["facts"] }],
    })
    expect(await stateOf()).toMatchObject({
      checkDifferences: 1,
      checkedRevision: 1,
    })

    const operator = await newPerson(db, "operator")
    await db
      .insert(schema.installationOperators)
      .values({ email: operator.email })
    const health = await getCatalogIndexHealth(asPerson(db, operator))
    expect(
      health.workspaces.find((w) => w.workspaceId === workspaceId),
    ).toMatchObject({ checkDifferences: 1, behind: false, revision: 1 })
    await expect(getCatalogIndexHealth(asPerson(db, owner))).rejects.toThrow(
      ForbiddenError,
    )

    await rebuildCatalogIndex(asShinan(db), { workspaceId })
    const [fixed] = await checkCatalogIndexes(asShinan(db), {
      workspaceIds: [workspaceId],
    })
    expect(fixed).toMatchObject({ outcome: "matched" })
  })

  it("asks for rebuilds once per workspace, however its ID is written", async () => {
    await apply(personActor(owner), [{ text: fixtures.musashi }])
    const sent: unknown[] = []
    const asked = await requestCatalogIndexRebuilds(
      {
        ...asShinan(db),
        jobs: {
          send: (_name: string, data: object) => {
            sent.push(data)
            return Promise.resolve(null)
          },
        } as JobQueue,
      },
      { workspaceIds: [workspaceId, workspaceId.toUpperCase()] },
    )
    expect(asked).toEqual([workspaceId])
    expect(sent).toEqual([{ workspaceId }])
    const behind = await getCatalogEntity(asPerson(db, owner), workspaceId, {
      id: "machine/musashi",
    })
    expect(behind.index_behind).toBe(true)
  })

  it("only lets Shinan rebuild and check", async () => {
    await expect(
      rebuildCatalogIndex(asPerson(db, owner), { workspaceId }),
    ).rejects.toThrow(ForbiddenError)
    await expect(
      rebuildCatalogIndex(asShinan(db), { workspaceId: crypto.randomUUID() }),
    ).rejects.toThrow(NotFoundError)
  })

  it("orders stored facts as written", async () => {
    await apply(personActor(owner), [{ text: fixtures.musashi }])
    const rows = await db
      .select({ key: schema.catalogIndexFacts.key })
      .from(schema.catalogIndexFacts)
      .where(eq(schema.catalogIndexFacts.workspaceId, workspaceId))
      .orderBy(asc(schema.catalogIndexFacts.position))
    expect(rows.map((r) => r.key)).toEqual([
      "disk.data.size",
      "disk.data.free",
      "role",
      "disk.data.size",
      "network.public_ipv6",
    ])
  })
})
