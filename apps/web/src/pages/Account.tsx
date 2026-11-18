import { useState } from "react"
import type { FormEvent } from "react"
import { Link, useLocation, useNavigate, useSearchParams } from "react-router"

import type { InvitationForYou, SignInSession } from "@shinan/api-client"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import { useAccount } from "../account"
import { useAction } from "../action"
import { useApi, useResource } from "../api"
import { CreateWorkspace } from "../components/CreateWorkspace"
import { Actions, Facts, PageHeader, Rows, Section } from "../components/page"
import { ErrorAlert, ErrorMessage, Loading } from "../components/status"
import { formatDate, formatTime, roleNames } from "../format"
import { signInErrorMessage } from "../messages"
import { leaveApp } from "../navigation"

/**
 * Your account (human experience, Your account): separate from any
 * workspace. Profile, workspaces, pending invitations, a link to your
 * agents, sign-in methods and sign-in sessions; linked Forgejo accounts and
 * notification settings come later.
 */
export function Account() {
  const { account } = useAccount()
  const location = useLocation()
  const [params] = useSearchParams()
  const notice = (location.state as { notice?: string } | null)?.notice
  const { person } = account

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Your account" />
      {notice && (
        <Alert role="status">
          <AlertDescription className="text-foreground">
            {notice}
          </AlertDescription>
        </Alert>
      )}
      {params.has("error") && (
        <ErrorAlert>
          GitHub could not be added. That GitHub account may already be a way to
          sign in to another account here.
        </ErrorAlert>
      )}
      <Section title="Profile">
        <Facts>
          <dt>Name</dt>
          <dd>{person.name}</dd>
          <dt>Handle</dt>
          <dd>{person.handle}</dd>
          <dt>Email address</dt>
          <dd>{person.email}</dd>
          <dt>Account created</dt>
          <dd>{formatDate(person.createdAt)}</dd>
        </Facts>
      </Section>
      <Section title="Workspaces">
        {account.workspaces.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You are not a member of any workspace.
          </p>
        ) : (
          <Rows>
            {account.workspaces.map((workspace) => (
              <li key={workspace.id}>
                <Link
                  to={`/w/${workspace.id}`}
                  className="w-fit font-medium underline-offset-4 hover:underline"
                >
                  {workspace.name}
                </Link>
                <Facts>
                  <dt>Role</dt>
                  <dd>{roleNames[workspace.role]}</dd>
                  <dt>Joined</dt>
                  <dd>{formatDate(workspace.joinedAt)}</dd>
                </Facts>
              </li>
            ))}
          </Rows>
        )}
        <CreateWorkspace />
      </Section>
      <PendingInvitations />
      <Section
        title="Your agents"
        description="Your coding tools on your machines, their tokens and when each was last used."
      >
        <Actions>
          <Link
            to="/account/agents"
            className={buttonVariants({ variant: "outline" })}
          >
            Your agents
          </Link>
        </Actions>
      </Section>
      <SignInMethods />
      <SignInSessions />
      <SignOut />
      {account.operator && (
        <p className="text-sm text-muted-foreground">
          You are an installation operator:{" "}
          <Link
            to="/installation"
            className="text-foreground underline underline-offset-4"
          >
            installation settings
          </Link>
          .
        </p>
      )}
    </div>
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
    <Section title="Pending invitations">
      {invitations.data ? (
        <Rows>
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
        </Rows>
      ) : invitations.error ? (
        <ErrorMessage error={invitations.error} />
      ) : (
        <Loading />
      )}
    </Section>
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
    <li>
      <strong className="font-medium">{invitation.workspaceName}</strong>
      <Facts>
        <dt>Invited by</dt>
        <dd>{invitation.invitedByHandle}</dd>
        <dt>Role</dt>
        <dd>{roleNames[invitation.role]}</dd>
        <dt>Expires</dt>
        <dd>{formatDate(invitation.expiresAt)}</dd>
      </Facts>
      <Actions>
        <Button
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
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={action.pending}
          onClick={() =>
            action.run(
              () => api.declineInvitationById(invitation.id),
              props.onAnswered,
            )
          }
        >
          Decline
        </Button>
      </Actions>
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
    <Section title="Sign-in methods">
      <Facts>
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
      </Facts>
      {(github || githubAvailable) && (
        <Actions>
          {github ? (
            <Button
              type="button"
              variant="destructive"
              disabled={remove.pending}
              onClick={() => remove.run(() => api.removeGitHub(), reload)}
            >
              Remove GitHub
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={add.pending}
              onClick={addGitHub}
            >
              Add GitHub
            </Button>
          )}
        </Actions>
      )}
      {add.error !== undefined && <ErrorMessage error={add.error} />}
      {remove.error !== undefined && <ErrorMessage error={remove.error} />}
      <ChangeEmail />
    </Section>
  )
}

