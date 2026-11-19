import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router"

import type {
  CatalogEditableAnswer,
  CatalogOperation,
  CatalogProposal,
  StartHereList,
  StartHereStepInput,
} from "@shinan/api-client"

import { Button } from "@/components/ui/button"

import { useAccount } from "../../../account"
import { isApiError, useApi, useResource } from "../../../api"
import { Actions, PageHeader, Section } from "../../../components/page"
import { ErrorMessage, Loading } from "../../../components/status"
import { linkClass } from "../facts"
import { wikiPath } from "../format"
import { AreaField, ProposalForm, SelectField, TextField } from "./form"
import {
  bodyOperation,
  fieldOperations,
  sameSteps,
  stepDraftOf,
  stepInput,
} from "./operations"
import type { StepDraft } from "./operations"
import { BodyEditor } from "./SuggestChange"

/** The workspace lists a start-here step may point to (catalog §11). */
const startHereLists: readonly StartHereList[] = [
  "discrepancies",
  "due-for-recheck",
  "known-unknowns",
  "recent-changes",
  "waiting-for-approval",
]

/**
 * Changing the start-here document from its page (human experience, start
 * here; catalog §11): its two paths, title, summary and owner. Changing it
 * needs catalog approval (O-18).
 */
export function StartHereEditor() {
  const api = useApi()
  const workspaceId = useParams().workspaceId!
  const editable = useResource(`editable:${workspaceId}:start-here`, () =>
    api.catalogEditable(workspaceId, "start-here").catch((error: unknown) => {
      if (isApiError(error, "not-found")) return null
      throw error
    }),
  )
  if (editable.error) return <ErrorMessage error={editable.error} />
  if (editable.data === undefined) return <Loading />
  return (
    <PathsEditor
      key={editable.data?.revision ?? 0}
      workspaceId={workspaceId}
      editable={editable.data}
    />
  )
}

function PathsEditor(props: {
  workspaceId: string
  editable: CatalogEditableAnswer | null
}) {
  const navigate = useNavigate()
  const { account } = useAccount()
  const document = props.editable?.document
  const text = (name: "title" | "summary" | "owner") => {
    const value = document?.fields[name]
    return typeof value === "string" ? value : ""
  }
  const [title, setTitle] = useState(text("title") || "Start here")
  const [summary, setSummary] = useState(text("summary"))
  const [owner, setOwner] = useState(
    document ? text("owner") : `person/${account.person.handle}`,
  )
  const [people, setPeople] = useState<StepDraft[]>(
    () => document?.paths?.people.map(stepDraftOf) ?? [],
  )
  const [agents, setAgents] = useState<StepDraft[]>(
    () => document?.paths?.agents.map(stepDraftOf) ?? [],
  )
  const [body, setBody] = useState(document?.body.text ?? "")

  const operations = (): CatalogOperation[] | string => {
    const steps = [...people, ...agents]
    const problems = [
      ...(title.trim() === "" ? ["Give it a title."] : []),
      ...(steps.some((s) => s.target.trim() === "")
        ? ["Every step needs what it points to."]
        : []),
      ...(steps.some((s) => s.note.trim() === "")
        ? ["Every step needs a sentence saying why to read it."]
        : []),
    ]
    if (problems.length > 0) return problems.join(" ")
    const peopleSteps = people.map(stepInput)
    const agentSteps = agents.map(stepInput)
    if (!document)
      return [
        {
          op: "create-start-here",
          title: title.trim(),
          ...(summary.trim() ? { summary: summary.trim() } : {}),
          ...(owner.trim() ? { owner: owner.trim() } : {}),
          people: peopleSteps,
          agents: agentSteps,
          ...(body.trim() ? { body } : {}),
        },
      ]
    const path = (
      name: "people" | "agents",
      now: StartHereStepInput[],
    ): CatalogOperation[] => {
      const was = document.paths?.[name] ?? []
      return sameSteps(was, now)
        ? []
        : [
            {
              op: "set-start-here-path",
              path: name,
              steps: now,
              expect: { steps: was },
            },
          ]
    }
    const ops = [
      ...fieldOperations("start-here", document, {
        title: title.trim(),
        summary: summary.trim() || null,
        owner: owner.trim() || null,
      }),
      ...path("people", peopleSteps),
      ...path("agents", agentSteps),
      ...bodyOperation("start-here", document, body),
    ]
    return ops.length === 0 ? "Change something first." : ops
  }
  const onApplied = (proposal: CatalogProposal) =>
    void navigate(wikiPath(props.workspaceId, "/start-here"), {
      state: { saved: { number: proposal.number, id: proposal.id } },
    })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={document ? "Suggest a change: Start here" : "Write Start here"}
      >
        The short paths through this catalog, for people and for agents.
        Changing them needs catalog approval. ·{" "}
        <Link
          to={wikiPath(props.workspaceId, "/start-here")}
          className={linkClass}
        >
          Back to Start here
        </Link>
      </PageHeader>
      <Section title="Fields">
        <TextField label="Title" required value={title} onChange={setTitle} />
        <AreaField
          label="Summary (optional)"
          rows={2}
          value={summary}
          onChange={setSummary}
        />
        <TextField
          label="Owner (optional)"
          mono
          value={owner}
          onChange={setOwner}
        />
      </Section>
      <StepsEditor
        title="For people"
        description="Numbered steps a new member reads in order."
        steps={people}
        setSteps={setPeople}
      />
      <StepsEditor
        title="For agents"
        description="What every agent session reads when it starts: keep it short."
        steps={agents}
        setSteps={setAgents}
      />
      <BodyEditor
        workspaceId={props.workspaceId}
        body={body}
        setBody={setBody}
      />
      <ProposalForm operations={operations()} onApplied={onApplied} />
    </div>
  )
}

