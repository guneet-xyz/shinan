import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

import type * as Api from "@shinan/api-client"
import {
  addMember,
  createPerson,
  createWorkspace,
  setUpInstallation,
  shinan,
} from "@shinan/core"
import type { Person } from "@shinan/core"
import { connectTestDatabase } from "@shinan/db/testing"

import { as, testSignIn } from "../../test/sign-in.js"
import { createApi } from "./routes.js"
import type { SignIn } from "./sign-in.js"

const { db, pool } = connectTestDatabase()

afterAll(async () => {
  await pool.end()
})

const api = createApi({ db, signIn: testSignIn })

let owner: Person
let contributor: Person
let workspaceId: string
let ownerMemberId: string
let contributorMemberId: string

let counter = 0
async function newPerson(prefix: string): Promise<Person> {
  const handle = `${prefix}-${process.pid}-${Date.now()}-${counter++}`
  return createPerson(
    { db, actor: shinan },
    { handle, name: `Person ${handle}`, email: `${handle}@example.com` },
  )
}

beforeEach(async () => {
  owner = await newPerson("owner")
  contributor = await newPerson("contributor")
  const created = await createWorkspace(
    { db, actor: { kind: "person", personId: owner.id } },
    { name: "Team" },
  )
  workspaceId = created.workspace.id
  ownerMemberId = created.member.id
  const member = await addMember(
    {
      db,
      actor: { kind: "person", personId: owner.id, reauthenticated: true },
    },
    { workspaceId, personId: contributor.id, role: "contributor" },
  )
  contributorMemberId = member.id
})

interface Call {
  method?: string
  body?: unknown
  headers?: Record<string, string>
}

async function call(path: string, { method, body, headers }: Call = {}) {
  return api.request(path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body:
      body === undefined
        ? undefined
        : typeof body === "string"
          ? body
          : JSON.stringify(body),
  })
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

const ws = (path = "") => `/workspaces/${workspaceId}${path}`

describe("without sign-in", () => {
  it("refuses every workspace and account route with 401", async () => {
    for (const path of [
      "/account",
      ws(),
      ws("/members"),
      ws("/security-log"),
      ws("/events"),
      ws("/invitations"),
    ]) {
      const response = await call(path)
      expect(response.status, path).toBe(401)
      expect(await response.json()).toEqual({
        error: "sign-in-required",
        message: "Sign in to continue",
      })
    }
    const write = await call(ws("/members/" + contributorMemberId), {
      method: "DELETE",
    })
    expect(write.status).toBe(401)
  })

  it("shows the installation's name", async () => {
    await setUpInstallation({ db, actor: shinan }, { name: "Shinan" })
    const response = await call("/installation")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ name: "Shinan" })
  })

  it("answers unknown paths with 404, not 401", async () => {
    const response = await call("/nope")
    expect(response.status).toBe(404)
  })
})

describe("GET /account", () => {
  it("shows the person and their workspaces with their role", async () => {
    const response = await call("/account", { headers: as(contributor) })

    expect(response.status).toBe(200)
    const account = await json<Api.Account>(response)
    expect(account.person).toMatchObject({
      id: contributor.id,
      handle: contributor.handle,
      email: contributor.email,
    })
    expect(account.workspaces).toEqual([
      {
        id: workspaceId,
        name: "Team",
        role: "contributor",
        memberId: contributorMemberId,
        joinedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) as string,
      },
    ])
  })
})

describe("workspaces", () => {
  it("shows the workspace with the reader's role", async () => {
    const response = await call(ws(), { headers: as(contributor) })
    expect(response.status).toBe(200)
    expect(await json<Api.Workspace>(response)).toMatchObject({
      id: workspaceId,
      name: "Team",
      role: "contributor",
    })
  })

  it("answers 404 alike for non-members, unknown and malformed IDs", async () => {
    const outsider = await newPerson("outsider")
    for (const path of [
      ws(),
      `/workspaces/${crypto.randomUUID()}`,
      "/workspaces/not-an-id",
      ws("/members"),
    ]) {
      const response = await call(path, { headers: as(outsider) })
      expect(response.status, path).toBe(404)
      expect(await response.json()).toEqual({
        error: "not-found",
        message: "Not found",
      })
    }
  })

  it("lets a workspace owner rename it", async () => {
    const response = await call(ws(), {
      method: "PATCH",
      body: { name: "Crew" },
      headers: as(owner),
    })
    expect(response.status).toBe(200)
    expect(await json<Api.Workspace>(response)).toMatchObject({
      name: "Crew",
      role: "owner",
    })
  })

  it("asks for re-authentication before renaming", async () => {
    const response = await call(ws(), {
      method: "PATCH",
      body: { name: "Crew" },
      headers: as(owner, { reauthenticated: false }),
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: "reauthentication-required",
      message: "Sign in again to continue",
    })
  })

  it("refuses contributors with 403", async () => {
    const response = await call(ws(), {
      method: "PATCH",
      body: { name: "Crew" },
      headers: as(contributor),
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: "forbidden",
      message: "You are not allowed to do that",
      reason: "role",
    })
  })

  it("answers 422 for invalid input", async () => {
    const cases: unknown[] = [{ name: "  " }, { name: 3 }, {}, "not json", []]
    for (const body of cases) {
      const response = await call(ws(), {
        method: "PATCH",
        body,
        headers: as(owner),
      })
      expect(response.status, JSON.stringify(body)).toBe(422)
      expect(await json<Api.ErrorBody>(response)).toMatchObject({
        error: "invalid-input",
      })
    }
  })

  it("lets a member leave", async () => {
    const response = await call(ws("/leave"), {
      method: "POST",
      headers: as(contributor),
    })
    expect(response.status).toBe(204)
    const after = await call(ws(), { headers: as(contributor) })
    expect(after.status).toBe(404)
  })

  it("does not let the last workspace owner leave", async () => {
    const response = await call(ws("/leave"), {
      method: "POST",
      headers: as(owner),
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: "conflict",
      message: "A workspace always has at least one workspace owner",
      rule: "last-owner",
    })
  })
})

