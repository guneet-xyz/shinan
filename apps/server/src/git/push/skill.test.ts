import { execFile, spawn } from "node:child_process"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
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
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  createAgentToken,
  createCatalogRepository,
  createGitClient,
  createWorkspace,
  pushCheckCodes,
  shinan,
} from "@shinan/core"
import type { JobQueue } from "@shinan/core"
import { schema } from "@shinan/db"
import { connectTestDatabase } from "@shinan/db/testing"
import { createGit, findProgram, hooksDirectory } from "@shinan/git"
import { skillDirectory } from "@shinan/skill"
import { setupCommand } from "@shinan/skill/setup"

import { insertPerson } from "../../../test/people.js"
import { noSignIn } from "../../api/sign-in.js"
import { createApp } from "../../app.js"
import { listenerOptions } from "../../in-flight.js"
import { createGitApp } from "../app.js"
import { openJournal } from "../journal.js"
import { createRepositoryStore } from "../store.js"
import type { RepositoryStore } from "../store.js"
import { createPushLocks } from "./lock.js"
import { openRecords } from "./records.js"
import { createPushService } from "./service.js"

// The shinan skill against Shinan's own push checks (GC-9, #171): the setup
// page's one command, then the skill's quick path and its example change,
// pushed with a real `git` through `web` to a Git container running the
// image's hooks; and a refusal, whose codes and advice the skill explains.

const { db, pool } = connectTestDatabase()
const installationUrl = "http://shinan.test"
const jobs: JobQueue = { send: () => Promise.resolve(null) }
const serviceToken = "service-token-for-tests-0123456789abcdef"

let work: string
let home: string
let store: RepositoryStore
const servers: ServerType[] = []
let web: string
let workspaceId: string
let token: string
/** The agent's written form, `<person handle> via opencode-build-1`. */
let by: string
let personHandle: string

const changing = readFileSync(
  join(skillDirectory, "references", "changing.md"),
  "utf8",
)

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
  work = mkdtempSync(join(tmpdir(), "shinan-skill-"))
  home = join(work, "home")
  for (const folder of ["catalog", "hooks", "git-home", "home"])
    mkdirSync(join(work, folder))
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
    git: createGit({ home: join(work, "git-home") }),
    hooksDirectory: join(work, "hooks"),
  })
  const journal = openJournal(root)
  const push = createPushService({
    store,
    journal,
    records: openRecords(root),
    locks: createPushLocks(),
    log: () => {},
  })
  push.hookUrl = await listen(push.hookApp.fetch)
  const gitUrl = await listen(
    createGitApp({ serviceToken, store, journal, push, log: () => {} }).fetch,
  )
  const client = createGitClient({ url: gitUrl, serviceToken })

  const person = await insertPerson(db, "alex")
  await db.insert(schema.emailAllowlist).values({ email: person.email })
  personHandle = person.handle
  workspaceId = (
    await createWorkspace(
      { db, actor: { kind: "person", personId: person.id } },
      { name: "Team" },
    )
  ).workspace.id
  await createCatalogRepository(
    { db, actor: shinan, jobs },
    { workspaceId },
    client,
  )
  const issued = await createAgentToken(
    {
      db,
      jobs,
      installationUrl,
      actor: { kind: "person", personId: person.id, reauthenticated: true },
    },
    { workspaceId, codingTool: "opencode", machine: "build-1", access: "full" },
  )
  token = issued.token
  by = `${person.handle} via ${issued.agent.handle}`
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
  writeFileSync(
    join(home, ".gitconfig"),
    "[user]\n\tname = Build 1\n\temail = build-1@agents.example\n",
  )
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

const env = () => ({
  PATH: process.env.PATH,
  HOME: home,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
})

/** A shell command as a person pastes it, typing `input` when it reads. */
function paste(command: string, input: string) {
  return new Promise<{ code: number | null; stderr: string }>(
    (resolve, reject) => {
      const child = spawn("sh", ["-c", command], { env: env(), cwd: home })
      let stderr = ""
      child.stderr.on("data", (chunk: Buffer) => (stderr += String(chunk)))
      child.on("error", reject)
      child.on("close", (code) => resolve({ code, stderr }))
      child.stdin.end(input)
    },
  )
}

function git(args: string[], cwd: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>(
    (resolve) => {
      execFile(
        findProgram("git")!,
        args,
        { cwd, env: env() },
        (error, stdout, stderr) =>
          resolve({
            code: error ? ((error as { code?: number }).code ?? 1) : 0,
            stdout,
            stderr,
          }),
      )
    },
  )
}

async function ok(args: string[], cwd: string) {
  const result = await git(args, cwd)
  if (result.code !== 0)
    throw new Error(`git ${args.join(" ")}: ${result.stderr}`)
  return result
}

/** The `remote:` lines of a push, without the prefix. */
const remote = (stderr: string) =>
  stderr
    .split("\n")
    .filter((l) => l.startsWith("remote: "))
    .map((l) => l.slice("remote: ".length).trimEnd())

/** The skill's example documents, with this test's person handle. */
function example(): [string, string] {
  const section = changing.slice(changing.indexOf("## An example"))
  const [before, after] = [
    ...section.matchAll(/```markdown\n([\s\S]*?)```/g),
  ].map((m) => m[1]!.replaceAll("by: alex via opencode-build-1", `by: ${by}`))
  return [before!, after!]
}

