import { NavLink, Outlet, useParams } from "react-router"

import { isApiError, useApi, useResource } from "../../api"
import { ErrorMessage, Loading } from "../../components/status"
import { NotFound } from "../NotFound"
import { useWorkspace, WorkspaceContext } from "./context"

export function WorkspaceLayout() {
  const api = useApi()
  const workspaceId = useParams().workspaceId!
  const workspace = useResource(`workspace:${workspaceId}`, () =>
    api.workspace(workspaceId),
  )

  if (workspace.data) {
    return (
      <WorkspaceContext
        value={{ workspace: workspace.data, reload: workspace.reload }}
      >
        <Outlet />
      </WorkspaceContext>
    )
  }
  if (isApiError(workspace.error, "not-found")) return <NotFound />
  if (workspace.error) return <ErrorMessage error={workspace.error} />
  return <Loading />
}

/**
 * Workspace settings (human experience, Workspace settings). They are for
 * workspace owners; contributors see what they may read and no actions.
 * Agents, git host connections, task flags, catalog settings and data come
 * with later milestones.
 */
export function SettingsLayout() {
  const { workspace } = useWorkspace()
  const owner = workspace.role === "owner"

  return (
    <>
      <h1>{workspace.name}</h1>
      <nav aria-label="Workspace settings" className="tabs">
        <NavLink to="general">General</NavLink>
        <NavLink to="members">Members</NavLink>
        {owner && <NavLink to="invitations">Invitations</NavLink>}
        <NavLink to="security-log">Security log</NavLink>
      </nav>
      <Outlet />
    </>
  )
}
