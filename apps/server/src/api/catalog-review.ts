import type { Hono, Context as HonoContext } from "hono"

import {
  approveCatalogProposals,
  commentOnCatalogProposal,
  getCatalogSettings,
  listCatalogProposalComments,
  listRecentCatalogChanges,
  rejectCatalogProposals,
  revertCatalogProposal,
  setCatalogStrict,
} from "@shinan/core"
import type { BulkSelection, Context } from "@shinan/core"

import { BadRequestError } from "./errors.js"
import type { SignedInEnv } from "./sign-in.js"

/**
 * Catalog review for the wiki (human experience, reviewing catalog
 * changes; catalog §8.2, §8.6): the strict setting, bulk approval,
 * comments on proposals, the recent-changes feed and revert. Every answer
 * is core's; handlers only read the request.
 */
export function catalogReviewRoutes(
  app: Hono<SignedInEnv>,
  ctx: (c: HonoContext<SignedInEnv>) => Context,
): void {
  const base = "/workspaces/:workspaceId/catalog"
  const workspaceId = (c: HonoContext<SignedInEnv>) =>
    c.req.param("workspaceId")!

  app.get(`${base}/settings`, async (c) =>
    c.json(await getCatalogSettings(ctx(c), workspaceId(c))),
  )

  app.patch(`${base}/settings`, async (c) => {
    const body = await readBody(c)
    if (typeof body.strict !== "boolean")
      throw new BadRequestError('"strict" must be true or false')
    return c.json(
      await setCatalogStrict(ctx(c), {
        workspaceId: workspaceId(c),
        strict: body.strict,
      }),
    )
  })

  app.post(`${base}/proposals/bulk-approve`, async (c) => {
    const selection = bulkSelection(await readBody(c))
    return c.json(
      await approveCatalogProposals(ctx(c), workspaceId(c), selection),
    )
  })

  app.post(`${base}/proposals/bulk-reject`, async (c) => {
    const body = await readBody(c)
    if (typeof body.reason !== "string")
      throw new BadRequestError('"reason" must be a string')
    return c.json(
      await rejectCatalogProposals(ctx(c), workspaceId(c), {
        ...bulkSelection(body),
        reason: body.reason,
      }),
    )
  })

  app.get(`${base}/proposals/:proposalId/comments`, async (c) =>
    c.json({
      items: await listCatalogProposalComments(
        ctx(c),
        workspaceId(c),
        c.req.param("proposalId"),
      ),
    }),
  )

  app.post(`${base}/proposals/:proposalId/comments`, async (c) => {
    const body = await readBody(c)
    if (typeof body.text !== "string")
      throw new BadRequestError('"text" must be a string')
    if (
      body.idempotencyKey !== undefined &&
      typeof body.idempotencyKey !== "string"
    )
      throw new BadRequestError('"idempotencyKey" must be a string')
    return c.json(
      await commentOnCatalogProposal(ctx(c), workspaceId(c), {
        proposalId: c.req.param("proposalId"),
        text: body.text,
        ...(typeof body.idempotencyKey === "string"
          ? { idempotencyKey: body.idempotencyKey }
          : {}),
      }),
      201,
    )
  })

  app.post(`${base}/proposals/:proposalId/revert`, async (c) => {
    const body = await readOptionalBody(c)
    for (const field of ["explanation", "idempotencyKey"])
      if (body[field] !== undefined && typeof body[field] !== "string")
        throw new BadRequestError(`"${field}" must be a string`)
    return c.json(
      await revertCatalogProposal(ctx(c), workspaceId(c), {
        proposalId: c.req.param("proposalId"),
        ...(typeof body.explanation === "string"
          ? { explanation: body.explanation }
          : {}),
        ...(typeof body.idempotencyKey === "string"
          ? { idempotencyKey: body.idempotencyKey }
          : {}),
      }),
    )
  })

  app.get(`${base}/recent-changes`, async (c) => {
    const approval = c.req.query("approval")
    if (approval !== undefined && approval !== "any" && approval !== "without")
      throw new BadRequestError('"approval" must be "any" or "without"')
    const cursor = integerQuery(c, "cursor")
    const limit = integerQuery(c, "limit")
    return c.json(
      await listRecentCatalogChanges(ctx(c), workspaceId(c), {
        ...(cursor === undefined ? {} : { cursor }),
        ...(limit === undefined ? {} : { limit }),
        ...(approval === undefined ? {} : { approval }),
      }),
    )
  })
}

/**
 * What a bulk action takes: the proposals the person was shown, by ID, or a
 * task's waiting proposals up to the highest number they saw.
 */
function bulkSelection(body: Record<string, unknown>): BulkSelection {
  if (
    Array.isArray(body.proposalIds) &&
    body.proposalIds.every((id) => typeof id === "string")
  )
    return { proposalIds: body.proposalIds }
  if (typeof body.relatedTask === "string" && typeof body.seenUpTo === "number")
    return { relatedTask: body.relatedTask, seenUpTo: body.seenUpTo }
  throw new BadRequestError(
    'Send "proposalIds" (the proposals shown), or "relatedTask" with "seenUpTo" (the highest proposal number shown)',
  )
}

async function readBody(c: HonoContext): Promise<Record<string, unknown>> {
  const body = (await c.req.json().catch(() => {
    throw new BadRequestError("The request body must be JSON")
  })) as unknown
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new BadRequestError("The request body must be a JSON object")
  return body as Record<string, unknown>
}

/** A JSON object body, or an empty one when the request has no body. */
async function readOptionalBody(
  c: HonoContext,
): Promise<Record<string, unknown>> {
  const text = await c.req.text()
  if (text.trim() === "") return {}
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new BadRequestError("The request body must be JSON")
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new BadRequestError("The request body must be a JSON object")
  return body as Record<string, unknown>
}

function integerQuery(c: HonoContext, name: string): number | undefined {
  const value = c.req.query(name)
  if (value === undefined) return undefined
  if (!/^\d+$/.test(value))
    throw new BadRequestError(`"${name}" must be a whole number`)
  return Number(value)
}