const person = `---
id: person/alex
type: person
title: Alex
summary: Runs the build machines.
status: active
owner: person/alex
---

# Alex
`

describe("the shinan skill against Shinan's push checks", () => {
  const clone = () => join(home, "shinan-catalog", "main")

  it("sets the machine up with the setup page's one command", async () => {
    const result = await paste(
      setupCommand({ origin: web, workspaceId, by }),
      `${token}\n`,
    )
    expect(result.code, result.stderr).toBe(0)
    expect(result.stderr).not.toContain(token)
    const { stdout } = await ok(["config", "--global", "shinan.by"], home)
    expect(stdout.trim()).toBe(by)
  })

  it("pushes the skill's example change by its quick path, accepted", async () => {
    const [before, after] = example()
    const worktree = join(home, "shinan-catalog", "disk-resize")
    await ok(["fetch", "origin"], clone())
    await ok(
      ["worktree", "add", "-b", "disk-resize", worktree, "origin/main"],
      clone(),
    )
    mkdirSync(join(worktree, "person"))
    mkdirSync(join(worktree, "machine"))
    writeFileSync(join(worktree, "person", "alex.md"), person)
    writeFileSync(join(worktree, "machine", "build-1.md"), before)
    await ok(["add", "-A"], worktree)
    await ok(["commit", "-q", "-m", "Add build-1"], worktree)
    const first = await git(["push", "origin", "HEAD:main"], worktree)
    expect(first.code, first.stderr).toBe(0)
    expect(remote(first.stderr)).not.toContain(
      "Shinan refused this push. Nothing was changed.",
    )

    writeFileSync(join(worktree, "machine", "build-1.md"), after)
    await ok(
      ["commit", "-q", "-am", "Record the data disk after the resize (SHN-12)"],
      worktree,
    )
    await ok(["fetch", "origin"], worktree)
    await ok(["rebase", "origin/main"], worktree)
    // A check-only push first, as the skill suggests: nothing changes.
    const check = await git(
      ["push", "-o", "check-only", "origin", "HEAD:main"],
      worktree,
    )
    expect(check.code).not.toBe(0)
    expect(remote(check.stderr)[0]).toMatch(
      /^Shinan checked this push \(check only\)/,
    )
    expect(changing).toContain('"Shinan checked this push (check only)"')
    const pushed = await git(["push", "origin", "HEAD:main"], worktree)
    expect(pushed.code, pushed.stderr).toBe(0)
    await ok(["worktree", "remove", worktree], clone())
    await ok(["branch", "-D", "disk-resize"], clone())
    await ok(["fetch", "origin"], clone())
    const { stdout } = await ok(
      ["show", "origin/main:machine/build-1.md"],
      clone(),
    )
    expect(stdout).toBe(after)
  })

  it("refuses a fact check naming someone else, as the skill explains", async () => {
    const worktree = join(home, "shinan-catalog", "someone-else")
    await ok(["fetch", "origin"], clone())
    await ok(
      ["worktree", "add", "-b", "someone-else", worktree, "origin/main"],
      clone(),
    )
    const [, after] = example()
    writeFileSync(
      join(worktree, "machine", "build-1.md"),
      after
        .replace(`by: ${by}`, `by: ${personHandle}`)
        .replace("2026-11-18T09:42:17Z", "2026-11-18T10:00:00Z"),
    )
    await ok(["commit", "-q", "-am", "A check by the person alone"], worktree)
    const refused = await git(["push", "origin", "HEAD:main"], worktree)
    expect(refused.code).not.toBe(0)
    const lines = remote(refused.stderr)
    expect(lines[0]).toBe("Shinan refused this push. Nothing was changed.")
    // Every code printed is in the skill's table, and the output's advice
    // for this code is the skill's, word for word.
    const codes = lines
      .map((l) => /^ {2}\S+ {2,}([a-z-]+) {2}/.exec(l)?.[1])
      .filter((c): c is string => c !== undefined)
    expect(codes).toContain("by-not-first-pusher")
    for (const code of codes) expect(changing).toContain(`| \`${code}\``)
    const advice = lines.find((l) => l.startsWith("by-not-first-pusher: "))!
    const prose = changing.replace(/\s+/g, " ")
    expect(prose).toContain(advice.slice("by-not-first-pusher: ".length))
    expect(prose).toContain(
      "Name yourself only on fact checks you made. For another agent's, merge its pushed branch; don't rebase, cherry-pick or squash it.",
    )
    await ok(["worktree", "remove", "--force", worktree], clone())
  })

  it("explains the refusals after a purge in the push output's words", () => {
    // The messages as the push checks write them (GC-8): the part before
    // the colon is what an agent sees first, and the skill quotes it.
    const source = ["service.ts", "checks.ts"]
      .map((file) =>
        readFileSync(new URL(`./${file}`, import.meta.url), "utf8"),
      )
      .join("\n")
    const prose = changing.replace(/\s+/g, " ")
    for (const start of [
      "this commit was removed by a purge",
      "Shinan is removing text from this catalog's history",
      "the catalog's history was rewritten while this push was sent",
    ]) {
      expect(source, start).toContain(`${start}:`)
      expect(prose, start).toContain(start)
    }
    expect(prose).toContain("## After a purge")
  })

  it("explains every push check code", () => {
    for (const code of Object.keys(pushCheckCodes))
      expect(changing, code).toContain(`| \`${code}\``)
  })
})
