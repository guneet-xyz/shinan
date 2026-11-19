import type {
  CatalogEditableAnswer,
  CatalogEntity,
  CatalogTypeSchemaKey,
} from "@shinan/api-client"

import { isApiError, useApi, useResource } from "../../../api"

/** The document an editor works on, with what the operations expect of it. */
export interface Loaded {
  entity: CatalogEntity
  editable: CatalogEditableAnswer
  keys: CatalogTypeSchemaKey[]
}

/** Loads an entity page's entity, its editable form and its type's keys. */
export function useEditableEntity(workspaceId: string, id: string) {
  const api = useApi()
  return useResource(`editable-entity:${workspaceId}:${id}`, async () => {
    const [entity, editable] = await Promise.all([
      api.catalogEntity(workspaceId, id),
      api.catalogEditable(workspaceId, id),
    ])
    const type = entity.entity.type
    const schema = type
      ? await api.catalogType(workspaceId, type).catch((error: unknown) => {
          if (isApiError(error, "not-found")) return null
          throw error
        })
      : null
    return {
      entity: entity.entity,
      editable,
      keys: schema?.schema.keys ?? [],
    } satisfies Loaded
  })
}
