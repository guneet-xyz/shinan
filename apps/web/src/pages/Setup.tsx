import { useState } from "react"
import type { FormEvent } from "react"
import { useLocation } from "react-router"

import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import { isApiError, useApi } from "../api"
import { AuthPage } from "../components/AuthPage"
import { ErrorAlert } from "../components/status"
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
    <AuthPage title="Set up this installation">
      {!token ? (
        <p className="text-sm text-muted-foreground">
          Open the setup link from the server&apos;s log. It is printed when the
          server starts and no operator account exists yet.
        </p>
      ) : sentTo ? (
        <section aria-live="polite" className="flex flex-col gap-3">
          <h2 className="font-medium">Check your email</h2>
          <p className="text-sm text-muted-foreground">
            We sent a sign-in link to{" "}
            <strong className="text-foreground">{sentTo}</strong>. Opening it
            creates the first operator account and ends this setup link.
          </p>
        </section>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Enter one of the operator email addresses in this
            installation&apos;s configuration. We will email it a sign-in link
            to create the first operator account.
          </p>
          <form onSubmit={send}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="setup-email">
                  Operator email address
                </FieldLabel>
                <Input
                  id="setup-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </Field>
              <Button type="submit" disabled={pending}>
                Email me a sign-in link
              </Button>
            </FieldGroup>
          </form>
          {error !== undefined && (
            <ErrorAlert>
              {isApiError(error, "not-found")
                ? "This setup link has expired or was already used. Restart the server for a new one."
                : errorMessage(error)}
            </ErrorAlert>
          )}
        </>
      )}
    </AuthPage>
  )
}
