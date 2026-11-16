import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"

import * as schema from "./schema.js"

export { schema }

export const migrationsFolder = fileURLToPath(
  new URL("../migrations", import.meta.url),
)

export function createDatabase(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl })
  const db = drizzle({ client: pool, schema })
  return { db, pool }
}

export type Database = ReturnType<typeof createDatabase>["db"]

/** Applies all pending migrations from this package's migrations folder. */
export async function migrateDatabase(databaseUrl: string): Promise<void> {
  const { db, pool } = createDatabase(databaseUrl)
  try {
    await migrate(db, { migrationsFolder })
  } finally {
    await pool.end()
  }
}
