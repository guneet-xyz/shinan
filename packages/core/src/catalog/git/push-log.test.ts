import { randomUUID } from "node:crypto"
import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { and, eq, schema, sql } from "@shinan/db"

import {
  asAgent,
  asPerson,
  asShinan,
  newPerson,
  testDatabase,
} from "../../../test/helpers.js"
import type { AgentActor } from "../../actor.js"
import type { Person } from "../../identity/people.js"
import { createWorkspace } from "../../identity/workspaces.js"
import type { JournalEntry, RepositoryRefs } from "./api.js"
import type { GitClient } from "./client.js"
import {
  checkCatalogRefs,
  refFingerprint,
  storeCatalogJournal,
} from "./push-log.js"
import type { PushCheckedData, PushConfirmedData } from "./push-log.js"

const { db, pool } = testDatabase()

afterAll(async () => {
  await pool.end()
})

/** A Git container's journal and refs, in memory. */
function fakeGit(journalId = randomUUID()) {
  const journal = {
    id: journalId,
    entries: [] as JournalEntry[],
    last: 0,
    acknowledged: 0,
    refs: new Map<string, RepositoryRefs>(),
    append(kind: string, data: object) {
      journal.last++
      journal.entries.push({
        number: journal.last,
        recordedAt: new Date().toISOString(),
        kind,
        data: data as Record<string, unknown>,
      })
    },
  }
  const client = {
    readJournal: ({ after, limit = 100 }: { after: number; limit?: number }) =>
      Promise.resolve({
        journalId: journal.id,
        entries: journal.entries
          .filter((e) => e.number > after)
          .slice(0, limit),
        last: journal.last,
      }),
    acknowledgeJournal: ({
      through,
    }: {
      journalId: string
      through: number
    }) => {
      const before = journal.entries.length
      journal.entries = journal.entries.filter((e) => e.number > through)
      journal.acknowledged = Math.max(journal.acknowledged, through)
      return Promise.resolve({ deleted: before - journal.entries.length })
    },
    listRefs: (workspaceId: string) =>
      Promise.resolve(journal.refs.get(workspaceId) ?? null),
  } as unknown as GitClient
  return { journal, client }
}

let owner: Person
let workspaceId: string
const commit = (c: string) => c.repeat(40)

beforeEach(async () => {
  owner = await newPerson(db, "owner")
  workspaceId = (await createWorkspace(asPerson(db, owner), { name: "Team" }))
    .workspace.id
})

function checked(
  push: string,
  overrides: Partial<PushCheckedData> = {},
): PushCheckedData {
  return {
    push,
    workspaceId,
    agent: { id: randomUUID(), handle: "opencode-daedalus" },
    person: { id: owner.id, handle: owner.handle },
    memberId: randomUUID(),
    tokenId: randomUUID(),
    networkAddress: "203.0.113.7",
    by: `${owner.handle} via opencode-daedalus`,
    outcome: "accepted",
    codes: [],
    warnings: 0,
    secrets: 0,
    refs: [
      {
        ref: "refs/heads/main",
        old: commit("a"),
        new: commit("b"),
        kind: "update",
      },
      { ref: "refs/heads/x", old: null, new: commit("b"), kind: "create" },
    ],
    receivedBytes: 1234,
    receivedObjects: 3,
    newCommits: 1,
    ...overrides,
  }
}

const ctx = () => ({
  ...asShinan(db),
  jobs: { send: () => Promise.resolve(null) },
})

