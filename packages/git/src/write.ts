import { mkdtempSync, rmSync } from "node:fs"
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
 * Writes the blobs, trees and a commit holding exactly `files`, with
 * `parents`, and returns the commit's ID. Moves no ref. It uses a temporary
 * index, so it works in a bare repository.
 */
export async function writeCommit(
  git: Git,
  gitDir: string,
  input: {
    files: readonly CommitFile[]
    message: string
    identity: CommitIdentity
    parents?: readonly string[]
  },
): Promise<string> {
  const parents = input.parents ?? []
  if (!parents.every(isObjectId)) {
    throw new GitError("start", "commit-tree", "Parents are full object IDs")
  }
  const seen = new Set<string>()
  for (const file of input.files) {
    treePath(file.path)
    if (file.path.endsWith("/") || seen.has(file.path)) {
      throw new GitError(
        "start",
        "update-index",
        "Each file needs its own path",
      )
    }
    seen.add(file.path)
  }
  const time = `${input.identity.time ?? Math.floor(Date.now() / 1000)} +0000`
  const name = identityPart(input.identity.name, "name")
  const email = identityPart(input.identity.email, "email address")
  const folder = mkdtempSync(join(tmpdir(), "shinan-git-index-"))
  const env = {
    GIT_INDEX_FILE: join(folder, "index"),
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_AUTHOR_DATE: time,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
    GIT_COMMITTER_DATE: time,
  }
  const text = async (args: string[], input?: string | Uint8Array) =>
    (await git.run(args, { gitDir, env, input })).stdout.toString("utf8").trim()
  try {
    // One `update-index --index-info` for every file, so a commit of many
    // files starts few processes.
    const entries: string[] = []
    for (const file of input.files) {
      const oid = await text(["hash-object", "-w", "--stdin"], file.content)
      entries.push(`${file.mode ?? "100644"} ${oid}\t${file.path}`)
    }
    await text(
      ["update-index", "--add", "-z", "--index-info"],
      `${entries.join("\0")}\0`,
    )
    const tree = await text(["write-tree"])
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
