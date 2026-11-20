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
import { Actions, Confirm, OrderedRows, Section } from "../../components/page"
import { ErrorMessage, Loading, Notice } from "../../components/status"
import { formatTime } from "../../format"
import { useWorkspace } from "./context"

/** The word a workspace owner types to confirm. */
const confirmWord = "remove"

/**
 * Remove text from the catalog's history (Settings › Catalog; catalog §9;
 * Git-based catalog plan §2.9): a workspace owner finds where a text such
 * as a leaked secret is, then has it replaced everywhere Shinan keeps it.
 * Shinan rewrites the catalog's history on the server; the screen says
 * what that cannot reach. Only owners, after signing in again; the server
 * decides.
 */
export function RemoveText() {
  const api = useApi()
  const { workspace } = useWorkspace()
  const purges = useResource(`catalog-purges:${workspace.id}`, () =>
    api.catalogPurges(workspace.id),
  )

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <p className="text-sm">
        <Link
          to=".."
          relative="path"
          className="font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← Catalog settings
        </Link>
      </p>
      {workspace.role === "owner" ? (
        <RemoveForm onRemoved={purges.reload} />
      ) : (
        <Section title="Remove text from the catalog's history">
          <p className="text-sm text-muted-foreground">
            Only workspace owners remove text from the catalog's history.
          </p>
        </Section>
      )}
      <Section
        title="Earlier removals"
        description="Who removed text, when and why. The text itself is never kept."
      >
        {purges.data ? (
          <RemovalList purges={purges.data} />
        ) : purges.error ? (
          <ErrorMessage error={purges.error} />
        ) : (
          <Loading />
        )}
      </Section>
    </div>
  )
}

