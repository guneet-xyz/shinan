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
import { Actions, OrderedRows, Section } from "../../components/page"
import {
  ErrorAlert,
  ErrorMessage,
  Loading,
  Notice,
} from "../../components/status"
import { formatTime } from "../../format"
import { useWorkspace } from "./context"
import { removalPolling } from "./removal"

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
  const [failure, setFailure] = useState<string>()
  /** Why a removal takes longer than it should, as the server says. */
  const [delay, setDelay] = useState<string>()
  const find = useAction()
  const remove = useAction()

  const look = (wanted: string) => {
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
    setFailure(undefined)
    setDelay(undefined)
    remove.run(
      async () => {
        // A large catalog takes minutes: the removal runs on the server,
        // and the page asks how it stands (review of #197).
        let status = await api.purgeCatalogText(workspace.id, {
          text: found.text,
          reason,
        })
        while (status.state === "running") {
          await new Promise((resolve) =>
            setTimeout(resolve, removalPolling.intervalMs),
          )
          status = await api.catalogPurgeStatus(workspace.id, status.id)
          setDelay(status.state === "running" ? status.message : undefined)
        }
        setDelay(undefined)
        if (status.state !== "done" || !status.purge) {
          setFailure(
            status.message ?? "Shinan could not remove the text: try again",
          )
          return
        }
        setDone(status.purge)
      },
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
  // A page's ID holding the text only gives it a new name, which the
  // lists above show.
  const reads =
    preview?.history?.structure.filter((s) => s.where !== "id") ?? []
  const places = preview ? placesOf(preview) : []

  return (
    <Section
      title="Remove text from the catalog's history"
      description="For a secret or personal data that reached the catalog. Shinan replaces the text with “(purged)” everywhere it keeps it: in every page and every earlier version, in change messages, on every branch, and in its own records; in a branch, file or folder name it becomes “purged”. Who removed it, when and why is kept; the text never is."
    >
      {done && <AfterRemoval removal={done} />}
      <Alert>
        <TriangleAlertIcon aria-hidden="true" />
        <AlertTitle>Copies outside Shinan keep the text</AlertTitle>
        <AlertDescription>
          <ul className="list-disc pl-5">
            <li>
              If it is a secret, change it where it was issued: removing it here
              does not make it safe again.
            </li>
            <li>
              Every agent's copy of the catalog still has it. Whoever runs those
              machines deletes each copy and gets a new one.
            </li>
            <li>The AI providers of agents that read it keep it too.</li>
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
              onChange={(event) => setText(event.target.value)}
            />
            <FieldDescription>
              Exactly as it was written, at least 4 characters. Spaces and line
              breaks need not match; copies in another encoding, such as base64,
              are not removed. Nothing changes until you confirm.
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
          {preview.mayAppearEncoded.length > 0
            ? "Shinan doesn't hold this text as written anywhere in this catalog."
            : "Shinan doesn't hold this text anywhere in this catalog. Nothing to remove."}
          {preview.unfinished > 0 &&
            ` ${plural(preview.unfinished, "earlier removal")} didn't finish: remove the same text again to finish ${preview.unfinished === 1 ? "it" : "each"}.`}
        </Notice>
      )}
      {preview && places.length === 0 && (
        <EncodedCopies encodings={preview.mayAppearEncoded} only />
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
        <div className="flex flex-col gap-4 text-sm">
          <div className="flex flex-col gap-1">
            <p className="font-medium">Shinan found this text in:</p>
            <ul className="list-disc pl-5">
              {places.map((place) => (
                <li key={place}>{place}</li>
              ))}
            </ul>
          </div>
          {preview.history && preview.history.currentFiles.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="font-medium">Pages that show it now:</p>
              <ul className="list-disc pl-5 wrap-anywhere">
                {preview.history.currentFiles.map((file) => (
                  <li key={file.path}>
                    {file.title === null
                      ? file.path
                      : `${file.title} (${file.path})`}
                  </li>
                ))}
                {preview.history.currentFilesMore > 0 && (
                  <li>and {preview.history.currentFilesMore} more</li>
                )}
              </ul>
            </div>
          )}
          {preview.history && preview.history.renamedApart.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="font-medium">
                Renamed with a number, because the plain name is taken:
              </p>
              <ul className="list-disc pl-5 wrap-anywhere">
                {preview.history.renamedApart.map((r) => {
                  const end = r.folder ? "/" : ""
                  const taken = `(${r.plain}${end} already exists)`
                  return (
                    <li key={r.path}>
                      {r.title === null
                        ? `${r.path}${end} ${taken}`
                        : `${r.title} becomes ${r.path} ${taken}`}
                    </li>
                  )
                })}
                {preview.history.renamedApartMore > 0 && (
                  <li>and {preview.history.renamedApartMore} more</li>
                )}
              </ul>
            </div>
          )}
          <EncodedCopies encodings={preview.mayAppearEncoded} />
          {preview.acrossLines > 0 && (
            <p>
              Found across a line break in{" "}
              {plural(preview.acrossLines, "place")}: check that those places
              hold what you mean.
            </p>
          )}
          {reads.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="font-medium">
                Removing it changes how these pages read; an agent can fix them
                afterwards:
              </p>
              <ul className="list-disc pl-5 wrap-anywhere">
                {reads.map((s) => (
                  <li key={`${s.path} ${s.where}`}>
                    {s.path}: {structureNames[s.where]}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p>
            Agents get the new history on their next fetch. They redo any work
            they haven't pushed on top of it; the skill says how.
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
                <FieldDescription>
                  Kept with the record. Do not repeat the text here.
                </FieldDescription>
              </Field>
              <p>
                <strong>This can't be undone.</strong> Shinan rewrites the
                catalog's history and deletes the old one. Every change that
                held the text gets a new ID.
              </p>
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
                  {remove.pending
                    ? "Removing…"
                    : "Remove from Shinan's history"}
                </Button>
              </Actions>
            </FieldGroup>
          </form>
        </div>
      )}
      {remove.pending && (
        <Notice>
          <strong>Removing…</strong> This can take a few minutes on a large
          catalog. You can leave this page: it goes on, and it appears under
          Earlier removals when it's done.
          {/* Pushes wait while the server finishes after a failure: then
              its reason says so instead. */}
          {delay === undefined &&
            " Agents can keep pushing, except for a few seconds near the end."}
        </Notice>
      )}
      {remove.pending && delay !== undefined && <Notice>{delay}</Notice>}
      {remove.error !== undefined && <ErrorMessage error={remove.error} />}
      {failure !== undefined && <ErrorAlert>{failure}</ErrorAlert>}
    </Section>
  )
}

/**
 * Places that may hold the text encoded, which a removal doesn't reach
 * (review of #197). The preview counts them but doesn't know their pages,
 * so none are named. `only`: the text itself is nowhere as written.
 */
function EncodedCopies(props: {
  encodings: CatalogPurgePreview["mayAppearEncoded"]
  only?: boolean
}) {
  if (props.encodings.length === 0) return null
  const where = props.encodings
    .map((e) => `${encodingNames[e.encoding]} (${plural(e.places, "place")})`)
    .join(", ")
  if (props.only)
    return (
      <p className="text-sm">
        <strong>It may be in the catalog encoded:</strong> {where}. Shinan
        removes only text exactly as written, so ask an agent for the encoded
        form and remove that here.
      </p>
    )
  return (
    <p className="text-sm">
      <strong>Shinan removes only the text exactly as written.</strong> It may
      also be in the catalog encoded: {where}. Those copies stay. If it's a
      secret, changing it where it was issued makes them harmless. Otherwise,
      ask an agent for the encoded form and remove that here as well.
    </p>
  )
}

/**
 * What the owner does after a removal, in order, kept at the top of the
 * section until they leave the page.
 */
function AfterRemoval(props: { removal: CatalogPurge }) {
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-lg border bg-muted/50 p-4 text-sm"
    >
      <p>
        <span className="font-medium">Removed from Shinan's history</span>{" "}
        (removal {props.removal.number}). Now:
      </p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>
          <span className="font-medium">
            If it was a secret, change it where it was issued.
          </span>{" "}
          It was exposed; removing it here doesn't make it safe.
        </li>
        <li>
          <span className="font-medium">
            Ask whoever runs each agent's machine to delete its copy of the
            catalog and make a new one
          </span>{" "}
          (step 2 of the{" "}
          <Link
            to="/account/agents/setup"
            className="font-medium underline underline-offset-4"
          >
            Set up an agent
          </Link>{" "}
          page). Shinan refuses any push of the old history. A copy that was
          still downloading when the removal finished may hold the text too.
        </li>
        <li>
          <span className="font-medium">
            Tell your agents the history changed.
          </span>{" "}
          The shinan skill tells them what to do.
        </li>
      </ol>
    </div>
  )
}

