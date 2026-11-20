import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
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
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { serve } from "@hono/node-server"
import type { ServerType } from "@hono/node-server"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  allowCatalogValue,
  checkCatalogRefs,
  createAgentToken,
  createCatalogRepository,
  createGitClient,
  createWorkspace,
  shinan,
  storeCatalogJournal,
} from "@shinan/core"
import type { GitClient, JobQueue } from "@shinan/core"
import { and, eq, schema, sql } from "@shinan/db"
import { connectTestDatabase } from "@shinan/db/testing"
import { createGit, findProgram, hooksDirectory } from "@shinan/git"

import { insertPerson } from "../../../test/people.js"
import { noSignIn } from "../../api/sign-in.js"
import { createApp } from "../../app.js"
import { listenerOptions } from "../../in-flight.js"
import { createGitApp } from "../app.js"
import { openJournal } from "../journal.js"
import type { Journal } from "../journal.js"
import { createRepositoryStore } from "../store.js"
import type { RepositoryStore } from "../store.js"
import type { PushLimits } from "./checks.js"
import { createPushLocks } from "./lock.js"
import { openRecords } from "./records.js"
import type { Records } from "./records.js"
import { createPushService } from "./service.js"

// The push checks of GC-3a end to end (Git-based catalog plan §2.5, §2.6):
// a real `git` client pushes through `web` to a Git container that runs
// the image's own hooks, which call the git role's checks on loopback.
// `main` is open here; in production it opens with GC-3b's checks.

const { db, pool } = connectTestDatabase()
const installationUrl = "http://shinan.test"
const jobs: JobQueue = { send: () => Promise.resolve(null) }
const serviceToken = "service-token-for-tests-0123456789abcdef"
const githubToken = "ghp_0123456789abcdefghijABCDEFGHIJ012345"

let work: string
let store: RepositoryStore
let journal: Journal
let records: Records
let client: GitClient
let push: ReturnType<typeof createPushService>
const servers: ServerType[] = []
let web: string
let gitUrl: string
let workspaceId: string
let firstCommit: string
let owner: Awaited<ReturnType<typeof insertPerson>>
const tokens: Record<"alpha" | "beta", string> = { alpha: "", beta: "" }
const labels: Record<"alpha" | "beta", string> = { alpha: "", beta: "" }
const locks = createPushLocks()
const pushOptions: { limits: Partial<PushLimits> } = { limits: {} }

async function listen(fetch: Parameters<typeof serve>[0]["fetch"]) {
  const server = serve({
    fetch,
    hostname: "127.0.0.1",
    port: 0,
    serverOptions: { maxHeaderSize: 80 * 1024, ...listenerOptions(120) },
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.once("listening", resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "shinan-push-"))
  for (const folder of ["catalog", "hooks", "home"])
    mkdirSync(join(work, folder))
  // The image's own hooks, started by this Node.js.
  for (const name of ["pre-receive", "post-receive"]) {
    const text = readFileSync(join(hooksDirectory, name), "utf8").replace(
      /^#!.*\n/,
      `#!${process.execPath}\n`,
    )
    writeFileSync(join(work, "hooks", name), text)
    chmodSync(join(work, "hooks", name), 0o755)
  }
  const root = join(work, "catalog")
  store = createRepositoryStore({
    root,
    git: createGit({ home: join(work, "home") }),
    hooksDirectory: join(work, "hooks"),
  })
  journal = openJournal(root)
  records = openRecords(root)
  push = createPushService({
    store,
    journal,
    records,
    locks,
    log: () => {},
    get limits() {
      return pushOptions.limits
    },
  })
  push.hookUrl = await listen(push.hookApp.fetch)
  gitUrl = await listen(
    createGitApp({ serviceToken, store, journal, push, log: () => {} }).fetch,
  )
  client = createGitClient({ url: gitUrl, serviceToken })

  owner = await insertPerson(db, "owner")
  await db.insert(schema.emailAllowlist).values({ email: owner.email })
  workspaceId = (
    await createWorkspace(
      { db, actor: { kind: "person", personId: owner.id } },
      { name: "Team" },
    )
  ).workspace.id
  firstCommit = (
    await createCatalogRepository(
      { db, actor: shinan, jobs },
      { workspaceId },
      client,
    )
  ).firstCommit
  for (const machine of ["alpha", "beta"] as const) {
    const issued = await createAgentToken(
      {
        db,
        jobs,
        installationUrl,
        actor: { kind: "person", personId: owner.id, reauthenticated: true },
      },
      { workspaceId, codingTool: "opencode", machine, access: "full" },
    )
    tokens[machine] = issued.token
    labels[machine] = `${owner.handle} via ${issued.agent.handle}`
  }
  web = await listen(
    createApp({
      db,
      signIn: noSignIn,
      jobs,
      installationUrl,
      rateLimit: false,
      gitClient: client,
    }).fetch,
  )
})

// These tests push more than an agent may in 10 minutes; the push rate
// has tests of its own (core access.test.ts).
beforeEach(async () => {
  await db
    .delete(schema.rateLimits)
    .where(sql`${schema.rateLimits.key} like 'catalog-push%'`)
})

