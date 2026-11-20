import { useEffect } from "react"
import type { ReactNode } from "react"
import { Navigate, useLocation } from "react-router"

import type { CatalogEntity } from "@shinan/api-client"

import { isApiError, useApi } from "../../api"
import { useCatalogAnswer } from "../../catalog-tree"
import { ErrorMessage, Loading } from "../../components/status"
import { NotFound } from "../NotFound"
import { aboutEntity } from "./about"
import { EntityLink } from "./facts"
import { Disagreements, FactsList } from "./FactsList"
import { entityPath, factLabel } from "./format"
import { IndexBehind } from "./notices"
import {
  MovedNotice,
  PageBody,
  PageFooter,
  PageHeading,
  ProblemsNotice,
  StatusNotice,
} from "./PageParts"

/**
 * A page of the catalog (product brief on #169), in this order: a calm
 * notice if it is retired; its title and summary; one sentence for each
 * disagreement; its facts as a short list; its body; related pages; and the
 * footer with History, View source and About this page.
 */
export function EntityPage(props: { workspaceId: string; id: string }) {
  const api = useApi()
  const { workspaceId, id } = props
  const location = useLocation()
  const answer = useCatalogAnswer(
    workspaceId,
    `catalog-entity:${workspaceId}:${id}`,
    () => api.catalogEntity(workspaceId, id),
  )
  const entity = answer.data?.entity

  // A link to a section of this page (`#section-…`), followed from another
  // page or search, scrolls to it once the page has rendered: the browser
  // looked for it before the page's data arrived.
  const rendered = entity !== undefined && entity.id === id
  useEffect(() => {
    if (!rendered || location.hash.length < 2) return
    let target: string
    try {
      target = decodeURIComponent(location.hash.slice(1))
    } catch {
      return
    }
    document.getElementById(target)?.scrollIntoView()
  }, [rendered, entity?.id, location.hash])

  if (answer.error) {
    if (isApiError(answer.error, "not-found")) return <NotFound />
    return <ErrorMessage error={answer.error} />
  }
  if (!answer.data || !entity) return <Loading />

  // A former ID leads to the current page (catalog §2.4).
  if (entity.id !== id)
    return (
      <Navigate
        replace
        to={
          entityPath(workspaceId, entity.id) + location.search + location.hash
        }
        state={{ movedFrom: id }}
      />
    )

  return (
    <article className="flex flex-col gap-6">
      <StatusNotice
        workspaceId={workspaceId}
        status={entity.status}
        replacedBy={entity.replaced_by}
      />
      <PageHeading
        title={entity.title}
        id={entity.id}
        summary={entity.summary}
      />
      <MovedNotice />
      <IndexBehind behind={answer.behind} />
      <ProblemsNotice problems={entity.problems} />
      <Disagreements entity={entity} />
      <FactsList workspaceId={workspaceId} entity={entity} />
      <PageBody
        workspaceId={workspaceId}
        sections={entity.body}
        title={entity.title}
      />
      <RelatedPages workspaceId={workspaceId} entity={entity} />
      <PageFooter
        workspaceId={workspaceId}
        id={entity.id}
        commit={answer.data.catalog_commit}
        about={aboutEntity(workspaceId, entity)}
      />
    </article>
  )
}

/**
 * Pages that link to this one, under plain headings (its relations to
 * others are among its facts), and the policies and runbooks that apply.
 */
function RelatedPages(props: { workspaceId: string; entity: CatalogEntity }) {
  const { workspaceId, entity } = props
  const groups = new Map<string, ReactNode[]>()
  // A page shows once, under the first heading it belongs to.
  const seen = new Set<string>()
  const add = (name: string, id: string, node: ReactNode) => {
    if (seen.has(id)) return
    seen.add(id)
    const list = groups.get(name)
    if (list) list.push(node)
    else groups.set(name, [node])
  }
  for (const [i, r] of entity.relations.incoming.entries())
    add(
      r.inverse ? factLabel(r.inverse) : "Linked from",
      r.from.id,
      <li key={`${r.from.id}:${r.identity ?? i}`}>
        <EntityLink workspaceId={workspaceId} id={r.from.id} entity={r.from} />
      </li>,
    )
  for (const a of [...entity.applies.policies, ...entity.applies.runbooks])
    add(
      "Policies and runbooks that apply",
      a.entity.id,
      <li key={`applies:${a.entity.id}`}>
        <EntityLink
          workspaceId={workspaceId}
          id={a.entity.id}
          entity={a.entity}
        />
      </li>,
    )
  if (groups.size === 0) return null
  return (
    <section aria-labelledby="related" className="flex flex-col gap-3">
      <h2 id="related" className="text-base font-semibold">
        Related pages
      </h2>
      <div className="flex flex-col gap-4 text-sm">
        {[...groups].map(([name, items]) => (
          <div key={name} className="flex flex-col gap-1">
            <h3 className="text-muted-foreground">{name}</h3>
            <ul className="flex flex-col gap-1">{items}</ul>
          </div>
        ))}
      </div>
    </section>
  )
}
