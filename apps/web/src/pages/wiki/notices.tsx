import { InfoIcon, TriangleAlertIcon } from "lucide-react"
import type { ReactNode } from "react"
import { Link, useLocation } from "react-router"

import { cn } from "@/lib/utils"

import { linkClass } from "./facts"
import { wikiPath } from "./format"

/**
 * A notice on a page that is not an error: the index being behind, an
 * entity being retired. `warning` for things to act on.
 */
export function PageNotice(props: {
  children: ReactNode
  warning?: boolean
  className?: string
}) {
  const Icon = props.warning ? TriangleAlertIcon : InfoIcon
  return (
    <div
      className={cn(
        "flex gap-2 rounded-lg border px-4 py-3 text-sm",
        props.warning &&
          "border-amber-600/40 bg-amber-50 text-amber-950 dark:border-amber-400/40 dark:bg-amber-950/40 dark:text-amber-50",
        props.className,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="flex flex-col gap-1">{props.children}</div>
    </div>
  )
}

/** Shown on every page whose answer says the agent index is behind. */
export function IndexBehind(props: { behind: boolean }) {
  if (!props.behind) return null
  return (
    <PageNotice warning>
      The catalog is being brought up to date, so this page may not show the
      latest changes yet.
    </PageNotice>
  )
}

/** What an editor passes back to the page it returns to after saving. */
export interface SavedState {
  saved: { number: number; id: string }
}

/** Shown on a page an editor came back to: the proposal it saved. */
export function SavedNotice(props: { workspaceId: string }) {
  const saved = (useLocation().state as Partial<SavedState> | null)?.saved
  if (!saved) return null
  return (
    <PageNotice>
      <p role="status">
        Saved as{" "}
        <Link
          to={wikiPath(props.workspaceId, `/proposals/${saved.id}`)}
          className={linkClass}
        >
          catalog proposal {saved.number}
        </Link>
        .
      </p>
    </PageNotice>
  )
}
