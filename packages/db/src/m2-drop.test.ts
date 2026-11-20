import { describe, expect, it } from "vitest"

import {
  createDatabase,
  m2DropMigration,
  migrateDatabase,
  migrationsFolder,
} from "./index.js"
import { createTestDatabase, loadDump, v030Dataset } from "./testing.js"

// The drop of M2's tables (Git-based catalog plan §4.2) on a database
// v0.3.0 left: it refuses to run before every workspace with M2 documents
// has a verified move into Git, and leaves everything as it was.

const tables = (pool: ReturnType<typeof createDatabase>["pool"]) =>
  pool
    .query<{ name: string }>(
      "select table_name as name from information_schema.tables where table_schema = 'public' and table_name in ('catalog_documents', 'catalog_revisions', 'catalog_revision_documents', 'catalog_proposals', 'catalog_proposal_comments', 'catalog_page_visits') order by 1",
    )
    .then((r) => r.rows.map((row) => row.name))

describe("dropping M2's catalog tables", () => {
  it("refuses before the move, keeping every table, and runs once each workspace's move is recorded", async () => {
    const database = await createTestDatabase({ migrate: false })
    const { pool } = createDatabase(database.url)
    try {
      await loadDump(database.url, v030Dataset)
      await migrateDatabase(database.url, migrationsFolder, {
        before: m2DropMigration,
      })
      const m2 = await tables(pool)
      expect(m2).toHaveLength(6)

      await expect(migrateDatabase(database.url)).rejects.toThrow(
        /no verified move into Git/,
      )
      expect(await tables(pool)).toEqual(m2)
      const { rows: strict } = await pool.query(
        "select 1 from information_schema.columns where table_name = 'workspaces' and column_name = 'catalog_strict'",
      )
      expect(strict).toHaveLength(1)

      // One workspace's move recorded is not enough.
      const { rows: workspaces } = await pool.query<{ id: string }>(
        "select distinct workspace_id as id from catalog_documents order by 1",
      )
      expect(workspaces).toHaveLength(2)
      const move = (id: string) =>
        pool.query(
          "insert into catalog_moves (workspace_id, revision, documents, first_commit, waiting_proposals, problems) values ($1, 1, 1, $2, '[]', '[]')",
          [id, "a".repeat(40)],
        )
      await move(workspaces[0]!.id)
      await expect(migrateDatabase(database.url)).rejects.toThrow(
        /no verified move into Git/,
      )
      await move(workspaces[1]!.id)
      await migrateDatabase(database.url)
      expect(await tables(pool)).toEqual([])
      // And again, nothing to do.
      await migrateDatabase(database.url)
    } finally {
      await pool.end()
      await database.drop()
    }
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