/**
 * Changing the account's email address (identity §3.4): asked for with a
 * recent sign-in, then confirmed from a link sent to the new address, opened
 * while signed in here. A change waiting for its link can be cancelled.
 */
function ChangeEmail() {
  const api = useApi()
  const { account, reload } = useAccount()
  const pending = account.pendingEmailChange
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const ask = useAction()
  const cancel = useAction()

  if (pending) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border p-3 text-sm sm:p-4">
        <p role="status">
          Waiting for confirmation: we sent a link to{" "}
          <strong className="font-medium break-all">{pending.email}</strong>.
          Open it while signed in here before {formatTime(pending.expiresAt)}.
          Until then, your address stays {account.person.email}.
        </p>
        <Actions>
          <Button
            type="button"
            variant="outline"
            disabled={cancel.pending}
            onClick={() => cancel.run(() => api.cancelEmailChange(), reload)}
          >
            Cancel the change
          </Button>
        </Actions>
        {cancel.error !== undefined && <ErrorMessage error={cancel.error} />}
      </div>
    )
  }

  if (!open) {
    return (
      <Actions>
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          Change email address
        </Button>
      </Actions>
    )
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    ask.run(
      () => api.requestEmailChange(email),
      () => {
        setOpen(false)
        setEmail("")
        reload()
      },
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="new-email">New email address</FieldLabel>
          <Input
            id="new-email"
            type="email"
            autoComplete="email"
            required
            className="w-full sm:w-80"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <FieldDescription>
            It must be on this installation's email allowlist: ask an
            installation operator to add it first. We send a link there to
            confirm it. Once confirmed, sign-in links go only to the new
            address, invitations still waiting for the old one are withdrawn,
            and your other sign-in sessions end.
          </FieldDescription>
        </Field>
      </FieldGroup>
      <Actions>
        <Button type="submit" disabled={ask.pending}>
          Send confirmation link
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setOpen(false)
            ask.clear()
          }}
        >
          Cancel
        </Button>
      </Actions>
      {ask.error !== undefined && <ErrorMessage error={ask.error} />}
    </form>
  )
}

/** The person's sign-in sessions, and "sign out everywhere" (§3.3). */
function SignInSessions() {
  const api = useApi()
  const navigate = useNavigate()
  const sessions = useResource("sign-in-sessions", () => api.signInSessions())
  const everywhere = useAction()
  const [revokeAgentTokens, setRevokeAgentTokens] = useState(false)

  return (
    <Section title="Sign-in sessions">
      {sessions.data ? (
        <Rows>
          {sessions.data.map((session) => (
            <SignInSessionRow
              key={session.id}
              session={session}
              reload={sessions.reload}
            />
          ))}
        </Rows>
      ) : sessions.error ? (
        <ErrorMessage error={sessions.error} />
      ) : (
        <Loading />
      )}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-primary"
          checked={revokeAgentTokens}
          onChange={(event) => setRevokeAgentTokens(event.target.checked)}
        />
        <span>
          Also revoke all my agent tokens, in every workspace. Agents then need
          new tokens to connect.
        </span>
      </label>
      <Actions>
        <Button
          type="button"
          variant="destructive"
          disabled={everywhere.pending}
          onClick={() =>
            everywhere.run(
              () => api.signOutEverywhere({ revokeAgentTokens }),
              () => void navigate("/sign-in", { replace: true }),
            )
          }
        >
          Sign out everywhere
        </Button>
      </Actions>
      {everywhere.error !== undefined && (
        <ErrorMessage error={everywhere.error} />
      )}
    </Section>
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
    <li>
      <div className="flex flex-wrap items-center gap-2">
        <strong className="font-medium" title={session.client ?? undefined}>
          {session.browser}
        </strong>
        {session.current && <Badge variant="secondary">This browser</Badge>}
      </div>
      <Facts>
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
      </Facts>
      {!session.current && (
        <Actions>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={end.pending}
            onClick={() =>
              end.run(() => api.endSignInSession(session.id), props.reload)
            }
          >
            End this session
          </Button>
        </Actions>
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
    <Section title="Sign out">
      <Actions>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={signOut}
        >
          Sign out
        </Button>
      </Actions>
      {error !== undefined && (
        <ErrorAlert>{signInErrorMessage(error)}</ErrorAlert>
      )}
    </Section>
  )
}
