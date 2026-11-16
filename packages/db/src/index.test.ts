import { sql } from "drizzle-orm"
import { afterAll, describe, expect, inject, it } from "vitest"

import { createDatabase } from "./index.js"

describe("database", () => {
  const { db, pool } = createDatabase(inject("databaseUrl"))

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
