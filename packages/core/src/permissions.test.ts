import { describe, expect, it } from "vitest"

import type { Scope } from "./actor.js"
import { decide, rules } from "./permissions.js"
import type { Requester, WorkspaceAction } from "./permissions.js"

const owner: Requester = {
  kind: "person",
  role: "owner",
  reauthenticated: true,
}
const contributor: Requester = {
  kind: "person",
  role: "contributor",
  reauthenticated: true,
}
const allScopes: Scope[] = [
  "catalog:read",
  "catalog:propose",
  "tasks:read",
  "tasks:write",
  "presence",
]
const ownersAgent: Requester = {
  kind: "agent",
  role: "owner",
  scopes: allScopes,
}

function allowed(action: keyof typeof rules, requester: Requester) {
  return decide(rules[action], requester)
}

describe("decide", () => {
  it("lets every member read the workspace", () => {
    expect(allowed("workspace.read", owner)).toEqual({ allowed: true })
    expect(allowed("workspace.read", contributor)).toEqual({ allowed: true })
  })

  it("refuses people who are not members", () => {
    expect(allowed("workspace.read", { kind: "person" })).toEqual({
      allowed: false,
      reason: "not-member",
    })
  })

  it("keeps managing members to workspace owners", () => {
    const actions: WorkspaceAction[] = [
      "member.add",
      "member.change-role",
      "member.remove",
    ]
    for (const action of actions) {
      expect(allowed(action, owner)).toEqual({ allowed: true })
      expect(allowed(action, contributor)).toEqual({
        allowed: false,
        reason: "role",
      })
    }
  })

  it("lets any member leave", () => {
    expect(allowed("member.leave", contributor)).toEqual({ allowed: true })
    expect(allowed("member.leave", owner)).toEqual({ allowed: true })
  })

  it("asks for re-authentication before sensitive actions", () => {
    const stale = { ...owner, reauthenticated: false }
    for (const action of [
      "member.add",
      "member.change-role",
      "member.remove",
    ] as const) {
      expect(allowed(action, stale)).toEqual({
        allowed: false,
        reason: "reauthentication",
      })
    }
    expect(allowed("workspace.read", stale)).toEqual({ allowed: true })
    expect(allowed("member.leave", stale)).toEqual({ allowed: true })
  })

  it("checks the role before re-authentication", () => {
    expect(
      allowed("member.remove", { ...contributor, reauthenticated: false }),
    ).toEqual({ allowed: false, reason: "role" })
  })

  describe("for agents", () => {
    it("reserves managing members and the security log for people", () => {
      for (const action of [
        "member.add",
        "member.change-role",
        "member.remove",
        "member.leave",
        "security-log.read",
      ] as const) {
        expect(allowed(action, ownersAgent)).toEqual({
          allowed: false,
          reason: "people-only",
        })
      }
    })

    it("reads with either read scope", () => {
      for (const scope of ["catalog:read", "tasks:read"] as const) {
        expect(
          allowed("workspace.read", { ...ownersAgent, scopes: [scope] }),
        ).toEqual({ allowed: true })
      }
    })

    it("does not read without a read scope", () => {
      expect(
        allowed("workspace.read", {
          ...ownersAgent,
          scopes: ["tasks:write", "presence"],
        }),
      ).toEqual({ allowed: false, reason: "scope" })
    })

    it("never does more than its member", () => {
      expect(
        allowed("workspace.read", { kind: "agent", scopes: allScopes }),
      ).toEqual({ allowed: false, reason: "not-member" })
    })
  })

  describe("at the installation", () => {
    it("lets people, not agents or Shinan, create workspaces", () => {
      expect(allowed("workspace.create", { kind: "person" })).toEqual({
        allowed: true,
      })
      expect(allowed("workspace.create", ownersAgent)).toEqual({
        allowed: false,
        reason: "actor",
      })
      expect(allowed("workspace.create", { kind: "shinan" })).toEqual({
        allowed: false,
        reason: "actor",
      })
    })

    it("leaves account creation and set-up to Shinan", () => {
      for (const action of ["person.create", "installation.set-up"] as const) {
        expect(allowed(action, { kind: "shinan" })).toEqual({ allowed: true })
        expect(allowed(action, { kind: "person" })).toEqual({
          allowed: false,
          reason: "actor",
        })
      }
    })
  })

  it("never lets Shinan act inside a workspace yet", () => {
    for (const action of Object.keys(rules) as (keyof typeof rules)[]) {
      if (rules[action].level !== "workspace") continue
      expect(allowed(action, { kind: "shinan" })).toEqual({
        allowed: false,
        reason: "actor",
      })
    }
  })
})
