import { and, desc, eq, lt, schema } from "@shinan/db"
import type { EventSubject } from "@shinan/db"

import { inWorkspace } from "./authorize.js"
import type {
  Context,
  WorkspaceScope,
  WorkspaceScopeAction,
} from "./context.js"
import { rules } from "./permissions.js"
import type { WriteAction } from "./permissions.js"

export interface NewEvent {
  kind: string
  subjects?: EventSubject[]
  /** A short summary for timelines. */
  summary: string
  data?: Record<string, unknown>
  link?: string
  /** The same key in the same workspace is stored once. */
  idempotencyKey?: string
}

export type Event = typeof schema.events.$inferSelect

/** A workspace scope checked for an action that changes something. */
export type WriteScope = WorkspaceScope<
  Extract<WriteAction, WorkspaceScopeAction>
>

/**
 * Appends an event to the scope's workspace, credited to the scope's actor.
 * Events are never edited (architecture §4.3); the database refuses updates
 * and deletes. Returns null if an event with the same idempotency key exists.
 * Only a scope checked for a write action may append: a read must not
 * change the timeline.
 */
export async function appendEvent(
  scope: WriteScope,
  event: NewEvent,
): Promise<Event | null> {
  if (rules[scope.action].access !== "write") {
    throw new Error(`${scope.action} is not a write action`)
  }
  const [row] = await scope.tx
    .insert(schema.events)
    .values({
      workspaceId: scope.workspaceId,
      kind: event.kind,
      origin: scope.origin,
      actorKind: scope.actor.kind,
      actorPersonId: scope.actor.personId,
      actorAgentId: scope.actor.agentId,
      actorAgentSessionId: scope.actor.agentSessionId,
      actorLabel: scope.actor.label,
      confidence: scope.actor.confidence,
      subjects: event.subjects ?? [],
      summary: event.summary,
      data: event.data ?? {},
      link: event.link ?? null,
      idempotencyKey: event.idempotencyKey ?? null,
    })
    .onConflictDoNothing({
      target: [schema.events.workspaceId, schema.events.idempotencyKey],
    })
    .returning()
  return row ?? null
}

export interface Page {
  /** Most entries to return; at most 200. */
  limit?: number
  /** Return entries older than this ID. */
  before?: number
}

export function pageSize(page: Page): number {
  return Math.min(Math.max(page.limit ?? 50, 1), 200)
}

/** The workspace's timeline, newest first. */
export async function listEvents(
  ctx: Context,
  workspaceId: string,
  page: Page = {},
): Promise<Event[]> {
  return inWorkspace(ctx, workspaceId, "workspace.read", (scope) =>
    scope.tx
      .select()
      .from(schema.events)
      .where(
        and(
          eq(schema.events.workspaceId, scope.workspaceId),
          page.before === undefined
            ? undefined
            : lt(schema.events.id, page.before),
        ),
      )
      .orderBy(desc(schema.events.id))
      .limit(pageSize(page)),
  )
}
