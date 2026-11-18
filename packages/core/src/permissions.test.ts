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
      "workspace.change-settings",
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
      "member.invite",
      "workspace.change-settings",
    ] as const) {
      expect(allowed(action, stale)).toEqual({
        allowed: false,
        reason: "reauthentication",
      })
    }
    expect(allowed("workspace.read", stale)).toEqual({ allowed: true })
    expect(allowed("member.leave", stale)).toEqual({ allowed: true })
    expect(allowed("invitation.withdraw", stale)).toEqual({ allowed: true })
  })

  it("keeps invitations to workspace owners", () => {
    for (const action of [
      "invitation.read",
      "member.invite",
      "invitation.withdraw",
    ] as const) {
      expect(allowed(action, owner)).toEqual({ allowed: true })
      expect(allowed(action, contributor)).toEqual({
        allowed: false,
        reason: "role",
      })
      expect(allowed(action, ownersAgent)).toEqual({
        allowed: false,
        reason: "people-only",
      })
    }
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
        "workspace.change-settings",
        "member.invite",
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

    it("lets only people read their own account", () => {
      expect(allowed("account.read", { kind: "person" })).toEqual({
        allowed: true,
      })
      for (const requester of [ownersAgent, { kind: "shinan" } as const]) {
        expect(allowed("account.read", requester)).toEqual({
          allowed: false,
          reason: "actor",
        })
      }
    })

    it("leaves account creation, sign-in, set-up and sending email to Shinan", () => {
      for (const action of [
        "person.create",
        "installation.set-up",
        "email.deliver",
        "email.prune",
        "rate-limit",
        "sign-in",
        "account.recover",
      ] as const) {
        expect(allowed(action, { kind: "shinan" })).toEqual({ allowed: true })
        expect(allowed(action, { kind: "person" })).toEqual({
          allowed: false,
          reason: "actor",
        })
      }
    })
  })

  describe("sign-in methods and sessions", () => {
    it("asks for re-authentication to add or remove GitHub", () => {
      expect(
        allowed("sign-in-method.change", {
          kind: "person",
          reauthenticated: true,
        }),
      ).toEqual({ allowed: true })
      expect(
        allowed("sign-in-method.change", {
          kind: "person",
          reauthenticated: false,
        }),
      ).toEqual({ allowed: false, reason: "reauthentication" })
      expect(allowed("sign-in-method.change", ownersAgent)).toEqual({
        allowed: false,
        reason: "actor",
      })
    })

    it("lets people end their sessions and answer invitations without it", () => {
      for (const action of [
        "sign-in-session.end",
        "invitation.respond",
      ] as const) {
        expect(
          allowed(action, { kind: "person", reauthenticated: false }),
        ).toEqual({ allowed: true })
        expect(allowed(action, ownersAgent)).toEqual({
          allowed: false,
          reason: "actor",
        })
      }
    })
  })

  describe("the email allowlist", () => {
    const operator: Requester = {
      kind: "person",
      operator: true,
      reauthenticated: true,
    }

    it("is kept by installation operators only", () => {
      for (const action of ["allowlist.read", "allowlist.change"] as const) {
        expect(allowed(action, operator)).toEqual({ allowed: true })
        expect(
          allowed(action, { kind: "person", reauthenticated: true }),
        ).toEqual({ allowed: false, reason: "role" })
        expect(allowed(action, { kind: "shinan" })).toEqual({
          allowed: false,
          reason: "actor",
        })
        expect(allowed(action, { ...ownersAgent, operator: true })).toEqual({
          allowed: false,
          reason: "actor",
        })
      }
    })

    it("changes only with re-authentication", () => {
      expect(
        allowed("allowlist.change", { ...operator, reauthenticated: false }),
      ).toEqual({ allowed: false, reason: "reauthentication" })
      expect(
        allowed("allowlist.read", { ...operator, reauthenticated: false }),
      ).toEqual({ allowed: true })
    })
  })

  describe("the catalog and its agent index", () => {
    it("lets every member read the catalog, and agents with catalog:read", () => {
      expect(allowed("catalog.read", owner)).toEqual({ allowed: true })
      expect(allowed("catalog.read", contributor)).toEqual({ allowed: true })
      expect(
        allowed("catalog.read", { ...ownersAgent, scopes: ["catalog:read"] }),
      ).toEqual({ allowed: true })
      expect(
        allowed("catalog.read", { ...ownersAgent, scopes: ["tasks:read"] }),
      ).toEqual({ allowed: false, reason: "scope" })
      expect(allowed("catalog.read", { kind: "shinan" })).toEqual({
        allowed: false,
        reason: "actor",
      })
    })

    it("lets every member, and no agent, record the pages they opened", () => {
      expect(allowed("catalog.mark-opened", owner)).toEqual({ allowed: true })
      expect(allowed("catalog.mark-opened", contributor)).toEqual({
        allowed: true,
      })
      expect(
        allowed("catalog.mark-opened", {
          ...ownersAgent,
          scopes: ["catalog:read", "catalog:propose"],
        }),
      ).toMatchObject({ allowed: false })
    })

    it("lets every member propose, and agents with catalog:propose", () => {
      expect(allowed("catalog.propose", owner)).toEqual({ allowed: true })
      expect(allowed("catalog.propose", contributor)).toEqual({ allowed: true })
      expect(
        allowed("catalog.propose", {
          ...ownersAgent,
          scopes: ["catalog:propose"],
        }),
      ).toEqual({ allowed: true })
      expect(
        allowed("catalog.propose", {
          ...ownersAgent,
          scopes: ["catalog:read"],
        }),
      ).toEqual({ allowed: false, reason: "scope" })
    })

    it("reserves catalog approval for people", () => {
      expect(allowed("catalog.approve", owner)).toEqual({ allowed: true })
      expect(allowed("catalog.approve", contributor)).toEqual({ allowed: true })
      expect(
        allowed("catalog.approve", {
          ...ownersAgent,
          scopes: ["catalog:read", "catalog:propose"],
        }),
      ).toEqual({ allowed: false, reason: "people-only" })
    })

    it("lets only Shinan keep the index in step", () => {
      expect(allowed("catalog-index.maintain", { kind: "shinan" })).toEqual({
        allowed: true,
      })
      expect(
        allowed("catalog-index.maintain", {
          kind: "person",
          operator: true,
          reauthenticated: true,
        }),
      ).toEqual({ allowed: false, reason: "actor" })
    })

    it("shows the index's health to operators, not other people or agents", () => {
      expect(
        allowed("catalog-index.read-health", {
          kind: "person",
          operator: true,
        }),
      ).toEqual({ allowed: true })
      expect(allowed("catalog-index.read-health", { kind: "person" })).toEqual({
        allowed: false,
        reason: "role",
      })
      expect(
        allowed("catalog-index.read-health", {
          ...ownersAgent,
          operator: true,
        }),
      ).toEqual({ allowed: false, reason: "actor" })
    })
  })

  describe("agents and tokens", () => {
    it("lets every member see, register and change their agents", () => {
      for (const person of [owner, contributor]) {
        for (const action of [
          "agent.read",
          "agent.create",
          "agent.change",
        ] as const) {
          expect(allowed(action, person)).toEqual({ allowed: true })
        }
      }
    })

    it("asks for re-authentication only to issue a token", () => {
      const stale = { ...contributor, reauthenticated: false }
      expect(allowed("agent.create", stale)).toEqual({
        allowed: false,
        reason: "reauthentication",
      })
      expect(allowed("agent.change", stale)).toEqual({ allowed: true })
      expect(allowed("agent.read", stale)).toEqual({ allowed: true })
    })

    it("never lets an agent register agents or touch tokens", () => {
      for (const action of [
        "agent.read",
        "agent.create",
        "agent.change",
      ] as const) {
        expect(allowed(action, ownersAgent)).toEqual({
          allowed: false,
          reason: "people-only",
        })
      }
    })

    it("leaves checking tokens to Shinan", () => {
      expect(allowed("agent-token.authenticate", { kind: "shinan" })).toEqual({
        allowed: true,
      })
      expect(allowed("agent-token.authenticate", owner)).toEqual({
        allowed: false,
        reason: "actor",
      })
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

describe("rules", () => {
  it("cannot be changed at run time", () => {
    const remove = rules["member.remove"] as unknown as {
      roles: string[]
      reauthentication: boolean
    }
    expect(Object.isFrozen(rules)).toBe(true)
    expect(() => remove.roles.push("contributor")).toThrow(TypeError)
    expect(() => {
      remove.reauthentication = false
    }).toThrow(TypeError)
    expect(() => {
      ;(rules as Record<string, unknown>)["member.remove"] = {}
    }).toThrow(TypeError)
    expect(
      decide(rules["member.remove"], {
        kind: "person",
        role: "contributor",
        reauthenticated: true,
      }),
    ).toEqual({ allowed: false, reason: "role" })
  })
})
