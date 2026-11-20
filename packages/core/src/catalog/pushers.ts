import { and, eq, inArray, schema, sql } from "@shinan/db"

import { inWorkspace, snapshotRead } from "../authorize.js"
import type { Context } from "../context.js"
import type { CommitInfo } from "./git/api.js"

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

const main = "refs/heads/main"

/**
 * The first pusher of each of these commits, and when each reached `main`:
 * the push that moved `main` to it, or the push that first brought it if
 * that was a push to `main`; for a commit `main` came to through a later
 * commit of the list (a merged branch's), no later than that one. Commits
 * the push log doesn't know are left out.
 */
export async function readCommitPushes(
  ctx: Context,
  workspaceId: string,
  commits: readonly CommitInfo[],
): Promise<Map<string, CommitPushJson>> {
  const oids = [...new Set(commits.map((c) => c.oid))]
  if (oids.length === 0) return new Map()
  const { first, tips } = await inWorkspace(
    ctx,
    workspaceId,
    "catalog.read",
    async (scope) => {
      const f = schema.catalogCommitFirstPushes
      const first = await scope.tx
        .select({
          commit: f.commit,
          kind: f.pusherKind,
          ref: f.ref,
          at: f.firstPushedAt,
          person: schema.people.name,
          agent: schema.agents.name,
        })
        .from(f)
        .leftJoin(schema.people, eq(schema.people.id, f.personId))
        .leftJoin(schema.agents, eq(schema.agents.id, f.agentId))
        .where(
          and(eq(f.workspaceId, scope.workspaceId), inArray(f.commit, oids)),
        )
      const r = schema.catalogPushRefs
      const p = schema.catalogPushes
      const tips = await scope.tx
        .select({
          commit: r.newCommit,
          at: sql<Date>`min(${p.pushedAt})`.mapWith(p.pushedAt),
        })
        .from(r)
        .innerJoin(p, eq(p.id, r.pushId))
        .where(
          and(
            eq(p.workspaceId, scope.workspaceId),
            eq(p.outcome, "accepted"),
            eq(r.ref, main),
            eq(r.confirmed, true),
            inArray(r.newCommit, oids),
          ),
        )
        .groupBy(r.newCommit)
      return { first, tips }
    },
    snapshotRead,
  )

  const reached = new Map<string, number>()
  const earliest = (oid: string, at: number) => {
    const known = reached.get(oid)
    if (known === undefined || at < known) {
      reached.set(oid, at)
      return true
    }
    return false
  }
  for (const tip of tips) if (tip.commit) earliest(tip.commit, tip.at.getTime())
  for (const row of first)
    if (row.ref === main || row.kind === "shinan")
      earliest(row.commit, row.at.getTime())
  // A parent reached `main` no later than its child: carry the times down
  // the list's parent links until nothing changes.
  const inList = new Set(oids)
  for (
    let changed = true, rounds = 0;
    changed && rounds < oids.length;
    rounds++
  ) {
    changed = false
    for (const commit of commits) {
      const at = reached.get(commit.oid)
      if (at === undefined) continue
      for (const parent of commit.parents)
        if (inList.has(parent) && earliest(parent, at)) changed = true
    }
  }

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
      reached_main_at: at === undefined ? null : new Date(at).toISOString(),
    })
  }
  return result
}