afterAll(async () => {
  await Promise.all(
    servers.map(
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

/** A catalog page that validates, with `facts` (fact check groups) if given. */
function page(
  id: string,
  facts = "",
  options: { fields?: string; body?: string } = {},
) {
  return `---
id: ${id}
type: ${id.split("/")[0]}
title: ${id}
summary: A page for tests.
status: active
owner: unknown
${options.fields ?? ""}${facts ? `facts:\n${facts}` : ""}---

${options.body ?? `# ${id}\n`}`
}

/** A fact check group of machine facts, as an agent writes it. */
function group(
  by: string,
  facts: Record<string, string> = { hostname: "x" },
  checked = "2026-11-14T09:00:00Z",
) {
  return `  - checked: ${checked}
    by: ${by}
    scope: Looked
    source: Somewhere
    observed:
${Object.entries(facts)
  .map(([key, value]) => `      ${key}: ${value}\n`)
  .join("")}`
}

/**
 * The `git` client as one agent runs it, with GC-9's credential helper
 * (the token from `~/.config/shinan/token`).
 */
function agentGit(
  agent: "alpha" | "beta",
  args: string[],
  cwd = work,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const home = join(work, `home-${agent}`)
  mkdirSync(join(home, ".config", "shinan"), { recursive: true })
  writeFileSync(join(home, ".config", "shinan", "token"), tokens[agent])
  return new Promise((resolve) => {
    execFile(
      findProgram("git")!,
      [
        "-c",
        `credential.${web}.helper=`,
        "-c",
        `credential.${web}.helper=!f(){ test "$1" = get && printf "username=agent\\npassword=%s\\n" "$(cat ~/.config/shinan/token)"; }; f`,
        "-c",
        `user.name=${agent}`,
        "-c",
        `user.email=${agent}@example.com`,
        ...args,
      ],
      {
        cwd,
        maxBuffer: 64 * 1024 * 1024,
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

let clones = 0
/** A fresh clone of the catalog by `agent`; its folder. */
async function cloneAs(agent: "alpha" | "beta"): Promise<string> {
  const folder = join(work, `clone-${++clones}`)
  const cloned = await agentGit(agent, [
    "clone",
    "--quiet",
    repository(),
    folder,
  ])
  expect(cloned.stderr).toBe("")
  return folder
}

async function run(
  agent: "alpha" | "beta",
  folder: string,
  ...args: string[]
): Promise<string> {
  const result = await agentGit(agent, args, folder)
  if (result.code !== 0)
    throw new Error(`git ${args.join(" ")}: ${result.stderr}`)
  return result.stdout.trim()
}

/** Commits `files` in `folder` on top of HEAD; the new commit. */
async function commit(
  agent: "alpha" | "beta",
  folder: string,
  files: Record<string, string | Buffer>,
  message = "A change",
): Promise<string> {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(folder, path, ".."), { recursive: true })
    writeFileSync(join(folder, path), content)
    await run(agent, folder, "add", "--", path)
  }
  await run(agent, folder, "commit", "--quiet", "--allow-empty", "-m", message)
  return run(agent, folder, "rev-parse", "HEAD")
}

const pushAs = (
  agent: "alpha" | "beta",
  folder: string,
  ...refspecs: string[]
) => agentGit(agent, ["push", "--porcelain", "origin", ...refspecs], folder)

/** The `remote:` lines of a push, without the prefix. */
const remote = (stderr: string) =>
  stderr
    .split("\n")
    .filter((l) => l.startsWith("remote: "))
    .map((l) => l.slice("remote: ".length).trimEnd())

const serverRef = async (ref: string) =>
  (
    await store.git.run(["rev-parse", "--verify", "--quiet", ref], {
      gitDir: store.pathOf(workspaceId),
      okExitCodes: [0, 1],
    })
  ).stdout
    .toString()
    .trim() || null

const hasObject = async (oid: string) =>
  (
    await store.git.run(["cat-file", "-e", oid], {
      gitDir: store.pathOf(workspaceId),
      okExitCodes: [0, 1, 128],
    })
  ).exitCode === 0

/** Waits until `check` holds: the journal is stored after each push, out of band. */
async function eventually<T>(check: () => Promise<T | undefined | false>) {
  const deadline = Date.now() + 15_000
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error("Timed out waiting")
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

/** The newest push in the log after `since` journal entries, once stored. */
async function lastPush(since: number) {
  return eventually(async () => {
    const [row] = await db
      .select()
      .from(schema.catalogPushes)
      .where(
        and(
          eq(schema.catalogPushes.workspaceId, workspaceId),
          eq(schema.catalogPushes.journalId, journal.id),
          sql`${schema.catalogPushes.journalEntry} > ${since}`,
        ),
      )
      .orderBy(sql`${schema.catalogPushes.journalEntry} desc`)
      .limit(1)
    if (!row) return undefined
    // Its confirmation, if any, is stored too once the journal is empty.
    if (journal.read(0, 1).length > 0) return undefined
    return row
  })
}

const refsOf = (pushId: string) =>
  db
    .select()
    .from(schema.catalogPushRefs)
    .where(eq(schema.catalogPushRefs.pushId, pushId))
    .orderBy(schema.catalogPushRefs.position)

const firstPushOf = async (commit: string) =>
  (
    await db
      .select()
      .from(schema.catalogCommitFirstPushes)
      .where(
        and(
          eq(schema.catalogCommitFirstPushes.workspaceId, workspaceId),
          eq(schema.catalogCommitFirstPushes.commit, commit),
        ),
      )
  )[0]

/** When the push log says a commit reached `main`. */
const arrivalOf = async (commit: string) =>
  (
    await db
      .select()
      .from(schema.catalogMainArrivals)
      .where(
        and(
          eq(schema.catalogMainArrivals.workspaceId, workspaceId),
          eq(schema.catalogMainArrivals.commit, commit),
        ),
      )
  )[0]

describe("pushing through web", () => {
  it("accepts a push to a branch, logs it once, and records its commits' first pusher", async () => {
    const since = journal.last()
    const folder = await cloneAs("alpha")
    const made = await commit("alpha", folder, { "notes/a.md": "A note\n" })
    const pushed = await pushAs("alpha", folder, "HEAD:refs/heads/notes")
    expect(pushed.code).toBe(0)
    expect(remote(pushed.stderr)).toEqual([])
    expect(await serverRef("refs/heads/notes")).toBe(made)

    const push = await lastPush(since)
    expect(push).toMatchObject({
      outcome: "accepted",
      codes: [],
      warnings: 0,
      byLabel: labels.alpha,
      newCommits: 1,
    })
    expect(push.receivedObjects).toBeGreaterThanOrEqual(3)
    expect(await refsOf(push.id)).toMatchObject([
      {
        ref: "refs/heads/notes",
        oldCommit: null,
        newCommit: made,
        kind: "create",
        confirmed: true,
      },
    ])
    expect(await firstPushOf(made)).toMatchObject({
      pushId: push.id,
      ref: "refs/heads/notes",
      pusherKind: "agent",
      byLabel: labels.alpha,
    })
    expect(records.firstPush(workspaceId, made)).toMatchObject({
      push: push.id,
      by: labels.alpha,
    })
    // The repository's first commit is Shinan's.
    expect(await firstPushOf(firstCommit)).toMatchObject({
      pusherKind: "shinan",
      pushId: null,
      byLabel: "shinan",
    })
    // Stored once, however often the journal is read.
    await storeCatalogJournal({ db, actor: shinan, jobs }, client)
    expect(
      await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.catalogCommitFirstPushes)
        .where(eq(schema.catalogCommitFirstPushes.commit, made)),
    ).toEqual([{ n: 1 }])
  })

  it("refuses a secret in a file with its place, kind and fingerprint, never its value, and keeps nothing of the push", async () => {
    const since = journal.last()
    const folder = await cloneAs("alpha")
    const made = await commit("alpha", folder, {
      "service/email.md": `# Email\n\nThe token:\n${githubToken}\n`,
    })
    const blob = await run(
      "alpha",
      folder,
      "rev-parse",
      `${made}:service/email.md`,
    )
    const pushed = await pushAs("alpha", folder, "HEAD:refs/heads/leak")
    expect(pushed.code).not.toBe(0)
    const lines = remote(pushed.stderr)
    expect(lines[0]).toBe("Shinan refused this push. Nothing was changed.")
    expect(lines[1]).toBe("1 blocking problem:")
    expect(lines[2]).toMatch(
      /^ {2}service\/email\.md:4 {2}secret {2}a value here looks like a GitHub token \(value not shown; fingerprint sha256:[0-9a-f]{64}\)$/,
    )
    expect(lines.slice(-2)).toEqual([
      "These problems are in commits not yet in Shinan: rewrite them (git rebase -i origin/main), then push again. A new commit on top won't help. The shinan skill explains each code.",
      "If a value is not a secret, a workspace owner can allow its fingerprint in workspace settings (Catalog).",
    ])
    expect(pushed.stderr).not.toContain(githubToken.slice(4))
    expect(await serverRef("refs/heads/leak")).toBeNull()
    // The quarantine was dropped: none of the push's objects are kept.
    expect(await hasObject(made)).toBe(false)
    expect(await hasObject(blob)).toBe(false)
    expect(
      readdirSync(join(store.pathOf(workspaceId), "objects")).filter((n) =>
        n.includes("incoming-"),
      ),
    ).toEqual([])
    const push = await lastPush(since)
    expect(push).toMatchObject({ outcome: "refused", codes: ["secret"] })
    expect(await refsOf(push.id)).toMatchObject([{ confirmed: false }])
    // Nothing is first pushed by a refused push.
    expect(await firstPushOf(made)).toBeUndefined()
    expect(records.firstPush(workspaceId, made)).toBeUndefined()
    const [leak] = await db
      .select()
      .from(schema.securityLog)
      .where(
        and(
          eq(schema.securityLog.action, "catalog.push-refused"),
          sql`${schema.securityLog.details}->>'push' = ${push.id}`,
        ),
      )
    expect(leak).toMatchObject({
      workspaceId,
      outcome: "refused",
      actorKind: "agent",
      details: { codes: ["secret"], secrets: 1 },
    })
    expect(JSON.stringify(leak)).not.toContain(githubToken.slice(4))
  })

  it("refuses secrets in commit messages and branch names", async () => {
    const folder = await cloneAs("alpha")
    await commit("alpha", folder, {}, `Rotate\n\nold one: ${githubToken}\n`)
    const message = await pushAs("alpha", folder, "HEAD:refs/heads/rotate")
    expect(remote(message.stderr).join("\n")).toMatch(
      /commit [0-9a-f]{12}:3 +secret +the commit message looks like a GitHub token/,
    )
    await run("alpha", folder, "reset", "--quiet", "--hard", "HEAD~1")
    await commit("alpha", folder, { "x.md": "x\n" })
    const branch = await pushAs(
      "alpha",
      folder,
      `HEAD:refs/heads/${githubToken}`,
    )
    expect(branch.code).not.toBe(0)
    expect(remote(branch.stderr).join("\n")).toMatch(
      /ref \(name not shown\) +secret +the ref's name looks like a GitHub token/,
    )
    // The name is kept nowhere: not in the push log.
    await eventually(() => Promise.resolve(journal.read(0, 1).length === 0))
    const stored = await db
      .select({ ref: schema.catalogPushRefs.ref })
      .from(schema.catalogPushRefs)
    expect(JSON.stringify(stored)).not.toContain(githubToken.slice(4))
    expect(stored).toContainEqual({
      ref: "refs/heads/(withheld: the name held a secret)",
    })
  })

  it("lets an allowed value through, and refuses the same value with one character changed", async () => {
    const value = "ghp_AllowedValue0123456789abcdefghijABCDE"
    await allowCatalogValue(
      {
        db,
        actor: { kind: "person", personId: owner.id, reauthenticated: true },
      },
      { workspaceId, value },
    )
    const folder = await cloneAs("alpha")
    await commit("alpha", folder, { "doc/allowed.md": `Example: ${value}\n` })
    const allowed = await pushAs("alpha", folder, "HEAD:refs/heads/allowed")
    expect(remote(allowed.stderr)).toEqual([])
    expect(allowed.code).toBe(0)
    const changed = `${value.slice(0, -1)}F`
    await commit("alpha", folder, { "doc/changed.md": `Example: ${changed}\n` })
    const refused = await pushAs("alpha", folder, "HEAD:refs/heads/allowed")
    expect(refused.code).not.toBe(0)
    expect(remote(refused.stderr).join("\n")).toContain(
      "doc/changed.md:1  secret",
    )
  })

  it("prints warnings, which do not block", async () => {
    const folder = await cloneAs("alpha")
    const made = await commit("alpha", folder, {
      "doc/warn.md": "line\nDB_PASSWORD=Sup3rS3cretPass\n",
    })
    const pushed = await pushAs("alpha", folder, "HEAD:refs/heads/warn")
    expect(pushed.code).toBe(0)
    const lines = remote(pushed.stderr)
    expect(lines[0]).toBe("Shinan accepted this push.")
    expect(lines[1]).toBe("1 warning (does not block):")
    expect(lines[2]).toMatch(/^ {2}doc\/warn\.md:2 {2}secret-suspected {2}/)
    expect(pushed.stderr).not.toContain("Sup3rS3cretPass")
    expect(await serverRef("refs/heads/warn")).toBe(made)
  })

  it.each([
    ["a symbolic link", "symlink"],
    ["a submodule", "submodule"],
  ])("refuses %s on any branch", async (_, code) => {
    const folder = await cloneAs("alpha")
    const target = await run("alpha", folder, "hash-object", "-w", "README.md")
    await run(
      "alpha",
      folder,
      "update-index",
      "--add",
      "--cacheinfo",
      code === "symlink"
        ? `120000,${target},token-link`
        : `160000,${firstCommit},vendor/lib`,
    )
    await run("alpha", folder, "commit", "--quiet", "-m", code)
    const pushed = await pushAs("alpha", folder, `HEAD:refs/heads/${code}`)
    expect(pushed.code).not.toBe(0)
    expect(remote(pushed.stderr).join("\n")).toMatch(
      new RegExp(
        `${code === "symlink" ? "token-link" : "vendor/lib"} +${code} +`,
      ),
    )
  })

  it("refuses a new file over 1 MiB and a commit over 64 KiB", async () => {
    const folder = await cloneAs("alpha")
    await commit("alpha", folder, {
      "big.md": Buffer.alloc(1024 * 1024 + 1, "a"),
    })
    const file = await pushAs("alpha", folder, "HEAD:refs/heads/big")
    expect(remote(file.stderr).join("\n")).toMatch(
      /big\.md +file-too-large +a new file is at most 1 MiB; this one is 1,048,577 bytes/,
    )
    await run("alpha", folder, "reset", "--quiet", "--hard", "HEAD~1")
    await commit("alpha", folder, {}, `Long\n\n${"x".repeat(65 * 1024)}\n`)
    const message = await pushAs("alpha", folder, "HEAD:refs/heads/long")
    expect(remote(message.stderr).join("\n")).toMatch(
      /commit [0-9a-f]{12} +commit-too-large +a commit, with its message, is at most 64 KiB/,
    )
  })

  it("refuses names Windows or macOS cannot check out", async () => {
    const folder = await cloneAs("alpha")
    await commit("alpha", folder, {
      "dir/A.md": "a\n",
      "dir/a.md": "b\n",
      "con.md": "c\n",
      "trailing.md.": "d\n",
    })
    const pushed = await pushAs("alpha", folder, "HEAD:refs/heads/hostile")
    const text = remote(pushed.stderr).join("\n")
    expect(pushed.code).not.toBe(0)
    expect(text).toMatch(
      /dir\/a\.md +path-not-portable +Windows and macOS see this name and A\.md as one/,
    )
    expect(text).toMatch(
      /con\.md +path-not-portable +this name is a name Windows reserves/,
    )
    expect(text).toMatch(
      /trailing\.md\. +path-not-portable +this name ends with a dot or a space/,
    )
  })

  it("refuses a folder by its size before reading it, when it cannot be within the limit", async () => {
    const folder = await cloneAs("alpha")
    // Four names of 250 bytes: more than three entries' worth of bytes.
    const files = Object.fromEntries(
      ["a", "b", "c", "d"].map((c) => [`${c.repeat(250)}.md`, "x\n"]),
    )
    await commit("alpha", folder, files)
    pushOptions.limits = { folderEntries: 3 }
    try {
      const pushed = await pushAs("alpha", folder, "HEAD:refs/heads/long-names")
      expect(remote(pushed.stderr).join("\n")).toMatch(
        /tree-too-large +the top folder has over 3 entries: split it into folders/,
      )
    } finally {
      pushOptions.limits = {}
    }
  })

  it("refuses a secret in a file or folder name, and never shows the name", async () => {
    const folder = await cloneAs("alpha")
    await commit("alpha", folder, {
      [`d/${githubToken}.md`]: "x\n",
      [`${githubToken}/x.md`]: "y\n",
    })
    const pushed = await pushAs("alpha", folder, "HEAD:refs/heads/secret-path")
    expect(pushed.code).not.toBe(0)
    const lines = remote(pushed.stderr)
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^ {2}\(name not shown\) +secret +a file or folder name looks like a GitHub token \(value not shown; fingerprint sha256:[0-9a-f]{64}\)$/,
        ),
        expect.stringMatching(
          /^ {2}d\/\(name not shown\) +secret +a file or folder name looks like a GitHub token/,
        ),
      ]),
    )
    expect(pushed.stderr).not.toContain(githubToken.slice(4))
    expect(await serverRef("refs/heads/secret-path")).toBeNull()
  })

  it("refuses a folder past 20,000 entries, and a tree that reaches more than 200,000", async () => {
    const folder = await cloneAs("alpha")
    const blob = await run("alpha", folder, "hash-object", "-w", "README.md")
    const mktree = (lines: string[]) =>
      new Promise<string>((resolve, reject) => {
        execFile(
          findProgram("git")!,
          ["mktree", "--missing"],
          { cwd: folder, maxBuffer: 64 * 1024 * 1024 },
          (error, stdout) =>
            error ? reject(new Error(error.message)) : resolve(stdout.trim()),
        ).stdin!.end(`${lines.join("\n")}\n`)
      })
    const wide = await mktree(
      Array.from({ length: 20_001 }, (_, i) => `100644 blob ${blob}\tf${i}.md`),
    )
    const wideCommit = await run(
      "alpha",
      folder,
      "commit-tree",
      "-p",
      "HEAD",
      "-m",
      "Wide",
      wide,
    )
    const tooWide = await pushAs(
      "alpha",
      folder,
      `${wideCommit}:refs/heads/wide`,
    )
    expect(remote(tooWide.stderr).join("\n")).toMatch(
      /tree-too-large +the top folder has over 20,000 entries: split it into folders/,
    )
    // 250 folders of 1,000 folders of one file: a few KB, half a million
    // entries to walk.
    const leaf = await mktree([`100644 blob ${blob}\tx.md`])
    const middle = await mktree(
      Array.from({ length: 1000 }, (_, i) => `040000 tree ${leaf}\tm${i}`),
    )
    const top = await mktree(
      Array.from({ length: 250 }, (_, i) => `040000 tree ${middle}\tt${i}`),
    )
    const repeated = await run(
      "alpha",
      folder,
      "commit-tree",
      "-p",
      "HEAD",
      "-m",
      "Repeated",
      top,
    )
    const tooMany = await pushAs(
      "alpha",
      folder,
      `${repeated}:refs/heads/repeated`,
    )
    expect(remote(tooMany.stderr).join("\n")).toMatch(
      /commit [0-9a-f]{12} +tree-too-large +over 200,000 files and folders, counting repeats: no catalog needs that many/,
    )
  })

  it("refuses more than 1,000 new commits", async () => {
    const folder = await cloneAs("alpha")
    let head = await run("alpha", folder, "rev-parse", "HEAD")
    const tree = await run("alpha", folder, "rev-parse", "HEAD^{tree}")
    for (let i = 0; i < 1001; i++) {
      head = await new Promise<string>((resolve, reject) =>
        execFile(
          findProgram("git")!,
          ["commit-tree", "-p", head, "-m", `c${i}`, tree],
          {
            cwd: folder,
            env: {
              PATH: process.env.PATH,
              GIT_AUTHOR_NAME: "a",
              GIT_AUTHOR_EMAIL: "a@example.com",
              GIT_COMMITTER_NAME: "a",
              GIT_COMMITTER_EMAIL: "a@example.com",
            },
          },
          (error, stdout) =>
            error ? reject(new Error(error.message)) : resolve(stdout.trim()),
        ),
      )
    }
    const pushed = await pushAs("alpha", folder, `${head}:refs/heads/many`)
    expect(remote(pushed.stderr).join("\n")).toContain(
      "too-many-commits  more than 1,000 new commits: push in parts",
    )
  }, 120_000)

  it("refuses refs that are not branches, and branch names past the rules", async () => {
    const folder = await cloneAs("alpha")
    await commit("alpha", folder, { "t.md": "t\n" })
    const tag = await pushAs("alpha", folder, "HEAD:refs/tags/v1")
    expect(remote(tag.stderr).join("\n")).toMatch(
      /ref refs\/tags\/v1 +ref-not-branch +/,
    )
    const long = await pushAs(
      "alpha",
      folder,
      `HEAD:refs/heads/${"x".repeat(101)}`,
    )
    expect(remote(long.stderr).join("\n")).toMatch(
      /ref-name-invalid +a branch name is at most 100/,
    )
    const odd = await pushAs("alpha", folder, "HEAD:refs/heads/a+b")
    expect(remote(odd.stderr).join("\n")).toMatch(
      /ref refs\/heads\/a\+b +ref-name-invalid/,
    )
  })

  it("keeps main from being deleted or forced, and refuses past 100 branches", async () => {
    const folder = await cloneAs("alpha")
    const deleted = await pushAs("alpha", folder, ":refs/heads/main")
    expect(remote(deleted.stderr).join("\n")).toMatch(
      /ref refs\/heads\/main +main-not-fast-forward +main cannot be deleted/,
    )
    await run("alpha", folder, "checkout", "--quiet", "--orphan", "other")
    await commit("alpha", folder, { "o.md": "o\n" })
    const forced = await pushAs("alpha", folder, "+HEAD:refs/heads/main")
    expect(remote(forced.stderr).join("\n")).toMatch(
      /main-not-fast-forward +main only moves forward/,
    )
    const branches = Array.from(
      { length: 101 },
      (_, i) => `HEAD:refs/heads/b${i}`,
    )
    const many = await pushAs("alpha", folder, ...branches)
    expect(remote(many.stderr).join("\n")).toMatch(
      /too-many-branches +over 100 branches: delete merged ones \(git push origin --delete <branch>\)/,
    )
  })

  it("refuses a commit a purge removed", async () => {
    const folder = await cloneAs("alpha")
    const made = await commit("alpha", folder, { "p.md": "p\n" })
    const recordFolder = join(work, "catalog", "records", workspaceId)
    mkdirSync(recordFolder, { recursive: true })
    writeFileSync(join(recordFolder, "purged-commits"), `${made}\n`)
    try {
      const pushed = await pushAs("alpha", folder, "HEAD:refs/heads/purged")
      expect(remote(pushed.stderr).join("\n")).toContain(
        `commit ${made.slice(0, 12)}  purged-commit  this commit was removed by a purge`,
      )
    } finally {
      rmSync(join(recordFolder, "purged-commits"))
    }
  })

  it("refuses push options other than check-only, and a check-only push changes nothing", async () => {
    const folder = await cloneAs("alpha")
    const made = await commit("alpha", folder, { "c.md": "c\n" })
    const unknown = await agentGit(
      "alpha",
      ["push", "-o", "force", "origin", "HEAD:refs/heads/opt"],
      folder,
    )
    expect(remote(unknown.stderr).join("\n")).toContain("push-option-unknown")
    const since = journal.last()
    const checked = await agentGit(
      "alpha",
      ["push", "-o", "check-only", "origin", "HEAD:refs/heads/opt"],
      folder,
    )
    expect(checked.code).not.toBe(0)
    expect(remote(checked.stderr)).toEqual([
      "Shinan checked this push (check only): no blocking problems. Nothing was changed.",
    ])
    expect(await serverRef("refs/heads/opt")).toBeNull()
    expect(await lastPush(since)).toMatchObject({
      outcome: "check-only",
      codes: ["check-only"],
    })
    expect(await firstPushOf(made)).toBeUndefined()
  })

  it("refuses a push while the repository's last push is being checked, past the wait", async () => {
    const folder = await cloneAs("alpha")
    await commit("alpha", folder, { "b.md": "b\n" })
    const release = (await locks.acquire(workspaceId, 0))!
    pushOptions.limits = { lockWaitSeconds: 1 }
    try {
      const pushed = await pushAs("alpha", folder, "HEAD:refs/heads/busy")
      expect(remote(pushed.stderr).join("\n")).toContain(
        "busy  another push to this repository is being checked: push again in 30 seconds",
      )
    } finally {
      release()
      pushOptions.limits = {}
    }
  })

  it("refuses a push its checks take too long for, and one into a full repository unless it only deletes", async () => {
    const folder = await cloneAs("alpha")
    await commit("alpha", folder, { "s.md": "s\n" })
    pushOptions.limits = { checkSeconds: 0 }
    try {
      const slow = await pushAs("alpha", folder, "HEAD:refs/heads/slow")
      expect(remote(slow.stderr).join("\n")).toContain("too-slow")
    } finally {
      pushOptions.limits = {}
    }
    expect(
      (await pushAs("alpha", folder, "HEAD:refs/heads/to-delete")).code,
    ).toBe(0)
    pushOptions.limits = { repositoryBytes: 1 }
    try {
      const full = await pushAs("alpha", folder, "HEAD:refs/heads/full")
      expect(remote(full.stderr).join("\n")).toContain("repository-full")
      const deleted = await pushAs("alpha", folder, ":refs/heads/to-delete")
      expect(deleted.code).toBe(0)
    } finally {
      pushOptions.limits = {}
    }
  })
})

describe("branches, main and the push log", () => {
  it("allows merge commits, forced branches and deleting a branch", async () => {
    const folder = await cloneAs("alpha")
    await run("alpha", folder, "checkout", "--quiet", "-b", "side")
    await commit("alpha", folder, { "side.md": "side\n" })
    await run("alpha", folder, "checkout", "--quiet", "main")
    await commit("alpha", folder, { "main-side.md": "main\n" })
    await run("alpha", folder, "merge", "--quiet", "--no-edit", "side")
    const merged = await pushAs("alpha", folder, "HEAD:refs/heads/merged")
    expect(merged.code).toBe(0)
    await run("alpha", folder, "reset", "--quiet", "--hard", "HEAD~1")
    const forced = await pushAs("alpha", folder, "+HEAD:refs/heads/merged")
    expect(forced.code).toBe(0)
    const since = journal.last()
    const deleted = await pushAs("alpha", folder, ":refs/heads/merged")
    expect(deleted.code).toBe(0)
    expect(await serverRef("refs/heads/merged")).toBeNull()
    const push = await lastPush(since)
    expect(await refsOf(push.id)).toMatchObject([
      { kind: "delete", newCommit: null, confirmed: true },
    ])
  })

  it("updates main by fast-forward, as a catalog.pushed event that moves the index", async () => {
    const since = journal.last()
    const folder = await cloneAs("alpha")
    const before = await run("alpha", folder, "rev-parse", "HEAD")
    const made = await commit("alpha", folder, {
      "machine/musashi.md": page("machine/musashi"),
    })
    const pushed = await pushAs("alpha", folder, "HEAD:refs/heads/main")
    expect(pushed.code).toBe(0)
    const push = await lastPush(since)
    const [event] = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.idempotencyKey, `catalog.pushed:${push.id}`))
    expect(event).toMatchObject({
      workspaceId,
      kind: "catalog.pushed",
      origin: "git_push",
      actorKind: "agent",
      actorLabel: labels.alpha,
      data: {
        from: before,
        to: made,
        commits: 1,
        documents: ["machine/musashi"],
      },
    })
    const [state] = await db
      .select()
      .from(schema.catalogIndexState)
      .where(eq(schema.catalogIndexState.workspaceId, workspaceId))
    expect(state!.mainCommit).toBe(made)
  })

  it("keeps a commit's first pusher when another agent merges its branch into main", async () => {
    const a = await cloneAs("alpha")
    await run("alpha", a, "checkout", "--quiet", "-b", "feature")
    const theirs = await commit("alpha", a, {
      "machine/feature.md": page("machine/feature"),
    })
    expect((await pushAs("alpha", a, "HEAD:refs/heads/feature")).code).toBe(0)
    const b = await cloneAs("beta")
    await run("beta", b, "fetch", "--quiet", "origin")
    await run(
      "beta",
      b,
      "merge",
      "--quiet",
      "--no-edit",
      "--no-ff",
      "origin/feature",
    )
    const merge = await run("beta", b, "rev-parse", "HEAD")
    expect((await pushAs("beta", b, "HEAD:refs/heads/main")).code).toBe(0)
    await eventually(async () => (await firstPushOf(merge)) !== undefined)
    expect(await firstPushOf(theirs)).toMatchObject({
      byLabel: labels.alpha,
      ref: "refs/heads/feature",
    })
    expect(await firstPushOf(merge)).toMatchObject({
      byLabel: labels.beta,
      ref: "refs/heads/main",
    })
    // The branch's commit reached main with the merge, not when it was
    // pushed on its branch (GC-7).
    const merged = await arrivalOf(merge)
    expect(merged).toBeDefined()
    expect(await arrivalOf(theirs)).toEqual(
      merged && { ...merged, commit: theirs },
    )
    expect(merged!.reachedMainAt.getTime()).toBeGreaterThan(
      (await firstPushOf(theirs))!.firstPushedAt.getTime(),
    )
  })

  it("names one push and its first ref for a commit that arrives on two branches", async () => {
    const since = journal.last()
    const folder = await cloneAs("beta")
    const made = await commit("beta", folder, { "two.md": "two\n" })
    const pushed = await pushAs(
      "beta",
      folder,
      "HEAD:refs/heads/two-b",
      "HEAD:refs/heads/two-a",
    )
    expect(pushed.code).toBe(0)
    const push = await lastPush(since)
    const refs = await refsOf(push.id)
    expect(await firstPushOf(made)).toMatchObject({
      pushId: push.id,
      ref: refs[0]!.ref,
    })
  })

  it("keeps the first pusher of a commit deleted with its branch and pushed again by another agent", async () => {
    const a = await cloneAs("alpha")
    const made = await commit("alpha", a, { "again.md": "again\n" })
    expect((await pushAs("alpha", a, "HEAD:refs/heads/again")).code).toBe(0)
    expect((await pushAs("alpha", a, ":refs/heads/again")).code).toBe(0)
    const b = await cloneAs("beta")
    await run("beta", b, "fetch", "--quiet", a, made)
    expect((await pushAs("beta", b, `${made}:refs/heads/again-b`)).code).toBe(0)
    await eventually(() => Promise.resolve(journal.read(0, 1).length === 0))
    expect(await firstPushOf(made)).toMatchObject({ byLabel: labels.alpha })
  })

  it("serializes pushes to main: the second, checked against an old main, fails to update it and records nothing", async () => {
    const a = await cloneAs("alpha")
    const b = await cloneAs("beta")
    const ours = await commit("alpha", a, {
      "machine/race-a.md": page("machine/race-a"),
    })
    const theirs = await commit("beta", b, {
      "machine/race-b.md": page("machine/race-b"),
    })
    // Both start while a push holds the lock, so both are checked against
    // the same main, one after the other.
    const release = (await locks.acquire(workspaceId, 0))!
    const since = journal.last()
    const results = Promise.all([
      pushAs("alpha", a, "HEAD:refs/heads/main"),
      pushAs("beta", b, "HEAD:refs/heads/main"),
    ])
    await new Promise((resolve) => setTimeout(resolve, 1500))
    release()
    const [first, second] = await results
    const won = first.code === 0 ? ours : theirs
    const lost = first.code === 0 ? theirs : ours
    expect([first.code === 0, second.code === 0].sort()).toEqual([false, true])
    expect(await serverRef("refs/heads/main")).toBe(won)
    await eventually(() => Promise.resolve(journal.read(0, 1).length === 0))
    const pushes = await db
      .select()
      .from(schema.catalogPushes)
      .where(
        and(
          eq(schema.catalogPushes.journalId, journal.id),
          sql`${schema.catalogPushes.journalEntry} > ${since}`,
        ),
      )
    expect(pushes).toHaveLength(2)
    const confirmed = await Promise.all(
      pushes.map(async (p) => (await refsOf(p.id))[0]!.confirmed),
    )
    expect(confirmed.sort()).toEqual([false, true])
    expect(await firstPushOf(won)).toBeDefined()
    expect(await firstPushOf(lost)).toBeUndefined()
    expect(records.firstPush(workspaceId, lost)).toBeUndefined()
  })

  it("stores a push web did not see, once, and reports a branch update the log does not explain", async () => {
    // A push straight to the Git container, as if web lost the connection
    // before storing the journal.
    const folder = await cloneAs("alpha")
    const made = await commit("alpha", folder, { "direct.md": "d\n" })
    const context = Buffer.from(
      JSON.stringify({
        requestId: "7b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d",
        workspaceId,
        agent: {
          id: "1b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d",
          handle: "opencode-direct",
        },
        memberId: "2b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d",
        person: { id: owner.id, handle: owner.handle },
        by: `${owner.handle} via opencode-direct`,
        mayPush: true,
        memberHandles: [owner.handle],
        allowedValues: [],
      }),
    ).toString("base64url")
    const direct = await agentGit(
      "alpha",
      [
        "-c",
        `http.extraHeader=Authorization: Bearer ${serviceToken}`,
        "-c",
        `http.extraHeader=Shinan-Git-Context: ${context}`,
        "push",
        `${gitUrl}/git/${workspaceId}.git`,
        "HEAD:refs/heads/direct",
      ],
      folder,
    )
    expect(direct.code).toBe(0)
    expect(journal.read(0, 1).length).toBeGreaterThan(0)
    const ctx = { db, actor: shinan, jobs }
    expect((await storeCatalogJournal(ctx, client)).stored).toBeGreaterThan(0)
    expect((await storeCatalogJournal(ctx, client)).stored).toBe(0)
    expect(await firstPushOf(made)).toMatchObject({
      byLabel: `${owner.handle} via opencode-direct`,
    })
    // The log explains every branch now.
    expect((await checkCatalogRefs(ctx, client)).unlogged).toBe(0)
    // A ref moved behind the push log's back is reported, once.
    await store.git.run(["update-ref", "refs/heads/sneaky", firstCommit], {
      gitDir: store.pathOf(workspaceId),
    })
    expect((await checkCatalogRefs(ctx, client)).unlogged).toBe(1)
    expect((await checkCatalogRefs(ctx, client)).unlogged).toBe(0)
    const [entry] = await db
      .select()
      .from(schema.securityLog)
      .where(eq(schema.securityLog.action, "catalog.unlogged-update"))
    expect(entry).toMatchObject({
      workspaceId,
      actorKind: "shinan",
      details: {
        ref: `sha256:${createHash("sha256").update("refs/heads/sneaky").digest("hex")}`,
        commit: firstCommit,
        logged: null,
      },
    })
    await store.git.run(["update-ref", "-d", "refs/heads/sneaky"], {
      gitDir: store.pathOf(workspaceId),
    })
  })
})

describe("the hooks' listener", () => {
  it("refuses a hook without the nonce of a push being checked, and a nonce used twice", async () => {
    const ask = (path: string, nonce: string) =>
      push.hookApp.request(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "shinan-push-nonce": nonce,
        },
        body: JSON.stringify({ updates: "" }),
      })
    for (const nonce of ["", "a".repeat(64)]) {
      const response = await ask("/pre-receive", nonce)
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({
        exitCode: 1,
        lines: [
          "Shinan: this push could not be checked. Nothing was changed. Try again; tell your person if it happens again.",
        ],
      })
    }
    const session = push.begin({
      requestId: "8b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d",
      workspaceId,
      agent: {
        id: "1b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d",
        handle: "opencode-x",
      },
      memberId: "2b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d",
      person: { id: owner.id, handle: owner.handle },
      by: `${owner.handle} via opencode-x`,
      mayPush: true,
      memberHandles: [],
      allowedValues: [],
    })
    expect((await ask("/post-receive", session.nonce)).status).toBe(403)
    expect((await ask("/pre-receive", session.nonce)).status).toBe(200)
    expect((await ask("/pre-receive", session.nonce)).status).toBe(403)
    await session.end()
    expect((await ask("/pre-receive", session.nonce)).status).toBe(403)
  })
})

