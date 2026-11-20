import { useId, useState } from "react"
import type { ReactNode } from "react"

import type {
  CatalogEntity,
  CatalogFact,
  CatalogOutgoingRelation,
} from "@shinan/api-client"

import { EntityLink, MaybeLink } from "./facts"
import { disagreeingKeys, disagreementSentence } from "./facts-text"
import { ageText, byText, factLabel, valueText } from "./format"
import { PageNotice } from "./notices"
import { VisibleText } from "./VisibleText"

/*
 * A page's facts as people read them (product brief on #169): a short list
 * of "label, value, checked 5 days ago", the state only when it isn't
 * "seen", and who checked it, the source, scope and limits one tap away, on
 * the age. Facts that disagree are one sentence at the top instead.
 */

/** How a fact's state reads before its value; "seen" says nothing. */
const statePrefix: Record<CatalogFact["state"], string> = {
  observed: "",
  intended: "should be ",
  planned: "planned ",
  unknown: "",
}

/** Each disagreement not accepted, as one calm sentence at the top of the page. */
export function Disagreements(props: { entity: CatalogEntity }) {
  const open = props.entity.discrepancies.filter((d) => !d.accepted)
  if (open.length === 0) return null
  return (
    <PageNotice warning>
      {open.map((d) => (
        <p key={d.key}>
          <VisibleText text={disagreementSentence(d, props.entity.facts)} />
        </p>
      ))}
    </PageNotice>
  )
}

/**
 * The facts, one row per key: its label, then each value with its age. A
 * key whose values disagree says "disagree" (the sentence at the top has
 * the values).
 */