function StepsEditor(props: {
  title: string
  description: string
  steps: StepDraft[]
  setSteps: (update: (steps: StepDraft[]) => StepDraft[]) => void
}) {
  const update = (i: number, change: Partial<StepDraft>) =>
    props.setSteps((list) =>
      list.map((s, j) => (j === i ? { ...s, ...change } : s)),
    )
  const move = (i: number, by: number) =>
    props.setSteps((list) => {
      const next = [...list]
      const [step] = next.splice(i, 1)
      next.splice(i + by, 0, step!)
      return next
    })
  return (
    <Section title={props.title} description={props.description}>
      {props.steps.length === 0 && (
        <p className="text-sm text-muted-foreground">No steps yet.</p>
      )}
      <ol className="flex flex-col gap-3">
        {props.steps.map((step, i) => (
          <li key={i}>
            <fieldset className="flex flex-col gap-3 rounded-lg border p-3 sm:p-4">
              <legend className="px-1 text-sm font-medium">
                {props.title}: step {i + 1}
              </legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  label="Points to"
                  value={step.kind}
                  options={[
                    { value: "to", label: "A catalog page" },
                    { value: "list", label: "A workspace list" },
                    { value: "url", label: "A web address" },
                  ]}
                  onChange={(kind) =>
                    update(i, {
                      kind,
                      target: kind === "list" ? startHereLists[0]! : "",
                    })
                  }
                />
                {step.kind === "list" ? (
                  <SelectField
                    label="List"
                    value={step.target}
                    options={startHereLists.map((l) => ({
                      value: l,
                      label: l.replace(/-/g, " "),
                    }))}
                    onChange={(target) => update(i, { target })}
                  />
                ) : (
                  <TextField
                    label={step.kind === "to" ? "Page ID" : "Web address"}
                    mono
                    required
                    value={step.target}
                    onChange={(target) => update(i, { target })}
                    placeholder={
                      step.kind === "to" ? "machine/musashi" : "https://"
                    }
                  />
                )}
              </div>
              <TextField
                label="Why read it"
                required
                value={step.note}
                onChange={(note) => update(i, { note })}
              />
              <Actions>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  Move up
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={i === props.steps.length - 1}
                  onClick={() => move(i, 1)}
                >
                  Move down
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    props.setSteps((list) => list.filter((_, j) => j !== i))
                  }
                >
                  Remove
                </Button>
              </Actions>
            </fieldset>
          </li>
        ))}
      </ol>
      <Actions>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            props.setSteps((list) => [
              ...list,
              { kind: "to", target: "", note: "" },
            ])
          }
        >
          Add a step
        </Button>
      </Actions>
    </Section>
  )
}