/** A fresh clone by `agent`, with `files` committed on top of main. */
async function change(
  agent: "alpha" | "beta",
  files: Record<string, string | Buffer>,
  message = "A change",
) {
  const folder = await cloneAs(agent)
  const made = await commit(agent, folder, files, message)
  return { folder, made }
}

const refused = (pushed: { code: number; stderr: string }) => {
  expect(pushed.code).not.toBe(0)
  return remote(pushed.stderr).join("\n")
}

describe("the checks of main", () => {
  it("refuse paths outside the layout, a path that is not the id, and an id that disappears", async () => {
    const { folder } = await change("alpha", {
      "machine/Upper.md": page("machine/upper"),
      "machine/\u202eevil.md": page("machine/evil"),
      "notes.txt": "free text\n",
      "machine/deep/x.md": page("machine/x"),
      "machine/elsewhere.md": page("machine/somewhere-else"),
    })
    const text = refused(await pushAs("alpha", folder, "HEAD:refs/heads/main"))
    expect(text).toMatch(
      /machine\/Upper\.md +path-not-allowed +not a page path/,
    )
    // The right-to-left override is shown as what it is, never applied.
    expect(text).toMatch(/"machine\/\\u202eevil\.md" +path-not-allowed/)
    expect(text).not.toContain("\u202e")
    expect(text).toMatch(/notes\.txt +path-not-allowed/)
    expect(text).toMatch(/machine\/deep\/x\.md +path-not-allowed/)
    expect(text).toMatch(
      /machine\/elsewhere\.md +path-id-mismatch +its id is "machine\/somewhere-else": move the file to machine\/somewhere-else\.md, or fix its id/,
    )
    // A document on main, then deleted: its id no longer resolves.
    const kept = await change("alpha", {
      "machine/kept.md": page("machine/kept"),
    })
    expect(
      (await pushAs("alpha", kept.folder, "HEAD:refs/heads/main")).code,
    ).toBe(0)
    await run("alpha", kept.folder, "rm", "--quiet", "machine/kept.md")
    await run("alpha", kept.folder, "commit", "--quiet", "-m", "Delete")
    expect(
      refused(await pushAs("alpha", kept.folder, "HEAD:refs/heads/main")),
    ).toMatch(
      /machine\/kept\.md +id-disappeared +"machine\/kept" no longer resolves: retire the document, or keep the old id in aliases/,
    )
  })

  it("never show a secret-looking path or id, which check 3 reports without its value", async () => {
    const { folder } = await change("alpha", {
      [`machine/${githubToken}.md`]: page("machine/x"),
      "machine/quoted.md": page(`machine/${githubToken.toLowerCase()}`),
    })
    const pushed = await pushAs("alpha", folder, "HEAD:refs/heads/main")
    const text = refused(pushed)
    expect(text).toMatch(/\(name not shown\) +secret +a file or folder name/)
    expect(text).toMatch(/\(path not shown\) +path-not-allowed/)
    expect(pushed.stderr).not.toContain(githubToken.slice(4))
    expect(pushed.stderr.toLowerCase()).not.toContain(
      githubToken.slice(4).toLowerCase(),
    )
  })

  it("name the file of a document with no id: a start-here.md without one, a frontmatter that does not parse", async () => {
    const { folder } = await change("alpha", {
      "start-here.md": "---\ntitle: Start here\n---\n",
      "machine/broken.md": "---\nid: [machine/broken\n---\n\n# Broken\n",
    })
    const pushed = await pushAs("alpha", folder, "HEAD:refs/heads/main")
    const rows = remote(pushed.stderr).filter((l) => /^ {2}\S/.test(l))
    expect(pushed.code).not.toBe(0)
    expect(
      rows.some((l) => /^ {2}start-here\.md(:\d+)? +field-missing /.test(l)),
    ).toBe(true)
    expect(
      rows.some((l) =>
        /^ {2}machine\/broken\.md(:\d+)? +frontmatter-invalid /.test(l),
      ),
    ).toBe(true)
    // Every row has a place.
    expect(
      rows.filter((l) => /^ {2}[a-z-]+ {2}/.test(l) && !l.includes(".md")),
    ).toEqual([])
  })

  it("refuse an executable document", async () => {
    const folder = await cloneAs("alpha")
    writeFileSync(join(folder, "machine-exec.md"), "x")
    mkdirSync(join(folder, "machine"), { recursive: true })
    writeFileSync(join(folder, "machine/exec.md"), page("machine/exec"))
    chmodSync(join(folder, "machine/exec.md"), 0o755)
    await run("alpha", folder, "add", "machine/exec.md")
    await run("alpha", folder, "commit", "--quiet", "-m", "Exec")
    expect(
      refused(await pushAs("alpha", folder, "HEAD:refs/heads/main")),
    ).toMatch(
      /machine\/exec\.md +path-not-allowed +an executable file: clear its executable bit \(git update-index --chmod=-x\)/,
    )
  })

  it("validate the new catalog: blocking problems refuse, warnings pass", async () => {
    const { folder } = await change("alpha", {
      "machine/broken.md": page("machine/broken", "", {
        fields: "replaced-by: machine/nowhere\n",
      }).replace("owner: unknown", "owner: person/nobody"),
    })
    expect(
      refused(await pushAs("alpha", folder, "HEAD:refs/heads/main")),
    ).toMatch(/machine\/broken\.md:\d+ +reference-unresolved +/)
    const warned = await change("alpha", {
      "machine/warned.md": page(
        "machine/warned",
        group(labels.alpha, { "not-a-key": "x" }),
      ),
    })
    const pushed = await pushAs("alpha", warned.folder, "HEAD:refs/heads/main")
    expect(pushed.code).toBe(0)
    expect(remote(pushed.stderr).join("\n")).toMatch(
      /machine\/warned\.md:\d+ +key-not-in-schema +/,
    )
  })

  it("refuse past the catalog's limits and the commits one push adds to main", async () => {
    const { folder } = await change("alpha", {
      "machine/one-more.md": page("machine/one-more"),
    })
    pushOptions.limits = { mainDocuments: 1 }
    try {
      expect(
        refused(await pushAs("alpha", folder, "HEAD:refs/heads/main")),
      ).toContain("catalog-too-large")
    } finally {
      pushOptions.limits = {}
    }
    for (let i = 0; i < 3; i++)
      await commit("alpha", folder, {
        [`machine/many-${i}.md`]: page(`machine/many-${i}`),
      })
    pushOptions.limits = { mainCommits: 3 }
    try {
      expect(
        refused(await pushAs("alpha", folder, "HEAD:refs/heads/main")),
      ).toContain(
        "main-too-many-commits  this push adds more than 3 commits to main: merge in parts",
      )
    } finally {
      pushOptions.limits = {}
    }
  })

  it("run on a check-only push to main, which changes nothing", async () => {
    const { folder } = await change("alpha", {
      "machine/checked-only.md": page("machine/checked-only").replace(
        "owner: unknown",
        "owner: person/nobody",
      ),
    })
    const checked = await agentGit(
      "alpha",
      ["push", "-o", "check-only", "origin", "HEAD:refs/heads/main"],
      folder,
    )
    expect(refused(checked)).toMatch(/reference-unresolved/)
    expect(await serverRef("refs/heads/main")).not.toBe(
      await run("alpha", folder, "rev-parse", "HEAD"),
    )
  })
})

