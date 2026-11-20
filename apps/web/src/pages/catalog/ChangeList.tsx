import { useState } from "react"
import type { ReactNode } from "react"

import type { CatalogChange } from "@shinan/api-client"

import { Button } from "@/components/ui/button"

import { ErrorMessage } from "../../components/status"
import { VisibleText } from "./VisibleText"

/*
 * A list of `main`'s changes (product brief on #169: Recent changes, and a
 * page's History), newest first under day headings. Each change is its
 * message's first line as the headline, the start of the rest under it,
 * then who and when and the short commit ID, so a person can tell an agent
 * "revert abc1234". Who pushed it comes from the push log (GC-3a).
 */

const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })
const clockFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "short" })
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
})

/** The start of a time's day, in the browser's time zone. */
function dayOf(iso: string): number {
  const d = new Date(iso)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** A day's heading: "Today", "Yesterday" or the date. */
function dayLabel(day: number, now = new Date()): string {
  const days = Math.round((dayOf(now.toISOString()) - day) / 86_400_000)
  if (days === 0) return "Today"
  if (days === 1) return "Yesterday"
  return dayFormat.format(new Date(day))
}

/**
 * Changes under day headings, in the history's order. Commit times are
 * set by agents, so they can go backwards in the history: a new heading
 * starts only on an earlier day (product review of #194), and a change
 * dated later than its heading shows its own date.
 */
function byDay<T extends CatalogChange>(changes: readonly T[]) {
  const days: {
    day: number | null
    changes: { change: T; ownDate: boolean }[]
  }[] = []
  for (const change of changes) {
    const day = change.time ? dayOf(change.time) : null
    const last = days[days.length - 1]
    if (last && (day === null || (last.day !== null && day >= last.day)))
      last.changes.push({
        change,
        ownDate: day !== null && last.day !== null && day > last.day,
      })
    else days.push({ day, changes: [{ change, ownDate: false }] })
  }
  return days
}

interface ChangesPage<T> {
  catalog_commit: string | null
  changes: T[]
  next_after: string | null
}

/**
 * The changes of a first page, and older pages read on "Show older
 * changes" from the cursor each page gives. `after` is a line under each
 * change, such as the pages it changed.
 */
export function ChangeList<T extends CatalogChange>(props: {
  /** Names what is listed; older pages are forgotten when it changes. */
  listKey: string
  first: ChangesPage<T>
  loadOlder: (after: string) => Promise<ChangesPage<T>>
  after?: (change: T) => ReactNode
  empty: string
}) {
  const [more, setMore] = useState<{ key: string; pages: ChangesPage<T>[] }>({
    key: "",
    pages: [],
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const key = `${props.listKey}:${props.first.catalog_commit ?? ""}`
  const pages = more.key === key ? more.pages : []
  const changes = [props.first, ...pages].flatMap((p) => p.changes)
  const next = (pages[pages.length - 1] ?? props.first).next_after
  const showOlder = async () => {
    if (!next) return
    setLoading(true)
    setError(null)
    try {
      const page = await props.loadOlder(next)
      setMore({ key, pages: [...pages, page] })
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }
  return (
    <>
      {changes.length === 0 && (
        <p className="text-sm">
          {next
            ? "These latest commits only merged work listed further back. Show older changes to see it."
            : props.empty}
        </p>
      )}
      {byDay(changes).map((day) => (
        <section
          key={day.changes[0]!.change.commit}
          className="flex flex-col gap-3"
        >
          <h2 className="text-sm font-semibold text-muted-foreground">
            {day.day === null ? "Undated" : dayLabel(day.day)}
          </h2>
          <ol className="flex flex-col gap-5">
            {day.changes.map(({ change, ownDate }) => (
              <ChangeItem key={change.commit} change={change} ownDate={ownDate}>
                {props.after?.(change)}
              </ChangeItem>
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
    </>
  )
}

/** One change: its headline, the start of the rest, when, its short ID. */
function ChangeItem(props: {
  change: CatalogChange
  /** Show its date with its time: it is later than its day's heading. */
  ownDate?: boolean
  children?: ReactNode
}) {
  const { change } = props
  return (
    <li className="flex min-w-0 flex-col gap-0.5">
      <p className="font-medium wrap-anywhere">
        <VisibleText text={change.subject || "(no message)"} oneLine />
      </p>
      {change.body && (
        <p className="line-clamp-3 text-sm wrap-anywhere whitespace-pre-line text-muted-foreground">
          <VisibleText text={change.body} />
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {/* GC-3a: "Guneet, through OpenCode on Daedalus · ", from the push log. */}
        {change.time && (
          <time dateTime={change.time}>
            {(props.ownDate ? dateTimeFormat : clockFormat).format(
              new Date(change.time),
            )}
          </time>
        )}
        {change.time && " · "}
        <code className="font-mono">{change.commit.slice(0, 7)}</code>
      </p>
      {props.children}
    </li>
  )
}
