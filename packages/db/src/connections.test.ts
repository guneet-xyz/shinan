import { readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Only `createDatabase` makes the pool the application uses, so that tests
 * can guard it (`refuseNestedConnections`); the other connections are the
 * migration lock's and the test database's admin client, none of which runs
 * inside a transaction (#144). ESLint refuses importing a PostgreSQL driver
 * anywhere else (`eslint.config.mjs`); this checks the same in every file,
 * scripts and `require` included.
 */
const root = join(import.meta.dirname, "..", "..", "..")

/** Where a PostgreSQL client may be imported, and what for. */
const allowed: Record<string, RegExp | null> = {
  // createDatabase (with Drizzle's node-postgres driver) and
  // withMigrationLock.
  "packages/db/src/index.ts": null,
  // The test database's admin client.
  "packages/db/src/testing.ts": null,
  // The error class only, to read a SQLSTATE code.
  "packages/db/src/schema.test.ts": /^import \{ DatabaseError \} from "pg"$/,
}

/**
 * Importing a driver, or a subpath of one (`pg/lib/…`), or Drizzle's driver
 * entry points, whose `drizzle(url)` makes a pool of its own (#147).
 */
const driver =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'](?:(?:pg|pg-pool|postgres)(?:\/[^"']*)?|drizzle-orm\/(?:node-postgres|postgres-js)(?:\/[^"']*)?)["']/

function sources(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      ["node_modules", "dist", "coverage", ".git"].includes(entry.name) ||
      entry.name.startsWith(".")
    )
      continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...sources(path))
    else if (/\.(ts|tsx|mts|js|mjs|cjs)$/.test(entry.name)) found.push(path)
  }
  return found
}

describe("PostgreSQL connections", () => {
  it.each([
    'import pg from "pg"',
    'import { Pool } from "pg-pool"',
    'import Client from "pg/lib/client"',
    "const { Pool } = require('pg/lib/index.js')",
    'const postgres = await import("postgres")',
    'import { drizzle } from "drizzle-orm/node-postgres"',
    'import { migrate } from "drizzle-orm/node-postgres/migrator"',
    'import { drizzle } from "drizzle-orm/postgres-js"',
  ])("recognises %s as making connections", (line) => {
    expect(driver.test(line)).toBe(true)
  })

  it.each([
    'import { sql } from "drizzle-orm"',
    'import { pgTable } from "drizzle-orm/pg-core"',
    'import { readMigrationFiles } from "drizzle-orm/migrator"',
    'import { PgBoss } from "pg-boss"',
    'import { pgEnum } from "./schema.js"',
  ])("leaves %s alone", (line) => {
    expect(driver.test(line)).toBe(false)
  })

  it("are made only by createDatabase and the known admin paths", () => {
    const misplaced: string[] = []
    for (const top of ["apps", "packages", "deploy"])
      for (const path of sources(join(root, top))) {
        const file = relative(root, path).split(sep).join("/")
        if (file === "packages/db/src/connections.test.ts") continue
        for (const line of readFileSync(path, "utf8").split("\n")) {
          if (!driver.test(line)) continue
          const rule = allowed[file]
          if (rule === null) continue
          if (rule && rule.test(line.trim())) continue
          misplaced.push(`${file}: ${line.trim()}`)
        }
      }
    expect(misplaced).toEqual([])
  })
})
