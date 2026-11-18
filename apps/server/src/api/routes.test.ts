import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

import type * as Api from "@shinan/api-client"
import {
  addMember,
  createWorkspace,
  hashToken,
  setUpInstallation,
  shinan,
} from "@shinan/core"
import type { JobQueue, Person } from "@shinan/core"
import { and, eq, schema, sql } from "@shinan/db"
import { connectTestDatabase } from "@shinan/db/testing"

import { insertPerson } from "../../test/people.js"
import { as, testSignIn } from "../../test/sign-in.js"
import { createApi } from "./routes.js"
import type { SignIn } from "./sign-in.js"

const { db, pool } = connectTestDatabase()

afterAll(async () => {
  await pool.end()
})

// Emails stay queued in email_deliveries; no worker sends them here.
const jobs: JobQueue = { send: () => Promise.resolve(null) }
const api = createApi({
  db,
  signIn: testSignIn,
  jobs,
  installationUrl: "http://shinan.test",
  // Every request here comes from one unknown address.
  rateLimit: false,
})

let owner: Person
let contributor: Person
let workspaceId: string
let ownerMemberId: string
let contributorMemberId: string

async function newPerson(prefix: string): Promise<Person> {
  return insertPerson(db, prefix)
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
      // As the web app's requests carry; security.test.ts checks refusals.
      origin: "http://shinan.test",
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

/** What the web app's requests carry; security.test.ts checks refusals. */
const sameOrigin = { "sec-fetch-site": "same-origin" }

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
    expect(await response.json()).toEqual({
      name: "Shinan",
      signInMethods: { github: false },
    })
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

describe("changing one's email address", () => {
  it("asks for re-authentication, then emails a link that only its person can open", async () => {
    const email = `${contributor.handle}-new@example.com`
    await db.insert(schema.emailAllowlist).values({ email })

    const stale = await call("/account/email-change", {
      body: { email },
      headers: {
        ...sameOrigin,
        ...as(contributor, { reauthenticated: false }),
      },
    })
    expect(stale.status).toBe(403)
    expect(await stale.json()).toMatchObject({
      error: "reauthentication-required",
    })

    const asked = await call("/account/email-change", {
      body: { email },
      headers: { ...sameOrigin, ...as(contributor) },
    })
    expect(asked.status).toBe(200)
    expect(await json<Api.PendingEmailChange>(asked)).toMatchObject({ email })
    const account = await json<Api.Account>(
      await call("/account", { headers: as(contributor) }),
    )
    expect(account.pendingEmailChange).toMatchObject({ email })

    const [delivery] = await db
      .select()
      .from(schema.emailDeliveries)
      .where(
        and(
          eq(schema.emailDeliveries.recipient, email),
          eq(schema.emailDeliveries.kind, "email_change"),
        ),
      )
    const token = /\/email-change#(\S+)/.exec(delivery!.message!.text)![1]!

    // Someone else, signed in, with the link: nothing to find.
    const stranger = await call("/account/email-change/confirm", {
      body: { token },
      headers: { ...sameOrigin, ...as(owner) },
    })
    expect(stranger.status).toBe(404)

    const confirmed = await call("/account/email-change/confirm", {
      body: { token },
      headers: {
        ...sameOrigin,
        ...as(contributor, { reauthenticated: false }),
      },
    })
    expect(confirmed.status).toBe(200)
    expect(await confirmed.json()).toEqual({ email })
    const after = await json<Api.Account>(
      await call("/account", { headers: as(contributor) }),
    )
    expect(after.person.email).toBe(email)
    expect(after.pendingEmailChange).toBeNull()
  })

  it("refuses an address off the allowlist, with the rule", async () => {
    const response = await call("/account/email-change", {
      body: { email: "not-listed@example.com" },
      headers: { ...sameOrigin, ...as(contributor) },
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: "conflict",
      rule: "not-allowlisted",
    })
  })

  it("cancels a waiting change", async () => {
    const email = `${owner.handle}-new@example.com`
    await db.insert(schema.emailAllowlist).values({ email })
    await call("/account/email-change", {
      body: { email },
      headers: { ...sameOrigin, ...as(owner) },
    })
    const cancelled = await call("/account/email-change", {
      method: "DELETE",
      headers: { ...sameOrigin, ...as(owner) },
    })
    expect(cancelled.status).toBe(204)
    const account = await json<Api.Account>(
      await call("/account", { headers: as(owner) }),
    )
    expect(account.pendingEmailChange).toBeNull()
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
  async function allowlist(email: string) {
    await db
      .insert(schema.emailAllowlist)
      .values({ email })
      .onConflictDoNothing()
  }

  /** The token in the newest invitation email to an address. */
  async function invitationToken(email: string): Promise<string> {
    const deliveries = await db
      .select()
      .from(schema.emailDeliveries)
      .where(
        and(
          eq(schema.emailDeliveries.recipient, email),
          eq(schema.emailDeliveries.kind, "invitation"),
        ),
      )
    const message = deliveries.at(-1)!.message!
    return /\/invitation#(\S+)/.exec(message.text)![1]!
  }

  it("are sent to allowlisted addresses by workspace owners", async () => {
    const invitee = await newPerson("invitee")
    await allowlist(invitee.email)
    const response = await call(ws("/invitations"), {
      body: { email: invitee.email.toUpperCase(), role: "contributor" },
      headers: as(owner),
    })
    expect(response.status).toBe(201)
    const invitation = await json<Api.Invitation>(response)
    expect(invitation).toMatchObject({
      email: invitee.email,
      role: "contributor",
      state: "pending",
      invitedByHandle: owner.handle,
    })
    const listed = await json<Api.Invitation[]>(
      await call(ws("/invitations"), { headers: as(owner) }),
    )
    expect(listed.map((i) => i.id)).toEqual([invitation.id])

    // The link's token is stored only as a hash.
    const token = await invitationToken(invitee.email)
    const [row] = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, invitation.id))
    expect(row!.tokenHash).toBe(hashToken(token))
  })

  it("refuse an address that is not on the allowlist, saying what to do", async () => {
    const response = await call(ws("/invitations"), {
      body: { email: "not-allowed@example.com", role: "contributor" },
      headers: as(owner),
    })
    expect(response.status).toBe(409)
    const body = await json<Api.ErrorBody>(response)
    expect(body.rule).toBe("not-allowlisted")
    expect(body.message).toMatch(/installation operator/)
  })

  it("need a recent sign-in, and are for workspace owners only", async () => {
    await allowlist("someone@example.com")
    const stale = await call(ws("/invitations"), {
      body: { email: "someone@example.com", role: "contributor" },
      headers: as(owner, { reauthenticated: false }),
    })
    expect(stale.status).toBe(403)
    expect(await json<Api.ErrorBody>(stale)).toMatchObject({
      error: "reauthentication-required",
    })
    for (const [method, path] of [
      ["GET", ws("/invitations")],
      ["POST", ws("/invitations")],
    ] as const) {
      const response = await call(path, {
        method,
        body:
          method === "POST"
            ? { email: "someone@example.com", role: "contributor" }
            : undefined,
        headers: as(contributor),
      })
      expect(response.status, `${method} ${path}`).toBe(403)
    }
  })

  it("can be sent again with a new link, or withdrawn", async () => {
    const invitee = await newPerson("invitee")
    await allowlist(invitee.email)
    const invitation = await json<Api.Invitation>(
      await call(ws("/invitations"), {
        body: { email: invitee.email, role: "owner" },
        headers: as(owner),
      }),
    )
    const first = await invitationToken(invitee.email)
    const resent = await call(ws(`/invitations/${invitation.id}/resend`), {
      method: "POST",
      headers: as(owner),
    })
    expect(resent.status).toBe(200)
    const second = await invitationToken(invitee.email)
    expect(second).not.toBe(first)

    const old = await call("/invitations/find", {
      body: { token: first },
      headers: as(invitee),
    })
    expect(old.status).toBe(404)

    const withdrawn = await call(ws(`/invitations/${invitation.id}`), {
      method: "DELETE",
      headers: as(owner),
    })
    expect(withdrawn.status).toBe(204)
    const gone = await call("/invitations/find", {
      body: { token: second },
      headers: as(invitee),
    })
    expect(gone.status).toBe(404)
  })

  it("are accepted by the invited person, signed in with that address", async () => {
    const invitee = await newPerson("invitee")
    const other = await newPerson("other")
    await allowlist(invitee.email)
    await call(ws("/invitations"), {
      body: { email: invitee.email, role: "contributor" },
      headers: as(owner),
    })
    const token = await invitationToken(invitee.email)

    // A leaked link is useless to anyone else.
    for (const path of ["/invitations/find", "/invitations/accept"]) {
      const response = await call(path, {
        body: { token },
        headers: as(other),
      })
      expect(response.status, path).toBe(404)
    }
    // And needs sign-in.
    expect((await call("/invitations/find", { body: { token } })).status).toBe(
      401,
    )

    const found = await json<Api.InvitationForYou>(
      await call("/invitations/find", {
        body: { token },
        headers: as(invitee),
      }),
    )
    expect(found).toMatchObject({
      workspaceId,
      workspaceName: "Team",
      invitedByHandle: owner.handle,
      role: "contributor",
    })
    const pending = await json<Api.InvitationForYou[]>(
      await call("/account/invitations", { headers: as(invitee) }),
    )
    expect(pending.map((i) => i.id)).toEqual([found.id])

    const accepted = await call("/invitations/accept", {
      body: { token },
      headers: as(invitee, { reauthenticated: false }),
    })
    expect(accepted.status).toBe(200)
    expect(await json<Api.AcceptedInvitation>(accepted)).toMatchObject({
      workspaceId,
    })
    const members = await json<Api.Member[]>(
      await call(ws("/members"), { headers: as(invitee) }),
    )
    expect(members.find((m) => m.personId === invitee.id)).toMatchObject({
      role: "contributor",
      invitedByHandle: owner.handle,
    })
    // Used once.
    const again = await call("/invitations/accept", {
      body: { token },
      headers: as(invitee),
    })
    expect(again.status).toBe(404)
  })

  it("can be declined from Your account", async () => {
    const invitee = await newPerson("invitee")
    await allowlist(invitee.email)
    const invitation = await json<Api.Invitation>(
      await call(ws("/invitations"), {
        body: { email: invitee.email, role: "contributor" },
        headers: as(owner),
      }),
    )
    const declined = await call(
      `/account/invitations/${invitation.id}/decline`,
      { method: "POST", headers: as(invitee) },
    )
    expect(declined.status).toBe(204)
    const listed = await json<Api.Invitation[]>(
      await call(ws("/invitations"), { headers: as(owner) }),
    )
    expect(listed.find((i) => i.id === invitation.id)?.state).toBe("declined")
    const log = await json<Api.Page<Api.SecurityLogEntry>>(
      await call(ws("/security-log"), { headers: as(owner) }),
    )
    expect(log.entries[0]).toMatchObject({
      action: "invitation.declined",
      actorPersonId: invitee.id,
    })
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
      { method: "POST", headers: sameOrigin },
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
      ...testSignIn,
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
      ...testSignIn,
      currentPerson: () =>
        Promise.resolve({ person: null, headers: cookies() }),
    }
    const response = await createApi({ db, signIn }).request("/account")

    expect(response.status).toBe(401)
    expect(response.headers.getSetCookie()).toHaveLength(2)
  })
})

