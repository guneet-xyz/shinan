import { useCallback, useState } from "react"
import type { ReactNode } from "react"
import { useLocation } from "react-router"

import { ReauthContext } from "./action"
import { useApi } from "./api"
import { Dialog } from "./components/Dialog"
import { signInErrorMessage } from "./messages"
import { leaveApp } from "./navigation"

/**
 * Asks the person to sign in again when a sensitive action needs a recent
 * sign-in (identity §3.3). Core decides which actions do; the screen only
 * reacts to the server's answer.
 */
export function ReauthProvider(props: { email: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ask = useCallback(() => setOpen(true), [])
  const close = useCallback(() => setOpen(false), [])

  return (
    <ReauthContext value={ask}>
      {props.children}
      {open && <ReauthDialog email={props.email} onClose={close} />}
    </ReauthContext>
  )
}

function ReauthDialog(props: { email: string; onClose: () => void }) {
  const api = useApi()
  const location = useLocation()
  const callbackURL = location.pathname + location.search
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<unknown>()

  const sendLink = () => {
    setError(undefined)
    api
      .requestSignInLink({ email: props.email, callbackURL })
      .then(() => setSent(true), setError)
  }
  const useGitHub = () => {
    setError(undefined)
    api
      .startGitHubSignIn({ callbackURL })
      .then(({ url }) => leaveApp(url), setError)
  }

  return (
    <Dialog title="Sign in again to continue" onClose={props.onClose}>
      {sent ? (
        <p>
          We sent a sign-in link to <strong>{props.email}</strong>. Open it,
          then try again.
        </p>
      ) : (
        <>
          <p>
            For your safety, this action needs a recent sign-in. Sign in again,
            then try the action once more.
          </p>
          <div className="actions">
            <button type="button" onClick={sendLink}>
              Email me a sign-in link
            </button>
            <button type="button" onClick={useGitHub}>
              Sign in with GitHub
            </button>
          </div>
        </>
      )}
      {error !== undefined && (
        <p className="error" role="alert">
          {signInErrorMessage(error)}
        </p>
      )}
      <div className="actions">
        <button type="button" className="quiet" onClick={props.onClose}>
          {sent ? "Close" : "Cancel"}
        </button>
      </div>
    </Dialog>
  )
}
