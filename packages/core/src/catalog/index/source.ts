import { setTimeout as sleep } from "node:timers/promises"

import { maxDocumentsPerRead } from "../git/api.js"
import type { TreeEntry } from "../git/api.js"
import { GitServiceError } from "../git/client.js"
import type { GitClient } from "../git/client.js"
import { IndexReadError } from "./failure.js"

/**
 * Reading `main` for the index, through the Git container's read API
 * (Git-based catalog plan §2.2, §2.7). Nothing here runs `git`; every read
 * names a full commit ID, so one build reads one tree however `main` moves
 * meanwhile.
 */

/**
 * How long to wait before asking again when the Git container answers
 * `503 busy` (its read queue is full): about 15 seconds in all, then the
 * error stands and the index job is retried later by the job queue.
 */
export const busyWaitsMs = [500, 1000, 2000, 4000, 8000] as const

/** `read()`, asked again while the Git container is busy. */
export async function whenNotBusy<T>(
  read: () => Promise<T>,
  waits: readonly number[] = busyWaitsMs,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await read()
    } catch (error) {
      const wait = waits[attempt]
      if (
        !(error instanceof GitServiceError && error.status === 503) ||
        wait === undefined
      )
        throw error
      await sleep(wait)
    }
  }
}

/**
 * Whether a file on `main` is a catalog document the index reads: a
 * regular file whose name ends in `.md`, except the root `README.md`,
 * which is free Markdown for people opening the clone (plan §2.1). Other
 * files never reach `main` once pushes are checked (GC-3); until then they
 * are left out rather than read.
 */
export function isDocumentPath(entry: Pick<TreeEntry, "path" | "mode">) {
  return (
    (entry.mode === "100644" || entry.mode === "100755") &&
    entry.path.endsWith(".md") &&
    entry.path !== "README.md"
  )
}

/**
 * Whether the Git container can read a file by this name: Git paths are
 * bytes, but the read API names files as text without control characters
 * (`packages/git`'s `treePath`), and a name that is not UTF-8 reaches Shinan
 * with U+FFFD in place of its bytes, so it names no file. Such names never
 * reach `main` once pushes are checked (GC-3b); until then the index
 * records them without reading them, so one cannot stop it.
 */
export function isReadablePath(path: string): boolean {
  if (path.startsWith("/") || path.includes("\uFFFD")) return false
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return false
  }
  return path.split("/").every((p) => p !== "" && p !== "." && p !== "..")
}

/** A document on `main`: its path and the Git blob ID of its text. */
export interface TreeDocument {
  path: string
  blob: string
}

/**
 * The documents of a commit's tree, by path. Two names that are not UTF-8
 * can reach Shinan as the same path; it is listed once, with the lowest
 * blob ID, and recorded as unreadable either way.
 */
export async function listDocuments(
  git: GitClient,
  workspaceId: string,
  commit: string,
  waits: readonly number[] = busyWaitsMs,
): Promise<TreeDocument[]> {
  const entries = await listFiles(git, workspaceId, commit, waits)
  const documents = entries
    .filter((e) => e.type === "blob" && isDocumentPath(e))
    .map((e) => ({ path: e.path, blob: e.oid }))
    .sort((a, b) => compare(a.path, b.path) || compare(a.blob, b.blob))
  return documents.filter((d, i) => documents[i - 1]?.path !== d.path)
}

/**
 * Every file of a commit's tree. One listing holds at most the Git
 * container's `maxTreeEntries` and `maxTreePathBytes`; past them it is
 * `truncated`, and the tree is listed folder by folder instead: each folder
 * whole if it fits, otherwise its entries one level down. A single folder
 * too large to list even one level down is an error, as is a tree the Git
 * container refuses (`422 tree-too-large`, `tree-too-deep`): pushes to
 * `main` cannot bring either once they are checked (GC-3), and until then
 * the index stays behind, saying so, rather than leave files out.
 */
