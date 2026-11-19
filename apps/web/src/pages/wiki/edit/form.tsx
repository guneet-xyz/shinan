import { useId, useState } from "react"
import type { ReactNode } from "react"
import { Link } from "react-router"

import type {
  CatalogNotApplied,
  CatalogOperation,
  CatalogPreviewOutcome,
  CatalogProposal,
  CatalogProposalOutcome,
  CheckInput,
} from "@shinan/api-client"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"

import { useAction } from "../../../action"
import { useApi } from "../../../api"
import { Actions, Section } from "../../../components/page"
import { ErrorMessage } from "../../../components/status"
import { useWorkspace } from "../../workspace/context"
import { linkClass } from "../facts"
import { wikiPath } from "../format"
import { PageNotice } from "../notices"
import { classNames } from "./words"

export function TextField(props: {
  label: string
  value: string
  onChange: (value: string) => void
  description?: ReactNode
  required?: boolean
  mono?: boolean
  type?: "text" | "date" | "number" | "url"
  placeholder?: string
  autoComplete?: string
  /** The ID of a `datalist` of suggestions. */
  list?: string
}) {
  const id = useId()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{props.label}</FieldLabel>
      <Input
        id={id}
        type={props.type ?? "text"}
        value={props.value}
        required={props.required}
        placeholder={props.placeholder}
        list={props.list}
        autoComplete={props.autoComplete ?? "off"}
        spellCheck={props.mono ? false : undefined}
        className={props.mono ? "font-mono" : undefined}
        aria-describedby={props.description ? `${id}-description` : undefined}
        onChange={(event) => props.onChange(event.target.value)}
      />
      {props.description && (
        <FieldDescription id={`${id}-description`}>
          {props.description}
        </FieldDescription>
      )}
    </Field>
  )
}

export function AreaField(props: {
  label: string
  value: string
  onChange: (value: string) => void
  description?: ReactNode
  required?: boolean
  mono?: boolean
  rows?: number
}) {
  const id = useId()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{props.label}</FieldLabel>
      <Textarea
        id={id}
        value={props.value}
        required={props.required}
        rows={props.rows ?? 3}
        spellCheck={props.mono ? false : undefined}
        className={props.mono ? "font-mono text-xs/5 md:text-xs/5" : undefined}
        aria-describedby={props.description ? `${id}-description` : undefined}
        onChange={(event) => props.onChange(event.target.value)}
      />
      {props.description && (
        <FieldDescription id={`${id}-description`}>
          {props.description}
        </FieldDescription>
      )}
    </Field>
  )
}

