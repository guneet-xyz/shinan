import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { and, asc, eq, schema, sql } from "@shinan/db"

import * as fixtures from "../../../test/catalog-index-fixtures.js"
import {
  asAgent,
  asPerson,
  asShinan,
  newPerson,
  testDatabase,
} from "../../../test/helpers.js"
import { createMemoryGit } from "../../../test/memory-git.js"
import type { FileContent, MemoryGit } from "../../../test/memory-git.js"
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
import { readDocumentId } from "../document/parse.js"
import { createCatalogRepository } from "../git/repositories.js"
import { indexRulesVersion } from "./derive.js"
import { compareWorkspaceIndex, updateWorkspaceIndex } from "./indexer.js"
import {
  catchUpCatalogIndexes,
  checkCatalogIndexes,
  getCatalogIndexHealth,
  rebuildCatalogIndex,
  recordCatalogMain,
  requestCatalogIndexRebuilds,
  updateCatalogIndex,
} from "./maintain.js"
import {
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
import { listDocuments, readTexts } from "./source.js"

const { db, pool } = testDatabase()

afterAll(async () => {
  await pool.end()
})

let owner: Person
let workspaceId: string
let git: MemoryGit

/** A document's path on `main`: its ID plus `.md`. */
export function pathOf(text: string): string {
  return `${readDocumentId(text)}.md`
}

function filesOf(texts: readonly string[]): Record<string, string> {
  return Object.fromEntries(texts.map((t) => [pathOf(t), t]))
}

/** Pushes to `main` and brings the index up to it, as the index job does. */
async function push(changes: Record<string, FileContent | null>) {
  const commit = git.push(workspaceId, changes)
  const update = await updateWorkspaceIndex(db, git, workspaceId)
  expect(update.commit).toBe(commit)
  return update
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
    all.push(
      rows
        .map((row) => {
          const stored = { ...row }
          delete stored.search
          delete stored.searchSimple
          return JSON.stringify(
            Object.fromEntries(
              Object.keys(stored)
                .sort()
                .map((k) => [k, stored[k]]),
            ),
          )
        })
        .sort(),
    )
  }
  return JSON.stringify(all)
}

async function stateOf() {
  const [state] = await db
    .select()
    .from(schema.catalogIndexState)
    .where(eq(schema.catalogIndexState.workspaceId, workspaceId))
  return state!
}

async function compareWithMain() {
  const main = (await git.getRepository(workspaceId))!.main
  const texts = await readTexts(
    git,
    workspaceId,
    main,
    await listDocuments(git, workspaceId, main),
  )
  return db.transaction((tx) => compareWorkspaceIndex(tx, workspaceId, texts))
}

/** Marks the workspace's repository as made, as the repository job does. */
async function repositoryMade() {
  await db
    .update(schema.catalogRepositories)
    .set({
      createdAt: sql`now()`,
      firstCommit: (await git.getRepository(workspaceId))!.main,
    })
    .where(eq(schema.catalogRepositories.workspaceId, workspaceId))
}

function recordingJobs(): JobQueue & { sent: unknown[] } {
  const sent: unknown[] = []
  return {
    sent,
    send: (_name: string, data: object) => {
      sent.push(data)
      return Promise.resolve(null)
    },
  } as JobQueue & { sent: unknown[] }
}

beforeEach(async () => {
  owner = await newPerson(db, "owner")
  const created = await createWorkspace(asPerson(db, owner), { name: "Team" })
  workspaceId = created.workspace.id
  git = createMemoryGit()
  git.create(workspaceId)
})

