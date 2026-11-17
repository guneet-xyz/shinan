import { useEffect, useState } from "react"
import type { FormEvent } from "react"
import { useNavigate, useSearchParams } from "react-router"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import { useApi, useResource } from "../api"
import { AuthPage } from "../components/AuthPage"
import { ErrorAlert } from "../components/status"
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
    <AuthPage title={`Sign in to ${name}`}>
      {sentTo ? (
        <section aria-live="polite" className="flex flex-col gap-3">
          <h2 className="font-medium">Check your email</h2>
          <p className="text-sm text-muted-foreground">
            If <strong className="text-foreground">{sentTo}</strong> can have an
            account here, we sent it a sign-in link. The link works once and
            expires soon.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => setSentTo(undefined)}
          >
            Use a different address
          </Button>
        </section>
      ) : (
        <>
          {failed && (
            <ErrorAlert>
              That sign-in did not work. The link may have expired or been used
              already, or this address cannot sign in here. Try again.
            </ErrorAlert>
          )}
          <form onSubmit={sendLink}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="sign-in-email">Email address</FieldLabel>
                <Input
                  id="sign-in-email"
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
          {github && (
            <>
              <FieldSeparator>or</FieldSeparator>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={useGitHub}
              >
                Sign in with GitHub
              </Button>
            </>
          )}
          {error !== undefined && (
            <ErrorAlert>{signInErrorMessage(error)}</ErrorAlert>
          )}
        </>
      )}
    </AuthPage>
  )
}
