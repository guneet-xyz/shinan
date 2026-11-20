import type { Hono, Context as HonoContext } from "hono"
import { compress } from "hono/compress"

import type * as Api from "@shinan/api-client"
import {
  catalogLists,
  getCatalogDocument,
  getCatalogEntity,
  getCatalogList,
  getCatalogPageHistory,
  getCatalogPageSource,
  getCatalogReadme,
  getCatalogStartHere,
  getCatalogState,
  getCatalogTypeSchema,
  listCatalogChanges,
  listCatalogPurges,
  listCatalogTree,
  listCatalogTypeIndex,
  listCatalogTypeSchemas,
  previewCatalogPurge,
  purgeCatalogText,
  searchCatalog,
  throttleAddress,
} from "@shinan/core"
import type {
  CatalogList,
  CatalogPurge,
  Context,
  EntityStatus,
  GitClient,
  HistoryCursors,
  RequestInfo,
} from "@shinan/core"

import { limitInFlight } from "../in-flight.js"
import { BadRequestError, errorResponse } from "./errors.js"
import type { SignedInEnv } from "./sign-in.js"

/**
 * The catalog for the catalog pages (human experience, the catalog; build
 * plan M2-7): the agent index's queries. Every answer is core's, in the
 * agent index's JSON format; handlers only read the request. A page's
 * history comes from `main`'s commits (GC-7).
 */
export function catalogRoutes(
  app: Hono<SignedInEnv>,
  ctx: (c: HonoContext<SignedInEnv>) => Context,
  options: {
    git?: GitClient
    /** Signs and checks History's cursors. */
    cursors: HistoryCursors
    requestInfo: (c: HonoContext) => RequestInfo
  },
): void {
  const { git, cursors } = options
  const base = "/workspaces/:workspaceId/catalog"
  const workspaceId = (c: HonoContext<SignedInEnv>) =>
    c.req.param("workspaceId")!

  // What reads the repository shares the Git container with every
  // workspace's index updates (and agents' pushes): one person, or one
  // address, holds only a few of its reads at once (review of #192).
  const byAddress = limitInFlight<SignedInEnv>({
    max: catalogGitInFlight.perAddress,
    // An IPv6 address by its /64, as the rate limits count it.
    key: (c) => throttleAddress(options.requestInfo(c).networkAddress),
    refuse: tooManyAtOnce,
  })
  const byPerson = limitInFlight<SignedInEnv>({
    max: catalogGitInFlight.perPerson,
    key: (c) => c.var.person.personId,
    refuse: tooManyAtOnce,
  })
  for (const path of ["/history", "/changes", "/source", "/readme"]) {
    app.use(`${base}${path}`, byAddress)
    app.use(`${base}${path}`, byPerson)
  }

  app.get(`${base}/entity`, async (c) => {
    const answer: Api.CatalogEntityAnswer = await getCatalogEntity(
      ctx(c),
      workspaceId(c),
      { id: requiredQuery(c, "id") },
    )
    return c.json(answer)
  })

  app.get(`${base}/document`, async (c) => {
    const answer: Api.CatalogDocumentAnswer = await getCatalogDocument(
      ctx(c),
      workspaceId(c),
      { id: requiredQuery(c, "id") },
    )
    return c.json(answer)
  })

  // From the repository, through the Git container (GC-7).
  app.get(`${base}/history`, async (c) => {
    const answer: Api.CatalogHistoryAnswer = await getCatalogPageHistory(
      ctx(c),
      git,
      workspaceId(c),
      {
        id: requiredQuery(c, "id"),
        after: c.req.query("after"),
        limit: integerQuery(c, "limit"),
      },
      cursors,
    )
    return c.json(answer)
  })

  app.get(`${base}/changes`, async (c) => {
    const answer: Api.CatalogChangesAnswer = await listCatalogChanges(
      ctx(c),
      git,
      workspaceId(c),
      { after: c.req.query("after"), limit: integerQuery(c, "limit") },
      cursors,
    )
    return c.json(answer)
  })

  app.get(`${base}/source`, async (c) => {
    const answer: Api.CatalogSourceAnswer = await getCatalogPageSource(
      ctx(c),
      git,
      workspaceId(c),
      { id: requiredQuery(c, "id") },
    )
    return c.json(answer)
  })

  app.get(`${base}/readme`, async (c) => {
    const answer: Api.CatalogReadmeAnswer = await getCatalogReadme(
      ctx(c),
      git,
      workspaceId(c),
    )
    return c.json(answer)
  })

  // The tree of a large catalog is megabytes of JSON with no secrets in
  // it: compressed here, whatever the proxy in front does.
  app.get(`${base}/tree`, compress(), async (c) => {
    const answer: Api.CatalogTreeAnswer = await listCatalogTree(
      ctx(c),
      workspaceId(c),
    )
    return c.json(answer)
  })

  app.get(`${base}/state`, async (c) => {
    const answer: Api.CatalogAnswer = await getCatalogState(
      ctx(c),
      workspaceId(c),
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

/**
 * How many of the routes that read the repository (History, View source,
 * the README) one person, and one network address, may have in flight at
 * once. The Git container reads 4 at a time for the whole installation.
 */
export const catalogGitInFlight = { perPerson: 2, perAddress: 4 }

function tooManyAtOnce(c: HonoContext): Response {
  const response = errorResponse(c, 429, {
    error: "too-many-requests",
    message:
      "Too many requests at once: try again when an earlier one is answered",
  })
  response.headers.set("retry-after", "1")
  return response
}
