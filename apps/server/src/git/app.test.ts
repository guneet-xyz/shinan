import { spawnSync } from "node:child_process"
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { encodeGitContext, gitContextHeader } from "@shinan/core"
import type { GitRequestContext } from "@shinan/core"
import { createGit } from "@shinan/git"
import { commitFiles } from "@shinan/git/testing"

import { createGitApp } from "./app.js"
import { openJournal } from "./journal.js"
import type { Journal } from "./journal.js"
import { createRepositoryStore, repositoryConfiguration } from "./store.js"

const token = "service-token-for-tests-0123456789abcdef"
const git = createGit()
const workspaceId = "0b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d"
let root: string
let hooks: string
let journal: Journal
let app: ReturnType<typeof createGitApp>

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "shinan-git-role-"))
  hooks = mkdtempSync(join(tmpdir(), "shinan-git-hooks-"))
  journal = openJournal(root)
  app = createGitApp({
    serviceToken: token,
    store: createRepositoryStore({ root, git, hooksDirectory: hooks }),
    journal,
    log: () => {},
  })
})
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(hooks, { recursive: true, force: true })
})

const auth = { authorization: `Bearer ${token}` }
const request = async (path: string, init: RequestInit = {}) =>
  app.request(path, { ...init, headers: { ...auth, ...init.headers } })
const json = (body: unknown) => ({
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
})
const base64 = (text: string) => Buffer.from(text).toString("base64")

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
  allowedValues: ["a".repeat(64)],
}

describe("the service token", () => {
  it("is needed on every request: missing, wrong and right", async () => {
    for (const authorization of [
      undefined,
      "",
      "Bearer",
      "Bearer wrong-token-of-the-same-length-0123456789",
      `Bearer ${token}x`,
      `Bearer ${token.slice(1)}`,
      `bearer  ${token}`,
      `Basic ${Buffer.from(`x:${token}`).toString("base64")}`,
      token,
    ]) {
      for (const path of [
        "/repositories/" + workspaceId,
        "/journal",
        "/anything",
      ]) {
        const response = await app.request(path, {
          headers: authorization === undefined ? {} : { authorization },
        })
        expect(response.status, `${authorization} ${path}`).toBe(401)
        expect(await response.json()).toEqual({
          error: "unauthorized",
          message: "This needs the service token",
        })
      }
    }
    expect((await request("/journal")).status).toBe(200)
    expect((await request("/anything")).status).toBe(404)
  })

  it("comes before the context header, which is never read without it", async () => {
    for (const value of [
      "!!not base64url!!",
      "x".repeat(200_000),
      encodeGitContext(context),
    ]) {
      const response = await app.request("/journal", {
        headers: { [gitContextHeader]: value },
      })
      expect(response.status).toBe(401)
    }
    const forged = await app.request(`/repositories/${workspaceId}`, {
      method: "PUT",
      headers: {
        [gitContextHeader]: encodeGitContext(context),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: "m",
        files: [{ path: "a.md", content: base64("a") }],
      }),
    })
    expect(forged.status).toBe(401)
    expect((await request(`/repositories/${workspaceId}`)).status).toBe(404)
  })
})

