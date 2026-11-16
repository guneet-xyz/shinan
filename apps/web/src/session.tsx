import { Outlet } from "react-router"

import { AccountContext } from "./account"
import { useApi, useResource } from "./api"
import { ErrorMessage, Loading } from "./components/status"
import { ReauthProvider } from "./reauth"

/**
 * Layout for every page behind sign-in. Nothing but the sign-in pages is
 * shown without it (identity §10); someone not signed in is sent to sign in
 * and brought back afterwards.
 */
export function RequireSignIn() {
  const api = useApi()
  const account = useResource("account", () => api.account())

  if (account.data) {
    return (
      <AccountContext value={{ account: account.data, reload: account.reload }}>
        <ReauthProvider email={account.data.person.email}>
          <Outlet />
        </ReauthProvider>
      </AccountContext>
    )
  }
  if (account.error) {
    return (
      <main className="page">
        <ErrorMessage error={account.error} />
      </main>
    )
  }
  return (
    <main className="page">
      <Loading />
    </main>
  )
}
