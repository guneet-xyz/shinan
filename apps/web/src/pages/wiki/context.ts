import { createContext, useContext } from "react"

import type { CatalogEntity } from "@shinan/api-client"

/**
 * The entity page's state, for the parts of the page and for what M2-8 adds
 * to it (Suggest a change, Record a check): the workspace, the entity as
 * the agent index gives it, and a way to load it again after a change.
 */
export interface EntityPageState {
  workspaceId: string
  entity: CatalogEntity
  reload: () => void
}

export const EntityPageContext = createContext<EntityPageState | null>(null)

export function useEntityPage(): EntityPageState {
  const state = useContext(EntityPageContext)
  if (!state) throw new Error("useEntityPage needs an EntityPage")
  return state
}
