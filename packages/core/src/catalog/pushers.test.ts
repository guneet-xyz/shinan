import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { schema } from "@shinan/db"

import {
  asAgent,
  asPerson,
  asShinan,
  newPerson,
  testDatabase,
} from "../../test/helpers.js"
import type { AgentActor } from "../actor.js"
import { NotFoundError } from "../errors.js"
import type { Person } from "../identity/people.js"
import { createWorkspace } from "../identity/workspaces.js"
import type { CommitInfo, JournalEntry } from "./git/api.js"
import type { GitClient } from "./git/client.js"
import { storeCatalogJournal } from "./git/push-log.js"
import type { PushCheckedData } from "./git/push-log.js"
import { readCommitPushes } from "./pushers.js"

const { db, pool } = testDatabase()

afterAll(async () => {
  await pool.end()
})

const oid = (c: string) => c.repeat(40)
const at = (minute: number) =>
  new Date(Date.UTC(2026, 10, 20, 12, minute)).toISOString()

let owner: Person
let stranger: Person
let workspaceId: string
let agentName: string

/** A commit as the Git container lists it, with these parents. */
const info = (c: string, parents: string[]): CommitInfo => ({
  oid: oid(c),
  parents: parents.map(oid),
  author: null,
  committer: null,
  message: c,
  truncated: false,
  changes: [],
  changeCount: 0,
  changesTruncated: false,
  changeCountAtLeast: false,
})

beforeAll(async () => {
  owner = await newPerson(db, "owner")
  stranger = await newPerson(db, "stranger")
  workspaceId = (await createWorkspace(asPerson(db, owner), { name: "Who" }))
    .workspace.id
  const agent = (await asAgent(db, owner, workspaceId)).actor as AgentActor
  agentName = `OpenCode on ${agent.agentHandle.replace(/^opencode-/, "")}`

  // The journal of a Git container: the repository made at a by Shinan;
  // b pushed to main; c pushed on a branch; then the merge m of b and c
  // pushed to main.
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
    added: string[] = [],
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
      receivedObjects: 1,
      newCommits: first.length,
    } satisfies PushCheckedData)
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
              commits: added.length,
              added: added.map(oid),
              documents: [],
              documentsTruncated: false,
            }
          : null,
    })
  }
  append("repository.created", 0, { workspaceId, commit: oid("a") })
  push(10, "refs/heads/main", "a", "b", ["b"], ["b"])
  push(20, "refs/heads/branch", null, "c", ["c"])
  // The merge d brings c to main with it.
  push(30, "refs/heads/main", "b", "d", ["d"], ["d", "c"])
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

describe("who pushed each change, and when it reached main", () => {
  // As `git log` lists them: the merge d of b and c, then c, b and a.
  const commits = [
    info("d", ["b", "c"]),
    info("c", ["a"]),
    info("b", ["a"]),
    info("a", []),
    info("e", ["a"]),
  ]

  it("names the first pusher and the time main reached each commit", async () => {
    const pushes = await readCommitPushes(
      asPerson(db, owner),
      workspaceId,
      commits,
    )
    const pusher = {
      kind: "agent",
      person: owner.name,
      agent: agentName,
    }
    expect(pushes.get(oid("d"))).toEqual({
      pushed_by: pusher,
      reached_main_at: at(30),
    })
    // Pushed on a branch at 20, it reached main with the merge at 30.
    expect(pushes.get(oid("c"))).toEqual({
      pushed_by: pusher,
      reached_main_at: at(30),
    })
    expect(pushes.get(oid("b"))).toEqual({
      pushed_by: pusher,
      reached_main_at: at(10),
    })
    expect(pushes.get(oid("a"))).toEqual({
      pushed_by: { kind: "shinan" },
      reached_main_at: at(0),
    })
    // A commit the push log has no record of.
    expect(pushes.has(oid("e"))).toBe(false)
  })

  it("reads when a commit reached main from the record, whatever else is asked", async () => {
    // Alone, as on a page of its own or in a page's History.
    const pushes = await readCommitPushes(asPerson(db, owner), workspaceId, [
      info("c", ["a"]),
    ])
    expect(pushes.get(oid("c"))!.reached_main_at).toBe(at(30))
  })

  it("keeps a rewritten commit's arrival, through the commit it replaces", async () => {
    // As a purge's rewrite records it (GC-8): the new commit replaces c.
    await db.insert(schema.catalogCommitFirstPushes).values({
      workspaceId,
      commit: oid("f"),
      firstPushedAt: new Date(at(50)),
      pusherKind: "shinan",
      byLabel: "shinan",
      replacesCommit: oid("c"),
    })
    const pushes = await readCommitPushes(asPerson(db, owner), workspaceId, [
      info("f", ["a"]),
    ])
    expect(pushes.get(oid("f"))).toEqual({
      pushed_by: { kind: "shinan" },
      reached_main_at: at(30),
    })
  })

  it("is for the workspace's members only", async () => {
    await expect(
      readCommitPushes(asPerson(db, stranger), workspaceId, commits),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
