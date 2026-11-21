import { randomUUID } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  asAgent,
  asPerson,
  asShinan,
  newPerson,
  testDatabase,
} from "../../../test/helpers.js"
import type { AgentActor } from "../../actor.js"
import { createWorkspace } from "../../identity/workspaces.js"
import type { JournalEntry } from "./api.js"
import type { GitClient } from "./client.js"
import { storeCatalogJournal } from "./push-log.js"
import type { PushCheckedData } from "./push-log.js"

// The back-fill of `catalog_main_arrivals` in its migration, over a push
// log recorded before `push.confirmed` listed the commits an update of
// `main` added (`main.added`, review of #196).

const { db, pool } = testDatabase()

afterAll(async () => {
  await pool.end()
})

const oid = (c: string) => c.repeat(40)
const at = (minute: number) =>
  new Date(Date.UTC(2026, 10, 20, 12, minute)).toISOString()

const migrations = new URL("../../../../db/migrations/", import.meta.url)
/** The migration's statements that fill in arrivals. */
const backFill = readFileSync(
  new URL(
    readdirSync(migrations).find((f) =>
      f.endsWith("_catalog_main_arrivals.sql"),
    )!,
    migrations,
  ),
  "utf8",
)
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter((statement) =>
    statement
      .split("\n")
      .find((line) => !line.startsWith("--"))
      ?.startsWith('INSERT INTO "catalog_main_arrivals"'),
  )

let workspaceId: string

beforeAll(async () => {
  const owner = await newPerson(db, "owner")
  workspaceId = (
    await createWorkspace(asPerson(db, owner), { name: "Back-filled" })
  ).workspace.id
  const agent = (await asAgent(db, owner, workspaceId)).actor as AgentActor

  // Made at a by Shinan; one push to main of b, c and d (the tip); e on a
  // branch; then the merge m of d and e pushed to main.
  const entries: JournalEntry[] = []
  const append = (kind: string, minute: number, data: object) =>
    entries.push({
      number: entries.length + 1,
      recordedAt: at(minute),
      kind,
      data: data as Record<string, unknown>,
    })
  const push = (
    minute: number,
    ref: string,
    from: string | null,
    to: string,
    first: string[],
  ) => {
    const id = randomUUID()
    append("push.checked", minute, {
      push: id,
      workspaceId,
      agent: { id: agent.agentId, handle: agent.agentHandle },
      person: { id: owner.id, handle: owner.handle },
      memberId: randomUUID(),
      tokenId: agent.tokenId,
      networkAddress: "203.0.113.7",
      by: `${owner.handle} via ${agent.agentHandle}`,
      outcome: "accepted",
      codes: [],
      warnings: 0,
      secrets: 0,
      refs: [
        {
          ref,
          old: from && oid(from),
          new: oid(to),
          kind: from ? "update" : "create",
        },
      ],
      receivedBytes: 100,
      receivedObjects: first.length,
      newCommits: first.length,
    } satisfies PushCheckedData)
    // The old way: `main` without `added`.
    append("push.confirmed", minute, {
      push: id,
      workspaceId,
      confirmed: [0],
      firstPushes: first.map((c) => ({ commit: oid(c), ref })),
      main:
        ref === "refs/heads/main"
          ? {
              from: oid(from!),
              to: oid(to),
              commits: first.length,
              documents: [],
              documentsTruncated: false,
            }
          : null,
    })
  }
  append("repository.created", 0, { workspaceId, commit: oid("a") })
  push(10, "refs/heads/main", "a", "d", ["b", "c", "d"])
  push(20, "refs/heads/branch", null, "e", ["e"])
  push(30, "refs/heads/main", "d", "f", ["f"])
  const journalId = randomUUID()
  const client = {
    readJournal: ({ after }: { after: number }) =>
      Promise.resolve({
        journalId,
        entries: entries.filter((e) => e.number > after),
        last: entries.length,
      }),
    acknowledgeJournal: () => Promise.resolve({ deleted: 0 }),
  } as unknown as GitClient
  await storeCatalogJournal(
    { ...asShinan(db), jobs: { send: () => Promise.resolve(null) } },
    client,
  )
})

describe("the back-fill of when commits reached main", () => {
  it("gives every commit a push brought to main that push's time, and leaves a merged branch's out", async () => {
    expect(backFill).toHaveLength(3)
    // The statements run as the migration runs them, over this
    // workspace's push log alone: unqualified names find these temporary
    // tables first, and the transaction is rolled back.
    const client = await pool.connect()
    try {
      await client.query("begin")
      for (const table of [
        "catalog_pushes",
        "catalog_push_refs",
        "catalog_commit_first_pushes",
      ]) {
        const where =
          table === "catalog_push_refs"
            ? `push_id in (select id from public.catalog_pushes where workspace_id = $1)`
            : `workspace_id = $1`
        await client.query(
          `create temporary table "${table}" on commit drop as select * from public."${table}" where ${where}`,
          [workspaceId],
        )
      }
      await client.query(
        `create temporary table "catalog_main_arrivals" (like public."catalog_main_arrivals" including all) on commit drop`,
      )
      for (const statement of backFill) await client.query(statement)
      const { rows } = await client.query<{ commit: string; at: Date }>(
        `select "commit", "reached_main_at" as at from pg_temp."catalog_main_arrivals" order by "commit"`,
      )
      expect(
        Object.fromEntries(rows.map((r) => [r.commit, r.at.toISOString()])),
      ).toEqual({
        [oid("a")]: at(0),
        // All three commits of the one push, not only its tip.
        [oid("b")]: at(10),
        [oid("c")]: at(10),
        [oid("d")]: at(10),
        // e reached main with the merge, which the old log can't show.
        [oid("f")]: at(30),
      })
    } finally {
      await client.query("rollback")
      client.release()
    }
  })
})
