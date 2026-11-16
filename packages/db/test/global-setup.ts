import type { TestProject } from "vitest/node"

import { createTestDatabase } from "../src/testing.js"

/**
 * Vitest global setup for every project with database tests: creates a fresh,
 * migrated database for this test run and drops it afterwards.
 */
export default async function setup(project: TestProject) {
  const database = await createTestDatabase()
  project.provide("databaseUrl", database.url)
  return () => database.drop()
}