describe("indexing main", () => {
  it("builds the index from main's documents, and every answer names main's commit", async () => {
    const before = await getCatalogEntity(asPerson(db, owner), workspaceId, {
      id: "machine/musashi",
    }).catch((e: unknown) => e)
    expect(before).toBeInstanceOf(NotFoundError)

    const { outcome, commit } = await push(
      filesOf([fixtures.guneet, fixtures.musashi]),
    )
    expect(outcome).toBe("rebuilt")
    const answer = await getCatalogEntity(asPerson(db, owner), workspaceId, {
      id: "machine/musashi",
    })
    expect(answer.catalog_commit).toBe(commit)
    expect(answer.index_behind).toBe(false)
    expect(answer.entity).toMatchObject({
      id: "machine/musashi",
      type: "machine",
      title: "Musashi",
      path: "machine/musashi.md",
      aliases: ["machine/takezo-old"],
    })
    expect(answer.entity.blob).toMatch(/^[0-9a-f]{40}$/)
    expect(answer.entity.body.map((s) => Object.keys(s).sort())).toEqual(
      answer.entity.body.map(() => ["anchor", "heading", "level", "text"]),
    )
    expect(answer.entity).not.toHaveProperty("pending_proposals")
    expect(answer.entity).not.toHaveProperty("revision")

    const next = await push({ "machine/daedalus.md": fixtures.daedalus })
    expect(next.outcome).toBe("updated")
    const after = await getCatalogEntity(asPerson(db, owner), workspaceId, {
      id: "machine/musashi",
    })
    expect(after.catalog_commit).toBe(next.commit)
    // Musashi's text did not change: neither did its blob.
    expect(after.entity.blob).toBe(answer.entity.blob)
  })

  it("reads only the documents an update changed", async () => {
    await push(filesOf(fixtures.allDocuments))
    git.calls.pathsRead.length = 0
    await push({
      "machine/daedalus.md": fixtures.daedalus.replace(
        "Agents work here.",
        "Agents work.",
      ),
    })
    expect(git.calls.pathsRead).toEqual(["machine/daedalus.md"])
    expect((await compareWithMain()).differences).toEqual([])

    // Unchanged: nothing is read, only main is asked for.
    git.calls.pathsRead.length = 0
    expect(await updateWorkspaceIndex(db, git, workspaceId)).toMatchObject({
      outcome: "unchanged",
    })
    expect(git.calls.pathsRead).toEqual([])
  })

  it("drops a deleted document's rows, and indexes only catalog documents", async () => {
    await push({
      ...filesOf([fixtures.guneet, fixtures.musashi]),
      "notes.txt": "Not a document.",
      "machine/link.md": { content: "machine/musashi.md", mode: "120000" },
    })
    const paths = async () =>
      (
        await db
          .select({ path: schema.catalogIndexDocuments.path })
          .from(schema.catalogIndexDocuments)
          .where(eq(schema.catalogIndexDocuments.workspaceId, workspaceId))
          .orderBy(asc(schema.catalogIndexDocuments.path))
      ).map((r) => r.path)
    // The root README.md is free Markdown for people, not a document.
    expect(await paths()).toEqual(["machine/musashi.md", "person/guneet.md"])

    await push({ "machine/musashi.md": null })
    expect(await paths()).toEqual(["person/guneet.md"])
    expect(
      await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.catalogIndexFacts)
        .where(eq(schema.catalogIndexFacts.workspaceId, workspaceId)),
    ).toEqual([{ count: 0 }])
  })

  it("reads a file it cannot read as a document with problems, never stopping", async () => {
    const huge = `---\nid: machine/huge\n---\n${"x".repeat(1024 * 1024)}`
    await push({
      "machine/huge.md": huge,
      "machine/binary.md": new Uint8Array([0x2d, 0x2d, 0x2d, 0x0a, 0, 0xff]),
      ...filesOf([fixtures.guneet]),
    })
    const rows = await db
      .select({
        path: schema.catalogIndexDocuments.path,
        problems: schema.catalogIndexDocuments.problems,
      })
      .from(schema.catalogIndexDocuments)
      .where(eq(schema.catalogIndexDocuments.workspaceId, workspaceId))
      .orderBy(asc(schema.catalogIndexDocuments.path))
    expect(rows.map((r) => [r.path, r.problems.map((p) => p.code)])).toEqual([
      ["machine/binary.md", ["frontmatter-invalid"]],
      ["machine/huge.md", ["too-large"]],
      ["person/guneet.md", []],
    ])
    expect((await compareWithMain()).differences).toEqual([])
  })

  it("gives the same rows after deleting every index row and rebuilding (D-006)", async () => {
    await push(filesOf(fixtures.allDocuments))
    await push({
      "machine/musashi.md": fixtures.musashi.replace(
        "disk.data.free: 74 GiB",
        "disk.data.free: 70 GiB",
      ),
    })
    await push(filesOf([fixtures.machineExtension]))
    const before = await snapshot()
    expect((await compareWithMain()).differences).toEqual([])

    await db
      .delete(schema.catalogIndexDocuments)
      .where(eq(schema.catalogIndexDocuments.workspaceId, workspaceId))
    expect(
      await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.catalogIndexFacts)
        .where(eq(schema.catalogIndexFacts.workspaceId, workspaceId)),
    ).toEqual([{ count: 0 }])

    const rebuilt = await rebuildCatalogIndex(
      asShinan(db),
      { workspaceId },
      git,
    )
    expect(rebuilt).toMatchObject({
      outcome: "rebuilt",
      documents: fixtures.allDocuments.length + 1,
    })
    expect(await snapshot()).toBe(before)
  })

  it("records the parser version on every row", async () => {
    await push(filesOf([fixtures.musashi]))
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

  it("says the index is behind while an update of main waits, and queues the index job", async () => {
    await push(filesOf([fixtures.guneet, fixtures.musashi]))
    const ahead = git.push(workspaceId, {
      "machine/daedalus.md": fixtures.daedalus,
    })
    const jobs = recordingJobs()
    await db.transaction((tx) =>
      recordCatalogMain({ tx, jobs, workspaceId, commit: ahead }),
    )
    expect(jobs.sent).toEqual([{ workspaceId }])
    const waiting = await searchCatalog(asPerson(db, owner), workspaceId, {
      text: "Musashi",
    })
    expect(waiting.index_behind).toBe(true)
    expect(waiting.catalog_commit).not.toBe(ahead)

    await updateCatalogIndex(asShinan(db), { workspaceId }, git)
    const caught = await searchCatalog(asPerson(db, owner), workspaceId, {
      text: "Musashi",
    })
    expect(caught).toMatchObject({ catalog_commit: ahead, index_behind: false })
  })

  it("keeps a newer main recorded while an older one is indexed", async () => {
    await push(filesOf([fixtures.guneet]))
    const first = git.push(workspaceId, filesOf([fixtures.musashi]))
    // The job reads main (`first`) while a newer update is stored.
    const read = { ...git }
    let newer = ""
    read.getRepository = async (id) => {
      const found = await git.getRepository(id)
      newer = git.push(workspaceId, filesOf([fixtures.daedalus]))
      await db.transaction((tx) =>
        recordCatalogMain({
          tx,
          jobs: recordingJobs(),
          workspaceId,
          commit: newer,
        }),
      )
      return found
    }
    expect(await updateWorkspaceIndex(db, read, workspaceId)).toMatchObject({
      commit: first,
    })
    expect(await stateOf()).toMatchObject({ commit: first, mainCommit: newer })
    // The job the newer update queued catches up.
    await updateWorkspaceIndex(db, git, workspaceId)
    expect(await stateOf()).toMatchObject({ commit: newer, mainCommit: newer })
  })

  it("rebuilds when the commit it stood at is gone, as after a purge", async () => {
    await push(filesOf([fixtures.guneet, fixtures.musashi]))
    const old = (await stateOf()).commit!
    const rewritten = git.create(
      workspaceId,
      filesOf([fixtures.guneet, fixtures.daedalus]),
    )
    git.forget(workspaceId, old)
    expect(await updateWorkspaceIndex(db, git, workspaceId)).toMatchObject({
      outcome: "rebuilt",
      commit: rewritten,
    })
    expect((await compareWithMain()).differences).toEqual([])
  })

  it("stays empty without a repository", async () => {
    const other = await createWorkspace(asPerson(db, owner), { name: "Other" })
    expect(
      await updateWorkspaceIndex(db, git, other.workspace.id),
    ).toMatchObject({ outcome: "no-repository" })
    const answer = await searchCatalog(
      asPerson(db, owner),
      other.workspace.id,
      {
        text: "Musashi",
      },
    )
    expect(answer).toMatchObject({ catalog_commit: null, index_behind: false })
  })
})

