import { randomBytes } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type * as Api from "@shinan/api-client"
import { addMember, createWorkspace, purgeFollowing } from "@shinan/core"
import type { GitClient, JobQueue, Person } from "@shinan/core"
import { schema } from "@shinan/db"
import { connectTestDatabase } from "@shinan/db/testing"

import { insertPerson } from "../../test/people.js"
import { as, testSignIn } from "../../test/sign-in.js"
import { createApi } from "./routes.js"

const { db, pool } = connectTestDatabase()

afterAll(async () => {
  await pool.end()
})

const jobs: JobQueue = { send: () => Promise.resolve(null) }
// The Git container's part, as when the history holds no copy: tested
// against real Git in `git/purge.test.ts`.
const history = {
  commits: { main: 0, branches: 0 },
  files: { main: 0, branches: 0 },
  messages: { main: 0, branches: 0 },
  branchNames: 0,
  currentFiles: [],
  currentFilesMore: 0,
  acrossLines: 0,
  structure: [],
  alsoWrittenAs: [],
  mayAppearEncoded: [],
  journalEntries: 0,
}
const gitClient = {
  previewPurge: () => Promise.resolve(history),
  startPurge: (_: string, input: { purgeId: string }) =>
    Promise.resolve({ purgeId: input.purgeId, state: "running" }),
  purgeStatus: (_: string, purgeId: string) =>
    Promise.resolve({
      purgeId,
      state: "done",
      result: {
        purgeId,
        rewritten: false,
        commits: 0,
        rewrittenCommits: 0,
        removedCommits: 0,
        files: 0,
        messages: 0,
        renamedBranches: 0,
        journalEntries: 0,
      },
    }),
  isPurgeText: () => Promise.resolve(false),
  readJournal: () =>
    Promise.resolve({
      journalId: "0b6a3a52-6e3f-4cf1-9a11-6a1c6a7d2f01",
      entries: [],
      last: 0,
    }),
} as unknown as GitClient
const api = createApi({
  db,
  signIn: testSignIn,
  jobs,
  installationUrl: "http://shinan.test",
  rateLimit: false,
  gitClient,
})

const secret = `plum-otter-${randomBytes(4).toString("hex")}-lantern`

let owner: Person
let contributor: Person
let workspaceId: string

beforeAll(async () => {
  owner = await insertPerson(db, "owner")
  contributor = await insertPerson(db, "contributor")
  const ctx = {
    db,
    actor: {
      kind: "person" as const,
      personId: owner.id,
      reauthenticated: true,
    },
  }
  const created = await createWorkspace(ctx, { name: "Purge" })
  workspaceId = created.workspace.id
  await addMember(ctx, {
    workspaceId,
    personId: contributor.id,
    role: "contributor",
  })
  // Since the move into Git (GC-6), a purge rewrites events (among other
  // records) in PostgreSQL, and the Git container the history (GC-8).
  await db.insert(schema.events).values({
    workspaceId,
    kind: "catalog.pushed",
    origin: "git_push",
    actorKind: "person",
    actorPersonId: owner.id,
    actorLabel: owner.handle,
    confidence: "recorded",
    summary: `${owner.handle} pushed: the passphrase is ${secret}`,
  })
})

const ws = (path: string) => `/workspaces/${workspaceId}/catalog${path}`

async function call<T>(
  method: "GET" | "POST",
  path: string,
  options: { who?: Person; reauthenticated?: boolean; body?: unknown } = {},
) {
  const response = await api.request(path, {
    method,
    headers: {
      origin: "http://shinan.test",
      "content-type": "application/json",
      ...as(options.who ?? owner, {
        reauthenticated: options.reauthenticated ?? true,
      }),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  })
  const text = await response.text()
  return { status: response.status, text, body: JSON.parse(text) as T }
}

purgeFollowing.intervalMs = 5

/** Asks how a removal stands until it is no longer running. */
async function until(id: string): Promise<Api.CatalogPurgeStatus> {
  for (;;) {
    const status = await call<Api.CatalogPurgeStatus>(
      "GET",
      ws(`/purges/${id}`),
      { who: contributor },
    )
    expect(status.status).toBe(200)
    if (status.body.state !== "running") return status.body
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe("catalog purge over the API", () => {
  it("is for workspace owners who signed in again recently", async () => {
    const preview = { body: { text: secret } }
    expect(
      (
        await call("POST", ws("/purge/preview"), {
          ...preview,
          who: contributor,
        })
      ).status,
    ).toBe(403)
    const stale = await call<Api.ErrorBody>("POST", ws("/purge/preview"), {
      ...preview,
      reauthenticated: false,
    })
    expect(stale.status).toBe(403)
    expect(stale.body.error).toBe("reauthentication-required")
    const blank = await call<Api.ErrorBody>("POST", ws("/purge"), {
      body: { text: secret },
    })
    expect(blank.status).toBe(422)
    expect(blank.body.rule).toBe("reason-blank")
    expect(blank.text).not.toContain(secret)
  })

  it("previews and purges, never repeating the text", async () => {
    const preview = await call<Api.CatalogPurgePreview>(
      "POST",
      ws("/purge/preview"),
      { body: { text: secret } },
    )
    expect(preview.status).toBe(200)
    expect(preview.body).toEqual({
      history,
      pushLog: 0,
      events: 1,
      indexDocuments: 0,
      moves: 0,
      acrossLines: 0,
      alsoWrittenAs: [],
      mayAppearEncoded: [],
      unfinished: 0,
      finishesUnfinished: false,
    })

    // A job: answered `running` at once, then followed by its status.
    const started = await call<Api.CatalogPurgeStatus>("POST", ws("/purge"), {
      body: { text: secret, reason: "A passphrase leaked." },
    })
    expect(started.status).toBe(202)
    expect(started.body.state).toBe("running")
    expect(started.text).not.toContain(secret)
    const purged = { body: (await until(started.body.id)).purge! }
    expect(purged.body).toMatchObject({
      number: 1,
      purgedBy: owner.handle,
      reason: "A passphrase leaked.",
      counts: { revisionTexts: 0, documents: 0, latestDocuments: 0, events: 1 },
    })

    const purges = await call<Api.CatalogPurge[]>("GET", ws("/purges"), {
      who: contributor,
    })
    expect(purges.body).toEqual([purged.body])

    const again = await call<Api.CatalogPurgeStatus>("POST", ws("/purge"), {
      body: { text: secret, reason: "Again." },
    })
    expect(await until(again.body.id)).toMatchObject({
      state: "failed",
      rule: "nothing-to-purge",
    })
  })
})
