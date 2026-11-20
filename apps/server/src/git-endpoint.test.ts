import { execFile } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import type { Server } from "node:http"
import type { AddressInfo, Socket } from "node:net"
import { connect } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { deflateSync } from "node:zlib"
import { serve } from "@hono/node-server"
import type { ServerType } from "@hono/node-server"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createAgentToken, createWorkspace } from "@shinan/core"
import type { JobQueue } from "@shinan/core"
import { schema } from "@shinan/db"
import { connectTestDatabase } from "@shinan/db/testing"
import { createGit, findProgram } from "@shinan/git"
import { commitFiles } from "@shinan/git/testing"

import { insertPerson } from "../test/people.js"
import { noSignIn } from "./api/sign-in.js"
import { createApp } from "./app.js"
import { gitMessages } from "./git-text.js"
import { createGitApp } from "./git/app.js"
import { openJournal } from "./git/journal.js"
import { createRepositoryStore } from "./git/store.js"
import type { RepositoryStore } from "./git/store.js"
import { listenerOptions } from "./in-flight.js"

// The Git endpoint end to end (Git-based catalog plan §2.2, GC-2): a real
// `git` client, `web` on a real listener, and a Git container on another,
// with the agent setup of GC-9 (a credential helper that reads the token
// from a file and gives it as the password).

const { db, pool } = connectTestDatabase()
const installationUrl = "http://shinan.test"
const jobs: JobQueue = { send: () => Promise.resolve(null) }
const serviceToken = "service-token-for-tests-0123456789abcdef"
/** Seconds a request other than a push has to arrive, short for the test. */
const receiveSeconds = 2
/** Seconds a push has, as `web`'s listener allows. */
const pushSeconds = 5

let work: string
let store: RepositoryStore
let gitServer: ServerType
let webServer: ServerType
let web: string
let workspaceId: string
let otherWorkspaceId: string
let full: string
let readOnly: string
let otherToken: string
let agentHandle: string
let main: string
const sockets: Socket[] = []

/** Git processes running in the Git container. */
let running = 0
/** Until every Git process has ended, such as those of a test before. */
async function gitProcessesEnded() {
  for (let i = 0; i < 100 && running > 0; i++)
    await new Promise((resolve) => setTimeout(resolve, 50))
  expect(running).toBe(0)
}

/** Every request that reached the Git container. */
const forwarded: { method: string; url: string; headers: Headers }[] = []
/** Where the wrapped `git` and the pre-receive hook write their environments. */
let envs: string

