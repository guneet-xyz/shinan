import { and, asc, eq, isNull, schema, sql } from "@shinan/db"

import { shinan } from "../../actor.js"
import { atInstallation, inWorkspace, snapshotRead } from "../../authorize.js"
import type { Context, WorkspaceScope } from "../../context.js"
import { NotFoundError } from "../../errors.js"
import { takeRateLimit } from "../../rate-limits.js"
import { networkAddress, recordSecurityEntry } from "../../security-log.js"
import { maxAllowedValues, maxContextMemberHandles } from "./api.js"
import type { GitRequestContext, GitService } from "./api.js"

export interface GitRequestInput {
  workspaceId: string
  service: GitService
  /**
   * Whether this is `GET info/refs`, the first request of every clone,
   * fetch and push; otherwise it is the service's `POST`.
   */
  advertisement: boolean
  /** The request's ID, passed on to the Git container. */
  requestId: string
}

export type GitRequestAccess =
  | { allowed: true; context: GitRequestContext }
  /** The agent's push rate is spent (plan §2.10). */
  | { allowed: false; retryAfterSeconds: number }

/**
 * Whether an agent may use a workspace's catalog repository over HTTPS, and
 * if so, the context `web` passes to the Git container with the request
 * (Git-based catalog plan §2.2, steps 3 and 5; §2.14).
 *
 * - Fetching (`git-upload-pack`) needs `catalog.fetch`, pushing
 *   (`git-receive-pack`, its `info/refs` too) `catalog.push`. A token of
 *   another workspace, or of an agent whose member left, gets the same
 *   `NotFoundError` as an unknown workspace; a read-only token pushing gets
 *   a `ForbiddenError`. Refusals are recorded in the security log.
 * - Each push's `POST` counts against the agent's push rate.
 * - Each fetch's `info/refs` is counted on the token, for the hourly
 *   `catalog.fetched` summary (`summarizeCatalogFetches`).
 */
export async function authorizeGitRequest(
  ctx: Context,
  input: GitRequestInput,
): Promise<GitRequestAccess> {
  const actor = ctx.actor
  if (actor.kind !== "agent") throw new NotFoundError()
  const push = input.service === "git-receive-pack"
  const read = async (
    scope: WorkspaceScope<"catalog.fetch" | "catalog.push">,
  ) => {
    const [names] = await scope.tx
      .select({
        agentHandle: schema.agents.handle,
        personHandle: schema.people.handle,
      })
      .from(schema.agents)
      .innerJoin(schema.people, eq(schema.people.id, schema.agents.personId))
      .where(eq(schema.agents.id, actor.agentId))
    const members = await scope.tx
      .select({ handle: schema.people.handle })
      .from(schema.members)
      .innerJoin(schema.people, eq(schema.people.id, schema.members.personId))
      .where(
        and(
          eq(schema.members.workspaceId, scope.workspaceId),
          isNull(schema.members.removedAt),
        ),
      )
      .orderBy(asc(schema.people.handle))
      .limit(maxContextMemberHandles)
    if (!names || !scope.actor.member) throw new NotFoundError()
    const context: GitRequestContext = {
      requestId: input.requestId,
      workspaceId: scope.workspaceId,
      agent: { id: actor.agentId, handle: names.agentHandle },
      memberId: scope.actor.member.id,
      person: { id: actor.personId, handle: names.personHandle },
      by: scope.actor.label,
      mayPush: actor.scopes.includes("catalog:write"),
      memberHandles: members.map((m) => m.handle),
      // The values the owners allowed as "not a secret" (GQ-2), for the
      // secret check of a push.
      allowedValues: push
        ? (
            await scope.tx
              .select({ fingerprint: schema.catalogAllowedValues.fingerprint })
              .from(schema.catalogAllowedValues)
              .where(
                eq(schema.catalogAllowedValues.workspaceId, scope.workspaceId),
              )
              .orderBy(asc(schema.catalogAllowedValues.fingerprint))
              .limit(maxAllowedValues)
          ).map((v) => v.fingerprint)
        : [],
      // For the push log (plan §2.6).
      tokenId: actor.tokenId,
      ...(validAddress(ctx.request?.networkAddress)
        ? { networkAddress: ctx.request!.networkAddress! }
        : {}),
    }
    return context
  }
  const context = push
    ? await inWorkspace(
        ctx,
        input.workspaceId,
        "catalog.push",
        read,
        snapshotRead,
      )
    : await inWorkspace(
        ctx,
        input.workspaceId,
        "catalog.fetch",
        read,
        snapshotRead,
      )

  // Counting is Shinan's own work, as for the token's other limits.
  const asShinan: Context = { ...ctx, actor: shinan }
  if (push && !input.advertisement) {
    const limited = await takeRateLimit(asShinan, "catalog-push", {
      key: actor.agentId,
    })
    if (!limited.allowed)
      return { allowed: false, retryAfterSeconds: limited.retryAfterSeconds }
  }
  if (!push && input.advertisement) {
    await atInstallation(
      asShinan,
      "agent-token.authenticate",
      async (scope) => {
        await scope.tx
          .update(schema.agentTokens)
          .set({
            fetchCount: sql`${schema.agentTokens.fetchCount} + 1`,
            lastFetchedAt: sql`now()`,
          })
          .where(eq(schema.agentTokens.id, actor.tokenId))
      },
    )
  }
  return { allowed: true, context }
}

/**
 * Records each token's fetches since the last summary in the security log,
 * one `catalog.fetched` entry per token (plan §2.14): clones and fetches
 * are bulk reads of the whole catalog, summarised like token use rather
 * than one entry each. The worker runs this hourly. `fetches` counts those
 * since the previous summary, `totalFetches` those since the token was
 * made. Returns how many tokens were summarised.
 */
export async function summarizeCatalogFetches(ctx: Context): Promise<number> {
  return atInstallation(ctx, "agent-token.authenticate", async (scope) => {
    const t = schema.agentTokens
    const rows = await scope.tx
      .select({
        token: t,
        handle: schema.agents.handle,
        personId: schema.agents.personId,
      })
      .from(t)
      .innerJoin(schema.agents, eq(schema.agents.id, t.agentId))
      .where(sql`${t.fetchCount} > ${t.fetchSummarizedCount}`)
      .orderBy(asc(t.id))
      .for("update", { of: t })
    for (const { token, handle, personId } of rows) {
      await scope.tx
        .update(t)
        .set({ fetchSummarizedCount: token.fetchCount })
        .where(eq(t.id, token.id))
      await recordSecurityEntry(scope.tx, {
        workspaceId: token.workspaceId,
        action: "catalog.fetched",
        outcome: "succeeded",
        actor: scope.actor,
        subjectPersonId: personId,
        request: {},
        details: {
          agentId: token.agentId,
          handle,
          tokenId: token.id,
          fetches: token.fetchCount - token.fetchSummarizedCount,
          totalFetches: token.fetchCount,
          lastFetchedAt: token.lastFetchedAt?.toISOString() ?? null,
        },
      })
    }
    return rows.length
  })
}

function validAddress(value: string | undefined): boolean {
  return networkAddress(value) === value && value !== undefined
}
