import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gzipSync } from "node:zlib"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { encodeGitContext, gitContextHeader } from "@shinan/core"
import type { GitRequestContext } from "@shinan/core"
import { createGit } from "@shinan/git"

import { createGitApp } from "./app.js"
import { openJournal } from "./journal.js"
import { createRepositoryStore } from "./store.js"
import type { RepositoryStore } from "./store.js"

// The Git container's smart HTTP paths (Git-based catalog plan §2.2, step
// 6), asked directly as `web` asks them. The Git endpoint's tests
// (`../git-endpoint.test.ts`) use them end to end with a real client.

const token = "service-token-for-tests-0123456789abcdef"
const workspaceId = "0b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d"
const git = createGit()
let root: string
let hooks: string
let store: RepositoryStore

const context: GitRequestContext = {
  requestId: "req-1",
  workspaceId,
  agent: {
    id: "1b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d",
    handle: "opencode-daedalus",
  },
  memberId: "2b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d",
  person: { id: "3b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d", handle: "guneet" },
  by: "guneet via opencode-daedalus",
  mayPush: true,
  memberHandles: ["guneet"],
  allowedValues: [],
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "shinan-smart-http-"))
  hooks = mkdtempSync(join(tmpdir(), "shinan-smart-http-hooks-"))
  store = createRepositoryStore({ root, git, hooksDirectory: hooks })
  await store.create(workspaceId, {
    files: [{ path: "README.md", content: Buffer.from("# Catalog\n") }],
    message: "Start\n",
  })
})
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(hooks, { recursive: true, force: true })
})

function appWith(
  options: Partial<Parameters<typeof createGitApp>[0]> = {},
): ReturnType<typeof createGitApp> {
  return createGitApp({
    serviceToken: token,
    store,
    journal: openJournal(root),
    log: () => {},
    ...options,
  })
}

const repository = `/git/${workspaceId}.git`

function ask(
  app: ReturnType<typeof createGitApp>,
  path: string,
  init: RequestInit & { context?: GitRequestContext | null } = {},
) {
  const { context: given, ...rest } = init
  const value = given === undefined ? context : given
  return app.request(path, {
    ...rest,
    headers: {
      authorization: `Bearer ${token}`,
      ...(value ? { [gitContextHeader]: encodeGitContext(value) } : {}),
      ...rest.headers,
    },
  })
}

/** A pkt-line. */
const line = (text: string) =>
  `${(text.length + 4).toString(16).padStart(4, "0")}${text}`

/** A body that never ends: Git waits for the rest. */
function stalled(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("0098"))
    },
  })
}