const serverGit = createGit()

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "shinan-git-endpoint-"))
  envs = join(work, "envs")
  for (const folder of ["catalog", "hooks", "bin", "envs", "home"])
    mkdirSync(join(work, folder))
  // `git` as the Git container runs it, writing down each environment it
  // is given first.
  const wrapper = join(work, "bin", "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh\n"${findProgram("env")}" > "${envs}/git-$$.env"\nprintf '%s\\n' "$@" > "${envs}/git-$$.args"\nexec "${findProgram("git")}" "$@"\n`,
  )
  chmodSync(wrapper, 0o755)
  // The placeholder hook's refusal, and its environment written down.
  const hook = join(work, "hooks", "pre-receive")
  writeFileSync(
    hook,
    `#!${process.execPath}
const { writeFileSync } = process.getBuiltinModule("node:fs")
writeFileSync(${JSON.stringify(join(envs, "hook.env"))}, JSON.stringify(process.env))
process.stderr.write("Shinan: pushes are not open yet. Nothing was changed.\\n")
process.exitCode = 1
`,
  )
  chmodSync(hook, 0o755)

  const owner = await insertPerson(db, "owner")
  await db.insert(schema.emailAllowlist).values({ email: owner.email })
  const ownerCtx = {
    db,
    jobs,
    installationUrl,
    actor: {
      kind: "person" as const,
      personId: owner.id,
      reauthenticated: true,
    },
  }
  const create = async (name: string) =>
    (
      await createWorkspace(
        { db, actor: { kind: "person", personId: owner.id } },
        { name },
      )
    ).workspace.id
  workspaceId = await create("Team")
  otherWorkspaceId = await create("Other")
  const issue = async (
    id: string,
    machine: string,
    access: "full" | "read-only",
  ) =>
    createAgentToken(ownerCtx, {
      workspaceId: id,
      codingTool: "opencode",
      machine,
      access,
    })
  const issued = await issue(workspaceId, "daedalus", "full")
  full = issued.token
  agentHandle = issued.agent.handle
  readOnly = (await issue(workspaceId, "laptop", "read-only")).token
  otherToken = (await issue(otherWorkspaceId, "daedalus", "full")).token

  // Counting the Git processes that run, to wait for them to end.
  const wrapped = createGit({ binary: wrapper, home: join(work, "home") })
  const git = {
    ...wrapped,
    spawn: (...args: Parameters<typeof wrapped.spawn>) => {
      const spawned = wrapped.spawn(...args)
      running++
      void spawned.ended.then(() => running--)
      return spawned
    },
  }
  store = createRepositoryStore({
    root: join(work, "catalog"),
    git,
    hooksDirectory: join(work, "hooks"),
  })
  main = (
    await store.create(workspaceId, {
      files: [{ path: "README.md", content: Buffer.from("# Catalog\n") }],
      message: "Start the catalog\n",
    })
  ).main
  const gitApp = createGitApp({
    serviceToken,
    store,
    journal: openJournal(join(work, "catalog")),
    log: () => {},
    // Two Git processes at once and none waiting, for the process cap.
    gitProcesses: { running: 2, queued: 0, waitMs: 0, perAgent: 2 },
  })
  gitServer = serve({
    fetch: (request, env) => {
      forwarded.push({
        method: request.method,
        url: request.url,
        headers: new Headers(request.headers),
      })
      return gitApp.fetch(request, env)
    },
    hostname: "127.0.0.1",
    port: 0,
    serverOptions: { maxHeaderSize: 80 * 1024, ...listenerOptions(120) },
  })
  await new Promise<void>((resolve) => gitServer.once("listening", resolve))

  const app = createApp({
    db,
    signIn: noSignIn,
    jobs,
    installationUrl,
    rateLimit: false,
    git: {
      url: `http://127.0.0.1:${(gitServer.address() as AddressInfo).port}`,
      serviceToken,
    },
    receiveSeconds,
  })
  webServer = serve({
    fetch: app.fetch,
    hostname: "127.0.0.1",
    port: 0,
    serverOptions: listenerOptions(pushSeconds),
  })
  await new Promise<void>((resolve) => webServer.once("listening", resolve))
  web = `http://127.0.0.1:${(webServer.address() as AddressInfo).port}`
})

afterAll(async () => {
  for (const socket of sockets) socket.destroy()
  await Promise.all(
    [webServer, gitServer].map(
      (server) =>
        new Promise<void>((resolve) => {
          ;(server as Server).closeAllConnections()
          server.close(() => resolve())
        }),
    ),
  )
  await pool.end()
  rmSync(work, { recursive: true, force: true })
})

const repository = () => `${web}/git/${workspaceId}.git`

/**
 * Runs the `git` client as an agent would, with GC-9's credential helper
 * (draft PR #176): the token is read from `~/.config/shinan/token` and
 * given as the password. `token: null` sets up no helper.
 */
function client(
  args: string[],
  options: { cwd?: string; token?: string | null } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const home = join(work, "client-home")
  mkdirSync(join(home, ".config", "shinan"), { recursive: true })
  const token = options.token === undefined ? full : options.token
  if (token !== null)
    writeFileSync(join(home, ".config", "shinan", "token"), token)
  const helper =
    token === null
      ? []
      : [
          "-c",
          `credential.${web}.helper=`,
          "-c",
          `credential.${web}.helper=!f(){ test "$1" = get && printf "username=agent\\npassword=%s\\n" "$(cat ~/.config/shinan/token)"; }; f`,
        ]
  return new Promise((resolve) => {
    execFile(
      findProgram("git")!,
      [...helper, ...args],
      {
        cwd: options.cwd ?? work,
        env: {
          PATH: process.env.PATH,
          HOME: home,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
          LC_ALL: "C",
        },
      },
      (error, stdout, stderr) =>
        resolve({
          code: error ? ((error as { code?: number }).code ?? 1) : 0,
          stdout,
          stderr,
        }),
    )
  })
}

