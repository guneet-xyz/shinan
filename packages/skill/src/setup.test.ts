import { execFile, spawn } from "node:child_process"
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { exampleDocuments, examplePerson } from "../test/example.js"
import { startGitServer } from "../test/git-server.js"
import type { TestGitServer } from "../test/git-server.js"
import {
  catalogRepositoryUrl,
  installationAddress,
  setupCommand,
  tokenPrompt,
  writtenAgent,
} from "./setup.js"

const run = promisify(execFile)

/**
 * The setup page's commands, run with a real `git` against a Git server
 * that takes a token as the Basic password, as Shinan's `/git/` does: in a
 * home folder of its own, with a made-up token, so nothing on this machine
 * is read or changed.
 */
describe("the agent setup, with a real git", () => {
  const token = "test-token-not-a-secret-7Qm2"
  const workspaceId = "00000000-0000-4000-8000-000000000001"
  let root: string
  let home: string
  let clone: string
  let server: TestGitServer
  let spyLog: string

  const env = (extra: Record<string, string> = {}) => ({
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    LANG: "C",
    ...extra,
  })
  /** Runs a command as pasted into a shell, typing `input` when it reads. */
  const paste = (command: string, input: string) =>
    new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      const child = spawn("sh", ["-c", command], { env: env(), cwd: home })
      let stderr = ""
      child.stderr.on("data", (chunk: Buffer) => (stderr += String(chunk)))
      child.on("error", reject)
      child.on("close", (code) => resolve({ code, stderr }))
      child.stdin.end(input)
    })
  const git = (args: string[], cwd = home, extra?: Record<string, string>) =>
    run("git", args, { env: env(extra), cwd })
  const failure = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: { stderr: string }) => error.stderr,
    )

  const spyCalls = async () =>
    (await readFile(spyLog, "utf8").catch(() => "")).split("\n").filter(Boolean)
  /** No other helper was asked for the token, told it, or stored it. */
  const expectNoOtherHelper = async () => {
    expect(await spyCalls()).toEqual([])
    await expect(readFile(join(home, ".git-credentials"))).rejects.toThrow(
      /ENOENT/,
    )
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "skill-setup-"))
    home = join(root, "home")
    clone = join(home, "shinan-catalog", "main")
    const repositories = join(root, "repositories")
    await mkdir(home)
    // Git's project root holds `git/`, as the URL's path does.
    await mkdir(join(repositories, "git"), { recursive: true })
    const bare = join(repositories, "git", `${workspaceId}.git`)
    await run("git", ["init", "--bare", "--initial-branch=main", bare])
    await run("git", ["-C", bare, "config", "http.receivepack", "true"])
    server = await startGitServer({
      projectRoot: repositories,
      password: token,
    })

    // Other credential helpers in the global configuration, for every
    // address and for Shinan's, at the start of the file and at its end:
    // one that logs whatever Git asks or tells it, and `store`, which saves
    // what it is told in ~/.git-credentials.
    spyLog = join(root, "spy.log")
    const spy = join(root, "spy-helper")
    await writeFile(
      spy,
      `#!/bin/sh\necho "$1" >> '${spyLog}'\ncat >/dev/null\n`,
    )
    await chmod(spy, 0o755)
    const helpers = `\thelper = ${spy}\n\thelper = store\n`
    await writeFile(
      join(home, ".gitconfig"),
      `[user]\n\tname = Test\n\temail = test@agents.example\n` +
        `[credential]\n${helpers}` +
        `[credential "${server.origin}"]\n${helpers}` +
        `[credential]\n${helpers}`,
    )
  })

  afterAll(async () => {
    await server?.close()
    if (root) await rm(root, { recursive: true, force: true })
  })

  const command = () =>
    setupCommand({
      origin: server.origin,
      workspaceId,
      by: writtenAgent("alex", "opencode-build-1"),
      folder: "~/shinan-catalog/main",
    })

  it("stores the pasted token and clones, with no other helper", async () => {
    const result = await paste(command(), `${token}\n`)
    expect(result.code, result.stderr).toBe(0)
    // It asks for the token, and never shows it.
    expect(result.stderr).toContain(tokenPrompt)
    expect(result.stderr).not.toContain(token)
    const folder = join(home, ".config", "shinan")
    expect((await stat(folder)).mode & 0o777).toBe(0o700)
    expect((await stat(join(folder, "token"))).mode & 0o777).toBe(0o600)
    expect(await readFile(join(folder, "token"), "utf8")).toBe(`${token}\n`)
    expect(server.requests.right).toBeGreaterThan(0)
    await expectNoOtherHelper()
    // The remote holds no credential.
    const { stdout: remote } = await git(["remote", "get-url", "origin"], clone)
    expect(remote.trim()).toBe(catalogRepositoryUrl(server.origin, workspaceId))
    // The helper is in the clone's own configuration, scoped to the
    // installation's address, after an empty value that drops the others.
    expect(installationAddress("https://shinan.example/some/page")).toBe(
      "https://shinan.example",
    )
    const { stdout: helpers } = await git(
      ["config", "--local", "--get-all", `credential.${server.origin}.helper`],
      clone,
    )
    expect(helpers.split("\n")[0]).toBe("")
    expect(helpers).toContain("~/.config/shinan/token")
    const global = async (key: string) =>
      (await git(["config", "--global", "--get", key])).stdout.trim()
    expect(await global("shinan.by")).toBe("alex via opencode-build-1")
    expect(await global("shinan.catalog")).toBe(clone)
  })

  it("pushes the skill's example change from a worktree", async () => {
    const work = join(home, "shinan-catalog", "example")
    await git(["fetch", "origin"], clone)
    await git(["worktree", "add", "-b", "example", work], clone)
    const [before, after] = exampleDocuments()
    await mkdir(join(work, "machine"))
    await mkdir(join(work, "person"))
    await writeFile(join(work, "person", "alex.md"), examplePerson)
    await writeFile(join(work, "machine", "build-1.md"), before)
    await git(["add", "-A"], work)
    await git(["commit", "-m", "Add build-1"], work)
    await git(["push", "origin", "HEAD:main"], work)
    await writeFile(join(work, "machine", "build-1.md"), after)
    await git(["commit", "-am", "Record the data disk after the resize"], work)
    await git(["fetch", "origin"], work)
    await git(["rebase", "origin/main"], work)
    await git(["push", "origin", "HEAD:main"], work)
    await git(["worktree", "remove", work], clone)
    await git(["branch", "-D", "example"], clone)
    await git(["fetch", "origin"], clone)
    expect(
      (await git(["show", "origin/main:machine/build-1.md"], clone)).stdout,
    ).toBe(after)
    await expectNoOtherHelper()
  })

  it("only replaces the token when it runs again, and keeps it when none is pasted", async () => {
    const file = join(home, ".config", "shinan", "token")
    const again = await paste(command(), "a-new-token\n")
    expect(again.code, again.stderr).toBe(0)
    expect(await readFile(file, "utf8")).toBe("a-new-token\n")
    const empty = await paste(command(), "\n")
    expect(empty.code).not.toBe(0)
    expect(empty.stderr).toContain("No token was pasted.")
    expect(await readFile(file, "utf8")).toBe("a-new-token\n")
    await writeFile(file, `${token}\n`)
  })

  it("never prints the token in Git's trace output", async () => {
    const traced = await git(["fetch", "origin"], clone, {
      GIT_TRACE: "1",
      GIT_TRACE_CURL: "1",
      GIT_CURL_VERBOSE: "1",
      GIT_TRACE_PACKET: "1",
    })
    const output = traced.stdout + traced.stderr
    expect(output).toMatch(/Authorization: Basic <redacted>/)
    expect(output).not.toContain(token)
    expect(output).not.toContain(
      Buffer.from(`agent:${token}`).toString("base64"),
    )
  })

  it("fails at once, telling no other helper, when the token is refused", async () => {
    const file = join(home, ".config", "shinan", "token")
    await writeFile(file, "a-revoked-token\n")
    try {
      expect(await failure(git(["fetch", "origin"], clone))).toMatch(
        /Authentication failed/,
      )
      expect(server.requests.wrong).toBeGreaterThan(0)
      await expectNoOtherHelper()
    } finally {
      await writeFile(file, `${token}\n`)
    }
  })

  it("leaves other helpers working outside the clone", async () => {
    // The checks above are not vacuous: outside the clone, Git asks the
    // global helpers, which have nothing to give.
    expect(
      await failure(
        git(["ls-remote", catalogRepositoryUrl(server.origin, workspaceId)]),
      ),
    ).toMatch(/terminal prompts disabled|Authentication failed/)
    expect(await spyCalls()).toContain("get")
  })
})
