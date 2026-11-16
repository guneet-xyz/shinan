import type { ActorKind, Confidence, Role } from "@shinan/db"

/** Agent token scopes (identity §7.2). */
export const scopes = [
  "catalog:read",
  "catalog:propose",
  "tasks:read",
  "tasks:write",
  "presence",
] as const
export type Scope = (typeof scopes)[number]

/**
 * Who is making a request, as established by sign-in (a person's sign-in
 * session) or an agent token. Core trusts these fields; the sign-in and token
 * layers (M1-4, M2) are responsible for them. Everything else, such as
 * membership and role, core looks up itself on every request.
 */
export type Actor = PersonActor | AgentActor | ShinanActor

export interface PersonActor {
  kind: "person"
  personId: string
  /** Signed in again recently, as sensitive actions need (identity §3.3). */
  reauthenticated?: boolean
}

export interface AgentActor {
  kind: "agent"
  agentId: string
  /** `<coding tool>-<machine>` (identity §8.7). */
  agentHandle: string
  /** The person the agent acts for. */
  personId: string
  /** The one workspace the agent belongs to. */
  workspaceId: string
  /** The scopes of the token the request used. */
  scopes: readonly Scope[]
  agentSessionId?: string
}

/** Shinan itself, for automatic actions. */
export interface ShinanActor {
  kind: "shinan"
}

export const shinan: ShinanActor = { kind: "shinan" }

/**
 * An actor after core has checked it against the database: the columns
 * written to events and the security log.
 */
export interface ResolvedActor {
  kind: ActorKind
  personId: string | null
  agentId: string | null
  agentSessionId: string | null
  /** Written form (identity §8.7). */
  label: string
  confidence: Confidence
  /** The membership the actor acts through, for workspace actions. */
  member: { id: string; role: Role } | null
}

/** The written form of an actor (identity §8.7). */
export function writtenActor(
  actor: Actor,
  personHandle: string | undefined,
): string {
  switch (actor.kind) {
    case "shinan":
      return "shinan"
    case "person":
      return requireHandle(personHandle)
    case "agent":
      return `${requireHandle(personHandle)} via ${actor.agentHandle}`
  }
}

function requireHandle(handle: string | undefined): string {
  if (!handle) throw new Error("A person's handle is needed to write an actor")
  return handle
}
