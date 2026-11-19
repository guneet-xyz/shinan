import { useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router"

import type {
  CatalogOperation,
  CatalogProposal,
  CheckInput,
} from "@shinan/api-client"

import { Button } from "@/components/ui/button"

import { useAccount } from "../../../account"
import { useApi, useResource } from "../../../api"
import { Actions, PageHeader, Section } from "../../../components/page"
import { ErrorMessage, Loading } from "../../../components/status"
import { entityPath } from "../format"
import {
  AreaField,
  CheckFields,
  ProposalForm,
  SelectField,
  TextField,
} from "./form"
import {
  checkProblems,
  cleanCheck,
  emptyCheck,
  emptyFact,
  factInput,
  factProblems,
  needsCheck,
} from "./operations"
import type { FactDraft } from "./operations"
import { BodyEditor, FactEditor } from "./SuggestChange"

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * New entity (build plan M2-8): a `create-entity` proposal, with its
 * fields, any first facts and the body. `?type=` chooses the type.
 */
export function NewEntity() {
  const api = useApi()
  const workspaceId = useParams().workspaceId!
  const types = useResource(`catalog-types:${workspaceId}`, () =>
    api.catalogTypes(workspaceId),
  )
  if (types.error) return <ErrorMessage error={types.error} />
  if (!types.data) return <Loading />
  const usable = types.data.items
    .filter((t) => t.status !== "retired")
    .map((t) => t.type)
    .sort()
  return <EntityForm workspaceId={workspaceId} types={usable} />
}

function EntityForm(props: { workspaceId: string; types: string[] }) {
  const api = useApi()
  const navigate = useNavigate()
  const { account } = useAccount()
  const [search] = useSearchParams()
  const asked = search.get("type")
  const [type, setType] = useState(
    asked && props.types.includes(asked) ? asked : (props.types[0] ?? ""),
  )
  const [slug, setSlug] = useState("")
  const [title, setTitle] = useState("")
  const [summary, setSummary] = useState("")
  const [owner, setOwner] = useState(`person/${account.person.handle}`)
  const [decisionState, setDecisionState] = useState("proposed")
  const [facts, setFacts] = useState<FactDraft[]>([])
  const [check, setCheck] = useState<CheckInput>(emptyCheck)
  const [body, setBody] = useState("")
  const schema = useResource(`catalog-type:${props.workspaceId}:${type}`, () =>
    type ? api.catalogType(props.workspaceId, type) : Promise.resolve(null),
  )
  const keys = schema.data?.schema.keys ?? []
  const id = `${type}/${slug.trim()}`
  const checkNeeded = facts.some((f) => needsCheck(f.state))

  const operations = (): CatalogOperation[] | string => {
    const problems = [
      ...(type === "" ? ["Choose a type."] : []),
      ...(slugPattern.test(slug.trim())
        ? []
        : [
            "The ID's name is lowercase words joined by hyphens, such as musashi or container-registry.",
          ]),
      ...(title.trim() === "" ? ["Give it a title."] : []),
      ...(summary.trim() === "" ? ["Give it a summary."] : []),
      ...(owner.trim() === "" ? ["Name its owner, or unknown."] : []),
      ...facts.flatMap((d, i) =>
        factProblems(d).map((p) => `Fact ${i + 1}: ${p}`),
      ),
      ...(checkNeeded ? checkProblems(check) : []),
    ]
    if (problems.length > 0) return problems.join(" ")
    const factCheck = checkNeeded ? cleanCheck(check) : null
    return [
      {
        op: "create-entity",
        id,
        title: title.trim(),
        summary: summary.trim(),
        owner: owner.trim(),
        ...(type === "decision" ? { decision: { state: decisionState } } : {}),
        ...(facts.length > 0
          ? {
              facts: facts.map((d) => {
                const fact = factInput(
                  d,
                  keys.find((k) => k.key === d.key.trim()) ?? null,
                )
                return needsCheck(fact.state) && factCheck
                  ? { fact, check: factCheck }
                  : { fact }
              }),
            }
          : {}),
        ...(body.trim() ? { body } : {}),
      },
    ]
  }
  const onApplied = (proposal: CatalogProposal) =>
    void navigate(entityPath(props.workspaceId, id), {
      state: { saved: { number: proposal.number, id: proposal.id } },
    })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="New entity">
        One page for one thing the workspace keeps track of: a machine, a
        service, a project, a person.
      </PageHeader>
      <Section title="What it is">
        <SelectField
          label="Type"
          value={type}
          options={props.types.map((t) => ({ value: t, label: t }))}
          onChange={setType}
        />
        <TextField
          label="Name in its ID"
          mono
          required
          value={slug}
          onChange={setSlug}
          placeholder="musashi"
          description={
            <>
              The ID will be <span className="font-mono">{id}</span>: lowercase
              words joined by hyphens.
            </>
          }
        />
        <TextField label="Title" required value={title} onChange={setTitle} />
        <AreaField
          label="Summary"
          required
          rows={2}
          value={summary}
          onChange={setSummary}
          description="One sentence: what it is."
        />
        <TextField
          label="Owner"
          mono
          required
          value={owner}
          onChange={setOwner}
          description="The person entity responsible for it, or unknown."
        />
        {type === "decision" && (
          <SelectField
            label="Decision state"
            value={decisionState}
            options={["proposed", "accepted", "rejected", "superseded"].map(
              (s) => ({ value: s, label: s }),
            )}
            onChange={setDecisionState}
          />
        )}
      </Section>
      <Section
        title="Facts (optional)"
        description="What you know about it now; more can be added later."
      >
        {facts.map((draft, i) => (
          <fieldset
            key={i}
            className="flex flex-col gap-3 rounded-lg border p-3 sm:p-4"
          >
            <legend className="px-1 text-sm font-medium">Fact {i + 1}</legend>
            <FactEditor
              draft={draft}
              keys={keys}
              editKey
              onChange={(next) =>
                setFacts((list) => list.map((d, j) => (j === i ? next : d)))
              }
            />
            <Actions>
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setFacts((list) => list.filter((_, j) => j !== i))
                }
              >
                Remove this fact
              </Button>
            </Actions>
          </fieldset>
        ))}
        <Actions>
          <Button
            type="button"
            variant="outline"
            onClick={() => setFacts((list) => [...list, emptyFact()])}
          >
            Add a fact
          </Button>
        </Actions>
      </Section>
      {checkNeeded && (
        <Section title="Fact check" description="How you know these facts.">
          <CheckFields check={check} onChange={setCheck} />
        </Section>
      )}
      <BodyEditor
        workspaceId={props.workspaceId}
        body={body}
        setBody={setBody}
      />
      <ProposalForm
        operations={operations()}
        explanation=""
        saveLabel="Create"
        onApplied={onApplied}
      />
    </div>
  )
}
