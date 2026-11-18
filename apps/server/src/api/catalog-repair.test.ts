import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type * as Api from "@shinan/api-client"
import { addMember, createWorkspace } from "@shinan/core"
import type { JobQueue, Person } from "@shinan/core"
import { storeCatalogRevision } from "@shinan/core/testing"
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

let owner: Person
let contributor: Person
let workspaceId: string

const musashi = (contact: string) => `---
id: machine/musashi
type: machine
title: Musashi
summary: The production host.
status: active
facts:
  - checked: 2026-11-14
    by: guneet
    scope: A look
    source: ssh musashi
    observed:
      hostname: musashi${contact}
---

# Musashi
`

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
  workspaceId = (await createWorkspace(ctx, { name: "Repair" })).workspace.id
  await addMember(ctx, {
    workspaceId,
    personId: contributor.id,
    role: "contributor",
  })
  await storeCatalogRevision(
    db,
    workspaceId,
    {
      kind: "person",
      personId: owner.id,
      agentId: null,
      agentSessionId: null,
      label: owner.handle,
      confidence: "recorded",
    },
    [
      {
        text: musashi("\n      contact: { to: machine/musashi, by: someone }"),
      },
    ],
  )
})

const repair = (
  body: Record<string, unknown>,
  who: Person = owner,
  reauthenticated = true,
) =>
  api.request(`/workspaces/${workspaceId}/catalog/proposals/repair`, {
    method: "POST",
    headers: {
      origin: "http://shinan.test",
      "content-type": "application/json",
      ...as(who, { reauthenticated }),
    },
    body: JSON.stringify({
      id: "machine/musashi",
      revision: 1,
      text: musashi(""),
      explanation: "Drop the unreadable contact fact.",
      ...body,
    }),
  })

describe("repairing a catalog document over the API", () => {
  it("is for workspace owners who signed in again recently", async () => {
    const contributorAnswer = await repair({}, contributor)
    expect(contributorAnswer.status).toBe(403)
    const stale = await repair({}, owner, false)
    expect(stale.status).toBe(403)
    expect(((await stale.json()) as Api.ErrorBody).error).toBe(
      "reauthentication-required",
    )
  })

  it("takes a whole document, larger than other requests, and applies it", async () => {
    // Over the 64 KB other requests may have, so its own limit applies; the
    // document's own size limit then refuses it as a proposal problem.
    const large = await repair({ text: musashi("") + "x".repeat(70 * 1024) })
    expect(large.status).toBe(200)
    expect(await large.json()).toMatchObject({ outcome: "invalid" })

    const answer = await repair({})
    expect(answer.status).toBe(200)
    expect(await answer.json()).toMatchObject({
      outcome: "applied",
      proposal: { appliedRevision: 2, decidedBy: owner.handle },
    })
    const entity = await api.request(
      `/workspaces/${workspaceId}/catalog/entity?id=machine/musashi`,
      { headers: { origin: "http://shinan.test", ...as(owner) } },
    )
    // The unreadable fact is gone; the missing owner, which the document
    // already lacked, may stay.
    expect(
      ((await entity.json()) as Api.CatalogEntityAnswer).entity.problems.map(
        (p) => p.code,
      ),
    ).toEqual(["field-missing"])
  })

  it("refuses characters PostgreSQL cannot store with 422", async () => {
    const answer = await repair({ explanation: "Fix \u0000 it." })
    expect(answer.status).toBe(422)
    expect(((await answer.json()) as Api.ErrorBody).rule).toBe(
      "text-characters",
    )
  })

  it("refuses a malformed body", async () => {
    const answer = await api.request(
      `/workspaces/${workspaceId}/catalog/proposals/repair`,
      {
        method: "POST",
        headers: {
          origin: "http://shinan.test",
          "content-type": "application/json",
          ...as(owner),
        },
        body: "[]",
      },
    )
    expect(answer.status).toBe(422)
  })
})
