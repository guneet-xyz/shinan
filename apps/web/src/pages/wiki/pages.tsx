import { useState } from "react"
import type { FormEvent } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router"

import { catalogLists } from "@shinan/api-client"
import type {
  CatalogDiscrepancyItem,
  CatalogFactItem,
  CatalogList,
  CatalogListItem,
  CatalogNotYetRecordedItem,
} from "@shinan/api-client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

import { useApi, useResource } from "../../api"
import { PageHeader, Rows, Section } from "../../components/page"
import { ErrorMessage, Loading } from "../../components/status"
import { useWorkspace } from "../workspace/context"
import { EntityLink, FactRow, linkClass } from "./facts"
import { entityPath, wikiPath } from "./format"
import { sectionElementId } from "./links"
import { IndexBehind } from "./notices"

/** What each workspace-wide list is, in words (catalog §10). */
const listNames: Record<CatalogList, { title: string; about: string }> = {
  discrepancies: {
    title: "Discrepancies",
    about: "Facts that disagree, with both sides' evidence.",
  },
  "due-for-recheck": {
    title: "Due for recheck",
    about: "Facts whose key's recheck interval has passed, most overdue first.",
  },
  "known-unknowns": {
    title: "Known unknowns",
    about: "Facts recorded as unknown on purpose, with why.",
  },
  "not-yet-recorded": {
    title: "Not yet recorded",
    about:
      "Required keys an entity does not mention, and imported facts never checked.",
  },
}

