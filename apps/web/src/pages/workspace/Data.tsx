import { TriangleAlertIcon } from "lucide-react"
import { useState } from "react"
import type { FormEvent } from "react"

import type { CatalogPurge, CatalogPurgePreview } from "@shinan/api-client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

import { useAction } from "../../action"
import { useApi, useResource } from "../../api"
import {
  Actions,
  Confirm,
  Facts,
  OrderedRows,
  Section,
} from "../../components/page"
import { ErrorMessage, Loading, Notice } from "../../components/status"
import { formatTime } from "../../format"
import { useWorkspace } from "./context"

/** The word a workspace owner types to confirm a purge. */
const confirmWord = "purge"

/**
 * Data (human experience, Workspace settings): purging catalog text (catalog
 * §9) and the purges made so far. Only workspace owners purge, after signing
 * in again; the server decides. Exports come with a later milestone.
 */
export function Data() {
  const api = useApi()
  const { workspace } = useWorkspace()
  const purges = useResource(`catalog-purges:${workspace.id}`, () =>
    api.catalogPurges(workspace.id),
  )

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {workspace.role === "owner" ? (
        <PurgeText onPurged={purges.reload} />
      ) : (
        <Section title="Purge catalog text">
          <p className="text-sm text-muted-foreground">
            Only workspace owners purge catalog text.
          </p>
        </Section>
      )}
      <Section
        title="Purges"
        description="Who purged catalog text, when and why. The purged text itself is never kept."
      >
        {purges.data ? (
          <PurgeList purges={purges.data} />
        ) : purges.error ? (
          <ErrorMessage error={purges.error} />
        ) : (
          <Loading />
        )}
      </Section>
    </div>
  )
}

