import { maxDocumentsPerRead } from "../git/api.js"
import type { TreeEntry } from "../git/api.js"
import type { GitClient } from "../git/client.js"

/**
 * Reading `main` for the index, through the Git container's read API
 * (Git-based catalog plan §2.2, §2.7). Nothing here runs `git`; every read
 * names a full commit ID, so one build reads one tree however `main` moves
 * meanwhile.
 */

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
): Promise<TreeDocument[]> {
  const { entries } = await git.listTree(workspaceId, { commit })
  const documents = entries
    .filter((e) => e.type === "blob" && isDocumentPath(e))
    .map((e) => ({ path: e.path, blob: e.oid }))
    .sort((a, b) => compare(a.path, b.path) || compare(a.blob, b.blob))
  return documents.filter((d, i) => documents[i - 1]?.path !== d.path)
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
 * hold is an error: `main` moved under a read that named it.
 */
export async function readTexts(
  git: GitClient,
  workspaceId: string,
  commit: string,
  documents: readonly TreeDocument[],
): Promise<DocumentText[]> {
  const result = new Map<string, DocumentText>()
  const readable: TreeDocument[] = []
  for (const d of documents)
    if (isReadablePath(d.path)) readable.push(d)
    else result.set(d.path, { ...d, unreadablePath: true })
  const batch = Math.min(readBatch, maxDocumentsPerRead)
  for (let i = 0; i < readable.length; i += batch) {
    const wanted = readable.slice(i, i + batch)
    const read = await git.readDocuments(workspaceId, {
      commit,
      paths: wanted.map((d) => d.path),
    })
    const byPath = new Map(read.documents.map((d) => [d.path, d]))
    for (const { path, blob } of wanted) {
      const found = byPath.get(path)
      if (!found || "missing" in found)
        throw new Error(`Commit ${commit} has no document at ${path}`)
      if ("tooLarge" in found) {
        result.set(path, { path, blob, tooLarge: found.size })
        continue
      }
      if (found.oid !== blob)
        throw new Error(`Commit ${commit} holds another text at ${path}`)
      result.set(path, { path, blob, text: decode(found.content) })
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
