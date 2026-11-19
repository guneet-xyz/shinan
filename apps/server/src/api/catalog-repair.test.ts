import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type * as Api from "@shinan/api-client"
import { addMember, createWorkspace } from "@shinan/core"
import type { JobQueue, Person } from "@shinan/core"
import { storeCatalogRevision } from "@shinan/core/testing"
import { connectTestDatabase } from "@shinan/db/testing"

import { insertPerson } from "../../test/people.js"
import { as, testSignIn } from "../../test/sign-in.js"
import { proposalInFlight } from "./catalog-proposals.js"
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
) => {
  const text = JSON.stringify({
    id: "machine/musashi",
    revision: 1,
    text: musashi(""),
    explanation: "Drop the unreadable contact fact.",
    ...body,
  })
  return api.request(`/workspaces/${workspaceId}/catalog/proposals/repair`, {
    method: "POST",
    headers: {
      origin: "http://shinan.test",
      "content-type": "application/json",
      // As browsers send it: the route refuses a body of undeclared size.
      "content-length": String(Buffer.byteLength(text)),
      ...as(who, { reauthenticated }),
    },
    body: text,
  })
}

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
          "content-length": "2",
          ...as(owner),
        },
        body: "[]",
      },
    )
    expect(answer.status).toBe(422)
  })
})

describe("repair requests: size and requests in flight", () => {
  const path = () => `/workspaces/${workspaceId}/catalog/proposals/repair`
  /** As if from this network address, as Node's socket gives it. */
  const from = (address: string) => ({
    incoming: { socket: { remoteAddress: address } },
  })

  it("refuses a body of undeclared size, as the proposal routes do", async () => {
    const response = await api.request(path(), {
      method: "POST",
      headers: {
        origin: "http://shinan.test",
        "content-type": "application/json",
        ...as(owner),
      },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("{}"))
          controller.close()
        },
      }),
      duplex: "half",
    })
    expect(response.status).toBe(411)
    expect(await response.json()).toMatchObject({ error: "length-required" })
  })

  it("lets one address have only a few at once, whoever sends them", async () => {
    const third = await insertPerson(db, "third")
    const open: ReadableStreamDefaultController<Uint8Array>[] = []
    const body = '{"id":"machine/musashi"}'
    const slow = async (who: Person, address: string) =>
      api.request(
        path(),
        {
          method: "POST",
          headers: {
            origin: "http://shinan.test",
            "content-type": "application/json",
            "content-length": String(body.length),
            ...as(who),
          },
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              open.push(controller)
              controller.enqueue(new TextEncoder().encode(body.slice(0, 10)))
            },
          }),
          duplex: "half",
        },
        from(address),
      )
    // Two people from one address, each below their own cap of 8.
    const half = proposalInFlight.perAddress / 2
    const held = [
      ...Array.from({ length: half }, () => slow(owner, "192.0.2.7")),
      ...Array.from({ length: half }, () => slow(contributor, "192.0.2.7")),
    ]
    await new Promise((resolve) => setTimeout(resolve, 100))
    // A third person, with room of their own, from the same address.
    const refused = await api.request(
      path(),
      {
        method: "POST",
        headers: {
          origin: "http://shinan.test",
          "content-type": "application/json",
          "content-length": "2",
          ...as(third),
        },
        body: "{}",
      },
      from("192.0.2.7"),
    )
    expect(refused.status).toBe(429)
    expect(refused.headers.get("retry-after")).toBe("1")
    // The same person from another address is not held up.
    const elsewhere = await api.request(
      path(),
      {
        method: "POST",
        headers: {
          origin: "http://shinan.test",
          "content-type": "application/json",
          "content-length": "2",
          ...as(third),
        },
        body: "{}",
      },
      from("198.51.100.7"),
    )
    expect(elsewhere.status).not.toBe(429)

    for (const controller of open) {
      controller.enqueue(new TextEncoder().encode(body.slice(10)))
      controller.close()
    }
    const answers = await Promise.all(held)
    expect(answers.every((r) => r.status !== 429)).toBe(true)
  })
})
