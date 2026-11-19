import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createGit, findProgram, GitError } from "./run.js"
import { commitFiles, createFixtureRepository } from "./testing.js"

const git = createGit()
let repository: Awaited<ReturnType<typeof createFixtureRepository>>
const saved = { ...process.env }

beforeAll(async () => {
  repository = await createFixtureRepository(git)
})
afterAll(() => {
  repository.remove()
  process.env = saved
})

describe("the environment Git starts with", () => {
  it("is built by Shinan, not inherited", async () => {
    const outside = mkdtempSync(join(tmpdir(), "shinan-git-outside-"))
    try {
      writeFileSync(
        join(outside, "config"),
        "[user]\n\tname = Leaked\n[alias]\n\tleaked = status\n",
      )
      writeFileSync(join(outside, ".gitconfig"), "[user]\n\tname = Leaked\n")
      process.env.GIT_CONFIG_GLOBAL = join(outside, "config")
      process.env.GIT_CONFIG_SYSTEM = join(outside, "config")
      process.env.HOME = outside
      process.env.GIT_CONFIG_PARAMETERS = "'user.name'='Leaked'"
      process.env.GIT_DIR = outside
      process.env.SHINAN_SESSION_SECRET = "not for git"
      const { stdout } = await git.run(["config", "--list", "--show-origin"], {
        gitDir: repository.gitDir,
      })
      const listed = stdout.toString()
      expect(listed).not.toContain("Leaked")
      expect(listed).not.toContain(outside)
      const { stdout: env } = await createGit({
        binary: findProgram("env")!,
      }).run([])
      expect(env.toString()).not.toContain("SHINAN_SESSION_SECRET")
    } finally {
      process.env = { ...saved }
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it("holds the clean settings, and a HOME that stays empty", async () => {
    const env = git.environment()
    expect(env).toMatchObject({
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      GIT_LITERAL_PATHSPECS: "1",
      LC_ALL: "C",
    })
    expect(Object.keys(env).sort()).toEqual(
      [
        "PATH",
        "HOME",
        "XDG_CONFIG_HOME",
        "GIT_CONFIG_NOSYSTEM",
        "GIT_CONFIG_GLOBAL",
        "GIT_ATTR_NOSYSTEM",
        "GIT_TERMINAL_PROMPT",
        "GIT_NO_REPLACE_OBJECTS",
        "GIT_NO_LAZY_FETCH",
        "GIT_ADVICE",
        "GIT_LITERAL_PATHSPECS",
        "LC_ALL",
        "LANG",
      ].sort(),
    )
    await git.run(["log", "--oneline", "-1"], {
      gitDir: repository.gitDir,
      okExitCodes: [0, 128],
    })
    expect(readdirSync(env.HOME!)).toEqual([])
  })

  it("takes a caller's variables, but not in place of its own", async () => {
    const run = createGit({ binary: findProgram("env")! })
    const { stdout } = await run.run([], { env: { GIT_QUARANTINE_PATH: "/q" } })
    expect(stdout.toString()).toContain("GIT_QUARANTINE_PATH=/q")
    for (const key of [
      "HOME",
      "PATH",
      "GIT_CONFIG_GLOBAL",
      "GIT_CONFIG_PARAMETERS",
    ]) {
      await expect(
        git.run(["--version"], { env: { [key]: "x" } }),
      ).rejects.toMatchObject({
        kind: "start",
      })
    }
  })
})

describe("running Git", () => {
  it("returns standard output and error", async () => {
    const { stdout, exitCode } = await git.run(["--version"])
    expect(exitCode).toBe(0)
    expect(stdout.toString()).toMatch(/^git version 2\./)
  })

  it("feeds standard input", async () => {
    const { stdout } = await git.run(["hash-object", "--stdin"], {
      input: "hello\n",
    })
    expect(stdout.toString().trim()).toBe(
      "ce013625030ba8dba906f756967f9e9ca394464a",
    )
  })

  it("fails with the command, the exit code and Git's first line", async () => {
    const error = await git
      .run(["rev-parse", "--verify", "refs/heads/nothing"], {
        gitDir: repository.gitDir,
      })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GitError)
    expect(error).toMatchObject({
      kind: "exit",
      command: "rev-parse",
      exitCode: 128,
    })
    expect((error as GitError).message).toMatch(
      /^git rev-parse failed \(exit code 128\): fatal:/,
    )
  })

  it("accepts the exit codes a caller expects", async () => {
    const result = await git.run(["cat-file", "-e", "0".repeat(40)], {
      gitDir: repository.gitDir,
      okExitCodes: [0, 1, 128],
    })
    expect(result.exitCode).not.toBe(0)
  })

  it("stops a process past its time limit", async () => {
    const slow = createGit({ binary: findProgram("sleep")! })
    const started = Date.now()
    await expect(slow.run(["10"], { timeoutMs: 200 })).rejects.toMatchObject({
      kind: "timeout",
    })
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it("stops a process past its output limit", async () => {
    const big = await commitFiles(git, repository.gitDir, {
      "big.txt": "x".repeat(200_000),
    })
    await expect(
      git.run(["cat-file", "-p", `${big}:big.txt`], {
        gitDir: repository.gitDir,
        maxOutputBytes: 10_000,
      }),
    ).rejects.toMatchObject({ kind: "output-limit" })
    const { stdout } = await git.run(["cat-file", "-p", `${big}:big.txt`], {
      gitDir: repository.gitDir,
    })
    expect(stdout.length).toBe(200_000)
  })

  it("reports a program that cannot start", async () => {
    await expect(
      createGit({ binary: "/nonexistent/git" }).run(["--version"]),
    ).rejects.toMatchObject({ kind: "start" })
    expect(() => createGit({ binary: "git" })).toThrow(GitError)
  })
})
