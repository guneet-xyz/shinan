import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it } from "vitest"

import { createGitClient } from "./client.js"

// The Git endpoint's requests go through the same client as the API's
// calls: it adds the service token, and only to the smart HTTP paths.

describe("the Git client's smart HTTP requests", () => {
  it("go to /git/ paths with the service token, and the caller's headers", async () => {
    const seen: { url?: string; headers?: Record<string, unknown> }[] = []
    const server = createServer((request, response) => {
      seen.push({ url: request.url, headers: request.headers })
      response.end("ok")
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    try {
      const client = createGitClient({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        serviceToken: "service-token",
      })
      const answer = await new Promise<number>((resolve, reject) => {
        const upstream = client.smartHttp("/git/x.git/info/refs?service=a", {
          method: "GET",
          headers: { authorization: "Bearer agent", "git-protocol": "v=2" },
          timeoutMs: 5000,
        })
        upstream.once("response", (response) => {
          response.resume()
          resolve(response.statusCode!)
        })
        upstream.once("error", reject)
        upstream.end()
      })
      expect(answer).toBe(200)
      expect(seen[0]!.url).toBe("/git/x.git/info/refs?service=a")
      // The caller's Authorization never replaces the service token.
      expect(seen[0]!.headers).toMatchObject({
        authorization: "Bearer service-token",
        "git-protocol": "v=2",
      })
      expect(() =>
        client.smartHttp("/repositories/x", {
          method: "GET",
          headers: {},
          timeoutMs: 5000,
        }),
      ).toThrow(/only/i)
    } finally {
      server.close()
    }
  })
})
