import { Fragment } from "react"
import { Link } from "react-router"

import type { CatalogRecentChange } from "@shinan/api-client"

import { useApi } from "../../api"
import { useCatalogAnswer } from "../../catalog-tree"
import { ErrorMessage, Loading } from "../../components/status"
import { useWorkspace } from "../workspace/context"
import { ChangeList } from "./ChangeList"
import { entityPath, listLinkClass } from "./format"
import { IndexBehind } from "./notices"
import { TitleText, VisibleText } from "./VisibleText"

/**
 * Recent changes (product brief on #169; GQ-6): `main`'s commits, newest
 * first by day, each with the pages it changed. With no approvals, this is
 * the review after the fact: what changed, when, and (with the push log,
 * GC-3a) which agent changed it.
 */
export function RecentChangesPage() {
  const api = useApi()
  const { workspace } = useWorkspace()
  const workspaceId = workspace.id
  const first = useCatalogAnswer(
    workspaceId,
    `catalog-changes:${workspaceId}`,
    () => api.catalogChanges(workspaceId),
  )
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Recent changes
        </h1>
        <p className="text-sm text-muted-foreground">
          What agents changed in the catalog, newest first.
        </p>
      </header>
      {first.error ? <ErrorMessage error={first.error} /> : null}
      {!first.data && !first.error && <Loading />}
      {first.data && (
        <>
          <IndexBehind behind={first.behind} />
          <ChangeList
            listKey={`changes:${workspaceId}`}
            first={first.data}
            loadOlder={(after) => api.catalogChanges(workspaceId, { after })}
            after={(change) => (
              <ChangedPages workspaceId={workspaceId} change={change} />
            )}
            empty="No changes yet."
          />
        </>
      )}
    </div>
  )
}

/**
 * The pages a change touched: up to three by title, then "and 15 more". A
 * file that isn't a page now shows by its name.
 */
function ChangedPages(props: {
  workspaceId: string
  change: CatalogRecentChange
}) {
  const { change } = props
  if (change.pages.length === 0) {
    if (change.page_count === 0 && !change.page_count_at_least) return null
    return (
      <p className="text-sm text-muted-foreground">
        {change.page_count === 0
          ? "Changed files not known"
          : `${change.page_count_at_least ? "At least " : ""}${change.page_count.toLocaleString()} files changed`}
      </p>
    )
  }
  const rest = change.page_count - change.pages.length
  return (
    <p className="text-sm wrap-anywhere">
      {change.pages.map((page, i) => (
        <Fragment key={page.path}>
          {i > 0 &&
            (i === change.pages.length - 1 && rest <= 0 ? " and " : ", ")}
          {page.id ? (
            <Link
              to={entityPath(props.workspaceId, page.id)}
              className={listLinkClass}
            >
              <TitleText title={page.title} id={page.id} />
            </Link>
          ) : (
            <code className="font-mono text-xs">
              <VisibleText text={page.path} oneLine />
            </code>
          )}
        </Fragment>
      ))}
      {rest > 0 &&
        ` and ${change.page_count_at_least ? "at least " : ""}${rest.toLocaleString()} more`}
    </p>
  )
}
