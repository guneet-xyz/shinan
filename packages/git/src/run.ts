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
 * Variables Git gets from Shinan and never from the caller's `env`: with
 * them, no configuration but the repository's own and the command line's
 * applies.
 */
const FIXED = [
  "PATH",
  "HOME",
  "XDG_CONFIG_HOME",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_ATTR_NOSYSTEM",
  "GIT_EXEC_PATH",
  "GIT_TEMPLATE_DIR",
  "GIT_LITERAL_PATHSPECS",
] as const

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
  /** Ends the process at once. */
  kill(): void
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

  const commandOf = (args: readonly string[]) =>
    args.find((arg) => !arg.startsWith("-")) ?? "git"

  const spawnGit: Git["spawn"] = (args, runOptions = {}) => {
    const env = { ...environment() }
    for (const [key, value] of Object.entries(runOptions.env ?? {})) {
      if ((FIXED as readonly string[]).includes(key)) {
        throw new GitError(
          "start",
          commandOf(args),
          `${key} is set by Shinan and cannot be changed`,
        )
      }
      env[key] = value
    }
    const fullArgs = runOptions.gitDir
      ? [`--git-dir=${runOptions.gitDir}`, ...args]
      : [...args]
    const child = spawn(binary, fullArgs, {
      cwd: runOptions.cwd ?? runOptions.gitDir ?? process.cwd(),
      env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    })
    let timedOut = false
    const limit = runOptions.timeoutMs ?? timeoutMs
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, limit)
    const ended = new Promise<{
      code: number | null
      signal: NodeJS.Signals | null
      timedOut: boolean
    }>((resolve) => {
      child.once("close", (code, signal) => {
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
    return { child, ended, kill: () => child.kill("SIGKILL") }
  }

  const run: Git["run"] = async (args, runOptions = {}) => {
    const command = commandOf(args)
    const { child, ended } = spawnGit(args, runOptions)
    const limit = runOptions.maxOutputBytes ?? maxOutputBytes
    const chunks: Buffer[] = []
    let size = 0
    let overflow = false
    child.stdout.on("data", (chunk: Buffer) => {
      if (overflow) return
      size += chunk.length
      if (size > limit) {
        overflow = true
        child.kill("SIGKILL")
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