describe("type schema changes", () => {
  it("indexes the type's entities again when its schema document changes", async () => {
    await push(filesOf([fixtures.domainSchema, fixtures.guneetDev]))
    const before = await getCatalogEntity(asPerson(db, owner), workspaceId, {
      id: "domain/guneet-dev",
    })
    expect(
      before.entity.facts.find((f) => f.key === "expires_on")?.freshness
        .recheck_days,
    ).toBe(30)

    git.calls.pathsRead.length = 0
    await push({
      "schema/domain.md": fixtures.domainSchema.replace(
        "expires_on: { recheck: 30d }",
        "expires_on: { recheck: 60d }",
      ),
    })
    expect(git.calls.pathsRead.sort()).toEqual([
      "domain/guneet-dev.md",
      "schema/domain.md",
    ])
    const after = await getCatalogEntity(asPerson(db, owner), workspaceId, {
      id: "domain/guneet-dev",
    })
    expect(
      after.entity.facts.find((f) => f.key === "expires_on")?.freshness
        .recheck_days,
    ).toBe(60)
    // The entity's own text did not change.
    expect(after.entity.blob).toBe(before.entity.blob)
    expect((await compareWithMain()).differences).toEqual([])
  })

  it("follows which of two schema documents defines a type", async () => {
    const tagged = fixtures.guneetDev.replace(
      "      registrar: Cloudflare\n",
      "      registrar: Cloudflare\n      tags: main\n",
    )
    const second = fixtures.domainSchema.replace(
      "  registrar: {}\n",
      "  registrar: {}\n  tags: { many: true }\n",
    )
    // Two documents describe `domain`; the first by path defines it.
    await push({
      "schema/domain.md": fixtures.domainSchema,
      "schema/zz-domain.md": second,
      "domain/guneet-dev.md": tagged,
    })
    const tags = async () =>
      (
        await getCatalogEntity(asPerson(db, owner), workspaceId, {
          id: "domain/guneet-dev",
        })
      ).entity.facts.find((f) => f.key === "tags")
    expect(await tags()).toMatchObject({ in_schema: false })
    // Moving that one to another type lets the other take over.
    await push({
      "schema/domain.md": fixtures.domainSchema.replace(
        "id: schema/domain",
        "id: schema/area",
      ),
    })
    expect((await compareWithMain()).differences).toEqual([])
    expect(await tags()).toMatchObject({ in_schema: true })
    const domain = await getCatalogTypeSchema(
      asPerson(db, owner),
      workspaceId,
      {
        type: "domain",
      },
    )
    expect(domain.schema.document).toBe("schema/domain")
  })

  it("uses the same type schemas after a rebuild that kept them parsed", async () => {
    await push(filesOf([fixtures.domainSchema, fixtures.guneetDev]))
    await rebuildCatalogIndex(asShinan(db), { workspaceId }, git)
    git.calls.pathsRead.length = 0
    await push({
      "domain/guneet-dev.md": fixtures.guneetDev.replace(
        "The main domain.",
        "The main domain, still.",
      ),
    })
    // The schema is known by its blob ID: it is not read again.
    expect(git.calls.pathsRead).toEqual(["domain/guneet-dev.md"])
    expect((await compareWithMain()).differences).toEqual([])
  })
})

