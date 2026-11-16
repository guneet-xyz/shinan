import { useState } from "react"
import type { FormEvent } from "react"
import { Link, useSearchParams } from "react-router"

import { useApi, useResource } from "../api"
import { safeNextPath } from "../format"
import { signInErrorMessage } from "../messages"

/**
 * The second step of signing in with a GitHub account that is not linked
 * yet (identity §3.2): the person confirms their email address with a magic
 * link. Opening it in this browser signs them in, creating the account if
 * the address is allowlisted, and links the GitHub account.
 */
export function GitHubEmail() {
  const api = useApi()
  const [params] = useSearchParams()
  const next = safeNextPath(params.get("next"))
  const pending = useResource(
    "pending-github",
    () => api.pendingGitHubSignIn(),
    { redirectToSignIn: false },
  )
  const [email, setEmail] = useState("")
  const [sentTo, setSentTo] = useState<string>()
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<unknown>()

  const send = (event: FormEvent) => {
    event.preventDefault()
    setSending(true)
    setError(undefined)
    const address = email.trim()
    api
      .requestSignInLink({
        email: address,
        callbackURL: next,
        metadata: { github: true },
      })
      .then(
        () => {
          setSending(false)
          setSentTo(address)
        },
        (failure: unknown) => {
          setSending(false)
          setError(failure)
        },
      )
  }

  const startAgain = `/sign-in${next === "/" ? "" : `?next=${encodeURIComponent(next)}`}`

  return (
    <main id="content" className="page narrow sign-in">
      <h1>Finish signing in with GitHub</h1>
      {pending.loading ? null : pending.error || !pending.data ? (
        <>
          <p>
            This GitHub sign-in has expired or was finished in another browser.
          </p>
          <Link to={startAgain}>Start again</Link>
        </>
      ) : sentTo ? (
        <section aria-live="polite">
          <h2>Check your email</h2>
          <p>
            If <strong>{sentTo}</strong> can have an account here, we sent it a
            sign-in link. Open it in this browser to sign in and link your
            GitHub account.
          </p>
        </section>
      ) : (
        <>
          <p>
            The GitHub account
            {pending.data.login ? (
              <strong> @{pending.data.login}</strong>
            ) : (
              ""
            )}{" "}
            is not linked to an account here yet. Enter your email address: we
            will email you a link, and opening it in this browser signs you in
            and links GitHub as a way to sign in.
          </p>
          <form onSubmit={send} className="stack">
            <label htmlFor="github-email">Email address</label>
            <input
              id="github-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <button type="submit" disabled={sending}>
              Email me a sign-in link
            </button>
          </form>
          {error !== undefined && (
            <p className="error" role="alert">
              {signInErrorMessage(error)}
            </p>
          )}
        </>
      )}
    </main>
  )
}
