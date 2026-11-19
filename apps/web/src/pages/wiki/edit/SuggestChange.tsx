import { useId, useState } from "react"
import { Link, useNavigate, useParams } from "react-router"

import type {
  CatalogFact,
  CatalogOperation,
  CatalogProposal,
  CatalogTypeSchemaKey,
  CheckInput,
  DocumentField,
  FactState,
} from "@shinan/api-client"

import { Button } from "@/components/ui/button"

import { isApiError } from "../../../api"
import { Actions, PageHeader, Section } from "../../../components/page"
import { ErrorMessage, Loading } from "../../../components/status"
import { NotFound } from "../../NotFound"
import { FactValue, linkClass, StateLabel } from "../facts"
import { entityPath, stateLabels } from "../format"
import { Markdown } from "../markdown"
import {
  AreaField,
  CheckboxField,
  CheckFields,
  ProposalForm,
  SelectField,
  TextField,
} from "./form"
import { useEditableEntity } from "./load"
import type { Loaded } from "./load"
import {
  addFactOperation,
  bodyOperation,
  changeFactOperations,
  checkProblems,
  cleanCheck,
  draftOf,
  emptyCheck,
  emptyFact,
  factProblems,
  factShortText,
  fieldOperations,
  needsCheck,
  removeFactOperation,
} from "./operations"
import type { Editable, FactDraft } from "./operations"

/**
 * Suggest a change on an entity page (human experience, changing the
 * catalog from the wiki): its fields, facts and body, as the operations
 * agents send. No raw frontmatter (build plan M2-8, proposed).
 */
export function SuggestChange() {
  const workspaceId = useParams().workspaceId!
  const id = useParams()["*"] ?? ""
  const loaded = useEditableEntity(workspaceId, id)
  if (loaded.error) {
    if (isApiError(loaded.error, "not-found")) return <NotFound />
    return <ErrorMessage error={loaded.error} />
  }
  if (!loaded.data) return <Loading />
  return (
    <EntityEditor
      key={loaded.data.editable.revision}
      workspaceId={workspaceId}
      {...loaded.data}
    />
  )
}

type FactChoice =
  { kind: "keep" } | { kind: "change"; draft: FactDraft } | { kind: "remove" }

