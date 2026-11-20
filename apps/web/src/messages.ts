import { isApiError } from "./api"

/** Explains a failed request in words a person can act on. */
export function errorMessage(error: unknown): string {
  if (isApiError(error)) {
    switch (error.code) {
      case "forbidden":
        return "You are not allowed to do that."
      case "not-found":
        return "That no longer exists, or you do not have access to it."
      case "conflict":
      case "invalid-input":
        return error.message
      case "reauthentication-required":
        return "Sign in again to continue."
      case "sign-in-required":
        return "Your sign-in has ended. Sign in to continue."
      case "payload-too-large":
        return "That is too large to send."
      case "length-required":
        return "That could not be sent. Reload the page and try again."
      case "too-many-requests":
        return "Too many attempts. Wait a minute and try again."
      case "not-implemented":
        return "This is not available on this installation."
      case "unavailable":
        return "This isn't available right now. Try again in a minute."
    }
  }
  return "Something went wrong. Try again in a moment."
}

/** Explains why sign-in (or signing in again) could not start. */
export function signInErrorMessage(error: unknown): string {
  if (isApiError(error, "invalid-input")) return error.message
  if (isApiError(error) && [404, 501].includes(error.status)) {
    return "Sign-in is not available on this installation."
  }
  return "Could not start sign-in. Try again in a moment."
}
