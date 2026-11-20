import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Git } from "./run.js"

/** A file of a commit made by {@link commitFiles}. */
export type FixtureFile =
  | string
  | { content: string | Uint8Array; mode?: "100644" | "100755" | "120000" }

/** Fixed identities and times, so object IDs are the same on every run. */
export function fixtureIdentity(time = 1_790_000_000): Record<string, string> {
  return {
    GIT_AUTHOR_NAME: "Fixture Author",
    GIT_AUTHOR_EMAIL: "author@example.com",
    GIT_AUTHOR_DATE: `${time} +0000`,
    GIT_COMMITTER_NAME: "Fixture Committer",
    GIT_COMMITTER_EMAIL: "committer@example.com",
    GIT_COMMITTER_DATE: `${time} +0000`,
  }
}

/**
 * A new, empty bare repository in a temporary folder. `remove` deletes the
 * folder.
 */
export async function createFixtureRepository(
  git: Git,
): Promise<{ gitDir: string; remove: () => void }> {
  const folder = mkdtempSync(join(tmpdir(), "shinan-git-test-"))
  const gitDir = join(folder, "repository.git")
  await git.run([
    "init",
    "--quiet",
    "--bare",
    "--template=",
    "--initial-branch=main",
    gitDir,
  ])
  return {
    gitDir,
    remove: () => rmSync(folder, { recursive: true, force: true }),
  }
}

/**
 * Writes a commit holding exactly `files`, with `parents`, and moves `ref`
 * to it if given. Uses a temporary index, so it works in a bare repository.
 */
export async function commitFiles(
  git: Git,
  gitDir: string,
  files: Record<string, FixtureFile>,
  options: {
    parents?: string[]
    message?: string
    ref?: string
    time?: number
  } = {},
): Promise<string> {
  const folder = mkdtempSync(join(tmpdir(), "shinan-git-index-"))
  const env = {
    ...fixtureIdentity(options.time),
    GIT_INDEX_FILE: join(folder, "index"),
  }
  try {
    for (const [path, file] of Object.entries(files)) {
      const { content, mode = "100644" } =
        typeof file === "string" ? { content: file } : file
      const { stdout } = await git.run(["hash-object", "-w", "--stdin"], {
        gitDir,
        input: content,
      })
      await git.run(
        [
          "update-index",
          "--add",
          "--cacheinfo",
          `${mode},${stdout.toString().trim()},${path}`,
        ],
        { gitDir, env },
      )
    }
    const tree = (await git.run(["write-tree"], { gitDir, env })).stdout
      .toString()
      .trim()
    const commit = (
      await git.run(
        [
          "commit-tree",
          ...(options.parents ?? []).flatMap((parent) => ["-p", parent]),
          "-m",
          options.message ?? "Fixture commit",
          tree,
        ],
        { gitDir, env },
      )
    ).stdout
      .toString()
      .trim()
    if (options.ref)
      await git.run(["update-ref", options.ref, commit], { gitDir })
    return commit
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}
