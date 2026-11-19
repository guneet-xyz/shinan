import type { Hono, Context as HonoContext } from "hono"

import type * as Api from "@shinan/api-client"
import {
  catalogLists,
  getAgentStartHerePreview,
  getCatalogChanges,
  getCatalogDocumentText,
  getCatalogEntity,
  getCatalogList,
  getCatalogStartHere,
  getCatalogTypeSchema,
  listCatalogHistory,
  listCatalogPagesOpened,
  listCatalogPurges,
  listCatalogTypeIndex,
  listCatalogTypeSchemas,
  previewCatalogPurge,
  purgeCatalogText,
  recordCatalogPageOpened,
  searchCatalog,
} from "@shinan/core"
import type {
  CatalogList,
  CatalogPurge,
  Context,
  EntityStatus,
} from "@shinan/core"

import { BadRequestError } from "./errors.js"
import type { SignedInEnv } from "./sign-in.js"

/**
 * The catalog for the wiki (human experience, the wiki; build plan M2-7):
 * the agent index's queries, a page's history and earlier text, and the
 * person's own "opened" records. Every answer is core's, in the agent
 * index's JSON format; handlers only read the request.
 */
export function catalogRoutes(
  app: Hono<SignedInEnv>,
  ctx: (c: HonoContext<SignedInEnv>) => Context,
): void {
  const base = "/workspaces/:workspaceId/catalog"
  const workspaceId = (c: HonoContext<SignedInEnv>) =>
    c.req.param("workspaceId")!

  app.get(`${base}/entity`, async (c) => {
    const answer: Api.CatalogEntityAnswer = await getCatalogEntity(
      ctx(c),
      workspaceId(c),
      { id: requiredQuery(c, "id") },
    )
    return c.json(answer)
  })

  app.get(`${base}/types`, async (c) => {
    const answer: Api.CatalogTypeSchemasAnswer = await listCatalogTypeSchemas(
      ctx(c),
      workspaceId(c),
    )
    return c.json(answer)
  })

  app.get(`${base}/types/:type`, async (c) => {
    const answer: Api.CatalogTypeSchemaAnswer = await getCatalogTypeSchema(
      ctx(c),
      workspaceId(c),
      { type: c.req.param("type") },
    )
    return c.json(answer)
  })

  app.get(`${base}/types/:type/entities`, async (c) => {
    const answer: Api.CatalogTypeIndexAnswer = await listCatalogTypeIndex(
      ctx(c),
      workspaceId(c),
      {
        type: c.req.param("type"),
        ...statusQuery(c),
      },
    )
    return c.json(answer)
  })

  app.get(`${base}/search`, async (c) => {
    const type = c.req.query("type")
    const limit = integerQuery(c, "limit")
    const answer: Api.CatalogSearchAnswer = await searchCatalog(
      ctx(c),
      workspaceId(c),
      {
        text: requiredQuery(c, "text"),
        ...(type === undefined ? {} : { type }),
        ...(limit === undefined ? {} : { limit }),
        ...statusQuery(c),
      },
    )
    return c.json(answer)
  })

  app.get(`${base}/lists/:list`, async (c) => {
    const list = c.req.param("list")
    if (!catalogLists.some((l) => l === list))
      throw new BadRequestError(`The list is one of ${catalogLists.join(", ")}`)
    const offset = integerQuery(c, "offset")
    const limit = integerQuery(c, "limit")
    const answer: Api.CatalogListAnswer = await getCatalogList(
      ctx(c),
      workspaceId(c),
      {
        list: list as CatalogList,
        ...(offset === undefined ? {} : { offset }),
        ...(limit === undefined ? {} : { limit }),
        includeRetired: booleanQuery(c, "include_retired"),
      },
    )
    return c.json(answer)
  })

  app.get(`${base}/changes`, async (c) => {
    const limit = integerQuery(c, "limit")
    const answer: Api.CatalogChangesAnswer = await getCatalogChanges(
      ctx(c),
      workspaceId(c),
      {
        since: integerQuery(c, "since") ?? 0,
        ...(limit === undefined ? {} : { limit }),
      },
    )
    return c.json(answer)
  })

  app.get(`${base}/start-here`, async (c) => {
    const path = c.req.query("path") ?? "people"
    if (path !== "people" && path !== "agents")
      throw new BadRequestError("The path is people or agents")
    const answer: Api.StartHereAnswer = await getCatalogStartHere(
      ctx(c),
      workspaceId(c),
      { path },
    )
    return c.json(answer)
  })

  app.get(`${base}/start-here/agent-preview`, async (c) => {
    const answer: Api.AgentStartHerePreviewAnswer =
      await getAgentStartHerePreview(ctx(c), workspaceId(c))
    return c.json(answer)
  })

  app.get(`${base}/history`, async (c) => {
    const before = integerQuery(c, "before")
    const limit = integerQuery(c, "limit")
    const answer: Api.CatalogHistoryAnswer = await listCatalogHistory(
      ctx(c),
      workspaceId(c),
      {
        id: requiredQuery(c, "id"),
        ...(before === undefined ? {} : { before }),
        ...(limit === undefined ? {} : { limit }),
      },
    )
    return c.json(answer)
  })

  app.get(`${base}/text`, async (c) => {
    const revision = integerQuery(c, "revision")
    const answer: Api.CatalogDocumentTextAnswer = await getCatalogDocumentText(
      ctx(c),
      workspaceId(c),
      {
        id: requiredQuery(c, "id"),
        ...(revision === undefined ? {} : { revision }),
      },
    )
    return c.json(answer)
  })

  app.get(`${base}/opened`, async (c) => {
    const answer: { items: Api.CatalogPageOpened[] } =
      await listCatalogPagesOpened(ctx(c), workspaceId(c), {
        ids: c.req.queries("id") ?? [],
      })
    return c.json(answer)
  })

  app.post(`${base}/opened`, async (c) => {
    const body = (await c.req.json().catch(() => null)) as unknown
    const id =
      typeof body === "object" && body !== null && "id" in body
        ? body.id
        : undefined
    if (typeof id !== "string")
      throw new BadRequestError('"id" must be a string')
    await recordCatalogPageOpened(ctx(c), workspaceId(c), { id })
    return c.body(null, 204)
  })

  // Catalog purge (catalog §9; M2-10): the text comes in the body, never in
  // the address, and no answer or error repeats it. Core checks the fields.
  app.post(`${base}/purge/preview`, async (c) => {
    const body = await purgeBody(c)
    const answer: Api.CatalogPurgePreview = await previewCatalogPurge(
      ctx(c),
      workspaceId(c),
      { text: body.text },
    )
    return c.json(answer)
  })

  app.post(`${base}/purge`, async (c) => {
    const body = await purgeBody(c)
    const purge = await purgeCatalogText(ctx(c), workspaceId(c), {
      text: body.text,
      reason: body.reason,
    })
    return c.json(purgeJson(purge))
  })

  app.get(`${base}/purges`, async (c) => {
    const purges = await listCatalogPurges(ctx(c), workspaceId(c))
    return c.json(purges.map(purgeJson))
  })
}

