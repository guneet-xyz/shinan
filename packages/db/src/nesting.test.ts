import { sql } from "drizzle-orm"
import { afterAll, describe, expect, it } from "vitest"

import { NestedConnectionError } from "./nesting.js"
import * as schema from "./schema.js"
import { connectTestDatabase } from "./testing.js"

// Tests run on a database that refuses nested connections, so every test
// that reaches the database also checks the rule.
describe("a query on db while the same work holds a transaction", () => {
  const { db, pool } = connectTestDatabase()

  afterAll(async () => {
    await pool.end()
  })

  it("is refused, since it would wait for a second connection", async () => {
    await expect(
      db.transaction(async () => {
        await db.execute(sql`select 1`)
      }),
    ).rejects.toBeInstanceOf(NestedConnectionError)
    await expect(
      db.transaction(async () => {
        await db.select().from(schema.people).limit(1)
      }),
    ).rejects.toBeInstanceOf(NestedConnectionError)
    await expect(
      db.transaction(() => db.transaction(() => Promise.resolve())),
    ).rejects.toBeInstanceOf(NestedConnectionError)
  })

  it("is fine through the transaction, and before or after it", async () => {
    await db.execute(sql`select 1`)
    const answer = await db.transaction(async (tx) => {
      await tx.transaction((savepoint) => savepoint.execute(sql`select 1`))
      return (await tx.execute<{ one: number }>(sql`select 1 as one`)).rows
    })
    expect(answer).toEqual([{ one: 1 }])
    // Work running beside the transaction, not inside it, is not held up.
    await Promise.all([
      db.transaction((tx) => tx.execute(sql`select pg_sleep(0.05)`)),
      db.execute(sql`select 1`),
    ])
  })
})
