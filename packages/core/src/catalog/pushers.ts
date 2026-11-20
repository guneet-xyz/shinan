import { and, eq, inArray, schema, sql } from "@shinan/db"

import { inWorkspace, snapshotRead } from "../authorize.js"
import type { Context } from "../context.js"

/*
 * Who pushed each change, and when it reached `main` (Git-based catalog
 * plan §2.6, D-061, D-066; product brief and reviews on #169): from the
 * push log, which Shinan records, rather than the commit's author and
 * time, which an agent writes.
 */

/** Who first pushed a commit: an agent for a person, or Shinan itself. */
export type PusherJson =
  | {
      kind: "agent"
      /** The person's name, such as "Guneet". */
      person: string
      /** The agent's name, such as "OpenCode on Daedalus". */
      agent: string
    }
  | { kind: "shinan" }

/** What the push log says of one commit. */
export interface CommitPushJson {
  /** Who first pushed it; null when the push log has no record of it. */
  pushed_by: PusherJson | null
  /** When it reached `main` (ISO 8601), if the push log knows. */
  reached_main_at: string | null
}

/**
 * The first pusher of each of these commits, and when each reached
 * `main`, as Shinan recorded it at the time (`catalog_main_arrivals`): for
 * a commit a purge rewrote, its arrival is the commit's it replaces
 * (`replaces_commit`). Never the commit's own date, which an agent writes
 * (D-061). Commits the push log doesn't know are left out.
 */
export async function readCommitPushes(
  ctx: Context,
  workspaceId: string,
  commits: readonly { oid: string }[],
): Promise<Map<string, CommitPushJson>> {
  const oids = [...new Set(commits.map((c) => c.oid))]
  if (oids.length === 0) return new Map()
  const { first, arrivals } = await inWorkspace(
    ctx,
    workspaceId,
    "catalog.read",
    async (scope) => {
      const f = schema.catalogCommitFirstPushes
      const first = await scope.tx
        .select({
          commit: f.commit,
          kind: f.pusherKind,
          person: schema.people.name,
          agent: schema.agents.name,
        })
        .from(f)
        .leftJoin(schema.people, eq(schema.people.id, f.personId))
        .leftJoin(schema.agents, eq(schema.agents.id, f.agentId))
        .where(
          and(eq(f.workspaceId, scope.workspaceId), inArray(f.commit, oids)),
        )
      const a = schema.catalogMainArrivals
      const arrivals = await scope.tx
        .execute<{ commit: string; at: Date | string }>(
          sql`
          with recursive chain ("commit", "current", depth) as (
            select c, c, 0 from unnest(array[${sql.join(
              oids.map((o) => sql`${o}`),
              sql`, `,
            )}]::text[]) as c
            union all
            select chain."commit", ${f.replacesCommit}, chain.depth + 1
            from chain join ${f}
              on ${f.workspaceId} = ${scope.workspaceId} and ${f.commit} = chain."current"
            where ${f.replacesCommit} is not null and chain.depth < 50
          )
          select chain."commit", min(${a.reachedMainAt}) as at
          from chain join ${a}
            on ${a.workspaceId} = ${scope.workspaceId} and ${a.commit} = chain."current"
          group by chain."commit"`,
        )
        .then((r) => r.rows)
      return { first, arrivals }
    },
    snapshotRead,
  )

  const reached = new Map(
    arrivals.map((row) => [row.commit, new Date(row.at).toISOString()]),
  )
  const result = new Map<string, CommitPushJson>()
  const byCommit = new Map(first.map((row) => [row.commit, row]))
  for (const oid of oids) {
    const row = byCommit.get(oid)
    const at = reached.get(oid)
    if (!row && at === undefined) continue
    result.set(oid, {
      pushed_by: !row
        ? null
        : row.kind === "shinan"
          ? { kind: "shinan" }
          : {
              kind: "agent",
              person: row.person ?? "Someone",
              agent: row.agent ?? "an agent",
            },
      reached_main_at: at ?? null,
    })
  }
  return result
}
