import { randomUUID } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  createGitClient,
  createWorkspace,
  getCatalogPageHistory,
  historyCursors,
  listCatalogChanges,
  rebuildCatalogIndex,
  shinan,
  storeCatalogJournal,
} from "@shinan/core"
import type {
  CatalogChangeJson,
  Context,
  GitClient,
  JournalEntry,
  Person,
} from "@shinan/core"
import { eq, schema } from "@shinan/db"
import { connectTestDatabase } from "@shinan/db/testing"
import { createGit } from "@shinan/git"
import { commitFiles } from "@shinan/git/testing"

import { insertPerson } from "../../test/people.js"
import { createGitApp } from "./app.js"
import { openJournal } from "./journal.js"
import { createRepositoryStore } from "./store.js"

// When changes reached `main`, as Shinan recorded it, against commits whose
// own dates an agent forged (2099 and 2010): the usual way a change reaches
// `main` (a branch, then a clean merge), a page's History, and paging one
// change at a time (review of #196).

const { db, pool } = connectTestDatabase()
const git = createGit()
const token = "service-token-for-tests-0123456789abcdef"
const cursors = historyCursors("test key")
const year2099 = 4_085_000_000
const year2010 = 1_270_000_000
let root: string
let hooks: string
let client: GitClient
let owner: Person
let ctx: Context
let workspaceId: string
const c: Record<string, string> = {}
/** When the push log recorded each push, a minute apart. */
const pushedAt = (minute: number) =>
  new Date(Date.UTC(2026, 10, 20, 12, minute)).toISOString()

const page = (id: string, text: string) => `---
id: ${id}
type: ${id.split("/")[0]}
title: ${id.split("/")[1]}
summary: ${text}
status: active
owner: person/guneet
---
`

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "shinan-catalog-arrivals-"))
  hooks = mkdtempSync(join(tmpdir(), "shinan-git-hooks-"))
  const store = createRepositoryStore({ root, git, hooksDirectory: hooks })
  const app = createGitApp({
    serviceToken: token,
    store,
    journal: openJournal(root),
    log: () => {},
  })
  client = createGitClient({
    url: "http://git.test",
    serviceToken: token,
    fetch: (input, init) =>
      Promise.resolve(app.fetch(new Request(input, init))),
  })
  owner = await insertPerson(db, "owner")
  ctx = { db, actor: { kind: "person", personId: owner.id } }
  workspaceId = (await createWorkspace(ctx, { name: "Forged" })).workspace.id
  await client.createRepository(workspaceId, {
    files: [{ path: "README.md", content: new TextEncoder().encode("# C\n") }],
    message: "Start the catalog\n",
  })
  const gitDir = store.pathOf(workspaceId)
  c.root = (await client.getRepository(workspaceId))!.main

  const base = {
    "README.md": "# C\n",
    "machine/a.md": page("machine/a", "A one."),
  }
  // On main, dated 2010.
  c.old = await commitFiles(
    git,
    gitDir,
    { ...base },
    { parents: [c.root], message: "Main: add A", time: year2010 },
  )
  // A branch editing A twice, dated 2099, then merged cleanly.
  const t1 = { ...base, "machine/a.md": page("machine/a", "A two.") }
  c.b1 = await commitFiles(git, gitDir, t1, {
    parents: [c.old],
    message: "Branch: A two",
    time: year2099,
  })
  const t2 = { ...base, "machine/a.md": page("machine/a", "A three.") }
  c.b2 = await commitFiles(git, gitDir, t2, {
    parents: [c.b1],
    message: "Branch: A three",
    time: year2099 + 60,
  })
  const t3 = { ...base, "machine/b.md": page("machine/b", "B.") }
  c.side = await commitFiles(git, gitDir, t3, {
    parents: [c.old],
    message: "Main: add B",
    time: year2010 + 60,
  })
  const t4 = { ...t3, "machine/a.md": page("machine/a", "A three.") }
  c.merge = await commitFiles(git, gitDir, t4, {
    parents: [c.side, c.b2],
    message: "Merge the branch (clean)",
    time: year2099 + 120,
  })
  // A commit with no record in the push log at all.
  c.unrecorded = await commitFiles(
    git,
    gitDir,
    { ...t4, "machine/a.md": page("machine/a", "A four.") },
    { parents: [c.merge], message: "Unrecorded: A four", time: year2010 + 120 },
  )
  await git.run(["update-ref", "refs/heads/main", c.unrecorded], { gitDir })
  await rebuildCatalogIndex({ db, actor: shinan }, { workspaceId }, client)

  // The push log, as the Git container's journal gives it: main moved to
  // `old`, then `side`; the branch pushed on its own; then the merge.
  const entries: JournalEntry[] = []
  const append = (kind: string, minute: number, data: object) =>
    entries.push({
      number: entries.length + 1,
      recordedAt: pushedAt(minute),
      kind,
      data: data as Record<string, unknown>,
    })
  const [member] = await db
    .select()
    .from(schema.members)
    .where(eq(schema.members.workspaceId, workspaceId))
  const [agent] = await db
    .insert(schema.agents)
    .values({
      workspaceId,
      memberId: member!.id,
      personId: owner.id,
      codingTool: "opencode",
      machine: "daedalus",
      handle: "opencode-daedalus",
      name: "OpenCode on Daedalus",
    })
    .returning()
  const agentId = agent!.id
  const push = (
    minute: number,
    ref: string,
    from: string | null,
    to: string,
    first: string[],
    added: string[] | null,
  ) => {
    const id = randomUUID()
    append("push.checked", minute, {
      push: id,
      workspaceId,
      agent: { id: agentId, handle: "opencode-daedalus" },
      person: { id: owner.id, handle: owner.handle },
      memberId: member!.id,
      tokenId: null,
      networkAddress: null,
      by: `${owner.handle} via opencode-daedalus`,
      outcome: "accepted",
      codes: [],
      warnings: 0,
      secrets: 0,
      refs: [{ ref, old: from, new: to, kind: from ? "update" : "create" }],
      receivedBytes: 1,
      receivedObjects: 1,
      newCommits: first.length,
    })
    append("push.confirmed", minute, {
      push: id,
      workspaceId,
      confirmed: [0],
      firstPushes: first.map((commit) => ({ commit, ref })),
      main: added && {
        from,
        to,
        commits: added.length,
        added,
        documents: [],
        documentsTruncated: false,
      },
    })
  }
  append("repository.created", 0, { workspaceId, commit: c.root })
  push(1, "refs/heads/main", c.root, c.old, [c.old], [c.old])
  push(2, "refs/heads/main", c.old, c.side, [c.side], [c.side])
  push(3, "refs/heads/branch", null, c.b2, [c.b1, c.b2], null)
  push(5, "refs/heads/main", c.side, c.merge, [c.merge], [c.merge, c.b2, c.b1])
  const journal = {
    readJournal: ({ after }: { after: number }) =>
      Promise.resolve({
        journalId: randomUUID(),
        entries: entries.filter((e) => e.number > after),
        last: entries.length,
      }),
    acknowledgeJournal: () => Promise.resolve({ deleted: 0 }),
  } as unknown as GitClient
  const stored = await storeCatalogJournal(
    { db, actor: shinan, jobs: { send: () => Promise.resolve(null) } },
    journal,
  )
  expect(stored).toMatchObject({ stored: entries.length })
})

