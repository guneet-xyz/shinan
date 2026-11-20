import { randomBytes } from "node:crypto"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Writable } from "node:stream"
import { gzipSync } from "node:zlib"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { encodeGitContext, gitContextHeader } from "@shinan/core"
import type { GitRequestContext } from "@shinan/core"
import { createGit } from "@shinan/git"
import { commitFiles } from "@shinan/git/testing"

import { gitMessages } from "../git-text.js"
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
/** main, with a file of 4 MiB of random bytes, so its pack fills every buffer. */
let big: string

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
  const { main } = await store.create(workspaceId, {
    files: [{ path: "README.md", content: Buffer.from("# Catalog\n") }],
    message: "Start\n",
  })
  big = await commitFiles(
    git,
    store.pathOf(workspaceId),
    {
      "README.md": "# Catalog\n",
      "big.bin": { content: randomBytes(4 * 1024 * 1024) },
    },
    { parents: [main], ref: "refs/heads/main", message: "Big\n" },
  )
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
    expect(await other.text()).toBe(`${gitMessages.otherContext}\n`)
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
  /** A protocol v2 fetch of main: its answer is a pack of over 4 MiB. */
  const fetchMain = () =>
    [
      line("command=fetch\n"),
      "0001",
      line(`want ${big}\n`),
      line("done\n"),
      "0000",
    ].join("")

  /** A fetch whose answer nobody reads. */
  const stalledReader = (app: ReturnType<typeof createGitApp>, agent: string) =>
    ask(app, `${repository}/git-upload-pack`, {
      method: "POST",
      headers: {
        "content-type": "application/x-git-upload-pack-request",
        "git-protocol": "version=2",
      },
      body: fetchMain(),
      context: { ...context, agent: { id: agent, handle: "opencode-x" } },
    })

  const advertisement = `${repository}/info/refs?service=git-upload-pack`
  const otherAgent = "4b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d"
  const asOther = {
    ...context,
    agent: { id: otherAgent, handle: "opencode-y" },
  }

  it("start no Git process until the body has arrived, so a slow sender holds none", async () => {
    const app = appWith({
      gitProcesses: {
        running: 1,
        queued: 0,
        waitMs: 0,
        perAgent: 1,
        perPerson: 4,
      },
    })
    // Never finishes sending its body.
    const slow = ask(app, `${repository}/git-upload-pack`, {
      method: "POST",
      headers: { "content-type": "application/x-git-upload-pack-request" },
      body: stalled(),
      duplex: "half",
    })
    void Promise.resolve(slow).catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 200))
    for (const who of [context, asOther]) {
      const served = await ask(app, advertisement, { context: who })
      expect(served.status).toBe(200)
      await served.arrayBuffer()
    }
  })

  it("let one agent hold at most two: others are still served", async () => {
    const app = appWith({
      gitProcesses: {
        running: 4,
        queued: 4,
        waitMs: 500,
        perAgent: 2,
        perPerson: 4,
      },
    })
    const agent = context.agent.id
    const held = [
      await stalledReader(app, agent),
      await stalledReader(app, agent),
    ]
    expect(held.map((r) => r.status)).toEqual([200, 200])
    const third = await ask(app, advertisement)
    expect(third.status).toBe(429)
    expect(third.headers.get("retry-after")).toBe("10")
    expect(await third.text()).toBe(`${gitMessages.agentBusy(2, 10)}\n`)
    const other = await ask(app, advertisement, { context: asOther })
    expect(other.status).toBe(200)
    await other.arrayBuffer()
    for (const response of held) await response.body!.cancel()
    let status = 0
    for (let i = 0; i < 40 && status !== 200; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      const next = await ask(app, advertisement)
      status = next.status
      await next.arrayBuffer()
    }
    expect(status).toBe(200)
  })

  it("are capped: past the running and waiting ones, 429 with Retry-After", async () => {
    const app = appWith({
      gitProcesses: {
        running: 1,
        queued: 1,
        waitMs: 500,
        perAgent: 4,
        perPerson: 4,
      },
    })
    const held = await stalledReader(app, context.agent.id)
    expect(held.status).toBe(200)
    const started = Date.now()
    // One waits its turn, for at most 500 ms; one more has no place to wait.
    const [waited, refused] = await Promise.all([
      ask(app, advertisement, { context: asOther }),
      ask(app, advertisement, { context: asOther }),
    ])
    expect(refused.status).toBe(429)
    expect(refused.headers.get("retry-after")).toBe("10")
    expect(await refused.text()).toBe(`${gitMessages.busy}\n`)
    expect(waited.status).toBe(429)
    expect(Date.now() - started).toBeGreaterThanOrEqual(450)
    await held.body!.cancel()
  })

  it("end Git when its client takes none of the answer for a while, and serve the next", async () => {
    const app = appWith({
      gitProcesses: {
        running: 1,
        queued: 0,
        waitMs: 0,
        perAgent: 1,
        perPerson: 4,
      },
      answerStallSeconds: 1,
    })
    const started = Date.now()
    const held = await stalledReader(app, context.agent.id)
    expect(held.status).toBe(200)
    let status = 0
    while (status !== 200 && Date.now() - started < 10_000) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      const next = await ask(app, advertisement, { context: asOther })
      status = next.status
      await next.arrayBuffer()
    }
    expect(status).toBe(200)
    expect(Date.now() - started).toBeGreaterThanOrEqual(900)
    // The stalled answer was cut short, not ended as if whole.
    await expect(held.arrayBuffer()).rejects.toThrow()
  })

  it("are stopped at their time limit, which cuts their answer short", async () => {
    const app = appWith({ gitProcessSeconds: 1, answerStallSeconds: 60 })
    const started = Date.now()
    const response = await stalledReader(app, context.agent.id)
    expect(response.status).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await expect(response.arrayBuffer()).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(10_000)
  })
})

