import { randomBytes } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type * as Api from "@shinan/api-client"
import { addMember, createWorkspace } from "@shinan/core"
import type { JobQueue, Person } from "@shinan/core"
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
const api = createApi({
  db,
  signIn: testSignIn,
  jobs,
  installationUrl: "http://shinan.test",
  rateLimit: false,
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
  // Since the move into Git (GC-6), a purge rewrites events in
  // PostgreSQL; GC-8 adds the repository's history.
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
      revisionTexts: 0,
      documents: 0,
      latestDocuments: [],
      proposals: 0,
      waitingProposals: 0,
      events: 1,
      comments: 0,
      acrossLines: { revisionTexts: 0, latestDocuments: [] },
      alsoWrittenAs: [],
      structure: [],
    })

    const purged = await call<Api.CatalogPurge>("POST", ws("/purge"), {
      body: { text: secret, reason: "A passphrase leaked." },
    })
    expect(purged.status).toBe(200)
    expect(purged.text).not.toContain(secret)
    expect(purged.body).toMatchObject({
      number: 1,
      purgedBy: owner.handle,
      reason: "A passphrase leaked.",
      revision: null,
      counts: { revisionTexts: 0, documents: 0, latestDocuments: 0, events: 1 },
    })

    const purges = await call<Api.CatalogPurge[]>("GET", ws("/purges"), {
      who: contributor,
    })
    const { newProblems, ...listed } = purged.body
    expect(newProblems).toEqual([])
    expect(purges.body).toEqual([listed])

    const again = await call<Api.ErrorBody>("POST", ws("/purge"), {
      body: { text: secret, reason: "Again." },
    })
    expect(again.status).toBe(409)
    expect(again.body.rule).toBe("nothing-to-purge")
  })
})
