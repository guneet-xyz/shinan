import { useMemo } from "react"
import type { ReactNode } from "react"

import type {
  CatalogOperation,
  CheckInput,
  ExpectedCheck,
  FactInput,
  KeyOptions,
  PresentFact,
  RestoreDocument,
  StartHereStepInput,
} from "@shinan/api-client"

import { isApiError, useApi, useResource } from "../../../api"
import { ErrorMessage, Loading } from "../../../components/status"
import { diffLines } from "../diff"
import { DiffView } from "../EntityPage"
import { EntityLink } from "../facts"
import { stateLabels } from "../format"
import { visible } from "./visible"

/**
 * A proposal's changes, per document, as a reviewer reads them (human
 * experience, reviewing catalog changes): each fact before and after, with
 * the fact check that is its evidence; fields before and after; body text
 * as removed and added lines.
 */
export function ProposalChanges(props: {
  workspaceId: string
  operations: readonly CatalogOperation[]
}) {
  const groups = new Map<string, CatalogOperation[]>()
  for (const operation of props.operations) {
    const id = documentOf(operation)
    const list = groups.get(id) ?? []
    list.push(operation)
    groups.set(id, list)
  }
  return (
    <div className="flex flex-col gap-4">
      {[...groups].map(([id, operations]) => (
        <section
          key={id}
          aria-label={`Changes to ${id}`}
          className="flex flex-col gap-3 rounded-lg border p-3 sm:p-4"
        >
          <h3 className="text-sm font-semibold">
            <EntityLink workspaceId={props.workspaceId} id={id} />
          </h3>
          <ul className="flex flex-col gap-3">
            {operations.map((operation, i) => (
              <li key={i} className="flex flex-col gap-1.5 text-sm">
                <OperationView
                  workspaceId={props.workspaceId}
                  operation={operation}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function documentOf(operation: CatalogOperation): string {
  switch (operation.op) {
    case "create-entity":
      return operation.id
    case "create-schema":
      return `schema/${operation.type}`
    case "create-start-here":
    case "set-start-here-path":
      return "start-here"
    default:
      return operation.document
  }
}

function OperationView(props: {
  workspaceId: string
  operation: CatalogOperation
}) {
  const o = props.operation
  switch (o.op) {
    case "set-fact":
      return (
        <>
          <Title>
            {"absent" in o.expect
              ? o.supersedes
                ? "Settles a fact"
                : "Adds a fact"
              : "Changes a fact"}
            : <Key text={o.fact.key} /> ({stateLabels[o.fact.state]})
          </Title>
          {o.supersedes && (
            <Before>It replaces: {presentText(o.supersedes)}</Before>
          )}
          {"value" in o.expect && (
            <Before>Before: {presentText(o.expect)}</Before>
          )}
          <After>
            {"absent" in o.expect && !o.supersedes ? "" : "After: "}
            {factText(o.fact)}
          </After>
          {o.check && <Evidence check={o.check} />}
        </>
      )
    case "remove-fact":
      return (
        <>
          <Title>
            Removes a fact: <Key text={keyOf(o.expect.identity)} />
          </Title>
          <Before>{presentText(o.expect)}</Before>
        </>
      )
    case "recheck-facts":
      return (
        <>
          <Title>Records a new check, values unchanged</Title>
          <ul className="list-disc pl-5">
            {o.facts.map((f) => (
              <li key={f.identity}>
                <Key text={keyOf(f.identity)} />: {presentText(f)}
              </li>
            ))}
          </ul>
          <Evidence check={o.check} />
        </>
      )
    case "accept-discrepancy":
      return (
        <>
          <Title>
            Accepts the discrepancy in <Key text={o.key} />
          </Title>
          <After>Why: {visible(o.note)}</After>
          <ul className="list-disc pl-5">
            {o.expect.map((f) => (
              <li key={f.identity}>{presentText(f)}</li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            The person who approves it is named as accepting it.
          </p>
        </>
      )
    case "edit-body":
      return (
        <>
          <Title>
            {o.section === undefined
              ? "Changes the description"
              : o.section === null
                ? "Changes the description's opening text"
                : `Changes the description's section "${visible(o.section)}"`}
          </Title>
          <TextDiff
            before={"text" in o.expect ? o.expect.text : ""}
            after={o.text}
          />
        </>
      )
    case "set-field":
      return (
        <>
          <Title>
            Changes <Key text={o.field} />
          </Title>
          <Before>Before: {fieldText(o.expect.value)}</Before>
          <After>After: {fieldText(o.value)}</After>
        </>
      )
    case "retire":
      return (
        <>
          <Title>Retires it (it was {o.expect.status})</Title>
          {o.replacedBy && <After>Replaced by {visible(o.replacedBy)}</After>}
        </>
      )
    case "change-id":
      return (
        <>
          <Title>Changes its ID</Title>
          <After>
            New ID: <Key text={o.id} />; the old one keeps working as a former
            ID.
          </After>
        </>
      )
    case "create-entity":
      return (
        <>
          <Title>Creates the page</Title>
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 [&>dd]:wrap-anywhere [&>dt]:text-muted-foreground">
            <dt>Title</dt>
            <dd>{visible(o.title)}</dd>
            <dt>Summary</dt>
            <dd>{visible(o.summary)}</dd>
            <dt>Owner</dt>
            <dd className="font-mono">{visible(o.owner)}</dd>
            {o.decision && (
              <>
                <dt>Decision</dt>
                <dd>{visible(o.decision.state)}</dd>
              </>
            )}
          </dl>
          {(o.facts ?? []).map((f, i) => (
            <div key={i} className="flex flex-col gap-1">
              <After>
                <Key text={f.fact.key} /> ({stateLabels[f.fact.state]}):{" "}
                {factText(f.fact)}
              </After>
              {f.check && <Evidence check={f.check} />}
            </div>
          ))}
          {o.body && <TextDiff before="" after={o.body} />}
        </>
      )
    case "create-schema":
      return (
        <>
          <Title>Creates the type schema for {visible(o.type)}</Title>
          <After>
            {visible(o.title)}: {visible(o.summary)}
          </After>
          <KeyList keys={Object.entries(o.keys ?? {})} />
          {o.required && (
            <After>
              Every entity should record: {visible(o.required.join(", "))}
            </After>
          )}
          {o.sections && (
            <After>Body sections: {visible(o.sections.join(", "))}</After>
          )}
          {o.body && <TextDiff before="" after={o.body} />}
        </>
      )
    case "set-schema-key":
      return (
        <>
          <Title>
            {o.options === null
              ? "Removes the key"
              : "absent" in o.expect
                ? "Adds the key"
                : "Changes the key"}{" "}
            <Key text={o.key} />
          </Title>
          {"options" in o.expect && (
            <Before>Before: {optionsText(o.expect.options)}</Before>
          )}
          {o.options && <After>After: {optionsText(o.options)}</After>}
        </>
      )
    case "create-start-here":
      return (
        <>
          <Title>Creates Start here: {visible(o.title)}</Title>
          <Steps title="For people" steps={o.people} />
          <Steps title="For agents" steps={o.agents} />
        </>
      )
    case "restore-document":
      return <RestoreView workspaceId={props.workspaceId} operation={o} />
    case "set-start-here-path":
      return (
        <>
          <Title>
            Changes the path {o.path === "people" ? "for people" : "for agents"}
          </Title>
          <TextDiff
            before={o.expect.steps.map(stepText).join("\n")}
            after={o.steps.map(stepText).join("\n")}
          />
        </>
      )
  }
}

function Title(props: { children: ReactNode }) {
  return <p className="font-medium">{props.children}</p>
}

function Key(props: { text: string }) {
  return <span className="font-mono text-xs">{visible(props.text)}</span>
}

function Before(props: { children: ReactNode }) {
  return <p className="wrap-anywhere text-muted-foreground">{props.children}</p>
}

function After(props: { children: ReactNode }) {
  return <p className="wrap-anywhere">{props.children}</p>
}

/** A fact check, the evidence for what an operation writes. */
function Evidence(props: { check: CheckInput }) {
  const { check } = props
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5 rounded-md bg-muted/50 p-2 text-xs [&>dd]:wrap-anywhere [&>dt]:text-muted-foreground">
      <dt>Checked</dt>
      <dd>{visible(check.checked)}</dd>
      <dt>What</dt>
      <dd>{visible(check.scope)}</dd>
      <dt>How</dt>
      <dd>{visible(check.source)}</dd>
      {check.limits && (
        <>
          <dt>Not checked</dt>
          <dd>{visible(check.limits)}</dd>
        </>
      )}
    </dl>
  )
}

function TextDiff(props: { before: string; after: string }) {
  const lines = useMemo(
    () => diffLines(visible(props.before), visible(props.after)),
    [props.before, props.after],
  )
  return <DiffView lines={lines} />
}

function KeyList(props: { keys: [string, KeyOptions][] }) {
  if (props.keys.length === 0) return null
  return (
    <ul className="list-disc pl-5">
      {props.keys.map(([key, options]) => (
        <li key={key}>
          <Key text={key} /> {optionsText(options)}
        </li>
      ))}
    </ul>
  )
}

function Steps(props: { title: string; steps: readonly StartHereStepInput[] }) {
  return (
    <>
      <p className="text-muted-foreground">{props.title}:</p>
      <ol className="list-decimal pl-5">
        {props.steps.map((s, i) => (
          <li key={i}>{stepText(s)}</li>
        ))}
      </ol>
    </>
  )
}

function stepText(step: StartHereStepInput): string {
  const target =
    "to" in step ? step.to : "list" in step ? `the ${step.list} list` : step.url
  return visible(`${target}: ${step.note}`)
}

/** The key part of a fact identity key (`disk.data.size|observed` → `disk.data.size`). */
function keyOf(identity: string): string {
  return decodeURIComponent(identity.split("|")[0] ?? identity)
}

function presentText(fact: PresentFact): string {
  const parts = [fact.value === "" ? "(no value)" : fact.value]
  if (fact.via) parts.push(`via ${fact.via}`)
  if (fact.note) parts.push(`note: ${fact.note}`)
  if (fact.task) parts.push(`task ${fact.task}`)
  if (fact.remove) parts.push("planned removal")
  parts.push(checkText(fact.check))
  return visible(parts.join("; "))
}

function checkText(check: ExpectedCheck | null): string {
  if (!check) return "no fact check"
  if (check.checked === null) return "never checked"
  return `checked ${check.checked}${check.by ? ` by ${check.by}` : ""}`
}

function factText(fact: FactInput): string {
  const parts = [
    fact.to ?? (fact.value === undefined ? "" : String(fact.value)),
  ].filter((p) => p !== "")
  if (fact.via) parts.push(`via ${fact.via}`)
  if (fact.note) parts.push(`note: ${fact.note}`)
  if (fact.task) parts.push(`task ${fact.task}`)
  if (fact.remove) parts.push("planned removal")
  return visible(parts.join("; "))
}

function fieldText(value: string | readonly string[] | null): string {
  if (value === null) return "(none)"
  return visible(typeof value === "string" ? value : value.join(", "))
}

function optionsText(options: KeyOptions): string {
  const parts: string[] = []
  if (options.relation) parts.push(`relation to ${options.relation.join(", ")}`)
  if (options.many !== undefined)
    parts.push(options.many ? "many values" : "one value")
  if (options.identifiedBy)
    parts.push(`identified by ${options.identifiedBy.join(", ")}`)
  if (options.inverse) parts.push(`shown on targets as "${options.inverse}"`)
  if (options.recheck) parts.push(`recheck every ${options.recheck}`)
  return parts.length === 0 ? "a plain value" : visible(parts.join("; "))
}

/**
 * A revert's `restore-document` (catalog §8.2) carries only the text to
 * put back: it is shown against the document's current text, so a revert
 * waiting for approval shows what it changes.
 */
function RestoreView(props: {
  workspaceId: string
  operation: RestoreDocument
}) {
  const api = useApi()
  const { operation } = props
  const now = useResource(
    `catalog-text:${props.workspaceId}:${operation.document}`,
    () =>
      api
        .catalogText(props.workspaceId, operation.document)
        .catch((error: unknown) => {
          if (isApiError(error, "not-found")) return null
          throw error
        }),
  )
  return (
    <>
      <Title>Puts back the document's earlier text</Title>
      {now.error ? <ErrorMessage error={now.error} /> : null}
      {now.data === undefined && !now.error && <Loading />}
      {now.data !== undefined &&
        (now.data?.text === operation.text ? (
          <After>The document already reads as this puts it back.</After>
        ) : (
          <>
            <Before>
              Removed lines are the document as it is now (revision{" "}
              {now.data?.revision ?? "none"}); added lines are what it puts
              back.
            </Before>
            <TextDiff before={now.data?.text ?? ""} after={operation.text} />
          </>
        ))}
    </>
  )
}
