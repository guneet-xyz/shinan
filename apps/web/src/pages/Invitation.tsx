import { useState } from "react"
import { Link, useLocation } from "react-router"

import type { AcceptedInvitation } from "@shinan/api-client"

import { Button, buttonVariants } from "@/components/ui/button"

import { isApiError, signInPath, useApi, useResource } from "../api"
import { AuthPage } from "../components/AuthPage"
import { Actions, Facts } from "../components/page"
import { ErrorMessage, Loading, Notice } from "../components/status"
import { formatDate, roleNames } from "../format"

/**
 * The invitation acceptance page (identity §5.2; human experience, Joining
 * a workspace). The emailed link carries its token in the fragment. Before
 * sign-in the page shows only the installation's name; the invitation is
 * shown only to the person signed in with the invited address.
 */
export function InvitationPage() {
  const api = useApi()
  const location = useLocation()
  const token = useInvitationToken(location.hash.slice(1))
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
        This invitation link is incomplete. Open it again from the email.
      </p>
    )
  } else if (account.loading) {
    content = <Loading />
  } else if (isApiError(account.error, "sign-in-required")) {
    content = (
      <>
        <p className="text-sm text-muted-foreground">
          You have an invitation to a workspace on {name}. Sign in with the
          email address it was sent to, to see it.
        </p>
        <Link className={buttonVariants()} to={signInPath(location.pathname)}>
          Sign in
        </Link>
      </>
    )
  } else if (account.error) {
    content = <ErrorMessage error={account.error} />
  } else {
    content = (
      <Invitation
        token={token}
        githubAvailable={
          account.data!.signInMethods.githubAvailable &&
          account.data!.signInMethods.github === null
        }
      />
    )
  }

  return <AuthPage title={`Invitation to ${name}`}>{content}</AuthPage>
}

/**
 * The link's token, kept in this browser while the person signs in, so it
 * never goes into an address sent to the server (the sign-in link's return
 * path is in its query). A link opened on another device still works from
 * Your account, which lists invitations to the person's address.
 */
const tokenKey = "shinan.invitation"

function useInvitationToken(fromLink: string): string {
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

function forgetInvitationToken(): void {
  try {
    localStorage.removeItem(tokenKey)
  } catch {
    // Nothing kept.
  }
}

function Invitation(props: { token: string; githubAvailable: boolean }) {
  const api = useApi()
  const invitation = useResource(`invitation:${props.token}`, () =>
    api.findInvitation(props.token),
  )
  const [joined, setJoined] = useState<AcceptedInvitation>()
  const [declined, setDeclined] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>()

  const answer = (accept: boolean) => {
    forgetInvitationToken()
    setPending(true)
    setError(undefined)
    const request = accept
      ? api.acceptInvitation(props.token).then(setJoined)
      : api.declineInvitation(props.token).then(() => setDeclined(true))
    request.then(
      () => setPending(false),
      (failure: unknown) => {
        setPending(false)
        setError(failure)
      },
    )
  }

  if (invitation.loading) return <Loading />
  if (isApiError(invitation.error, "not-found")) {
    forgetInvitationToken()
    return (
      <p className="text-sm text-muted-foreground">
        This invitation cannot be opened with your account. It may have expired,
        been used or withdrawn, or have been sent to another email address. Ask
        the workspace owner to send it again if you need it.
      </p>
    )
  }
  if (invitation.error) return <ErrorMessage error={invitation.error} />
  const details = invitation.data!

  if (joined) {
    return (
      <section aria-live="polite" className="flex flex-col gap-3">
        <h2 className="font-medium">You joined {details.workspaceName}</h2>
        {props.githubAvailable && (
          <p className="text-sm text-muted-foreground">
            Link your GitHub account, so Shinan can show what you and your
            agents did on GitHub. You can do it now or later from{" "}
            <Link
              to="/account"
              className="text-foreground underline underline-offset-4"
            >
              Your account
            </Link>
            .
          </p>
        )}
        <Link className={buttonVariants()} to={`/w/${joined.workspaceId}`}>
          Go to {details.workspaceName}
        </Link>
      </section>
    )
  }
  if (declined) {
    return <Notice>You declined the invitation.</Notice>
  }

  return (
    <section
      aria-labelledby="invitation-heading"
      className="flex flex-col gap-4"
    >
      <h2 id="invitation-heading" className="font-medium">
        Join {details.workspaceName}
      </h2>
      <Facts>
        <dt>Invited by</dt>
        <dd>{details.invitedByHandle}</dd>
        <dt>Role</dt>
        <dd>{roleNames[details.role]}</dd>
        <dt>Expires</dt>
        <dd>{formatDate(details.expiresAt)}</dd>
      </Facts>
      <p className="text-sm text-muted-foreground">
        Every member of a workspace can read and change everything in it,
        including infrastructure details and work from private repositories.
      </p>
      <Actions>
        <Button type="button" disabled={pending} onClick={() => answer(true)}>
          Accept
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => answer(false)}
        >
          Decline
        </Button>
      </Actions>
      {error !== undefined && <ErrorMessage error={error} />}
    </section>
  )
}
