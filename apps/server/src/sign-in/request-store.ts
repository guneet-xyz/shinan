import { AsyncLocalStorage } from "node:async_hooks"

import type { RequestInfo } from "@shinan/core"

/**
 * What the sign-in layer learns while serving one request, for Better Auth's
 * callbacks and hooks, which have no other way to share it.
 */
export interface RequestStore {
  request: RequestInfo
  /** The GitHub account that just authorized, read once from GitHub. */
  github?: { accountId: string; login: string | undefined }
  /** Whether opening a magic link created the account. */
  accountCreated?: boolean
}

const storage = new AsyncLocalStorage<RequestStore>()

export function withRequestStore<T>(
  store: RequestStore,
  run: () => Promise<T>,
): Promise<T> {
  return storage.run(store, run)
}

export function requestStore(): RequestStore {
  const store = storage.getStore()
  if (!store) throw new Error("No sign-in request is being served")
  return store
}
