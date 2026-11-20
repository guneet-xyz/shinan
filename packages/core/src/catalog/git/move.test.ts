import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  createDatabase,
  m2DropMigration,
  migrateDatabase,
  migrationsFolder,
  schema,
} from "@shinan/db"
import { createTestDatabase, loadDump, v030Dataset } from "@shinan/db/testing"
import type { TestDatabase } from "@shinan/db/testing"

import { createMemoryGit } from "../../../test/memory-git.js"
import type { MemoryGit } from "../../../test/memory-git.js"
import { shinan } from "../../actor.js"
import type { Context } from "../../context.js"
import type { GitClient } from "./client.js"
import {
  CatalogMoveError,
  catalogMoveLines,
  moveCatalogsIntoGit,
} from "./move.js"
import {
  repositoryFirstCommitMessage,
  repositoryReadme,
} from "./repositories.js"

// The move of M2's catalog into Git (Git-based catalog plan §4.1, GC-6),
// on the database Shinan v0.3.0 leaves: deploy/test/v0.3.0-dataset.sql,
// with a "Trial" workspace shaped like the trial installation's (17
// documents at revision 18, two proposals waiting), a "Shapes" one with
// every other kind of thing M2 stores, and an "Empty" one.

let database: TestDatabase
let db: ReturnType<typeof createDatabase>["db"]
let pool: ReturnType<typeof createDatabase>["pool"]
let git: MemoryGit
let ctx: Context

beforeEach(async () => {
  database = await createTestDatabase({ migrate: false })
  await loadDump(database.url, v030Dataset)
  await migrateDatabase(database.url, migrationsFolder, {
    before: m2DropMigration,
  })
  ;({ db, pool } = createDatabase(database.url, { refuseNested: true }))
  git = createMemoryGit()
  ctx = { db, actor: shinan, jobs: { send: () => Promise.resolve(null) } }
}, 60_000)

afterEach(async () => {
  await pool.end()
  await database.drop()
})

/** Each workspace by name, with M2's current text of each document by path. */
async function m2Catalogs(): Promise<
  Map<string, { id: string; texts: Map<string, string> }>
> {
  const { rows } = await pool.query<{
    id: string
    name: string
    text: string | null
  }>(`
    select w.id, w.name, rd.text
    from workspaces w
    left join catalog_documents d on d.workspace_id = w.id
    left join catalog_revision_documents rd
      on rd.document_id = d.id and rd.revision = d.current_revision
    order by w.created_at`)
  const byName = new Map<string, { id: string; texts: Map<string, string> }>()
  for (const row of rows) {
    const entry = byName.get(row.name) ?? { id: row.id, texts: new Map() }
    if (row.text !== null)
      entry.texts.set(`${/^id: (.+)$/m.exec(row.text)![1]}.md`, row.text)
    byName.set(row.name, entry)
  }
  return byName
}

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex")