describe("storeCatalogJournal", () => {
  it("stores pushes, confirmations and first pushes once, then acknowledges them", async () => {
    const { journal, client } = fakeGit()
    const push = randomUUID()
    const agent = (await asAgent(db, owner, workspaceId)).actor as AgentActor
    journal.append("repository.created", { workspaceId, commit: commit("a") })
    journal.append(
      "push.checked",
      checked(push, {
        agent: { id: agent.agentId, handle: agent.agentHandle },
        by: `${owner.handle} via ${agent.agentHandle}`,
      }),
    )
    journal.append("push.confirmed", {
      push,
      workspaceId,
      by: "x",
      confirmed: [0],
      firstPushes: [{ commit: commit("b"), ref: "refs/heads/main" }],
      main: {
        from: commit("a"),
        to: commit("b"),
        commits: 1,
        documents: ["machine/musashi"],
        documentsTruncated: false,
      },
    } satisfies PushConfirmedData & { by: string })
    // Read twice before acknowledging, as two processes might.
    const copy = [...journal.entries]
    expect(await storeCatalogJournal(ctx(), client)).toEqual({
      stored: 3,
      setAside: 0,
    })
    journal.entries = copy
    expect(await storeCatalogJournal(ctx(), client)).toEqual({
      stored: 0,
      setAside: 0,
    })
    expect(journal.acknowledged).toBe(3)
    expect(journal.entries).toEqual([])

    const [row] = await db
      .select()
      .from(schema.catalogPushes)
      .where(eq(schema.catalogPushes.id, push))
    expect(row).toMatchObject({
      workspaceId,
      outcome: "accepted",
      receivedBytes: 1234,
      networkAddress: "203.0.113.7",
      journalId: journal.id,
      journalEntry: 2,
    })
    expect(
      await db
        .select({
          ref: schema.catalogPushRefs.ref,
          confirmed: schema.catalogPushRefs.confirmed,
        })
        .from(schema.catalogPushRefs)
        .where(eq(schema.catalogPushRefs.pushId, push))
        .orderBy(schema.catalogPushRefs.position),
    ).toEqual([
      { ref: "refs/heads/main", confirmed: true },
      { ref: "refs/heads/x", confirmed: false },
    ])
    const firsts = await db
      .select()
      .from(schema.catalogCommitFirstPushes)
      .where(eq(schema.catalogCommitFirstPushes.workspaceId, workspaceId))
      .orderBy(schema.catalogCommitFirstPushes.commit)
    expect(firsts).toMatchObject([
      { commit: commit("a"), pusherKind: "shinan", pushId: null },
      {
        commit: commit("b"),
        pusherKind: "agent",
        pushId: push,
        ref: "refs/heads/main",
      },
    ])
    const events = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.workspaceId, workspaceId))
    expect(events.filter((e) => e.kind === "catalog.pushed")).toHaveLength(1)
    const [state] = await db
      .select()
      .from(schema.catalogIndexState)
      .where(eq(schema.catalogIndexState.workspaceId, workspaceId))
    expect(state!.mainCommit).toBe(commit("b"))
  })

  it("records a refused push that held a secret in the security log, codes and counts only", async () => {
    const { journal, client } = fakeGit()
    const push = randomUUID()
    journal.append(
      "push.checked",
      checked(push, {
        outcome: "refused",
        codes: ["secret", "symlink"],
        secrets: 2,
      }),
    )
    await storeCatalogJournal(ctx(), client)
    const [entry] = await db
      .select()
      .from(schema.securityLog)
      .where(
        and(
          eq(schema.securityLog.action, "catalog.push-refused"),
          sql`${schema.securityLog.details}->>'push' = ${push}`,
        ),
      )
    expect(entry).toMatchObject({
      workspaceId,
      outcome: "refused",
      actorKind: "agent",
      actorPersonId: owner.id,
      networkAddress: "203.0.113.7",
      details: { codes: ["secret", "symlink"], secrets: 2 },
    })
  })

  it("reads a new journal from its first entry", async () => {
    const first = fakeGit()
    first.journal.append("push.checked", checked(randomUUID()))
    await storeCatalogJournal(ctx(), first.client)
    const second = fakeGit()
    const push = randomUUID()
    second.journal.append("push.checked", checked(push))
    expect(await storeCatalogJournal(ctx(), second.client)).toEqual({
      stored: 1,
      setAside: 0,
    })
  })

  it("sets aside entries about a workspace PostgreSQL does not have, records each once, and stores the entries after them", async () => {
    const { journal, client } = fakeGit()
    const unknown = randomUUID()
    const lost = randomUUID()
    journal.append("repository.created", {
      workspaceId: unknown,
      commit: commit("c"),
    })
    journal.append("push.checked", checked(lost, { workspaceId: unknown }))
    journal.append("push.confirmed", {
      push: lost,
      workspaceId: unknown,
      confirmed: [0],
      firstPushes: [{ commit: commit("b"), ref: "refs/heads/main" }],
      main: null,
    } satisfies PushConfirmedData)
    const push = randomUUID()
    journal.append("push.checked", checked(push))
    expect(await storeCatalogJournal(ctx(), client)).toEqual({
      stored: 1,
      setAside: 3,
    })
    expect(journal.acknowledged).toBe(4)
    const [stored] = await db
      .select()
      .from(schema.catalogPushes)
      .where(eq(schema.catalogPushes.id, push))
    expect(stored).toBeDefined()
    const setAside = () =>
      db
        .select()
        .from(schema.securityLog)
        .where(
          and(
            eq(schema.securityLog.action, "catalog.journal-set-aside"),
            sql`${schema.securityLog.details}->>'journalId' = ${journal.id}`,
          ),
        )
        .orderBy(schema.securityLog.id)
    const entries = await setAside()
    expect(entries.map((e) => [e.workspaceId, e.outcome, e.details])).toEqual(
      ["repository.created", "push.checked", "push.confirmed"].map(
        (kind, i) => [
          null,
          "failed",
          {
            journalId: journal.id,
            entry: i + 1,
            kind,
            workspaceId: unknown,
            reason: "workspace-unknown",
          },
        ],
      ),
    )
    // Acknowledged: a second run finds nothing, and reports nothing again.
    expect(await storeCatalogJournal(ctx(), client)).toEqual({
      stored: 0,
      setAside: 0,
    })
    expect(await setAside()).toHaveLength(3)
  })

  it("sets aside an entry that can never be stored, by its checks or the database's, and stores the next", async () => {
    const { journal, client } = fakeGit()
    journal.append("push.checked", checked("not-a-push-id"))
    journal.append(
      "push.checked",
      checked(randomUUID(), {
        refs: [
          {
            ref: "refs/heads/x",
            old: null,
            new: commit("b"),
            kind: "sideways" as never,
          },
        ],
      }),
    )
    journal.append("push.checked", checked(randomUUID()))
    expect(await storeCatalogJournal(ctx(), client)).toEqual({
      stored: 1,
      setAside: 2,
    })
    const reasons = await db
      .select({ details: schema.securityLog.details })
      .from(schema.securityLog)
      .where(
        and(
          eq(schema.securityLog.action, "catalog.journal-set-aside"),
          sql`${schema.securityLog.details}->>'journalId' = ${journal.id}`,
        ),
      )
      .orderBy(schema.securityLog.id)
    expect(
      reasons.map((r) => (r.details as { reason: string }).reason),
    ).toEqual(["invalid", "database-23514"])
    expect(journal.acknowledged).toBe(3)
  })

  it("stops at an entry of a kind it does not know, and acknowledges nothing past it", async () => {
    const { journal, client } = fakeGit()
    journal.append("push.future", {})
    await expect(storeCatalogJournal(ctx(), client)).rejects.toThrow(
      /unknown kind/,
    )
    expect(journal.acknowledged).toBe(0)
  })
})

