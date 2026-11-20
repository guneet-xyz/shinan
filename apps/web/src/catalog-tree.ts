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

/**
 * Loads an answer of the agent index for a catalog page, kept in step with
 * the sidebar's tree: whether it says "Catching up" follows where the tree
 * says the catalog stands now, not where it stood when the page loaded; and
 * once the tree has moved to a newer commit, the page is read again (review
 * of #190: the notice stayed after the catalog was ready).
 */
export function useCatalogAnswer<T extends CatalogStateAnswer>(
  workspaceId: string,
  key: string,
  load: () => Promise<T>,
): Resource<T> & { behind: boolean } {
  const answer = useResource(key, load)
  const tree = useWorkspaceTree(workspaceId)
  const treeCommit = tree?.catalog_commit ?? null
  const treeBehind = tree?.index_behind ?? true
  const answerCommit = answer.data?.catalog_commit
  const reload = useEffectEvent(answer.reload)
  useEffect(() => {
    if (answerCommit === undefined || treeBehind || treeCommit === null) return
    if (treeCommit !== answerCommit) reload()
  }, [answerCommit, treeCommit, treeBehind])
  return {
    ...answer,
    behind: useIndexBehind(workspaceId, answer.data?.index_behind ?? false),
  }
}

/** The sidebar's tree, when it shows this workspace and has loaded. */
function useWorkspaceTree(workspaceId: string): CatalogTreeAnswer | undefined {
  const state = useCatalogTree()
  return state?.workspaceId === workspaceId ? state.tree.data : undefined
}

/**
 * Whether the index is behind `main`: as the sidebar's tree says now, which
 * it keeps asking while it is; else as the page's own answer said.
 */
export function useIndexBehind(
  workspaceId: string,
  answerBehind: boolean,
): boolean {
  const tree = useWorkspaceTree(workspaceId)
  return tree ? tree.index_behind : answerBehind
}

const titleMaps = new WeakMap<
  readonly CatalogTreeItem[],
  Map<string, string | null>
>()

/**
 * A page's title as the sidebar's tree has it, for links that name a page
 * by ID only (a page's owner, a step of Start here): worked out once per
 * tree, however many links ask. Undefined when the tree hasn't it.
 */
export function usePageTitle(id: string): string | null | undefined {
  const items = useCatalogTree()?.tree.data?.items
  if (!items) return undefined
  let titles = titleMaps.get(items)
  if (!titles) {
    titles = new Map(
      items.flatMap((item) =>
        item.id === null ? [] : [[item.id, item.title]],
      ),
    )
    titleMaps.set(items, titles)
  }
  return titles.get(id)
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

/**
 * How long to wait before asking again where the catalog stands, while it
 * is being set up or catching up: 3 seconds, doubling to a minute. A catalog
 * that stays behind (a failing index job) then costs a small request a
 * minute per open tab, not the whole tree every few seconds.
 */
export function pollDelayMs(attempt: number): number {
  return Math.min(3000 * 2 ** attempt, 60_000)
}

/** Where the catalog stands: what the state route answers. */
export interface CatalogStateAnswer {
  catalog_commit: string | null
  index_behind: boolean
}

/**
 * Asks where the catalog stands until it differs from `known`, waiting
 * `pollDelayMs` between asks, and calls `changed` once when it does. While
 * the page is hidden it does not ask; it asks at once when the page is
 * shown again. Returns a function that stops it.
 */
export function pollCatalogState(options: {
  read: () => Promise<CatalogStateAnswer>
  known: CatalogStateAnswer
  changed: () => void
  document?: {
    visibilityState: DocumentVisibilityState
    addEventListener(type: "visibilitychange", listener: () => void): void
    removeEventListener(type: "visibilitychange", listener: () => void): void
  }
}): () => void {
  const doc = options.document ?? document
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let asking = false
  let stopped = false
  const schedule = () => {
    if (stopped || doc.visibilityState === "hidden") return
    timer = setTimeout(() => void ask(), pollDelayMs(attempt))
  }
  const ask = async () => {
    timer = undefined
    asking = true
    try {
      const now = await options.read()
      if (stopped) return
      if (
        now.catalog_commit !== options.known.catalog_commit ||
        now.index_behind !== options.known.index_behind
      ) {
        stopped = true
        options.changed()
        return
      }
    } catch {
      // Asked again later, like an unchanged answer.
    } finally {
      asking = false
    }
    attempt++
    schedule()
  }
  const onVisibility = () => {
    if (doc.visibilityState === "visible" && timer === undefined && !asking)
      void ask()
  }
  doc.addEventListener("visibilitychange", onVisibility)
  schedule()
  return () => {
    stopped = true
    clearTimeout(timer)
    doc.removeEventListener("visibilitychange", onVisibility)
  }
}

/**
 * Loads the tree of a workspace's catalog. While the catalog is being set
 * up or catching up, it asks only where the catalog stands
 * (`pollCatalogState`), and reads the tree again once that changes, so
 * pages update by themselves.
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
  const data = tree.data
  const waiting = data !== undefined && catalogState(data) !== "ready"
  const commit = data?.catalog_commit ?? null
  const behind = data?.index_behind ?? false
  const reload = useEffectEvent(tree.reload)
  const read = useEffectEvent(() => api.catalogState(workspaceId!))
  useEffect(() => {
    if (!waiting || !workspaceId) return
    return pollCatalogState({
      read,
      known: { catalog_commit: commit, index_behind: behind },
      changed: reload,
    })
  }, [waiting, workspaceId, commit, behind])
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
 * Orders titles as people read them: case and accents aside, numbers by
 * value ("Machine 2" before "Machine 10").
 */
const collator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
})

/** Pages by title, then path: each key worked out once, for large folders. */
function byTitle(items: CatalogTreeItem[]): CatalogTreeItem[] {
  const keyed = items.map((item) => ({
    item,
    title: item.title ?? item.id ?? item.path,
  }))
  keyed.sort(
    (a, b) =>
      collator.compare(a.title, b.title) ||
      (a.item.path < b.item.path ? -1 : a.item.path > b.item.path ? 1 : 0),
  )
  return keyed.map((k) => k.item)
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
    const list = byFolder.get(folder)
    if (list) list.push(item)
    else byFolder.set(folder, [item])
  }
  return [...byFolder]
    .map(([name, folderItems]) => ({ name, items: byTitle(folderItems) }))
    .sort((a, b) => {
      const rank = (f: Folder) =>
        f.name === "" ? 0 : f.name === "schema" ? 2 : 1
      return rank(a) - rank(b) || collator.compare(a.name, b.name)
    })
}
