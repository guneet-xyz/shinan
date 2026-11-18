import { useState } from "react"
import { Link, useLocation } from "react-router"

import { Button, buttonVariants } from "@/components/ui/button"

import { isApiError, signInPath, useApi, useResource } from "../api"
import { AuthPage } from "../components/AuthPage"
import { Actions } from "../components/page"
import { ErrorMessage, Loading } from "../components/status"
import { formatTime } from "../format"

/**
 * Where the link sent to a new email address lands (identity §3.4). The
 * token is in the fragment. Only the person who asked for the change,
 * signed in, can confirm it, with one click; anyone else sees that the link
 * does not work for them.
 */
export function EmailChangePage() {
  const api = useApi()
  const location = useLocation()
  const token = useEmailChangeToken(location.hash.slice(1))
  const installation = useResource("installation", () => api.installation(), {
    redirectToSignIn: false,
  })
  const account = useResource("account", () => api.account(), {
    redirectToSignIn: false,
  })
  const name = installation.data?.name ?? "Shinan"

  let content
  if (!token) {
    content = (
      <p className="text-sm text-muted-foreground">
        This link is incomplete. Open it again from the email.
      </p>
    )
  } else if (account.loading && !account.data) {
    content = <Loading />
  } else if (isApiError(account.error, "sign-in-required")) {
    content = (
      <>
        <p className="text-sm text-muted-foreground">
          To confirm a new email address, sign in to the account that asked for
          it, then come back to this link.
        </p>
        <Link className={buttonVariants()} to={signInPath(location.pathname)}>
          Sign in
        </Link>
      </>
    )
  } else if (account.error) {
    content = <ErrorMessage error={account.error} />
  } else {
    const { person, pendingEmailChange } = account.data!
    content = (
      <Confirm
        token={token}
        current={person.email}
        pending={pendingEmailChange}
        onDone={account.reload}
      />
    )
  }

  return (
    <AuthPage title={`Confirm your email address on ${name}`}>
      {content}
    </AuthPage>
  )
}

/**
 * The link's token, kept in this browser while the person signs in, so it
 * never goes into an address sent to the server.
 */
const tokenKey = "shinan.email-change"

function useEmailChangeToken(fromLink: string): string {
  if (fromLink) {
    try {
      localStorage.setItem(tokenKey, fromLink)
    } catch {
      // Storage may be unavailable; the link still works in this tab.
    }
    return fromLink
  }
  try {
    return localStorage.getItem(tokenKey) ?? ""
  } catch {
    return ""
  }
}

function forgetEmailChangeToken(): void {
  try {
    localStorage.removeItem(tokenKey)
  } catch {
    // Nothing kept.
  }
}

function Confirm(props: {
  token: string
  current: string
  pending: { email: string; expiresAt: string } | null
  onDone: () => void
}) {
  const api = useApi()
  const [done, setDone] = useState<string>()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<unknown>()

  const confirm = () => {
    setWorking(true)
    setError(undefined)
    api.confirmEmailChange(props.token).then(
      ({ email }) => {
        forgetEmailChangeToken()
        setWorking(false)
        setDone(email)
        props.onDone()
      },
      (failure: unknown) => {
        setWorking(false)
        if (isApiError(failure, "not-found")) forgetEmailChangeToken()
        setError(failure)
      },
    )
  }

  if (done) {
    return (
      <section aria-live="polite" className="flex flex-col gap-3">
        <h2 className="font-medium wrap-anywhere">
          Your email address is now {done}
        </h2>
        <p className="text-sm text-muted-foreground">
          Sign-in links now go to this address. Your other sign-in sessions have
          ended, and both addresses were told about the change.
        </p>
        <Link className={buttonVariants()} to="/account">
          Go to your account
        </Link>
      </section>
    )
  }

  if (!props.pending || isApiError(error, "not-found")) {
    return (
      <p className="text-sm text-muted-foreground">
        This link does not work for the account you are signed in to. It may
        have expired, been used or replaced by a newer one, or have been asked
        for by another account. You can ask for a new link from{" "}
        <Link
          to="/account"
          className="text-foreground underline underline-offset-4"
        >
          Your account
        </Link>
        .
      </p>
    )
  }

  return (
    <section
      aria-labelledby="email-change-heading"
      className="flex flex-col gap-4"
    >
      <h2 id="email-change-heading" className="font-medium wrap-anywhere">
        Use {props.pending.email}?
      </h2>
      <p className="text-sm wrap-anywhere text-muted-foreground">
        Your account's email address changes from {props.current} to{" "}
        {props.pending.email}. Sign-in links then go only to the new address,
        invitations still waiting for the old one are withdrawn, and your other
        sign-in sessions end. This link expires at{" "}
        {formatTime(props.pending.expiresAt)}.
      </p>
      <Actions>
        <Button type="button" disabled={working} onClick={confirm}>
          Confirm new address
        </Button>
        <Link to="/account" className={buttonVariants({ variant: "outline" })}>
          Not now
        </Link>
      </Actions>
      {error !== undefined && <ErrorMessage error={error} />}
    </section>
  )
}
