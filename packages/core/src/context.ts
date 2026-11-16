import type { Database, EventOrigin, Transaction } from "@shinan/db"

import type { Actor, ResolvedActor } from "./actor.js"

/** Everything an operation needs to know about the request it serves. */
export interface Context {
  db: Database
  actor: Actor
  /** The path the request came through; defaults to `shinan_action`. */
  origin?: EventOrigin
  request?: RequestInfo
}

/** Facts about the request, recorded in the security log (identity §11). */
export interface RequestInfo {
  /** The client's network address (IPv4 or IPv6). */
  networkAddress?: string
  /** The client described by the request, such as its user agent. */
  client?: string
}

declare const scopeBrand: unique symbol

/**
 * Proof that the permission check passed for one action in one workspace.
 * Only `authorize` creates it, and workspace data is read and written only
 * through functions that take it, so every query is scoped to the workspace
 * the actor was checked against (architecture §3.4).
 */
export interface WorkspaceScope {
  readonly [scopeBrand]: true
  readonly tx: Transaction
  readonly workspaceId: string
  readonly actor: ResolvedActor
  readonly origin: EventOrigin
  readonly request: RequestInfo
}

/** Proof that the permission check passed for an installation action. */
export interface InstallationScope {
  readonly [scopeBrand]: true
  readonly tx: Transaction
  readonly actor: ResolvedActor
  readonly origin: EventOrigin
  readonly request: RequestInfo
}