function RemoveForm(props: { onRemoved: () => void }) {
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
  const remove = useAction()

  const look = (wanted: string) => {
    setDone(undefined)
    remove.clear()
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
    remove.run(
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
        props.onRemoved()
      },
    )
  }

  const preview = found?.text === text ? found.preview : undefined
  const places = preview ? placesOf(preview) : []

  return (
    <Section
      title="Remove text from the catalog's history"
      description="For a secret or personal data that reached the catalog. Shinan replaces the text with “(purged)” everywhere it keeps it: in every page and every earlier version, in change messages, on every branch, and in its own records. Who removed it, when and why is kept; the text never is."
    >
      <Alert>
        <TriangleAlertIcon aria-hidden="true" />
        <AlertTitle>Copies outside Shinan keep the text</AlertTitle>
        <AlertDescription>
          <ul className="list-disc pl-5">
            <li>
              Every agent's copy of the catalog still has it. Whoever runs those
              machines deletes each copy and gets a new one.
            </li>
            <li>The AI providers of agents that read it keep it too.</li>
            <li>
              If it is a secret, change it where it was issued: removing it here
              does not make it safe again.
            </li>
          </ul>
        </AlertDescription>
      </Alert>
      <form onSubmit={search}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="remove-text">Text to remove</FieldLabel>
            <Textarea
              id="remove-text"
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
              Exactly as it was written, at least 4 characters. Spaces and line
              breaks need not match. Nothing changes until you confirm.
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
      {preview && places.length === 0 && (
        <Notice>
          Shinan keeps this text nowhere in this catalog.
          {preview.unfinished > 0 &&
            " An earlier removal didn't finish: remove any text again to finish it."}
        </Notice>
      )}
      {preview && preview.alsoWrittenAs.length > 0 && (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            Also written another way, which removing this text does not reach.
            Remove each one too:
          </p>
          <ul className="flex flex-col gap-2">
            {preview.alsoWrittenAs.map((form) => (
              <li
                key={form.form}
                className="flex flex-wrap items-center gap-x-3 gap-y-1"
              >
                <span>
                  <span className="font-medium">{formNames[form.form]}</span>{" "}
                  <span className="text-muted-foreground">
                    · {plural(form.places, "place")}
                  </span>
                </span>
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
              </li>
            ))}
          </ul>
        </div>
      )}
      {preview && places.length > 0 && (
        <Confirm>
          <p className="font-medium">Shinan found this text in:</p>
          <ul className="list-disc pl-5">
            {places.map((place) => (
              <li key={place}>{place}</li>
            ))}
          </ul>
          {preview.history && preview.history.currentFiles.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="font-medium">Pages that show it now:</p>
              <ul className="list-disc pl-5 wrap-anywhere">
                {preview.history.currentFiles.map((path) => (
                  <li key={path}>{path}</li>
                ))}
                {preview.history.currentFilesMore > 0 && (
                  <li>and {preview.history.currentFilesMore} more</li>
                )}
              </ul>
            </div>
          )}
          {preview.acrossLines > 0 && (
            <p>
              Found across a line break in{" "}
              {plural(preview.acrossLines, "place")}: check that those places
              hold what you mean.
            </p>
          )}
          {preview.history && preview.history.structure.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="font-medium">
                Removing it changes how these pages read; an agent can fix them
                afterwards:
              </p>
              <ul className="list-disc pl-5 wrap-anywhere">
                {preview.history.structure.map((s) => (
                  <li key={`${s.path} ${s.where}`}>
                    {s.path}: {structureNames[s.where]}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p>
            Agents' next fetch gets the new history. Work they have not pushed
            yet is redone on top of it.
          </p>
          <form onSubmit={confirm}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="remove-reason">Reason</FieldLabel>
                <Textarea
                  id="remove-reason"
                  required
                  rows={2}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
                <FieldDescription className="text-foreground">
                  Kept with the record. Do not repeat the text here.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="remove-confirm">
                  Type {confirmWord} to confirm
                </FieldLabel>
                <Input
                  id="remove-confirm"
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
                    remove.pending ||
                    typed.trim().toLowerCase() !== confirmWord ||
                    reason.trim() === ""
                  }
                >
                  {remove.pending ? "Removing…" : "Remove everywhere"}
                </Button>
              </Actions>
            </FieldGroup>
          </form>
        </Confirm>
      )}
      {remove.error !== undefined && <ErrorMessage error={remove.error} />}
      {done && (
        <Notice>
          Removed (removal {done.number}). Agents' copies still have the text:
          ask for each to be deleted and made again, and change a secret where
          it was issued.
        </Notice>
      )}
    </Section>
  )
}

/** Where the preview found the text, in plain words, one line each. */
function placesOf(preview: CatalogPurgePreview): string[] {
  const places: string[] = []
  const history = preview.history
  if (history) {
    const { commits, messages } = history
    if (commits.main + commits.branches > 0)
      places.push(
        `${plural(commits.main + commits.branches, "change")} to the catalog${sides(commits)}`,
      )
    if (messages.main + messages.branches > 0)
      places.push(
        `${plural(messages.main + messages.branches, "change message")}, or who made the change`,
      )
    if (history.branchNames > 0)
      places.push(`${plural(history.branchNames, "branch name")} of agents`)
  }
  const records =
    preview.pushLog +
    preview.events +
    preview.indexDocuments +
    (history?.journalEntries ?? 0)
  if (records > 0) places.push(`${plural(records, "record")} Shinan keeps`)
  const earlier =
    preview.earlier.revisionTexts +
    preview.earlier.proposals +
    preview.earlier.comments
  if (earlier > 0)
    places.push(
      `${plural(earlier, "copy", "copies")} from before the catalog moved into Git`,
    )
  return places
}

function sides(places: { main: number; branches: number }): string {
  if (places.branches === 0) return ""
  if (places.main === 0) return ", all on agents' branches"
  return ` (${places.branches} on agents' branches)`
}

function RemovalList(props: { purges: CatalogPurge[] }) {
  if (props.purges.length === 0)
    return (
      <p className="text-sm text-muted-foreground">No text has been removed.</p>
    )
  return (
    <OrderedRows>
      {props.purges.map((p) => (
        <li key={p.id}>
          <p className="text-sm">
            <span className="font-medium">Removal {p.number}</span>{" "}
            <span className="text-muted-foreground">
              · {formatTime(p.createdAt)} · {p.purgedBy}
            </span>
          </p>
          <p className="text-sm wrap-anywhere">{p.reason}</p>
          <p className="text-sm text-muted-foreground">{summary(p)}</p>
        </li>
      ))}
    </OrderedRows>
  )
}

/** What a removal changed, in one line. */
function summary(p: CatalogPurge): string {
  const { history, pushLog = 0, indexDocuments = 0 } = p.counts
  const parts = [
    history &&
      history.rewrittenCommits > 0 &&
      `${plural(history.rewrittenCommits, "change")} rewritten`,
    history &&
      history.renamedBranches > 0 &&
      `${plural(history.renamedBranches, "branch", "branches")} renamed`,
    pushLog + p.counts.events + indexDocuments > 0 &&
      `${plural(pushLog + p.counts.events + indexDocuments, "record")}`,
    p.counts.revisionTexts + p.counts.proposals + p.counts.comments > 0 &&
      `${plural(p.counts.revisionTexts + p.counts.proposals + p.counts.comments, "earlier copy", "earlier copies")}`,
  ].filter((part): part is string => typeof part === "string")
  return parts.length > 0 ? parts.join(", ") : "Nothing else changed"
}

const formNames: Record<
  CatalogPurgePreview["alsoWrittenAs"][number]["form"],
  string
> = {
  url: "As in a link (URL-encoded)",
  percent: "Percent-encoded",
  html: "With HTML entities",
  escaped: "With JSON or YAML escapes",
}

const structureNames: Record<
  NonNullable<CatalogPurgePreview["history"]>["structure"][number]["where"],
  string
> = {
  id: "the text is in the page's ID",
  alias: "the text is in one of its old IDs",
  key: "the text ends at a field name",
  frontmatter: "the text spans lines of its fields",
}

function plural(n: number, word: string, words = `${word}s`): string {
  return `${n} ${n === 1 ? word : words}`
}
