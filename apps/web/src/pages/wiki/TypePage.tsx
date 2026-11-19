import { ArrowDownIcon, ArrowUpIcon } from "lucide-react"
import { useState } from "react"
import { Link, useParams } from "react-router"

import type {
  CatalogFreshnessSummary,
  CatalogTypeIndexAnswer,
} from "@shinan/api-client"

import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { isApiError, useApi, useResource } from "../../api"
import { PageHeader, Section } from "../../components/page"
import { ErrorMessage, Loading } from "../../components/status"
import { useWorkspace } from "../workspace/context"
import { EntityLink, linkClass } from "./facts"
import { ageText, daysSince, entityPath, wikiPath } from "./format"
import { Markdown } from "./markdown"
import { IndexBehind, PageNotice, SavedNotice } from "./notices"

type Item = CatalogTypeIndexAnswer["items"][number]

type SortKey =
  "id" | "status" | "owner" | "facts" | "oldest" | "due" | "unknown"

const columns: { key: SortKey; label: string }[] = [
  { key: "id", label: "Entity" },
  { key: "status", label: "Status" },
  { key: "owner", label: "Owner" },
  { key: "facts", label: "Facts" },
  { key: "oldest", label: "Oldest check" },
  { key: "due", label: "Due" },
  { key: "unknown", label: "Unknown" },
]

function sortValue(item: Item, key: SortKey): string | number {
  const f: CatalogFreshnessSummary = item.freshness
  switch (key) {
    case "id":
      return item.entity.id
    case "status":
      return item.entity.status ?? ""
    case "owner":
      return item.entity.owner ?? ""
    case "facts":
      return f.facts
    case "oldest":
      // Never checked sorts as the oldest of all.
      return f.oldest_checked_at ? Date.parse(f.oldest_checked_at) : 0
    case "due":
      return f.due + f.not_checked
    case "unknown":
      return f.unknown
  }
}

/**
 * The index of one entity type (human experience, moving around the wiki):
 * its type schema document first, then its entities in a sortable table
 * with entity status, owner and freshness summary.
 */