describe("members", () => {
  it("lists members with who invited them", async () => {
    const response = await call(ws("/members"), { headers: as(contributor) })
    expect(response.status).toBe(200)
    const members = await json<Api.Member[]>(response)
    expect(
      members.map((m) => ({
        id: m.id,
        handle: m.handle,
        role: m.role,
        by: m.invitedByHandle,
      })),
    ).toEqual([
      { id: ownerMemberId, handle: owner.handle, role: "owner", by: null },
      {
        id: contributorMemberId,
        handle: contributor.handle,
        role: "contributor",
        by: owner.handle,
      },
    ])
  })

  it("changes a role", async () => {
    const response = await call(ws(`/members/${contributorMemberId}`), {
      method: "PATCH",
      body: { role: "owner" },
      headers: as(owner),
    })
    expect(response.status).toBe(200)
    expect(await json<Api.Member>(response)).toMatchObject({
      id: contributorMemberId,
      role: "owner",
    })
  })

  it("refuses a role that does not exist", async () => {
    const response = await call(ws(`/members/${contributorMemberId}`), {
      method: "PATCH",
      body: { role: "viewer" },
      headers: as(owner),
    })
    expect(response.status).toBe(422)
    expect(await json<Api.ErrorBody>(response)).toMatchObject({
      error: "invalid-input",
      rule: "role-unknown",
    })
  })

  it("keeps the last workspace owner", async () => {
    const response = await call(ws(`/members/${ownerMemberId}`), {
      method: "PATCH",
      body: { role: "contributor" },
      headers: as(owner),
    })
    expect(response.status).toBe(409)
    expect(await json<Api.ErrorBody>(response)).toMatchObject({
      rule: "last-owner",
    })
  })

  it("asks for re-authentication before changing roles or removing", async () => {
    const headers = as(owner, { reauthenticated: false })
    const change = await call(ws(`/members/${contributorMemberId}`), {
      method: "PATCH",
      body: { role: "owner" },
      headers,
    })
    const remove = await call(ws(`/members/${contributorMemberId}`), {
      method: "DELETE",
      headers,
    })
    for (const response of [change, remove]) {
      expect(response.status).toBe(403)
      expect(await json<Api.ErrorBody>(response)).toMatchObject({
        error: "reauthentication-required",
      })
    }
  })

  it("removes a member, who loses access", async () => {
    const response = await call(ws(`/members/${contributorMemberId}`), {
      method: "DELETE",
      headers: as(owner),
    })
    expect(response.status).toBe(204)

    const members = await json<Api.Member[]>(
      await call(ws("/members"), { headers: as(owner) }),
    )
    expect(members.map((m) => m.id)).toEqual([ownerMemberId])
    const after = await call(ws("/members"), { headers: as(contributor) })
    expect(after.status).toBe(404)
  })

  it("answers 404 for an unknown member", async () => {
    const response = await call(ws(`/members/${crypto.randomUUID()}`), {
      method: "DELETE",
      headers: as(owner),
    })
    expect(response.status).toBe(404)
  })

  it("does not reach members of another workspace", async () => {
    const other = await createWorkspace(
      { db, actor: { kind: "person", personId: contributor.id } },
      { name: "Other" },
    )
    // The owner of the first workspace names a member of the second.
    const response = await call(ws(`/members/${other.member.id}`), {
      method: "DELETE",
      headers: as(owner),
    })
    expect(response.status).toBe(404)
    const elsewhere = await call(`/workspaces/${other.workspace.id}/members`, {
      headers: as(owner),
    })
    expect(elsewhere.status).toBe(404)
  })
})

