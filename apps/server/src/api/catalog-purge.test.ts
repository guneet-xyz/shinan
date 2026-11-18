import { randomBytes } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type * as Api from "@shinan/api-client"
import { addMember, createWorkspace, purgeMarker } from "@shinan/core"
import type { JobQueue, Person } from "@shinan/core"
import { storeCatalogRevision } from "@shinan/core/testing"
import type { RevisionActor } from "@shinan/core/testing"
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

const musashi = (body: string) => `---
id: machine/musashi
type: machine
title: Musashi
summary: The production host.
status: active
---

${body}
`

let owner: Person
let contributor: Person
let workspaceId: string

const actor = (p: Person): RevisionActor => ({
  kind: "person",
  personId: p.id,
  agentId: null,
  agentSessionId: null,
  label: p.handle,
  confidence: "recorded",
})

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
  const { documentIds } = await storeCatalogRevision(
    db,
    workspaceId,
    actor(owner),
    [{ text: musashi(`The passphrase is ${secret}.`) }],
  )
  await storeCatalogRevision(db, workspaceId, actor(owner), [
    { documentId: documentIds[0]!, text: musashi("Ask the owner.") },
  ])
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

  it("previews and purges, and earlier text then shows the marker", async () => {
    const preview = await call<Api.CatalogPurgePreview>(
      "POST",
      ws("/purge/preview"),
      { body: { text: secret } },
    )
    expect(preview.status).toBe(200)
    expect(preview.body).toEqual({
      revisionTexts: 1,
      documents: 1,
      latestDocuments: [],
      proposals: 0,
      waitingProposals: 0,
      events: 0,
      writtenDifferently: [],
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
      counts: { revisionTexts: 1, documents: 1, latestDocuments: 0 },
    })

    // The wiki's history comparison reads the earlier text: it has the
    // marker, not the purged text.
    const earlier = await call<Api.CatalogDocumentTextAnswer>(
      "GET",
      ws("/text?id=machine/musashi&revision=1"),
    )
    expect(earlier.body.text).toContain(`The passphrase is ${purgeMarker}.`)
    expect(earlier.text).not.toContain(secret)

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
