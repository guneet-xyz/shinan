import { createHash } from "node:crypto"

import { refuseDuringTransactions } from "@shinan/db"

import type {
  CommitInfo,
  CommitRef,
  DocumentRead,
  TreeChange,
  TreeEntry,
} from "../src/catalog/git/api.js"
import { GitServiceError } from "../src/catalog/git/client.js"
import type { GitClient } from "../src/catalog/git/client.js"

/**
 * An in-memory stand-in for the Git container's read API, for tests of
 * what reads `main` through `GitClient` (the index). Object IDs are real
 * Git blob IDs for files, so the same text always has the same ID; commit
 * IDs are made up but unique. Errors are the Git container's: an unknown
 * repository or commit is `404 not-found`. Like the real client in tests,
 * it refuses to be called while a database transaction is open
 * (`refuseDuringTransactions`). The real API is exercised against real Git
 * in `apps/server`.
 */
export interface MemoryGit extends GitClient {
  /** Makes the workspace's repository with one commit holding `files`. */
  create(workspaceId: string, files?: Record<string, FileContent>): string
  /**
   * Commits on `main`: each path set to new content, or deleted with
   * `null`. Returns the new commit, which `main` then points at.
   */
  push(
    workspaceId: string,
    changes: Record<string, FileContent | null>,
    message?: string,
  ): string
  /** Points `main` at another commit, as a forced update or a purge would. */
  setMain(workspaceId: string, commit: string): void
  /** Forgets a commit, as a purge's history rewrite does. */
  forget(workspaceId: string, commit: string): void
  /** The files of a commit, by path. */
  files(workspaceId: string, commit: string): Map<string, Uint8Array>
  /** What has been asked of it: paths read, diffs and tree listings. */
  calls: { pathsRead: string[]; diffs: number; trees: number }
  /**
   * The Git container's limits, small for tests: the entries one listing
   * or diff holds before it is `truncated`, the document bytes one read
   * returns before the rest are `deferred` (at least one is always
   * returned), and how many more requests answer `503 busy`.
   */
  limits: {
    treeEntries: number
    diffChanges: number
    documentBytes: number
    busy: number
  }
}

export type FileContent =
  | string
  | Uint8Array
  | { content: string | Uint8Array; mode: "100644" | "100755" | "120000" }

interface File {
  mode: string
  oid: string
}

interface Repository {
  main: string
  commits: Map<string, Map<string, File>>
  /** Each commit's parent (one: the memory client makes no merges). */
  parents: Map<string, string | null>
  messages: Map<string, string>
  /** Who made each: "Shinan" for a repository made through the client, else "Someone". */
  authors: Map<string, string>
  /** When each was made, in seconds since 1970: a minute apart. */
  times: Map<string, number>
}

const notFound = () => new GitServiceError(404, "not-found", "Not found")

export function blobId(content: Uint8Array): string {
  return createHash("sha1")
    .update(`blob ${content.length}\0`)
    .update(content)
    .digest("hex")
}

/** A promise of `f()`, rejected if it throws, as an HTTP call would be. */
function later<T>(f: () => T): Promise<T> {
  try {
    return Promise.resolve(f())
  } catch (error) {
    return Promise.reject(
      error instanceof Error ? error : new Error(String(error)),
    )
  }
}

const notHere = () =>
  Promise.reject(new Error("Not part of the memory Git client"))