/**
 * A push's body: one command, then a pack of one file of `size` bytes,
 * stored without compression, so Git has to read every byte of it.
 */
function pushOf(size: number): Buffer {
  const zero = "0".repeat(40)
  const command = `${zero} ${"1".repeat(40)} refs/heads/big\0report-status\n`
  const line = Buffer.from(
    `${(command.length + 4).toString(16).padStart(4, "0")}${command}0000`,
  )
  const header = Buffer.alloc(12)
  header.write("PACK", 0)
  header.writeUInt32BE(2, 4)
  header.writeUInt32BE(1, 8)
  // A blob's type (3) and size, seven bits at a time.
  const object = [0x30 | (size & 0x0f)]
  for (
    let rest = Math.floor(size / 16);
    rest > 0;
    rest = Math.floor(rest / 128)
  ) {
    object[object.length - 1]! |= 0x80
    object.push(rest & 0x7f)
  }
  const pack = Buffer.concat([
    header,
    Buffer.from(object),
    deflateSync(Buffer.alloc(size), { level: 0 }),
  ])
  return Buffer.concat([line, pack, createHash("sha1").update(pack).digest()])
}

const basic = (token: string) =>
  `Basic ${Buffer.from(`agent:${token}`).toString("base64")}`

/** Whether anything reached the Git container while `run` ran. */
async function forwardedDuring(run: () => Promise<void>): Promise<string[]> {
  const before = forwarded.length
  await run()
  return forwarded.slice(before).map((r) => `${r.method} ${r.url}`)
}

