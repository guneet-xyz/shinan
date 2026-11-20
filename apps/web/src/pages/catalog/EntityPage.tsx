import { useEffect } from "react"
import type { ReactNode } from "react"
import { Link, Navigate, useLocation, useParams } from "react-router"

import type { CatalogFact } from "@shinan/api-client"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

import { isApiError, useApi, useResource } from "../../api"
import { Section } from "../../components/page"
import { ErrorMessage, Loading } from "../../components/status"
import { NotFound } from "../NotFound"
import { EntityPageContext, useEntityPage } from "./context"
import { EntityLink, FactRow, linkClass, MaybeLink } from "./facts"
import {
  catalogPath,
  entityPath,
  freshnessSummary,
  isWebAddress,
  summaryParts,
  titleText,
  valueText,
} from "./format"
import { Markdown } from "./markdown"
import { IndexBehind, PageNotice } from "./notices"
import { visible } from "./visible"

/**
 * An entity page (human experience, an entity page), in order of
 * importance: what it is (and whether it is retired), discrepancies, owning
 * sources, a freshness summary, the facts, the body and links both ways.
 * Its history, from `main`'s commits, comes with the catalog UI (GC-7);
 * tasks come with M3.
 */
export function EntityPage() {
  const api = useApi()
  const workspaceId = useParams().workspaceId!
  const id = useParams()["*"] ?? ""
  const location = useLocation()
  const answer = useResource(`catalog-entity:${workspaceId}:${id}`, () =>
    api.catalogEntity(workspaceId, id),
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
    <EntityPageContext value={{ workspaceId, entity }}>
      <div className="flex flex-col gap-6">
        <EntityHeader />
        <IndexBehind behind={answer.data.index_behind} />
        <Discrepancies />
        <OwningSources />
        <Facts />
        <Body />
        <Links />
      </div>
    </EntityPageContext>
  )
}

/**
 * Title, type, ID, entity status and owner; a deprecated or retired entity
 * says so first, with its replacement.
 */