export function FactsList(props: {
  workspaceId: string
  entity: CatalogEntity
}) {
  const { entity } = props
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
  if (keys.length === 0) return null
  const disagree = disagreeingKeys(entity)
  return (
    <section aria-labelledby="facts" className="flex flex-col gap-3">
      <h2 id="facts" className="text-base font-semibold">
        Facts
      </h2>
      <dl className="grid grid-cols-1 gap-x-6 text-sm sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
        {keys.map((key) => (
          <div
            key={key}
            className="grid grid-cols-subgrid gap-y-0.5 border-b py-2 last:border-b-0 sm:col-span-2"
          >
            <dt className="wrap-anywhere text-muted-foreground">
              <VisibleText text={factLabel(key)} oneLine />
            </dt>
            <dd className="flex min-w-0 flex-col gap-1">
              {disagree.has(key) ? (
                <span className="text-muted-foreground">disagree</span>
              ) : (
                byKey
                  .get(key)!
                  .map((fact) => (
                    <FactLine
                      key={fact.identity}
                      workspaceId={props.workspaceId}
                      fact={fact}
                      target={entity.relations.outgoing.find(
                        (r) => r.identity === fact.identity,
                      )}
                    />
                  ))
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/**
 * A fact's value: a link for a relation, where a secret is kept for
 * `secrets-in` (never a value), "unknown" with why, and the state's words.
 */
function FactValue(props: {
  workspaceId: string
  fact: CatalogFact
  target?: CatalogOutgoingRelation | undefined
}) {
  const { fact } = props
  const link = fact.to ? (
    <EntityLink
      workspaceId={props.workspaceId}
      id={fact.to}
      entity={props.target?.entity}
    />
  ) : null
  if (fact.state === "unknown")
    return (
      <span>
        unknown
        {link && <> for {link}</>}
        {fact.note && (
          <>
            : <VisibleText text={fact.note} oneLine />
          </>
        )}
      </span>
    )
  let value: ReactNode
  if (fact.relation && link)
    value =
      fact.key === "secrets-in" ? (
        <>
          kept in {link}
          {fact.attributes?.item !== undefined && (
            <>
              {" "}
              as{" "}
              <code className="font-mono text-xs">
                <VisibleText text={valueText(fact.attributes.item)} oneLine />
              </code>
            </>
          )}
        </>
      ) : (
        link
      )
  else value = <MaybeLink text={valueText(fact.value)} />
  const attributes = Object.entries(fact.attributes ?? {}).filter(
    ([name]) => !(fact.key === "secrets-in" && name === "item"),
  )
  return (
    <span className="wrap-anywhere">
      {statePrefix[fact.state]}
      {fact.remove ? (
        <>
          remove <s>{value}</s>
        </>
      ) : (
        value
      )}
      {attributes.map(([name, v]) => (
        <span key={name} className="text-muted-foreground">
          {" "}
          · <VisibleText text={`${name}: ${valueText(v)}`} oneLine />
        </span>
      ))}
    </span>
  )
}

/** How old a fact is in words, and whether it is due; null with no check. */
function ageWords(fact: CatalogFact): { age: string; due: boolean } | null {
  const { freshness } = fact
  switch (freshness.status) {
    case "none":
      return null
    case "not-checked":
      return { age: "not checked yet", due: false }
    case "due":
      return { age: ageText(freshness.age_days ?? 0), due: true }
    case "fresh":
      return { age: ageText(freshness.age_days ?? 0), due: false }
  }
}

/** Whether a fact has anything to show one tap away. */
function hasDetails(fact: CatalogFact): boolean {
  return (
    fact.check !== null ||
    fact.via !== undefined ||
    fact.task !== undefined ||
    fact.accepted !== undefined ||
    (fact.note !== undefined && fact.state !== "unknown")
  )
}

/** One value of a fact, its age, and its check one tap away on the age. */
function FactLine(props: {
  workspaceId: string
  fact: CatalogFact
  target?: CatalogOutgoingRelation | undefined
}) {
  const { fact } = props
  const [open, setOpen] = useState(false)
  const panel = useId()
  const age = ageWords(fact)
  const details = hasDetails(fact)
  return (
    <div className="flex flex-col gap-1">
      <p className="min-w-0">
        <FactValue {...props} />
        {(age ?? details) && (
          <span className="text-muted-foreground">
            {" · "}
            {details ? (
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panel}
                onClick={() => setOpen((o) => !o)}
                className="rounded-sm underline decoration-muted-foreground/40 decoration-dotted underline-offset-4 outline-none hover:decoration-current focus-visible:ring-3 focus-visible:ring-ring"
              >
                {age?.age ?? "details"}
              </button>
            ) : (
              age?.age
            )}
            {age?.due && " · due for a recheck"}
          </span>
        )}
      </p>
      {details && open && (
        <div id={panel}>
          <CheckDetails fact={fact} />
        </div>
      )}
    </div>
  )
}

/** The fact's check: when, by whom, what was checked, the source and limits. */
function CheckDetails(props: { fact: CatalogFact }) {
  const { fact } = props
  const check = fact.check
  const rows: [string, ReactNode][] = []
  if (check) {
    rows.push(["Checked", check.checked ?? "no date (imported)"])
    if (check.by)
      rows.push([
        "By",
        <VisibleText key="by" text={byText(check.by)} oneLine />,
      ])
    if (check.scope)
      rows.push([
        "What was checked",
        <VisibleText key="scope" text={check.scope} oneLine />,
      ])
    if (check.source)
      rows.push(["Source", <MaybeLink key="source" text={check.source} />])
    if (check.limits)
      rows.push([
        "Not checked",
        <VisibleText key="limits" text={check.limits} oneLine />,
      ])
  }
  if (fact.via)
    rows.push([
      "Seen through",
      <VisibleText key="via" text={fact.via} oneLine />,
    ])
  if (fact.task)
    rows.push([
      "Planned in",
      <VisibleText key="task" text={fact.task} oneLine />,
    ])
  if (fact.note && fact.state !== "unknown")
    rows.push(["Note", <VisibleText key="note" text={fact.note} oneLine />])
  if (fact.accepted)
    rows.push([
      "Difference accepted by",
      <VisibleText key="accepted" text={fact.accepted} oneLine />,
    ])
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      {rows.map(([name, value]) => (
        <div key={name} className="contents">
          <dt>{name}</dt>
          <dd className="min-w-0 wrap-anywhere text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
