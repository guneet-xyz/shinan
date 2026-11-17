import { NavLink, Outlet, useParams } from "react-router"

import { cn } from "@/lib/utils"

import { isApiError, useApi, useResource } from "../../api"
import { PageHeader } from "../../components/page"
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

  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      "inline-flex h-8 shrink-0 items-center justify-center rounded-md px-3 text-sm font-medium whitespace-nowrap text-foreground/70 transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring",
      isActive && "bg-background text-foreground shadow-sm dark:bg-input/30",
    )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={workspace.name}>Workspace settings</PageHeader>
      <nav aria-label="Workspace settings" className="-mt-2 sm:self-start">
        <div
          className={cn(
            "grid gap-1 rounded-lg bg-muted p-1 sm:flex",
            owner ? "grid-cols-2" : "grid-cols-3",
          )}
        >
          <NavLink to="general" className={tab}>
            General
          </NavLink>
          <NavLink to="members" className={tab}>
            Members
          </NavLink>
          {owner && (
            <NavLink to="invitations" className={tab}>
              Invitations
            </NavLink>
          )}
          <NavLink to="security-log" className={tab}>
            Security log
          </NavLink>
        </div>
      </nav>
      <Outlet />
    </div>
  )
}
