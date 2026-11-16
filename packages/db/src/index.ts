import { fileURLToPath } from "node:url"
import { readMigrationFiles } from "drizzle-orm/migrator"
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
  getTableColumns,
  gt,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm"
export { alias } from "drizzle-orm/pg-core"
export type {
  ActorKind,
  Confidence,
  EmailContent,
  EmailKind,
  EmailStatus,
  EventOrigin,
  EventSubject,
  InvitationState,
  Role,
  SecurityOutcome,
} from "./schema.js"

export const migrationsFolder = fileURLToPath(
  new URL("../migrations", import.meta.url),
)

export function createDatabase(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl })
  // An idle connection can fail at any time, for example when PostgreSQL
  // restarts. Without a listener Node.js would crash the process; the pool
  // has already dropped the connection and opens a new one when next used.
  pool.on("error", (error) => {
    console.error(
      `Database connection lost (${databaseErrorCode(error)}); it is replaced when next needed`,
    )
  })
  const db = drizzle({ client: pool, schema })
  return { db, pool }
}

/**
 * A database error's code, such as a SQLSTATE (`57P01`) or a network error
 * (`ECONNRESET`), looking through wrappers. Only the code is ever logged: an
 * error's message and details can quote a query's values (architecture
 * §10.3).
 */
export function databaseErrorCode(error: unknown): string {
  let current: unknown = error
  for (let depth = 0; depth < 5; depth++) {
    if (typeof current !== "object" || current === null) break
    const { code, cause } = current as { code?: unknown; cause?: unknown }
    if (typeof code === "string" && /^[A-Za-z0-9_]{1,32}$/.test(code)) {
      return code
    }
    current = cause
  }
  return "unknown"
}

export interface DatabaseReadiness {
  /** The database answered. */
  reachable: boolean
  /** Every migration this release ships has been applied. */
  migrationsCurrent: boolean
}

/**
 * Whether the database can serve this release (architecture §13): it
 * answers, and `migrate` has applied this release's migrations. Drizzle
 * records each applied migration with its folder time; the database is
 * current when the newest recorded one is at least the newest shipped.
 */
export async function checkDatabase(pool: pg.Pool): Promise<DatabaseReadiness> {
  let latest: string | null
  try {
    const result = await pool.query<{ latest: string | null }>(
      "select max(created_at)::text as latest from drizzle.__drizzle_migrations",
    )
    latest = result.rows[0]?.latest ?? null
  } catch (error) {
    // No migrations table (or schema) yet: reachable, but never migrated.
    const missing = ["42P01", "3F000"].includes(databaseErrorCode(error))
    return { reachable: missing, migrationsCurrent: false }
  }
  newestShipped ??= Math.max(
    0,
    ...readMigrationFiles({ migrationsFolder }).map((m) => m.folderMillis),
  )
  return {
    reachable: true,
    migrationsCurrent: latest !== null && Number(latest) >= newestShipped,
  }
}

let newestShipped: number | undefined

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
