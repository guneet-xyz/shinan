import { TriangleAlertIcon } from "lucide-react"
import { useState } from "react"
import type { FormEvent } from "react"
import { Link } from "react-router"

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
  Rows,
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

  const look = (wanted: string) => {
    setDone(undefined)
    purge.clear()
    find.run(() =>
      api
        .previewCatalogPurge(workspace.id, wanted)
        .then((preview) => setFound({ text: wanted, preview })),
    )
  }
  const search = (event: FormEvent) => {
    event.preventDefault()
    look(text)
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
          <p>
            A change being made while you purge, or sent again afterwards, can
            bring the text back: press Find it again a minute after purging, and
            purge again if it is found.
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
              As the catalog writes it, at least 4 characters. Spaces and line
              breaks need not match, so wrapped text is found too. Shinan shows
              where it is before anything changes.
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
          {preview.writtenDifferently.length > 0
            ? `The agent index holds this text for ${preview.writtenDifferently.join(", ")}, but the stored text writes it differently, for example with YAML escapes. Purge it as the stored text writes it.`
            : "This text is not in the catalog, its proposals or the timeline."}
        </Notice>
      )}
      {preview && preview.alsoWrittenAs.length > 0 && (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            Also found written in other forms, which this purge does not reach.
            Purge each one too:
          </p>
          <Rows>
            {preview.alsoWrittenAs.map((form) => (
              <li key={form.form}>
                <p>
                  <span className="font-medium">{formNames[form.form]}</span>{" "}
                  <span className="text-muted-foreground">
                    · {plural(form.revisionTexts, "stored text")},{" "}
                    {plural(form.proposals, "proposal")},{" "}
                    {plural(form.events, "event")}
                  </span>
                </p>
                <Actions>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setText(form.text)
                      look(form.text)
                    }}
                  >
                    Find this form
                  </Button>
                </Actions>
              </li>
            ))}
          </Rows>
        </div>
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
          {preview.structure.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="font-medium">
                Purging changes how these pages read; repair them afterwards:
              </p>
              <ul className="list-disc pl-5">
                {preview.structure.map((s) => (
                  <li key={`${s.id} ${s.where}`}>
                    {s.id}: {structureNames[s.where]}
                  </li>
                ))}
              </ul>
            </div>
          )}
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
        <div className="flex flex-col gap-2">
          <Notice>
            Purged (purge {done.number}).{" "}
            {done.revision !== null &&
              `Revision ${done.revision} stores the cleaned pages. `}
            Press Find it again in a minute, in case a change in progress
            brought the text back, and rotate a purged secret where it was
            issued.
          </Notice>
          {done.newProblems && done.newProblems.length > 0 && (
            <div className="flex flex-col gap-1 text-sm">
              <p className="font-medium">
                These pages now read with problems; repair them:
              </p>
              <ul className="list-disc pl-5">
                {done.newProblems.map((page) => (
                  <li key={page.id}>
                    <Link
                      to={`/w/${workspace.id}/wiki/e/${page.id.split("/").map(encodeURIComponent).join("/")}`}
                      className="rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring"
                    >
                      {page.id}
                    </Link>
                    : {page.problems.join(" ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
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

const formNames: Record<
  CatalogPurgePreview["alsoWrittenAs"][number]["form"],
  string
> = {
  url: "URL-encoded",
  percent: "Percent-encoded",
  html: "With HTML entities",
  escaped: "With JSON or YAML escapes",
}

const structureNames: Record<
  CatalogPurgePreview["structure"][number]["where"],
  string
> = {
  id: "the text is in its ID",
  alias: "the text is in an alias",
  key: "the text ends at a frontmatter key",
  frontmatter: "the text spans lines of its frontmatter",
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`
}