describe("checkCatalogRefs", () => {
  it("records each branch the push log does not explain once, and skips a busy repository", async () => {
    const { journal, client } = fakeGit()
    await db
      .insert(schema.catalogRepositories)
      .values({
        workspaceId,
        createdAt: new Date(),
        firstCommit: commit("a"),
      })
      .onConflictDoUpdate({
        target: schema.catalogRepositories.workspaceId,
        set: { createdAt: new Date(), firstCommit: commit("a") },
      })
    const push = randomUUID()
    journal.append("push.checked", checked(push))
    journal.append("push.confirmed", {
      push,
      workspaceId,
      confirmed: [1],
      firstPushes: [],
      main: null,
    } satisfies PushConfirmedData)
    const refs = (list: { ref: string; commit: string }[], busy = false) =>
      journal.refs.set(workspaceId, {
        workspaceId,
        busy,
        refs: list,
        journalId: journal.id,
        journalLast: journal.last,
      })
    refs([
      { ref: "refs/heads/main", commit: commit("a") },
      { ref: "refs/heads/x", commit: commit("b") },
    ])
    // The journal is stored first, so the confirmed push explains `x`.
    const found = async () => {
      const result = await checkCatalogRefs(ctx(), client)
      return result.unlogged
    }
    const before = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.securityLog)
      .where(
        and(
          eq(schema.securityLog.workspaceId, workspaceId),
          eq(schema.securityLog.action, "catalog.unlogged-update"),
        ),
      )
    expect(before).toEqual([{ n: 0 }])
    expect(await found()).toBe(0)
    refs([
      { ref: "refs/heads/main", commit: commit("c") },
      { ref: "refs/heads/x", commit: commit("b") },
      { ref: "refs/heads/y", commit: commit("d") },
    ])
    expect(await found()).toBe(2)
    expect(await found()).toBe(0)
    refs([], true)
    expect(await found()).toBe(0)
    const entries = await db
      .select()
      .from(schema.securityLog)
      .where(
        and(
          eq(schema.securityLog.workspaceId, workspaceId),
          eq(schema.securityLog.action, "catalog.unlogged-update"),
        ),
      )
      .orderBy(schema.securityLog.id)
    // The branch by its keyed fingerprint only: the security log is never
    // purged, and a guessed name can't be checked without the key.
    const [{ key }] = (await db
      .select({ key: schema.catalogRefFingerprintKeys.key })
      .from(schema.catalogRefFingerprintKeys)
      .where(
        eq(schema.catalogRefFingerprintKeys.workspaceId, workspaceId),
      )) as [{ key: string }]
    expect(key).toMatch(/^[0-9a-f-]{72}$/)
    const fingerprint = (ref: string) => refFingerprint(key, ref)
    expect(fingerprint("refs/heads/main")).toMatch(/^hmac-sha256:[0-9a-f]{64}$/)
    expect(entries.map((e) => e.details)).toEqual([
      {
        ref: fingerprint("refs/heads/main"),
        commit: commit("c"),
        logged: commit("a"),
      },
      { ref: fingerprint("refs/heads/y"), commit: commit("d"), logged: null },
    ])
  })
})