function EntityEditor(props: Loaded & { workspaceId: string }) {
  const { entity, editable, keys, workspaceId } = props
  const navigate = useNavigate()
  const document = editable.document
  const [fields, setFields] = useState(() => ({ ...document.fields }))
  const [body, setBody] = useState(document.body.text)
  const [choices, setChoices] = useState<Record<string, FactChoice>>({})
  const [added, setAdded] = useState<FactDraft[]>([])
  const [check, setCheck] = useState<CheckInput>(emptyCheck)
  const [retire, setRetire] = useState(false)
  const [replacedBy, setReplacedBy] = useState("")
  const [newId, setNewId] = useState("")
  const keyOf = (key: string) => keys.find((k) => k.key === key) ?? null

  const changed = entity.facts.flatMap((fact) => {
    const choice = choices[fact.identity]
    return choice?.kind === "change" ? [{ fact, draft: choice.draft }] : []
  })
  const checkNeeded = [...changed.map((c) => c.draft), ...added].some((d) =>
    needsCheck(d.state),
  )
  const operations = (): CatalogOperation[] | string => {
    const problems = [
      ...changed.flatMap((c) =>
        factProblems(c.draft).map((p) => `${c.fact.key}: ${p}`),
      ),
      ...added.flatMap((d, i) =>
        factProblems(d).map((p) => `New fact ${i + 1}: ${p}`),
      ),
      ...(checkNeeded ? checkProblems(check) : []),
      ...(retire && entity.status === "retired"
        ? ["It is already retired."]
        : []),
    ]
    if (problems.length > 0) return problems.join(" ")
    const factCheck = checkNeeded ? cleanCheck(check) : null
    const ops: CatalogOperation[] = [
      ...fieldOperations(entity.id, document, fields),
      ...entity.facts.flatMap((fact) => {
        const choice = choices[fact.identity]
        if (choice?.kind === "remove")
          return [removeFactOperation(entity.id, fact)]
        if (choice?.kind === "change")
          return changeFactOperations(
            entity.id,
            fact,
            choice.draft,
            keyOf(choice.draft.key),
            factCheck,
          )
        return []
      }),
      ...added.map((d) =>
        addFactOperation(entity.id, d, keyOf(d.key.trim()), factCheck),
      ),
      ...bodyOperation(entity.id, document, body),
      ...(retire && entity.status !== "retired"
        ? [
            {
              op: "retire" as const,
              document: entity.id,
              ...(replacedBy.trim() ? { replacedBy: replacedBy.trim() } : {}),
              expect: { status: entity.status as "active" | "deprecated" },
            },
          ]
        : []),
      ...(newId.trim() && newId.trim() !== entity.id
        ? [{ op: "change-id" as const, document: entity.id, id: newId.trim() }]
        : []),
    ]
    return ops.length === 0 ? "Change something first." : ops
  }

  const onApplied = (proposal: CatalogProposal) => {
    const to = newId.trim() || entity.id
    void navigate(entityPath(workspaceId, to), {
      state: { saved: { number: proposal.number, id: proposal.id } },
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`Suggest a change: ${entity.title ?? entity.id}`}>
        <span className="font-mono">{entity.id}</span> ·{" "}
        <Link to={entityPath(workspaceId, entity.id)} className={linkClass}>
          Back to the page
        </Link>
      </PageHeader>
      <FieldsSection
        editable={document}
        fields={fields}
        setFields={setFields}
        isDecision={entity.type === "decision"}
      />
      <Section
        title="Facts"
        description="Change or remove a fact, or add one. New and changed facts that say what is (observed) or should be (intended) need a fact check."
      >
        {entity.facts.length === 0 && (
          <p className="text-sm text-muted-foreground">No facts yet.</p>
        )}
        <ul className="flex flex-col divide-y rounded-lg border">
          {entity.facts.map((fact) => (
            <FactChoiceRow
              key={fact.identity}
              keys={keys}
              workspaceId={workspaceId}
              fact={fact}
              choice={choices[fact.identity] ?? { kind: "keep" }}
              onChange={(choice) =>
                setChoices((c) => ({ ...c, [fact.identity]: choice }))
              }
            />
          ))}
        </ul>
        {added.map((draft, i) => (
          <fieldset
            key={i}
            className="flex flex-col gap-3 rounded-lg border p-3 sm:p-4"
          >
            <legend className="px-1 text-sm font-medium">
              New fact {i + 1}
            </legend>
            <FactEditor
              draft={draft}
              keys={keys}
              editKey
              onChange={(next) =>
                setAdded((list) => list.map((d, j) => (j === i ? next : d)))
              }
            />
            <Actions>
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setAdded((list) => list.filter((_, j) => j !== i))
                }
              >
                Remove this new fact
              </Button>
            </Actions>
          </fieldset>
        ))}
        <Actions>
          <Button
            type="button"
            variant="outline"
            onClick={() => setAdded((list) => [...list, emptyFact()])}
          >
            Add a fact
          </Button>
        </Actions>
      </Section>
      {checkNeeded && (
        <Section
          title="Fact check"
          description="How you know the new and changed facts. It is written once, for all of them."
        >
          <CheckFields check={check} onChange={setCheck} />
        </Section>
      )}
      <BodyEditor workspaceId={workspaceId} body={body} setBody={setBody} />
      {entity.status !== "retired" && (
        <Section
          title="Retire or rename"
          description="These need catalog approval: retiring keeps the page for its history, and a new ID keeps the old one working."
        >
          <CheckboxField
            label={`Retire this ${entity.type ?? "entity"}`}
            checked={retire}
            onChange={setRetire}
          />
          {retire && (
            <TextField
              label="Replaced by (optional)"
              mono
              value={replacedBy}
              onChange={setReplacedBy}
              placeholder="machine/musashi-2"
            />
          )}
          <TextField
            label="New ID (optional)"
            mono
            value={newId}
            onChange={setNewId}
            placeholder={entity.id}
            description="Same type; the current ID becomes a former ID."
          />
        </Section>
      )}
      <ProposalForm operations={operations()} onApplied={onApplied} />
    </div>
  )
}

