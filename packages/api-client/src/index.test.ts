import { describe, expect, it, vi } from "vitest"

import { ApiError, createApiClient } from "./index.js"

describe("createApiClient", () => {
  it("reads the server status", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json({ status: "ok" })),
    )
    const client = createApiClient({ baseUrl: "http://shinan.test", fetch })

    await expect(client.status()).resolves.toEqual({ status: "ok" })
    expect(fetch).toHaveBeenCalledWith(
      "http://shinan.test/api/status",
      expect.anything(),
    )
  })

  it("throws an ApiError for unsuccessful responses", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response(null, { status: 503 })),
    )
    const client = createApiClient({ fetch })

    await expect(client.status()).rejects.toBeInstanceOf(ApiError)
  })
})