async function purgeBody(
  c: HonoContext,
): Promise<{ text?: unknown; reason?: unknown }> {
  const body: unknown = await c.req.json().catch(() => null)
  if (typeof body !== "object" || body === null)
    throw new BadRequestError("The body must be a JSON object")
  return body
}

function purgeJson(purge: CatalogPurge): Api.CatalogPurge {
  return { ...purge, createdAt: purge.createdAt.toISOString() }
}

function requiredQuery(c: HonoContext, name: string): string {
  const value = c.req.query(name)
  if (value === undefined) throw new BadRequestError(`"${name}" is required`)
  return value
}

function integerQuery(c: HonoContext, name: string): number | undefined {
  const value = c.req.query(name)
  if (value === undefined) return undefined
  const number = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number))
    throw new BadRequestError(`"${name}" must be a whole number`)
  return number
}

function booleanQuery(c: HonoContext, name: string): boolean {
  const value = c.req.query(name)
  if (value === undefined || value === "false") return false
  if (value === "true") return true
  throw new BadRequestError(`"${name}" must be true or false`)
}

function statusQuery(c: HonoContext): {
  status?: EntityStatus
  includeRetired: boolean
} {
  const status = c.req.query("status")
  return {
    // Core checks that the status exists.
    ...(status === undefined ? {} : { status: status as EntityStatus }),
    includeRetired: booleanQuery(c, "include_retired"),
  }
}