describe("POST /workspaces", () => {
  it("lets any person create a workspace, as its first workspace owner", async () => {
    const someone = await newPerson("someone")
    const response = await call("/workspaces", {
      body: { name: " Own " },
      headers: as(someone, { reauthenticated: false }),
    })
    expect(response.status).toBe(201)
    const created = await json<Api.Workspace>(response)
    expect(created).toMatchObject({ name: "Own", role: "owner" })
    const members = await json<Api.Member[]>(
      await call(`/workspaces/${created.id}/members`, { headers: as(someone) }),
    )
    expect(members.map((m) => [m.personId, m.role])).toEqual([
      [someone.id, "owner"],
    ])
  })

  it("needs sign-in and a name", async () => {
    expect((await call("/workspaces", { body: { name: "x" } })).status).toBe(
      401,
    )
    const blank = await call("/workspaces", {
      body: { name: " " },
      headers: as(owner),
    })
    expect(blank.status).toBe(422)
  })
})

describe("request bodies", () => {
  it("are refused over 64 KB with 413, before anything reads them", async () => {
    const handle = vi.fn(() => Promise.resolve(new Response("handled")))
    const app = createApi({ db, signIn: { ...testSignIn, handle } })
    const big = JSON.stringify({ name: "x".repeat(65 * 1024) })
    for (const path of ["/workspaces", "/auth/sign-in/magic-link"]) {
      const response = await app.request(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...sameOrigin,
          ...as(owner),
        },
        body: big,
      })
      expect(response.status, path).toBe(413)
      expect(await response.json()).toMatchObject({
        error: "payload-too-large",
      })
    }
    expect(handle).not.toHaveBeenCalled()
    // A normal body still works.
    const ok = await app.request("/workspaces", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...sameOrigin,
        ...as(owner),
      },
      body: JSON.stringify({ name: "Small" }),
    })
    expect(ok.status).toBe(201)
  })
})

