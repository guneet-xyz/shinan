import { useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router"

import type {
  CatalogEditableAnswer,
  CatalogOperation,
  CatalogProposal,
  DocumentField,
  KeyOptions,
} from "@shinan/api-client"

import { Button } from "@/components/ui/button"

import { useAccount } from "../../../account"
import { isApiError, useApi, useResource } from "../../../api"
import { Actions, PageHeader, Section } from "../../../components/page"
import { ErrorMessage, Loading } from "../../../components/status"
import { NotFound } from "../../NotFound"
import { linkClass } from "../facts"
import { wikiPath } from "../format"
import {
  AreaField,
  CheckboxField,
  ProposalForm,
  SelectField,
  TextField,
} from "./form"
import {
  bodyOperation,
  emptyKey,
  fieldOperations,
  keyDraftOf,
  keyOptions,
  listOf,
  sameOptions,
} from "./operations"
import type { KeyDraft } from "./operations"
import { BodyEditor } from "./SuggestChange"

const typePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const keyPattern = /^[a-z][a-z0-9_]*(?:[.-][a-z0-9_]+)*$/

function keyProblems(drafts: readonly KeyDraft[]): string[] {
  return drafts.flatMap((d) => {
    const name = d.key.trim() || "(no name)"
    return [
      ...(keyPattern.test(d.key.trim())
        ? []
        : [
            `"${name}" is not a key: lowercase words joined by ".", "-" or "_".`,
          ]),
      ...(d.recheck.trim() && !/^[1-9]\d*$/.test(d.recheck.trim())
        ? [`${name}: the recheck interval is a whole number of days.`]
        : []),
      ...(listOf(d.relation).some((t) => !typePattern.test(t))
        ? [`${name}: relation targets are type names, such as machine.`]
        : []),
    ]
  })
}

/** Rules about a type, said once on both type editors. */
const rulesNote =
  "Type schemas are rules: a change needs catalog approval, and one that would break current entities of the type is refused."

/**
 * New type (build plan M2-8): a type schema document proposal
 * (`create-schema`, catalog §3.9). Naming a built-in type extends it.
 */
export function NewType() {
  const navigate = useNavigate()
  const workspaceId = useParams().workspaceId!
  const { account } = useAccount()
  const [search] = useSearchParams()
  const [type, setType] = useState(search.get("type") ?? "")
  const [title, setTitle] = useState("")
  const [summary, setSummary] = useState("")
  const [owner, setOwner] = useState(`person/${account.person.handle}`)
  const [keys, setKeys] = useState<KeyDraft[]>([emptyKey()])
  const [required, setRequired] = useState("")
  const [sections, setSections] = useState("")
  const [body, setBody] = useState("")
  const named = keys.filter((k) => k.key.trim() !== "")

  const operations = (): CatalogOperation[] | string => {
    const problems = [
      ...(typePattern.test(type.trim())
        ? []
        : [
            "The type's name is lowercase words joined by hyphens, such as dns-zone.",
          ]),
      ...(title.trim() === "" ? ["Give it a title."] : []),
      ...(summary.trim() === "" ? ["Give it a summary."] : []),
      ...keyProblems(named),
    ]
    if (problems.length > 0) return problems.join(" ")
    return [
      {
        op: "create-schema",
        type: type.trim(),
        title: title.trim(),
        summary: summary.trim(),
        owner: owner.trim(),
        ...(named.length > 0
          ? {
              keys: Object.fromEntries(
                named.map((k) => [k.key.trim(), keyOptions(k)]),
              ),
            }
          : {}),
        ...(listOf(required).length > 0 ? { required: listOf(required) } : {}),
        ...(listOf(sections).length > 0 ? { sections: listOf(sections) } : {}),
        ...(body.trim() ? { body } : {}),
      },
    ]
  }
  const onApplied = (proposal: CatalogProposal) =>
    void navigate(wikiPath(workspaceId, `/types/${type.trim()}`), {
      state: { saved: { number: proposal.number, id: proposal.id } },
    })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="New type">
        A type of entity this workspace keeps, with the keys its facts use.
        Naming a built-in type, such as machine, adds keys to it. {rulesNote}
      </PageHeader>
      <Section title="The type">
        <TextField
          label="Type name"
          mono
          required
          value={type}
          onChange={setType}
          placeholder="dns-zone"
          description={
            type.trim() ? (
              <>
                Its schema will be{" "}
                <span className="font-mono">schema/{type.trim()}</span>, and its
                entities <span className="font-mono">{type.trim()}/…</span>.
              </>
            ) : undefined
          }
        />
        <TextField label="Title" required value={title} onChange={setTitle} />
        <AreaField
          label="Summary"
          required
          rows={2}
          value={summary}
          onChange={setSummary}
        />
        <TextField
          label="Owner"
          mono
          required
          value={owner}
          onChange={setOwner}
        />
      </Section>
      <KeysSection drafts={keys} setDrafts={setKeys} />
      <ListsSection
        required={required}
        setRequired={setRequired}
        sections={sections}
        setSections={setSections}
      />
      <BodyEditor workspaceId={workspaceId} body={body} setBody={setBody} />
      <ProposalForm
        operations={operations()}
        saveLabel="Create the type"
        onApplied={onApplied}
      />
    </div>
  )
}