export function TypePage() {
  const api = useApi()
  const { workspace } = useWorkspace()
  const type = useParams().type ?? ""
  const [retired, setRetired] = useState(false)
  const schema = useResource(`catalog-type:${workspace.id}:${type}`, () =>
    api.catalogType(workspace.id, type),
  )
  const index = useResource(
    `catalog-type-index:${workspace.id}:${type}:${retired}`,
    () => api.catalogTypeIndex(workspace.id, type, { includeRetired: retired }),
  )
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({
    key: "id",
    ascending: true,
  })

  if (isApiError(schema.error, "not-found"))
    return (
      <PageHeader title={`No type called ${type}`}>
        <Link to={wikiPath(workspace.id)} className={linkClass}>
          Back to the wiki
        </Link>
      </PageHeader>
    )
  const details = schema.data?.schema
  const listed = (index.data?.items.length ?? 0).toLocaleString("en")
  const items = [...(index.data?.items ?? [])].sort((a, b) => {
    const x = sortValue(a, sort.key)
    const y = sortValue(b, sort.key)
    const order = x < y ? -1 : x > y ? 1 : 0
    return sort.ascending ? order : -order
  })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={details?.title ?? type}>
        {details?.summary ??
          (details?.built_in
            ? `One of Shinan's eight built-in types.`
            : `Entities of the type ${type}.`)}
      </PageHeader>
      <SavedNotice workspaceId={workspace.id} />
      {details && (
        <div className="-mt-4 flex flex-wrap gap-2">
          {details.status !== "retired" && (
            <Link
              to={`${wikiPath(workspace.id, "/new")}?${new URLSearchParams({ type }).toString()}`}
              className={buttonVariants({ variant: "outline" })}
            >
              New {type}
            </Link>
          )}
          <Link
            to={
              details.document
                ? wikiPath(workspace.id, `/edit/${details.document}`)
                : `${wikiPath(workspace.id, "/new-type")}?${new URLSearchParams({ type }).toString()}`
            }
            className={buttonVariants({ variant: "outline" })}
          >
            {details.document
              ? "Suggest a change to the type"
              : "Extend this type"}
          </Link>
        </div>
      )}
      {schema.error ? <ErrorMessage error={schema.error} /> : null}
      <IndexBehind behind={index.data?.index_behind ?? false} />
      {details && (
        <Section
          title="Type schema"
          description={
            details.document
              ? `Defined by the type schema document ${details.document}.`
              : "Built in; a workspace can extend it with a type schema document."
          }
        >
          {details.body.length > 0 && (
            <Markdown
              text={details.body.map((s) => s.text).join("")}
              anchors={details.body
                .filter((s) => s.heading !== null)
                .map((s) => s.anchor)}
              entityPath={(id) => entityPath(workspace.id, id)}
            />
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Keys of {type}</caption>
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Key
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Holds
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Recheck
                  </th>
                </tr>
              </thead>
              <tbody>
                {details.keys.map((k) => (
                  <tr key={k.key} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs">
                      {k.key}
                      {details.required.includes(k.key) && (
                        <Badge variant="outline" className="ml-2 font-sans">
                          required
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {k.relation
                        ? `${k.many ? "links" : "a link"} to ${k.relation.targets.join(", ")}`
                        : k.many
                          ? "several values"
                          : "one value"}
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {k.recheck_days ? `every ${k.recheck_days} days` : "none"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      <Section title={`Entities of type ${type}`}>
        <label className="flex items-center gap-2 self-start text-sm">
          <input
            type="checkbox"
            checked={retired}
            onChange={(e) => setRetired(e.target.checked)}
            className="size-4 accent-primary"
          />
          Show retired
        </label>
        {index.error ? <ErrorMessage error={index.error} /> : null}
        {!index.data && !index.error && <Loading />}
        {index.data && items.length === 0 && (
          <p className="text-sm text-muted-foreground">No entities yet.</p>
        )}
        {index.data?.truncated && (
          <PageNotice>
            This type has more than {listed} entities. Only the first {listed}{" "}
            by ID are listed, and sorting orders only those; search to find
            others.
          </PageNotice>
        )}
        {items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">
                Entities of type {type}; the column buttons sort the table
                {index.data?.truncated
                  ? ` (the first ${listed} by ID only)`
                  : ""}
                .
              </caption>
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  {columns.map((c) => {
                    const active = sort.key === c.key
                    return (
                      <th
                        key={c.key}
                        scope="col"
                        aria-sort={
                          active
                            ? sort.ascending
                              ? "ascending"
                              : "descending"
                            : undefined
                        }
                        className="py-2 pr-4 font-medium"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setSort({
                              key: c.key,
                              ascending: active ? !sort.ascending : true,
                            })
                          }
                          className={cn(
                            "inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring",
                            active && "text-foreground",
                          )}
                        >
                          {c.label}
                          {active &&
                            (sort.ascending ? (
                              <ArrowUpIcon
                                aria-hidden="true"
                                className="size-3"
                              />
                            ) : (
                              <ArrowDownIcon
                                aria-hidden="true"
                                className="size-3"
                              />
                            ))}
                        </button>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.entity.id} className="border-b last:border-0">
                    <td className="py-2 pr-4">
                      <EntityLink
                        workspaceId={workspace.id}
                        id={item.entity.id}
                        entity={item.entity}
                      />
                    </td>
                    <td className="py-2 pr-4">{item.entity.status}</td>
                    <td className="py-2 pr-4 font-mono text-xs">
                      {item.entity.owner ?? "unknown"}
                    </td>
                    <td className="py-2 pr-4">{item.freshness.facts}</td>
                    <td className="py-2 pr-4">
                      {item.freshness.oldest_checked_at
                        ? ageText(daysSince(item.freshness.oldest_checked_at))
                        : "not checked"}
                    </td>
                    <td className="py-2 pr-4">
                      {item.freshness.due}
                      {item.freshness.not_checked > 0 && (
                        <span className="text-muted-foreground">
                          {" "}
                          (+{item.freshness.not_checked} never checked)
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4">{item.freshness.unknown}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  )
}
