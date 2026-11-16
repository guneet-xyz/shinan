import { createContext, useContext } from "react"

import type { Workspace } from "@shinan/api-client"

export interface WorkspaceState {
  workspace: Workspace
  reload: () => void
}

export const WorkspaceContext = createContext<WorkspaceState | null>(null)

/** The workspace being shown, with the person's own role in it. */
export function useWorkspace(): WorkspaceState {
  const state = useContext(WorkspaceContext)
  if (!state) throw new Error("useWorkspace needs WorkspaceLayout")
  return state
}
