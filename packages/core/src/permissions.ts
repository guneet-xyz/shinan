import type { Role } from "@shinan/db"

import type { Scope } from "./actor.js"
import type { RefusalReason } from "./errors.js"

/**
 * Who may take an action inside a workspace. This table is the code form of
 * identity §5.1 and §6.3; each operation names one action, and the single
 * check path (`authorize`) applies it.
 */
export interface WorkspaceRule {
  level: "workspace"
  /** Whether the action changes anything; only writes may append events. */
  access: Access
  /** Roles allowed to take the action. */
  roles: readonly Role[]
  /**
   * For agents: the token needs at least one of these scopes, or `"people"`
   * when the action is reserved for people (identity §6.3). An agent is also
   * limited by its member's role.
   */
  agents: readonly Scope[] | "people"
  /** Only agents take the action, never people themselves. */
  agentsOnly?: boolean
  /** Sensitive actions need a recent sign-in (identity §3.3). */
  reauthentication: boolean
}

/** Actions outside any workspace, at the level of the installation. */
export interface InstallationRule {
  level: "installation"
  access: Access
  /** Any person may take the action. */
  people: boolean
  /** Installation operators may take it (identity §12). */
  operators?: boolean
  shinan: boolean
  /** Sensitive actions need a recent sign-in (identity §3.3). */
  reauthentication?: boolean
}

export type Access = "read" | "write"

export type Rule = WorkspaceRule | InstallationRule

/**
 * Any `read` scope reads everything in the workspace, because there is no
 * restricted level (identity §7.2, O-2).
 */
const anyRead: readonly Scope[] = ["catalog:read", "tasks:read"]

/**
 * Frozen all the way down, so no caller can widen what `decide()` allows at
 * run time; `as const` only protects against that in the type checker.
 */
