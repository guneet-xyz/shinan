import { describe, expect, it } from "vitest"

import {
  decodeGitContext,
  encodeGitContext,
  GitContextError,
  gitContextMaxLength,
} from "./api.js"
import type { GitRequestContext } from "./api.js"
import { createGitClient } from "./client.js"

const context: GitRequestContext = {
  requestId: "req-1",
  workspaceId: "0b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d",
  agent: {
    id: "1b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d",
    handle: "opencode-daedalus",
  },
  memberId: "2b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d",
  person: { id: "3b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d", handle: "guneet" },
  by: "guneet via opencode-daedalus",
  mayPush: false,
  memberHandles: ["guneet", "second"],
  allowedValues: ["a".repeat(64)],
}

const encoded = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url")

describe("the context header", () => {
  it("round-trips, dropping fields it does not know", () => {
    expect(decodeGitContext(encodeGitContext(context))).toEqual(context)
    expect(decodeGitContext(encoded({ ...context, extra: "x" }))).toEqual(
      context,
    )
  })

  it("refuses anything over its limits or of another shape", () => {
    for (const value of [
      "",
      "not/base64url+",
      encoded([]),
      encoded({ ...context, requestId: "" }),
      encoded({ ...context, agent: { id: "x", handle: "a" } }),
      encoded({
        ...context,
        person: { ...context.person, handle: "Not A Handle" },
      }),
      encoded({ ...context, mayPush: 1 }),
      encoded({ ...context, memberHandles: "guneet" }),
      encoded({ ...context, allowedValues: ["A".repeat(64)] }),
      encoded({
        ...context,
        allowedValues: Array.from({ length: 101 }, () => "a".repeat(64)),
      }),
      encoded({
        ...context,
        memberHandles: Array.from({ length: 1001 }, () => "x"),
      }),
      "A".repeat(gitContextMaxLength + 1),
    ]) {
      expect(() => decodeGitContext(value), value.slice(0, 30)).toThrow(
        GitContextError,
      )
    }
    expect(
      decodeGitContext(
        encoded({
          ...context,
          allowedValues: Array.from({ length: 100 }, () => "a".repeat(64)),
        }),
      ).allowedValues,
    ).toHaveLength(100)
  })
})

describe("the client", () => {
  it("sends the service token, never follows redirects, and names the Git container's address only", async () => {
    const seen: { url: string; init: RequestInit }[] = []
    const client = createGitClient({
      url: "http://git:3000",
      serviceToken: "t".repeat(40),
      fetch: (input, init) => {
        seen.push({ url: (input as URL).href, init: init! })
        return Promise.resolve(Response.json({ workspaceId: "w", main: "m" }))
      },
    })
    await client.getRepository("0b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d")
    await client.history("0b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d", {
      commit: "main",
      path: "machine/musashi.md",
      limit: 5,
    })
    expect(seen[0]!.url).toBe(
      "http://git:3000/repositories/0b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d",
    )
    expect(seen[0]!.init.headers).toEqual({
      authorization: `Bearer ${"t".repeat(40)}`,
    })
    expect(seen[0]!.init.redirect).toBe("error")
    expect(seen[1]!.url).toBe(
      "http://git:3000/repositories/0b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d/history?commit=main&path=machine%2Fmusashi.md&limit=5",
    )
    await client.getRepository("../journal")
    expect(seen[2]!.url).toBe("http://git:3000/repositories/..%2Fjournal")
  })

  it("turns a refusal into an error with the Git container's status and code", async () => {
    const client = createGitClient({
      url: "http://git:3000",
      serviceToken: "t".repeat(40),
      fetch: () =>
        Promise.resolve(
          Response.json(
            { error: "invalid-request", message: "No" },
            { status: 400 },
          ),
        ),
    })
    await expect(client.readJournal({ after: 0 })).rejects.toMatchObject({
      status: 400,
      code: "invalid-request",
      message: "No",
    })
    expect(() =>
      createGitClient({ url: "file:///x", serviceToken: "t" }),
    ).toThrow()
  })
})
