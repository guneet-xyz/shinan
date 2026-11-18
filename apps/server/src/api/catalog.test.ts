import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type * as Api from "@shinan/api-client"
import { createWorkspace } from "@shinan/core"
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

const person = (handle: string) => `---
id: person/${handle}
type: person
title: ${handle}
summary: A member.
status: active
owner: person/${handle}
---
`

const musashi = `---
id: machine/musashi
type: machine
title: Musashi
summary: Azure VM that runs the shared production stacks.
status: active
owner: person/guneet
aliases: [machine/old-musashi]
facts:
  - checked: 2026-11-14
    by: guneet
    scope: df -h
    source: Read-only SSH
    observed:
      disk.data.free: 74 GiB
  - unknown:
      network.public_ipv6: Reachability not tested
---

# Musashi

Runs the [registry](service/registry).
`

const registry = `---
id: service/registry
type: service
title: Container registry
summary: Images.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-14
    by: guneet
    scope: Compose file
    source: https://git.guneet.dev/infra/musashi
    intended:
      runs-on: machine/musashi
---
`

const startHere = `---
id: start-here
title: Start here
people:
  - to: machine/musashi
    note: The production host.
agents:
  - list: discrepancies
    note: Look here first.
---
`

let owner: Person
let outsider: Person
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
  outsider = await insertPerson(db, "outsider")
  const created = await createWorkspace(
    { db, actor: { kind: "person", personId: owner.id } },
    { name: "Wiki" },
  )
  workspaceId = created.workspace.id
  await storeCatalogRevision(
    db,
    workspaceId,
    actor(owner),
    [person("guneet"), musashi, registry, startHere].map((text) => ({ text })),
  )
})

const ws = (path: string) => `/workspaces/${workspaceId}/catalog${path}`

async function get<T>(path: string, who: Person = owner) {
  const response = await api.request(path, {
    headers: { origin: "http://shinan.test", ...as(who) },
  })
  return { status: response.status, body: (await response.json()) as T }
}

describe("the catalog for the wiki", () => {
  it("reads an entity, also by a former ID", async () => {
    const { status, body } = await get<Api.CatalogEntityAnswer>(
      ws("/entity?id=machine/old-musashi"),
    )
    expect(status).toBe(200)
    expect(body).toMatchObject({
      catalog_revision: 1,
      index_behind: false,
      entity: { id: "machine/musashi", title: "Musashi" },
    })
    expect(body.entity.relations.incoming.map((r) => r.from.id)).toContain(
      "service/registry",
    )
  })

  it("reads types, a type's index, search, lists, changes and start here", async () => {
    const types = await get<Api.CatalogTypeSchemasAnswer>(ws("/types"))
    expect(types.body.items.map((t) => t.type)).toContain("machine")
    const type = await get<Api.CatalogTypeSchemaAnswer>(ws("/types/machine"))
    expect(type.body.schema.type).toBe("machine")
    const index = await get<Api.CatalogTypeIndexAnswer>(
      ws("/types/machine/entities"),
    )
    expect(index.body.items).toEqual([
      {
        entity: expect.objectContaining({ id: "machine/musashi" }) as unknown,
        freshness: expect.objectContaining({ facts: 2, unknown: 1 }) as unknown,
      },
    ])
    const found = await get<Api.CatalogSearchAnswer>(
      ws("/search?text=registry"),
    )
    expect(found.body.items.map((i) => i.entity.id)).toContain(
      "service/registry",
    )
    const unknowns = await get<Api.CatalogListAnswer>(
      ws("/lists/known-unknowns"),
    )
    expect(unknowns.body.items).toHaveLength(1)
    const changes = await get<Api.CatalogChangesAnswer>(ws("/changes"))
    expect(changes.body.items.map((i) => i.revision)).toEqual([1])
    const people = await get<Api.StartHereAnswer>(ws("/start-here?path=people"))
    expect(people.body.start_here?.steps).toEqual([
      {
        to: "machine/musashi",
        note: "The production host.",
        entity: expect.objectContaining({ title: "Musashi" }) as unknown,
      },
    ])
    // What an agent is given: compact JSON, with trust labels.
    const preview = await get<Api.AgentStartHerePreviewAnswer>(
      ws("/start-here/agent-preview"),
    )
    expect(preview.body.start_here).toMatchObject({
      path: "agents",
      label: { author_kind: "member", instruction: "no" },
      steps: [
        {
          list: "discrepancies",
          note: "Look here first.",
          label: { author_kind: "member" },
        },
      ],
    })
    expect(preview.body.text).toBe(JSON.stringify(preview.body.start_here))
    expect(preview.body.bytes).toBe(preview.body.text!.length)
    expect((await get(ws("/start-here/agent-preview"), outsider)).status).toBe(
      404,
    )
  })

  it("reads a page's history and its text at a revision", async () => {
    const history = await get<Api.CatalogHistoryAnswer>(
      ws("/history?id=machine/musashi"),
    )
    expect(history.body.items).toEqual([
      expect.objectContaining({ revision: 1, changed_by: owner.handle }),
    ])
    const text = await get<Api.CatalogDocumentTextAnswer>(
      ws("/text?id=machine/musashi&revision=1"),
    )
    expect(text.body.text).toBe(musashi)
  })

  it("records the pages a person opened", async () => {
    const before = await get<{ items: Api.CatalogPageOpened[] }>(
      ws("/opened?id=machine/musashi&id=service/registry"),
    )
    expect(before.body.items.map((i) => i.opened_revision)).toEqual([
      null,
      null,
    ])
    const opened = await api.request(ws("/opened"), {
      method: "POST",
      headers: {
        origin: "http://shinan.test",
        "content-type": "application/json",
        ...as(owner),
      },
      body: JSON.stringify({ id: "machine/musashi" }),
    })
    expect(opened.status).toBe(204)
    const after = await get<{ items: Api.CatalogPageOpened[] }>(
      ws("/opened?id=machine/musashi"),
    )
    expect(after.body.items[0]).toMatchObject({ opened_revision: 1 })
  })

  it("refuses bad input, other workspaces' members, and no sign-in", async () => {
    expect((await get(ws("/entity"))).status).toBe(422)
    expect((await get(ws("/lists/everything"))).status).toBe(422)
    expect((await get(ws("/history?id=machine/musashi&before=x"))).status).toBe(
      422,
    )
    expect((await get(ws("/entity?id=machine/nowhere"))).status).toBe(404)
    expect((await get(ws("/entity?id=machine/musashi"), outsider)).status).toBe(
      404,
    )
    const anonymous = await api.request(ws("/entity?id=machine/musashi"), {
      headers: { origin: "http://shinan.test" },
    })
    expect(anonymous.status).toBe(401)
  })
})