afterAll(async () => {
  await pool.end()
  rmSync(root, { recursive: true, force: true })
  rmSync(hooks, { recursive: true, force: true })
})

/** Each change's subject, time and where its time came from. */
const times = (changes: CatalogChangeJson[]) =>
  Object.fromEntries(
    changes.map((ch) => [ch.subject, [ch.time, ch.time_source]]),
  )

const expected = () => ({
  "Unrecorded: A four": [
    new Date((year2010 + 120) * 1000).toISOString(),
    "commit",
  ],
  "Branch: A three": [pushedAt(5), "main"],
  "Branch: A two": [pushedAt(5), "main"],
  "Main: add B": [pushedAt(2), "main"],
  "Main: add A": [pushedAt(1), "main"],
  "Start the catalog": [pushedAt(0), "main"],
})

describe("when changes reached main, against forged dates", () => {
  it.each([30, 1])(
    "in Recent changes, a branch's commits reached main with its clean merge, %i at a time",
    async (limit) => {
      const listed: CatalogChangeJson[] = []
      let after: string | undefined
      do {
        const answer = await listCatalogChanges(
          ctx,
          client,
          workspaceId,
          { after, limit },
          cursors,
        )
        listed.push(...answer.changes)
        after = answer.next_after ?? undefined
      } while (after)
      // The clean merge is left out; its commits keep its time.
      expect(listed.map((ch) => ch.subject)).not.toContain(
        "Merge the branch (clean)",
      )
      expect(times(listed)).toEqual(expected())
    },
  )

  it.each([50, 1])(
    "in a page's History, without the merge in the list, %i at a time",
    async (limit) => {
      const listed: CatalogChangeJson[] = []
      let after: string | undefined
      do {
        const answer = await getCatalogPageHistory(
          ctx,
          client,
          workspaceId,
          { id: "machine/a", after, limit },
          cursors,
        )
        listed.push(...answer.changes)
        after = answer.next_after ?? undefined
      } while (after)
      // Not machine/a's: the side commit and the first.
      const rest: Record<string, unknown> = expected()
      delete rest["Main: add B"]
      delete rest["Start the catalog"]
      expect(times(listed)).toEqual(rest)
    },
  )
})
