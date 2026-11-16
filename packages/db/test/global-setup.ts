import { randomBytes } from "node:crypto"
import pg from "pg"
import type { TestProject } from "vitest/node"

import { migrateDatabase } from "../src/index.js"

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string
  }
}

// Database tests need a real PostgreSQL server. CI provides one as a service
// container; locally, `pnpm services:up` starts one with deploy/compose.dev.yml.
const defaultDatabaseUrl = "postgres://shinan@localhost:5432/shinan"

/**
 * Creates a fresh, migrated database for this test run and drops it afterwards,
 * so tests never touch the development database's data.
 */
export default async function setup(project: TestProject) {
  const serverUrl = process.env.DATABASE_URL ?? defaultDatabaseUrl
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

  async function dropDatabase() {
    const client = new pg.Client({ connectionString: serverUrl })
    await client.connect()
    try {
      await client.query(`drop database if exists "${name}" with (force)`)
    } finally {
      await client.end()
    }
  }

  try {
    await migrateDatabase(testUrl.toString())
  } catch (error) {
    await dropDatabase()
    throw error
  }
  project.provide("databaseUrl", testUrl.toString())

  return dropDatabase
}

function redact(url: string): string {
  const parsed = new URL(url)
  if (parsed.password) parsed.password = "***"
  return parsed.toString()
}
