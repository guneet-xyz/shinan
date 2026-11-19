import type { Hono, Context as HonoContext } from "hono"

import type * as Api from "@shinan/api-client"
import {
  approveCatalogProposal,
  getCatalogProposal,
  listCatalogProposals,
  previewCatalogChange,
  proposalLimits,
  proposeCatalogChange,
  rejectCatalogProposal,
  withdrawCatalogProposal,
} from "@shinan/core"
import type {
  ApprovalOutcome,
  CatalogOperation,
  CatalogProposal,
  Context,
  PreviewOutcome,
  ProposalOutcome,
} from "@shinan/core"

import { limitInFlight } from "../in-flight.js"
import { BadRequestError, errorResponse } from "./errors.js"
import type { SignedInEnv } from "./sign-in.js"

/**
 * The largest catalog proposal request: the proposal's own limit
 * (`proposalLimits.bytes`, its JSON) with room for the request's
 * formatting. Proposal routes take it instead of the API's usual 64 KB,
 * since a body edit may carry a whole 64 KiB document.
 */
export const proposalBodyLimit = proposalLimits.bytes + 16 * 1024

/**
 * Catalog proposal requests one client may have in flight at once
 * (**proposed**, M2-8, as M2-12 set for `/mcp`): bodies may be 272 KiB, so
 * a client sending them slowly holds at most this many in memory. Past
 * either, the answer is 429 before the body is read.
 */
export const proposalInFlight = { perPerson: 8, perAddress: 16 }

/** The answer past `proposalInFlight`. */
export function tooManyInFlight(c: HonoContext): Response {
  const response = errorResponse(c, 429, {
    error: "too-many-requests",
    message:
      "Too many catalog proposal requests at once; wait for one to finish",
  })
  response.headers.set("retry-after", "1")
  return response
}

/**
 * A body of undeclared size (no `Content-Length`, as with chunked
 * uploads) is refused with 411 on the proposal routes (**proposed**,
 * M2-8): the body limit would have to read such a body before the request
 * reaches the per-person cap on requests in flight, so a slow sender could
 * hold bodies past it. Browsers always declare the size.
 */
export function lengthRequired(c: HonoContext): Response | null {
  if (c.req.header("content-length") !== undefined || c.req.raw.body === null)
    return null
  return errorResponse(c, 411, {
    error: "length-required",
    message: "Send the request's size (Content-Length) with its body",
  })
}

/** Whether a request path is one of the catalog proposal routes. */
export function isProposalPath(path: string): boolean {
  return /^(?:\/api)?\/workspaces\/[^/]+\/catalog\/proposals(?:\/|$)/.test(path)
}

/**
 * Catalog proposals for the wiki (human experience, changing the catalog
 * from the wiki and reviewing catalog changes; catalog §8): make one, check
 * one before making it, read them, and approve, reject or withdraw one.
 * Core checks everything; handlers only read the request.
 */
