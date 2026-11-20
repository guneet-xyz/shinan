import type { ReactNode } from "react"
import { Link, useLocation } from "react-router"

import type { CatalogSection } from "@shinan/api-client"

import { useApi, useResource } from "../../api"
import { formatTime } from "../../format"
import { pageBody } from "./body"
import { EntityLink } from "./facts"
import {
  entityPath,
  historyPath,
  listLinkClass,
  relativeTime,
  sourcePath,
} from "./format"
import { Markdown } from "./markdown"
import { PageNotice } from "./notices"
import { HiddenNote, TitleText, VisibleText } from "./VisibleText"

/*
 * The parts every catalog page shares (product brief on #169): the title
 * with its summary as one line, a calm notice when the page is retired, the
 * body, and a footer with when it last changed, History, View source and a
 * quiet line about the page.
 */

/** The page's title (hidden characters explained) and its summary. */
export function PageHeading(props: {
  title: string | null
  id: string
  summary: string | null
  /** A muted line after the summary, such as what a type schema describes. */
  note?: ReactNode
}) {
  return (
    <header className="flex min-w-0 flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">
        <TitleText title={props.title} id={props.id} />
      </h1>
      {props.summary && (
        <p className="wrap-anywhere text-muted-foreground">
          <VisibleText text={props.summary} oneLine />
        </p>
      )}
      {props.note && (
        <p className="text-sm text-muted-foreground">{props.note}</p>
      )}
      <HiddenNote title={props.title ?? props.id} summary={props.summary} />
    </header>
  )
}

/**
 * A retired or deprecated page says so first, calmly, with where to go
 * instead: "This page is retired. See Email."
 */
export function StatusNotice(props: {
  workspaceId: string
  status: string | null
  replacedBy: string | null
}) {
  if (props.status !== "retired" && props.status !== "deprecated") return null
  return (
    <PageNotice>
      <p>
        This page is {props.status}
        {props.status === "deprecated" &&
          ": it still exists, but isn't for new work"}
        .{" "}
        {props.replacedBy ? (
          <>
            See{" "}
            <EntityLink workspaceId={props.workspaceId} id={props.replacedBy} />
            .
          </>
        ) : (
          props.status === "retired" && "It's kept for its history."
        )}
      </p>
    </PageNotice>
  )
}

/** Followed from a former ID, the page says where it moved. */
export function MovedNotice() {
  const movedFrom = (useLocation().state as { movedFrom?: string } | null)
    ?.movedFrom
  if (!movedFrom) return null
  return (
    <p className="text-sm text-muted-foreground">
      You followed an old address:{" "}
      <code className="font-mono text-xs wrap-anywhere">
        <VisibleText text={movedFrom} oneLine />
      </code>{" "}
      is now this page.
    </p>
  )
}

/** What the catalog couldn't read of the page's file. */
export function ProblemsNotice(props: {
  problems: { code: string; message: string }[]
}) {
  if (props.problems.length === 0) return null
  return (
    <PageNotice warning>
      <p className="font-semibold">Part of this page couldn't be read:</p>
      <ul className="list-disc pl-5">
        {props.problems.map((p, i) => (
          <li key={i}>
            <VisibleText text={p.message} />
          </li>
        ))}
      </ul>
    </PageNotice>
  )
}

/** The page's body, rendered, without a first heading repeating its title. */
export function PageBody(props: {
  workspaceId: string
  sections: readonly CatalogSection[]
  title: string | null
}) {
  const body = pageBody(props.sections, props.title)
  if (!body) return null
  return (
    <Markdown
      text={body.text}
      anchors={body.anchors}
      headingOffset={body.headingOffset}
      className="min-w-0 wrap-break-word"
      entityPath={(id) => entityPath(props.workspaceId, id)}
    />
  )
}

/**
 * When the page last changed, from `main`'s commits. Who changed it comes
 * from the push log (GC-3a): a commit's author is not trusted (D-061), so
 * until then no name is shown. Left out when the repository can't be read.
 */
function LastChanged(props: {
  workspaceId: string
  id: string
  commit: string | null
}) {
  const api = useApi()
  const last = useResource(
    `catalog-last-change:${props.workspaceId}:${props.id}:${props.commit ?? ""}`,
    () => api.catalogHistory(props.workspaceId, props.id, { limit: 1 }),
  )
  const time = last.data?.changes[0]?.time
  if (!time) return null
  return (
    <>
      Last changed{" "}
      <time dateTime={time} title={formatTime(time)}>
        {relativeTime(time)}
      </time>
      {/* GC-3a: "by Guneet, through OpenCode on Daedalus", from the push log. */}
      {" · "}
    </>
  )
}

/** One part of "About this page". */
export interface AboutPart {
  label: string
  value: ReactNode
}

/**
 * The footer: when it last changed, History and View source, then a quiet
 * line about the page (its file, ID, old IDs, owner, status).
 */
export function PageFooter(props: {
  workspaceId: string
  id: string
  commit: string | null
  about: AboutPart[]
}) {
  return (
    <footer className="flex flex-col gap-2 border-t pt-4 text-sm text-muted-foreground">
      <p>
        <LastChanged
          workspaceId={props.workspaceId}
          id={props.id}
          commit={props.commit}
        />
        <Link
          to={historyPath(props.workspaceId, props.id)}
          className={listLinkClass}
        >
          History
        </Link>
        {" · "}
        <Link
          to={sourcePath(props.workspaceId, props.id)}
          className={listLinkClass}
        >
          View source
        </Link>
      </p>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
        <h2 className="font-medium">About this page</h2>
        <dl className="contents">
          {props.about.map((part) => (
            <div key={part.label} className="flex min-w-0 gap-1">
              <dt>{part.label}</dt>
              <dd className="min-w-0 wrap-anywhere text-foreground/80">
                {part.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </footer>
  )
}

/** A file name or ID in the About line. */
export function Code(props: { text: string }) {
  return (
    <code className="font-mono">
      <VisibleText text={props.text} oneLine />
    </code>
  )
}
