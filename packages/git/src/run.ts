import { spawn } from "node:child_process"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { accessSync, constants, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, isAbsolute, join } from "node:path"

/**
 * How Shinan starts Git (build plan §2.2, §2.3): the one `git` program,
 * never through a shell, with an environment built here rather than
 * inherited, a time limit and an output limit. Nothing here knows the
 * catalog's rules.
 */
export interface GitOptions {
  /**
   * The `git` program. Default: the first `git` on this process's `PATH`
   * (`/usr/bin/git` in the image).
   */
  binary?: string
  /**
   * The folder Git sees as `HOME`. It must stay empty. Default: a new
   * private folder under the system's temporary folder, made on first use.
   */
  home?: string
  /** Default time limit for one Git process, in milliseconds. */
  timeoutMs?: number
  /** Default limit on one Git process's standard output, in bytes. */
  maxOutputBytes?: number
}

/** 60 seconds. */
export const DEFAULT_TIMEOUT_MS = 60_000
/** 32 MiB: a full tree listing of a catalog at its limits is a few MiB. */
export const DEFAULT_MAX_OUTPUT_BYTES = 32 * 1024 * 1024
/** Standard error is kept up to this size; the rest is dropped. */
export const MAX_STDERR_BYTES = 64 * 1024

/**
 * Variables a caller's `env` may not set, besides those of the clean
 * environment itself ({@link Git.environment}): the repository's location,
 * Git's configuration and exec path, the variables that make Git run a command or write a trace
 * file, and the ones that change how Node.js (Shinan's hooks) or the
 * dynamic loader start.
 */
const REFUSED = new Set([
  // The repository is chosen by `gitDir` alone: GIT_COMMON_DIR would send
  // reads of refs and configuration to another repository.
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_CONFIG",
  "GIT_EXEC_PATH",
  "GIT_TEMPLATE_DIR",
  "GIT_EXTERNAL_DIFF",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_SSH_VARIANT",
  "GIT_PROXY_COMMAND",
  "GIT_ASKPASS",
  "SSH_ASKPASS",
  "GIT_PAGER",
  "PAGER",
  "GIT_EDITOR",
  "GIT_SEQUENCE_EDITOR",
  "EDITOR",
  "VISUAL",
  "GIT_ATTR_SOURCE",
  "SHELL",
])
const REFUSED_PREFIXES = ["GIT_CONFIG_", "GIT_TRACE", "NODE_", "LD_"]

/** Whether a caller may set `key` in a Git process's environment. */
function refusedVariable(key: string, clean: Record<string, string>): boolean {
  return (
    key === "" ||
    key.includes("=") ||
    key.includes("\0") ||
    Object.hasOwn(clean, key) ||
    REFUSED.has(key) ||
    REFUSED_PREFIXES.some((prefix) => key.startsWith(prefix))
  )
}

/**
 * The Git command in `args`, for messages: the first argument that is not
 * an option or the value of `-c` or `-C`.
 */
export function commandOf(args: readonly string[]): string {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === "-c" || arg === "-C") i++
    else if (!arg.startsWith("-")) return arg
  }
  return "git"
}

export interface RunOptions {
  /** The repository: passed as `--git-dir`. */
  gitDir?: string
  /** The working folder of the process. Default: `gitDir`, or this process's. */
  cwd?: string
  /**
   * More variables for this process, such as the quarantine variables of a
   * push or a commit's author. They cannot replace the clean environment's.
   */
  env?: Record<string, string>
  /** Written to standard input, which is then closed. */
  input?: string | Uint8Array
  timeoutMs?: number
  maxOutputBytes?: number
  /** Exit codes that are not failures. Default: `[0]`. */
  okExitCodes?: readonly number[]
}

export interface RunResult {
  stdout: Buffer
  /** At most {@link MAX_STDERR_BYTES}. */
  stderr: string
  exitCode: number
}

export type GitErrorKind = "exit" | "timeout" | "output-limit" | "start"

/**
 * A Git process that failed. The message names the Git command and how it
 * ended, and quotes the first line of Git's standard error, never its input
 * or output.
 */
