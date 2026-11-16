import { sql } from "drizzle-orm"
import { afterAll, describe, expect, inject, it, vi } from "vitest"

import {
  checkDatabase,
  createDatabase,
  databaseErrorCode,
  migrateDatabase,
} from "./index.js"
import { connectTestDatabase, createTestDatabase } from "./testing.js"

describe("database", () => {
  const { db, pool } = connectTestDatabase()

  afterAll(async () => {
    await pool.end()
  })

  it("connects to PostgreSQL", async () => {
    const result = await db.execute<{ answer: number }>(sql`select 1 as answer`)
    expect(result.rows).toEqual([{ answer: 1 }])
  })

  it("has applied migrations", async () => {
    const result = await db.execute<{ exists: boolean }>(
      sql`select to_regclass('drizzle.__drizzle_migrations') is not null as exists`,
    )
    expect(result.rows).toEqual([{ exists: true }])
  })
})

describe("connection pool", () => {
  it("survives a connection killed while idle, logging only the error code", async () => {
    const { pool } = createDatabase(inject("databaseUrl"))
    const admin = connectTestDatabase()
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const { rows } = await pool.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      )
      const lost = new Promise<void>((resolve) =>
        pool.once("error", () => resolve()),
      )
      // As a PostgreSQL restart does to every connection.
      await admin.pool.query("select pg_terminate_backend($1)", [rows[0]!.pid])
      await lost

      expect(errors).toHaveBeenCalledWith(
        "Database connection lost (57P01); it is replaced when next needed",
      )
      const again = await pool.query<{ answer: number }>("select 1 as answer")
      expect(again.rows).toEqual([{ answer: 1 }])
    } finally {
      errors.mockRestore()
      await pool.end()
      await admin.pool.end()
    }
  })
})

describe("databaseErrorCode", () => {
  it("finds a code through wrappers and ignores anything else", () => {
    expect(databaseErrorCode({ code: "ECONNRESET" })).toBe("ECONNRESET")
    expect(
      databaseErrorCode(new Error("wrapped", { cause: { code: "57P01" } })),
    ).toBe("57P01")
    expect(databaseErrorCode({ code: "with spaces and values 'x'" })).toBe(
      "unknown",
    )
    expect(databaseErrorCode(undefined)).toBe("unknown")
  })
})

describe("checkDatabase", () => {
  it("is ready once every migration has been applied", async () => {
    const { pool } = connectTestDatabase()
    try {
      expect(await checkDatabase(pool)).toEqual({
        reachable: true,
        migrationsCurrent: true,
      })
    } finally {
      await pool.end()
    }
  })

  it("is not ready before migrate or behind it", async () => {
    const database = await createTestDatabase({ migrate: false })
    const { pool } = createDatabase(database.url)
    try {
      expect(await checkDatabase(pool)).toEqual({
        reachable: true,
        migrationsCurrent: false,
      })
      await migrateDatabase(database.url)
      expect(await checkDatabase(pool)).toMatchObject({
        migrationsCurrent: true,
      })
      await pool.query(
        "delete from drizzle.__drizzle_migrations where created_at = (select max(created_at) from drizzle.__drizzle_migrations)",
      )
      expect(await checkDatabase(pool)).toMatchObject({
        migrationsCurrent: false,
      })
    } finally {
      await pool.end()
      await database.drop()
    }
  })

  it("reports a database it cannot reach", async () => {
    const url = new URL(inject("databaseUrl"))
    url.pathname = "/shinan_database_that_does_not_exist"
    const { pool } = createDatabase(url.toString())
    try {
      expect(await checkDatabase(pool)).toEqual({
        reachable: false,
        migrationsCurrent: false,
      })
    } finally {
      await pool.end()
    }
  })
})
