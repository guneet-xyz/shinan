import { schema } from "@shinan/db"
import type { Database, SecurityOutcome, Transaction } from "@shinan/db"

import type { ResolvedActor } from "./actor.js"
import type { RequestInfo } from "./context.js"

export interface SecurityEntry {
  /** The workspace the entry belongs to, or null for installation-level. */
  workspaceId: string | null
  action: string
  outcome: SecurityOutcome
  actor: ResolvedActor
  /** The person the entry is about, if not the actor. */
  subjectPersonId?: string | null
  request: RequestInfo
  /** What changed, as structured values; never secrets or free text. */
  details?: Record<string, unknown>
}

/**
 * Appends an entry to the security log. Entries are never changed or removed
 * (D-049); the database refuses updates and deletes.
 */
export async function recordSecurityEntry(
  executor: Database | Transaction,
  entry: SecurityEntry,
): Promise<void> {
  await executor.insert(schema.securityLog).values({
    workspaceId: entry.workspaceId,
    action: entry.action,
    outcome: entry.outcome,
    actorKind: entry.actor.kind,
    actorPersonId: entry.actor.personId,
    actorAgentId: entry.actor.agentId,
    actorAgentSessionId: entry.actor.agentSessionId,
    actorLabel: entry.actor.label,
    confidence: entry.actor.confidence,
    subjectPersonId: entry.subjectPersonId ?? null,
    networkAddress: entry.request.networkAddress ?? null,
    client: entry.request.client ?? null,
    details: entry.details ?? {},
  })
}