async function listFiles(
  git: GitClient,
  workspaceId: string,
  commit: string,
  waits: readonly number[],
): Promise<TreeEntry[]> {
  const list = (path: string | undefined, recursive: boolean) =>
    whenNotBusy(
      () =>
        git.listTree(workspaceId, {
          commit,
          ...(path === undefined ? {} : { path }),
          ...(recursive ? {} : { recursive: false }),
        }),
      waits,
    )
  const whole = await list(undefined, true)
  if (!whole.truncated) return whole.entries
  const files: TreeEntry[] = []
  const walk = async (folder: string | undefined): Promise<void> => {
    const level = await list(folder, false)
    if (level.truncated)
      throw new IndexReadError(
        "folder-too-large",
        `Folder ${folder ?? "/"} of commit ${commit} has more entries than the Git container lists`,
      )
    for (const entry of level.entries) {
      if (entry.type !== "tree") {
        files.push(entry)
        continue
      }
      const inside = await list(`${entry.path}/`, true)
      if (inside.truncated) await walk(`${entry.path}/`)
      else files.push(...inside.entries)
    }
  }
  await walk(undefined)
  return files
}

/**
 * A document's text, or why it has none: larger than the Git container
 * reads (1 MiB, far over the 64 KiB a document may hold), or a name it
 * cannot read (`isReadablePath`).
 */
export type DocumentText =
  | { path: string; blob: string; text: string }
  | { path: string; blob: string; tooLarge: number }
  | { path: string; blob: string; unreadablePath: true }

/** How many documents one read asks the Git container for. */
const readBatch = 200

/**
 * The texts of documents at a commit, in the order asked. Bytes that are
 * not UTF-8 read as U+FFFD, as does a NUL character, which PostgreSQL
 * cannot store: such a document then reads with problems instead of
 * stopping the index. A blob that `blobs` expects and the commit does not
 * hold is an error: `main` moved under a read that named it. Documents a
 * read `deferred` (past the Git container's bytes for one answer) are asked
 * for again, until each is read.
 */
export async function readTexts(
  git: GitClient,
  workspaceId: string,
  commit: string,
  documents: readonly TreeDocument[],
  waits: readonly number[] = busyWaitsMs,
): Promise<DocumentText[]> {
  const result = new Map<string, DocumentText>()
  const readable: TreeDocument[] = []
  for (const d of documents)
    if (isReadablePath(d.path)) readable.push(d)
    else result.set(d.path, { ...d, unreadablePath: true })
  const batch = Math.min(readBatch, maxDocumentsPerRead)
  for (let i = 0; i < readable.length; i += batch) {
    let wanted = readable.slice(i, i + batch)
    while (wanted.length > 0) {
      const asked = wanted
      const read = await whenNotBusy(
        () =>
          git.readDocuments(workspaceId, {
            commit,
            paths: asked.map((d) => d.path),
          }),
        waits,
      )
      const byPath = new Map(read.documents.map((d) => [d.path, d]))
      const deferred: TreeDocument[] = []
      for (const { path, blob } of asked) {
        const found = byPath.get(path)
        if (!found || "missing" in found)
          throw new Error(`Commit ${commit} has no document at ${path}`)
        if ("deferred" in found) {
          deferred.push({ path, blob })
          continue
        }
        if ("tooLarge" in found) {
          result.set(path, { path, blob, tooLarge: found.size })
          continue
        }
        if (found.oid !== blob)
          throw new Error(`Commit ${commit} holds another text at ${path}`)
        result.set(path, { path, blob, text: decode(found.content) })
      }
      // Each answer holds at least one document, so this always moves on;
      // one that holds none would ask for the same forever.
      if (deferred.length === asked.length)
        throw new IndexReadError(
          "deferred-none",
          `The Git container deferred every document of a read at ${commit}`,
        )
      wanted = deferred
    }
  }
  return documents.map((d) => result.get(d.path)!)
}

const decoder = new TextDecoder("utf-8")

function decode(bytes: Uint8Array): string {
  return decoder.decode(bytes).replaceAll("\u0000", "\uFFFD")
}

/** Orders paths by their UTF-16 code units, as JavaScript and the rows do. */
export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
