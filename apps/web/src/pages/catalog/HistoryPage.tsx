import { useState } from "react"
import { Link, useParams } from "react-router"

import type { CatalogChange, CatalogHistoryAnswer } from "@shinan/api-client"

import { Button } from "@/components/ui/button"

import { isApiError, useApi, useResource } from "../../api"
import { ErrorMessage, Loading } from "../../components/status"
import { NotFound } from "../NotFound"
import { entityPath, listLinkClass } from "./format"
import { TitleText, VisibleText } from "./VisibleText"

const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })
const clockFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "short" })

/** A day's heading: "Today", "Yesterday" or the date. */
function dayLabel(iso: string, now = new Date()): string {
  const day = new Date(iso)
  const start = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((start(now) - start(day)) / 86_400_000)
  if (days === 0) return "Today"
  if (days === 1) return "Yesterday"
  return dayFormat.format(day)
}

/** Changes grouped by the day they were made, newest first. */
function byDay(changes: readonly CatalogChange[]) {
  const days: { label: string; changes: CatalogChange[] }[] = []
  for (const change of changes) {
    const label = change.time ? dayLabel(change.time) : "Undated"
    const last = days[days.length - 1]
    if (last?.label === label) last.changes.push(change)
    else days.push({ label, changes: [change] })
  }
  return days
}

/**
 * A page's History (product brief on #169, Recent changes for one page):
 * the changes of its file on `main`, newest first, by day. Each is its
 * message's first line (hidden characters marked), when, and the short
 * commit ID, so a person can tell an agent "revert abc1234". Who pushed it
 * comes from the push log (GC-3a).
 */
export function HistoryPage() {
  const api = useApi()
  const workspaceId = useParams().workspaceId!
  const id = useParams()["*"] ?? ""
  const first = useResource(`catalog-history:${workspaceId}:${id}`, () =>
    api.catalogHistory(workspaceId, id),
  )
  const [more, setMore] = useState<{
    key: string
    pages: CatalogHistoryAnswer[]
  }>({ key: "", pages: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const key = `${workspaceId}:${id}:${first.data?.catalog_commit ?? ""}`
  const pages = more.key === key ? more.pages : []

  if (first.error) {
    if (isApiError(first.error, "not-found")) return <NotFound />
    return <ErrorMessage error={first.error} />
  }
  if (!first.data) return <Loading />
  const answer = first.data
  const changes = [answer, ...pages].flatMap((p) => p.changes)
  const next = (pages[pages.length - 1] ?? answer).next_after
  const showOlder = async () => {
    if (!next) return
    setLoading(true)
    setError(null)
    try {
      const page = await api.catalogHistory(workspaceId, id, { after: next })
      setMore({ key, pages: [...pages, page] })
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">
          History of <TitleText title={answer.title} id={id} />
        </h1>
        <p className="text-sm text-muted-foreground">
          The changes to{" "}
          <Link to={entityPath(workspaceId, id)} className={listLinkClass}>
            this page
          </Link>
          , newest first.
        </p>
      </header>
      {changes.length === 0 && (
        <p className="text-sm">No changes to show yet.</p>
      )}
      {byDay(changes).map((day) => (
        <section key={day.label} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            {day.label}
          </h2>
          <ol className="flex flex-col gap-4">
            {day.changes.map((change) => (
              <ChangeItem key={change.commit} change={change} />
            ))}
          </ol>
        </section>
      ))}
      {error ? <ErrorMessage error={error} /> : null}
      {next && (
        <Button
          variant="outline"
          className="self-start"
          disabled={loading}
          onClick={() => void showOlder()}
        >
          Show older changes
        </Button>
      )}
    </div>
  )
}

/** One change: its message's first line, when, and the short commit ID. */
function ChangeItem(props: { change: CatalogChange }) {
  const { change } = props
  const headline = change.subject
  const body = change.body
  return (
    <li className="flex min-w-0 flex-col gap-0.5">
      <p className="font-medium wrap-anywhere">
        <VisibleText text={headline || "(no message)"} oneLine />
      </p>
      {body && (
        <p className="text-sm wrap-anywhere whitespace-pre-line text-muted-foreground">
          <VisibleText text={body} />
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {/* GC-3a: "Guneet, through OpenCode on Daedalus · ", from the push log. */}
        {change.time && (
          <time dateTime={change.time}>
            {clockFormat.format(new Date(change.time))}
          </time>
        )}
        {change.time && " · "}
        <code className="font-mono">{change.commit.slice(0, 7)}</code>
      </p>
    </li>
  )
}
