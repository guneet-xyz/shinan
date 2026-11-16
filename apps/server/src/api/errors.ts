import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

import type { ErrorBody } from "@shinan/api-client"
import {
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  ReauthenticationRequiredError,
  RuleViolationError,
} from "@shinan/core"

/** Raised by handlers for requests whose shape is wrong. */
export class BadRequestError extends Error {
  override name = "BadRequestError"
}

export function errorResponse(
  c: Context,
  status: ContentfulStatusCode,
  body: ErrorBody,
) {
  return c.json(body, status)
}

/**
 * Translates the errors core raises on purpose into HTTP answers. Anything
 * else is logged and answered with a generic 500, so no internal detail
 * reaches the client (architecture §10.2).
 */
export function handleError(error: Error, c: Context) {
  if (error instanceof NotFoundError) {
    return errorResponse(c, 404, { error: "not-found", message: "Not found" })
  }
  if (error instanceof ReauthenticationRequiredError) {
    return errorResponse(c, 403, {
      error: "reauthentication-required",
      message: "Sign in again to continue",
    })
  }
  if (error instanceof ForbiddenError) {
    return errorResponse(c, 403, {
      error: "forbidden",
      message: "You are not allowed to do that",
      reason: error.reason,
    })
  }
  if (error instanceof InvalidInputError) {
    return errorResponse(c, 422, {
      error: "invalid-input",
      message: error.message,
      rule: error.rule,
    })
  }
  if (error instanceof RuleViolationError) {
    return errorResponse(c, 409, {
      error: "conflict",
      message: error.message,
      rule: error.rule,
    })
  }
  if (error instanceof BadRequestError) {
    return errorResponse(c, 422, {
      error: "invalid-input",
      message: error.message,
    })
  }
  // An error the sign-in layer (Better Auth) raised for a bad request, when
  // the API called it directly. Only its status is logged: its body can
  // echo the request.
  const status = signInErrorStatus(error)
  if (status !== undefined) {
    if (status >= 500) {
      console.error(`Sign-in layer error: ${status}`)
    } else if (status === 401) {
      return errorResponse(c, 401, {
        error: "sign-in-required",
        message: "Sign in to continue",
      })
    } else if (status === 403) {
      return errorResponse(c, 403, {
        error: "forbidden",
        message: "You are not allowed to do that",
      })
    } else {
      return errorResponse(c, 422, {
        error: "invalid-input",
        message: "The sign-in request was not accepted",
      })
    }
    return errorResponse(c, 500, {
      error: "internal",
      message: "Something went wrong",
    })
  }
  console.error(error)
  return errorResponse(c, 500, {
    error: "internal",
    message: "Something went wrong",
  })
}

/** The HTTP status of Better Auth's `APIError` (from better-call), if it is one. */
function signInErrorStatus(error: Error): number | undefined {
  const { statusCode } = error as { statusCode?: unknown }
  return error.name === "APIError" &&
    typeof statusCode === "number" &&
    statusCode >= 400
    ? statusCode
    : undefined
}
