import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"

import * as schema from "./schema.js"

export { schema }

// Query helpers, re-exported so that every package uses this package's one
// copy of Drizzle.
export {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm"
export type {
  ActorKind,
  Confidence,
  EmailContent,
  EmailKind,
  EmailStatus,
  EventOrigin,
  EventSubject,
  Role,
  SecurityOutcome,
} from "./schema.js"

export const migrationsFolder = fileURLToPath(
  new URL("../migrations", import.meta.url),
)

export function createDatabase(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl })
  const db = drizzle({ client: pool, schema })
  return { db, pool }
}

export type Database = ReturnType<typeof createDatabase>["db"]

/** A transaction started with `db.transaction()`. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0]

/** Applies all pending migrations from this package's migrations folder. */
export async function migrateDatabase(databaseUrl: string): Promise<void> {
  const { db, pool } = createDatabase(databaseUrl)
  try {
    await migrate(db, { migrationsFolder })
  } finally {
    await pool.end()
  }
}

/**
 * Runs `work` while holding a session-level advisory lock, so overlapping
 * `migrate` runs (for example a restart loop) take turns instead of racing.
 * Drizzle's migrator takes no lock of its own.
 */
export async function withMigrationLock<T>(
  databaseUrl: string,
  work: () => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query(`select pg_advisory_lock(${migrationLockKey})`)
    try {
      return await work()
    } finally {
      await client.query(`select pg_advisory_unlock(${migrationLockKey})`)
    }
  } finally {
    await client.end()
  }
}

const migrationLockKey = "hashtextextended('shinan:migrate', 0)"
