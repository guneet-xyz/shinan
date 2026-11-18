import { sql } from "drizzle-orm"
import { afterAll, describe, expect, it } from "vitest"

import {
  NestedConnectionError,
  takeNestedConnectionRefusals,
} from "./nesting.js"
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
    ).rejects.toBeInstanceOf(NestedConnectionError) // Each refusal is recorded; taken here, since they are on purpose.
    expect(takeNestedConnectionRefusals()).toHaveLength(3)
  })

  it("records a refusal even when the code swallows the error", async () => {
    await db.transaction(async (tx) => {
      try {
        await db.execute(sql`select 1`)
      } catch {
        // Carrying on, as careless code might.
      }
      await tx.execute(sql`select 1`)
    })
    const [refusal] = takeNestedConnectionRefusals()
    expect(refusal).toMatch(
      /db\.execute\(\) was called while this work holds a transaction/,
    )
    // Taking them empties the record, which the test setup then finds clean.
    expect(takeNestedConnectionRefusals()).toEqual([])
  })

  it("lets work a transaction started use db once it has ended", async () => {
    let later: Promise<unknown> | undefined
    await db.transaction(async (tx) => {
      later = new Promise((resolve, reject) =>
        setTimeout(() => {
          // Runs 20 ms after the transaction committed.
          db.execute(sql`select 1`).then(resolve, reject)
        }, 20),
      )
      await tx.execute(sql`select 1`)
    })
    await expect(later).resolves.toBeDefined()
    expect(takeNestedConnectionRefusals()).toEqual([])
  })

  it("still refuses work that runs while the transaction is open", async () => {
    await expect(
      db.transaction(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        await db.execute(sql`select 1`)
      }),
    ).rejects.toBeInstanceOf(NestedConnectionError)
    expect(takeNestedConnectionRefusals()).toHaveLength(1)
  })

  it("guards the raw pool too, through db.$client and as returned", async () => {
    for (const client of [db.$client, pool]) {
      await expect(
        db.transaction(async () => {
          await client.query("select 1")
        }),
      ).rejects.toBeInstanceOf(NestedConnectionError)
      await expect(
        db.transaction(async () => {
          const connection = await client.connect()
          connection.release()
        }),
      ).rejects.toBeInstanceOf(NestedConnectionError)
    }
    expect(takeNestedConnectionRefusals()).toHaveLength(4)
    // Outside a transaction, the pool works as usual.
    expect((await db.$client.query("select 1 as one")).rows).toEqual([
      { one: 1 },
    ])
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
