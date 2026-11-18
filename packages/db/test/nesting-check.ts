import { afterAll, afterEach, beforeEach } from "vitest"

import { takeNestedConnectionRefusals } from "@shinan/db"

/**
 * Vitest setup for every project with database tests (#142): a query on
 * `db` (or its pool) while the same work holds a transaction is refused
 * (`refuseNestedConnections`), and the refusal recorded. A test that leaves
 * a refusal behind fails here, even if the code under test caught the
 * error and carried on.
 */
function check(when: string): void {
  const refusals = takeNestedConnectionRefusals()
  if (refusals.length > 0)
    throw new Error(
      `${refusals.length} nested database connection${refusals.length === 1 ? " was" : "s were"} refused ${when}, even if caught:\n${refusals.join("\n")}`,
    )
}

// Before each test, so a refusal from a `beforeAll` hook, or from work an
// earlier test left running, is named as such rather than charged to the
// test that happens to come next. It runs before the file's own hooks.
beforeEach(() =>
  check(
    "before this test: in a beforeAll hook, or by work an earlier test left running",
  ),
)
afterEach(() => check("during this test"))
afterAll(() => check("in this file's afterAll hooks, or by work left running"))
