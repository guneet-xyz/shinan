import type { Database, EventOrigin, Transaction } from "@shinan/db"

import type { Actor, ResolvedActor } from "./actor.js"
import type { JobQueue } from "./jobs.js"
import type { InstallationAction, WorkspaceAction } from "./permissions.js"

/** Everything an operation needs to know about the request it serves. */
export interface Context {
  db: Database
  actor: Actor
  /** The path the request came through; defaults to `shinan_action`. */
  origin?: EventOrigin
  request?: RequestInfo
  /** The job queue, for operations that add jobs, such as sending email. */
  jobs?: JobQueue
  /**
   * The installation's public address, such as `https://shinan.guneet.dev`,
   * for links in the emails operations send.
   */
  installationUrl?: string
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
 * Actions a workspace scope can be for: the workspace actions, creating the
 * workspace, whose first owner acts in it straight away, accepting an
 * invitation, and Shinan recording an invitation's expiry in its workspace.
 */
export type WorkspaceScopeAction =
  | WorkspaceAction
  | "workspace.create"
  | "invitation.respond"
  | "invitation.expire"

/**
 * Proof that the permission check passed for one action in one workspace.
 * Only `authorize.ts` creates it, and workspace data is read and written only
 * through functions that take it, so every query is scoped to the workspace
 * the actor was checked against (architecture §3.4). Scopes are internal to
 * core: other packages call operations, never these primitives.
 */
export interface WorkspaceScope<
  A extends WorkspaceScopeAction = WorkspaceScopeAction,
> {
  readonly [scopeBrand]: true
  /** The action the actor was checked for. */
  readonly action: A
  readonly tx: Transaction
  readonly workspaceId: string
  readonly actor: ResolvedActor
  readonly origin: EventOrigin
  readonly request: RequestInfo
  readonly jobs: JobQueue | undefined
  readonly installationUrl: string | undefined
}

/** Proof that the permission check passed for an installation action. */
export interface InstallationScope<
  A extends InstallationAction = InstallationAction,
> {
  readonly [scopeBrand]: true
  readonly action: A
  readonly tx: Transaction
  readonly actor: ResolvedActor
  readonly origin: EventOrigin
  readonly request: RequestInfo
  readonly jobs: JobQueue | undefined
  readonly installationUrl: string | undefined
}
