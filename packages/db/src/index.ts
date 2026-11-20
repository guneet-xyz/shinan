import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { readMigrationFiles } from "drizzle-orm/migrator"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"

import { createLimitedLog, databaseErrorCode } from "./log.js"
import { refuseNestedConnections } from "./nesting.js"
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
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm"
export type { Column, SQL } from "drizzle-orm"
export { alias } from "drizzle-orm/pg-core"
export type {
  ActorKind,
  CatalogMoveProblem,
  CatalogMoveWaitingProposal,
  CatalogPurgeCounts,
  Confidence,
  EmailContent,
  EmailKind,
  EmailStatus,
  EventOrigin,
  EventSubject,
  IndexCheckDifference,
  InvitationState,
  Role,
  SecurityOutcome,
  TokenRevocationReason,
} from "./schema.js"

export {
  createLimitedLog,
  databaseErrorCode,
  errorFrames,
  errorSummary,
} from "./log.js"
export type { LimitedLog } from "./log.js"

export const migrationsFolder = fileURLToPath(
  new URL("../migrations", import.meta.url),
)

export {
  NestedConnectionError,
  refuseDuringTransactions,
  takeNestedConnectionRefusals,
} from "./nesting.js"

export function createDatabase(
  databaseUrl: string,
  options: {
    /**
     * Refuse queries on `db` while the same work holds one of its
     * transactions (`refuseNestedConnections`); tests turn it on.
     */
    refuseNested?: boolean
  } = {},
) {
  const pool = new pg.Pool({ connectionString: databaseUrl })
  // A connection can fail at any time, idle or in use, for example when
  // PostgreSQL restarts. Its client then emits "error", which Node.js turns
  // into a crash unless something listens. pg-pool listens only while a
  // client is idle, so every client gets its own listener for its whole
  // life. A query that was running rejects as usual; the pool drops the
  // connection and opens a new one when next needed. Only the code is
  // logged, at most once a minute.
  const log = createLimitedLog()
  pool.on("connect", (client) => {
    client.on("error", (error) => {
      const code = databaseErrorCode(error)
      const reason = code === "unknown" ? "" : ` (${code})`
      log(`Database connection lost${reason}; it is replaced when next needed`)
    })
  })
  // The pool re-emits an idle client's error; the client's listener above
  // has already logged it.
  pool.on("error", () => {})
  const db = drizzle({ client: pool, schema })
  if (!options.refuseNested) return { db, pool }
  // The pool handed back is the guarded one too.
  const guarded = refuseNestedConnections(db)
  return { db: guarded, pool: guarded.$client }
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

/**
 * The migration that drops M2's catalog tables (Git-based catalog plan
 * §4.2): `migrate` applies the ones before it, moves the catalog into Git,
 * then applies it (`migrateDatabase` with `before`).
 */
export const m2DropMigration = "0020_m2_dropped"

/**
 * Applies the pending migrations from this package's migrations folder: all
 * of them, or with `before` only those before that one (by its tag).
 */
export async function migrateDatabase(
  databaseUrl: string,
  /** Another migrations folder, for tests of a migration on data. */
  folder: string = migrationsFolder,
  options: { before?: string } = {},
): Promise<void> {
  const { db, pool } = createDatabase(databaseUrl)
  try {
    if (options.before === undefined) {
      await migrate(db, { migrationsFolder: folder })
      return
    }
    const journal = JSON.parse(
      readFileSync(join(folder, "meta", "_journal.json"), "utf8"),
    ) as { entries: { tag: string; when: number }[] }
    const stop = journal.entries.find((e) => e.tag === options.before)
    if (!stop) throw new Error(`No migration ${options.before}`)
    // What Drizzle's `migrate` does (drizzle-orm 0.45:
    // `db.dialect.migrate(readMigrationFiles(config), db.session, config)`),
    // with the list cut short: each migration is known by its folder time,
    // as Drizzle records it. `dialect` and `session` are Drizzle's
    // internals: if an upgrade of Drizzle changes them this fails here, at
    // once, rather than migrating differently (m2-drop.test.ts covers it).
    const migrations = readMigrationFiles({ migrationsFolder: folder }).filter(
      (m) => m.folderMillis < stop.when,
    )
    const internal = db as unknown as {
      dialect?: {
        migrate?(
          migrations: unknown,
          session: unknown,
          config: unknown,
        ): Promise<void>
      }
      session?: unknown
    }
    if (typeof internal.dialect?.migrate !== "function" || !internal.session)
      throw new Error(
        "This version of Drizzle has no dialect.migrate: migrateDatabase's `before` needs updating",
      )
    await internal.dialect.migrate(migrations, internal.session, {
      migrationsFolder: folder,
    })
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
  // A lost connection fails the query in progress; without a listener its
  // "error" event would also crash the process.
  client.on("error", () => {})
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