/** Changing a type schema document (`schema/<type>`), from its type's page. */
export function EditType(props: { type: string }) {
  const api = useApi()
  const workspaceId = useParams().workspaceId!
  const id = `schema/${props.type}`
  const editable = useResource(`editable:${workspaceId}:${id}`, () =>
    api.catalogEditable(workspaceId, id),
  )
  if (editable.error) {
    if (isApiError(editable.error, "not-found")) return <NotFound />
    return <ErrorMessage error={editable.error} />
  }
  if (!editable.data) return <Loading />
  return (
    <TypeEditor
      key={editable.data.revision}
      workspaceId={workspaceId}
      type={props.type}
      editable={editable.data}
    />
  )
}

type KeyChoice =
  { kind: "keep" } | { kind: "change"; draft: KeyDraft } | { kind: "remove" }

function TypeEditor(props: {
  workspaceId: string
  type: string
  editable: CatalogEditableAnswer
}) {
  const navigate = useNavigate()
  const id = `schema/${props.type}`
  const document = props.editable.document
  const written = document.keys ?? []
  const listText = (name: DocumentField) => {
    const value = document.fields[name]
    return Array.isArray(value) ? value.join(", ") : ""
  }
  const text = (name: DocumentField) => {
    const value = document.fields[name]
    return typeof value === "string" ? value : ""
  }
  const [title, setTitle] = useState(text("title"))
  const [summary, setSummary] = useState(text("summary"))
  const [owner, setOwner] = useState(text("owner"))
  const [status, setStatus] = useState(text("status") || "active")
  const [choices, setChoices] = useState<Record<string, KeyChoice>>({})
  const [added, setAdded] = useState<KeyDraft[]>([])
  const [required, setRequired] = useState(listText("required"))
  const [sections, setSections] = useState(listText("sections"))
  const [retire, setRetire] = useState(false)
  const [body, setBody] = useState(document.body.text)

  const operations = (): CatalogOperation[] | string => {
    const changed = written.flatMap((k) => {
      const choice = choices[k.key]
      return choice?.kind === "change" ? [choice.draft] : []
    })
    const named = added.filter((k) => k.key.trim() !== "")
    const problems = keyProblems([...changed, ...named])
    if (problems.length > 0) return problems.join(" ")
    const lists = (value: string, name: DocumentField) =>
      listOf(value).length > 0 || name in document.fields
        ? { [name]: listOf(value).length > 0 ? listOf(value) : null }
        : {}
    const ops: CatalogOperation[] = [
      ...fieldOperations(id, document, {
        title: title.trim(),
        summary: summary.trim(),
        owner: owner.trim(),
        ...(status === "active" || status === "deprecated" ? { status } : {}),
        ...lists(required, "required"),
        ...lists(sections, "sections"),
      }),
      ...written.flatMap((k): CatalogOperation[] => {
        const choice = choices[k.key]
        if (choice?.kind === "remove")
          return [
            {
              op: "set-schema-key",
              document: id,
              key: k.key,
              options: null,
              expect: { options: k.options },
            },
          ]
        if (choice?.kind !== "change") return []
        const options: KeyOptions = keyOptions(choice.draft, k.options)
        return sameOptions(options, k.options)
          ? []
          : [
              {
                op: "set-schema-key",
                document: id,
                key: k.key,
                options,
                expect: { options: k.options },
              },
            ]
      }),
      ...named.map((k): CatalogOperation => ({
        op: "set-schema-key",
        document: id,
        key: k.key.trim(),
        options: keyOptions(k),
        expect: { absent: true },
      })),
      ...bodyOperation(id, document, body),
      ...(retire && status !== "retired"
        ? [
            {
              op: "retire" as const,
              document: id,
              expect: { status: status as "active" | "deprecated" },
            },
          ]
        : []),
    ]
    return ops.length === 0 ? "Change something first." : ops
  }
  const onApplied = (proposal: CatalogProposal) =>
    void navigate(wikiPath(props.workspaceId, `/types/${props.type}`), {
      state: { saved: { number: proposal.number, id: proposal.id } },
    })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`Suggest a change: the ${props.type} type`}>
        <span className="font-mono">{id}</span> ·{" "}
        <Link
          to={wikiPath(props.workspaceId, `/types/${props.type}`)}
          className={linkClass}
        >
          Back to the type
        </Link>
        . {rulesNote}
      </PageHeader>
      <Section title="Fields">
        <TextField label="Title" required value={title} onChange={setTitle} />
        <AreaField
          label="Summary"
          required
          rows={2}
          value={summary}
          onChange={setSummary}
        />
        <TextField label="Owner" mono value={owner} onChange={setOwner} />
        {(status === "active" || status === "deprecated") && (
          <SelectField
            label="Status"
            value={status}
            options={[
              { value: "active", label: "Active" },
              { value: "deprecated", label: "Deprecated" },
            ]}
            onChange={setStatus}
          />
        )}
      </Section>
      <Section
        title="Keys"
        description="Removing a key that current entities use is refused; add keys freely."
      >
        {written.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No keys of its own yet.
          </p>
        )}
        <ul className="flex flex-col divide-y rounded-lg border">
          {written.map((k) => {
            const choice = choices[k.key] ?? { kind: "keep" }
            return (
              <li key={k.key} className="flex flex-col gap-3 p-3 sm:p-4">
                <p className="text-sm">
                  <span className="font-mono">{k.key}</span>{" "}
                  <span className="text-muted-foreground">
                    {describeOptions(k.options)}
                  </span>
                </p>
                <SelectField
                  label={`What to do with ${k.key}`}
                  value={choice.kind}
                  options={[
                    { value: "keep", label: "Keep as it is" },
                    { value: "change", label: "Change it" },
                    { value: "remove", label: "Remove it" },
                  ]}
                  onChange={(kind) =>
                    setChoices((c) => ({
                      ...c,
                      [k.key]:
                        kind === "change"
                          ? { kind, draft: keyDraftOf(k.key, k.options) }
                          : { kind },
                    }))
                  }
                />
                {choice.kind === "change" && (
                  <KeyEditor
                    draft={choice.draft}
                    onChange={(draft) =>
                      setChoices((c) => ({
                        ...c,
                        [k.key]: { kind: "change", draft },
                      }))
                    }
                  />
                )}
              </li>
            )
          })}
        </ul>
        <KeysSection drafts={added} setDrafts={setAdded} nested />
      </Section>
      <ListsSection
        required={required}
        setRequired={setRequired}
        sections={sections}
        setSections={setSections}
      />
      <BodyEditor
        workspaceId={props.workspaceId}
        body={body}
        setBody={setBody}
      />
      {status !== "retired" && (
        <Section title="Retire the type">
          <CheckboxField
            label={`Retire the ${props.type} type`}
            checked={retire}
            onChange={setRetire}
            description="Only while no active or deprecated entity uses it; retired entities keep it."
          />
        </Section>
      )}
      <ProposalForm operations={operations()} onApplied={onApplied} />
    </div>
  )
}

