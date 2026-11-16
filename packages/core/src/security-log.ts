import { isIP } from "node:net"

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
    networkAddress: networkAddress(entry.request.networkAddress),
    client: clientDescription(entry.request.client),
    details: entry.details ?? {},
  })
}

/**
 * Only a valid IP address is stored. Anything else is dropped rather than
 * failing the insert, which would turn every refusal and sensitive action
 * into a database error. An IPv6 zone ID (`fe80::1%eth0`) is removed,
 * because PostgreSQL's `inet` type does not accept one.
 */
export function networkAddress(value: string | undefined): string | null {
  if (value === undefined || isIP(value) === 0) return null
  return value.replace(/%.*$/, "")
}

/**
 * The longest client description kept. The log is kept forever, and a user
 * agent comes from the request, so a long one is cut short.
 */
export const clientLengthLimit = 512

export function clientDescription(value: string | undefined): string | null {
  if (value === undefined) return null
  return value.length > clientLengthLimit
    ? value.slice(0, clientLengthLimit)
    : value
}
