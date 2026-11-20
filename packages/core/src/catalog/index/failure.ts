import { GitServiceError } from "../git/client.js"

/**
 * Why the index could not be built or checked, as a fixed code: logged with
 * the workspace ID and kept on the index state for installation health,
 * never with text from the catalog (architecture §5.3, §13).
 *
 * - `tree-too-large`, `tree-too-deep`: the Git container refuses to list
 *   `main`'s tree (`422`);
 * - `folder-too-large`: one folder holds more entries than one listing,
 *   even one level down;
 * - `git-busy`: the Git container stayed busy (`503`) through every wait;
 * - `git-unavailable`: it did not answer, or failed (`5xx`);
 * - `deferred-none`: a read returned no document at all;
 * - `failed`: anything else.
 */
export const indexFailureReasons = [
  "tree-too-large",
  "tree-too-deep",
  "folder-too-large",
  "git-busy",
  "git-unavailable",
  "deferred-none",
  "failed",
] as const
export type IndexFailureReason = (typeof indexFailureReasons)[number]

/** A read of `main` the index cannot work with, with its reason. */
export class IndexReadError extends Error {
  override name = "IndexReadError"
  constructor(
    readonly reason: IndexFailureReason,
    message: string,
  ) {
    super(message)
  }
}

/** The fixed reason for an error the index met. */
export function indexFailureReason(error: unknown): IndexFailureReason {
  if (error instanceof IndexReadError) return error.reason
  if (error instanceof GitServiceError) {
    if (
      error.status === 422 &&
      (error.code === "tree-too-large" || error.code === "tree-too-deep")
    )
      return error.code
    if (error.status === 503) return "git-busy"
    if (error.status === 0 || error.status >= 500) return "git-unavailable"
  }
  return "failed"
}
