import { useState } from "react"
import type { ReactNode } from "react"
import { Link, useSearchParams } from "react-router"

import type {
  CatalogDiscrepancyItem,
  CatalogFact,
  CatalogFactItem,
  CatalogTreeItem,
} from "@shinan/api-client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { useApi, useResource } from "../../api"
import {
  catalogState,
  useCatalogTree,
  useIndexBehind,
} from "../../catalog-tree"
import { PageHeader } from "../../components/page"
import { ErrorMessage, Loading } from "../../components/status"
import { useWorkspace } from "../workspace/context"
import {
  ageText,
  andList,
  entityPath,
  factLabel,
  listLinkClass,
  snippet,
  stateLabels,
  valueText,
} from "./format"
import { BeingSetUp, IndexBehind } from "./notices"
import { StartHere } from "./StartHere"
import { TitleText, VisibleText } from "./VisibleText"

/**
 * The catalog's first page, Start here (human experience, the catalog):
 * while the workspace's repository is being made, it says so; otherwise
 * the start-here page.
 */
export function CatalogHome() {
  const { workspace } = useWorkspace()
  const state = useCatalogTree()
  const tree = state?.workspaceId === workspace.id ? state.tree : undefined
  if (tree?.error) return <ErrorMessage error={tree.error} />
  if (!tree?.data) return <Loading />
  if (catalogState(tree.data) === "setting-up") return <BeingSetUp />
  return <StartHere pages={tree.data.items.length} />
}

/** A link to a page by its title. */
function PageLink(props: {
  workspaceId: string
  id: string
  title: string | null
  className?: string
}) {
  return (
    <Link
      to={entityPath(props.workspaceId, props.id)}
      className={cn(listLinkClass, props.className)}
    >
      <TitleText title={props.title} id={props.id} />
    </Link>
  )
}

/** The folder of a page's ID, such as `machine`. */
function folderOf(id: string): string {
  const slash = id.lastIndexOf("/")
  return slash < 0 ? "" : id.slice(0, slash)
}

/**
 * Search results (human experience, the catalog: search): each page by
 * title, its folder, and one line. Retired pages are left out; if any
 * matched, one link shows them.
 */