describe("events", () => {
  it("lists the timeline newest first, in pages", async () => {
    await call(ws(), {
      method: "PATCH",
      body: { name: "Crew" },
      headers: as(owner),
    })

    const first = await json<Api.Page<Api.Event>>(
      await call(ws("/events?limit=1"), { headers: as(contributor) }),
    )
    expect(first.entries).toHaveLength(1)
    expect(first.entries[0]).toMatchObject({
      kind: "workspace.renamed",
      actorLabel: owner.handle,
      summary: `${owner.handle} renamed the workspace to Crew`,
    })
    expect(first.next).toBe(first.entries[0]!.id)
    expect(first.entries[0]).not.toHaveProperty("idempotencyKey")

    const rest = await json<Api.Page<Api.Event>>(
      await call(ws(`/events?before=${first.next}`), {
        headers: as(contributor),
      }),
    )
    expect(rest.entries.map((e) => e.kind)).toEqual([
      "member.added",
      "workspace.created",
    ])
    expect(rest.next).toBeNull()
  })

  it("answers 422 for a malformed page", async () => {
    for (const query of ["limit=ten", "before=-1", "before=1.5"]) {
      const response = await call(ws(`/events?${query}`), {
        headers: as(owner),
      })
      expect(response.status, query).toBe(422)
    }
  })
})

describe("security log", () => {
  it("shows workspace owners every entry, with the subject's handle", async () => {
    await call(ws(`/members/${contributorMemberId}`), {
      method: "PATCH",
      body: { role: "owner" },
      headers: { ...as(owner), "user-agent": "browser test" },
    })

    const page = await json<Api.Page<Api.SecurityLogEntry>>(
      await call(ws("/security-log"), { headers: as(owner) }),
    )
    expect(page.entries[0]).toMatchObject({
      action: "member.role-changed",
      outcome: "succeeded",
      actorLabel: owner.handle,
      subjectHandle: contributor.handle,
      client: "browser test",
      details: { from: "contributor", to: "owner" },
    })
    expect(page.entries.map((e) => e.action)).toContain("workspace.created")
  })

  it("shows contributors only their own entries", async () => {
    const page = await json<Api.Page<Api.SecurityLogEntry>>(
      await call(ws("/security-log"), { headers: as(contributor) }),
    )
    expect(page.entries.map((e) => e.action)).toEqual(["member.added"])
    expect(page.entries[0]).toMatchObject({
      subjectPersonId: contributor.id,
      networkAddress: null,
      client: null,
    })
  })
})

describe("invitations", () => {
  it("are not available until sign-in and accounts arrive", async () => {
    for (const [method, path] of [
      ["GET", ws("/invitations")],
      ["POST", ws("/invitations")],
      ["DELETE", ws(`/invitations/${crypto.randomUUID()}`)],
    ] as const) {
      const response = await call(path, { method, headers: as(owner) })
      expect(response.status, `${method} ${path}`).toBe(501)
      expect(await json<Api.ErrorBody>(response)).toMatchObject({
        error: "not-implemented",
      })
    }
  })
})

describe("sign-in routes", () => {
  it("answer 404 without a sign-in layer", async () => {
    const response = await call("/auth/sign-in/magic-link", {
      body: { email: "a@example.com" },
    })
    expect(response.status).toBe(404)
  })

  it("are served by the sign-in layer when it has them", async () => {
    const handle = vi.fn((request: Request) =>
      Promise.resolve(Response.json({ path: new URL(request.url).pathname })),
    )
    const signIn: SignIn = { ...testSignIn, handle }
    const response = await createApi({ db, signIn }).request(
      "/auth/sign-in/magic-link",
      { method: "POST" },
    )
    expect(await response.json()).toEqual({
      path: "/auth/sign-in/magic-link",
    })
    expect(handle).toHaveBeenCalledOnce()
  })
})

describe("headers from the sign-in layer", () => {
  function cookies(): Headers {
    const headers = new Headers()
    headers.append("set-cookie", "session=refreshed; HttpOnly")
    headers.append("set-cookie", "session_cache=x; HttpOnly")
    return headers
  }

  it("are added to answers for signed-in people, including errors", async () => {
    const signIn: SignIn = {
      async currentPerson(request) {
        const { person } = await testSignIn.currentPerson(request)
        return { person, headers: cookies() }
      },
    }
    const app = createApi({ db, signIn })

    const ok = await app.request(ws("/members"), { headers: as(owner) })
    expect(ok.status).toBe(200)
    expect(ok.headers.getSetCookie()).toEqual([
      "session=refreshed; HttpOnly",
      "session_cache=x; HttpOnly",
    ])

    const missing = await app.request(`/workspaces/${crypto.randomUUID()}`, {
      headers: as(owner),
    })
    expect(missing.status).toBe(404)
    expect(missing.headers.getSetCookie()).toHaveLength(2)
  })

  it("are added when nobody is signed in", async () => {
    const signIn: SignIn = {
      currentPerson: () =>
        Promise.resolve({ person: null, headers: cookies() }),
    }
    const response = await createApi({ db, signIn }).request("/account")

    expect(response.status).toBe(401)
    expect(response.headers.getSetCookie()).toHaveLength(2)
  })
})

describe("unexpected errors", () => {
  it("answer a generic 500 and are logged", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const failing: SignIn = {
      currentPerson: () => Promise.reject(new Error("database password: x")),
    }
    const response = await createApi({ db, signIn: failing }).request(
      "/account",
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: "internal",
      message: "Something went wrong",
    })
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
