import { useState } from "react"
import { Link, useLocation, useNavigate } from "react-router"

import { useAccount } from "../account"
import { useApi } from "../api"
import { formatDate, roleNames } from "../format"
import { signInErrorMessage } from "../messages"

/**
 * Your account (human experience, Your account): separate from any
 * workspace. Sign-in methods, sign-in sessions and pending invitations join
 * it with sign-in (M1-4); linked git host accounts, your agents and
 * notification settings come later.
 */
export function Account() {
  const { account } = useAccount()
  const location = useLocation()
  const notice = (location.state as { notice?: string } | null)?.notice
  const { person } = account

  return (
    <>
      <h1>Your account</h1>
      {notice && <p role="status">{notice}</p>}
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
      <SignOut />
    </>
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
