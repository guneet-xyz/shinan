import type { Range } from "./source.js"

/**
 * Whether a problem stops a catalog proposal from applying (`blocking`) or
 * holds it for catalog approval with the reason shown (`warning`), as catalog
 * §8.3 sets out.
 */
export type Severity = "blocking" | "warning"

/** What a problem is about. Codes are stable: tests, the API and the screens use them. */
export type ProblemCode =
  /** The document is longer than Shinan reads (catalog §2.1). */
  | "too-large"
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
  return range
    ? { code, severity: "blocking", message, documentId, range }
    : { code, severity: "blocking", message, documentId }
}