describe("errors from the sign-in layer", () => {
  function failingWith(statusCode: number): SignIn {
    const error = Object.assign(new Error("echoes the request: secret"), {
      name: "APIError",
      statusCode,
    })
    return {
      ...testSignIn,
      startGitHubLink: () => Promise.reject(error),
    }
  }

  it("answer a 4xx for a bad request, never a 500", async () => {
    const response = await createApi({
      db,
      signIn: failingWith(400),
    }).request("/account/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...sameOrigin,
        ...as(owner),
      },
      body: JSON.stringify({ callbackURL: "/account" }),
    })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: "invalid-input" })
  })

  it("log only the status when the sign-in layer fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const response = await createApi({
      db,
      signIn: failingWith(500),
    }).request("/account/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...sameOrigin,
        ...as(owner),
      },
      body: JSON.stringify({ callbackURL: "/account" }),
    })
    expect(response.status).toBe(500)
    expect(error).toHaveBeenCalledWith("Sign-in layer error: 500")
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret")
    error.mockRestore()
  })

  it("refuse a return path off this site before the sign-in layer runs", async () => {
    const startGitHubLink = vi.fn()
    const response = await createApi({
      db,
      signIn: { ...testSignIn, startGitHubLink },
    }).request("/account/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...sameOrigin,
        ...as(owner),
      },
      body: JSON.stringify({ callbackURL: "https://evil.example/" }),
    })
    expect(response.status).toBe(422)
    expect(startGitHubLink).not.toHaveBeenCalled()
  })
})

describe("unexpected errors", () => {
  it("answer a generic 500 and are logged", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const failing: SignIn = {
      ...testSignIn,
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
    expect(error).toHaveBeenCalledOnce()
    expect(error.mock.calls[0]![0]).toMatch(/^Request failed: Error\n\s+at /)
    expect(JSON.stringify(error.mock.calls)).not.toContain("password")
    error.mockRestore()
  })

  it("never log a failed query's values, and log a repeated failure once a minute", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      // A query that quotes a network and an email address, and fails, as
      // core's queries do with request values.
      const failing: SignIn = {
        ...testSignIn,
        async currentPerson() {
          await db.execute(
            sql`select ${"203.0.113.88"}::int, ${"ada@example.com"}::int`,
          )
          return { person: null }
        },
      }
      const app = createApi({ db, signIn: failing })
      for (let n = 0; n < 3; n++) {
        expect((await app.request("/account")).status).toBe(500)
      }

      expect(error).toHaveBeenCalledOnce()
      const logged = JSON.stringify(error.mock.calls)
      expect(logged).toContain("Request failed: DrizzleQueryError 22P02")
      expect(logged).not.toMatch(/203\.0\.113\.88|ada@example\.com|select/)
    } finally {
      error.mockRestore()
    }
  })
})