describe("queries", () => {
  beforeEach(async () => {
    await push(filesOf(fixtures.allDocuments))
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
    await push(
      filesOf([
        entity("one", "Keeps running all day.", "Quiet."),
        entity("two", "Quiet.", "Keeps running all day."),
        entity("three", "Quiet.", "Quiet."),
      ]),
    )
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

    await push(filesOf([fixtures.machineExtension]))
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
      document: { path: "start-here.md" },
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

  it("orders stored facts as written", async () => {
    const rows = await db
      .select({ key: schema.catalogIndexFacts.key })
      .from(schema.catalogIndexFacts)
      .where(
        and(
          eq(schema.catalogIndexFacts.workspaceId, workspaceId),
          eq(schema.catalogIndexFacts.path, "machine/musashi.md"),
        ),
      )
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

describe("rebuilds, catch-up and the round-trip check", () => {
  it("says the index is behind while built by other index rules, until rebuilt", async () => {
    await push(filesOf([fixtures.musashi]))
    await db
      .update(schema.catalogIndexState)
      .set({ rulesVersion: indexRulesVersion - 1 })
      .where(eq(schema.catalogIndexState.workspaceId, workspaceId))
    const behind = await getCatalogEntity(asPerson(db, owner), workspaceId, {
      id: "machine/musashi",
    })
    expect(behind.index_behind).toBe(true)
    // The next job sees it and rebuilds.
    expect(
      await updateCatalogIndex(asShinan(db), { workspaceId }, git),
    ).toMatchObject({ outcome: "rebuilt" })
    expect(await stateOf()).toMatchObject({ rulesVersion: indexRulesVersion })
  })

  it("reports rows an older release wrote as behind, not as differing", async () => {
    await push(filesOf(fixtures.allDocuments))
    await repositoryMade()
    // An older release, run against the same database after a rollback,
    // re-indexed a document.
    await db
      .update(schema.catalogIndexDocuments)
      .set({ rulesVersion: 0 })
      .where(
        and(
          eq(schema.catalogIndexDocuments.workspaceId, workspaceId),
          eq(schema.catalogIndexDocuments.path, "machine/musashi.md"),
        ),
      )
    const answer = await getCatalogEntity(asPerson(db, owner), workspaceId, {
      id: "person/guneet",
    })
    expect(answer.index_behind).toBe(true)
    const [checked] = await checkCatalogIndexes(asShinan(db), git, {
      workspaceIds: [workspaceId],
    })
    expect(checked).toMatchObject({ outcome: "behind" })
    const asked = await requestCatalogIndexRebuilds({
      ...asShinan(db),
      jobs: recordingJobs(),
    })
    expect(asked).toContain(workspaceId)
    await updateCatalogIndex(asShinan(db), { workspaceId }, git)
    const [after] = await checkCatalogIndexes(asShinan(db), git, {
      workspaceIds: [workspaceId],
    })
    expect(after).toMatchObject({ outcome: "matched" })
  })

  it("says the index is behind while built by another parser version, until rebuilt", async () => {
    const { commit } = await push(filesOf([fixtures.musashi]))
    await db
      .update(schema.catalogIndexState)
      .set({ parserVersion: parserVersion - 1 })
      .where(eq(schema.catalogIndexState.workspaceId, workspaceId))
    const behind = await getCatalogEntity(asPerson(db, owner), workspaceId, {
      id: "machine/musashi",
    })
    expect(behind.index_behind).toBe(true)

    const checks = await checkCatalogIndexes(asShinan(db), git, {
      workspaceIds: [workspaceId],
    })
    expect(checks).toMatchObject([{ outcome: "behind" }])

    expect(
      await rebuildCatalogIndex(asShinan(db), { workspaceId }, git),
    ).toEqual({ outcome: "rebuilt", commit, documents: 1 })
    const after = await getCatalogEntity(asPerson(db, owner), workspaceId, {
      id: "machine/musashi",
    })
    expect(after.index_behind).toBe(false)
    expect(await stateOf()).toMatchObject({
      parserVersion,
      rebuildRequestedAt: null,
    })
  })

  it("finds stored rows that differ from main's text, by path only, and reports them as health", async () => {
    const { commit } = await push(filesOf(fixtures.allDocuments))
    const clean = await checkCatalogIndexes(asShinan(db), git, {
      workspaceIds: [workspaceId],
    })
    expect(clean).toMatchObject([
      { outcome: "matched", differenceCount: 0, commit },
    ])

    await db
      .update(schema.catalogIndexFacts)
      .set({ value: ["1 TiB"] })
      .where(
        and(
          eq(schema.catalogIndexFacts.workspaceId, workspaceId),
          eq(schema.catalogIndexFacts.path, "machine/musashi.md"),
          eq(schema.catalogIndexFacts.position, 0),
        ),
      )
    await db
      .delete(schema.catalogIndexDocuments)
      .where(
        and(
          eq(schema.catalogIndexDocuments.workspaceId, workspaceId),
          eq(schema.catalogIndexDocuments.path, "machine/daedalus.md"),
        ),
      )
    const [checked] = await checkCatalogIndexes(asShinan(db), git, {
      workspaceIds: [workspaceId],
    })
    expect(checked).toMatchObject({
      outcome: "differs",
      differenceCount: 2,
      differences: [
        {
          path: "machine/daedalus.md",
          tables: ["documents", "facts", "relations", "sections"],
        },
        { path: "machine/musashi.md", tables: ["facts"] },
      ],
    })
    // Paths and table names only: never a value.
    expect(JSON.stringify(checked)).not.toContain("TiB")
    expect(await stateOf()).toMatchObject({
      checkDifferences: 2,
      checkedCommit: commit,
    })

    const operator = await newPerson(db, "operator")
    await db
      .insert(schema.installationOperators)
      .values({ email: operator.email })
    const health = await getCatalogIndexHealth(asPerson(db, operator))
    expect(
      health.workspaces.find((w) => w.workspaceId === workspaceId),
    ).toMatchObject({
      checkDifferences: 2,
      behind: false,
      commit,
      mainCommit: commit,
    })
    await expect(getCatalogIndexHealth(asPerson(db, owner))).rejects.toThrow(
      ForbiddenError,
    )

    await rebuildCatalogIndex(asShinan(db), { workspaceId }, git)
    const [fixed] = await checkCatalogIndexes(asShinan(db), git, {
      workspaceIds: [workspaceId],
    })
    expect(fixed).toMatchObject({ outcome: "matched" })
  })

  it("does not compare an index that is not at main, and queues its update", async () => {
    await push(filesOf([fixtures.musashi]))
    await repositoryMade()
    git.push(workspaceId, filesOf([fixtures.daedalus]))
    const jobs = recordingJobs()
    const checks = await checkCatalogIndexes({ ...asShinan(db), jobs }, git, {})
    expect(checks.find((c) => c.workspaceId === workspaceId)).toMatchObject({
      outcome: "behind",
    })
    expect(jobs.sent).toContainEqual({ workspaceId })
  })

  it("catches up on start: a job for every workspace with a repository", async () => {
    await repositoryMade()
    const jobs = recordingJobs()
    const queued = await catchUpCatalogIndexes({ ...asShinan(db), jobs })
    expect(queued).toContain(workspaceId)
    expect(jobs.sent).toContainEqual({ workspaceId })
    // Its index was never built: a rebuild is asked for, and answers say so.
    expect((await stateOf()).rebuildRequestedAt).not.toBeNull()
    const answer = await searchCatalog(asPerson(db, owner), workspaceId, {
      text: "Musashi",
    })
    expect(answer).toMatchObject({ catalog_commit: null, index_behind: true })
    await updateCatalogIndex(asShinan(db), { workspaceId }, git)
    expect(
      await searchCatalog(asPerson(db, owner), workspaceId, {
        text: "Musashi",
      }),
    ).toMatchObject({ index_behind: false })
  })

  it("queues the first index of a new repository's main", async () => {
    const main = (await git.getRepository(workspaceId))!.main
    const jobs = recordingJobs()
    const creating = {
      ...git,
      createRepository: () =>
        Promise.resolve({ workspaceId, main, created: true }),
    }
    await createCatalogRepository(
      { ...asShinan(db), jobs },
      { workspaceId },
      creating,
    )
    expect(jobs.sent).toContainEqual({ workspaceId })
    expect(await stateOf()).toMatchObject({ commit: null, mainCommit: main })
    expect(
      await searchCatalog(asPerson(db, owner), workspaceId, { text: "x y" }),
    ).toMatchObject({ catalog_commit: null, index_behind: true })
    await updateCatalogIndex(asShinan(db), { workspaceId }, git)
    expect(await stateOf()).toMatchObject({ commit: main, mainCommit: main })
  })

  it("asks for rebuilds once per workspace, however its ID is written", async () => {
    await push(filesOf([fixtures.musashi]))
    const jobs = recordingJobs()
    const asked = await requestCatalogIndexRebuilds(
      { ...asShinan(db), jobs },
      { workspaceIds: [workspaceId, workspaceId.toUpperCase()] },
    )
    expect(asked).toEqual([workspaceId])
    expect(jobs.sent).toEqual([{ workspaceId }])
    const behind = await getCatalogEntity(asPerson(db, owner), workspaceId, {
      id: "machine/musashi",
    })
    expect(behind.index_behind).toBe(true)
  })

  it("only lets Shinan update, rebuild and check", async () => {
    await expect(
      rebuildCatalogIndex(asPerson(db, owner), { workspaceId }, git),
    ).rejects.toThrow(ForbiddenError)
    await expect(
      updateCatalogIndex(asPerson(db, owner), { workspaceId }, git),
    ).rejects.toThrow(ForbiddenError)
    await expect(checkCatalogIndexes(asPerson(db, owner), git)).rejects.toThrow(
      ForbiddenError,
    )
    await expect(
      rebuildCatalogIndex(
        asShinan(db),
        { workspaceId: crypto.randomUUID() },
        git,
      ),
    ).rejects.toThrow(NotFoundError)
  })
})
