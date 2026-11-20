import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type * as Api from "@shinan/api-client"
import { createWorkspace } from "@shinan/core"
import type { JobQueue, Person } from "@shinan/core"
import { catalogTestGit, pushCatalogFiles } from "@shinan/core/testing"
import { connectTestDatabase } from "@shinan/db/testing"

import { insertPerson } from "../../test/people.js"
import { as, testSignIn } from "../../test/sign-in.js"
import { createApi } from "./routes.js"

const { db, pool } = connectTestDatabase()

afterAll(async () => {
  await pool.end()
})

const jobs: JobQueue = { send: () => Promise.resolve(null) }
const options = {
  db,
  signIn: testSignIn,
  jobs,
  installationUrl: "http://shinan.test",
  rateLimit: false,
}
const api = createApi({ ...options, gitClient: catalogTestGit })
/** `web` without the Git container: what reads the repository is unavailable. */
const withoutGit = createApi(options)

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

let commit: string

beforeAll(async () => {
  owner = await insertPerson(db, "owner")
  outsider = await insertPerson(db, "outsider")
  const created = await createWorkspace(
    { db, actor: { kind: "person", personId: owner.id } },
    { name: "Wiki" },
  )
  workspaceId = created.workspace.id
  commit = await pushCatalogFiles(db, workspaceId, {
    "person/guneet.md": person("guneet"),
    "machine/musashi.md": musashi,
    "service/registry.md": registry,
    "start-here.md": startHere,
  })
})

const ws = (path: string) => `/workspaces/${workspaceId}/catalog${path}`

async function get<T>(path: string, who: Person = owner) {
  const response = await api.request(path, {
    headers: { origin: "http://shinan.test", ...as(who) },
  })
  return { status: response.status, body: (await response.json()) as T }
}

describe("the catalog for the catalog pages", () => {
  it("reads an entity, also by a former ID", async () => {
    const { status, body } = await get<Api.CatalogEntityAnswer>(
      ws("/entity?id=machine/old-musashi"),
    )
    expect(status).toBe(200)
    expect(body).toMatchObject({
      catalog_commit: commit,
      index_behind: false,
      entity: {
        id: "machine/musashi",
        title: "Musashi",
        path: "machine/musashi.md",
      },
    })
    expect(body.entity.relations.incoming.map((r) => r.from.id)).toContain(
      "service/registry",
    )
  })

  it("reads the start-here and type schema documents as pages", async () => {
    const { status, body } = await get<Api.CatalogDocumentAnswer>(
      ws("/document?id=start-here"),
    )
    expect(status).toBe(200)
    expect(body.document).toMatchObject({
      id: "start-here",
      kind: "start-here",
      title: "Start here",
    })
    expect((await get(ws("/document?id=machine/musashi"))).status).toBe(404)
    expect((await get(ws("/document"))).status).toBe(422)
    expect((await get(ws("/document?id=start-here"), outsider)).status).toBe(
      404,
    )
  })

  it("reads a page's history and source, and the README, from the repository", async () => {
    const history = await get<Api.CatalogHistoryAnswer>(
      ws("/history?id=machine/musashi&limit=1"),
    )
    expect(history.status).toBe(200)
    expect(history.body).toMatchObject({
      catalog_commit: commit,
      path: "machine/musashi.md",
      title: "Musashi",
      next_after: null,
    })
    expect(history.body.changes).toEqual([
      expect.objectContaining({ commit, merge: false, pushed_by: null }),
    ])
    expect(
      (await get(ws("/history?id=machine/musashi&after=main"))).status,
    ).toBe(422)
    expect((await get(ws("/history?id=machine/musashi&limit=0"))).status).toBe(
      422,
    )

    const source = await get<Api.CatalogSourceAnswer>(
      ws("/source?id=machine/musashi"),
    )
    expect(source.status).toBe(200)
    expect(source.body.source).toEqual({
      path: "machine/musashi.md",
      text: musashi,
      size: musashi.length,
    })

    const readme = await get<Api.CatalogReadmeAnswer>(ws("/readme"))
    expect(readme.body.readme).toMatchObject({
      path: "README.md",
      text: "# Catalog\n",
    })

    for (const path of [
      "/history?id=machine/musashi",
      "/source?id=machine/musashi",
      "/readme",
    ])
      expect((await get(ws(path), outsider)).status).toBe(404)
  })

  it("says the repository can't be read right now without the Git container", async () => {
    const response = await withoutGit.request(
      ws("/history?id=machine/musashi"),
      { headers: { origin: "http://shinan.test", ...as(owner) } },
    )
    expect(response.status).toBe(503)
    expect(response.headers.get("retry-after")).toBe("30")
    expect(await response.json()).toMatchObject({ error: "unavailable" })
  })

  it("reads the tree for the sidebar", async () => {
    const { status, body } = await get<Api.CatalogTreeAnswer>(ws("/tree"))
    expect(status).toBe(200)
    expect(body).toMatchObject({ catalog_commit: commit, index_behind: false })
    expect(body.items.map((i) => [i.path, i.title])).toEqual([
      ["machine/musashi.md", "Musashi"],
      ["person/guneet.md", "guneet"],
      ["service/registry.md", "Container registry"],
    ])
    expect(body.attention).toBe(1)
    expect((await get(ws("/tree"), outsider)).status).toBe(404)
  })

  it("compresses the tree for a browser that accepts it", async () => {
    const response = await api.request(ws("/tree"), {
      headers: {
        origin: "http://shinan.test",
        "accept-encoding": "gzip, br",
        ...as(owner),
      },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("content-encoding")).toBe("gzip")
    const text = await new Response(
      response.body!.pipeThrough(new DecompressionStream("gzip")),
    ).text()
    expect(JSON.parse(text)).toMatchObject({ catalog_commit: commit })
  })

  it("gives where the catalog stands without its tree", async () => {
    const { status, body } = await get<Api.CatalogAnswer>(ws("/state"))
    expect(status).toBe(200)
    expect(body).toEqual({ catalog_commit: commit, index_behind: false })
    expect((await get(ws("/state"), outsider)).status).toBe(404)
  })

  it("reads types, a type's index, search, lists and start here", async () => {
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
    const people = await get<Api.StartHereAnswer>(ws("/start-here?path=people"))
    expect(people.body.start_here?.steps).toEqual([
      {
        to: "machine/musashi",
        note: "The production host.",
        entity: expect.objectContaining({ title: "Musashi" }) as unknown,
      },
    ])
    // "Preview as agent", "opened" markers and the editable form are gone
    // with M2's wiki editing (Git-based catalog plan §1.2); revision
    // history, earlier text and changes since a revision with M2's revision
    // store (GC-4); a page's history now comes from the repository.
    for (const path of [
      "/start-here/agent-preview",
      "/opened?id=machine/musashi",
      "/editable?id=machine/musashi",
      "/changes",
      "/text?id=machine/musashi&revision=1",
    ])
      expect((await get(ws(path))).status, path).toBe(404)
  })

  it("refuses bad input, other workspaces' members, and no sign-in", async () => {
    expect((await get(ws("/entity"))).status).toBe(422)
    expect((await get(ws("/lists/everything"))).status).toBe(422)
    expect((await get(ws("/search?text=x&limit=y"))).status).toBe(422)
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
