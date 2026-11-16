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
