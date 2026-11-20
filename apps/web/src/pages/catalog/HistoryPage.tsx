import { Link, useParams } from "react-router"

import { isApiError, useApi, useResource } from "../../api"
import { ErrorMessage, Loading } from "../../components/status"
import { NotFound } from "../NotFound"
import { ChangeList } from "./ChangeList"
import { entityPath, listLinkClass } from "./format"
import { TitleText } from "./VisibleText"

/**
 * A page's History (product brief on #169, Recent changes for one page):
 * the changes of its file on `main`, newest first, by day.
 */
export function HistoryPage() {
  const api = useApi()
  const workspaceId = useParams().workspaceId!
  const id = useParams()["*"] ?? ""
  const first = useResource(`catalog-history:${workspaceId}:${id}`, () =>
    api.catalogHistory(workspaceId, id),
  )

  if (first.error) {
    if (isApiError(first.error, "not-found")) return <NotFound />
    return <ErrorMessage error={first.error} />
  }
  if (!first.data) return <Loading />
  const answer = first.data
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
      <ChangeList
        listKey={`history:${workspaceId}:${id}`}
        first={answer}
        loadOlder={(after) => api.catalogHistory(workspaceId, id, { after })}
        empty="No changes to show yet."
      />
    </div>
  )
}
