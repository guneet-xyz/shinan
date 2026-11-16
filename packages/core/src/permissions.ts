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
  /** Roles allowed to take the action. */
  roles: readonly Role[]
  /**
   * For agents: the token needs at least one of these scopes, or `"people"`
   * when the action is reserved for people (identity §6.3). An agent is also
   * limited by its member's role.
   */
  agents: readonly Scope[] | "people"
  /** Sensitive actions need a recent sign-in (identity §3.3). */
  reauthentication: boolean
}

/** Actions outside any workspace, at the level of the installation. */
export interface InstallationRule {
  level: "installation"
  people: boolean
  shinan: boolean
}

export type Rule = WorkspaceRule | InstallationRule

/**
 * Any `read` scope reads everything in the workspace, because there is no
 * restricted level (identity §7.2, O-2).
 */
const anyRead: readonly Scope[] = ["catalog:read", "tasks:read"]

export const rules = {
  /** Set up the installation record. */
  "installation.set-up": { level: "installation", people: false, shinan: true },
  /** Create a person's account; the sign-in flow (M1-4) does this. */
  "person.create": { level: "installation", people: false, shinan: true },
  /** Any person on the installation can create a workspace (identity §4). */
  "workspace.create": { level: "installation", people: true, shinan: false },
  /** Read the workspace: members, timeline (identity §5.1, first row). */
  "workspace.read": {
    level: "workspace",
    roles: ["owner", "contributor"],
    agents: anyRead,
    reauthentication: false,
  },
  /**
   * Add a member. Joining needs an invitation (D-034); invitations (M1-4)
   * call this when one is accepted.
   */
  "member.add": {
    level: "workspace",
    roles: ["owner"],
    agents: "people",
    reauthentication: true,
  },
  "member.change-role": {
    level: "workspace",
    roles: ["owner"],
    agents: "people",
    reauthentication: true,
  },
  "member.remove": {
    level: "workspace",
    roles: ["owner"],
    agents: "people",
    reauthentication: true,
  },
  /** A member leaves the workspace themselves (identity §5.3). */
  "member.leave": {
    level: "workspace",
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
    roles: ["owner", "contributor"],
    agents: "people",
    reauthentication: false,
  },
} as const satisfies Record<string, Rule>

export type Action = keyof typeof rules
export type WorkspaceAction = {
  [A in Action]: (typeof rules)[A] extends WorkspaceRule ? A : never
}[Action]
export type InstallationAction = Exclude<Action, WorkspaceAction>

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
}

/**
 * Decides whether a requester may take an action. Pure: the database lookups
 * that fill in the requester happen in `authorize`.
 */
export function decide(rule: Rule, requester: Requester): Decision {
  if (rule.level === "installation") {
    if (requester.kind === "person" && rule.people) return allow
    if (requester.kind === "shinan" && rule.shinan) return allow
    return refuse("actor")
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

  if (rule.reauthentication && !requester.reauthenticated) {
    return refuse("reauthentication")
  }
  return allow
}

const allow: Decision = { allowed: true }

function refuse(reason: RefusalReason): Decision {
  return { allowed: false, reason }
}
