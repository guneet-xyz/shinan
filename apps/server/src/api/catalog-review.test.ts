import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type * as Api from "@shinan/api-client"
import { createWorkspace, proposeCatalogChange } from "@shinan/core"
import type { JobQueue, Person } from "@shinan/core"
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
let outsider: Person
let workspaceId: string
let renamed: Api.CatalogProposal

beforeAll(async () => {
  owner = await insertPerson(db, "owner")
  outsider = await insertPerson(db, "outsider")
  const ctx = { db, actor: { kind: "person" as const, personId: owner.id } }
  workspaceId = (await createWorkspace(ctx, { name: "Review" })).workspace.id
  const person = `person/${owner.handle}`
  await proposeCatalogChange(ctx, workspaceId, {
    explanation: "Seed.",
    operations: [
      {
        op: "create-entity",
        id: person,
        title: "Owner",
        summary: "Owns it.",
        owner: person,
      },
      {
        op: "create-entity",
        id: "machine/musashi",
        title: "Musashi",
        summary: "A host.",
        owner: person,
      },
    ],
  })
  const outcome = await proposeCatalogChange(ctx, workspaceId, {
    explanation: "Rename.",
    operations: [
      {
        op: "set-field",
        document: "machine/musashi",
        field: "title",
        value: "Musashi I",
        expect: { value: "Musashi" },
      },
    ],
  })
  if (!("proposal" in outcome)) throw new Error(outcome.outcome)
  renamed = JSON.parse(JSON.stringify(outcome.proposal)) as Api.CatalogProposal
})

const ws = (path: string) => `/workspaces/${workspaceId}/catalog${path}`

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  who: Person = owner,
  options: { reauthenticated?: boolean } = {},
) {
  const response = await api.request(path, {
    method,
    headers: {
      origin: "http://shinan.test",
      ...as(who, options),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, body: (await response.json()) as T }
}

describe("catalog review over the API", () => {
  it("reads and changes the strict setting", async () => {
    expect(await call("GET", ws("/settings"))).toEqual({
      status: 200,
      body: { strict: false },
    })
    expect(
      (
        await call("PATCH", ws("/settings"), { strict: true }, owner, {
          reauthenticated: false,
        })
      ).status,
    ).toBe(403)
    expect(await call("PATCH", ws("/settings"), { strict: true })).toEqual({
      status: 200,
      body: { strict: true },
    })
    expect(
      (await call("PATCH", ws("/settings"), { strict: "yes" })).status,
    ).toBe(422)
    await call("PATCH", ws("/settings"), { strict: false })
  })

  it("adds and lists comments", async () => {
    const added = await call<Api.CatalogProposalComment>(
      "POST",
      ws(`/proposals/${renamed.id}/comments`),
      { text: "Looks right." },
    )
    expect(added).toMatchObject({
      status: 201,
      body: { text: "Looks right.", author: { kind: "person" } },
    })
    const listed = await call<{ items: Api.CatalogProposalComment[] }>(
      "GET",
      ws(`/proposals/${renamed.id}/comments`),
    )
    expect(listed.body.items.map((c) => c.text)).toEqual(["Looks right."])
    // A page at a time.
    await call("POST", ws(`/proposals/${renamed.id}/comments`), {
      text: "And again.",
    })
    const page = await call<{
      items: Api.CatalogProposalComment[]
      nextCursor: string | null
      total: number
    }>("GET", ws(`/proposals/${renamed.id}/comments?limit=1`))
    expect(page.body).toMatchObject({
      items: [{ text: "Looks right." }],
      nextCursor: listed.body.items[0]!.id,
      total: 2,
    })
    expect(
      (
        await call(
          "GET",
          ws(
            `/proposals/${renamed.id}/comments?cursor=${page.body.nextCursor}`,
          ),
        )
      ).body,
    ).toMatchObject({ items: [{ text: "And again." }], nextCursor: null })
    // Text PostgreSQL cannot store is invalid input, not an error.
    expect(
      await call("POST", ws(`/proposals/${renamed.id}/comments`), {
        text: "Nul\u0000here",
      }),
    ).toMatchObject({ status: 422, body: { rule: "text-characters" } })
    expect(
      (
        await call(
          "GET",
          ws(`/proposals/${renamed.id}/comments`),
          undefined,
          outsider,
        )
      ).status,
    ).toBe(404)
  })

  it("lists recent changes, reverts one, and approves in bulk", async () => {
    const feed = await call<Api.RecentCatalogChanges>(
      "GET",
      ws("/recent-changes?approval=any"),
    )
    expect(feed.body.items.map((i) => [i.proposal.id, i.revertible])).toEqual([
      [renamed.id, true],
      [expect.any(String), false],
    ])
    const revert = await call<Api.CatalogProposalOutcome>(
      "POST",
      ws(`/proposals/${renamed.id}/revert`),
    )
    expect(revert).toMatchObject({
      status: 200,
      body: { outcome: "applied", proposal: { revertsProposalId: renamed.id } },
    })
    expect(
      (await call("GET", ws("/recent-changes?approval=maybe"))).status,
    ).toBe(422)
    const bulk = await call<{ results: Api.CatalogBulkApprovalResult[] }>(
      "POST",
      ws("/proposals/bulk-approve"),
      { relatedTask: "SHN-1", seenUpTo: 10 },
    )
    expect(bulk).toEqual({ status: 200, body: { results: [] } })
    // A task needs the highest proposal number the person saw.
    for (const body of [{}, { relatedTask: "SHN-1" }])
      expect(
        (await call("POST", ws("/proposals/bulk-approve"), body)).status,
      ).toBe(422)
    const rejected = await call<{
      results: Api.CatalogBulkRejectionResult[]
    }>("POST", ws("/proposals/bulk-reject"), {
      proposalIds: [renamed.id],
      reason: "Not now.",
    })
    expect(rejected.body.results).toMatchObject([
      {
        proposalId: renamed.id,
        outcome: "refused",
        rule: "proposal-not-pending",
      },
    ])
  })
})