export function createMemoryGit(): MemoryGit {
  const repositories = new Map<string, Repository>()
  const blobs = new Map<string, Uint8Array>()
  let made = 0
  const calls = { pathsRead: [] as string[], diffs: 0, trees: 0 }
  const limits = {
    treeEntries: Infinity,
    diffChanges: Infinity,
    documentBytes: Infinity,
    busy: 0,
  }
  const notBusy = () => {
    if (limits.busy <= 0) return
    limits.busy--
    throw new GitServiceError(503, "busy", "The Git container is busy")
  }

  const repository = (workspaceId: string) => {
    const found = repositories.get(workspaceId)
    if (!found) throw notFound()
    return found
  }
  const tree = (workspaceId: string, commit: CommitRef) => {
    const r = repository(workspaceId)
    const id = commit === "main" ? r.main : commit
    const files = r.commits.get(id)
    if (!files) throw notFound()
    return { id, files }
  }
  const store = (file: FileContent): File => {
    const { content, mode } =
      typeof file === "string" || file instanceof Uint8Array
        ? { content: file, mode: "100644" }
        : file
    const bytes =
      typeof content === "string" ? new TextEncoder().encode(content) : content
    const oid = blobId(bytes)
    blobs.set(oid, bytes)
    return { mode, oid }
  }
  const commit = (
    r: Repository,
    files: Map<string, File>,
    message = `Change ${made + 1}`,
    author = "Someone",
  ) => {
    made++
    const id = createHash("sha1")
      .update(`commit ${made} ${JSON.stringify([...files])}`)
      .digest("hex")
    r.commits.set(id, files)
    r.parents.set(id, r.main === "" ? null : r.main)
    r.messages.set(id, message)
    r.authors.set(id, author)
    r.times.set(id, 1_790_000_000 + made * 60)
    r.main = id
    return id
  }

  const client: MemoryGit = {
    calls,
    limits,
    create(workspaceId, files = { "README.md": "# Catalog\n" }) {
      const r: Repository = {
        main: "",
        commits: new Map(),
        parents: new Map(),
        messages: new Map(),
        authors: new Map(),
        times: new Map(),
      }
      repositories.set(workspaceId, r)
      return commit(
        r,
        new Map(Object.entries(files).map(([p, f]) => [p, store(f)])),
      )
    },
    push(workspaceId, changes, message) {
      const r = repository(workspaceId)
      const files = new Map(r.commits.get(r.main))
      for (const [path, file] of Object.entries(changes)) {
        if (file === null) files.delete(path)
        else files.set(path, store(file))
      }
      return commit(r, files, message)
    },
    setMain(workspaceId, id) {
      const r = repository(workspaceId)
      if (!r.commits.has(id)) throw notFound()
      r.main = id
    },
    forget(workspaceId, id) {
      repository(workspaceId).commits.delete(id)
    },
    files(workspaceId, id) {
      return new Map(
        [...tree(workspaceId, id).files].map(([p, f]) => [
          p,
          blobs.get(f.oid)!,
        ]),
      )
    },
    getRepository: (workspaceId) =>
      later(() => {
        notBusy()
        const r = repositories.get(workspaceId)
        return r ? { workspaceId, main: r.main } : null
      }),
    // As the Git container's: a first commit by Shinan, once.
    createRepository: (workspaceId, input) =>
      later(() => {
        notBusy()
        const existing = repositories.get(workspaceId)
        if (existing)
          return { workspaceId, main: existing.main, created: false }
        const r: Repository = {
          main: "",
          commits: new Map(),
          parents: new Map(),
          messages: new Map(),
          authors: new Map(),
          times: new Map(),
        }
        repositories.set(workspaceId, r)
        const main = commit(
          r,
          new Map(input.files.map((f) => [f.path, store(f.content)])),
          input.message,
          "Shinan",
        )
        return { workspaceId, main, created: true }
      }),
    listTree: (workspaceId, input) =>
      later(() => {
        notBusy()
        calls.trees++
        const { id, files } = tree(workspaceId, input.commit)
        // As `git ls-tree --full-tree [-r] -- <path>`: `folder/` lists what
        // is inside it; without `-r`, one level, folders as `tree` entries.
        const prefix = input.path ?? ""
        const entries: TreeEntry[] = []
        const folders = new Set<string>()
        for (const [path, f] of [...files].sort(([a], [b]) =>
          a < b ? -1 : 1,
        )) {
          if (!path.startsWith(prefix)) continue
          const slash = path.indexOf("/", prefix.length)
          if (input.recursive === false && slash >= 0) {
            const folder = path.slice(0, slash)
            if (!folders.has(folder)) {
              folders.add(folder)
              entries.push({
                path: folder,
                mode: "040000",
                type: "tree",
                oid: blobId(new TextEncoder().encode(folder)),
                size: null,
              })
            }
            continue
          }
          entries.push({
            path,
            mode: f.mode,
            type: "blob",
            oid: f.oid,
            size: blobs.get(f.oid)!.length,
          })
        }
        const truncated = entries.length > limits.treeEntries
        return {
          commit: id,
          entries: entries.slice(0, limits.treeEntries),
          truncated,
        }
      }),
    readDocuments: (workspaceId, input) =>
      later(() => {
        const { id, files } = tree(workspaceId, input.commit)
        // As the Git container: a name with a control character refuses
        // the whole request; a name that was not UTF-8 reaches Shinan with
        // U+FFFD in it, and so names no file.
        // eslint-disable-next-line no-control-regex -- control characters are what it looks for
        if (input.paths.some((p) => /[\u0000-\u001f\u007f]/.test(p)))
          throw new GitServiceError(
            400,
            "invalid-request",
            "Not a path in a repository",
          )
        notBusy()
        let bytes = 0
        const documents: DocumentRead[] = input.paths.map((path) => {
          const f = path.includes("\uFFFD") ? undefined : files.get(path)
          if (!f) return { path, missing: true }
          const content = blobs.get(f.oid)!
          if (content.length > 1024 * 1024)
            return { path, tooLarge: true, size: content.length }
          if (bytes > 0 && bytes + content.length > limits.documentBytes)
            return { path, deferred: true, size: content.length }
          bytes += content.length
          calls.pathsRead.push(path)
          return { path, oid: f.oid, size: content.length, content }
        })
        return { commit: id, documents }
      }),
    diff: (workspaceId, input) =>
      later(() => {
        notBusy()
        calls.diffs++
        const to = tree(workspaceId, input.to)
        const from =
          input.from === null
            ? new Map<string, File>()
            : tree(workspaceId, input.from).files
        const changes: TreeChange[] = []
        for (const path of [
          ...new Set([...from.keys(), ...to.files.keys()]),
        ].sort()) {
          const a = from.get(path)
          const b = to.files.get(path)
          if (a && b && a.oid === b.oid && a.mode === b.mode) continue
          changes.push({
            status: !a
              ? "added"
              : !b
                ? "deleted"
                : (a.mode === "120000") !== (b.mode === "120000")
                  ? "type-changed"
                  : "modified",
            path,
            oldMode: a?.mode ?? null,
            oldOid: a?.oid ?? null,
            newMode: b?.mode ?? null,
            newOid: b?.oid ?? null,
          })
        }
        return {
          from: input.from,
          to: to.id,
          changes: changes.slice(0, limits.diffChanges),
          truncated: changes.length > limits.diffChanges,
        }
      }),
    // As `git log <commit> [-- <path>]` on a history without merges: the
    // commits that changed the path, newest first.
    history: (workspaceId, input) =>
      later(() => {
        notBusy()
        const r = repository(workspaceId)
        const { id } = tree(workspaceId, input.commit)
        const commits: CommitInfo[] = []
        let skip = input.skip ?? 0
        for (
          let at: string | null = id;
          at !== null && commits.length < input.limit;
          at = r.parents.get(at) ?? null
        ) {
          const parent = r.parents.get(at) ?? null
          const before = parent === null ? undefined : r.commits.get(parent)
          const now = r.commits.get(at)!
          const changed = [
            ...new Set([...(before?.keys() ?? []), ...now.keys()]),
          ].filter((p) => before?.get(p)?.oid !== now.get(p)?.oid)
          if (input.path !== undefined && !changed.includes(input.path))
            continue
          if (skip > 0) {
            skip--
            continue
          }
          const name = r.authors.get(at) ?? "Someone"
          const who = {
            name,
            email: `${name.toLowerCase()}@example.com`,
            time: r.times.get(at)!,
            timezone: "+0000",
          }
          commits.push({
            oid: at,
            parents: parent === null ? [] : [parent],
            author: who,
            committer: who,
            message: r.messages.get(at)!,
            truncated: false,
            changes: changed.map((path) => ({
              status: !before?.has(path)
                ? "added"
                : now.has(path)
                  ? "modified"
                  : "deleted",
              path,
            })),
            changeCount: changed.length,
            changesTruncated: false,
            changeCountAtLeast: false,
          })
        }
        return { commit: id, commits }
      }),
    readJournal: notHere,
    acknowledgeJournal: notHere,
    listRefs: notHere,
    previewPurge: notHere,
    purge: notHere,
    smartHttp: () => {
      throw new Error("Not part of the memory Git client")
    },
  }
  return refuseDuringTransactions(client, "git")
}