function describeOptions(options: KeyOptions): string {
  const parts: string[] = []
  if (options.relation) parts.push(`relation to ${options.relation.join(", ")}`)
  if (options.many !== undefined)
    parts.push(options.many ? "many values" : "one value")
  if (options.inverse) parts.push(`shown on targets as "${options.inverse}"`)
  if (options.recheck) parts.push(`recheck every ${options.recheck}`)
  return parts.length > 0 ? `(${parts.join("; ")})` : ""
}

function KeysSection(props: {
  drafts: KeyDraft[]
  setDrafts: (update: (drafts: KeyDraft[]) => KeyDraft[]) => void
  nested?: boolean
}) {
  const content = (
    <>
      {props.drafts.map((draft, i) => (
        <fieldset
          key={i}
          className="flex flex-col gap-3 rounded-lg border p-3 sm:p-4"
        >
          <legend className="px-1 text-sm font-medium">New key {i + 1}</legend>
          <KeyEditor
            draft={draft}
            editKey
            onChange={(next) =>
              props.setDrafts((list) =>
                list.map((d, j) => (j === i ? next : d)),
              )
            }
          />
          <Actions>
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                props.setDrafts((list) => list.filter((_, j) => j !== i))
              }
            >
              Remove this new key
            </Button>
          </Actions>
        </fieldset>
      ))}
      <Actions>
        <Button
          type="button"
          variant="outline"
          onClick={() => props.setDrafts((list) => [...list, emptyKey()])}
        >
          Add a key
        </Button>
      </Actions>
    </>
  )
  if (props.nested) return content
  return (
    <Section
      title="Keys"
      description="The facts entities of this type record. A key that names target types is a relation."
    >
      {content}
    </Section>
  )
}

