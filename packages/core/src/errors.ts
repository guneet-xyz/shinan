/** Base class for errors that operations raise on purpose. */
export class CoreError extends Error {
  override name = "CoreError"
}

/**
 * The thing does not exist, or the actor may not know that it exists. Both
 * get the same answer, so probing reveals nothing (identity §9.1, §10).
 */
export class NotFoundError extends CoreError {
  override name = "NotFoundError"
  constructor() {
    super("Not found")
  }
}

/**
 * Something the operation needs can't be reached right now, such as the
 * Git container: nothing was done, and the same request may work later.
 */
export class UnavailableError extends CoreError {
  override name = "UnavailableError"
}

/** The actor may see the workspace but not take this action. */
export class ForbiddenError extends CoreError {
  override name = "ForbiddenError"
  constructor(readonly reason: RefusalReason) {
    super(`Not allowed: ${reason}`)
  }
}

/** A sensitive action needs a recent sign-in (identity §3.3). */
export class ReauthenticationRequiredError extends CoreError {
  override name = "ReauthenticationRequiredError"
  constructor() {
    super("Re-authentication required")
  }
}

/** The input breaks a rule, such as removing the last workspace owner. */
export class RuleViolationError extends CoreError {
  override name = "RuleViolationError"
  constructor(
    readonly rule: string,
    message: string,
  ) {
    super(message)
  }
}

/**
 * The input itself is malformed, such as a blank name or an email address
 * without an `@`, whatever the state of the data. Other rule violations
 * conflict with the current state, such as removing the last owner.
 */
export class InvalidInputError extends RuleViolationError {
  override name = "InvalidInputError"
}

/**
 * Shinan is too busy to take the request now, or the actor sent too many:
 * nothing was done, and the same request may be sent again after
 * `retryAfterSeconds`. Agents pass this on as it is.
 */
export class BusyError extends CoreError {
  override name = "BusyError"
  constructor(
    readonly rule: string,
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super(message)
  }
}

/**
 * Why the permission check refused a request:
 * - `actor`: this kind of actor never takes this action;
 * - `not-member`: the actor is not a member of the workspace;
 * - `role`: the member's role does not allow it;
 * - `people-only`: the action is reserved for people (identity §6.3);
 * - `scope`: the agent's token scopes do not allow it;
 * - `reauthentication`: a sensitive action without a recent sign-in.
 */
export type RefusalReason =
  "actor" | "not-member" | "role" | "people-only" | "scope" | "reauthentication"