/** Where the preview found the text, in plain words, one line each. */
function placesOf(preview: CatalogPurgePreview): string[] {
  const places: string[] = []
  const history = preview.history
  if (preview.finishesUnfinished)
    places.push("an earlier removal of this text that didn't finish")
  if (history) {
    const { commits, messages } = history
    if (commits.main + commits.branches > 0)
      places.push(
        `${plural(commits.main + commits.branches, "change")} to the catalog${sides(commits)}`,
      )
    if (messages.main + messages.branches > 0)
      places.push(
        `${plural(messages.main + messages.branches, "change's message or author", "changes' messages or authors")}`,
      )
    if (history.branchNames > 0)
      places.push(plural(history.branchNames, "branch name"))
  }
  const pushRecords = preview.pushLog + (history?.journalEntries ?? 0)
  if (pushRecords > 0)
    places.push(
      `${plural(pushRecords, "entry", "entries")} in Shinan's push records`,
    )
  if (preview.events > 0)
    places.push(
      `${plural(preview.events, "entry", "entries")} on the catalog's timeline`,
    )
  // The search index is made from the pages: counted only when no page
  // shows the text now.
  if (preview.indexDocuments > 0 && (history?.currentFiles.length ?? 0) === 0)
    places.push(
      `${plural(preview.indexDocuments, "page")} in the catalog's search`,
    )
  if (preview.moves > 0)
    places.push("the record of the catalog's move into Git")
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
  const { history, pushLog = 0 } = p.counts
  const parts = [
    history &&
      history.rewrittenCommits > 0 &&
      `${plural(history.rewrittenCommits, "change")} rewritten`,
    history &&
      history.renamedBranches > 0 &&
      `${plural(history.renamedBranches, "branch", "branches")} renamed`,
    pushLog > 0 && `${plural(pushLog, "push record")} cleaned`,
    p.counts.events > 0 &&
      `${plural(p.counts.events, "timeline entry", "timeline entries")} cleaned`,
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

const encodingNames: Record<
  CatalogPurgePreview["mayAppearEncoded"][number]["encoding"],
  string
> = {
  base64: "base64",
  "percent-every-byte": "percent-encoded byte by byte",
  "quoted-printable": "quoted-printable",
  "utf-16": "UTF-16",
  "other-case": "in another letter case",
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