function PurgeText(props: { onPurged: () => void }) {
  const api = useApi()
  const { workspace } = useWorkspace()
  const [text, setText] = useState("")
  const [found, setFound] = useState<{
    text: string
    preview: CatalogPurgePreview
  }>()
  const [reason, setReason] = useState("")
  const [typed, setTyped] = useState("")
  const [done, setDone] = useState<CatalogPurge>()
  const find = useAction()
  const purge = useAction()

  const search = (event: FormEvent) => {
    event.preventDefault()
    setDone(undefined)
    purge.clear()
    const wanted = text
    find.run(() =>
      api
        .previewCatalogPurge(workspace.id, wanted)
        .then((preview) => setFound({ text: wanted, preview })),
    )
  }

  const confirm = (event: FormEvent) => {
    event.preventDefault()
    if (!found) return
    purge.run(
      () =>
        api
          .purgeCatalogText(workspace.id, { text: found.text, reason })
          .then(setDone),
      () => {
        // The text is kept only in this form's memory, and only until now.
        setText("")
        setFound(undefined)
        setReason("")
        setTyped("")
        props.onPurged()
      },
    )
  }

  const preview = found?.text === text ? found.preview : undefined
  const anywhere =
    preview !== undefined &&
    preview.revisionTexts + preview.proposals + preview.events > 0

  return (
    <Section
      title="Purge catalog text"
      description="Replace a text, such as a leaked secret or personal data, with “(purged)” wherever this workspace's catalog stores it: every revision of every document, catalog proposals and the timeline. The purge itself is recorded, with your reason, on the timeline and in the security log."
    >
      <Alert>
        <TriangleAlertIcon aria-hidden="true" />
        <AlertTitle>A purge cleans Shinan, not copies that left it</AlertTitle>
        <AlertDescription>
          <p>
            Workspace exports taken before the purge, the host&apos;s backups,
            and the model providers of agents that read the text may still hold
            it. If it is a secret, rotate it where it was issued: purging does
            not make it safe again.
          </p>
          <p>Security-log entries are never purged.</p>
        </AlertDescription>
      </Alert>
      <form onSubmit={search}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="purge-text">Text to purge</FieldLabel>
            <Textarea
              id="purge-text"
              required
              autoComplete="off"
              spellCheck={false}
              rows={2}
              value={text}
              onChange={(event) => {
                setText(event.target.value)
                setDone(undefined)
              }}
            />
            <FieldDescription>
              Exactly as the catalog writes it, at least 4 characters. Shinan
              shows where it is before anything changes.
            </FieldDescription>
          </Field>
          <div>
            <Button type="submit" variant="outline" disabled={find.pending}>
              Find it
            </Button>
          </div>
        </FieldGroup>
      </form>
      {find.error !== undefined && <ErrorMessage error={find.error} />}
      {preview && !anywhere && (
        <Notice>
          {preview.writtenDifferently > 0
            ? `The agent index holds this text for ${plural(preview.writtenDifferently, "document")}, but the stored text writes it differently, for example with YAML escapes or folded across lines. Purge it as the stored text writes it.`
            : "This text is not in the catalog, its proposals or the timeline, written exactly so."}
        </Notice>
      )}
      {preview && anywhere && (
        <Confirm>
          <p className="font-medium">Shinan found this text in:</p>
          {/* Muted text is too faint on the confirm box's tint. */}
          <Facts className="[&>dt]:text-foreground">
            <dt>Revisions</dt>
            <dd>
              {plural(preview.revisionTexts, "stored text")} of{" "}
              {plural(preview.documents, "document")}
            </dd>
            <dt>Current pages</dt>
            <dd>
              {preview.latestDocuments.length === 0
                ? "None: only earlier revisions"
                : `${preview.latestDocuments.join(", ")}, stored again as a new revision`}
            </dd>
            <dt>Proposals</dt>
            <dd>
              {plural(preview.proposals, "catalog proposal")}
              {preview.waitingProposals > 0 &&
                `; ${plural(preview.waitingProposals, "waiting proposal")} will be rejected`}
            </dd>
            <dt>Timeline</dt>
            <dd>{plural(preview.events, "event")}</dd>
          </Facts>
          <form onSubmit={confirm}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="purge-reason">Reason</FieldLabel>
                <Textarea
                  id="purge-reason"
                  required
                  rows={2}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
                <FieldDescription className="text-foreground">
                  Kept on the timeline. Do not repeat the text here.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="purge-confirm">
                  Type {confirmWord} to confirm
                </FieldLabel>
                <Input
                  id="purge-confirm"
                  autoComplete="off"
                  className="sm:w-64"
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                />
              </Field>
              <Actions>
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={
                    purge.pending ||
                    typed.trim().toLowerCase() !== confirmWord ||
                    reason.trim() === ""
                  }
                >
                  Purge everywhere
                </Button>
              </Actions>
            </FieldGroup>
          </form>
        </Confirm>
      )}
      {purge.error !== undefined && <ErrorMessage error={purge.error} />}
      {done && (
        <Notice>
          Purged (purge {done.number}).{" "}
          {done.revision !== null &&
            `Revision ${done.revision} stores the cleaned pages. `}
          Remember to rotate a purged secret where it was issued.
        </Notice>
      )}
    </Section>
  )
}

function PurgeList(props: { purges: CatalogPurge[] }) {
  if (props.purges.length === 0)
    return (
      <p className="text-sm text-muted-foreground">Nothing has been purged.</p>
    )
  return (
    <OrderedRows>
      {props.purges.map((p) => (
        <li key={p.id}>
          <p className="text-sm">
            <span className="font-medium">Purge {p.number}</span>{" "}
            <span className="text-muted-foreground">
              · {formatTime(p.createdAt)} · {p.purgedBy}
            </span>
          </p>
          <p className="text-sm wrap-anywhere">{p.reason}</p>
          <p className="text-sm text-muted-foreground">
            {[
              `${plural(p.counts.revisionTexts, "revision text")} of ${plural(p.counts.documents, "document")}`,
              plural(p.counts.proposals, "proposal"),
              plural(p.counts.events, "event"),
            ].join(", ")}
            {p.revision !== null && `; cleaned pages in revision ${p.revision}`}
          </p>
        </li>
      ))}
    </OrderedRows>
  )
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`
}
