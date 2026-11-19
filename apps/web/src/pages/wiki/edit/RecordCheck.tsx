import { useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router"

import type { CatalogProposal, CheckInput } from "@shinan/api-client"

import { isApiError } from "../../../api"
import { PageHeader, Section } from "../../../components/page"
import { ErrorMessage, Loading } from "../../../components/status"
import { NotFound } from "../../NotFound"
import { CheckDetails, FactValue, linkClass, StateLabel } from "../facts"
import { entityPath } from "../format"
import { CheckboxField, CheckFields, ProposalForm } from "./form"
import { useEditableEntity } from "./load"
import type { Loaded } from "./load"
import {
  checkProblems,
  emptyCheck,
  factShortText,
  needsCheck,
  recheckOperation,
} from "./operations"

/**
 * Record a check (human experience, changing the catalog from the wiki):
 * a person says they checked facts whose values did not change. It cannot
 * be saved without what was checked (the scope) and how (the source).
 */
export function RecordCheck() {
  const workspaceId = useParams().workspaceId!
  const id = useParams()["*"] ?? ""
  const loaded = useEditableEntity(workspaceId, id)
  if (loaded.error) {
    if (isApiError(loaded.error, "not-found")) return <NotFound />
    return <ErrorMessage error={loaded.error} />
  }
  if (!loaded.data) return <Loading />
  return <CheckEditor workspaceId={workspaceId} {...loaded.data} />
}

function CheckEditor(props: Loaded & { workspaceId: string }) {
  const { entity, workspaceId } = props
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const checkable = entity.facts.filter((f) => needsCheck(f.state))
  const [chosen, setChosen] = useState<ReadonlySet<string>>(
    () => new Set(search.getAll("fact")),
  )
  const [check, setCheck] = useState<CheckInput>(emptyCheck)
  const facts = checkable.filter((f) => chosen.has(f.identity))
  const problems = [
    ...(facts.length === 0 ? ["Choose the facts you checked."] : []),
    ...checkProblems(check),
  ]
  const onApplied = (proposal: CatalogProposal) =>
    void navigate(entityPath(workspaceId, entity.id), {
      state: { saved: { number: proposal.number, id: proposal.id } },
    })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`Record a check: ${entity.title ?? entity.id}`}>
        <span className="font-mono">{entity.id}</span> ·{" "}
        <Link to={entityPath(workspaceId, entity.id)} className={linkClass}>
          Back to the page
        </Link>
      </PageHeader>
      <Section
        title="Facts you checked"
        description="Their values stay as they are; only their fact check is new. If a value is different now, use Suggest a change."
      >
        {checkable.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This page has no facts that say what is or should be.
          </p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {checkable.map((fact) => (
              <li
                key={fact.identity}
                className="flex flex-col gap-2 p-3 sm:p-4"
              >
                <CheckboxField
                  label={
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-xs">{fact.key}</span>
                      <StateLabel state={fact.state} />
                      <span className="sr-only">{factShortText(fact)}</span>
                    </span>
                  }
                  checked={chosen.has(fact.identity)}
                  onChange={(on) =>
                    setChosen((set) => {
                      const next = new Set(set)
                      if (on) next.add(fact.identity)
                      else next.delete(fact.identity)
                      return next
                    })
                  }
                />
                <div className="pl-6">
                  <FactValue workspaceId={workspaceId} fact={fact} />
                  <CheckDetails fact={fact} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section
        title="How you checked"
        description="What was checked and how are required: a date alone says nothing about how it was known."
      >
        <CheckFields check={check} onChange={setCheck} />
      </Section>
      <ProposalForm
        operations={
          problems.length > 0
            ? problems.join(" ")
            : [recheckOperation(entity.id, facts, check)]
        }
        explanation={`Rechecked ${entity.id}.`}
        saveLabel="Save the check"
        onApplied={onApplied}
      />
    </div>
  )
}