export function catalogProposalRoutes(
  app: Hono<SignedInEnv>,
  ctx: (c: HonoContext<SignedInEnv>) => Context,
): void {
  const base = "/workspaces/:workspaceId/catalog/proposals"
  const workspaceId = (c: HonoContext<SignedInEnv>) =>
    c.req.param("workspaceId")!
  const proposalId = (c: HonoContext<SignedInEnv>) => c.req.param("proposalId")!

  // Per person, once signed in, before any body is read.
  const perPerson = limitInFlight<SignedInEnv>({
    max: proposalInFlight.perPerson,
    key: (c) => c.var.person.personId,
    refuse: tooManyInFlight,
  })
  app.use(base, perPerson)
  app.use(`${base}/*`, perPerson)

  app.post(base, async (c) => {
    const outcome = await proposeCatalogChange(
      ctx(c),
      workspaceId(c),
      await readJson(c),
    )
    const answer: Api.CatalogProposalOutcome = proposalOutcomeJson(outcome)
    return c.json(answer, "proposal" in outcome ? 201 : 200)
  })

  app.post(`${base}/preview`, async (c) => {
    const outcome: PreviewOutcome = await previewCatalogChange(
      ctx(c),
      workspaceId(c),
      await readJson(c),
    )
    const answer: Api.CatalogPreviewOutcome = outcome
    return c.json(answer)
  })

  app.get(base, async (c) => {
    const state = c.req.query("state")
    if (
      state !== undefined &&
      !["pending", "applied", "rejected", "withdrawn"].includes(state)
    )
      throw new BadRequestError(
        "The state is pending, applied, rejected or withdrawn",
      )
    const order = c.req.query("order")
    if (order !== undefined && order !== "oldest" && order !== "newest")
      throw new BadRequestError("The order is oldest or newest")
    const limit = integerQuery(c, "limit")
    const cursor = integerQuery(c, "cursor")
    const proposals = await listCatalogProposals(ctx(c), workspaceId(c), {
      ...(state ? { state: state as CatalogProposal["state"] } : {}),
      ...(limit === undefined ? {} : { limit }),
      ...(cursor === undefined ? {} : { cursor }),
      oldestFirst: order === "oldest",
    })
    const answer: Api.CatalogProposalList = {
      items: proposals.map(proposalJson),
    }
    return c.json(answer)
  })

  app.get(`${base}/:proposalId`, async (c) => {
    const answer: Api.CatalogProposal = proposalJson(
      await getCatalogProposal(ctx(c), workspaceId(c), proposalId(c)),
    )
    return c.json(answer)
  })

  app.post(`${base}/:proposalId/approve`, async (c) => {
    const outcome: ApprovalOutcome = await approveCatalogProposal(
      ctx(c),
      workspaceId(c),
      proposalId(c),
    )
    const answer: Api.CatalogApprovalOutcome = proposalOutcomeJson(outcome)
    return c.json(answer)
  })

  app.post(`${base}/:proposalId/reject`, async (c) => {
    const body = await readJson(c)
    const reason =
      typeof body === "object" && body !== null && !Array.isArray(body)
        ? (body as { reason?: unknown }).reason
        : undefined
    if (typeof reason !== "string")
      throw new BadRequestError("Give the reason as text")
    const answer: Api.CatalogProposal = proposalJson(
      await rejectCatalogProposal(ctx(c), workspaceId(c), {
        proposalId: proposalId(c),
        reason,
      }),
    )
    return c.json(answer)
  })

  app.post(`${base}/:proposalId/withdraw`, async (c) => {
    const answer: Api.CatalogProposal = proposalJson(
      await withdrawCatalogProposal(ctx(c), workspaceId(c), proposalId(c)),
    )
    return c.json(answer)
  })
}

function proposalJson(proposal: CatalogProposal): Api.CatalogProposal {
  return {
    ...proposal,
    operations: proposal.operations,
    createdAt: proposal.createdAt.toISOString(),
    decidedAt: proposal.decidedAt?.toISOString() ?? null,
  }
}

function proposalOutcomeJson(
  outcome: ProposalOutcome | ApprovalOutcome,
): Api.CatalogProposalOutcome {
  return "proposal" in outcome
    ? { outcome: outcome.outcome, proposal: proposalJson(outcome.proposal) }
    : outcome
}

/** The request's JSON as it came: core checks its shape. */
async function readJson(c: HonoContext): Promise<unknown> {
  return (await c.req.json().catch(() => {
    throw new BadRequestError("The request body must be JSON")
  })) as unknown
}

function integerQuery(c: HonoContext, name: string): number | undefined {
  const value = c.req.query(name)
  if (value === undefined) return undefined
  const number = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number))
    throw new BadRequestError(`"${name}" must be a whole number`)
  return number
}

// The web builds operations from api-client's copy of the operation types;
// these keep the two copies the same.
type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : never
export const operationTypesAgree: Same<CatalogOperation, Api.CatalogOperation> =
  true