/** Title, summary, owner, status; a decision's fields. */
export function FieldsSection(props: {
  editable: Editable
  fields: Partial<Record<DocumentField, string | string[] | null>>
  setFields: (
    update: (
      fields: Partial<Record<DocumentField, string | string[] | null>>,
    ) => Partial<Record<DocumentField, string | string[] | null>>,
  ) => void
  isDecision?: boolean
  statusChoices?: readonly ("active" | "deprecated")[]
}) {
  const { fields, editable } = props
  const text = (name: DocumentField) => {
    const value = fields[name]
    return typeof value === "string" ? value : ""
  }
  const set = (name: DocumentField) => (value: string) =>
    props.setFields((f) => ({
      ...f,
      [name]: value === "" && !isRequired(name) ? null : value,
    }))
  const has = (name: DocumentField) => name in editable.fields
  const status = text("status")
  return (
    <Section title="Fields">
      {has("title") && (
        <TextField
          label="Title"
          required
          value={text("title")}
          onChange={set("title")}
        />
      )}
      {has("summary") && (
        <AreaField
          label="Summary"
          required={isRequired("summary")}
          rows={2}
          value={text("summary")}
          onChange={set("summary")}
          description="One sentence: what it is."
        />
      )}
      {has("owner") && (
        <TextField
          label="Owner"
          mono
          value={text("owner")}
          onChange={set("owner")}
          placeholder="person/guneet"
          description="The person entity responsible for it, or unknown. A new owner needs catalog approval."
        />
      )}
      {has("status") && (status === "active" || status === "deprecated") && (
        <SelectField
          label="Status"
          value={status}
          options={[
            { value: "active", label: "Active" },
            {
              value: "deprecated",
              label: "Deprecated: still there, not for new work",
            },
          ]}
          onChange={set("status")}
          description="Retiring is below. A change of status needs catalog approval."
        />
      )}
      {props.isDecision && has("decision_state") && (
        <>
          <SelectField
            label="Decision state"
            value={text("decision_state") || "proposed"}
            options={["proposed", "accepted", "rejected", "superseded"].map(
              (s) => ({ value: s, label: s }),
            )}
            onChange={set("decision_state")}
            description="Accepting, rejecting or superseding a decision needs catalog approval."
          />
          <TextField
            label="Decided on (optional)"
            mono
            value={text("decided_on")}
            onChange={set("decided_on")}
            placeholder="2026-11-18"
          />
          <TextField
            label="Decided by (optional)"
            mono
            value={text("decided_by")}
            onChange={set("decided_by")}
            placeholder="person/guneet"
          />
        </>
      )}
    </Section>
  )
}

function isRequired(name: DocumentField): boolean {
  return ["title", "summary", "status", "owner", "decision_state"].includes(
    name,
  )
}

function FactChoiceRow(props: {
  keys: readonly CatalogTypeSchemaKey[]
  workspaceId: string
  fact: CatalogFact
  choice: FactChoice
  onChange: (choice: FactChoice) => void
}) {
  const { fact, choice } = props
  return (
    <li className="flex flex-col gap-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="font-mono text-xs text-muted-foreground">
          {fact.key}
        </span>
        <StateLabel state={fact.state} />
      </div>
      <FactValue workspaceId={props.workspaceId} fact={fact} />
      <SelectField
        label={`What to do with ${fact.key} (${stateLabels[fact.state]}: ${factShortText(fact)})`}
        value={choice.kind}
        options={[
          { value: "keep", label: "Keep as it is" },
          { value: "change", label: "Change it" },
          { value: "remove", label: "Remove it" },
        ]}
        onChange={(kind) =>
          props.onChange(
            kind === "change" ? { kind, draft: draftOf(fact) } : { kind },
          )
        }
      />
      {choice.kind === "change" && (
        <FactEditor
          draft={choice.draft}
          keys={props.keys}
          onChange={(draft) => props.onChange({ kind: "change", draft })}
        />
      )}
      {choice.kind === "remove" && (
        <p className="text-sm text-muted-foreground">
          Removed when you save. To say it is no longer true, you may instead
          record what is true now.
        </p>
      )}
    </li>
  )
}

