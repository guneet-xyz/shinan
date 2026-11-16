import { createContext, useContext, useState } from "react"

import { needsReauthentication } from "@shinan/api-client"

import { useSignInRedirect } from "./api"

/** Opens the prompt to sign in again; provided by `ReauthProvider`. */
export const ReauthContext = createContext<(() => void) | null>(null)

export interface Action {
  /**
   * Runs a change. A request for re-authentication opens the sign-in prompt;
   * any other failure is kept in `error` for the screen to show.
   */
  run: (change: () => Promise<unknown>, onDone?: () => void) => void
  pending: boolean
  error: unknown
  clear: () => void
}

export function useAction(): Action {
  const askToSignIn = useContext(ReauthContext)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>()
  useSignInRedirect(error)

  const run = (change: () => Promise<unknown>, onDone?: () => void) => {
    setPending(true)
    setError(undefined)
    change().then(
      () => {
        setPending(false)
        onDone?.()
      },
      (failure: unknown) => {
        setPending(false)
        if (needsReauthentication(failure) && askToSignIn) askToSignIn()
        else setError(failure)
      },
    )
  }
  return { run, pending, error, clear: () => setError(undefined) }
}
