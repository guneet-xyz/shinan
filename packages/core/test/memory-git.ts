import { createHash } from "node:crypto"

import type {
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
 * repository or commit is `404 not-found`. The real API is exercised
 * against real Git in `apps/server`.
 */
export interface MemoryGit extends GitClient {
  /** Makes the workspace's repository with one commit holding `files`. */
  create(workspaceId: string, files?: Record<string, FileContent>): string
  /**
   * Commits on `main`: each path set to new content, or deleted with
   * `null`. Returns the new commit, which `main` then points at.
   */
  push(workspaceId: string, changes: Record<string, FileContent | null>): string
  /** Points `main` at another commit, as a forced update or a purge would. */
  setMain(workspaceId: string, commit: string): void
  /** Forgets a commit, as a purge's history rewrite does. */
  forget(workspaceId: string, commit: string): void
  /** The files of a commit, by path. */
  files(workspaceId: string, commit: string): Map<string, Uint8Array>
  /** What has been asked of it: paths read, diffs and tree listings. */
  calls: { pathsRead: string[]; diffs: number; trees: number }
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
  const commit = (r: Repository, files: Map<string, File>) => {
    made++
    const id = createHash("sha1")
      .update(`commit ${made} ${JSON.stringify([...files])}`)
      .digest("hex")
    r.commits.set(id, files)
    r.main = id
    return id
  }

  return {
    calls,
    create(workspaceId, files = { "README.md": "# Catalog\n" }) {
      const r: Repository = { main: "", commits: new Map() }
      repositories.set(workspaceId, r)
      return commit(
        r,
        new Map(Object.entries(files).map(([p, f]) => [p, store(f)])),
      )
    },
    push(workspaceId, changes) {
      const r = repository(workspaceId)
      const files = new Map(r.commits.get(r.main))
      for (const [path, file] of Object.entries(changes)) {
        if (file === null) files.delete(path)
        else files.set(path, store(file))
      }
      return commit(r, files)
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
    getRepository(workspaceId) {
      const r = repositories.get(workspaceId)
      return Promise.resolve(r ? { workspaceId, main: r.main } : null)
    },
    createRepository: notHere,
    listTree: (workspaceId, input) =>
      later(() => {
        calls.trees++
        const { id, files } = tree(workspaceId, input.commit)
        const entries: TreeEntry[] = [...files]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([path, f]) => ({
            path,
            mode: f.mode,
            type: "blob",
            oid: f.oid,
            size: blobs.get(f.oid)!.length,
          }))
        return { commit: id, entries }
      }),
    readDocuments: (workspaceId, input) =>
      later(() => {
        const { id, files } = tree(workspaceId, input.commit)
        calls.pathsRead.push(...input.paths)
        const documents: DocumentRead[] = input.paths.map((path) => {
          const f = files.get(path)
          if (!f) return { path, missing: true }
          const content = blobs.get(f.oid)!
          if (content.length > 1024 * 1024)
            return { path, tooLarge: true, size: content.length }
          return { path, oid: f.oid, size: content.length, content }
        })
        return { commit: id, documents }
      }),
    diff: (workspaceId, input) =>
      later(() => {
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
        return { from: input.from, to: to.id, changes }
      }),
    history: notHere,
    readJournal: notHere,
    acknowledgeJournal: notHere,
  }
}
