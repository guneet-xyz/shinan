import { useEffect, useState } from "react"
import type { FormEvent } from "react"
import { useNavigate, useSearchParams } from "react-router"

import { useApi, useResource } from "../api"
import { safeNextPath } from "../format"
import { signInErrorMessage } from "../messages"
import { leaveApp } from "../navigation"

/**
 * Sign-in by email magic link or GitHub (identity §3.1). The answer after
 * asking for a link is the same whether or not the address can have an
 * account, so the page reveals nothing about the allowlist (identity §10).
 */
export function SignIn() {
  const api = useApi()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNextPath(params.get("next"))
  const failed = params.has("error")

  const installation = useResource("installation", () => api.installation(), {
    redirectToSignIn: false,
  })
  const name = installation.data?.name ?? "Shinan"
  const github = installation.data?.signInMethods.github ?? false

  // Someone already signed in (for example back from GitHub) goes on.
  const account = useResource("account", () => api.account(), {
    redirectToSignIn: false,
  })
  const signedIn = account.data !== undefined
  useEffect(() => {
    if (signedIn) void navigate(next, { replace: true })
  }, [signedIn, navigate, next])

  const [email, setEmail] = useState("")
  const [sentTo, setSentTo] = useState<string>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>()

  const sendLink = (event: FormEvent) => {
    event.preventDefault()
    setPending(true)
    setError(undefined)
    const address = email.trim()
    api.requestSignInLink({ email: address, callbackURL: next }).then(
      () => {
        setPending(false)
        setSentTo(address)
      },
      (failure: unknown) => {
        setPending(false)
        setError(failure)
      },
    )
  }

  const useGitHub = () => {
    setPending(true)
    setError(undefined)
    api.startGitHubSignIn({ callbackURL: next }).then(
      ({ url }) => leaveApp(url),
      (failure: unknown) => {
        setPending(false)
        setError(failure)
      },
    )
  }

  return (
    <main id="content" className="page narrow sign-in">
      <h1>Sign in to {name}</h1>
      {sentTo ? (
        <section aria-live="polite">
          <h2>Check your email</h2>
          <p>
            If <strong>{sentTo}</strong> can have an account here, we sent it a
            sign-in link. The link works once and expires soon.
          </p>
          <button
            type="button"
            className="quiet"
            onClick={() => setSentTo(undefined)}
          >
            Use a different address
          </button>
        </section>
      ) : (
        <>
          {failed && (
            <p className="error" role="alert">
              That sign-in did not work. The link may have expired or been used
              already, or this address cannot sign in here. Try again.
            </p>
          )}
          <form onSubmit={sendLink} className="stack">
            <label htmlFor="sign-in-email">Email address</label>
            <input
              id="sign-in-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <button type="submit" disabled={pending}>
              Email me a sign-in link
            </button>
          </form>
          {github && (
            <>
              <p className="divider">or</p>
              <button
                type="button"
                className="github"
                disabled={pending}
                onClick={useGitHub}
              >
                Sign in with GitHub
              </button>
            </>
          )}
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
