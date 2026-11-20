import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs"
import { join } from "node:path"

import {
  maxChangesPerCommit,
  maxDocumentsPerRead,
  maxDocumentsResponseBytes,
  maxFileBytes,
  maxHistoryPage,
  maxHistorySkip,
  maxTreeEntries,
} from "@shinan/core"
import type {
  CommitInfo,
  CommitRef,
  DocumentRead,
  RepositoryFile,
  GitTreeChange as TreeChange,
  GitTreeEntry as TreeEntry,
} from "@shinan/core"
import {
  changedPaths,
  checkObjects,
  diffTrees,
  GitError,
  history,
  hooksDirectory as imageHooks,
  isObjectId,
  listTree,
  objectName,
  openCatFile,
  writeCommit,
} from "@shinan/git"
import type { Git } from "@shinan/git"

/** A request the store refuses: its answer is 400 or 404. */
export class StoreError extends Error {
  override name = "StoreError"
  constructor(
    readonly status: 400 | 404 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** Who Shinan's own commits name (a repository's first commit). */
export const shinanIdentity = { name: "Shinan", email: "shinan@shinan.invalid" }

/**
 * Shinan's configuration of every repository it creates (Git-based catalog
 * plan §2.2, item 7). Agents cannot change it: a push changes refs and
 * objects, never `config` or hooks.
 */
export function repositoryConfiguration(
  hooksDirectory: string,
): [string, string][] {
  return [
    // Shinan's hooks, read-only in the image; nothing in the repository.
    ["core.hooksPath", hooksDirectory],
    // Every object received is checked.
    ["receive.fsckObjects", "true"],
    ["transfer.fsckObjects", "true"],
    // The push body limit (plan §2.10), also enforced by `web`.
    ["receive.maxInputSize", String(64 * 1024 * 1024)],
    // For `git push -o check-only` (plan §2.5).
    ["receive.advertisePushOptions", "true"],
    // Committed objects and refs reach the disk before a push is answered.
    ["core.fsync", "committed"],
    ["core.fsyncMethod", "fsync"],
    // Nothing unreachable can be fetched, such as what a purge removed.
    ["uploadpack.allowAnySHA1InWant", "false"],
    ["uploadpack.allowReachableSHA1InWant", "false"],
    ["uploadpack.allowTipSHA1InWant", "false"],
    // The pre-receive hook decides per branch (plan §2.8).
    ["receive.denyNonFastForwards", "false"],
    ["receive.denyDeletes", "false"],
    // Modest packing for a two-core host.
    ["pack.threads", "1"],
    ["pack.windowMemory", "64m"],
    // `gc --auto` after a push runs inside the request, its process group
    // and its time limit, never detached from them.
    ["gc.autoDetach", "false"],
    // No reflogs: a purge must leave no copy behind (plan §2.9).
    ["core.logAllRefUpdates", "false"],
  ]
}

const workspaceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** fsyncs a folder, so a rename into it is on disk. */
function syncFolder(path: string): void {
  const fd = openSync(path, "r")
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

export interface RepositoryStore {
  readonly root: string
  /** The workspace's repository folder; refuses anything but a workspace ID. */
  pathOf(workspaceId: string): string
  /** `main`'s commit, or `null` if the workspace has no repository. */
  main(workspaceId: string): Promise<string | null>
  create(
    workspaceId: string,
    input: { files: RepositoryFile[]; message: string },
  ): Promise<{ created: boolean; main: string }>
  listTree(
    workspaceId: string,
    input: { commit: CommitRef; path?: string; recursive?: boolean },
  ): Promise<{ commit: string; entries: TreeEntry[]; truncated: boolean }>
  /**
   * The documents at `paths` in a commit, read one at a time as they are
   * taken from `documents`; ending it early (`return()`) stops the read.
   */
  openDocuments(
    workspaceId: string,
    input: { commit: CommitRef; paths: string[] },
  ): Promise<{ commit: string; documents: AsyncGenerator<DocumentRead> }>
  diff(
    workspaceId: string,
    input: { from: string | null; to: CommitRef },
  ): Promise<{
    from: string | null
    to: string
    changes: TreeChange[]
    truncated: boolean
  }>
  history(
    workspaceId: string,
    input: { commit: CommitRef; path?: string; limit: number; skip?: number },
  ): Promise<{ commit: string; commits: CommitInfo[] }>
}

/**
 * The repositories on the Git container's volume: `<workspace ID>.git`, one
 * bare repository per workspace (plan §2.4). New repositories are made in
 * `.tmp/` on the same volume and renamed into place, so a repository either
 * exists whole, with its configuration and first commit, or not at all.
 */
export function createRepositoryStore(options: {
  root: string
  git: Git
  hooksDirectory?: string
  /** The most document bytes one read returns; default `maxDocumentsResponseBytes`. */
  maxResponseBytes?: number
  /** The most entries one tree listing or diff returns; default `maxTreeEntries`. */
  maxEntries?: number
}): RepositoryStore {
  const { root, git } = options
  const maxResponseBytes = options.maxResponseBytes ?? maxDocumentsResponseBytes
  const maxEntries = options.maxEntries ?? maxTreeEntries
  const hooks = options.hooksDirectory ?? imageHooks
  const temporary = join(root, ".tmp")
  const creating = new Map<
    string,
    Promise<{ created: boolean; main: string }>
  >()

  const pathOf = (workspaceId: string) => {
    if (!workspaceIdPattern.test(workspaceId)) {
      throw new StoreError(404, "not-found", "Not found")
    }
    return join(root, `${workspaceId}.git`)
  }

  const exists = (gitDir: string) => {
    try {
      return statSync(gitDir).isDirectory()
    } catch {
      return false
    }
  }

  const main = async (workspaceId: string) => {
    const gitDir = pathOf(workspaceId)
    if (!exists(gitDir)) return null
    const { stdout, exitCode } = await git.run(
      [
        "rev-parse",
        "--verify",
        "--quiet",
        "--end-of-options",
        "refs/heads/main^{commit}",
      ],
      { gitDir, okExitCodes: [0, 1] },
    )
    return exitCode === 0 ? stdout.toString("utf8").trim() : null
  }

  /** A repository and one of its commits, by `main` or a full commit ID. */
  const resolve = async (workspaceId: string, commit: CommitRef) => {
    const gitDir = pathOf(workspaceId)
    if (!exists(gitDir)) throw new StoreError(404, "not-found", "Not found")
    if (commit === "main") {
      const head = await main(workspaceId)
      if (!head)
        throw new StoreError(404, "not-found", "The repository has no main")
      return { gitDir, commit: head }
    }
    if (!isObjectId(commit)) {
      throw new StoreError(
        400,
        "invalid-request",
        "A commit is main or a full commit ID",
      )
    }
    const { exitCode } = await git.run(
      [
        "rev-parse",
        "--verify",
        "--quiet",
        "--end-of-options",
        `${commit}^{commit}`,
      ],
      { gitDir, okExitCodes: [0, 1] },
    )
    if (exitCode !== 0) throw new StoreError(404, "not-found", "No such commit")
    return { gitDir, commit }
  }

  const createNew = async (
    workspaceId: string,
    input: { files: RepositoryFile[]; message: string },
  ) => {
    const target = pathOf(workspaceId)
    const existing = await main(workspaceId)
    if (existing) return { created: false, main: existing }
    if (input.files.length === 0) {
      throw new StoreError(
        400,
        "invalid-request",
        "A first commit needs at least one file",
      )
    }
    if (input.files.some((f) => f.content.length > maxFileBytes)) {
      throw new StoreError(
        400,
        "invalid-request",
        `A file is larger than ${maxFileBytes} bytes`,
      )
    }
    mkdirSync(temporary, { recursive: true, mode: 0o700 })
    const folder = mkdtempSync(join(temporary, "create-"))
    try {
      const gitDir = join(folder, "repository.git")
      await git.run([
        "init",
        "--quiet",
        "--bare",
        "--template=",
        "--initial-branch=main",
        "--object-format=sha1",
        gitDir,
      ])
      for (const [key, value] of repositoryConfiguration(hooks)) {
        await git.run(["config", key, value], { gitDir })
      }
      const commit = await writeCommit(git, gitDir, {
        files: input.files,
        message: input.message,
        identity: shinanIdentity,
        // On the volume, not in /tmp, which is memory in the container.
        temporaryDir: folder,
      })
      // Create only: the ref must not exist yet.
      await git.run(["update-ref", "refs/heads/main", commit, ""], { gitDir })
      // Git's own checks of every object, names included (`.git` in the
      // forms NTFS and HFS+ read as it): Shinan lets Git decide.
      const refused = await checkObjects(git, gitDir)
      if (refused.length > 0) {
        throw new StoreError(
          400,
          "invalid-files",
          `Git refuses these files (${refused.join(", ")})`,
        )
      }
      syncRepository(gitDir)
      try {
        renameSync(gitDir, target)
      } catch (error) {
        // Another request made it first.
        const head = await main(workspaceId)
        if (head) return { created: false, main: head }
        throw error
      }
      syncFolder(root)
      return { created: true, main: commit }
    } catch (error) {
      if (error instanceof GitError && error.kind === "start") {
        throw new StoreError(400, "invalid-request", error.message)
      }
      throw error
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  }

  return {
    root,
    pathOf,
    main,
    create(workspaceId, input) {
      pathOf(workspaceId)
      // One creation of a workspace's repository at a time in this process.
      const running = creating.get(workspaceId)
      if (running) return running.then(({ main }) => ({ created: false, main }))
      const started = createNew(workspaceId, input).finally(() =>
        creating.delete(workspaceId),
      )
      creating.set(workspaceId, started)
      return started
    },
    async listTree(workspaceId, input) {
      const { gitDir, commit } = await resolve(workspaceId, input.commit)
      const entries = await tooDeep(() =>
        listTree(git, gitDir, commit, {
          path: input.path,
          recursive: input.recursive,
          // One more than the cap shows there were more.
          limit: maxEntries + 1,
        }),
      )
      return {
        commit,
        entries: entries.slice(0, maxEntries),
        truncated: entries.length > maxEntries,
      }
    },
    async openDocuments(workspaceId, input) {
      if (input.paths.length > maxDocumentsPerRead) {
        throw new StoreError(
          400,
          "invalid-request",
          `At most ${maxDocumentsPerRead} documents a request`,
        )
      }
      const { gitDir, commit } = await resolve(workspaceId, input.commit)
      const names = input.paths.map((path) => ({
        path,
        name: objectName(commit, path),
      }))
      // One document at a time, as the caller asks for the next: an answer
      // streamed to a slow reader holds one document, not all of them.
      async function* documents(): AsyncGenerator<DocumentRead> {
        const reader = openCatFile(git, gitDir, {
          maxObjectBytes: maxFileBytes,
        })
        try {
          let budget = maxResponseBytes
          for (const { path, name } of names) {
            // The size from the object's header, before anything is inflated.
            const info = await reader.info(name)
            if (!info || info.type !== "blob") {
              yield { path, missing: true }
            } else if (info.size > maxFileBytes) {
              yield { path, tooLarge: true, size: info.size }
            } else if (info.size > budget) {
              // Past this response's budget: the caller asks again.
              budget = 0
              yield { path, deferred: true, size: info.size }
            } else {
              budget -= info.size
              const object = await reader.read(info.oid)
              if (typeof object === "string") yield { path, missing: true }
              else
                yield {
                  path,
                  oid: object.oid,
                  size: object.size,
                  content: object.content,
                }
            }
          }
        } finally {
          await reader.close()
        }
      }
      return { commit, documents: documents() }
    },
    async diff(workspaceId, input) {
      const { gitDir, commit: to } = await resolve(workspaceId, input.to)
      const from =
        input.from === null
          ? null
          : (await resolve(workspaceId, input.from)).commit
      const changes = await tooDeep(() =>
        diffTrees(git, gitDir, from, to, { limit: maxEntries + 1 }),
      )
      return {
        from,
        to,
        changes: changes.slice(0, maxEntries),
        truncated: changes.length > maxEntries,
      }
    },
    async history(workspaceId, input) {
      if ((input.skip ?? 0) > maxHistorySkip) {
        throw new StoreError(
          400,
          "invalid-request",
          `A page can skip at most ${maxHistorySkip} commits`,
        )
      }
      if (input.limit < 1 || input.limit > maxHistoryPage) {
        throw new StoreError(
          400,
          "invalid-request",
          `A page holds 1 to ${maxHistoryPage} commits`,
        )
      }
      const { gitDir, commit } = await resolve(workspaceId, input.commit)
      // Each commit is read only up to 256 KiB (a longer message comes back
      // truncated), so a page of 100 stays small.
      // With each commit, the paths it changed: at most 50 kept per commit
      // as Git's output streams by, so a page stays small too.
      const commits = await tooDeep(() =>
        history(git, gitDir, commit, {
          limit: input.limit,
          skip: input.skip,
          path: input.path,
          maxCommitBytes: maxCommitBytes,
        }),
      )
      const changes = await tooDeep(() =>
        changedPaths(
          git,
          gitDir,
          commits.map((c) => c.oid),
          { maxPerCommit: maxChangesPerCommit },
        ),
      )
      return {
        commit,
        commits: commits.map(
          ({ oid, parents, author, committer, message, truncated }) => {
            const changed = changes.get(oid)
            return {
              oid,
              parents,
              author,
              committer,
              message,
              truncated,
              changes: changed?.changes ?? [],
              changeCount: changed?.count ?? 0,
              changesTruncated: changed?.truncated ?? false,
            }
          },
        ),
      }
    },
  }
}

/**
 * Runs a read, and turns Git's refusal of a tree deeper than its
 * `core.maxTreeDepth` (2,048) into a 422: the content, not Shinan, is at
 * fault.
 */
async function tooDeep<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    if (
      error instanceof GitError &&
      /exceeded maximum allowed tree depth/.test(
        `${error.stderr}\n${error.message}`,
      )
    ) {
      throw new StoreError(
        422,
        "tree-too-deep",
        "A tree here is deeper than Git reads (2,048 levels)",
      )
    }
    throw error
  }
}

/** The most of one commit a history page reads: 256 KiB. */
export const maxCommitBytes = 256 * 1024

/**
 * fsyncs a new repository's files and folders, so its configuration (and
 * with it `core.hooksPath`), `HEAD` and refs survive a power loss once it
 * is renamed into place. Loose objects are left out: Git synced them as it
 * wrote them (`core.fsync`), and there may be many.
 */
function syncRepository(gitDir: string): void {
  const visit = (path: string, objects: boolean) => {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) return
    if (stat.isDirectory()) {
      for (const name of readdirSync(path)) {
        visit(
          join(path, name),
          objects || (path === gitDir && name === "objects"),
        )
      }
    } else if (objects) {
      return
    }
    const fd = openSync(path, "r")
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  }
  visit(gitDir, false)
}

/** Removes what an interrupted creation left in `.tmp/`. */
export function cleanTemporary(root: string): void {
  const temporary = join(root, ".tmp")
  let names: string[]
  try {
    names = readdirSync(temporary)
  } catch {
    return
  }
  for (const name of names)
    rmSync(join(temporary, name), { recursive: true, force: true })
}
