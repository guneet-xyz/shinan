import { useParams } from "react-router"

import { isApiError, useApi } from "../../api"
import { useCatalogAnswer } from "../../catalog-tree"
import { ErrorMessage, Loading } from "../../components/status"
import { NotFound } from "../NotFound"
import { aboutDocument } from "./about"
import { EntityPage } from "./EntityPage"
import { IndexBehind } from "./notices"
import { PageBody, PageFooter, PageHeading, ProblemsNotice } from "./PageParts"

/**
 * `…/catalog/p/<ID>`: a type schema document (`schema/<type>`) is a page
 * like any other (D-064: no type pages); every other ID is an entity's.
 */
export function PageRoute() {
  const workspaceId = useParams().workspaceId!
  const id = useParams()["*"] ?? ""
  if (id.startsWith("schema/"))
    return <DocumentPage key={id} workspaceId={workspaceId} id={id} />
  return <EntityPage key={id} workspaceId={workspaceId} id={id} />
}

/** A type schema document as a page: title, summary, body and footer. */
export function DocumentPage(props: { workspaceId: string; id: string }) {
  const api = useApi()
  const { workspaceId, id } = props
  const answer = useCatalogAnswer(
    workspaceId,
    `catalog-document:${workspaceId}:${id}`,
    () => api.catalogDocument(workspaceId, id),
  )
  if (answer.error) {
    if (isApiError(answer.error, "not-found")) return <NotFound />
    return <ErrorMessage error={answer.error} />
  }
  if (!answer.data) return <Loading />
  const document = answer.data.document
  return (
    <article className="flex flex-col gap-6">
      <PageHeading
        title={document.title}
        id={document.id}
        summary={document.summary}
      />
      <IndexBehind behind={answer.behind} />
      <ProblemsNotice problems={document.problems} />
      <PageBody
        workspaceId={workspaceId}
        sections={document.body}
        title={document.title}
      />
      <PageFooter
        workspaceId={workspaceId}
        id={document.id}
        commit={answer.data.catalog_commit}
        about={aboutDocument(workspaceId, document)}
      />
    </article>
  )
}