describe("the Git endpoint", () => {
  it.each([0, 2])(
    "clones and fetches through web with protocol v%i, with GC-9's credential helper",
    async (version) => {
      const folder = `clone-v${version}`
      const before = forwarded.length
      const cloned = await client([
        "-c",
        `protocol.version=${version}`,
        "clone",
        "--quiet",
        repository(),
        folder,
      ])
      expect(cloned.stderr).toBe("")
      expect(cloned.code).toBe(0)
      expect(readFileSync(join(work, folder, "README.md"), "utf8")).toMatch(
        /^# Catalog\n/,
      )
      // Protocol v2 is asked for with Git-Protocol, which reaches Git.
      const protocols = forwarded
        .slice(before)
        .map((r) => r.headers.get("git-protocol"))
      if (version === 2) expect(protocols).toContain("version=2")
      else expect(protocols.every((p) => p === null)).toBe(true)

      const next = await commitFiles(
        serverGit,
        store.pathOf(workspaceId),
        { "README.md": "# Catalog\n\nMore.\n" },
        {
          parents: [main],
          ref: "refs/heads/main",
          message: `Fetch over v${version}\n`,
        },
      )
      main = next
      const fetched = await client(
        ["-c", `protocol.version=${version}`, "fetch", "--quiet"],
        { cwd: join(work, folder) },
      )
      expect(fetched.code).toBe(0)
      const head = await client(["rev-parse", "origin/main"], {
        cwd: join(work, folder),
      })
      expect(head.stdout.trim()).toBe(next)
    },
  )

  it("refuses every push with the placeholder hook's words", async () => {
    const folder = join(work, "clone-v2")
    writeFileSync(join(folder, "new.md"), "New\n")
    await client(["add", "new.md"], { cwd: folder })
    await client(
      [
        "-c",
        "user.name=Agent",
        "-c",
        "user.email=agent@example.com",
        "commit",
        "--quiet",
        "-m",
        "New",
      ],
      { cwd: folder },
    )
    const pushed = await client(["push", "origin", "HEAD:refs/heads/change"], {
      cwd: folder,
    })
    expect(pushed.code).not.toBe(0)
    expect(pushed.stderr).toContain(
      "Shinan: pushes are not open yet. Nothing was changed.",
    )
    expect(pushed.stderr).toContain("pre-receive hook declined")
    expect(await store.main(workspaceId)).toBe(main)
  })

  it("never gives the Git container the agent's token, nor Git the service token", () => {
    expect(forwarded.length).toBeGreaterThan(0)
    for (const request of forwarded) {
      const headers = JSON.stringify([...request.headers])
      for (const token of [full, readOnly, otherToken]) {
        expect(headers).not.toContain(token)
        expect(request.url).not.toContain(token)
      }
      expect(request.headers.get("authorization")).toBe(
        `Bearer ${serviceToken}`,
      )
      expect(request.headers.get("cookie")).toBeNull()
      expect(request.headers.get("shinan-git-context")).not.toBeNull()
    }
    const files = readdirSync(envs)
    const read = (name: string) => readFileSync(join(envs, name), "utf8")
    const backends = files.filter(
      (name) => name.endsWith(".env") && read(name).includes("PATH_INFO="),
    )
    expect(backends.length).toBeGreaterThan(0)
    for (const name of files) {
      const env = readFileSync(join(envs, name), "utf8")
      expect(env).not.toContain(serviceToken)
      for (const token of [full, readOnly, otherToken])
        expect(env).not.toContain(token)
    }
    for (const name of backends) {
      const env = read(name)
      expect(env).toContain(`REMOTE_USER=${agentHandle}\n`)
      expect(env).toContain("GIT_HTTP_EXPORT_ALL=1\n")
      expect(env).toContain(`GIT_PROJECT_ROOT=${store.root}\n`)
      // Shinan's settings are on the command line of every run.
      const args = read(name.replace(/\.env$/, ".args")).split("\n")
      expect(args).toContain(`core.hooksPath=${store.hooksDirectory}`)
      expect(args).toContain("receive.fsckObjects=true")
      expect(args).toContain("http.getanyfile=false")
      expect(args.at(-2)).toBe("http-backend")
    }
    // The hook ran (the push above), with those settings passed down.
    const hook = JSON.parse(read("hook.env")) as Record<string, string>
    expect(hook.GIT_CONFIG_PARAMETERS).toContain(
      `'core.hooksPath'='${store.hooksDirectory}'`,
    )
  })

  it("asks for credentials, with Basic, when a request has none", async () => {
    const paths = await forwardedDuring(async () => {
      const response = await fetch(
        `${repository()}/info/refs?service=git-upload-pack`,
      )
      expect(response.status).toBe(401)
      expect(response.headers.get("www-authenticate")).toBe(
        'Basic realm="Shinan", charset="UTF-8"',
      )
      expect(response.headers.get("content-type")).toBe(
        "text/plain; charset=utf-8",
      )
      expect(await response.text()).toBe(`${gitMessages.noToken}\n`)
      const cloned = await client(
        ["clone", "--quiet", repository(), "no-token"],
        { token: null },
      )
      expect(cloned.code).not.toBe(0)
      expect(cloned.stderr).toMatch(/could not read Username/)
    })
    expect(paths).toEqual([])
  })

  it("takes the token as the Basic password, whatever the user name, or as Bearer", async () => {
    for (const authorization of [
      basic(full),
      `Basic ${Buffer.from(`anything-at-all:${full}`).toString("base64")}`,
      `Bearer ${full}`,
    ]) {
      const response = await fetch(
        `${repository()}/info/refs?service=git-upload-pack`,
        { headers: { authorization } },
      )
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toBe(
        "application/x-git-upload-pack-advertisement",
      )
      expect(response.headers.get("cache-control")).toContain("no-cache")
      await response.arrayBuffer()
    }
    for (const authorization of [
      basic("shn_wrong"),
      basic(""),
      `Basic ${Buffer.from(full).toString("base64")}`,
      `Bearer ${full}x`,
    ]) {
      const response = await fetch(
        `${repository()}/info/refs?service=git-upload-pack`,
        { headers: { authorization } },
      )
      expect(response.status, authorization).toBe(401)
      expect(response.headers.get("www-authenticate")).toContain("Basic")
      expect(await response.text()).toBe(
        authorization === basic("")
          ? `${gitMessages.noToken}\n`
          : `${gitMessages.invalidToken}\n`,
      )
    }
  })

  it("refuses cookies, and a token in the address", async () => {
    const paths = await forwardedDuring(async () => {
      const withCookie = await fetch(
        `${repository()}/info/refs?service=git-upload-pack`,
        { headers: { authorization: basic(full), cookie: "session=x" } },
      )
      expect(withCookie.status).toBe(401)
      expect(await withCookie.text()).toContain("send no cookies")
      const inAddress = await fetch(
        `${repository()}/info/refs?service=git-upload-pack&token=${full}`,
        { headers: { authorization: basic(full) } },
      )
      expect(inAddress.status).toBe(400)
      expect(await inAddress.text()).toBe(`${gitMessages.tokenInAddress}\n`)
      // Wherever in the address it is, the leak is named first.
      const inPath = await fetch(`${web}/git/${full}/info/refs`)
      expect(inPath.status).toBe(400)
      expect(await inPath.text()).toBe(`${gitMessages.tokenInAddress}\n`)
    })
    expect(paths).toEqual([])
  })

  it("lets a read-only token clone but refuses its push with 403, before forwarding", async () => {
    const cloned = await client(
      ["clone", "--quiet", repository(), "read-only"],
      { token: readOnly },
    )
    expect(cloned.code).toBe(0)
    const paths = await forwardedDuring(async () => {
      const response = await fetch(
        `${repository()}/info/refs?service=git-receive-pack`,
        { headers: { authorization: basic(readOnly) } },
      )
      expect(response.status).toBe(403)
      expect(await response.text()).toBe(`${gitMessages.readOnly}\n`)
      const post = await fetch(`${repository()}/git-receive-pack`, {
        method: "POST",
        headers: {
          authorization: basic(readOnly),
          "content-type": "application/x-git-receive-pack-request",
        },
        body: "0000",
      })
      expect(post.status).toBe(403)
      const pushed = await client(["push", "origin", "HEAD:refs/heads/x"], {
        cwd: join(work, "read-only"),
        token: readOnly,
      })
      expect(pushed.code).not.toBe(0)
      expect(pushed.stderr).toContain(`remote: ${gitMessages.readOnly}`)
    })
    expect(paths).toEqual([])
  })

  it("answers another workspace's token as for a workspace that does not exist", async () => {
    const paths = await forwardedDuring(async () => {
      const answers = []
      for (const [id, token] of [
        [workspaceId, otherToken],
        ["9b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d", full],
        ["9b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d", otherToken],
      ] as const) {
        const response = await fetch(
          `${web}/git/${id}.git/info/refs?service=git-upload-pack`,
          { headers: { authorization: basic(token) } },
        )
        answers.push([response.status, await response.text()])
      }
      expect(answers).toEqual([
        [404, `${gitMessages.notFound}\n`],
        [404, `${gitMessages.notFound}\n`],
        [404, `${gitMessages.notFound}\n`],
      ])
    })
    expect(paths).toEqual([])
  })

  it("answers 404 to everything but the four smart HTTP requests, before forwarding", async () => {
    const id = `${web}/git/${workspaceId}.git`
    const paths = await forwardedDuring(async () => {
      for (const [method, url] of [
        ["GET", `${id}/HEAD`],
        ["GET", `${id}/info/refs`],
        ["GET", `${id}/info/refs?service=git-upload-archive`],
        ["GET", `${id}/info/refs?service=git-upload-pack&x=1`],
        ["GET", `${id}/info/packs`],
        ["GET", `${id}/objects/info/packs`],
        ["GET", `${id}/objects/${main.slice(0, 2)}/${main.slice(2)}`],
        ["GET", `${id}/config`],
        ["HEAD", `${id}/info/refs?service=git-upload-pack`],
        ["POST", `${id}/info/refs?service=git-upload-pack`],
        ["GET", `${id}/git-upload-pack`],
        ["POST", `${id}/git-upload-pack?service=git-upload-pack`],
        ["POST", `${id}/git-upload-archive`],
        ["PUT", `${id}/git-receive-pack`],
        ["GET", `${id}/info/refs/?service=git-upload-pack`],
        ["GET", `${web}/git/${workspaceId}/info/refs?service=git-upload-pack`],
        [
          "GET",
          `${web}/git/${workspaceId}.git//info/refs?service=git-upload-pack`,
        ],
        [
          "GET",
          `${web}/git/../${workspaceId}.git/info/refs?service=git-upload-pack`,
        ],
        [
          "GET",
          `${web}/git/${workspaceId}.git/%69nfo/refs?service=git-upload-pack`,
        ],
        ["GET", `${web}/git/not-an-id.git/info/refs?service=git-upload-pack`],
        ["GET", `${web}/git/`],
        ["GET", `${web}/git`],
      ]) {
        const response = await fetch(url!, {
          method,
          headers: { authorization: basic(full) },
          body: method === "POST" || method === "PUT" ? "0000" : undefined,
        })
        expect(response.status, `${method} ${url}`).toBe(404)
      }
    })
    expect(paths).toEqual([])
  })

  it("refuses bodies over their limits: 4 MiB to fetch, 64 MiB to push", async () => {
    const paths = await forwardedDuring(async () => {
      for (const [service, size] of [
        ["git-upload-pack", 4 * 1024 * 1024 + 1],
        ["git-receive-pack", 64 * 1024 * 1024 + 1],
      ] as const) {
        const socket = connect(Number(new URL(web).port), "127.0.0.1")
        sockets.push(socket)
        const answer = new Promise<string>((resolve) => {
          let text = ""
          socket.on("data", (chunk: Buffer) => {
            text += chunk.toString()
            if (text.includes("\r\n\r\n")) resolve(text)
          })
        })
        socket.write(
          [
            `POST /git/${workspaceId}.git/${service} HTTP/1.1`,
            "Host: shinan.test",
            `Authorization: ${basic(full)}`,
            `Content-Type: application/x-${service}-request`,
            `Content-Length: ${size}`,
            "",
            "",
          ].join("\r\n"),
        )
        expect(await answer).toMatch(/^HTTP\/1\.1 413 /)
        socket.destroy()
      }
    })
    expect(paths).toEqual([])

    // Sent in chunks, without a length: cut off when it passes the limit.
    // The push is a real one, of a 64 MiB file, so Git reads all it gets.
    for (const [service, whole] of [
      ["git-upload-pack", Buffer.alloc(5 * 1024 * 1024)],
      ["git-receive-pack", pushOf(64 * 1024 * 1024)],
    ] as const) {
      let at = 0
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (at >= whole.length) return controller.close()
          controller.enqueue(whole.subarray(at, at + 1024 * 1024))
          at += 1024 * 1024
        },
      })
      const response = await fetch(`${repository()}/${service}`, {
        method: "POST",
        headers: {
          authorization: basic(full),
          "content-type": `application/x-${service}-request`,
        },
        body,
        duplex: "half",
      })
      expect(response.status, service).toBe(413)
      expect(await response.text()).toMatch(
        /^Shinan: this (push|fetch) is over the (64|4) MiB limit\./,
      )
    }
  }, 60_000)

  it("cuts off slow senders: a fetch's body after 2 s here (30 s in production), a push's after the listener's 5 s (120 s)", async () => {
    const stall = (service: string) => {
      const socket = connect(Number(new URL(web).port), "127.0.0.1")
      sockets.push(socket)
      const started = Date.now()
      const closed = new Promise<number>((resolve) => {
        socket.on("close", () => resolve((Date.now() - started) / 1000))
        // Read, so that the end of the connection is seen.
        socket.on("data", () => {})
        socket.on("error", () => {})
      })
      socket.write(
        [
          `POST /git/${workspaceId}.git/${service} HTTP/1.1`,
          "Host: shinan.test",
          `Authorization: ${basic(full)}`,
          `Content-Type: application/x-${service}-request`,
          "Transfer-Encoding: chunked",
          "",
          // The start of a first line, so that Git waits for the rest.
          "8",
          "0098" + "0".repeat(4),
          "",
        ].join("\r\n"),
      )
      return closed
    }
    await gitProcessesEnded()
    const [fetchClosed, pushClosed] = await Promise.all([
      stall("git-upload-pack"),
      stall("git-receive-pack"),
    ])
    expect(fetchClosed).toBeGreaterThanOrEqual(receiveSeconds - 0.5)
    expect(fetchClosed).toBeLessThan(pushSeconds - 1)
    expect(pushClosed).toBeGreaterThanOrEqual(pushSeconds - 0.5)
    expect(pushClosed).toBeLessThan(pushSeconds + 8)
  }, 30_000)

  it("holds no Git process for a body that never ends: the next request is served", async () => {
    await gitProcessesEnded()
    for (let i = 0; i < 3; i++) {
      const socket = connect(Number(new URL(web).port), "127.0.0.1")
      sockets.push(socket)
      socket.on("error", () => {})
      socket.on("data", () => {})
      socket.write(
        [
          `POST /git/${workspaceId}.git/git-upload-pack HTTP/1.1`,
          "Host: shinan.test",
          `Authorization: ${basic(full)}`,
          "Content-Type: application/x-git-upload-pack-request",
          "Transfer-Encoding: chunked",
          "",
          "8",
          "0098" + "0".repeat(4),
          "",
        ].join("\r\n"),
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(running).toBe(0)
    const response = await fetch(
      `${repository()}/info/refs?service=git-upload-pack`,
      { headers: { authorization: basic(full) } },
    )
    expect(response.status).toBe(200)
    await response.arrayBuffer()
  })

  it("passes on the Git container's 429 and Retry-After when an agent's Git processes are all busy", async () => {
    await gitProcessesEnded()
    // A pack larger than every buffer between Git and the client (sockets
    // on loopback hold several MiB each), and two fetches of it whose
    // readers take only the start: each holds a Git process.
    main = await commitFiles(
      serverGit,
      store.pathOf(workspaceId),
      {
        "README.md": "# Catalog\n",
        "big.bin": { content: randomBytes(48 * 1024 * 1024) },
      },
      { parents: [main], ref: "refs/heads/main", message: "Big\n" },
    )
    const pkt = (text: string) =>
      `${(text.length + 4).toString(16).padStart(4, "0")}${text}`
    const body = [
      pkt("command=fetch\n"),
      "0001",
      pkt(`want ${main}\n`),
      pkt("done\n"),
      "0000",
    ].join("")
    const held: Socket[] = []
    for (let i = 0; i < 2; i++) {
      const socket = connect(Number(new URL(web).port), "127.0.0.1")
      sockets.push(socket)
      held.push(socket)
      socket.on("error", () => {})
      // No "data" listener: the socket takes nothing past its buffer.
      socket.write(
        [
          `POST /git/${workspaceId}.git/git-upload-pack HTTP/1.1`,
          "Host: shinan.test",
          `Authorization: ${basic(full)}`,
          "Content-Type: application/x-git-upload-pack-request",
          "Git-Protocol: version=2",
          `Content-Length: ${body.length}`,
          "",
          body,
        ].join("\r\n"),
      )
    }
    const deadline = Date.now() + 5000
    while (running < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(running).toBe(2)
    const response = await fetch(
      `${repository()}/info/refs?service=git-upload-pack`,
      { headers: { authorization: basic(full) } },
    )
    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("10")
    expect(await response.text()).toMatch(/^Shinan: /)
    for (const socket of held) socket.destroy()
    // Their Git processes end with them, and the next request is served.
    let status = 0
    for (let i = 0; i < 40 && status !== 200; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      const next = await fetch(
        `${repository()}/info/refs?service=git-upload-pack`,
        { headers: { authorization: basic(full) } },
      )
      status = next.status
      await next.arrayBuffer()
    }
    expect(status).toBe(200)
  })
})
