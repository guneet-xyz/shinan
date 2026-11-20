import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import pg from "pg"
import { inject } from "vitest"

import { createDatabase, migrateDatabase } from "./index.js"

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string
  }
}

// Database tests need a real PostgreSQL server. CI provides one as a service
// container; locally, `pnpm services:up` starts one with deploy/compose.dev.yml.
const defaultServerUrl = "postgres://shinan@localhost:5432/shinan"

export interface TestDatabase {
  url: string
  drop: () => Promise<void>
}

/**
 * Creates a fresh database on the server in DATABASE_URL, so tests never
 * touch the development database's data. It is migrated unless
 * `migrate: false` is given.
 */
export async function createTestDatabase(
  options: { migrate?: boolean } = {},
  serverUrl = process.env.DATABASE_URL ?? defaultServerUrl,
): Promise<TestDatabase> {
  const name = `shinan_test_${randomBytes(6).toString("hex")}`

  const admin = new pg.Client({ connectionString: serverUrl })
  try {
    await admin.connect()
  } catch (error) {
    await admin.end().catch(() => {})
    throw new Error(
      `Database tests could not connect to ${redact(serverUrl)}. ` +
        "Start PostgreSQL with `pnpm services:up` or set DATABASE_URL.",
      { cause: error },
    )
  }
  try {
    await admin.query(`create database "${name}"`)
  } finally {
    await admin.end()
  }

  const testUrl = new URL(serverUrl)
  testUrl.pathname = `/${name}`

  async function drop() {
    const client = new pg.Client({ connectionString: serverUrl })
    await client.connect()
    try {
      await client.query(`drop database if exists "${name}" with (force)`)
    } finally {
      await client.end()
    }
  }

  try {
    if (options.migrate !== false) await migrateDatabase(testUrl.toString())
  } catch (error) {
    await drop()
    throw error
  }
  return { url: testUrl.toString(), drop }
}

/**
 * The database Shinan v0.3.0 (M2) leaves behind, as a plain SQL dump made
 * by `deploy/test/v0.3.0-dataset.mjs`: three workspaces with M2's catalog
 * documents, revisions, proposals (two waiting), a comment, a page visit
 * and a purge. For tests of the move into Git (Git-based catalog plan §4).
 */
export const v030Dataset = fileURLToPath(
  new URL("../../../deploy/test/v0.3.0-dataset.sql", import.meta.url),
)

/** Loads a plain SQL dump (`pg_dump --inserts`) into an empty database. */
export async function loadDump(databaseUrl: string, path: string) {
  // psql's own commands (`\restrict` and the like) are not SQL.
  const text = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("\\"))
    .join("\n")
  // A connection of its own: the dump empties `search_path` for it.
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query(text)
  } finally {
    await client.end()
  }
}

/**
 * Connects to this test run's database, created by the global setup in
 * `test/global-setup.ts`. Call `pool.end()` when the tests are done.
 */
export function connectTestDatabase() {
  return createDatabase(inject("databaseUrl"), { refuseNested: true })
}

function redact(url: string): string {
  const parsed = new URL(url)
  if (parsed.password) parsed.password = "***"
  return parsed.toString()
}
