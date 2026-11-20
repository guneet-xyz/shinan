import type { Range } from "./source.js"

/**
 * Whether a problem stops a catalog proposal from applying (`blocking`) or
 * holds it for catalog approval with the reason shown (`warning`), as catalog
 * §8.3 sets out.
 */
export type Severity = "blocking" | "warning"

/** What a problem is about. Codes are stable: tests, the API and the screens use them. */
export type ProblemCode =
  /** A document or proposal text is longer than Shinan reads (catalog §2.1). */
  | "too-large"
  /**
   * A file on `main` whose name Shinan cannot read (a control character,
   * bytes that are not UTF-8): the index records it without its text.
   */
  | "unreadable-path"
  /** The frontmatter is missing, is not YAML, or uses YAML outside the allowed subset (catalog §2.1). */
  | "frontmatter-invalid"
  /** The body is past the limits on what Shinan reads (catalog §2.1). */
  | "body-invalid"
  /**
   * Reading failed unexpectedly: a bug in Shinan or a dependency, reported
   * instead of thrown. Tests fail when they see it.
   */
  | "read-failed"
  /** A required document field is missing (catalog §2.3, §3.9, §11). */
  | "field-missing"
  /** A document field has the wrong form, or is not a field of this kind of document. */
  | "field-invalid"
  /** A date or date and time is not written as Shinan reads them. */
  | "date-invalid"
  /** The `facts` list or one of its groups does not have the shape of catalog §4.3. */
  | "facts-invalid"
  /** A fact's value or long form does not fit its key (catalog §4.3, §5). */
  | "fact-invalid"
  /** A single-valued key holds a list (catalog §4.2). */
  | "cardinality"
  /** A type schema document is not written as catalog §3.9 allows. */
  | "schema-invalid"
  /** The start-here document is not written as catalog §11 allows. */
  | "start-here-invalid"
  // Validation of a document set (catalog §8.3). Blocking:
  /** `type` names neither a built-in type nor a type schema that is not retired. */
  | "type-unknown"
  /** Two documents share an ID or alias. */
  | "id-duplicate"
  /** A reference (owner, relation target, body link, step, task) does not resolve. */
  | "reference-unresolved"
  /** A reference points to an entity of a type it may not (catalog §5). */
  | "reference-type"
  /** An `intended` or `observed` fact is not in a fact check group. */
  | "fact-check-missing"
  /** A fact check lacks `checked`, `by`, `scope` or `source`. */
  | "fact-check-incomplete"
  /** A fact check's `by` is not a written actor (identity §8.7). */
  | "fact-check-invalid"
  /** A fact check's `checked` is in the future. */
  | "checked-in-future"
  /** `checked: null` or `by: unknown` on a document that was not imported. */
  | "unchecked-not-imported"
  /** A `planned` fact names neither a task nor an accepted decision. */
  | "planned-without-task"
  /** Two current facts share an identity (catalog §4.2). */
  | "identity-duplicate"
  /** A type schema change would break current entities (catalog §3.9). */
  | "schema-breaks-entities"
  /** A value that is almost certainly a credential (catalog §7.3). */
  | "secret"
  // Warnings:
  /** A weaker sign of a secret (catalog §7.3). */
  | "secret-suspected"
  /** A task workflow status, such as `in progress`, copied into a fact. */
  | "task-status"
  /** A fact key that the type schema does not name (catalog §3.9). */
  | "key-not-in-schema"
  /** A new fact check is older than the one it replaces. */
  | "check-older"
  /** A start-here step points to a retired entity (catalog §11). */
  | "start-here-retired"
  /** A start-here step points to an entity with discrepancies (catalog §11). */
  | "start-here-discrepancy"
  /** An owner's `person` entity is not linked to a current member (catalog §2.3). */
  | "owner-not-member"

export interface Problem {
  code: ProblemCode
  severity: Severity
  message: string
  /** The document's ID, when it has one. */
  documentId: string | null
  /** Where in the document's text, when it can be pointed at. */
  range?: Range
}

export function blocking(
  code: ProblemCode,
  message: string,
  documentId: string | null,
  range?: Range,
): Problem {
  return problem("blocking", code, message, documentId, range)
}

export function warning(
  code: ProblemCode,
  message: string,
  documentId: string | null,
  range?: Range,
): Problem {
  return problem("warning", code, message, documentId, range)
}

function problem(
  severity: Severity,
  code: ProblemCode,
  message: string,
  documentId: string | null,
  range?: Range,
): Problem {
  return range
    ? { code, severity, message, documentId, range }
    : { code, severity, message, documentId }
}
