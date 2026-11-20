import { createContext, useContext, useEffect, useEffectEvent } from "react"

import type { CatalogTreeAnswer, CatalogTreeItem } from "@shinan/api-client"

import { useApi, useResource } from "./api"
import type { Resource } from "./api"

/**
 * The catalog's tree of the workspace the sidebar shows, shared by the
 * sidebar and the catalog's pages (which read the catalog's state from it:
 * being set up, catching up, ready).
 */
export interface CatalogTreeState {
  workspaceId: string
  tree: Resource<CatalogTreeAnswer>
}

export const CatalogTreeContext = createContext<CatalogTreeState | null>(null)

/** The tree of the workspace the sidebar shows, or null outside one. */
export function useCatalogTree(): CatalogTreeState | null {
  return useContext(CatalogTreeContext)
}

/** Where the catalog stands, from an index answer (catalog §12.4). */
export type CatalogState = "setting-up" | "catching-up" | "ready"

export function catalogState(answer: {
  catalog_commit: string | null
  index_behind: boolean
}): CatalogState {
  if (answer.index_behind) return "catching-up"
  return answer.catalog_commit === null ? "setting-up" : "ready"
}

/** How often the tree is read again while the catalog is not ready. */
const refreshMs = 3000

/**
 * Loads the tree of a workspace's catalog, again every few seconds while
 * the catalog is being set up or catching up, so pages update by
 * themselves.
 */
export function useCatalogTreeResource(
  workspaceId: string | undefined,
): Resource<CatalogTreeAnswer> | undefined {
  const api = useApi()
  const tree = useResource(`catalog-tree:${workspaceId ?? ""}`, () =>
    workspaceId
      ? api.catalogTree(workspaceId)
      : Promise.reject(new Error("No workspace")),
  )
  const waiting = tree.data !== undefined && catalogState(tree.data) !== "ready"
  const reload = useEffectEvent(tree.reload)
  useEffect(() => {
    if (!waiting) return
    const timer = setTimeout(reload, refreshMs)
    return () => clearTimeout(timer)
  }, [waiting, tree.data])
  return workspaceId ? tree : undefined
}

export interface Folder {
  name: string
  items: CatalogTreeItem[]
}

/** A file's folder: its path up to the last `/`, or "" at the root. */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf("/")
  return slash < 0 ? "" : path.slice(0, slash)
}

/**
 * The catalog's folders, each holding its pages by title (owner, D-064:
 * not by types). Folders are sorted by name with `schema` last; only the
 * folder holding the current page starts open. Pages that could not be
 * read are under Needs attention instead, and retired pages are found by
 * search.
 */
export function catalogFolders(items: readonly CatalogTreeItem[]): Folder[] {
  const byFolder = new Map<string, CatalogTreeItem[]>()
  for (const item of items) {
    if (item.id === null || item.status === "retired") continue
    const folder = folderOf(item.path)
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), item])
  }
  const title = (item: CatalogTreeItem) =>
    (item.title ?? item.id ?? item.path).toLocaleLowerCase()
  return [...byFolder]
    .map(([name, folderItems]) => ({
      name,
      items: folderItems.sort(
        (a, b) =>
          title(a).localeCompare(title(b)) || a.path.localeCompare(b.path),
      ),
    }))
    .sort((a, b) => {
      const rank = (f: Folder) =>
        f.name === "" ? 0 : f.name === "schema" ? 2 : 1
      return rank(a) - rank(b) || a.name.localeCompare(b.name)
    })
}