/** The wiki's first page: start here, search, types, lists, recent changes. */
export function WikiHome() {
  const api = useApi()
  const { workspace } = useWorkspace()
  const types = useResource(`catalog-types:${workspace.id}`, () =>
    api.catalogTypes(workspace.id),
  )
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Wiki">
        The catalog of {workspace.name}: what exists, how it is set up, and how
        sure we are.
      </PageHeader>
      <IndexBehind behind={types.data?.index_behind ?? false} />
      <Section
        title="Start here"
        description="The path through this workspace's catalog, for people and for agents."
      >
        <Link
          to={wikiPath(workspace.id, "/start-here")}
          className={cn(linkClass, "self-start")}
        >
          Open start here
        </Link>
      </Section>
      <Section title="Search">
        <SearchForm />
      </Section>
      <Section title="Types">
        {types.error ? <ErrorMessage error={types.error} /> : null}
        {!types.data && !types.error && <Loading />}
        {types.data && (
          <ul className="grid gap-2 text-sm sm:grid-cols-2 md:grid-cols-3">
            {types.data.items.map((t) => (
              <li key={t.type}>
                <Link
                  to={wikiPath(workspace.id, `/types/${t.type}`)}
                  className={linkClass}
                >
                  {t.type}
                </Link>
                <span className="text-muted-foreground">
                  {t.built_in
                    ? t.extended
                      ? " (built in, extended)"
                      : " (built in)"
                    : " (custom)"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Across the workspace">
        <Rows>
          {catalogLists.map((list) => (
            <li key={list}>
              <Link
                to={wikiPath(workspace.id, `/lists/${list}`)}
                className={cn(linkClass, "self-start")}
              >
                {listNames[list].title}
              </Link>
              <p className="text-sm text-muted-foreground">
                {listNames[list].about}
              </p>
            </li>
          ))}
        </Rows>
      </Section>
    </div>
  )
}

/** A search box, which opens the search page. */
export function SearchForm(props: {
  initial?: string
  includeRetired?: boolean
}) {
  const { workspace } = useWorkspace()
  const navigate = useNavigate()
  const [text, setText] = useState(props.initial ?? "")
  const [retired, setRetired] = useState(props.includeRetired ?? false)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (text.trim() === "") return
    const params = new URLSearchParams({ q: text.trim() })
    if (retired) params.set("retired", "true")
    void navigate(wikiPath(workspace.id, `/search?${params.toString()}`))
  }
  return (
    <form
      role="search"
      onSubmit={submit}
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
    >
      <label htmlFor="catalog-search" className="sr-only">
        Search the catalog
      </label>
      <Input
        id="catalog-search"
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Words, or an ID such as machine/musashi"
        className="sm:max-w-md"
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={retired}
          onChange={(e) => setRetired(e.target.checked)}
          className="size-4 accent-primary"
        />
        Include retired
      </label>
      <Button type="submit">Search</Button>
    </form>
  )
}

/** Search results: entities with their best matching sections. */
export function SearchPage() {
  const api = useApi()
  const { workspace } = useWorkspace()
  const [params] = useSearchParams()
  const text = params.get("q") ?? ""
  const includeRetired = params.get("retired") === "true"
  const results = useResource(
    `catalog-search:${workspace.id}:${text}:${includeRetired}`,
    () =>
      text.trim() === ""
        ? Promise.resolve(null)
        : api.catalogSearch(workspace.id, { text, includeRetired }),
  )
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Search">
        Searches titles, summaries, facts and page text.
        {!includeRetired && " Retired entities are left out unless you ask."}
      </PageHeader>
      <SearchForm
        key={`${text}:${includeRetired}`}
        initial={text}
        includeRetired={includeRetired}
      />
      {results.error ? <ErrorMessage error={results.error} /> : null}
      {results.loading && <Loading />}
      {results.data && <IndexBehind behind={results.data.index_behind} />}
      {results.data && (
        <Section
          title={
            results.data.items.length === 0
              ? `Nothing matches “${text}”`
              : `Results for “${text}”`
          }
        >
          {results.data.items.length > 0 && (
            <Rows>
              {results.data.items.map((item) => (
                <li key={item.entity.id}>
                  <EntityLink
                    workspaceId={workspace.id}
                    id={item.entity.id}
                    entity={item.entity}
                    className="self-start"
                  />
                  {item.entity.summary && (
                    <p className="text-sm">{item.entity.summary}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {item.entity.type} · {item.entity.status}
                  </p>
                  {item.sections.some((s) => s.anchor) && (
                    <p className="text-xs">
                      Matching sections:{" "}
                      {item.sections
                        .flatMap((s) =>
                          s.anchor ? [{ ...s, anchor: s.anchor }] : [],
                        )
                        .map((s, i) => (
                          <span key={s.anchor}>
                            {i > 0 && ", "}
                            <Link
                              to={`${entityPath(workspace.id, item.entity.id)}#${sectionElementId(s.anchor)}`}
                              className={linkClass}
                            >
                              {s.heading}
                            </Link>
                          </span>
                        ))}
                    </p>
                  )}
                </li>
              ))}
            </Rows>
          )}
        </Section>
      )}
    </div>
  )
}

/** One of the workspace-wide lists, a page at a time. */
export function ListPage() {
  const { workspace } = useWorkspace()
  const list = useParams().list ?? ""
  if (!catalogLists.some((l) => l === list))
    return (
      <PageHeader title="No such list">
        <Link to={wikiPath(workspace.id)} className={linkClass}>
          Back to the wiki
        </Link>
      </PageHeader>
    )
  return <ListContent key={list} list={list as CatalogList} />
}

function ListContent(props: { list: CatalogList }) {
  const api = useApi()
  const { workspace } = useWorkspace()
  const { list } = props
  const [extra, setExtra] = useState<CatalogListItem[]>([])
  const [nextOffset, setNextOffset] = useState<number | null | undefined>()
  const first = useResource(`catalog-list:${workspace.id}:${list}`, () =>
    api.catalogList(workspace.id, list),
  )
  const items = [...(first.data?.items ?? []), ...extra]
  const next = nextOffset === undefined ? first.data?.next_offset : nextOffset
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={listNames[list].title}>
        {listNames[list].about}
      </PageHeader>
      {first.error ? <ErrorMessage error={first.error} /> : null}
      {first.loading && <Loading />}
      {first.data && <IndexBehind behind={first.data.index_behind} />}
      {first.data && items.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing in this list.</p>
      )}
      {items.length > 0 && (
        <Rows>
          {items.map((item, i) => (
            <li key={i}>
              <ListItem workspaceId={workspace.id} list={list} item={item} />
            </li>
          ))}
        </Rows>
      )}
      {next != null && (
        <Button
          variant="outline"
          className="self-start"
          onClick={() => {
            void api
              .catalogList(workspace.id, list, { offset: next })
              .then((page) => {
                setExtra((e) => [...e, ...page.items])
                setNextOffset(page.next_offset)
              })
          }}
        >
          More
        </Button>
      )}
    </div>
  )
}

function ListItem(props: {
  workspaceId: string
  list: CatalogList
  item: CatalogListItem
}) {
  const { workspaceId, list } = props
  const entity = (
    <EntityLink
      workspaceId={workspaceId}
      id={props.item.entity.id}
      entity={props.item.entity}
      className="self-start"
    />
  )
  if (list === "discrepancies") {
    const item = props.item as CatalogDiscrepancyItem
    return (
      <>
        {entity}
        <p className="text-sm">
          <span className="font-mono text-xs">{item.key}</span>{" "}
          {item.accepted ? "(difference accepted)" : "(needs a look)"}
        </p>
        <ul className="flex flex-col gap-3 border-l-2 pl-3">
          {item.fact_details.map((fact) => (
            <li key={fact.identity}>
              <FactRow workspaceId={workspaceId} fact={fact} showKey={false} />
            </li>
          ))}
        </ul>
      </>
    )
  }
  if (list === "not-yet-recorded") {
    const item = props.item as CatalogNotYetRecordedItem
    return (
      <>
        {entity}
        {item.missing_keys.length > 0 && (
          <p className="text-sm">
            Not recorded:{" "}
            <span className="font-mono text-xs">
              {item.missing_keys.join(", ")}
            </span>
          </p>
        )}
        {item.not_checked.map((fact) => (
          <FactRow key={fact.identity} workspaceId={workspaceId} fact={fact} />
        ))}
      </>
    )
  }
  const item = props.item as CatalogFactItem
  return (
    <>
      {entity}
      <FactRow workspaceId={workspaceId} fact={item.fact} />
    </>
  )
}
