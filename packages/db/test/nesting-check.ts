import { afterAll, afterEach } from "vitest"

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

afterEach(() => check("during this test"))
afterAll(() => check("in this file's hooks"))
