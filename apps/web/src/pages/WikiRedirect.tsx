import { Navigate, useLocation, useParams } from "react-router"

/**
 * The wiki's old addresses lead to the same place in the catalog, for one
 * release after the rename (Git-based catalog plan §3, D-064): `/wiki/e/…`
 * is a page, `/wiki/start-here` is Start here, the workspace lists are
 * Needs attention, and the rest keeps its path.
 */
export function WikiRedirect() {
  const { workspaceId } = useParams()
  const location = useLocation()
  const rest = useParams()["*"] ?? ""
  const base = `/w/${workspaceId}/catalog`
  let to: string
  if (rest === "" || rest === "start-here") to = base
  else if (rest.startsWith("e/")) to = `${base}/p/${rest.slice(2)}`
  else if (rest === "lists" || rest.startsWith("lists/"))
    to = `${base}/needs-attention`
  else to = `${base}/${rest}`
  return <Navigate replace to={to + location.search + location.hash} />
}
