import { useEffect, useState } from "react"
import { useLocation } from "react-router"

import { useApi, useResource } from "../api"
import { safeNextPath } from "../format"
import { errorMessage } from "../messages"
import { leaveApp } from "../navigation"

/**
 * Where an emailed sign-in link leads. The link's token is in the fragment,
 * which browsers never send to a server, and it is used only when the person
 * clicks: a mail scanner that fetches the link uses nothing up, and the
 * token reaches no server log (architecture §10.3).
 */
export function SignInLink() {
  const api = useApi()
  const location = useLocation()
  const [link] = useState(() => {
    const params = new URLSearchParams(location.hash.slice(1))
    return {
      token: params.get("token") ?? "",
      next: safeNextPath(params.get("next")),
    }
  })
  const installation = useResource("installation", () => api.installation(), {
    redirectToSignIn: false,
  })
  const name = installation.data?.name ?? "Shinan"
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>()

  // The token stays in this page only; it leaves the address bar and history.
  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname)
    }
  }, [])

  const continueSigningIn = () => {
    setPending(true)
    setError(undefined)
    api.openSignInLink(link).then(
      ({ location: next }) => leaveApp(next),
      (failure: unknown) => {
        setPending(false)
        setError(failure)
      },
    )
  }

  return (
    <main id="content" className="page narrow sign-in">
      <h1>Sign in to {name}</h1>
      {link.token ? (
        <>
          <p>This link signs you in once, in this browser.</p>
          <button type="button" disabled={pending} onClick={continueSigningIn}>
            Continue signing in
          </button>
        </>
      ) : (
        <p>
          This sign-in link is incomplete. Open it again from the email, or ask
          for a new one.
        </p>
      )}
      {error !== undefined && (
        <p className="error" role="alert">
          {errorMessage(error)}
        </p>
      )}
    </main>
  )
}