function KeyEditor(props: {
  draft: KeyDraft
  editKey?: boolean
  onChange: (draft: KeyDraft) => void
}) {
  const { draft } = props
  const set = (change: Partial<KeyDraft>) =>
    props.onChange({ ...draft, ...change })
  const relation = listOf(draft.relation).length > 0
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {props.editKey && (
        <TextField
          label="Key"
          mono
          required
          value={draft.key}
          onChange={(key) => set({ key })}
          placeholder="registrar"
        />
      )}
      <TextField
        label="Relation to types (optional)"
        mono
        value={draft.relation}
        onChange={(r) => set({ relation: r })}
        placeholder="service, machine"
        description="Leave empty for a plain value."
      />
      {relation && (
        <TextField
          label="Shown on targets as (optional)"
          value={draft.inverse}
          onChange={(inverse) => set({ inverse })}
          placeholder="domains"
        />
      )}
      <TextField
        label="Recheck every (days, optional)"
        value={draft.recheck}
        onChange={(recheck) => set({ recheck })}
        placeholder="90"
      />
      <CheckboxField
        label={relation ? "Many targets" : "Many values"}
        checked={draft.many}
        onChange={(many) => set({ many })}
      />
    </div>
  )
}

function ListsSection(props: {
  required: string
  setRequired: (value: string) => void
  sections: string
  setSections: (value: string) => void
}) {
  return (
    <Section title="Conventions">
      <TextField
        label="Keys every entity should record (optional)"
        mono
        value={props.required}
        onChange={props.setRequired}
        description="Comma-separated. Missing ones are listed on the page, not refused."
      />
      <TextField
        label="Body sections (optional)"
        value={props.sections}
        onChange={props.setSections}
        description="Comma-separated headings each page of the type usually has."
      />
    </Section>
  )
}
