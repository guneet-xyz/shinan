import { resolveEntity } from "./entity.js"
import type { ResolvedEntity } from "./entity.js"
import type {
  CatalogDocument,
  SchemaDocument,
  StartHereDocument,
} from "./model.js"
import { parseCatalogDocument } from "./parse.js"
import { buildTypeRegistry } from "./schemas.js"
import type { TypeRegistry } from "./schemas.js"

/**
 * The documents of one catalog revision, read together: type schema
 * documents first, then every entity with the resulting type schemas
 * (architecture §5.2: one parser reads schemas and entities from the same
 * revision).
 */
export interface Catalog {
  /** Every document, in the order given. */
  documents: CatalogDocument[]
  registry: TypeRegistry
  /** Entities by ID; when two documents share an ID, the first. */
  entities: ReadonlyMap<string, ResolvedEntity>
  schemas: SchemaDocument[]
  startHere: StartHereDocument | null
}

export function readCatalog(
  documents: Iterable<CatalogDocument | string>,
): Catalog {
  const parsed = [...documents].map((d) =>
    typeof d === "string" ? parseCatalogDocument(d) : d,
  )
  const schemas = parsed.filter((d) => d.kind === "schema")
  const registry = buildTypeRegistry(schemas)
  const entities = new Map<string, ResolvedEntity>()
  for (const document of parsed) {
    if (document.kind !== "entity" || document.id === null) continue
    if (!entities.has(document.id))
      entities.set(document.id, resolveEntity(document, registry))
  }
  return {
    documents: parsed,
    registry,
    entities,
    schemas,
    startHere: parsed.find((d) => d.kind === "start-here") ?? null,
  }
}