describe("the caps per person and per agent", () => {
  const advertisement = `${repository}/info/refs?service=git-upload-pack`
  const as = (agent: string, person: string) => ({
    ...context,
    agent: { id: agent, handle: "opencode-x" },
    person: { id: person, handle: "someone" },
  })
  const agents = [
    "5b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d",
    "6b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d",
    "7b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d",
  ]
  const people = [
    "8b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d",
    "9b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d",
  ]
  const hold = (app: ReturnType<typeof createGitApp>, who: GitRequestContext) =>
    ask(app, `${repository}/git-upload-pack`, {
      method: "POST",
      headers: {
        "content-type": "application/x-git-upload-pack-request",
        "git-protocol": "version=2",
      },
      body: [
        line("command=fetch\n"),
        "0001",
        line(`want ${big}\n`),
        line("done\n"),
        "0000",
      ].join(""),
      context: who,
    })

  it("let the agents of one person hold at most three Git processes: another person is still served", async () => {
    const app = appWith({
      gitProcesses: {
        running: 4,
        queued: 4,
        waitMs: 500,
        perAgent: 2,
        perPerson: 3,
      },
    })
    const held = [
      await hold(app, as(agents[0]!, people[0]!)),
      await hold(app, as(agents[0]!, people[0]!)),
      await hold(app, as(agents[1]!, people[0]!)),
    ]
    expect(held.map((r) => r.status)).toEqual([200, 200, 200])
    const fourth = await ask(app, advertisement, {
      context: as(agents[2]!, people[0]!),
    })
    expect(fourth.status).toBe(429)
    expect(await fourth.text()).toBe(`${gitMessages.personBusy(3, 10)}\n`)
    const other = await ask(app, advertisement, {
      context: as(agents[2]!, people[1]!),
    })
    expect(other.status).toBe(200)
    await other.arrayBuffer()
    for (const response of held) await response.body!.cancel()
  })

  it("let one agent send at most two push bodies at once: another agent's push is still received", async () => {
    const app = appWith()
    const bodies: ReadableStreamDefaultController<Uint8Array>[] = []
    const trickle = (who: GitRequestContext) => {
      const answer = ask(app, `${repository}/git-receive-pack`, {
        method: "POST",
        headers: { "content-type": "application/x-git-receive-pack-request" },
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("0098"))
            bodies.push(controller)
          },
        }),
        duplex: "half",
        context: who,
      })
      void Promise.resolve(answer).catch(() => {})
    }
    trickle(as(agents[0]!, people[0]!))
    trickle(as(agents[0]!, people[0]!))
    await new Promise((resolve) => setTimeout(resolve, 200))
    const third = await ask(app, `${repository}/git-receive-pack`, {
      method: "POST",
      headers: { "content-type": "application/x-git-receive-pack-request" },
      body: "0000",
      context: as(agents[0]!, people[0]!),
    })
    expect(third.status).toBe(429)
    expect(await third.text()).toBe(`${gitMessages.agentSpooling(2, 10)}\n`)
    const other = await ask(app, `${repository}/git-receive-pack`, {
      method: "POST",
      headers: { "content-type": "application/x-git-receive-pack-request" },
      body: "0000",
      context: as(agents[1]!, people[1]!),
    })
    expect(other.status).toBe(200)
    await other.arrayBuffer()
    // The trickling clients go; their spool files go with them.
    for (const body of bodies) body.error(new Error("gone"))
  })

  it("answer a full disk as the Git service's own failure, once in the log", async () => {
    const logged: string[] = []
    const app = appWith({
      log: (line: string) => logged.push(line),
      openSpool: () =>
        new Writable({
          write(_chunk, _encoding, done) {
            done(
              Object.assign(new Error("no space left on device"), {
                code: "ENOSPC",
              }),
            )
          },
        }),
    })
    const response = await ask(app, `${repository}/git-receive-pack`, {
      method: "POST",
      headers: { "content-type": "application/x-git-receive-pack-request" },
      body: "0000",
    })
    expect(response.status).toBe(507)
    expect(await response.text()).toBe(`${gitMessages.diskFull}\n`)
    expect(logged).toEqual([
      "The catalog volume is full: a push could not be received (ENOSPC)",
    ])
  })
})