describe("the by rule (D-066)", () => {
  /** A new page by `agent` with one fact check group naming `by`, pushed to a branch or main. */
  async function pageBy(
    agent: "alpha" | "beta",
    id: string,
    by: string,
    ref = "refs/heads/main",
  ) {
    const folder = await cloneAs(agent)
    const made = await commit(agent, folder, {
      [`${id}.md`]: page(id, group(by)),
    })
    return { folder, made, pushed: await pushAs(agent, folder, `HEAD:${ref}`) }
  }

  it("passes a new fact check naming the agent that first pushes it", async () => {
    const { pushed } = await pageBy("alpha", "machine/by-own", labels.alpha)
    expect(remote(pushed.stderr)).toEqual([])
    expect(pushed.code).toBe(0)
  })

  it("refuses one naming another agent, the person alone or another member, with file, line, commit, found and expected", async () => {
    for (const by of [
      labels.beta,
      owner.handle,
      "someone-else via opencode-gamma",
    ]) {
      const { made, pushed } = await pageBy("alpha", "machine/by-other", by)
      expect(pushed.code).not.toBe(0)
      expect(remote(pushed.stderr)).toContain(
        `  machine/by-other.md:9  by-not-first-pusher  "by: ${by}" but commit ${made.slice(0, 7)} was first pushed by "${labels.alpha}"`,
      )
    }
  })

  it("passes another agent merging an already-pushed branch, by fast-forward and by a merge commit", async () => {
    const a = await pageBy(
      "alpha",
      "machine/by-ff",
      labels.alpha,
      "refs/heads/ff",
    )
    expect(a.pushed.code).toBe(0)
    const b = await cloneAs("beta")
    await run("beta", b, "fetch", "--quiet", "origin")
    const forward = await pushAs("beta", b, "origin/ff:refs/heads/main")
    expect(remote(forward.stderr)).toEqual([])
    expect(forward.code).toBe(0)

    const a2 = await pageBy(
      "alpha",
      "machine/by-merge",
      labels.alpha,
      "refs/heads/m",
    )
    expect(a2.pushed.code).toBe(0)
    const b2 = await cloneAs("beta")
    await commit("beta", b2, {
      "machine/beta-own.md": page("machine/beta-own", group(labels.beta)),
    })
    await run("beta", b2, "fetch", "--quiet", "origin")
    await run(
      "beta",
      b2,
      "merge",
      "--quiet",
      "--no-ff",
      "--no-edit",
      "origin/m",
    )
    const merged = await pushAs("beta", b2, "HEAD:refs/heads/main")
    expect(remote(merged.stderr)).toEqual([])
    expect(merged.code).toBe(0)
  })

  it("refuses another agent rebasing, cherry-picking or squashing those commits", async () => {
    const a = await pageBy(
      "alpha",
      "machine/by-picked",
      labels.alpha,
      "refs/heads/picked",
    )
    expect(a.pushed.code).toBe(0)
    for (const how of ["cherry-pick", "squash", "rebase"] as const) {
      const b = await cloneAs("beta")
      await run("beta", b, "fetch", "--quiet", "origin")
      if (how === "cherry-pick")
        await run("beta", b, "cherry-pick", "origin/picked")
      else if (how === "squash") {
        await run("beta", b, "merge", "--quiet", "--squash", "origin/picked")
        await run("beta", b, "commit", "--quiet", "-m", "Squashed")
      } else {
        await commit("beta", b, {
          "machine/rebase-base.md": page(`machine/rebase-base`),
        })
        await run("beta", b, "checkout", "--quiet", "-b", "re", "origin/picked")
        await run("beta", b, "rebase", "--quiet", "main")
      }
      const pushed = await pushAs("beta", b, "HEAD:refs/heads/main")
      expect(pushed.code, how).not.toBe(0)
      expect(remote(pushed.stderr).join("\n"), how).toContain(
        `but commit ${(await run("beta", b, "rev-parse", "HEAD")).slice(0, 7)} was first pushed by "${labels.beta}"`,
      )
    }
  })

  it("passes a fact check written in a merge commit only if it names the merge's first pusher", async () => {
    const a = await pageBy(
      "alpha",
      "machine/by-resolve",
      labels.alpha,
      "refs/heads/resolve",
    )
    expect(a.pushed.code).toBe(0)
    for (const by of [labels.beta, labels.alpha]) {
      const b = await cloneAs("beta")
      await commit("beta", b, {
        "machine/by-resolve-base.md": page("machine/by-resolve-base"),
      })
      await run("beta", b, "fetch", "--quiet", "origin")
      await run(
        "beta",
        b,
        "merge",
        "--quiet",
        "--no-ff",
        "--no-commit",
        "origin/resolve",
      )
      writeFileSync(
        join(b, "machine/by-resolve-base.md"),
        page("machine/by-resolve-base", group(by, { hostname: "merged" })),
      )
      await run("beta", b, "add", "machine/by-resolve-base.md")
      await run("beta", b, "commit", "--quiet", "-m", "Merge resolve")
      const pushed = await pushAs("beta", b, "HEAD:refs/heads/main")
      if (by === labels.beta) {
        expect(remote(pushed.stderr)).toEqual([])
        expect(pushed.code).toBe(0)
      } else {
        expect(refused(pushed)).toContain(
          `was first pushed by "${labels.beta}"`,
        )
      }
    }
  })

  it("refuses a group two agents introduced on two branches", async () => {
    const a = await pageBy(
      "alpha",
      "machine/by-twice",
      labels.alpha,
      "refs/heads/twice-a",
    )
    expect(a.pushed.code).toBe(0)
    // Beta writes the same page, the same group, on its own branch.
    const b = await cloneAs("beta")
    await run("beta", b, "checkout", "--quiet", "-b", "twice-b")
    await commit("beta", b, {
      "machine/by-twice.md": page("machine/by-twice", group(labels.alpha)),
    })
    await run("beta", b, "fetch", "--quiet", "origin")
    await run("beta", b, "checkout", "--quiet", "main")
    await run(
      "beta",
      b,
      "merge",
      "--quiet",
      "--no-ff",
      "--no-edit",
      "origin/twice-a",
    )
    await run("beta", b, "merge", "--quiet", "--no-ff", "--no-edit", "twice-b")
    expect(refused(await pushAs("beta", b, "HEAD:refs/heads/main"))).toContain(
      `was first pushed by "${labels.beta}"`,
    )
  })

  it("passes another agent's unchanged fact check and facts removed from it, and refuses a fact added under it", async () => {
    const id = "machine/by-kept"
    const twoFacts = { hostname: "kept", "platform.os": "debian" }
    const a = await cloneAs("alpha")
    await commit("alpha", a, {
      [`${id}.md`]: page(id, group(labels.alpha, twoFacts)),
    })
    expect((await pushAs("alpha", a, "HEAD:refs/heads/main")).code).toBe(0)

    const body = await change("beta", {
      [`${id}.md`]: page(id, group(labels.alpha, twoFacts), {
        body: "# Kept\n\nMore words.\n",
      }),
    })
    expect(
      remote(
        (await pushAs("beta", body.folder, "HEAD:refs/heads/main")).stderr,
      ),
    ).toEqual([])

    const added = await change("beta", {
      [`${id}.md`]: page(
        id,
        group(labels.alpha, { ...twoFacts, "platform.arch": "arm64" }),
        {
          body: "# Kept\n\nMore words.\n",
        },
      ),
    })
    expect(
      refused(await pushAs("beta", added.folder, "HEAD:refs/heads/main")),
    ).toContain(
      `by-not-first-pusher  "by: ${labels.alpha}" but commit ${added.made.slice(0, 7)} was first pushed by "${labels.beta}"`,
    )

    const removed = await change("beta", {
      [`${id}.md`]: page(id, group(labels.alpha, { hostname: "kept" }), {
        body: "# Kept\n\nMore words.\n",
      }),
    })
    const pushed = await pushAs("beta", removed.folder, "HEAD:refs/heads/main")
    expect(remote(pushed.stderr)).toEqual([])
    expect(pushed.code).toBe(0)
  })

  it("passes another agent reverting the removal of a fact check: restoring is not introducing", async () => {
    const id = "machine/by-reverted"
    const a = await cloneAs("alpha")
    await commit("alpha", a, { [`${id}.md`]: page(id, group(labels.alpha)) })
    expect((await pushAs("alpha", a, "HEAD:refs/heads/main")).code).toBe(0)
    const b = await change(
      "beta",
      { [`${id}.md`]: page(id) },
      "Remove the check",
    )
    expect((await pushAs("beta", b.folder, "HEAD:refs/heads/main")).code).toBe(
      0,
    )
    const c = await cloneAs("beta")
    await run("beta", c, "revert", "--no-edit", b.made)
    const pushed = await pushAs("beta", c, "HEAD:refs/heads/main")
    expect(remote(pushed.stderr)).toEqual([])
    expect(pushed.code).toBe(0)
  })

  it("passes a document moved with its fact checks unchanged, its old id kept as an alias", async () => {
    const a = await cloneAs("alpha")
    await commit("alpha", a, {
      "machine/by-old.md": page("machine/by-old", group(labels.alpha)),
    })
    expect((await pushAs("alpha", a, "HEAD:refs/heads/main")).code).toBe(0)
    const b = await cloneAs("beta")
    await run("beta", b, "mv", "machine/by-old.md", "machine/by-new.md")
    writeFileSync(
      join(b, "machine/by-new.md"),
      page("machine/by-new", group(labels.alpha), {
        fields: "aliases: [machine/by-old]\n",
      }),
    )
    await run("beta", b, "add", "-A")
    await run("beta", b, "commit", "--quiet", "-m", "Move")
    const pushed = await pushAs("beta", b, "HEAD:refs/heads/main")
    expect(remote(pushed.stderr)).toEqual([])
    expect(pushed.code).toBe(0)
  })

  it("keeps fact checks in commits Shinan made valid, as first pushed by shinan", async () => {
    // As the migration's first commit (GC-6): made on the server, first
    // pushed by shinan.
    const gitDir = store.pathOf(workspaceId)
    const main = (await serverRef("refs/heads/main"))!
    const tree = (
      await store.git.run(["rev-parse", `${main}^{tree}`], { gitDir })
    ).stdout
      .toString()
      .trim()
    const blob = (
      await store.git.run(["hash-object", "-w", "--stdin"], {
        gitDir,
        input: page("machine/imported", group("guneet")),
      })
    ).stdout
      .toString()
      .trim()
    const listing = (
      await store.git.run(["ls-tree", tree], { gitDir })
    ).stdout.toString()
    const machine = /040000 tree ([0-9a-f]{40})\tmachine/.exec(listing)![1]!
    const machineListing = (
      await store.git.run(["ls-tree", machine], { gitDir })
    ).stdout.toString()
    const newMachine = (
      await store.git.run(["mktree"], {
        gitDir,
        input: `${machineListing}100644 blob ${blob}\timported.md\n`,
      })
    ).stdout
      .toString()
      .trim()
    const newTree = (
      await store.git.run(["mktree"], {
        gitDir,
        input: listing.replace(machine, newMachine),
      })
    ).stdout
      .toString()
      .trim()
    const shinanCommit = (
      await store.git.run(
        ["commit-tree", "-p", main, "-m", "Import\n", newTree],
        {
          gitDir,
          env: {
            GIT_AUTHOR_NAME: "Shinan",
            GIT_AUTHOR_EMAIL: "shinan@shinan.invalid",
            GIT_COMMITTER_NAME: "Shinan",
            GIT_COMMITTER_EMAIL: "shinan@shinan.invalid",
          },
        },
      )
    ).stdout
      .toString()
      .trim()
    await store.git.run(["update-ref", "refs/heads/main", shinanCommit, main], {
      gitDir,
    })
    records.addFirstPushes(workspaceId, [
      {
        commit: shinanCommit,
        push: null,
        ref: null,
        by: "shinan",
        at: new Date().toISOString(),
      },
    ])
    const after = await change("beta", {
      "machine/after-import.md": page("machine/after-import"),
    })
    const pushed = await pushAs("beta", after.folder, "HEAD:refs/heads/main")
    expect(remote(pushed.stderr)).toEqual([])
    expect(pushed.code).toBe(0)
  })
})
