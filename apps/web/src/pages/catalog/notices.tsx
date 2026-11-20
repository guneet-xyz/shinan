import { InfoIcon, TriangleAlertIcon } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

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

/**
 * Shown on every catalog page whose answer says the index is behind `main`
 * (catalog §12.4): quietly, since the page updates by itself.
 */
export function IndexBehind(props: { behind: boolean }) {
  if (!props.behind) return null
  return (
    <p role="status" className="text-sm text-muted-foreground">
      Catching up with the latest changes…
    </p>
  )
}

/**
 * While the workspace's repository is being made (a moment after the
 * workspace is created), the catalog says so instead of showing an empty
 * page; the sidebar reads again until it is there.
 */
export function BeingSetUp() {
  return (
    <div role="status" className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">
        Your catalog is being set up.
      </h1>
      <p className="text-sm text-muted-foreground">This takes a few seconds.</p>
    </div>
  )
}