export function SearchPage() {
  const api = useApi()
  const { workspace } = useWorkspace()
  const [params] = useSearchParams()
  const text = params.get("q") ?? ""
  const [showRetired, setShowRetired] = useState(false)
  const results = useResource(`catalog-search:${workspace.id}:${text}`, () =>
    text.trim() === ""
      ? Promise.resolve(null)
      : api.catalogSearch(workspace.id, { text, includeRetired: true }),
  )
  const searchBehind = useIndexBehind(
    workspace.id,
    results.data?.index_behind ?? false,
  )
  const items = results.data?.items ?? []
  const retired = items.filter((i) => i.entity.status === "retired")
  const shown = showRetired
    ? items
    : items.filter((i) => i.entity.status !== "retired")
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={text ? `Search: ${text}` : "Search the catalog"}>
        {text
          ? undefined
          : "Type words in the search box: a name, a value, or words from a page."}
      </PageHeader>
      {results.error ? <ErrorMessage error={results.error} /> : null}
      {results.loading && <Loading />}
      {results.data && <IndexBehind behind={searchBehind} />}
      {results.data && shown.length === 0 && retired.length === 0 && (
        <p className="text-sm">Nothing matches.</p>
      )}
      {shown.length > 0 && (
        <ol className="flex flex-col gap-5">
          {shown.map((item) => (
            <li key={item.entity.id} className="flex min-w-0 flex-col gap-0.5">
              <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <PageLink
                  workspaceId={workspace.id}
                  id={item.entity.id}
                  title={item.entity.title}
                  className="min-w-0 wrap-anywhere"
                />
                <span className="min-w-0 text-xs wrap-anywhere text-muted-foreground">
                  <VisibleText text={folderOf(item.entity.id)} oneLine />
                  {item.entity.status === "retired" && " · retired"}
                </span>
              </p>
              {snippet(item) && (
                <p className="min-w-0 text-sm wrap-anywhere text-muted-foreground">
                  <VisibleText text={snippet(item)} oneLine />
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
      {!showRetired && retired.length > 0 && (
        <Button
          variant="link"
          className="self-start px-0"
          onClick={() => setShowRetired(true)}
        >
          Show {retired.length} retired{" "}
          {retired.length === 1 ? "page" : "pages"}
        </Button>
      )}
    </div>
  )
}

/** A fact in one line: its value, or what is known about it. */
function factLine(fact: CatalogFact): string {
  if (fact.state === "unknown") return fact.note ?? "not known yet"
  const value = valueText(fact.value ?? fact.to)
  const state = fact.state === "observed" ? "" : `${stateLabels[fact.state]} `
  const age =
    fact.freshness.age_days === null
      ? "not checked yet"
      : ageText(fact.freshness.age_days)
  return `${state}${value} · ${age}`
}

/** How many items each list of Needs attention reads at once. */
const listLimit = 500

/**
 * Needs attention (human experience, the catalog): what disagrees, what has
 * not been checked in a while, what is unknown, and files that cannot be
 * read as pages. Only the parts with items show; retired pages are left
 * out.
 */
export function NeedsAttentionPage() {
  const api = useApi()
  const { workspace } = useWorkspace()
  const state = useCatalogTree()
  const lists = useResource(`needs-attention:${workspace.id}`, async () => {
    const [disagree, due, unknown] = await Promise.all([
      api.catalogList(workspace.id, "discrepancies", { limit: listLimit }),
      api.catalogList(workspace.id, "due-for-recheck", { limit: listLimit }),
      api.catalogList(workspace.id, "known-unknowns", { limit: listLimit }),
    ])
    return {
      behind: disagree.index_behind || due.index_behind || unknown.index_behind,
      disagree: (disagree.items as CatalogDiscrepancyItem[]).filter(
        (i) => !i.accepted,
      ),
      due: due.items as CatalogFactItem[],
      unknown: unknown.items as CatalogFactItem[],
    }
  })
  const unreadable: CatalogTreeItem[] =
    state?.workspaceId === workspace.id
      ? (state.tree.data?.items.filter((i) => i.id === null) ?? [])
      : []
  const data = lists.data
  const attentionBehind = useIndexBehind(workspace.id, data?.behind ?? false)
  const empty =
    data &&
    data.disagree.length + data.due.length + data.unknown.length === 0 &&
    unreadable.length === 0
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Needs attention" />
      {lists.error ? <ErrorMessage error={lists.error} /> : null}
      {lists.loading && <Loading />}
      {data && <IndexBehind behind={attentionBehind} />}
      {empty && <p className="text-sm">Nothing needs attention.</p>}
      {data && data.disagree.length > 0 && (
        <AttentionList title="These disagree">
          {data.disagree.map((item) => (
            <AttentionItem
              key={`${item.entity.id}:${item.key}`}
              workspaceId={workspace.id}
              id={item.entity.id}
              title={item.entity.title}
              line={`${factLabel(item.key)}: ${andList(item.values)}`}
            />
          ))}
        </AttentionList>
      )}
      {data && data.due.length > 0 && (
        <AttentionList title="Not checked in a while">
          {data.due.map((item) => (
            <AttentionItem
              key={`${item.entity.id}:${item.fact.identity}`}
              workspaceId={workspace.id}
              id={item.entity.id}
              title={item.entity.title}
              line={`${factLabel(item.fact.key)}: ${factLine(item.fact)}`}
            />
          ))}
        </AttentionList>
      )}
      {data && data.unknown.length > 0 && (
        <AttentionList title="Unknown">
          {data.unknown.map((item) => (
            <AttentionItem
              key={`${item.entity.id}:${item.fact.identity}`}
              workspaceId={workspace.id}
              id={item.entity.id}
              title={item.entity.title}
              line={`${factLabel(item.fact.key)}: ${factLine(item.fact)}`}
            />
          ))}
        </AttentionList>
      )}
      {unreadable.length > 0 && (
        <AttentionList title="Files that can't be read">
          {unreadable.map((item) => (
            <li key={item.path} className="flex flex-col gap-0.5">
              <code className="text-sm wrap-anywhere">
                <VisibleText text={item.path} oneLine />
              </code>
              <span className="text-sm text-muted-foreground">
                Shinan can't read this file as a page. An agent can fix it by
                renaming it to the page's ID plus .md.
              </span>
            </li>
          ))}
        </AttentionList>
      )}
    </div>
  )
}

function AttentionList(props: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{props.title}</h2>
      <ul className="flex flex-col gap-3">{props.children}</ul>
    </section>
  )
}

function AttentionItem(props: {
  workspaceId: string
  id: string
  title: string | null
  line: string
}) {
  return (
    <li className="flex min-w-0 flex-col gap-0.5">
      <PageLink
        workspaceId={props.workspaceId}
        id={props.id}
        title={props.title}
        className="self-start wrap-anywhere"
      />
      <span className="min-w-0 text-sm wrap-anywhere text-muted-foreground">
        <VisibleText text={props.line} oneLine />
      </span>
    </li>
  )
}
