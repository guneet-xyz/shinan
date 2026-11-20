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

/** A document on `main`: its path and the Git blob ID of its text. */
export interface TreeDocument {
  path: string
  blob: string
}

/** The documents of a commit's tree, by path. */
export async function listDocuments(
  git: GitClient,
  workspaceId: string,
  commit: string,
): Promise<TreeDocument[]> {
  const { entries } = await git.listTree(workspaceId, { commit })
  return entries
    .filter((e) => e.type === "blob" && isDocumentPath(e))
    .map((e) => ({ path: e.path, blob: e.oid }))
    .sort((a, b) => compare(a.path, b.path))
}

/**
 * A document's text, or why it has none: larger than the Git container
 * reads (1 MiB, far over the 64 KiB a document may hold).
 */
export type DocumentText =
  | { path: string; blob: string; text: string }
  | { path: string; blob: string; tooLarge: number }

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
  const result: DocumentText[] = []
  const batch = Math.min(readBatch, maxDocumentsPerRead)
  for (let i = 0; i < documents.length; i += batch) {
    const wanted = documents.slice(i, i + batch)
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
        result.push({ path, blob, tooLarge: found.size })
        continue
      }
      if (found.oid !== blob)
        throw new Error(`Commit ${commit} holds another text at ${path}`)
      result.push({ path, blob, text: decode(found.content) })
    }
  }
  return result
}

const decoder = new TextDecoder("utf-8")

function decode(bytes: Uint8Array): string {
  return decoder.decode(bytes).replaceAll("\u0000", "\uFFFD")
}

/** Orders paths by their UTF-16 code units, as JavaScript and the rows do. */
export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
