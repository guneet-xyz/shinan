import { useState } from "react"
import type { FormEvent } from "react"
import { Link, useSearchParams } from "react-router"

import { Button, buttonVariants } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import { useApi, useResource } from "../api"
import { AuthPage } from "../components/AuthPage"
import { ErrorAlert } from "../components/status"
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
    <AuthPage title="Finish signing in with GitHub">
      {pending.loading ? null : pending.error || !pending.data ? (
        <>
          <p className="text-sm text-muted-foreground">
            This GitHub sign-in has expired or was finished in another browser.
          </p>
          <Link to={startAgain} className={buttonVariants()}>
            Start again
          </Link>
        </>
      ) : sentTo ? (
        <section aria-live="polite" className="flex flex-col gap-3">
          <h2 className="font-medium">Check your email</h2>
          <p className="text-sm text-muted-foreground">
            If <strong className="text-foreground">{sentTo}</strong> can have an
            account here, we sent it a sign-in link. Open it in this browser to
            sign in and link your GitHub account.
          </p>
        </section>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            The GitHub account
            {pending.data.login ? (
              <strong className="text-foreground">
                {" "}
                @{pending.data.login}
              </strong>
            ) : (
              ""
            )}{" "}
            is not linked to an account here yet. Enter your email address: we
            will email you a link, and opening it in this browser signs you in
            and links GitHub as a way to sign in.
          </p>
          <form onSubmit={send}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="github-email">Email address</FieldLabel>
                <Input
                  id="github-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </Field>
              <Button type="submit" disabled={sending}>
                Email me a sign-in link
              </Button>
            </FieldGroup>
          </form>
          {error !== undefined && (
            <ErrorAlert>{signInErrorMessage(error)}</ErrorAlert>
          )}
        </>
      )}
    </AuthPage>
  )
}