export const rules = deepFreeze({
  /** Set up the installation record. */
  "installation.set-up": {
    level: "installation",
    access: "write",
    people: false,
    shinan: true,
  },
  /**
   * Create a person's account. Only the sign-in operations do this, when an
   * allowlisted address first opens a magic link (identity §3.2).
   */
  "person.create": {
    level: "installation",
    access: "write",
    people: false,
    shinan: true,
  },
  /**
   * The sign-in layer's own steps, taken as Shinan before anyone is signed
   * in: sending magic links, opening them, starting sign-in sessions and
   * the first start (identity §3).
   */
  "sign-in": {
    level: "installation",
    access: "write",
    people: false,
    shinan: true,
  },
  /**
   * The operator's server commands for recovery (identity §3.4): ending a
   * person's sign-in sessions and changing their email address.
   */
  "account.recover": {
    level: "installation",
    access: "write",
    people: false,
    shinan: true,
  },
  /** A person ends their own sign-in sessions (identity §3.3). */
  "sign-in-session.end": {
    level: "installation",
    access: "write",
    people: true,
    shinan: false,
  },
  /**
   * Add or remove GitHub as a sign-in method: with re-authentication
   * (identity §3.3).
   */
  "sign-in-method.change": {
    level: "installation",
    access: "write",
    people: true,
    shinan: false,
    reauthentication: true,
  },
  /**
   * Shinan records pending invitations past their expiry as `expired`, with
   * the event, in a scheduled job (identity §5.2, §11).
   */
  "invitation.expire": {
    level: "installation",
    access: "write",
    people: false,
    shinan: true,
  },
  /**
   * A person asks to change their own email address (identity §3.4): with
   * re-authentication, like adding or removing a sign-in method, since the
   * address is how they sign in.
   */
  "email-change.request": {
    level: "installation",
    access: "write",
    people: true,
    shinan: false,
    reauthentication: true,
  },
  /**
   * A person confirms the change from the link sent to the new address, or
   * cancels it. No re-authentication: the link proves the new mailbox, and
   * cancelling only keeps things as they are.
   */
  "email-change.complete": {
    level: "installation",
    access: "write",
    people: true,
    shinan: false,
  },
  /** A person accepts or declines an invitation to their address (§5.2). */
  "invitation.respond": {
    level: "installation",
    access: "write",
    people: true,
    shinan: false,
  },
  /** Operators read the email allowlist (identity §3.2). */
  "allowlist.read": {
    level: "installation",
    access: "read",
    people: false,
    operators: true,
    shinan: false,
  },
  /**
   * Operators add and remove addresses, with re-authentication: it decides
   * who can have an account at all (identity §3.2).
   */
  "allowlist.change": {
    level: "installation",
    access: "write",
    people: false,
    operators: true,
    shinan: false,
    reauthentication: true,
  },
  /** Send a queued email and record how it ended; the worker does this. */
  "email.deliver": {
    level: "installation",
    access: "write",
    people: false,
    shinan: true,
  },
  /** Delete old email records (architecture §4.2); the worker does this. */
  "email.prune": {
    level: "installation",
    access: "write",
    people: false,
    shinan: true,
  },
  /**
   * Count requests against rate limits and delete old counts (architecture
   * §10.1). Shinan does this for every request, before anyone is signed in.
   */
  "rate-limit": {
    level: "installation",
    access: "write",
    people: false,
    shinan: true,
  },
  /** Any person on the installation can create a workspace (identity §4). */
  "workspace.create": {
    level: "installation",
    access: "write",
    people: true,
    shinan: false,
  },
  /**
   * A person reads their own account: profile and the workspaces they belong
   * to (human experience, Your account). It shows nothing about others.
   */
  "account.read": {
    level: "installation",
    access: "read",
    people: true,
    shinan: false,
  },
  /** Read the workspace: members, timeline (identity §5.1, first row). */
  "workspace.read": {
    level: "workspace",
    access: "read",
    roles: ["owner", "contributor"],
    agents: anyRead,
    reauthentication: false,
  },
  /**
   * Read the catalog through the agent index: entities, type schemas,
   * search, the workspace lists and the start-here path. Everyone in the
   * workspace sees the whole catalog (catalog §7.1); agents need
   * `catalog:read` (identity §7.2).
   */
  "catalog.read": {
    level: "workspace",
    access: "read",
    roles: ["owner", "contributor"],
    agents: ["catalog:read"],
    reauthentication: false,
  },
  /**
   * Clone and fetch the catalog's repository over HTTPS (Git-based catalog
   * plan §2.14): agents with `catalog:read`. People read the catalog in the
   * browser (`catalog.read`); the Git endpoint takes only agent tokens.
   */
  "catalog.fetch": {
    level: "workspace",
    access: "read",
    roles: ["owner", "contributor"],
    agents: ["catalog:read"],
    agentsOnly: true,
    reauthentication: false,
  },
  /**
   * Push to the catalog's repository (plan §2.14): agents with
   * `catalog:write`. People do not push; they use their agents. What a push
   * may change is the push checks' (plan §2.5).
   */
  "catalog.push": {
    level: "workspace",
    access: "write",
    roles: ["owner", "contributor"],
    agents: ["catalog:write"],
    agentsOnly: true,
    reauthentication: false,
  },
  /**
   * Purge catalog content (catalog §9; architecture §4.4): replace a text
   * with a marker wherever the catalog stores it, and see where it is
   * first. Workspace owners only, with re-authentication (identity §3.3,
   * §5.1, O-50); never agents.
   */
  "catalog.purge": {
    level: "workspace",
    access: "write",
    roles: ["owner"],
    agents: "people",
    reauthentication: true,
  },
  /**
   * Follow a purge while it runs and see how it ended (review of #197):
   * workspace owners, without signing in again, so a purge of minutes can
   * be followed to its end; never agents. Counts only, never the text.
   */
  "catalog.purge-status": {
    level: "workspace",
    access: "read",
    roles: ["owner"],
    agents: "people",
    reauthentication: false,
  },
  /**
   * Keep the agent index in step with the stored text: rebuild it, run the
   * daily round-trip check, and ask for rebuilds after the parser changed
   * (architecture §5.2, §5.3, §7). The worker and the operator's server
   * command do this as Shinan.
   */
  "catalog-index.maintain": {
    level: "installation",
    access: "write",
    people: false,
    shinan: true,
  },
  /**
   * Store what the Git container's journal records (Git-based catalog plan
   * §2.6): the push log, first pushers, `catalog.pushed` events and the
   * security log, and compare the log with the repositories' refs. `web`
   * and the worker do this as Shinan.
   */
  "catalog-push.record": {
    level: "installation",
    access: "write",
    people: false,
    shinan: true,
  },
  /**
   * See the values a workspace's owners allowed as "not a secret" (plan
   * §2.5, GQ-2): fingerprints only. Workspace owners.
   */
  "catalog-allowed-value.read": {
    level: "workspace",
    access: "read",
    roles: ["owner"],
    agents: "people",
    reauthentication: false,
  },
  /**
   * Allow a value as "not a secret", or remove one (GQ-2): workspace
   * owners, after signing in again; never agents.
   */
  "catalog-allowed-value.change": {
    level: "workspace",
    access: "write",
    roles: ["owner"],
    agents: "people",
    reauthentication: true,
  },
  /**
   * Make a workspace's catalog repository in the Git container once the
   * workspace exists (Git-based catalog plan §2.4). The worker does this as
   * Shinan; the request is made when the workspace is created.
   */
  "catalog-repository.create": {
    level: "installation",
    access: "write",
    people: false,
    shinan: true,
  },
  /**
   * Move M2's catalog into each workspace's repository during the upgrade
   * to v0.4.0 (Git-based catalog plan §4.1): `migrate` does this as
   * Shinan, before the drop of M2's tables.
   */
  "catalog.move": {
    level: "installation",
    access: "write",
    people: false,
    shinan: true,
  },
  /**
   * Installation operators see the agent index's health: which workspaces'
   * indexes are behind or failed the round-trip check (architecture §5.2,
   * rule 5, §13). It shows workspace IDs and counts, never catalog content.
   */
  "catalog-index.read-health": {
    level: "installation",
    access: "read",
    people: false,
    operators: true,
    shinan: true,
  },
  /**
   * Add a member. Joining needs an invitation (D-034); invitations (M1-4)
   * call this when one is accepted.
   */
  "member.add": {
    level: "workspace",
    access: "write",
    roles: ["owner"],
    agents: "people",
    reauthentication: true,
  },
  "member.change-role": {
    level: "workspace",
    access: "write",
    roles: ["owner"],
    agents: "people",
    reauthentication: true,
  },
  "member.remove": {
    level: "workspace",
    access: "write",
    roles: ["owner"],
    agents: "people",
    reauthentication: true,
  },
  /**
   * Change workspace settings, such as its name: workspace owners only, with
   * re-authentication (identity §3.3, §5.1).
   */
  "workspace.change-settings": {
    level: "workspace",
    access: "write",
    roles: ["owner"],
    agents: "people",
    reauthentication: true,
  },
  /** Workspace owners see the workspace's invitations (identity §5.1). */
  "invitation.read": {
    level: "workspace",
    access: "read",
    roles: ["owner"],
    agents: "people",
    reauthentication: false,
  },
  /**
   * Invite someone, or send an invitation again: workspace owners, with
   * re-authentication (identity §3.3, §5.1).
   */
  "member.invite": {
    level: "workspace",
    access: "write",
    roles: ["owner"],
    agents: "people",
    reauthentication: true,
  },
  /** Withdraw a pending invitation (identity §5.1, §5.2). */
  "invitation.withdraw": {
    level: "workspace",
    access: "write",
    roles: ["owner"],
    agents: "people",
    reauthentication: false,
  },
  /** A member leaves the workspace themselves (identity §5.3). */
  "member.leave": {
    level: "workspace",
    access: "write",
    roles: ["owner", "contributor"],
    agents: "people",
    reauthentication: false,
  },
  /**
   * Workspace owners read the whole workspace security log; contributors only
   * their own entries (identity §5.1, §11).
   */
  "security-log.read": {
    level: "workspace",
    access: "read",
    roles: ["owner", "contributor"],
    agents: "people",
    reauthentication: false,
  },
  /**
   * Check an agent token on a request to an agent endpoint, and count and
   * summarise its use (identity §7, §10, §11). Shinan does this before
   * anyone is known.
   */
  "agent-token.authenticate": {
    level: "installation",
    access: "write",
    people: false,
    shinan: true,
  },
  /**
   * See agents and their tokens: workspace owners see every agent,
   * contributors only their own (identity §5.1, "own"). Reserved for people:
   * token use includes network addresses (identity §11).
   */
  "agent.read": {
    level: "workspace",
    access: "read",
    roles: ["owner", "contributor"],
    agents: "people",
    reauthentication: false,
  },
  /**
   * Register an agent or issue its token by hand, for the member themselves
   * only, after signing in again (identity §5.1, §6.2, §6.3).
   */
  "agent.create": {
    level: "workspace",
    access: "write",
    roles: ["owner", "contributor"],
    agents: "people",
    reauthentication: true,
  },
  /**
   * Rename, enable or disable an agent, or revoke its token: the member for
   * their own agents; a workspace owner may also disable any agent and
   * revoke any token (identity §5.1, §7.5). Each takes access away or
   * changes only a label, so no new sign-in is needed.
   */
  "agent.change": {
    level: "workspace",
    access: "write",
    roles: ["owner", "contributor"],
    agents: "people",
    reauthentication: false,
  },
} as const satisfies Record<string, Rule>)

