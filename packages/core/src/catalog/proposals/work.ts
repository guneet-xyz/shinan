import { applyOperations, validateChange } from "../document/index.js"
import type {
  Catalog,
  CatalogDocument,
  CatalogOperation,
  OperationProblem,
  Problem,
} from "../document/index.js"
import { classifyChange, touchedIds } from "./classify.js"
import type { ApprovalClass } from "./classify.js"

/** The latest revision of one stored document, already parsed. */
export interface StoredDocument {
  documentId: string
  document: CatalogDocument
}

export interface PrepareInput {
  operations: readonly CatalogOperation[]
  /** The actor's written form, written as `by` of new fact checks. */
  by: string
  /** The proposal's explanation, checked for secrets with the documents. */
  explanation: string
  /** The time "not in the future" is judged against, in milliseconds. */
  now: number
  /** The handles of the workspace's current members (catalog §2.3). */
  memberHandles: readonly string[]
}

/** One document the change writes, ready for `appendCatalogRevision`. */
export interface PreparedDocument {
  /** Null for a new document. */
  documentId: string | null
  text: string
  parsed: CatalogDocument
}

export type Prepared =
  /** An operation conflicts or cannot apply as written (catalog §8.5). */
  | { outcome: "problems"; problems: OperationProblem[] }
  /** The operations leave every document as it was. */
  | { outcome: "unchanged" }
  /** Validation found a blocking problem (catalog §8.3). */
  | { outcome: "blocked"; problems: Problem[] }
  | {
      outcome: "ready"
      documents: PreparedDocument[]
      /** Validation's warnings; any one makes the change doubtful. */
      warnings: Problem[]
      classes: ApprovalClass[]
      reasons: string[]
      /** For each `person` entity a new `accepted` names: its members' handles. */
      accepts: { entityId: string; memberHandles: string[] }[]
      /** Catalog IDs the change touches. */
      touches: string[]
    }

/**
 * Applies a proposal's operations to the latest revision, validates the
 * Markdown it would produce and sorts it into approval classes (catalog
 * §8.1 to §8.3). Pure: it runs in the catalog worker, off the main thread
 * (security checklist 10.8). The parsed latest revision is passed in, so
 * the catalog is not read again for each proposal.
 */
export function prepareChange(
  stored: readonly StoredDocument[],
  input: PrepareInput,
): Prepared {
  const documentIds = new Map<CatalogDocument, string>()
  for (const { documentId, document } of stored)
    documentIds.set(document, documentId)
  const result = applyOperations(
    stored.map((s) => s.document),
    input.operations,
    { by: input.by },
  )
  if (!result.applied) return { outcome: "problems", problems: result.problems }
  if (result.changes.length === 0) return { outcome: "unchanged" }

  const validation = validateChange(
    {
      before: result.before,
      after: result.after,
      changed: result.changes.map((c) => c.after),
      texts: [{ label: "The explanation", text: input.explanation }],
    },
    { now: input.now, memberHandles: new Set(input.memberHandles) },
  )
  if (validation.blocked)
    return {
      outcome: "blocked",
      problems: validation.problems.filter((p) => p.severity === "blocking"),
    }
  const warnings = validation.problems
  const classification = classifyChange(
    result.before,
    result.after,
    result.changes,
    warnings,
  )
  return {
    outcome: "ready",
    documents: result.changes.map((change) => ({
      documentId: change.before
        ? documentIdOf(documentIds, change.before)
        : null,
      text: change.after.text,
      parsed: change.after,
    })),
    warnings,
    classes: classification.classes,
    reasons: classification.reasons,
    accepts: classification.accepts.map((entityId) => ({
      entityId,
      memberHandles: memberHandlesOf(result.after, entityId),
    })),
    touches: touchedIds(result.changes),
  }
}

function documentIdOf(
  ids: ReadonlyMap<CatalogDocument, string>,
  document: CatalogDocument,
): string {
  const id = ids.get(document)
  if (id === undefined)
    throw new Error("A changed document is not one of the stored documents")
  return id
}

/**
 * The handles a `person` entity's current `member` facts hold (catalog
 * §2.3), finding it by ID or alias as references are.
 */
function memberHandlesOf(catalog: Catalog, id: string): string[] {
  const entity =
    catalog.entities.get(id) ??
    [...catalog.entities.values()].find((e) => e.document.aliases.includes(id))
  if (!entity || entity.document.type !== "person") return []
  return entity.facts
    .filter(
      (f) =>
        f.key === "member" &&
        (f.state === "observed" || f.state === "intended") &&
        typeof f.value === "string",
    )
    .map((f) => f.value as string)
}
