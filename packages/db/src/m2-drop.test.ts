import { describe, expect, it } from "vitest"

import {
  createDatabase,
  m2DropMigration,
  migrateDatabase,
  migrationsFolder,
} from "./index.js"
import { createTestDatabase, loadDump, v030Dataset } from "./testing.js"

// The drop of M2's tables (Git-based catalog plan §4.2) on a database
// v0.3.0 left: it refuses to run until every workspace with M2 documents
// or proposals has a verified move of exactly what M2 holds now, and
// leaves everything as it was.

type Pool = ReturnType<typeof createDatabase>["pool"]

const tables = (pool: Pool) =>
  pool
    .query<{ name: string }>(
      "select table_name as name from information_schema.tables where table_schema = 'public' and table_name in ('catalog_documents', 'catalog_revisions', 'catalog_revision_documents', 'catalog_proposals', 'catalog_proposal_comments', 'catalog_page_visits') order by 1",
    )
    .then((r) => r.rows.map((row) => row.name))

/** M2's state of each workspace with documents or proposals, by name. */
async function m2State(pool: Pool) {
  const { rows } = await pool.query<{
    id: string
    name: string
    revision: number
    documents: number
    waiting: number[]
  }>(`
    select w.id, w.name,
      (select coalesce(max(number), 0)::int from catalog_revisions r where r.workspace_id = w.id) as revision,
      (select count(*)::int from catalog_documents d where d.workspace_id = w.id) as documents,
      (select coalesce(array_agg(number order by number), '{}') from catalog_proposals p
        where p.workspace_id = w.id and p.state = 'pending') as waiting
    from workspaces w
    where exists (select 1 from catalog_documents d where d.workspace_id = w.id)
      or exists (select 1 from catalog_proposals p where p.workspace_id = w.id)
    order by w.created_at`)
  return new Map(rows.map((row) => [row.name, row]))
}

/** Records a move of what M2 holds now for the workspace, as the move does. */
const move = (
  pool: Pool,
  state: { id: string; revision: number; documents: number; waiting: number[] },
) =>
  pool.query(
    "insert into catalog_moves (workspace_id, revision, documents, first_commit, waiting_proposals, problems) values ($1, $2, $3, $4, $5, '[]')",
    [
      state.id,
      state.revision,
      state.documents,
      "a".repeat(40),
      JSON.stringify(state.waiting.map((number) => ({ number, touches: [] }))),
    ],
  )

/** A write to M2's catalog, as 0.3's web would make one: a new revision. */
const write = (pool: Pool, workspaceId: string) =>
  pool.query(
    `insert into catalog_revisions
     select (jsonb_populate_record(null::catalog_revisions, to_jsonb(r) || jsonb_build_object('number', r.number + 1))).*
     from catalog_revisions r where r.workspace_id = $1 order by r.number desc limit 1`,
    [workspaceId],
  )

async function before(test: (url: string, pool: Pool) => Promise<void>) {
  const database = await createTestDatabase({ migrate: false })
  const { pool } = createDatabase(database.url)
  try {
    await loadDump(database.url, v030Dataset)
    await migrateDatabase(database.url, migrationsFolder, {
      before: m2DropMigration,
    })
    await test(database.url, pool)
  } finally {
    await pool.end()
    await database.drop()
  }
}

/** The drop's refusal: PostgreSQL's error, under Drizzle's. */
const refused = (url: string) =>
  expect(migrateDatabase(url)).rejects.toMatchObject({
    cause: {
      message: expect.stringMatching(
        /^M2's catalog tables are kept: a workspace's catalog was not moved into Git, or changed after it was moved/,
      ) as unknown,
    },
  })

describe("dropping M2's catalog tables", { timeout: 60_000 }, () => {
  it("refuses before the move, with one workspace moved, and after a write to M2 since the move, keeping every table", async () => {
    await before(async (url, pool) => {
      const m2 = await tables(pool)
      expect(m2).toHaveLength(6)
      const state = await m2State(pool)
      expect([...state.keys()]).toEqual(["Trial", "Shapes"])

      await refused(url)
      await move(pool, state.get("Trial")!)
      await refused(url)
      // Shapes moved, then written to: the move no longer holds it.
      await move(pool, state.get("Shapes")!)
      await write(pool, state.get("Shapes")!.id)
      await refused(url)
      expect(await tables(pool)).toEqual(m2)
      const { rows: strict } = await pool.query(
        "select 1 from information_schema.columns where table_name = 'workspaces' and column_name = 'catalog_strict'",
      )
      expect(strict).toHaveLength(1)
    })
  })

  it("refuses when the proposals waiting changed since the move", async () => {
    await before(async (url, pool) => {
      const state = await m2State(pool)
      // Trial's move held proposal #19 waiting; #20 was made after it.
      await move(pool, { ...state.get("Trial")!, waiting: [19] })
      await move(pool, state.get("Shapes")!)
      await refused(url)
    })
  })

  it("runs once each workspace's move holds what M2 holds, and again with nothing to do", async () => {
    await before(async (url, pool) => {
      for (const state of (await m2State(pool)).values())
        await move(pool, state)
      await migrateDatabase(url)
      expect(await tables(pool)).toEqual([])
      await migrateDatabase(url)
    })
  })

  it("runs on an installation that never had M2 documents", async () => {
    const database = await createTestDatabase({ migrate: false })
    const { pool } = createDatabase(database.url)
    try {
      await migrateDatabase(database.url, migrationsFolder, {
        before: m2DropMigration,
      })
      expect(await tables(pool)).toHaveLength(6)
      await migrateDatabase(database.url)
      expect(await tables(pool)).toEqual([])
    } finally {
      await pool.end()
      await database.drop()
    }
  })
})
