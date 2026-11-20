import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { isObjectId, treePath } from "./names.js"
import type { Git } from "./run.js"
import { GitError } from "./run.js"

/** A file of a commit written by {@link writeCommit}. */
export interface CommitFile {
  /** From the tree's root, with `/` between folders. */
  path: string
  content: string | Uint8Array
  /** Default `100644`, a regular file. */
  mode?: "100644" | "100755" | "120000"
}

/** Who a commit names as its author and committer, and when. */
export interface CommitIdentity {
  name: string
  email: string
  /** Seconds since 1970. Default: now. */
  time?: number
}

/** Whether `value` is safe in an identity (no `<`, `>` or control characters). */
function identityPart(value: string, what: string): string {
  if (value.trim() === "" || /[<>\n\r\0]/.test(value)) {
    throw new GitError("start", "commit-tree", `Not a commit ${what}`)
  }
  return value
}

/**
 * Whether a path part is one Git refuses to check out, in any case, with
 * the spellings Windows and macOS file systems read as the same name (Git's
 * `verify_path`): `.git`, `.git.`, `.git ` and `git~1`.
 */
function isGitFolder(part: string): boolean {
  const name = part.toLowerCase().replace(/[. ]+$/, "")
  return name === ".git" || name === "git~1"
}

/** Refuses a commit's files Git or its clients would not take. */
function checkFiles(files: readonly CommitFile[]): void {
  const seen = new Set<string>()
  for (const file of files) {
    treePath(file.path)
    if (file.path.endsWith("/") || seen.has(file.path)) {
      throw new GitError(
        "start",
        "update-index",
        "Each file needs its own path",
      )
    }
    const parts = file.path.split("/")
    if (parts.some(isGitFolder)) {
      throw new GitError(
        "start",
        "update-index",
        "A path cannot hold a .git folder",
      )
    }
    if (
      parts.at(-1)!.toLowerCase().startsWith(".gitmodules") &&
      (file.mode ?? "100644") === "120000"
    ) {
      throw new GitError(
        "start",
        "update-index",
        ".gitmodules cannot be a symbolic link",
      )
    }
    seen.add(file.path)
  }
}

/**
 * Writes the blobs, trees and a commit holding exactly `files`, with
 * `parents`, and returns the commit's ID. Moves no ref. It uses a temporary
 * index, so it works in a bare repository, and four Git processes whatever
 * the number of files (`fast-import` for the blobs).
 */
export async function writeCommit(
  git: Git,
  gitDir: string,
  input: {
    files: readonly CommitFile[]
    message: string
    identity: CommitIdentity
    parents?: readonly string[]
    /**
     * Where the files' bytes are staged for Git, briefly. Default: the
     * system's temporary folder, which in a container may be memory.
     */
    temporaryDir?: string
  },
): Promise<string> {
  const parents = input.parents ?? []
  if (!parents.every(isObjectId)) {
    throw new GitError("start", "commit-tree", "Parents are full object IDs")
  }
  checkFiles(input.files)
  const time = `${input.identity.time ?? Math.floor(Date.now() / 1000)} +0000`
  const name = identityPart(input.identity.name, "name")
  const email = identityPart(input.identity.email, "email address")
  const folder = mkdtempSync(
    join(input.temporaryDir ?? tmpdir(), "shinan-git-index-"),
  )
  const env = {
    GIT_INDEX_FILE: join(folder, "index"),
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_AUTHOR_DATE: time,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
    GIT_COMMITTER_DATE: time,
  }
  const text = async (args: string[], stdin?: string | Uint8Array) =>
    (await git.run(args, { gitDir, env, input: stdin })).stdout
      .toString("utf8")
      .trim()
  try {
    // Every blob through one `git fast-import`, which writes them as one
    // pack (synced once, as `core.fsync` asks) rather than one file each,
    // and reports their IDs in a marks file.
    const oids: string[] = []
    if (input.files.length > 0) {
      const parts: Buffer[] = []
      input.files.forEach((file, i) => {
        const content = Buffer.from(file.content)
        parts.push(
          Buffer.from(`blob\nmark :${i + 1}\ndata ${content.length}\n`),
          content,
          Buffer.from("\n"),
        )
      })
      const marks = join(folder, "marks")
      await git.run(["fast-import", "--quiet", `--export-marks=${marks}`], {
        gitDir,
        env,
        input: Buffer.concat(parts),
      })
      const byMark = new Map<number, string>()
      for (const line of readFileSync(marks, "utf8").split("\n")) {
        const match = /^:(\d+) ([0-9a-f]+)$/.exec(line)
        if (match) byMark.set(Number(match[1]), match[2]!)
      }
      input.files.forEach((_, i) => oids.push(byMark.get(i + 1) ?? ""))
    }
    if (oids.length !== input.files.length || !oids.every(isObjectId)) {
      throw new GitError(
        "exit",
        "fast-import",
        "git fast-import gave an answer Shinan cannot read",
      )
    }
    const entries = input.files.map(
      (file, i) => `${file.mode ?? "100644"} ${oids[i]}\t${file.path}`,
    )
    if (entries.length > 0) {
      await text(
        ["update-index", "--add", "-z", "--index-info"],
        `${entries.join("\0")}\0`,
      )
    }
    const tree = await text(["write-tree"])
    // Git drops a path it will not take (`update-index` says "Ignoring
    // path" and goes on), so the tree must hold exactly the files asked for.
    const listed = await git
      .run(["ls-tree", "-r", "-z", "--full-tree", "--name-only", tree], {
        gitDir,
      })
      .catch((error: unknown) => {
        if (
          error instanceof GitError &&
          /exceeded maximum allowed tree depth/.test(error.stderr)
        ) {
          throw new GitError(
            "start",
            "ls-tree",
            "A path is deeper than Git reads (2,048 levels)",
          )
        }
        throw error
      })
    const written = new Set(
      listed.stdout.toString("utf8").split("\0").filter(Boolean),
    )
    const dropped = input.files.filter((file) => !written.has(file.path))
    if (dropped.length > 0 || written.size !== input.files.length) {
      throw new GitError(
        "start",
        "update-index",
        `Git does not take ${dropped.length === 1 ? "this path" : "these paths"}: ${dropped
          .slice(0, 5)
          .map((f) => JSON.stringify(f.path))
          .join(", ")}`,
      )
    }
    return await text(
      [
        "commit-tree",
        ...parents.flatMap((parent) => ["-p", parent]),
        "-F",
        "-",
        tree,
      ],
      input.message,
    )
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}

/**
 * Git's own check of every object in the repository (`git fsck --strict`):
 * the error codes it reports, such as `hasDotgit` (a path Windows or macOS
 * reads as `.git`) or `gitmodulesSymlink`, or none. Shinan lets Git decide
 * these rules rather than copying them.
 */
export async function checkObjects(
  git: Git,
  gitDir: string,
): Promise<string[]> {
  const result = await git.run(
    ["fsck", "--strict", "--no-dangling", "--no-progress", "--full"],
    { gitDir, okExitCodes: Array.from({ length: 256 }, (_, i) => i) },
  )
  if (result.exitCode === 0) return []
  const codes = [
    ...new Set(
      [...result.stderr.matchAll(/^error in \w+ [0-9a-f]+: (\w+):/gm)].map(
        (m) => m[1]!,
      ),
    ),
  ]
  return codes.length > 0 ? codes : ["fsckFailed"]
}
