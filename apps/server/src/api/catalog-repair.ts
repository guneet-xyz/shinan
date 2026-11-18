import type { Hono, Context as HonoContext } from "hono"

import { proposalLimits, repairCatalogDocument } from "@shinan/core"
import type { Context } from "@shinan/core"

import { BadRequestError } from "./errors.js"
import type { SignedInEnv } from "./sign-in.js"

/** A repair carries a whole document: the largest body its route reads. */
export const repairBodyLimit = proposalLimits.bytes + 16 * 1024

/** Whether a request path is the repair route. */
export function isRepairPath(path: string): boolean {
  return /^(?:\/api)?\/workspaces\/[^/]+\/catalog\/proposals\/repair$/.test(
    path,
  )
}

/**
 * A workspace owner's repair of a catalog document that reads with problems
 * (catalog §8.3): its whole text replaced, through the proposal path.
 * Core checks who may, and the fields.
 */
export function catalogRepairRoutes(
  app: Hono<SignedInEnv>,
  ctx: (c: HonoContext<SignedInEnv>) => Context,
): void {
  app.post("/workspaces/:workspaceId/catalog/proposals/repair", async (c) => {
    const body: unknown = await c.req.json().catch(() => null)
    if (typeof body !== "object" || body === null || Array.isArray(body))
      throw new BadRequestError("The request body must be a JSON object")
    const { id, revision, text, explanation, idempotencyKey } = body as Record<
      string,
      unknown
    >
    return c.json(
      await repairCatalogDocument(ctx(c), c.req.param("workspaceId"), {
        id,
        revision,
        text,
        explanation,
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      }),
    )
  })
}