export function EntityHeader() {
  const { workspaceId, entity } = useEntityPage()
  const movedFrom = (useLocation().state as { movedFrom?: string } | null)
    ?.movedFrom
  return (
    <header className="flex flex-col gap-3">
      {(entity.status === "retired" || entity.status === "deprecated") && (
        <PageNotice warning>
          <p>
            <strong className="font-semibold">
              This {entity.type ?? "entity"} is {entity.status}.
            </strong>{" "}
            {entity.replaced_by ? (
              <>
                It is replaced by{" "}
                <EntityLink workspaceId={workspaceId} id={entity.replaced_by} />
                .
              </>
            ) : entity.status === "retired" ? (
              "It is kept for its history."
            ) : (
              "It still exists but should not be used for new work."
            )}
          </p>
        </PageNotice>
      )}
      {movedFrom && (
        <PageNotice>
          <p>
            <span className="font-mono">{movedFrom}</span> is now{" "}
            <span className="font-mono">{entity.id}</span>.
          </p>
        </PageNotice>
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">
          {titleText(entity.title, entity.id)}
        </h1>
        {entity.summary && (
          <p className="text-sm wrap-anywhere text-muted-foreground">
            {visible(entity.summary, { oneLine: true })}
          </p>
        )}
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm [&_dt]:text-muted-foreground [&>div]:flex [&>div]:gap-2">
        <div>
          <dt>Type</dt>
          <dd>
            {entity.type ? (
              <Link
                to={catalogPath(workspaceId, `/types/${entity.type}`)}
                className={linkClass}
              >
                {entity.type}
              </Link>
            ) : (
              "unknown"
            )}
          </dd>
        </div>
        <div>
          <dt>ID</dt>
          <dd className="font-mono wrap-anywhere">{entity.id}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            <Badge
              variant={entity.status === "active" ? "secondary" : "destructive"}
            >
              {entity.status ?? "unknown"}
            </Badge>
          </dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>
            {entity.owner && entity.owner !== "unknown" ? (
              <EntityLink workspaceId={workspaceId} id={entity.owner} />
            ) : (
              "unknown"
            )}
          </dd>
        </div>
        {entity.type === "decision" && entity.decision_state && (
          <div>
            <dt>Decision</dt>
            <dd>
              {entity.decision_state}
              {entity.decided_on && ` on ${entity.decided_on}`}
            </dd>
          </div>
        )}
        {entity.aliases.length > 0 && (
          <div>
            <dt>Former IDs</dt>
            <dd className="font-mono wrap-anywhere">
              {entity.aliases.join(", ")}
            </dd>
          </div>
        )}
      </dl>
      {entity.problems.length > 0 && (
        <PageNotice warning>
          <p className="font-semibold">This page could not be read in full:</p>
          <ul className="list-disc pl-5">
            {entity.problems.map((p, i) => (
              <li key={i}>{p.message}</li>
            ))}
          </ul>
        </PageNotice>
      )}
    </header>
  )
}

/** Facts that disagree, both sides with their evidence; neither shown as right. */
export function Discrepancies() {
  const { workspaceId, entity } = useEntityPage()
  if (entity.discrepancies.length === 0) return null
  return (
    <Section
      title="Discrepancies"
      description="These facts disagree. Both sides are shown with their evidence; neither is taken as right."
    >
      <ul className="flex flex-col gap-4">
        {entity.discrepancies.map((d) => (
          <li
            key={d.key}
            className={cn(
              "flex flex-col gap-3 rounded-lg border p-3",
              !d.accepted && "border-amber-600/40 dark:border-amber-400/40",
            )}
          >
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-xs">{d.key}</span>
              {d.accepted ? (
                <Badge variant="outline">difference accepted</Badge>
              ) : (
                <Badge variant="destructive">needs a look</Badge>
              )}
            </p>
            <ul className="flex flex-col divide-y">
              {d.facts.map((identity) => {
                const fact = entity.facts.find((f) => f.identity === identity)
                return fact ? (
                  <li key={identity} className="py-2 first:pt-0 last:pb-0">
                    <FactRow
                      workspaceId={workspaceId}
                      fact={fact}
                      showKey={false}
                    />
                  </li>
                ) : null
              })}
            </ul>
          </li>
        ))}
      </ul>
    </Section>
  )
}

/** Keys that point to where the authoritative information lives. */
function isSourceKey(key: string): boolean {
  return (
    key === "repository" || key === "issue_tracker" || key.startsWith("docs.")
  )
}

/**
 * Where the authoritative information lives, shown before the facts (link,
 * don't copy): repositories and documentation links, what configures it,
 * and the pinned sources of its intended facts.
 */
export function OwningSources() {
  const { workspaceId, entity } = useEntityPage()
  const seen = new Set<string>()
  const items: { key: string; label: string; node: ReactNode }[] = []
  const add = (key: string, label: string, node: ReactNode) => {
    if (seen.has(key)) return
    seen.add(key)
    items.push({ key, label, node })
  }
  for (const fact of entity.facts) {
    if (fact.state === "planned" || fact.state === "unknown") continue
    const value = valueText(fact.value)
    if (isSourceKey(fact.key) && isWebAddress(value))
      add(value, fact.key, <MaybeLink text={value} />)
    if (fact.key === "configured-by" && fact.to)
      add(
        fact.to,
        "configured by",
        <EntityLink
          workspaceId={workspaceId}
          id={fact.to}
          entity={
            entity.relations.outgoing.find((r) => r.identity === fact.identity)
              ?.entity
          }
        />,
      )
    const source = fact.check?.source
    if (fact.state === "intended" && source && isWebAddress(source))
      add(source, `source of ${fact.key}`, <MaybeLink text={source} />)
  }
  if (items.length === 0) return null
  return (
    <Section title="Owning sources">
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_minmax(0,1fr)] [&>dt]:text-muted-foreground">
        {items.map((item) => (
          <div key={item.key} className="contents">
            <dt>{item.label}</dt>
            <dd className="min-w-0 max-sm:mb-1">{item.node}</dd>
          </div>
        ))}
      </dl>
    </Section>
  )
}

/** The facts, grouped by key, after a one-line freshness summary. */
export function Facts() {
  const { workspaceId, entity } = useEntityPage()
  const keys: string[] = []
  const byKey = new Map<string, CatalogFact[]>()
  for (const fact of entity.facts) {
    const list = byKey.get(fact.key)
    if (list) list.push(fact)
    else {
      keys.push(fact.key)
      byKey.set(fact.key, [fact])
    }
  }
  const summary = summaryParts(freshnessSummary(entity.facts))
  const missing = entity.not_yet_recorded.missing_keys
  return (
    <Section title="Facts" description={summary.join(" · ")}>
      {keys.length === 0 && (
        <p className="text-sm text-muted-foreground">No facts recorded yet.</p>
      )}
      {keys.length > 0 && (
        <dl className="flex flex-col divide-y rounded-lg border">
          {keys.map((key) => (
            <div
              key={key}
              className="grid gap-2 p-3 sm:grid-cols-[minmax(8rem,14rem)_minmax(0,1fr)] sm:gap-4 sm:p-4"
            >
              <dt className="font-mono text-xs wrap-anywhere text-muted-foreground sm:pt-0.5">
                {key}
              </dt>
              <dd className="flex min-w-0 flex-col gap-3">
                {byKey.get(key)!.map((fact) => (
                  <FactRow
                    key={fact.identity}
                    workspaceId={workspaceId}
                    fact={fact}
                    showKey={false}
                    target={entity.relations.outgoing.find(
                      (r) => r.identity === fact.identity,
                    )}
                  />
                ))}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {missing.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Not yet recorded:{" "}
          <span className="font-mono">{missing.join(", ")}</span>
        </p>
      )}
    </Section>
  )
}

/** The readable description, rendered from its Markdown. */
export function Body() {
  const { workspaceId, entity } = useEntityPage()
  const text = entity.body.map((s) => s.text).join("")
  if (text.trim() === "") return null
  return (
    <Section title="Description">
      <Markdown
        text={text}
        anchors={entity.body
          .filter((s) => s.heading !== null)
          .map((s) => s.anchor)}
        entityPath={(id) => entityPath(workspaceId, id)}
      />
    </Section>
  )
}

/** Related entities both ways, and the policies and runbooks that apply. */
export function Links() {
  const { workspaceId, entity } = useEntityPage()
  const outgoing = new Map<string, typeof entity.relations.outgoing>()
  for (const r of entity.relations.outgoing) {
    const list = outgoing.get(r.key) ?? []
    list.push(r)
    outgoing.set(r.key, list)
  }
  const incoming = new Map<string, typeof entity.relations.incoming>()
  for (const r of entity.relations.incoming) {
    const name = r.inverse ?? `${r.key} (from)`
    const list = incoming.get(name) ?? []
    list.push(r)
    incoming.set(name, list)
  }
  const applies = [
    ...entity.applies.policies.map((a) => ({ ...a, kind: "policy" })),
    ...entity.applies.runbooks.map((a) => ({ ...a, kind: "runbook" })),
  ]
  if (outgoing.size === 0 && incoming.size === 0 && applies.length === 0)
    return null
  const group = (name: string, children: ReactNode) => (
    <div key={name} className="flex flex-col gap-1">
      <h3 className="text-xs font-medium text-muted-foreground">{name}</h3>
      <ul className="flex flex-col gap-1 text-sm">{children}</ul>
    </div>
  )
  return (
    <Section title="Links">
      {[...outgoing].map(([key, list]) =>
        group(
          key,
          list.map((r) => (
            <li key={r.identity}>
              {r.entity || !/^(schema\/|workspace$)/.test(r.to) ? (
                <EntityLink
                  workspaceId={workspaceId}
                  id={r.to}
                  entity={r.entity}
                />
              ) : (
                <span className="font-mono">{r.to}</span>
              )}
            </li>
          )),
        ),
      )}
      {[...incoming].map(([name, list]) =>
        group(
          name,
          list.map((r, i) => (
            <li key={`${r.from.id}:${r.identity ?? i}`}>
              <EntityLink
                workspaceId={workspaceId}
                id={r.from.id}
                entity={r.from}
              />
            </li>
          )),
        ),
      )}
      {applies.length > 0 &&
        group(
          "policies and runbooks that apply",
          applies.map((a) => (
            <li key={`${a.kind}:${a.entity.id}`}>
              <EntityLink
                workspaceId={workspaceId}
                id={a.entity.id}
                entity={a.entity}
              />{" "}
              <span className="text-muted-foreground">
                ({a.kind}
                {a.through === "workspace"
                  ? ", for the whole workspace"
                  : a.through === "type"
                    ? `, for every ${entity.type}`
                    : ""}
                )
              </span>
            </li>
          )),
        )}
    </Section>
  )
}
