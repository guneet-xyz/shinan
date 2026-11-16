import { useState } from "react"
import type { FormEvent } from "react"
import { useLocation } from "react-router"

import { isApiError, useApi } from "../api"
import { errorMessage } from "../messages"

/**
 * The first start (architecture §12): the one-time setup link printed to the
 * server's log opens this page. Its token is in the address's fragment,
 * which never reaches a server log. The person chooses one of the operator
 * addresses in the installation's configuration, and a sign-in link is sent
 * there; opening it creates the first operator account.
 */
export function Setup() {
  const api = useApi()
  const location = useLocation()
  const token = location.hash.slice(1)
  const [email, setEmail] = useState("")
  const [sentTo, setSentTo] = useState<string>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>()

  const send = (event: FormEvent) => {
    event.preventDefault()
    setPending(true)
    setError(undefined)
    const address = email.trim()
    api.startSetup({ token, email: address }).then(
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

  return (
    <main id="content" className="page narrow sign-in">
      <h1>Set up this installation</h1>
      {!token ? (
        <p>
          Open the setup link from the server&apos;s log. It is printed when the
          server starts and no operator account exists yet.
        </p>
      ) : sentTo ? (
        <section aria-live="polite">
          <h2>Check your email</h2>
          <p>
            We sent a sign-in link to <strong>{sentTo}</strong>. Opening it
            creates the first operator account and ends this setup link.
          </p>
        </section>
      ) : (
        <>
          <p>
            Enter one of the operator email addresses in this
            installation&apos;s configuration. We will email it a sign-in link
            to create the first operator account.
          </p>
          <form onSubmit={send} className="stack">
            <label htmlFor="setup-email">Operator email address</label>
            <input
              id="setup-email"
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
          {error !== undefined && (
            <p className="error" role="alert">
              {isApiError(error, "not-found")
                ? "This setup link has expired or was already used. Restart the server for a new one."
                : errorMessage(error)}
            </p>
          )}
        </>
      )}
    </main>
  )
}
