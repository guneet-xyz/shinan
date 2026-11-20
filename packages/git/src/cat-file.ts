import { checkObjectName } from "./names.js"
import type { Git, GitProcess, RunOptions } from "./run.js"
import { GitError } from "./run.js"

export type ObjectType = "blob" | "tree" | "commit" | "tag"

export interface ObjectInfo {
  oid: string
  type: ObjectType
  size: number
}

export interface GitObject extends ObjectInfo {
  content: Buffer
}

/** Why {@link CatFile.read} gave no content. */
export type ReadMiss = "missing" | "ambiguous" | "too-large"

export interface CatFileOptions extends Pick<RunOptions, "env" | "timeoutMs"> {
  /**
   * The largest object {@link CatFile.read} returns; a larger one is read
   * past and reported as `too-large`. Default: 16 MiB.
   */
  maxObjectBytes?: number
}

/**
 * One `git cat-file --batch-command` process for reading many objects of one
 * repository, one request at a time in the order asked. Object names are
 * full object IDs or `<revision>:<path>` (`objectName`), such as
 * `refs/heads/main:README.md`; anything else, a line break included, is
 * refused.
 */
export interface CatFile {
  /** The object's ID, type and size, or `null` if it does not exist. */
  info(name: string): Promise<ObjectInfo | null>
  /** The object with its content, or why not. */
  read(name: string): Promise<GitObject | ReadMiss>
  /** Ends the process. Requests still waiting fail. */
  close(): Promise<void>
}

const DEFAULT_MAX_OBJECT_BYTES = 16 * 1024 * 1024
const TYPES = new Set(["blob", "tree", "commit", "tag"])

interface Pending {
  withContent: boolean
  resolve: (value: GitObject | ObjectInfo | ReadMiss) => void
  reject: (error: Error) => void
}

export function openCatFile(
  git: Git,
  gitDir: string,
  options: CatFileOptions = {},
): CatFile {
  const maxObjectBytes = options.maxObjectBytes ?? DEFAULT_MAX_OBJECT_BYTES
  const proc: GitProcess = git.spawn(["cat-file", "--batch-command"], {
    gitDir,
    env: options.env,
    timeoutMs: options.timeoutMs,
  })
  const queue: Pending[] = []
  let buffer: Buffer = Buffer.alloc(0)
  // The object being read: its header, the bytes still to come, and its
  // content unless it is too large to keep.
  let current:
    { info: ObjectInfo; remaining: number; chunks: Buffer[] | null } | undefined
  let failure: Error | undefined
  const errors: Buffer[] = []

  const fail = (error: Error) => {
    failure ??= error
    for (const pending of queue.splice(0)) pending.reject(failure)
  }

  const take = () => {
    for (;;) {
      if (current) {
        // Content, then one line feed.
        if (current.remaining > 0) {
          if (buffer.length === 0) return
          const part = buffer.subarray(0, current.remaining)
          current.chunks?.push(part)
          current.remaining -= part.length
          buffer = buffer.subarray(part.length)
          continue
        }
        if (buffer.length === 0) return
        buffer = buffer.subarray(1)
        const pending = queue.shift()
        const { info, chunks } = current
        current = undefined
        pending?.resolve(
          chunks ? { ...info, content: Buffer.concat(chunks) } : "too-large",
        )
        continue
      }
      const end = buffer.indexOf(0x0a)
      if (end < 0) return
      const line = buffer.subarray(0, end).toString("utf8")
      buffer = buffer.subarray(end + 1)
      const pending = queue[0]
      if (!pending) {
        fail(
          new GitError(
            "exit",
            "cat-file",
            "git cat-file answered a request nobody made",
          ),
        )
        proc.kill()
        return
      }
      if (line.endsWith(" missing") || line.endsWith(" ambiguous")) {
        queue.shift()
        pending.resolve(line.endsWith(" missing") ? "missing" : "ambiguous")
        continue
      }
      const [oid, type, sizeText] = line.split(" ")
      const size = Number(sizeText)
      if (!oid || !type || !TYPES.has(type) || !Number.isSafeInteger(size)) {
        fail(
          new GitError(
            "exit",
            "cat-file",
            "git cat-file gave an answer Shinan cannot read",
          ),
        )
        proc.kill()
        return
      }
      const info: ObjectInfo = { oid, type: type as ObjectType, size }
      if (!pending.withContent) {
        queue.shift()
        pending.resolve(info)
        continue
      }
      current = {
        info,
        remaining: size,
        chunks: size <= maxObjectBytes ? [] : null,
      }
    }
  }

  proc.child.stdout.on("data", (chunk: Buffer) => {
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk
    take()
  })
  proc.child.stderr.on("data", (chunk: Buffer) => {
    if (errors.length < 16) errors.push(chunk)
  })
  void proc.ended.then(({ code, timedOut }) => {
    const firstLine = Buffer.concat(errors).toString("utf8").split("\n", 1)[0]
    fail(
      timedOut
        ? new GitError(
            "timeout",
            "cat-file",
            "git cat-file took too long and was stopped",
          )
        : new GitError(
            "exit",
            "cat-file",
            `git cat-file ended (exit code ${code ?? "none"})${firstLine ? `: ${firstLine.slice(0, 200)}` : ""}`,
            code,
          ),
    )
  })

  const request = (command: "info" | "contents", name: string) =>
    new Promise<GitObject | ObjectInfo | ReadMiss>((resolve, reject) => {
      if (failure) return reject(failure)
      try {
        checkObjectName(name)
      } catch (error) {
        return reject(error instanceof Error ? error : new Error(String(error)))
      }
      queue.push({ withContent: command === "contents", resolve, reject })
      proc.child.stdin.write(`${command} ${name}\n`)
    })

  return {
    async info(name) {
      const answer = await request("info", name)
      return typeof answer === "string" ? null : answer
    },
    async read(name) {
      return (await request("contents", name)) as GitObject | ReadMiss
    },
    async close() {
      proc.child.stdin.end()
      await proc.ended
    },
  }
}