describe("the smart HTTP paths", () => {
  const app = () => appWith()

  it("answer the advertisements with Git's own, both protocol versions", async () => {
    const v0 = await ask(
      app(),
      `${repository}/info/refs?service=git-upload-pack`,
    )
    expect(v0.status).toBe(200)
    expect(v0.headers.get("content-type")).toBe(
      "application/x-git-upload-pack-advertisement",
    )
    const text = await v0.text()
    expect(text).toMatch(/^001e# service=git-upload-pack\n0000/)
    expect(text).toContain("refs/heads/main")

    const v2 = await ask(
      app(),
      `${repository}/info/refs?service=git-upload-pack`,
      { headers: { "git-protocol": "version=2" } },
    )
    expect(await v2.text()).toMatch(/^000eversion 2\n/)
  })

  it("serve a fetch, with a body compressed by gzip as Git sends a long one", async () => {
    const body = [
      line("command=ls-refs\n"),
      "0001",
      line("ref-prefix refs/heads/\n"),
      "0000",
    ].join("")
    for (const compressed of [false, true]) {
      const response = await ask(app(), `${repository}/git-upload-pack`, {
        method: "POST",
        headers: {
          "content-type": "application/x-git-upload-pack-request",
          "git-protocol": "version=2",
          ...(compressed ? { "content-encoding": "gzip" } : {}),
        },
        body: compressed ? gzipSync(body) : body,
      })
      expect(response.status).toBe(200)
      expect(await response.text()).toMatch(/[0-9a-f]{40} refs\/heads\/main\n/)
    }
  })

  it("answer 404 to every other path, method or query, before Git starts", async () => {
    for (const [method, path] of [
      ["GET", `${repository}/HEAD`],
      ["GET", `${repository}/info/refs`],
      ["GET", `${repository}/info/refs?service=git-upload-archive`],
      ["GET", `${repository}/objects/info/packs`],
      ["POST", `${repository}/info/refs?service=git-upload-pack`],
      ["GET", `${repository}/git-upload-pack`],
      ["POST", `${repository}/git-upload-pack?x=1`],
      ["GET", `/git/${workspaceId}/info/refs?service=git-upload-pack`],
      ["GET", `/git/.tmp.git/info/refs?service=git-upload-pack`],
    ] as const) {
      const response = await ask(app(), path, {
        method,
        body: method === "POST" ? "0000" : undefined,
      })
      expect(response.status, `${method} ${path}`).toBe(404)
      expect(response.headers.get("content-type")).toBe(
        "text/plain; charset=utf-8",
      )
    }
    // A workspace without a repository.
    const missing = await ask(
      app(),
      `/git/9b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d.git/info/refs?service=git-upload-pack`,
      {
        context: {
          ...context,
          workspaceId: "9b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d",
        },
      },
    )
    expect(missing.status).toBe(404)
  })

  it("need a context for the same workspace, and one that may push to push", async () => {
    const path = `${repository}/info/refs?service=git-receive-pack`
    const none = await ask(app(), path, { context: null })
    expect(none.status).toBe(400)
    const other = await ask(app(), path, {
      context: {
        ...context,
        workspaceId: "9b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d",
      },
    })
    expect(other.status).toBe(400)
    expect(await other.text()).toBe("The context is for another workspace\n")
    const readOnly = await ask(app(), path, {
      context: { ...context, mayPush: false },
    })
    expect(readOnly.status).toBe(403)
    const push = await ask(app(), path)
    expect(push.status).toBe(200)
    expect(push.headers.get("content-type")).toBe(
      "application/x-git-receive-pack-advertisement",
    )
    await push.arrayBuffer()
    // Fetching needs no push.
    const fetch = await ask(
      app(),
      `${repository}/info/refs?service=git-upload-pack`,
      { context: { ...context, mayPush: false } },
    )
    expect(fetch.status).toBe(200)
    await fetch.arrayBuffer()
  })

  it("still need the service token", async () => {
    const response = await app().request(
      `${repository}/info/refs?service=git-upload-pack`,
      { headers: { [gitContextHeader]: encodeGitContext(context) } },
    )
    expect(response.status).toBe(401)
  })

  it("refuse declared bodies over their limits, other encodings and odd Git-Protocol headers", async () => {
    for (const [service, length] of [
      ["git-upload-pack", 4 * 1024 * 1024 + 1],
      ["git-receive-pack", 64 * 1024 * 1024 + 1],
    ] as const) {
      const response = await ask(app(), `${repository}/${service}`, {
        method: "POST",
        headers: { "content-length": String(length) },
        body: "0000",
      })
      expect(response.status, service).toBe(413)
    }
    const deflate = await ask(app(), `${repository}/git-upload-pack`, {
      method: "POST",
      headers: { "content-encoding": "br" },
      body: "0000",
    })
    expect(deflate.status).toBe(415)
    const protocol = await ask(
      app(),
      `${repository}/info/refs?service=git-upload-pack`,
      { headers: { "git-protocol": "version=2 x" } },
    )
    expect(protocol.status).toBe(400)
  })

  it("cut a body off past its limit, and Git with it", async () => {
    const chunk = new Uint8Array(1024 * 1024)
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > 5 * 1024 * 1024) return controller.close()
        sent += chunk.length
        controller.enqueue(chunk)
      },
    })
    const response = await ask(app(), `${repository}/git-upload-pack`, {
      method: "POST",
      headers: { "content-type": "application/x-git-upload-pack-request" },
      body,
      duplex: "half",
    })
    // Git sent its headers first; the answer is then cut short.
    if (response.status === 200) await expect(response.text()).rejects.toThrow()
    else expect(response.status).toBe(413)
  })
})

describe("the Git processes", () => {
  it("are capped: past the running and waiting ones, 429 with Retry-After", async () => {
    const app = appWith({
      gitProcesses: { running: 1, queued: 1, waitMs: 500 },
    })
    const held = await ask(app, `${repository}/git-upload-pack`, {
      method: "POST",
      headers: { "content-type": "application/x-git-upload-pack-request" },
      body: stalled(),
      duplex: "half",
    })
    expect(held.status).toBe(200)
    const advertisement = `${repository}/info/refs?service=git-upload-pack`
    const started = Date.now()
    // One waits its turn, for at most 500 ms; one more has no place to wait.
    const [waited, refused] = await Promise.all([
      ask(app, advertisement),
      ask(app, advertisement),
    ])
    expect(refused.status).toBe(429)
    expect(refused.headers.get("retry-after")).toBe("10")
    expect(await refused.text()).toContain("try again in a few seconds")
    expect(waited.status).toBe(429)
    expect(Date.now() - started).toBeGreaterThanOrEqual(450)
    // Ending the held one frees its process for the next.
    await held.body!.cancel()
    let status = 0
    for (let i = 0; i < 40 && status !== 200; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      const next = await ask(app, advertisement)
      status = next.status
      await next.arrayBuffer()
    }
    expect(status).toBe(200)
  })

  it("are stopped at their time limit, which cuts their answer short", async () => {
    const app = appWith({ gitProcessSeconds: 1 })
    const started = Date.now()
    const response = await ask(app, `${repository}/git-upload-pack`, {
      method: "POST",
      headers: { "content-type": "application/x-git-upload-pack-request" },
      body: stalled(),
      duplex: "half",
    })
    expect(response.status).toBe(200)
    await expect(response.text()).rejects.toThrow()
    expect(Date.now() - started).toBeGreaterThanOrEqual(900)
    expect(Date.now() - started).toBeLessThan(10_000)
  })
})
