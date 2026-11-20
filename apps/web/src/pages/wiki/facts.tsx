import type { ReactNode } from "react"
import { Link } from "react-router"

import type {
  CatalogEntitySummary,
  CatalogFact,
  CatalogOutgoingRelation,
} from "@shinan/api-client"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

import {
  ageText,
  entityPath,
  isWebAddress,
  stateLabels,
  valueText,
} from "./format"

/*
 * How a fact looks wherever it appears: its value, its fact state in words,
 * its freshness as age (never as right or wrong), and its fact check one
 * step away (human experience, how freshness is shown). Shared by the
 * entity page and the workspace lists.
 */

export const linkClass =
  "rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring"

/** A link to an entity's page, by its title when known. */
export function EntityLink(props: {
  workspaceId: string
  id: string
  entity?: CatalogEntitySummary | null
  className?: string
}) {
  const title = props.entity?.title
  return (
    <Link
      to={entityPath(props.workspaceId, props.id)}
      className={cn(linkClass, props.className)}
    >
      {title ?? props.id}
      {title && (
        <span className="ml-1 font-normal text-muted-foreground">
          ({props.id})
        </span>
      )}
    </Link>
  )
}

/** A web address as a link; any other text as it is. */
export function MaybeLink(props: { text: string }) {
  if (!isWebAddress(props.text))
    return <span className="wrap-anywhere">{props.text}</span>
  return (
    <a
      href={props.text}
      rel="noreferrer noopener"
      className={cn(linkClass, "wrap-anywhere")}
    >
      {props.text}
    </a>
  )
}

/** The fact state, labelled in words. */
export function StateLabel(props: { state: CatalogFact["state"] }) {
  return (
    <Badge
      variant={props.state === "unknown" ? "outline" : "secondary"}
      className="font-normal"
    >
      {stateLabels[props.state]}
    </Badge>
  )
}

/**
 * A fact's value: a relation's target as a link, `secrets-in` as where the
 * secret is kept (never a value), an `unknown` fact as "unknown" with why.
 */
export function FactValue(props: {
  workspaceId: string
  fact: CatalogFact
  /** The relation's target, when the page has it, for its title. */
  target?: CatalogOutgoingRelation | undefined
}) {
  const { fact } = props
  const attributes = Object.entries(fact.attributes ?? {})
  if (fact.state === "unknown")
    return (
      <span>
        <strong className="font-semibold">unknown</strong>
        {fact.to && (
          <>
            {" "}
            for{" "}
            <EntityLink
              workspaceId={props.workspaceId}
              id={fact.to}
              entity={props.target?.entity}
            />
          </>
        )}
        {fact.note && (
          <span className="text-muted-foreground">: {fact.note}</span>
        )}
      </span>
    )
  let value: ReactNode
  if (fact.relation && fact.to) {
    const link = (
      <EntityLink
        workspaceId={props.workspaceId}
        id={fact.to}
        entity={props.target?.entity}
      />
    )
    value =
      fact.key === "secrets-in" ? (
        <span>
          kept in {link}
          {fact.attributes?.item !== undefined && (
            <>
              {" "}
              as{" "}
              <code className="font-mono text-xs">
                {valueText(fact.attributes.item)}
              </code>
            </>
          )}
        </span>
      ) : (
        link
      )
  } else {
    value = <MaybeLink text={valueText(fact.value)} />
  }
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {fact.remove ? (
        <span>
          remove <span className="line-through">{value}</span>
        </span>
      ) : (
        value
      )}
      {attributes
        .filter(([name]) => !(fact.key === "secrets-in" && name === "item"))
        .map(([name, v]) => (
          <span key={name} className="text-xs text-muted-foreground">
            {name}: <span className="font-mono">{valueText(v)}</span>
          </span>
        ))}
    </span>
  )
}

/** The fact's age in words, and whether it is due or never checked. */
export function Freshness(props: { fact: CatalogFact }) {
  const { freshness } = props.fact
  switch (freshness.status) {
    case "none":
      return null
    case "not-checked":
      return <Badge variant="outline">not checked</Badge>
    case "due":
      return (
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">
            {ageText(freshness.age_days ?? 0)}
          </span>
          <Badge variant="destructive">due for recheck</Badge>
        </span>
      )
    case "fresh":
      return (
        <span className="text-muted-foreground">
          {ageText(freshness.age_days ?? 0)}
        </span>
      )
  }
}

/** The fact check, one step away: when exactly, by whom, what was checked and how. */
export function CheckDetails(props: { fact: CatalogFact }) {
  const { fact } = props
  const check = fact.check
  if (
    !check &&
    !fact.task &&
    !fact.via &&
    !(fact.note && fact.state !== "unknown")
  )
    return null
  return (
    <details className="text-xs text-muted-foreground [&[open]>summary]:mb-1">
      <summary className="w-fit cursor-pointer rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring">
        {check ? "How it was checked" : "Details"}
      </summary>
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5 [&>dd]:min-w-0 [&>dd]:wrap-anywhere [&>dd]:text-foreground">
        {check && (
          <>
            <dt>Checked</dt>
            <dd>{check.checked ?? "not checked (imported)"}</dd>
            <dt>By</dt>
            <dd>{check.by ?? "unknown"}</dd>
            {check.scope && (
              <>
                <dt>Scope</dt>
                <dd>{check.scope}</dd>
              </>
            )}
            {check.source && (
              <>
                <dt>Source</dt>
                <dd>
                  <MaybeLink text={check.source} />
                </dd>
              </>
            )}
            {check.limits && (
              <>
                <dt>Not checked</dt>
                <dd>{check.limits}</dd>
              </>
            )}
          </>
        )}
        {fact.via && (
          <>
            <dt>Seen through</dt>
            <dd>{fact.via}</dd>
          </>
        )}
        {fact.task && (
          <>
            <dt>Planned in</dt>
            <dd>{fact.task}</dd>
          </>
        )}
        {fact.note && fact.state !== "unknown" && (
          <>
            <dt>Note</dt>
            <dd>{fact.note}</dd>
          </>
        )}
        {fact.accepted && (
          <>
            <dt>Accepted by</dt>
            <dd>{fact.accepted}</dd>
          </>
        )}
      </dl>
    </details>
  )
}

/**
 * One fact as a row: key, value, state, freshness and check details.
 */
export function FactRow(props: {
  workspaceId: string
  fact: CatalogFact
  target?: CatalogOutgoingRelation | undefined
  /** Show the key; lists that group by key leave it out. */
  showKey?: boolean
}) {
  const { fact } = props
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {props.showKey !== false && (
          <span className="font-mono text-xs text-muted-foreground">
            {fact.key}
            {!fact.in_schema && (
              <span className="ml-1 font-sans">(not in the type schema)</span>
            )}
          </span>
        )}
        <StateLabel state={fact.state} />
        <Freshness fact={fact} />
      </div>
      <FactValue
        workspaceId={props.workspaceId}
        fact={fact}
        target={props.target}
      />
      <CheckDetails fact={fact} />
    </div>
  )
}
