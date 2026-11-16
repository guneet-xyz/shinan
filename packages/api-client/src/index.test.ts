import { describe, expect, it, vi } from "vitest"

import {
  ApiError,
  createApiClient,
  needsReauthentication,
  sameSitePath,
} from "./index.js"

function fakeFetch(response: () => Response) {
  return vi.fn<typeof globalThis.fetch>(() => Promise.resolve(response()))
}

describe("createApiClient", () => {
  it("reads the server status", async () => {
    const fetch = fakeFetch(() => Response.json({ status: "ok" }))
    const client = createApiClient({ baseUrl: "http://shinan.test", fetch })

    await expect(client.status()).resolves.toEqual({ status: "ok" })
    expect(fetch).toHaveBeenCalledWith(
      "http://shinan.test/api/status",
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    )
  })

  it("sends JSON bodies with the method", async () => {
    const fetch = fakeFetch(() => Response.json({ id: "m1", role: "owner" }))
    const client = createApiClient({ fetch })

    await client.changeRole("w 1", "m/1", "owner")

    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe("/api/workspaces/w%201/members/m%2F1")
    expect(init).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ role: "owner" }),
      headers: { "content-type": "application/json" },
    })
  })

  it("resolves empty answers to undefined", async () => {
    const fetch = fakeFetch(() => new Response(null, { status: 204 }))
    const client = createApiClient({ fetch })

    await expect(client.removeMember("w", "m")).resolves.toBeUndefined()
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: "DELETE" })
  })

  it("passes page cursors as query parameters", async () => {
    const fetch = fakeFetch(() => Response.json({ entries: [], next: null }))
    const client = createApiClient({ fetch })

    await client.securityLog("w", { before: 40, limit: 20 })
    await client.events("w")

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/workspaces/w/security-log?before=40&limit=20",
      "/api/workspaces/w/events",
    ])
  })

  it("starts GitHub sign-in through the sign-in routes", async () => {
    const fetch = fakeFetch(() =>
      Response.json({ url: "https://github.com/login/oauth", redirect: true }),
    )
    const client = createApiClient({ fetch })

    await expect(
      client.startGitHubSignIn({ callbackURL: "/account" }),
    ).resolves.toMatchObject({ url: "https://github.com/login/oauth" })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe("/api/auth/sign-in/social")
    expect(JSON.parse(init!.body as string)).toEqual({
      provider: "github",
      callbackURL: "/account",
    })
  })

  it("throws an ApiError for unsuccessful responses", async () => {
    const fetch = fakeFetch(() => new Response(null, { status: 503 }))
    const client = createApiClient({ fetch })

    const error = await client.status().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 503, code: undefined })
  })

  it("reads the error body", async () => {
    const fetch = fakeFetch(() =>
      Response.json(
        {
          error: "conflict",
          message: "A workspace always has at least one workspace owner",
          rule: "last-owner",
        },
        { status: 409 },
      ),
    )
    const client = createApiClient({ fetch })

    const error = await client.leaveWorkspace("w").catch((e: unknown) => e)
    expect(error).toMatchObject({
      status: 409,
      code: "conflict",
      rule: "last-owner",
      message: "A workspace always has at least one workspace owner",
    })
    expect(needsReauthentication(error)).toBe(false)
  })

  it("recognises a request for re-authentication", async () => {
    const fetch = fakeFetch(() =>
      Response.json(
        {
          error: "reauthentication-required",
          message: "Sign in again to continue",
        },
        { status: 403 },
      ),
    )
    const client = createApiClient({ fetch })

    const error = await client
      .renameWorkspace("w", "New")
      .catch((e: unknown) => e)
    expect(needsReauthentication(error)).toBe(true)
  })
})

describe("sameSitePath", () => {
  const origin = "https://shinan.example"

  it("keeps paths on this site, as resolved", () => {
    expect(sameSitePath("/w/1?x=1#y", origin)).toBe("/w/1?x=1#y")
    expect(sameSitePath("/x/../account", origin)).toBe("/account")
    expect(sameSitePath("/%2f/evil.example", origin)).toBe("/%2f/evil.example")
  })

  it("refuses anything a browser would read as another host", () => {
    for (const value of [
      "//evil.example",
      "/.//evil.example/x",
      "/..//evil.example",
      "/./\\evil.example",
      "/\t/evil.example",
      "https://evil.example/",
      "javascript:alert(1)",
    ]) {
      expect(sameSitePath(value, origin), value).toBeNull()
    }
  })
})