export type Action = keyof typeof rules
export type WorkspaceAction = {
  [A in Action]: (typeof rules)[A] extends WorkspaceRule ? A : never
}[Action]
export type InstallationAction = Exclude<Action, WorkspaceAction>
/** Actions that change something, and so may append events. */
export type WriteAction = {
  [A in Action]: (typeof rules)[A]["access"] extends "write" ? A : never
}[Action]

export type Decision =
  { allowed: true } | { allowed: false; reason: RefusalReason }

export interface Requester {
  kind: "person" | "agent" | "shinan"
  /** The member's role, or the role of the member an agent acts for. */
  role?: Role
  /** For agents, the token's scopes. */
  scopes?: readonly Scope[]
  /** For people, whether they signed in again recently. */
  reauthenticated?: boolean
  /** For people, whether they are an installation operator. */
  operator?: boolean
}

/**
 * Decides whether a requester may take an action. Pure: the database lookups
 * that fill in the requester happen in `authorize`.
 */
export function decide(rule: Rule, requester: Requester): Decision {
  if (rule.level === "installation") {
    if (requester.kind === "shinan")
      return rule.shinan ? allow : refuse("actor")
    if (requester.kind !== "person") return refuse("actor")
    if (!rule.people && !(rule.operators && requester.operator)) {
      return refuse(rule.operators ? "role" : "actor")
    }
    if (rule.reauthentication && !requester.reauthenticated) {
      return refuse("reauthentication")
    }
    return allow
  }

  if (requester.kind === "shinan") return refuse("actor")
  if (!requester.role) return refuse("not-member")
  if (!rule.roles.includes(requester.role)) return refuse("role")

  if (requester.kind === "agent") {
    if (rule.agents === "people") return refuse("people-only")
    const granted = requester.scopes ?? []
    if (!rule.agents.some((scope) => granted.includes(scope))) {
      return refuse("scope")
    }
    return allow
  }

  if (rule.agentsOnly) return refuse("actor")
  if (rule.reauthentication && !requester.reauthenticated) {
    return refuse("reauthentication")
  }
  return allow
}

const allow: Decision = { allowed: true }

function refuse(reason: RefusalReason): Decision {
  return { allowed: false, reason }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
