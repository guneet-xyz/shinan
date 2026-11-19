import { useState } from "react"
import type { FormEvent } from "react"
import { Link, useParams } from "react-router"

import type {
  CatalogDocumentTextAnswer,
  CatalogProposalOutcome,
} from "@shinan/api-client"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"

import { useAction } from "../../action"
import { isApiError, useApi, useResource } from "../../api"
import { PageHeader, Section } from "../../components/page"
import {
  ErrorAlert,
  ErrorMessage,
  Loading,
  Notice,
} from "../../components/status"
import { NotFound } from "../NotFound"
import { useWorkspace } from "../workspace/context"
import { linkClass } from "./facts"
import { entityPath } from "./format"

/**
 * Repairing a page (catalog §8.3; human experience, the wiki): a workspace
 * owner corrects the whole text of a document that reads with problems,
 * such as a fact the parser no longer reads, which no other change can
 * name. The server decides who may and judges the result: it is refused if
 * it adds a problem the page did not already have.
 */
export function RepairPage() {
  const api = useApi()
  const { workspace } = useWorkspace()
  const id = useParams()["*"] ?? ""
  const text = useResource(`catalog-text:${workspace.id}:${id}`, () =>
    api.catalogText(workspace.id, id),
  )
  const entity = useResource(`catalog-entity:${workspace.id}:${id}`, () =>
    api.catalogEntity(workspace.id, id),
  )

  if (workspace.role !== "owner")
    return (
      <Section title="Repair a page">
        <p className="text-sm text-muted-foreground">
          Only workspace owners repair pages.
        </p>
      </Section>
    )
  if (text.error) {
    if (isApiError(text.error, "not-found")) return <NotFound />
    return <ErrorMessage error={text.error} />
  }
  if (!text.data) return <Loading />
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`Repair ${text.data.id}`}>
        Correct the page&apos;s whole text, as stored.
      </PageHeader>
      {entity.data && entity.data.entity.problems.length > 0 && (
        <Section title="What could not be read">
          <ul className="list-disc pl-5 text-sm">
            {entity.data.entity.problems.map((p, i) => (
              <li key={i}>{p.message}</li>
            ))}
          </ul>
        </Section>
      )}
      <RepairForm
        key={text.data.revision}
        stored={text.data}
        onRepaired={() => {
          text.reload()
          entity.reload()
        }}
      />
    </div>
  )
}

function RepairForm(props: {
  stored: CatalogDocumentTextAnswer
  onRepaired: () => void
}) {
  const api = useApi()
  const { workspace } = useWorkspace()
  const [text, setText] = useState(props.stored.text)
  const [explanation, setExplanation] = useState("")
  const [outcome, setOutcome] = useState<CatalogProposalOutcome>()
  const repair = useAction()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setOutcome(undefined)
    repair.run(
      () =>
        api
          .repairCatalogDocument(workspace.id, {
            id: props.stored.id,
            revision: props.stored.revision,
            text,
            explanation,
          })
          .then(setOutcome),
      () => undefined,
    )
  }

  const applied =
    outcome && "proposal" in outcome && outcome.outcome === "applied"
      ? outcome.proposal
      : undefined
  const problems = outcome && "problems" in outcome ? outcome.problems : []

  return (
    <Section
      title="Corrected text"
      description={`Revision ${props.stored.revision}. Saving replaces the whole text at once, as your approval, and the security log records it. It is refused if it adds a problem the page did not already have; problems it already had may stay.`}
    >
      <form onSubmit={submit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="repair-text">
              The page&apos;s whole text
            </FieldLabel>
            <Textarea
              id="repair-text"
              className="min-h-96 font-mono text-sm md:text-xs"
              spellCheck={false}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="repair-explanation">
              Why (explanation)
            </FieldLabel>
            <Textarea
              id="repair-explanation"
              required
              rows={2}
              value={explanation}
              onChange={(event) => setExplanation(event.target.value)}
            />
            <FieldDescription>Kept with the change.</FieldDescription>
          </Field>
          <div>
            <Button
              type="submit"
              disabled={
                repair.pending ||
                text === props.stored.text ||
                explanation.trim() === ""
              }
            >
              Save the repair
            </Button>
          </div>
        </FieldGroup>
      </form>
      {repair.error !== undefined && <ErrorMessage error={repair.error} />}
      {outcome?.outcome === "unchanged" && (
        <Notice>The text is as stored; nothing changed.</Notice>
      )}
      {problems.length > 0 && (
        <ErrorAlert>
          <p>
            {outcome?.outcome === "conflict"
              ? "The page changed meanwhile:"
              : "The repair was not saved:"}
          </p>
          <ul className="list-disc pl-5">
            {problems.map((p, i) => (
              <li key={i}>{p.message}</li>
            ))}
          </ul>
        </ErrorAlert>
      )}
      {applied && (
        <Notice>
          Repaired as revision {applied.appliedRevision}.{" "}
          <Link
            to={entityPath(workspace.id, props.stored.id)}
            className={linkClass}
            onClick={props.onRepaired}
          >
            Back to the page
          </Link>
        </Notice>
      )}
    </Section>
  )
}