describe("the context header", () => {
  const withContext = (value: string) =>
    request("/journal", { headers: { [gitContextHeader]: value } })

  it("is read when the service token is right", async () => {
    expect((await withContext(encodeGitContext(context))).status).toBe(200)
  })

  it("is refused when malformed, too large, or with too many allowed values", async () => {
    for (const value of [
      "!!",
      Buffer.from("not json").toString("base64url"),
      Buffer.from(JSON.stringify({ ...context, mayPush: "yes" })).toString(
        "base64url",
      ),
      Buffer.from(JSON.stringify({ ...context, workspaceId: "x" })).toString(
        "base64url",
      ),
      Buffer.from(
        JSON.stringify({ ...context, allowedValues: ["xyz"] }),
      ).toString("base64url"),
      Buffer.from(
        JSON.stringify({
          ...context,
          allowedValues: Array.from({ length: 101 }, () => "b".repeat(64)),
        }),
      ).toString("base64url"),
    ]) {
      const response = await withContext(value)
      expect(response.status, value.slice(0, 40)).toBe(400)
      expect(await response.json()).toMatchObject({ error: "invalid-context" })
    }
    const large = await withContext("A".repeat(64 * 1024 + 1))
    expect(large.status).toBe(413)
    expect(
      (
        await withContext(
          encodeGitContext({
            ...context,
            allowedValues: Array.from({ length: 100 }, () => "b".repeat(64)),
          }),
        )
      ).status,
    ).toBe(200)
    expect(() =>
      encodeGitContext({
        ...context,
        memberHandles: Array.from({ length: 1000 }, () => "x".repeat(100)),
      }),
    ).toThrow()
  })
})

describe("repositories", () => {
  let first: string

  it("are created with Shinan's configuration and a first commit", async () => {
    const response = await request(
      `/repositories/${workspaceId}`,
      json({
        message: "Start the catalog\n",
        files: [{ path: "README.md", content: base64("# Catalog\n") }],
      }),
    )
    expect(response.status).toBe(201)
    const body = (await response.json()) as { created: boolean; main: string }
    expect(body).toMatchObject({ workspaceId, created: true })
    first = body.main
    const gitDir = join(root, `${workspaceId}.git`)
    const config = spawnSync(
      "git",
      ["--git-dir", gitDir, "config", "--local", "--list"],
      {
        encoding: "utf8",
      },
    ).stdout
    for (const [key, value] of repositoryConfiguration(hooks)) {
      expect(config).toContain(`${key.toLowerCase()}=${value}\n`)
    }
    for (const key of [
      "core.hookspath",
      "receive.fsckobjects",
      "transfer.fsckobjects",
      "receive.maxinputsize",
      "receive.advertisepushoptions",
      "core.fsync",
      "gc.autodetach",
      "pack.threads",
      "pack.windowmemory",
    ]) {
      expect(config).toContain(`${key}=`)
    }
    const log = spawnSync(
      "git",
      ["--git-dir", gitDir, "log", "--format=%an <%ae>|%s", "main"],
      {
        encoding: "utf8",
      },
    ).stdout
    expect(log).toBe("Shinan <shinan@shinan.invalid>|Start the catalog\n")
    expect(spawnSync("ls", [join(gitDir, "hooks")]).status).not.toBe(0)
    expect(
      spawnSync("ls", [join(root, ".tmp")], { encoding: "utf8" }).stdout,
    ).toBe("")
  })

  it("are created once: asking again changes nothing", async () => {
    const again = await request(
      `/repositories/${workspaceId}`,
      json({
        message: "Other\n",
        files: [{ path: "OTHER.md", content: base64("x") }],
      }),
    )
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({
      workspaceId,
      created: false,
      main: first,
    })
    expect(
      await (await request(`/repositories/${workspaceId}`)).json(),
    ).toEqual({
      workspaceId,
      main: first,
    })
  })

  it("made at the same time, end up as one", async () => {
    const id = "4b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d"
    const answers = await Promise.all(
      [1, 2, 3].map((n) =>
        request(
          `/repositories/${id}`,
          json({
            message: `M${n}\n`,
            files: [{ path: "README.md", content: base64(`${n}`) }],
          }),
        ).then((r) => r.json() as Promise<{ created: boolean; main: string }>),
      ),
    )
    expect(answers.filter((a) => a.created)).toHaveLength(1)
    expect(new Set(answers.map((a) => a.main)).size).toBe(1)
  })

  it("refuse what is not a workspace ID, a file or a message", async () => {
    const put = (id: string, body: unknown) =>
      request(`/repositories/${id}`, json(body))
    const ok = { message: "m", files: [{ path: "a.md", content: base64("a") }] }
    for (const id of [
      "..",
      "x",
      "0B9C1A2E-3D4F-4A5B-8C6D-7E8F9A0B1C2D",
      "%2e%2e",
    ]) {
      expect((await put(id, ok)).status, id).toBe(404)
    }
    const id = "5b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d"
    for (const body of [
      {},
      { ...ok, message: "" },
      { ...ok, files: [] },
      { ...ok, files: [{ path: "../x", content: base64("a") }] },
      { ...ok, files: [{ path: ".git/config", content: base64("a") }] },
      { ...ok, files: [{ path: "a/.GIT/hooks/x", content: base64("a") }] },
      { ...ok, files: [{ path: "a.md" }] },
      {
        ...ok,
        files: [
          {
            path: "big.md",
            content: Buffer.alloc(1024 * 1024 + 1).toString("base64"),
          },
        ],
      },
    ]) {
      expect(
        (await put(id, body)).status,
        JSON.stringify(body).slice(0, 60),
      ).toBe(400)
    }
    expect((await request(`/repositories/${id}`)).status).toBe(404)
  })
})