export class GitError extends Error {
  override name = "GitError"
  constructor(
    readonly kind: GitErrorKind,
    readonly command: string,
    message: string,
    readonly exitCode: number | null = null,
    readonly stderr = "",
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

/** A Git process started by {@link Git.spawn}. */
export interface GitProcess {
  child: ChildProcessWithoutNullStreams
  /** Settles when the process has ended, with how it ended. */
  ended: Promise<{
    code: number | null
    signal: NodeJS.Signals | null
    timedOut: boolean
  }>
  /** Ends the process and every process it started, at once. */
  kill: () => void
}

export interface Git {
  /** The `git` program this uses. */
  readonly binary: string
  /** The environment every Git process starts with, before a caller's `env`. */
  environment(): Record<string, string>
  /** Runs Git to the end and returns its output. */
  run(args: readonly string[], options?: RunOptions): Promise<RunResult>
  /**
   * Starts Git and hands over its streams, for long-running processes such
   * as `cat-file --batch-command`. The time limit still applies; the output
   * limit is the caller's.
   */
  spawn(
    args: readonly string[],
    options?: Omit<RunOptions, "input" | "maxOutputBytes" | "okExitCodes">,
  ): GitProcess
}

/** Finds `name` as an executable file on `path`, like a shell would. */
export function findProgram(
  name: string,
  path = process.env.PATH ?? "",
): string | null {
  for (const folder of path.split(delimiter)) {
    if (!isAbsolute(folder)) continue
    const candidate = join(folder, name)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // Not here.
    }
  }
  return null
}

export function createGit(options: GitOptions = {}): Git {
  const binary = options.binary ?? findProgram("git")
  if (!binary || !isAbsolute(binary)) {
    throw new GitError(
      "start",
      "git",
      binary
        ? "The git program must be an absolute path"
        : "git is not installed",
    )
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  let home = options.home
  const homeFolder = () =>
    (home ??= mkdtempSync(join(tmpdir(), "shinan-git-home-")))

  const environment = (): Record<string, string> => ({
    // Git finds its own programs (`git upload-pack` and the like) through
    // its compiled-in exec path; PATH holds only the folder of `git`.
    PATH: dirname(binary),
    HOME: homeFolder(),
    XDG_CONFIG_HOME: homeFolder(),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_ADVICE: "0",
    // Paths are never patterns.
    GIT_LITERAL_PATHSPECS: "1",
    LC_ALL: "C",
    LANG: "C",
  })

  const spawnGit: Git["spawn"] = (args, runOptions = {}) => {
    const env = environment()
    const clean = { ...env }
    for (const [key, value] of Object.entries(runOptions.env ?? {})) {
      if (refusedVariable(key, clean)) {
        throw new GitError(
          "start",
          commandOf(args),
          `${key} cannot be set for Git`,
        )
      }
      env[key] = value
    }
    const fullArgs = runOptions.gitDir
      ? [`--git-dir=${runOptions.gitDir}`, ...args]
      : [...args]
    // In a process group of its own, so that a limit ends the processes Git
    // starts too (`http-backend` starts `upload-pack`, which starts
    // `pack-objects`); they would otherwise go on and keep its output open.
    const child = spawn(binary, fullArgs, {
      cwd: runOptions.cwd ?? runOptions.gitDir ?? process.cwd(),
      env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      detached: true,
      windowsHide: true,
    })
    let exited = false
    let closed = false
    let killed = false
    const kill = () => {
      killed = true
      // After `close` the group's ID may belong to another process.
      if (child.pid === undefined || closed) return
      try {
        process.kill(-child.pid, "SIGKILL")
      } catch {
        // The group is gone already.
      }
      // Whatever the group left behind cannot hold the pipes open.
      if (exited) {
        child.stdout.destroy()
        child.stderr.destroy()
      }
    }
    let timedOut = false
    const limit = runOptions.timeoutMs ?? timeoutMs
    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, limit)
    child.once("exit", () => {
      exited = true
      // Once Git is killed, nothing it started may outlive it or keep its
      // output open.
      if (killed) kill()
    })
    const ended = new Promise<{
      code: number | null
      signal: NodeJS.Signals | null
      timedOut: boolean
    }>((resolve) => {
      child.once("close", (code, signal) => {
        closed = true
        clearTimeout(timer)
        resolve({ code, signal, timedOut })
      })
      child.once("error", () => {
        clearTimeout(timer)
        resolve({ code: null, signal: null, timedOut })
      })
    })
    // A process that is gone cannot take its input; that shows as its exit.
    child.stdin.on("error", () => {})
    return { child, ended, kill }
  }

  const run: Git["run"] = async (args, runOptions = {}) => {
    const command = commandOf(args)
    const { child, ended, kill } = spawnGit(args, runOptions)
    const limit = runOptions.maxOutputBytes ?? maxOutputBytes
    const chunks: Buffer[] = []
    let size = 0
    let overflow = false
    child.stdout.on("data", (chunk: Buffer) => {
      if (overflow) return
      size += chunk.length
      if (size > limit) {
        overflow = true
        kill()
        return
      }
      chunks.push(chunk)
    })
    const errors: Buffer[] = []
    let errorSize = 0
    child.stderr.on("data", (chunk: Buffer) => {
      if (errorSize >= MAX_STDERR_BYTES) return
      const kept = chunk.subarray(0, MAX_STDERR_BYTES - errorSize)
      errorSize += kept.length
      errors.push(kept)
    })
    let startError: Error | undefined
    child.once("error", (error) => {
      startError = error
    })
    child.stdin.end(runOptions.input)

    const { code, signal, timedOut } = await ended
    const stderr = Buffer.concat(errors).toString("utf8")
    if (startError) {
      throw new GitError(
        "start",
        command,
        `git ${command} could not start`,
        null,
        "",
        { cause: startError },
      )
    }
    if (timedOut) {
      throw new GitError(
        "timeout",
        command,
        `git ${command} took longer than ${runOptions.timeoutMs ?? timeoutMs} ms and was stopped`,
      )
    }
    if (overflow) {
      throw new GitError(
        "output-limit",
        command,
        `git ${command} wrote more than ${limit} bytes and was stopped`,
      )
    }
    const exitCode = code ?? -1
    if (!(runOptions.okExitCodes ?? [0]).includes(exitCode)) {
      const firstLine = stderr.split("\n", 1)[0]?.slice(0, 200) ?? ""
      throw new GitError(
        "exit",
        command,
        `git ${command} failed (${signal ? `signal ${signal}` : `exit code ${exitCode}`})${firstLine ? `: ${firstLine}` : ""}`,
        exitCode,
        stderr,
      )
    }
    return { stdout: Buffer.concat(chunks), stderr, exitCode }
  }

  return { binary, environment, run, spawn: spawnGit }
}
