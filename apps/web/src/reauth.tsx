import { useCallback, useRef, useState } from "react"
import type { ReactNode } from "react"
import { useLocation } from "react-router"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { ReauthContext } from "./action"
import { useApi } from "./api"
import { ErrorAlert } from "./components/status"
import { signInErrorMessage } from "./messages"
import { leaveApp } from "./navigation"

/**
 * Asks the person to sign in again when a sensitive action needs a recent
 * sign-in (identity §3.3). Core decides which actions do; the screen only
 * reacts to the server's answer.
 */
export function ReauthProvider(props: { email: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  const ask = useCallback((from: HTMLElement | null) => {
    returnFocus.current = from
    setOpen(true)
  }, [])

  return (
    <ReauthContext value={ask}>
      {props.children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          finalFocus={() =>
            returnFocus.current?.isConnected ? returnFocus.current : true
          }
        >
          <ReauthDialog email={props.email} />
        </DialogContent>
      </Dialog>
    </ReauthContext>
  )
}

/** The dialog's content; it starts afresh each time the dialog opens. */
function ReauthDialog(props: { email: string }) {
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
    <>
      <DialogHeader>
        <DialogTitle>Sign in again to continue</DialogTitle>
        <DialogDescription>
          {sent ? (
            <>
              We sent a sign-in link to{" "}
              <strong className="text-foreground">{props.email}</strong>. Open
              it, then try again.
            </>
          ) : (
            "For your safety, this action needs a recent sign-in. Sign in again, then try the action once more."
          )}
        </DialogDescription>
      </DialogHeader>
      {!sent && (
        <div className="flex flex-col gap-2">
          <Button type="button" onClick={sendLink}>
            Email me a sign-in link
          </Button>
          <Button type="button" variant="outline" onClick={useGitHub}>
            Sign in with GitHub
          </Button>
        </div>
      )}
      {error !== undefined && (
        <ErrorAlert>{signInErrorMessage(error)}</ErrorAlert>
      )}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="ghost" />}>
          {sent ? "Close" : "Cancel"}
        </DialogClose>
      </DialogFooter>
    </>
  )
}
