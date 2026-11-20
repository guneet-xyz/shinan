import { randomBytes } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { connect } from "node:net"
import type { Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { serve } from "@hono/node-server"
import type { ServerType } from "@hono/node-server"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createGit } from "@shinan/git"

import { createGitApp } from "./app.js"
import { openJournal } from "./journal.js"
import { createRepositoryStore } from "./store.js"
import type { RepositoryStore } from "./store.js"

// Over real HTTP: an answer whose client takes the headers and stops
// reading, or whose reading fails part-way, cannot hold its place in the
// read gate.
const token = "service-token-for-tests-0123456789abcdef"
const id = "dc9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d"
let root: string
let hooks: string
let store: RepositoryStore

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "shinan-git-stall-"))
  hooks = mkdtempSync(join(tmpdir(), "shinan-git-hooks-"))
  store = createRepositoryStore({
    root,
    git: createGit(),
    hooksDirectory: hooks,
  })
  // 24 MiB of documents that do not compress: far more than a socket holds.
  await store.create(id, {
    message: "Start\n",
    files: Array.from({ length: 24 }, (_, i) => ({
      path: `d/${i}.md`,
      content: new Uint8Array(randomBytes(1024 * 1024)),
    })),
  })
})
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(hooks, { recursive: true, force: true })
})

async function start(app: ReturnType<typeof createGitApp>) {
  let server!: ServerType
  const url = await new Promise<string>((resolve) => {
    server = serve(
      { fetch: app.fetch, hostname: "127.0.0.1", port: 0 },
      (info) => resolve(`http://127.0.0.1:${info.port}`),
    )
  })
  return { url, close: () => new Promise((resolve) => server.close(resolve)) }
}

/** Sends a documents read and never reads the answer past its headers. */
function stalledReader(url: string): Promise<Socket> {
  const { hostname, port } = new URL(url)
  const body = JSON.stringify({
    paths: Array.from({ length: 24 }, (_, i) => `d/${i}.md`),
  })
  return new Promise((resolve) => {
    const socket = connect(Number(port), hostname, () => {
      socket.write(
        `POST /repositories/${id}/documents HTTP/1.1\r\nHost: ${hostname}\r\nAuthorization: Bearer ${token}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
      )
      socket.once("data", () => {
        socket.pause()
        resolve(socket)
      })
    })
  })
}

const history = (url: string) =>
  fetch(`${url}/repositories/${id}/history`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  })

describe("the read gate over HTTP", () => {
  it("cuts off a reader that took the headers and stopped, and serves the next read", async () => {
    const server = await start(
      createGitApp({
        serviceToken: token,
        store,
        journal: openJournal(root),
        log: () => {},
        readLimits: { running: 1, queued: 4, sendDeadlineMs: 1500 },
      }),
    )
    try {
      const stalled = await stalledReader(server.url)
      const closed = new Promise((resolve) => stalled.once("close", resolve))
      const started = Date.now()
      const next = await history(server.url)
      expect(next.status).toBe(200)
      const waited = Date.now() - started
      expect(waited).toBeGreaterThan(1000)
      expect(waited).toBeLessThan(6000)
      // A paused socket reports the end only once what came is read.
      stalled.resume()
      await closed
    } finally {
      await server.close()
    }
  })

  it("cuts off an answer whose reading fails part-way, logs it briefly, and serves the next read", async () => {
    const logged: string[] = []
    const failing: RepositoryStore = {
      ...store,
      openDocuments() {
        async function* documents() {
          yield {
            path: "a.md",
            oid: "a".repeat(40),
            size: 1,
            content: new Uint8Array([97]),
          }
          await Promise.resolve()
          throw new Error("The secret value is in this message")
        }
        return Promise.resolve({
          commit: "c".repeat(40),
          documents: documents(),
        })
      },
    }
    const server = await start(
      createGitApp({
        serviceToken: token,
        store: failing,
        journal: openJournal(root),
        log: (line) => logged.push(line),
        readLimits: { running: 1, queued: 4 },
      }),
    )
    try {
      const answer = await fetch(`${server.url}/repositories/${id}/documents`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ paths: ["a.md", "b.md"] }),
      })
      expect(answer.status).toBe(200)
      await expect(answer.text()).rejects.toThrow()
      expect(logged).toEqual(["Git API documents read failed: Error"])
      expect((await history(server.url)).status).toBe(200)
    } finally {
      await server.close()
    }
  })
})