export function SelectField<T extends string>(props: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  description?: ReactNode
}) {
  const id = useId()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{props.label}</FieldLabel>
      <NativeSelect
        id={id}
        value={props.value}
        className="w-full sm:w-fit"
        aria-describedby={props.description ? `${id}-description` : undefined}
        onChange={(event) => props.onChange(event.target.value as T)}
      >
        {props.options.map((o) => (
          <NativeSelectOption key={o.value} value={o.value}>
            {o.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {props.description && (
        <FieldDescription id={`${id}-description`}>
          {props.description}
        </FieldDescription>
      )}
    </Field>
  )
}

export function CheckboxField(props: {
  label: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  description?: ReactNode
}) {
  const id = useId()
  return (
    <div className="flex items-start gap-2 text-sm">
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-4 accent-primary"
        checked={props.checked}
        aria-describedby={props.description ? `${id}-description` : undefined}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id}>{props.label}</label>
        {props.description && (
          <p id={`${id}-description`} className="text-muted-foreground">
            {props.description}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * A fact check (catalog §4.5): when, what was checked (scope) and how
 * (source), and what was not. Shinan writes who.
 */
export function CheckFields(props: {
  check: CheckInput
  onChange: (check: CheckInput) => void
}) {
  const { check } = props
  const set = (change: Partial<CheckInput>) =>
    props.onChange({ ...check, ...change })
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField
        label="Checked on"
        type="date"
        required
        value={check.checked}
        onChange={(checked) => set({ checked })}
        description="When you looked, not when you write it down."
      />
      <TextField
        label="What was checked (scope)"
        required
        value={check.scope}
        onChange={(scope) => set({ scope })}
        placeholder="Disk sizes on the data disk"
      />
      <TextField
        label="How it was checked (source)"
        required
        value={check.source}
        onChange={(source) => set({ source })}
        placeholder="df -h over read-only SSH"
      />
      <TextField
        label="What was not checked (optional)"
        value={check.limits ?? ""}
        onChange={(limits) => set({ limits })}
      />
    </div>
  )
}

/**
 * The end of every editor: why, then "Check the change" (what it would
 * do, from Shinan, stored nowhere) and "Save" (a catalog proposal). Human
 * experience: before saving, the screen says whether the change applies at
 * once or waits for approval, and shows validation's results.
 */
export function ProposalForm(props: {
  /** The operations, or why there are none yet. */
  operations: CatalogOperation[] | string
  /** A first explanation the person can change. */
  explanation?: string
  saveLabel?: string
  onApplied: (proposal: CatalogProposal) => void
}) {
  const api = useApi()
  const { workspace } = useWorkspace()
  const [explanation, setExplanation] = useState(props.explanation ?? "")
  const [relatedTask, setRelatedTask] = useState("")
  const [preview, setPreview] = useState<{
    key: string
    outcome: CatalogPreviewOutcome
    /**
     * Sent with the save, one per checked input: a second click, or a retry
     * after a lost answer, gets the stored proposal back instead of making
     * another (catalog §8.2, retries).
     */
    idempotencyKey: string
  }>()
  const [saved, setSaved] = useState<CatalogProposalOutcome>()
  const checking = useAction()
  const saving = useAction()
  const ready = typeof props.operations !== "string"
  const input = ready
    ? {
        explanation: explanation.trim(),
        operations: props.operations as CatalogOperation[],
        ...(relatedTask.trim() ? { relatedTask: relatedTask.trim() } : {}),
      }
    : null
  const key = JSON.stringify(input)
  const checked = preview?.key === key ? preview : undefined
  const current = checked?.outcome
  // Only a change that would apply or wait can be saved.
  const savable =
    current !== undefined &&
    (current.outcome === "applies" || current.outcome === "waits")
  const blank = explanation.trim() === ""

  const check = () => {
    if (!input) return
    setSaved(undefined)
    checking.run(async () => {
      const outcome = await api.previewCatalogChange(workspace.id, input)
      setPreview({ key, outcome, idempotencyKey: crypto.randomUUID() })
    })
  }
  const save = () => {
    if (!input || !checked) return
    saving.run(async () => {
      const outcome = await api.proposeCatalogChange(workspace.id, {
        ...input,
        idempotencyKey: checked.idempotencyKey,
      })
      setSaved(outcome)
      if ("proposal" in outcome && outcome.outcome === "applied")
        props.onApplied(outcome.proposal)
    })
  }

  return (
    <Section
      title="Save the change"
      description="Every change is a catalog proposal, with the reason for it."
    >
      <AreaField
        label="Why (explanation)"
        required
        value={explanation}
        onChange={setExplanation}
        description="A few sentences for the history and for whoever reviews it. Never a secret."
      />
      <TextField
        label="Related task (optional)"
        mono
        value={relatedTask}
        onChange={setRelatedTask}
        placeholder="SHN-12"
      />
      {typeof props.operations === "string" && (
        <p className="text-sm text-muted-foreground">{props.operations}</p>
      )}
      <Actions>
        <Button
          type="button"
          variant="outline"
          disabled={!ready || blank || checking.pending}
          onClick={check}
        >
          Check the change
        </Button>
        <Button
          type="button"
          disabled={
            !ready ||
            blank ||
            saving.pending ||
            !savable ||
            (saved !== undefined && "proposal" in saved)
          }
          onClick={save}
        >
          {props.saveLabel ?? "Save"}
        </Button>
      </Actions>
      {ready && !blank && !current && (
        <p className="text-sm text-muted-foreground">
          Check the change first: Shinan says whether it applies at once or
          waits for approval.
        </p>
      )}
      <div aria-live="polite" className="flex flex-col gap-3">
        {checking.error !== undefined && (
          <ErrorMessage error={checking.error} />
        )}
        {saving.error !== undefined && <ErrorMessage error={saving.error} />}
        {current && !saved && <OutcomeView outcome={current} />}
        {saved && <SavedView outcome={saved} workspaceId={workspace.id} />}
      </div>
    </Section>
  )
}

/** What a checked change would do. */
export function OutcomeView(props: { outcome: CatalogPreviewOutcome }) {
  const { outcome } = props
  if (outcome.outcome === "applies" || outcome.outcome === "waits")
    return (
      <PageNotice warning={outcome.outcome === "waits"}>
        <p className="font-semibold">
          {outcome.outcome === "applies"
            ? "This change applies at once when you save it."
            : "This change waits for catalog approval when you save it."}
        </p>
        {outcome.approvalReasons.length > 0 && (
          <>
            <p>
              {outcome.asApproval
                ? "It needs catalog approval, and as a member who may give it, saving it is your approval:"
                : "It needs catalog approval:"}
            </p>
            <ul className="list-disc pl-5">
              {outcome.approvalReasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </>
        )}
        <p className="text-muted-foreground">
          Kind of change: {outcome.approvalClasses.map(classNames).join(", ")}.
        </p>
        <Problems
          title="Validation's warnings"
          problems={outcome.warnings.map((w) => w.message)}
        />
      </PageNotice>
    )
  return <NotAppliedView outcome={outcome as CatalogNotApplied} />
}

export function NotAppliedView(props: { outcome: CatalogNotApplied }) {
  const { outcome } = props
  if (outcome.outcome === "unchanged")
    return (
      <PageNotice>
        <p>This changes nothing: the page already says this.</p>
      </PageNotice>
    )
  const title =
    outcome.outcome === "conflict"
      ? "The page changed since you opened it, so this change would not apply. Reload the page and make the change again:"
      : outcome.outcome === "blocked"
        ? "This change cannot be saved as it is:"
        : "Part of this change cannot be written:"
  return (
    <PageNotice warning>
      <Problems
        title={title}
        problems={outcome.problems.map((p) => p.message)}
      />
    </PageNotice>
  )
}

function Problems(props: { title: string; problems: string[] }) {
  if (props.problems.length === 0) return null
  return (
    <>
      <p className="font-semibold">{props.title}</p>
      <ul className="list-disc pl-5">
        {props.problems.map((p, i) => (
          <li key={i} className="wrap-anywhere">
            {p}
          </li>
        ))}
      </ul>
    </>
  )
}

function SavedView(props: {
  outcome: CatalogProposalOutcome
  workspaceId: string
}) {
  const { outcome } = props
  if (!("proposal" in outcome)) return <NotAppliedView outcome={outcome} />
  const link = (
    <Link
      to={wikiPath(props.workspaceId, `/proposals/${outcome.proposal.id}`)}
      className={linkClass}
    >
      catalog proposal {outcome.proposal.number}
    </Link>
  )
  return (
    <PageNotice>
      <p role="status">
        {outcome.outcome === "applied" ? (
          <>Saved as {link}.</>
        ) : (
          <>Saved as {link}, waiting for catalog approval.</>
        )}
      </p>
    </PageNotice>
  )
}