describe("the read API", () => {
  const id = "6b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d"
  let first: string
  let second: string

  beforeAll(async () => {
    const created = await request(
      `/repositories/${id}`,
      json({
        message: "Start\n",
        files: [{ path: "README.md", content: base64("# Catalog\n") }],
      }),
    )
    first = ((await created.json()) as { main: string }).main
    second = await commitFiles(
      git,
      join(root, `${id}.git`),
      {
        "README.md": "# Catalog\n",
        "machine/musashi.md": "musashi\n",
        "big.bin": "z".repeat(1024 * 1024 + 10),
      },
      { parents: [first], message: "Add Musashi\n", ref: "refs/heads/main" },
    )
  })

  const get = async (path: string) => {
    const response = await request(`/repositories/${id}${path}`)
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    }
  }

  it("lists main's tree or a commit's", async () => {
    const tree = await get("/tree")
    expect(tree.status).toBe(200)
    expect(tree.body.commit).toBe(second)
    expect(
      (tree.body.entries as { path: string }[]).map((e) => e.path),
    ).toEqual(["README.md", "big.bin", "machine/musashi.md"])
    const old = await get(`/tree?commit=${first}`)
    expect((old.body.entries as unknown[]).length).toBe(1)
    const folder = await get("/tree?path=machine/")
    expect(
      (folder.body.entries as { path: string }[]).map((e) => e.path),
    ).toEqual(["machine/musashi.md"])
  })

  it("reads documents by path, with their bytes; missing and too-large ones say so", async () => {
    const response = await request(`/repositories/${id}/documents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commit: "main",
        paths: ["machine/musashi.md", "nothing.md", "big.bin", "machine"],
      }),
    })
    const body = (await response.json()) as {
      commit: string
      documents: Record<string, unknown>[]
    }
    expect(body.commit).toBe(second)
    expect(body.documents[0]).toMatchObject({
      path: "machine/musashi.md",
      size: 8,
      content: base64("musashi\n"),
    })
    expect(body.documents[1]).toEqual({ path: "nothing.md", missing: true })
    expect(body.documents[2]).toEqual({
      path: "big.bin",
      tooLarge: true,
      size: 1024 * 1024 + 10,
    })
    expect(body.documents[3]).toEqual({ path: "machine", missing: true })
  })

  it("diffs two commits, or a commit and the empty tree", async () => {
    const diff = await get(`/diff?from=${first}&to=main`)
    expect(diff.body).toMatchObject({ from: first, to: second })
    expect(
      (diff.body.changes as { status: string; path: string }[]).map(
        (c) => `${c.status} ${c.path}`,
      ),
    ).toEqual(["added big.bin", "added machine/musashi.md"])
    const all = await get(`/diff?to=${first}`)
    expect(all.body).toMatchObject({
      from: null,
      changes: [{ status: "added", path: "README.md" }],
    })
  })

  it("gives the history of main or of one path", async () => {
    const history = await get("/history")
    expect(
      (history.body.commits as { oid: string }[]).map((c) => c.oid),
    ).toEqual([second, first])
    expect(
      (history.body.commits as Record<string, unknown>[])[1],
    ).toMatchObject({
      parents: [],
      message: "Start\n",
      author: { name: "Shinan", email: "shinan@shinan.invalid" },
    })
    const one = await get("/history?path=machine/musashi.md&limit=1")
    expect((one.body.commits as { oid: string }[]).map((c) => c.oid)).toEqual([
      second,
    ])
    const page = await get("/history?limit=1&skip=1")
    expect((page.body.commits as { oid: string }[]).map((c) => c.oid)).toEqual([
      first,
    ])
  })

  it("lists, with each commit, the paths it changed", async () => {
    const history = await get("/history")
    expect(
      (history.body.commits as Record<string, unknown>[]).map((c) => ({
        changes: c.changes,
        changeCount: c.changeCount,
        changesTruncated: c.changesTruncated,
      })),
    ).toEqual([
      {
        changes: [
          { status: "added", path: "big.bin" },
          { status: "added", path: "machine/musashi.md" },
        ],
        changeCount: 2,
        changesTruncated: false,
      },
      {
        changes: [{ status: "added", path: "README.md" }],
        changeCount: 1,
        changesTruncated: false,
      },
    ])
    // A page of one path's history still lists each commit's whole change.
    const one = await get("/history?path=machine/musashi.md")
    expect(
      (one.body.commits as { changeCount: number }[]).map((c) => c.changeCount),
    ).toEqual([2])
  })

  it("marks commits too large to read whole as truncated", async () => {
    const history = await get("/history")
    expect(
      (history.body.commits as { truncated: boolean }[]).map(
        (c) => c.truncated,
      ),
    ).toEqual([false, false])
  })

  it("refuses to skip more than a million commits", async () => {
    expect((await get("/history?skip=1000000")).status).toBe(200)
    for (const skip of ["1000001", "999999999999999"]) {
      expect((await get(`/history?skip=${skip}`)).status, skip).toBe(400)
    }
  })

  it("refuses revisions that are not main or a full commit ID, and paths that are not plain", async () => {
    for (const path of [
      "/tree?commit=HEAD",
      "/tree?commit=refs/heads/main",
      "/tree?commit=:/Start",
      `/tree?commit=${second.slice(0, 12)}`,
      "/tree?path=../x",
      "/history?limit=0",
      "/history?limit=101",
      "/history?limit=x",
      "/history?path=/etc",
      "/diff?to=main~1",
      "/diff",
    ]) {
      expect((await get(path)).status, path).toBe(400)
    }
    expect((await get(`/tree?commit=${"0".repeat(40)}`)).status).toBe(404)
    expect(
      (await request(`/repositories/7b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d/tree`))
        .status,
    ).toBe(404)
  })
})

describe("a documents read", () => {
  it("returns at most its byte budget; documents past it are deferred", async () => {
    const folder = mkdtempSync(join(tmpdir(), "shinan-git-budget-"))
    try {
      const store = createRepositoryStore({
        root: folder,
        git,
        hooksDirectory: hooks,
        maxResponseBytes: 25,
      })
      const budgetApp = createGitApp({
        serviceToken: token,
        store,
        journal: openJournal(folder),
        log: () => {},
      })
      const id = "9c9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d"
      const ten = (n: number) => ({
        path: `p/${n}.md`,
        content: new TextEncoder().encode(`${n}`.padEnd(10, "x")),
      })
      await store.create(id, {
        message: "Start\n",
        files: [0, 1, 2, 3].map(ten),
      })
      const response = await budgetApp.request(
        `/repositories/${id}/documents`,
        {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify({
            paths: ["p/0.md", "p/1.md", "nothing.md", "p/2.md", "p/3.md"],
          }),
        },
      )
      const body = (await response.json()) as {
        documents: Record<string, unknown>[]
      }
      expect(
        body.documents.map((d) => Object.keys(d).sort().join(",")),
      ).toEqual([
        "content,oid,path,size",
        "content,oid,path,size",
        "missing,path",
        "deferred,path,size",
        "deferred,path,size",
      ])
      expect(body.documents[3]).toEqual({
        path: "p/2.md",
        deferred: true,
        size: 10,
      })
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})

describe("the journal", () => {
  it("is read in order and acknowledged idempotently; numbers are never reused", async () => {
    const folder = mkdtempSync(join(tmpdir(), "shinan-git-journal-"))
    try {
      const own = openJournal(folder)
      let journalApp = createGitApp({
        serviceToken: token,
        store: createRepositoryStore({
          root: folder,
          git,
          hooksDirectory: hooks,
        }),
        journal: own,
        log: () => {},
      })
      const call = async (path: string, init: RequestInit = {}) => {
        const response = await journalApp.request(path, {
          ...init,
          headers: {
            ...auth,
            "content-type": "application/json",
            ...init.headers,
          },
        })
        return {
          status: response.status,
          body: (await response.json()) as Record<string, unknown>,
        }
      }
      const ack = (through: unknown) =>
        call("/journal/acknowledge", {
          method: "POST",
          body: JSON.stringify({ through }),
        })

      for (const n of [1, 2, 3]) await own.append("push.test", { n })
      const read = await call("/journal?after=0")
      expect(
        (
          read.body.entries as { number: number; kind: string; data: unknown }[]
        ).map((e) => [e.number, e.kind, e.data]),
      ).toEqual([
        [1, "push.test", { n: 1 }],
        [2, "push.test", { n: 2 }],
        [3, "push.test", { n: 3 }],
      ])
      expect(read.body.last).toBe(3)
      expect(
        (
          (await call("/journal?after=1&limit=1")).body.entries as {
            number: number
          }[]
        ).map((e) => e.number),
      ).toEqual([2])

      expect((await ack(2)).body).toEqual({ deleted: 2 })
      expect((await ack(2)).body).toEqual({ deleted: 0 })
      expect((await ack(1)).body).toEqual({ deleted: 0 })
      expect(
        (
          (await call("/journal?after=0")).body.entries as { number: number }[]
        ).map((e) => e.number),
      ).toEqual([3])
      for (const through of [4, -1, 1.5, "3"]) {
        expect((await ack(through)).status, String(through)).toBe(400)
      }
      expect((await ack(3)).body).toEqual({ deleted: 1 })

      // After every entry is acknowledged and the container restarts.
      const reopened = openJournal(folder)
      expect(reopened.last()).toBe(3)
      expect((await reopened.append("push.test", {})).number).toBe(4)
      await expect(reopened.append("Not a kind", {})).rejects.toThrow()
      // A damaged entry is never skipped or deleted: reads and
      // acknowledgements stop at it, with its number.
      // The role restarts with the reopened journal.
      journalApp = createGitApp({
        serviceToken: token,
        store: createRepositoryStore({
          root: folder,
          git,
          hooksDirectory: hooks,
        }),
        journal: reopened,
        log: () => {},
      })
      await reopened.append("push.test", { n: 5 })
      await reopened.append("push.test", { n: 6 })
      writeFileSync(
        join(folder, "journal", "entries", "0000000000000005.json"),
        "{not json",
      )
      const damaged = await call("/journal?after=3")
      expect(damaged.status).toBe(500)
      expect(damaged.body).toMatchObject({ error: "journal-damaged" })
      expect(String(damaged.body.message)).toContain(
        "Journal entry 5 is damaged",
      )
      expect((await call("/journal?after=5")).status).toBe(200)
      expect((await ack(6)).status).toBe(500)
      expect(readdirSync(join(folder, "journal", "entries")).sort()).toEqual([
        "0000000000000005.json",
        "0000000000000006.json",
      ])
      for (const query of ["after=-1", "after=x", "limit=0", "limit=1001"]) {
        expect((await call(`/journal?${query}`)).status, query).toBe(400)
      }
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})
