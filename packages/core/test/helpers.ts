import { randomBytes } from "node:crypto"
import { PgBoss } from "pg-boss"
import { inject } from "vitest"

import { connectTestDatabase } from "@shinan/db/testing"

import type { AgentActor, PersonActor, Scope } from "../src/actor.js"
import { shinan } from "../src/actor.js"
import type { Context } from "../src/context.js"
import { createPerson } from "../src/identity/people.js"
import type { Person } from "../src/identity/people.js"
import { jobQueues } from "../src/queues.js"

type Db = Context["db"]

type Pool = ReturnType<typeof connectTestDatabase>["pool"]

export function testDatabase(): { db: Db; pool: Pool } {
  return connectTestDatabase()
}

/** A unique handle, since tests share one database. */
export function uniqueHandle(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`
}

export function asShinan(db: Db): Context {
  return { db, actor: shinan }
}

/** A person who has just signed in again, so sensitive actions are allowed. */
export function asPerson(
  db: Db,
  person: Person,
  options: { reauthenticated?: boolean } = {},
): Context {
  const actor: PersonActor = {
    kind: "person",
    personId: person.id,
    reauthenticated: options.reauthenticated ?? true,
  }
  return {
    db,
    actor,
    request: { networkAddress: "192.0.2.10", client: "test" },
  }
}

export function asAgent(
  db: Db,
  person: Person,
  workspaceId: string,
  scopes: readonly Scope[] = [
    "catalog:read",
    "catalog:propose",
    "tasks:read",
    "tasks:write",
    "presence",
  ],
): Context {
  const actor: AgentActor = {
    kind: "agent",
    agentId: crypto.randomUUID(),
    agentHandle: "opencode-daedalus",
    personId: person.id,
    workspaceId,
    scopes,
  }
  return { db, actor, origin: "mcp_call" }
}

export async function newPerson(db: Db, prefix = "person"): Promise<Person> {
  const handle = uniqueHandle(prefix)
  return createPerson(asShinan(db), {
    handle,
    name: `Person ${handle}`,
    email: `${handle}@example.com`,
  })
}

/**
 * Starts a job queue on this test run's database, installing pg-boss and
 * creating core's queues as `migrate` does. Call `stop()` when done.
 */
export async function startTestJobQueue(): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: inject("databaseUrl"),
    schema: "pgboss",
    migrate: true,
    supervise: false,
    schedule: false,
    useListenNotify: true,
  })
  boss.on("error", (error) => console.error(error))
  await boss.start()
  for (const queue of jobQueues)
    await boss.createQueue(queue.name, queue.options)
  return boss
}
