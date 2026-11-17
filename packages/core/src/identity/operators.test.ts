import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createDatabase, eq, schema } from "@shinan/db"
import { createTestDatabase } from "@shinan/db/testing"
import type { TestDatabase } from "@shinan/db/testing"

import { shinan } from "../actor.js"
import type { Context } from "../context.js"
import { syncOperators } from "./allowlist.js"
import { setUpInstallation } from "./installation.js"

// Several `web` processes starting at once on a fresh database each sync the
// configured operators. This file gets a database of its own so the counts
// below see only its own entries.
let database: TestDatabase
let db: Context["db"]
let pool: ReturnType<typeof createDatabase>["pool"]

beforeAll(async () => {
  database = await createTestDatabase()
  ;({ db, pool } = createDatabase(database.url))
  await setUpInstallation(asShinan(), { name: "Test" })
})

afterAll(async () => {
  await pool?.end()
  await database?.drop()
})

function asShinan(): Context {
  return { db, actor: shinan }
}

/** Runs `syncOperators` from several processes, each with its own pool. */
async function startReplicas(emails: string[], replicas = 8): Promise<void> {
  const connections = Array.from({ length: replicas }, () =>
    createDatabase(database.url),
  )
  try {
    await Promise.all(
      connections.map((c) =>
        syncOperators({ db: c.db, actor: shinan }, { emails }),
      ),
    )
  } finally {
    await Promise.all(connections.map((c) => c.pool.end()))
  }
}

async function entries(action: string, email: string) {
  const rows = await db
    .select({ details: schema.securityLog.details })
    .from(schema.securityLog)
    .where(eq(schema.securityLog.action, action))
  return rows.filter(
    (row) => (row.details as { email?: string }).email === email,
  )
}

describe("syncOperators from several web processes at once", () => {
  it("adds each operator once, and none of them fails", async () => {
    const emails = ["first@example.com", "second@example.com"]
    await startReplicas(emails)

    const operators = await db.select().from(schema.installationOperators)
    expect(operators.map((row) => row.email).sort()).toEqual(emails)
    for (const email of emails) {
      expect(await entries("operator.added", email)).toHaveLength(1)
      expect(await entries("allowlist.added", email)).toHaveLength(1)
    }
  })

  it("removes an operator once when the configuration drops them", async () => {
    await startReplicas(["first@example.com"])

    const operators = await db.select().from(schema.installationOperators)
    expect(operators.map((row) => row.email)).toEqual(["first@example.com"])
    expect(
      await entries("operator.removed", "second@example.com"),
    ).toHaveLength(1)
  })
})