const states: readonly FactState[] = [
  "observed",
  "intended",
  "planned",
  "unknown",
]

/** One fact being written: key, state, value or target, note, task. */
export function FactEditor(props: {
  draft: FactDraft
  keys: readonly CatalogTypeSchemaKey[]
  /** Whether the key can be written: only for a new fact. */
  editKey?: boolean
  onChange: (draft: FactDraft) => void
}) {
  const { draft } = props
  const set = (change: Partial<FactDraft>) =>
    props.onChange({ ...draft, ...change })
  const key = props.keys.find((k) => k.key === draft.key.trim())
  const listId = useId()
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {props.editKey && (
        <div className="flex flex-col gap-1">
          <TextField
            label="Key"
            mono
            required
            value={draft.key}
            list={listId}
            onChange={(k) => set({ key: k })}
            description={
              key
                ? key.relation
                  ? `A relation to ${key.relation.targets.join(" or ")}.`
                  : "A key of the type schema."
                : props.keys.length > 0
                  ? `The type schema's keys: ${props.keys.map((k) => k.key).join(", ")}. Others are allowed but flagged.`
                  : undefined
            }
          />
          <datalist id={listId}>
            {props.keys.map((k) => (
              <option key={k.key} value={k.key} />
            ))}
          </datalist>
        </div>
      )}
      <SelectField
        label="State"
        value={draft.state}
        options={states.map((s) => ({ value: s, label: stateLabels[s] }))}
        onChange={(state) => set({ state })}
      />
      {draft.state !== "unknown" && (
        <TextField
          label={key?.relation ? "Target (an entity ID)" : "Value"}
          mono={Boolean(key?.relation)}
          required
          value={draft.value}
          onChange={(value) => set({ value })}
        />
      )}
      <TextField
        label={
          draft.state === "unknown" ? "Why it is unknown" : "Note (optional)"
        }
        required={draft.state === "unknown"}
        value={draft.note}
        onChange={(note) => set({ note })}
      />
      {draft.state === "planned" && (
        <TextField
          label="Task or accepted decision behind the plan"
          mono
          required
          value={draft.task}
          onChange={(task) => set({ task })}
          placeholder="SHN-12"
        />
      )}
    </div>
  )
}

/** The body as Markdown, with a preview rendered as the page shows it. */
export function BodyEditor(props: {
  workspaceId: string
  body: string
  setBody: (body: string) => void
}) {
  const [preview, setPreview] = useState(false)
  return (
    <Section
      title="Description"
      description="The page's text, in Markdown. Link to other pages by their ID, such as [Musashi](machine/musashi)."
    >
      <Actions>
        <Button
          type="button"
          variant={preview ? "outline" : "secondary"}
          aria-pressed={!preview}
          onClick={() => setPreview(false)}
        >
          Write
        </Button>
        <Button
          type="button"
          variant={preview ? "secondary" : "outline"}
          aria-pressed={preview}
          onClick={() => setPreview(true)}
        >
          Preview
        </Button>
      </Actions>
      {preview ? (
        <div className="rounded-lg border p-3 sm:p-4">
          {props.body.trim() === "" ? (
            <p className="text-sm text-muted-foreground">Nothing written.</p>
          ) : (
            <Markdown
              text={props.body}
              entityPath={(id) => entityPath(props.workspaceId, id)}
            />
          )}
        </div>
      ) : (
        <AreaField
          label="Description (Markdown)"
          mono
          rows={14}
          value={props.body}
          onChange={props.setBody}
        />
      )}
    </Section>
  )
}
