import { createContext, useContext } from "react"

import type { Account } from "@shinan/api-client"

export interface AccountState {
  account: Account
  /** Loads the account again, for example after leaving a workspace. */
  reload: () => void
}

export const AccountContext = createContext<AccountState | null>(null)

/** The signed-in person's account. Only inside `RequireSignIn`. */
export function useAccount(): AccountState {
  const state = useContext(AccountContext)
  if (!state) throw new Error("useAccount needs RequireSignIn")
  return state
}