describe("request bodies", () => {
  it("are counted after inflating gzip: 4 MiB of fetch lines in a small gzip body is too large", async () => {
    const lines = `${line(`have ${"0".repeat(40)}\n`)}`.repeat(90_000)
    const compressed = gzipSync(lines)
    expect(compressed.length).toBeLessThan(1024 * 1024)
    const response = await ask(appWith(), `${repository}/git-upload-pack`, {
      method: "POST",
      headers: {
        "content-type": "application/x-git-upload-pack-request",
        "content-encoding": "gzip",
      },
      body: compressed,
    })
    expect(response.status).toBe(413)
    expect(await response.text()).toBe(`${gitMessages.fetchTooLarge(4)}\n`)
  })

  it("refuse a body that is not gzip as it says", async () => {
    const response = await ask(appWith(), `${repository}/git-upload-pack`, {
      method: "POST",
      headers: {
        "content-type": "application/x-git-upload-pack-request",
        "content-encoding": "gzip",
      },
      body: "not gzip at all",
    })
    expect(response.status).toBe(400)
    expect(await response.text()).toBe(`${gitMessages.badGzip}\n`)
  })

  it("leave no file behind for a push, whatever its end", async () => {
    const response = await ask(appWith(), `${repository}/git-receive-pack`, {
      method: "POST",
      headers: { "content-type": "application/x-git-receive-pack-request" },
      body: "0000",
    })
    await response.arrayBuffer()
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(
      readdirSync(join(root, ".tmp")).filter((n) => n.startsWith("push-")),
    ).toEqual([])
  })
})