describe("moving M2's catalog into Git", { timeout: 60_000 }, () => {
  it("makes each workspace's repository with one verified first commit by Shinan, byte for byte", async () => {
    const m2 = await m2Catalogs()
    const reports = await moveCatalogsIntoGit(ctx, git, {
      now: Date.parse("2026-11-20T12:00:00Z"),
    })
    expect(reports.map((r) => [r.documents, r.revision, r.created])).toEqual([
      [17, 18, true],
      [6, 7, true],
      [0, 0, true],
    ])

    for (const [name, { id, texts }] of m2) {
      const report = reports.find((r) => r.workspaceId === id)!
      const files = git.files(id, report.firstCommit)
      // Every document's current text, retired ones included, at its ID
      // plus .md, and README.md: nothing else.
      expect([...files.keys()].sort(), name).toEqual(
        ["README.md", ...texts.keys()].sort(),
      )
      expect(new TextDecoder().decode(files.get("README.md"))).toBe(
        repositoryReadme,
      )
      for (const [path, text] of texts)
        expect(sha256(files.get(path)!), path).toBe(
          sha256(new TextEncoder().encode(text)),
        )
      const { commits } = await git.history(id, {
        commit: report.firstCommit,
        limit: 2,
      })
      expect(commits).toHaveLength(1)
      expect(commits[0]).toMatchObject({
        parents: [],
        author: { name: "Shinan" },
        message:
          texts.size === 0
            ? repositoryFirstCommitMessage
            : `Bring the catalog over from Shinan 0.3 (revision ${report.revision})\n`,
      })
    }
    const shapes = git.files(m2.get("Shapes")!.id, "main")
    expect([...shapes.keys()].sort()).toEqual([
      "README.md",
      "domain/example-org.md",
      "machine/miyamoto.md",
      "machine/old-box.md",
      "person/guneet.md",
      "schema/domain.md",
      "start-here.md",
    ])
    // Text that is not ASCII, as it was.
    expect(
      new TextDecoder().decode(shapes.get("domain/example-org.md")),
    ).toContain("Renouvelé chaque année — 日本語のメモ — ✅")

    // The proposals left waiting, by number and the IDs they touched.
    const [trial, shapesReport, empty] = reports
    expect(trial!.waitingProposals).toEqual([
      { number: 19, touches: ["service/container-registry"] },
      { number: 20, touches: ["start-here"] },
    ])
    expect(shapesReport!.waitingProposals).toEqual([])
    // The start-here document's `waiting-for-approval` list reads as a
    // problem from parser version 5: reported, not refused.
    expect(shapesReport!.problems).toContainEqual({
      code: "start-here-invalid",
      severity: "blocking",
      document: "start-here",
    })
    expect(empty!.problems).toEqual([])

    // Recorded: the repositories with their first commits, the verified
    // moves, and `main` for the agent index.
    const repositories = await db.select().from(schema.catalogRepositories)
    expect(repositories.map((r) => r.firstCommit).sort()).toEqual(
      reports.map((r) => r.firstCommit).sort(),
    )
    const moves = await db.select().from(schema.catalogMoves)
    expect(moves.map((m) => [m.documents, m.revision])).toEqual(
      expect.arrayContaining([
        [17, 18],
        [6, 7],
        [0, 0],
      ]),
    )
    const index = await db.select().from(schema.catalogIndexState)
    expect(index.map((s) => s.mainCommit).sort()).toEqual(
      reports.map((r) => r.firstCommit).sort(),
    )

    // Now M2's tables can go; and running it all again changes nothing.
    await migrateDatabase(database.url)
    expect(await moveCatalogsIntoGit(ctx, undefined)).toEqual([])
    expect(await db.select().from(schema.catalogMoves)).toHaveLength(3)
  })

  it("stops when the commit read back differs, keeping M2's tables, and verifies the repository on the next run", async () => {
    const m2 = await m2Catalogs()
    const trial = m2.get("Trial")!.id
    // A Git client that reads one file back changed.
    const tampered = new Proxy(git, {
      get(target, property, receiver) {
        if (property !== "readDocuments")
          return Reflect.get(target, property, receiver) as unknown
        return async (...args: Parameters<GitClient["readDocuments"]>) => {
          const read = await target.readDocuments(...args)
          return {
            ...read,
            documents: read.documents.map((d) =>
              d.path === "machine/musashi.md" && "content" in d
                ? { ...d, content: new TextEncoder().encode("changed") }
                : d,
            ),
          }
        }
      },
    }) as GitClient
    const error = await moveCatalogsIntoGit(ctx, tampered).then(
      () => null,
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(CatalogMoveError)
    expect((error as Error).message).toBe(
      `Workspace "Trial" (${trial}): the new repository does not hold the catalog as stored: machine/musashi.md differs from its stored text. Nothing was dropped.`,
    )
    expect(await db.select().from(schema.catalogMoves)).toEqual([])
    expect(await db.select().from(schema.catalogRepositories)).toEqual([])
    await expect(migrateDatabase(database.url)).rejects.toMatchObject({
      cause: {
        message: expect.stringMatching(
          /^M2's catalog tables are kept/,
        ) as unknown,
      },
    })
    // The repository the failed run made is checked again, and holds the
    // catalog as stored.
    const reports = await moveCatalogsIntoGit(ctx, git)
    expect(reports.map((r) => r.created)).toEqual([false, true, true])
    await migrateDatabase(database.url)
  })

  it("refuses a repository that already holds something else", async () => {
    const m2 = await m2Catalogs()
    const trial = m2.get("Trial")!.id
    // As if something had made the workspace's repository on its own.
    git.create(trial)
    await expect(moveCatalogsIntoGit(ctx, git)).rejects.toThrow(
      `Workspace "Trial" (${trial}): the existing repository does not hold the catalog as stored: its first commit is not by Shinan. Nothing was dropped.`,
    )
    expect(await db.select().from(schema.catalogMoves)).toEqual([])
  })

  it("stops when M2's catalog changed while it was moved, recording nothing", async () => {
    const trial = (await m2Catalogs()).get("Trial")!.id
    // 0.3's web, still running, applies a change while the Git container
    // makes the repository.
    const racing = new Proxy(git, {
      get(target, property, receiver) {
        if (property !== "createRepository")
          return Reflect.get(target, property, receiver) as unknown
        return async (...args: Parameters<GitClient["createRepository"]>) => {
          const made = await target.createRepository(...args)
          if (args[0] === trial)
            await pool.query(
              `insert into catalog_revisions
               select (jsonb_populate_record(null::catalog_revisions, to_jsonb(r) || jsonb_build_object('number', r.number + 1))).*
               from catalog_revisions r where r.workspace_id = $1 order by r.number desc limit 1`,
              [trial],
            )
          return made
        }
      },
    }) as GitClient
    await expect(moveCatalogsIntoGit(ctx, racing)).rejects.toThrow(
      `Workspace "Trial" (${trial}): its catalog changed while migrate moved it (revision 18, now 19), so 0.3's web or worker is still running. Nothing was dropped. Roll back to 0.3 with the dump taken before the upgrade, as the operator guide says, stop web and worker, and upgrade again.`,
    )
    expect(await db.select().from(schema.catalogMoves)).toEqual([])
    expect(await db.select().from(schema.catalogRepositories)).toEqual([])
  })

  it("says plainly when a workspace with M2 documents had a repository before the move", async () => {
    const trial = (await m2Catalogs()).get("Trial")!.id
    await db.insert(schema.catalogRepositories).values({ workspaceId: trial })
    await expect(moveCatalogsIntoGit(ctx, git)).rejects.toThrow(
      `Workspace "Trial" (${trial}) has catalog documents in 0.3's tables but already had a repository before the move, so its catalog cannot be moved. Roll back to 0.3 with the dump taken before the upgrade, as the operator guide says, and upgrade again.`,
    )
    expect(await db.select().from(schema.catalogMoves)).toEqual([])
  })

  it("needs the Git container when there is a catalog to move", async () => {
    await expect(moveCatalogsIntoGit(ctx, undefined)).rejects.toThrow(
      /3 workspaces have no catalog repository yet: migrate needs the Git container \(SHINAN_GIT_URL and SHINAN_GIT_SERVICE_TOKEN\)/,
    )
  })

  it("reports in counts, proposal numbers, IDs and codes, never catalog text", async () => {
    const reports = await moveCatalogsIntoGit(ctx, git)
    const lines = reports.flatMap(catalogMoveLines)
    const [trial, shapes, empty] = reports
    expect(lines).toEqual([
      `Workspace "Trial" (${trial!.workspaceId}): moved 17 catalog documents at revision 18 into Git, verified file by file (first commit ${trial!.firstCommit})`,
      `Workspace "Trial" (${trial!.workspaceId}): catalog proposal #19 was waiting for approval and is not applied (it touched service/container-registry); redo it by pushing`,
      `Workspace "Trial" (${trial!.workspaceId}): catalog proposal #20 was waiting for approval and is not applied (it touched start-here); redo it by pushing`,
      `Workspace "Shapes" (${shapes!.workspaceId}): moved 6 catalog documents at revision 7 into Git, verified file by file (first commit ${shapes!.firstCommit})`,
      expect.stringMatching(
        new RegExp(
          `^Workspace "Shapes" \\(${shapes!.workspaceId}\\): the moved catalog reads with \\d+ problems?, kept as they were: .*start-here-invalid \\(blocking\\) in start-here`,
        ),
      ),
      `Workspace "Empty" (${empty!.workspaceId}): no catalog documents; its repository starts with README.md (${empty!.firstCommit})`,
    ])
    for (const text of ["blue mat", "Renouvelé", "203.0.113", "Tiles"])
      expect(lines.join("\n")).not.toContain(text)
  })
})
