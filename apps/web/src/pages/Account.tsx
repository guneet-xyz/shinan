import { useState } from "react"
import { Link, useLocation, useNavigate, useSearchParams } from "react-router"

import type { InvitationForYou, SignInSession } from "@shinan/api-client"

import { useAccount } from "../account"
import { useAction } from "../action"
import { useApi, useResource } from "../api"
import { ErrorMessage, Loading } from "../components/status"
import { formatDate, formatTime, roleNames } from "../format"
import { signInErrorMessage } from "../messages"
import { leaveApp } from "../navigation"

/**
 * Your account (human experience, Your account): separate from any
 * workspace. Profile, workspaces, pending invitations, sign-in methods and
 * sign-in sessions; linked Forgejo accounts, your agents and notification
 * settings come later.
 */
export function Account() {
  const { account } = useAccount()
  const location = useLocation()
  const [params] = useSearchParams()
  const notice = (location.state as { notice?: string } | null)?.notice
  const { person } = account

  return (
    <>
      <h1>Your account</h1>
      {notice && <p role="status">{notice}</p>}
      {params.has("error") && (
        <p className="error" role="alert">
          GitHub could not be added. That GitHub account may already be a way to
          sign in to another account here.
        </p>
      )}
      <section aria-labelledby="profile-heading">
        <h2 id="profile-heading">Profile</h2>
        <dl className="facts">
          <dt>Name</dt>
          <dd>{person.name}</dd>
          <dt>Handle</dt>
          <dd>{person.handle}</dd>
          <dt>Email address</dt>
          <dd>{person.email}</dd>
          <dt>Account created</dt>
          <dd>{formatDate(person.createdAt)}</dd>
        </dl>
      </section>
      <section aria-labelledby="workspaces-heading">
        <h2 id="workspaces-heading">Workspaces</h2>
        {account.workspaces.length === 0 ? (
          <p className="muted">You are not a member of any workspace.</p>
        ) : (
          <ul className="cards">
            {account.workspaces.map((workspace) => (
              <li key={workspace.id} className="card">
                <Link to={`/w/${workspace.id}`}>{workspace.name}</Link>
                <dl className="facts compact">
                  <dt>Role</dt>
                  <dd>{roleNames[workspace.role]}</dd>
                  <dt>Joined</dt>
                  <dd>{formatDate(workspace.joinedAt)}</dd>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>
      <PendingInvitations />
      <SignInMethods />
      <SignInSessions />
      <SignOut />
      {account.operator && (
        <p>
          You are an installation operator:{" "}
          <Link to="/installation">installation settings</Link>.
        </p>
      )}
    </>
  )
}

/** Invitations to the person's own address (identity §5.2). */
function PendingInvitations() {
  const api = useApi()
  const { reload } = useAccount()
  const invitations = useResource("invitations-for-you", () =>
    api.invitationsForYou(),
  )
  if (invitations.data?.length === 0) return null

  return (
    <section aria-labelledby="pending-invitations-heading">
      <h2 id="pending-invitations-heading">Pending invitations</h2>
      {invitations.data ? (
        <ul className="cards">
          {invitations.data.map((invitation) => (
            <PendingInvitation
              key={invitation.id}
              invitation={invitation}
              onAnswered={() => {
                invitations.reload()
                reload()
              }}
            />
          ))}
        </ul>
      ) : invitations.error ? (
        <ErrorMessage error={invitations.error} />
      ) : (
        <Loading />
      )}
    </section>
  )
}

function PendingInvitation(props: {
  invitation: InvitationForYou
  onAnswered: () => void
}) {
  const api = useApi()
  const { invitation } = props
  const action = useAction()

  return (
    <li className="card">
      <strong>{invitation.workspaceName}</strong>
      <dl className="facts compact">
        <dt>Invited by</dt>
        <dd>{invitation.invitedByHandle}</dd>
        <dt>Role</dt>
        <dd>{roleNames[invitation.role]}</dd>
        <dt>Expires</dt>
        <dd>{formatDate(invitation.expiresAt)}</dd>
      </dl>
      <div className="actions">
        <button
          type="button"
          disabled={action.pending}
          onClick={() =>
            action.run(
              () => api.acceptInvitationById(invitation.id),
              props.onAnswered,
            )
          }
        >
          Accept
        </button>
        <button
          type="button"
          className="quiet"
          disabled={action.pending}
          onClick={() =>
            action.run(
              () => api.declineInvitationById(invitation.id),
              props.onAnswered,
            )
          }
        >
          Decline
        </button>
      </div>
      {action.error !== undefined && <ErrorMessage error={action.error} />}
    </li>
  )
}

/**
 * Sign-in methods (identity §3.1): an email magic link to the account's
 * address, and GitHub if linked. Adding or removing GitHub needs a recent
 * sign-in and is emailed to the person.
 */
function SignInMethods() {
  const api = useApi()
  const { account, reload } = useAccount()
  const { email, github, githubAvailable } = account.signInMethods
  const add = useAction()
  const remove = useAction()

  const addGitHub = () =>
    add.run(async () => {
      const { url } = await api.addGitHub({ callbackURL: "/account" })
      leaveApp(url)
    })

  return (
    <section aria-labelledby="sign-in-methods-heading">
      <h2 id="sign-in-methods-heading">Sign-in methods</h2>
      <dl className="facts">
        <dt>Email link</dt>
        <dd>{email}</dd>
        <dt>GitHub</dt>
        <dd>
          {github
            ? `@${github.login ?? github.accountId}, added ${formatDate(github.addedAt)}`
            : githubAvailable
              ? "Not linked"
              : "Not offered on this installation"}
        </dd>
      </dl>
      <div className="actions">
        {github ? (
          <button
            type="button"
            className="danger"
            disabled={remove.pending}
            onClick={() => remove.run(() => api.removeGitHub(), reload)}
          >
            Remove GitHub
          </button>
        ) : (
          githubAvailable && (
            <button type="button" disabled={add.pending} onClick={addGitHub}>
              Add GitHub
            </button>
          )
        )}
      </div>
      {add.error !== undefined && <ErrorMessage error={add.error} />}
      {remove.error !== undefined && <ErrorMessage error={remove.error} />}
    </section>
  )
}

/** The person's sign-in sessions, and "sign out everywhere" (§3.3). */
function SignInSessions() {
  const api = useApi()
  const navigate = useNavigate()
  const sessions = useResource("sign-in-sessions", () => api.signInSessions())
  const everywhere = useAction()

  return (
    <section aria-labelledby="sign-in-sessions-heading">
      <h2 id="sign-in-sessions-heading">Sign-in sessions</h2>
      {sessions.data ? (
        <ul className="cards">
          {sessions.data.map((session) => (
            <SignInSessionRow
              key={session.id}
              session={session}
              reload={sessions.reload}
            />
          ))}
        </ul>
      ) : sessions.error ? (
        <ErrorMessage error={sessions.error} />
      ) : (
        <Loading />
      )}
      <button
        type="button"
        className="danger"
        disabled={everywhere.pending}
        onClick={() =>
          everywhere.run(
            () => api.signOutEverywhere(),
            () => void navigate("/sign-in", { replace: true }),
          )
        }
      >
        Sign out everywhere
      </button>
      {everywhere.error !== undefined && (
        <ErrorMessage error={everywhere.error} />
      )}
    </section>
  )
}

function SignInSessionRow(props: {
  session: SignInSession
  reload: () => void
}) {
  const api = useApi()
  const { session } = props
  const end = useAction()

  return (
    <li className="card">
      <div>
        <strong title={session.client ?? undefined}>{session.browser}</strong>
        {session.current && <span className="badge"> This browser</span>}
      </div>
      <dl className="facts compact">
        <dt>Signed in</dt>
        <dd>{formatTime(session.createdAt)}</dd>
        <dt>Last active</dt>
        <dd>{formatTime(session.lastActiveAt)}</dd>
        {session.networkAddress && (
          <>
            <dt>Network address</dt>
            <dd>{session.networkAddress}</dd>
          </>
        )}
      </dl>
      {!session.current && (
        <div className="actions">
          <button
            type="button"
            className="danger"
            disabled={end.pending}
            onClick={() =>
              end.run(() => api.endSignInSession(session.id), props.reload)
            }
          >
            End this session
          </button>
        </div>
      )}
      {end.error !== undefined && <ErrorMessage error={end.error} />}
    </li>
  )
}

function SignOut() {
  const api = useApi()
  const navigate = useNavigate()
  const [error, setError] = useState<unknown>()
  const [pending, setPending] = useState(false)

  const signOut = () => {
    setPending(true)
    setError(undefined)
    api.signOut().then(
      () => void navigate("/sign-in", { replace: true }),
      (failure: unknown) => {
        setPending(false)
        setError(failure)
      },
    )
  }

  return (
    <section aria-labelledby="sign-out-heading">
      <h2 id="sign-out-heading">Sign out</h2>
      <button type="button" disabled={pending} onClick={signOut}>
        Sign out
      </button>
      {error !== undefined && (
        <p className="error" role="alert">
          {signInErrorMessage(error)}
        </p>
      )}
    </section>
  )
}
