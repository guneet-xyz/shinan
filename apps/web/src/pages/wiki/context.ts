import { createContext, useContext } from "react"

import type { CatalogEntity } from "@shinan/api-client"

/**
 * The entity page's state, for the parts of the page: the workspace and the
 * entity as the agent index gives it.
 */
export interface EntityPageState {
  workspaceId: string
  entity: CatalogEntity
}

export const EntityPageContext = createContext<EntityPageState | null>(null)

export function useEntityPage(): EntityPageState {
  const state = useContext(EntityPageContext)
  if (!state) throw new Error("useEntityPage needs an EntityPage")
  return state
}
