import {
  applyOperations,
  prepareCatalogValidation,
  updateCatalogValidation,
  utf8Length,
  validateChangeIncrementally,
} from "../document/index.js"
import type {
  Catalog,
  CatalogDocument,
  CatalogOperation,
  CatalogValidation,
  DocumentChange,
  OperationProblem,
  Problem,
  SecretScans,
  ValidationContext,
} from "../document/index.js"
import { classifyChange, touchedIds } from "./classify.js"
import type { ApprovalClass } from "./classify.js"
import { estimatedBytes } from "./estimate.js"

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
  /**
   * The person approving the proposal, by handle: an `accept-discrepancy`
   * names their `person` entity (catalog §4.7). With `preview`, nobody has
   * approved yet: the author's person, or another member's, stands in, so
   * the rest of the proposal is checked before it waits for approval.
   */
  approver?: { handle: string; preview: boolean }
}

/** One document the change writes, ready for `appendCatalogRevision`. */
export interface PreparedDocument {
  /** Null for a new document. */
  documentId: string | null
  text: string
  parsed: CatalogDocument
}

export interface CatalogSize {
  bytesBefore: number
  bytes: number
  documentsBefore: number
  documents: number
  estimatedBefore: number
  estimated: number
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
      /**
       * The catalog's size before and after: bytes of UTF-8 text, documents,
       * and the catalog worker's estimate of its memory (`estimatedBytes`).
       */
      size: CatalogSize
    }

/**
 * Applies a proposal's operations to the latest revision, validates the
 * Markdown it would produce and sorts it into approval classes (catalog
 * §8.1 to §8.3). Pure: it runs in the catalog worker, off the main thread
 * (security checklist 10.8). The parsed latest revision is passed in, so
 * the catalog is not read again for each proposal.
 *
 * `base`, the validation of the latest revision or of any other, saves
 * validating the documents the change cannot affect (catalog §8.3,
 * "Cost"); the result is the same without it.
 */
export function prepareChange(
  stored: readonly StoredDocument[],
  input: PrepareInput,
  base?: CatalogValidation,
): Prepared {
  return prepareChangeIncrementally(stored, input, { base }).prepared
}

/**
 * `prepareChange`, also giving the validations it made, for the catalog
 * worker to keep: `before`, of the latest revision, whenever the change
 * was validated; `after`, of the catalog the change would make, when it is
 * ready to store. `after` becomes the latest revision's validation only
 * once the change is stored. `secretScans` keeps secret scans between
 * proposals (`SecretScans`).
 */
export function prepareChangeIncrementally(
  stored: readonly StoredDocument[],
  input: PrepareInput,
  kept: { base?: CatalogValidation; secretScans?: SecretScans } = {},
): {
  prepared: Prepared
  before?: CatalogValidation
  after?: CatalogValidation
} {
  const documentIds = new Map<CatalogDocument, string>()
  for (const { documentId, document } of stored)
    documentIds.set(document, documentId)
  const accepting = input.operations.findIndex(
    (o) =>
      typeof o === "object" &&
      o !== null &&
      (o as { op?: unknown }).op === "accept-discrepancy",
  )
  let acceptedBy: string | undefined
  if (accepting >= 0 && input.approver) {
    acceptedBy =
      personEntityOf(stored, [input.approver.handle]) ??
      (input.approver.preview
        ? personEntityOf(stored, input.memberHandles)
        : undefined)
    if (acceptedBy === undefined)
      return {
        prepared: {
          outcome: "problems",
          problems: [
            {
              operation: accepting,
              kind: "invalid",
              code: "needs-approval",
              message: input.approver.preview
                ? "Accepting a discrepancy names the approving person's entity, and no person entity has a `member` fact holding a member's handle"
                : `Accepting a discrepancy names the approving person's entity, and no person entity has a \`member\` fact holding ${input.approver.handle}`,
              documentId: null,
            },
          ],
        },
      }
  }
  const result = applyOperations(
    stored.map((s) => s.document),
    input.operations,
    acceptedBy === undefined ? { by: input.by } : { by: input.by, acceptedBy },
  )
  if (!result.applied)
    return { prepared: { outcome: "problems", problems: result.problems } }
  if (result.changes.length === 0) return { prepared: { outcome: "unchanged" } }

  const context = validationContext(input, kept.secretScans)
  const base = kept.base
  // The latest revision's own validation, so it can be kept whatever the
  // outcome; from it, the change's validation reuses it as it is.
  const before = base
    ? updateCatalogValidation(base, result.before, context)
    : prepareCatalogValidation(result.before, context)
  const { result: validation, after } = validateChangeIncrementally(
    {
      before: result.before,
      after: result.after,
      changed: result.changes.map((c) => c.after),
      texts: [{ label: "The explanation", text: input.explanation }],
    },
    context,
    before,
  )
  if (validation.blocked)
    return {
      prepared: {
        outcome: "blocked",
        problems: validation.problems.filter((p) => p.severity === "blocking"),
      },
      before,
    }
  const warnings = validation.problems
  const classification = classifyChange(
    result.before,
    result.after,
    result.changes,
    warnings,
  )
  const prepared: Prepared = {
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
    size: sizeOf(stored, result.changes, before, after),
  }
  return { prepared, before, after }
}

/** The validation context of a proposal. */
export function validationContext(
  input: Pick<PrepareInput, "now" | "memberHandles">,
  secretScans?: SecretScans,
): ValidationContext {
  return {
    now: input.now,
    memberHandles: new Set(input.memberHandles),
    ...(secretScans ? { secretScans } : {}),
  }
}

/**
 * The catalog's size before and after: each document with what its
 * validation keeps (`estimatedBytes`), from the validations of both.
 */
function sizeOf(
  stored: readonly StoredDocument[],
  changes: readonly DocumentChange[],
  before: CatalogValidation,
  after: CatalogValidation,
): CatalogSize {
  let bytesBefore = 0
  let estimatedBefore = 0
  for (const { document } of stored) {
    bytesBefore += utf8Length(document.text)
    estimatedBefore += estimatedBytes(document, before.counts(document))
  }
  let bytes = bytesBefore
  let estimated = 0
  let added = 0
  for (const change of changes) {
    if (change.before) bytes -= utf8Length(change.before.text)
    else added++
    bytes += utf8Length(change.after.text)
  }
  for (const document of after.documents)
    estimated += estimatedBytes(document, after.counts(document))
  return {
    bytesBefore,
    bytes,
    documentsBefore: stored.length,
    documents: stored.length + added,
    estimatedBefore,
    estimated,
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
 * The first `person` entity, in document order, whose current `member` fact
 * holds one of the handles, read from the stored text (catalog §2.3).
 */
function personEntityOf(
  stored: readonly StoredDocument[],
  handles: readonly string[],
): string | undefined {
  for (const handle of handles)
    for (const { document } of stored)
      if (
        document.kind === "entity" &&
        document.type === "person" &&
        document.status !== "retired" &&
        document.id !== null &&
        document.facts.some(
          (f) =>
            f.key === "member" &&
            (f.state === "observed" || f.state === "intended") &&
            f.value === handle,
        )
      )
        return document.id
  return undefined
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
