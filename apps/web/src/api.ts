import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
} from "react"
import { useLocation, useNavigate } from "react-router"

import { ApiError } from "@shinan/api-client"
import type { ApiClient } from "@shinan/api-client"

/** The API client the app uses; tests provide a fake one. */
export const ApiContext = createContext<ApiClient | null>(null)

export function useApi(): ApiClient {
  const client = useContext(ApiContext)
  if (!client) throw new Error("useApi needs an ApiContext")
  return client
}

export function isApiError(error: unknown, code?: string): error is ApiError {
  return (
    error instanceof ApiError && (code === undefined || error.code === code)
  )
}

/**
 * Where to send someone whose sign-in has ended: the sign-in page, which
 * brings them back here afterwards.
 */
export function signInPath(next: string): string {
  return `/sign-in?${new URLSearchParams({ next }).toString()}`
}

/** Sends the person to sign in when a request says nobody is signed in. */
export function useSignInRedirect(error: unknown): void {
  const navigate = useNavigate()
  const location = useLocation()
  const signedOut = isApiError(error, "sign-in-required")
  useEffect(() => {
    if (signedOut) {
      void navigate(signInPath(location.pathname + location.search), {
        replace: true,
      })
    }
  }, [signedOut, navigate, location.pathname, location.search])
}

export interface Resource<T> {
  data: T | undefined
  error: unknown
  loading: boolean
  /** Loads again, keeping the current data on screen meanwhile. */
  reload: () => void
}

interface ResourceState<T> {
  key: string
  version: number
  data?: T
  error?: unknown
}

/**
 * Loads data for a screen. `key` names what is loaded: when it changes, the
 * data is loaded again from scratch. If the answer is that nobody is signed
 * in, the person is sent to sign in, unless `redirectToSignIn` is false.
 */
export function useResource<T>(
  key: string,
  load: () => Promise<T>,
  options: { redirectToSignIn?: boolean } = {},
): Resource<T> {
  const [version, setVersion] = useState(0)
  const [state, setState] = useState<ResourceState<T>>({
    key: "",
    version: -1,
  })
  const run = useEffectEvent(load)

  useEffect(() => {
    let active = true
    run().then(
      (data) => active && setState({ key, version, data }),
      (error: unknown) => active && setState({ key, version, error }),
    )
    return () => {
      active = false
    }
  }, [key, version])

  const sameKey = state.key === key
  const current = sameKey && state.version === version
  useSignInRedirect(
    current && options.redirectToSignIn !== false ? state.error : undefined,
  )
  return {
    data: sameKey ? state.data : undefined,
    error: current ? state.error : undefined,
    loading: !current,
    reload: () => setVersion((v) => v + 1),
  }
}
