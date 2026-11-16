import { useState } from "react"
import type { FormEvent } from "react"

import { roles } from "@shinan/api-client"
import type { Invitation, InvitationState, Role } from "@shinan/api-client"

import { useAction } from "../../action"
import { useApi, useResource } from "../../api"
import { ErrorMessage, Loading } from "../../components/status"
import { formatDate, roleNames } from "../../format"
import { useWorkspace } from "./context"

const stateNames: Record<InvitationState, string> = {
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  withdrawn: "Withdrawn",
}

/**
 * Invitations (human experience, Workspace settings; identity §5.2). Joining
 * a workspace needs one; whether the address may have an account at all is
 * the installation's email allowlist, which the server checks.
 */
export function Invitations() {
  const { workspace } = useWorkspace()
  if (workspace.role === "owner") return <ManageInvitations />
  return (
    <section aria-labelledby="invitations-heading">
      <h2 id="invitations-heading">Invitations</h2>
      <p>Only workspace owners invite people and manage invitations.</p>
    </section>
  )
}

function ManageInvitations() {
  const api = useApi()
  const { workspace } = useWorkspace()
  const invitations = useResource(`invitations:${workspace.id}`, () =>
    api.invitations(workspace.id),
  )

  return (
    <section aria-labelledby="invitations-heading">
      <h2 id="invitations-heading">Invitations</h2>
      <InviteForm onInvited={invitations.reload} />
      <h3>Sent invitations</h3>
      {invitations.data ? (
        <InvitationList
          invitations={invitations.data}
          reload={invitations.reload}
        />
      ) : invitations.error ? (
        <ErrorMessage error={invitations.error} />
      ) : (
        <Loading />
      )}
    </section>
  )
}

function InviteForm(props: { onInvited: () => void }) {
  const api = useApi()
  const { workspace } = useWorkspace()
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<Role>("contributor")
  const [sentTo, setSentTo] = useState<string>()
  const invite = useAction()

  const send = (event: FormEvent) => {
    event.preventDefault()
    const address = email.trim()
    setSentTo(undefined)
    invite.run(
      () => api.invite(workspace.id, { email: address, role }),
      () => {
        setSentTo(address)
        setEmail("")
        props.onInvited()
      },
    )
  }

  return (
    <form onSubmit={send} className="stack card">
      <h3>Invite someone</h3>
      <p className="muted">
        Every member can read and change everything in this workspace, including
        infrastructure details and work from private repositories. The address
        must be on this installation&apos;s email allowlist; an installation
        operator adds it.
      </p>
      <label htmlFor="invite-email">Email address</label>
      <input
        id="invite-email"
        type="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <label htmlFor="invite-role">Role</label>
      <select
        id="invite-role"
        value={role}
        onChange={(event) => setRole(event.target.value as Role)}
      >
        {roles.map((r) => (
          <option key={r} value={r}>
            {roleNames[r]}
          </option>
        ))}
      </select>
      <button type="submit" disabled={invite.pending}>
        Send invitation
      </button>
      {sentTo && <p role="status">Invitation sent to {sentTo}.</p>}
      {invite.error !== undefined && <ErrorMessage error={invite.error} />}
    </form>
  )
}

function InvitationList(props: {
  invitations: Invitation[]
  reload: () => void
}) {
  if (props.invitations.length === 0) {
    return <p className="muted">No invitations yet.</p>
  }
  // Pending invitations first: they are the ones that can still change.
  const sorted = [...props.invitations].sort(
    (a, b) =>
      Number(b.state === "pending") - Number(a.state === "pending") ||
      b.createdAt.localeCompare(a.createdAt),
  )
  return (
    <ul className="cards">
      {sorted.map((invitation) => (
        <InvitationRow
          key={invitation.id}
          invitation={invitation}
          reload={props.reload}
        />
      ))}
    </ul>
  )
}

function InvitationRow(props: { invitation: Invitation; reload: () => void }) {
  const api = useApi()
  const { workspace } = useWorkspace()
  const { invitation } = props
  const action = useAction()
  const [resent, setResent] = useState(false)

  return (
    <li className="card">
      <div>
        <strong>{invitation.email}</strong>{" "}
        <span className={`badge state-${invitation.state}`}>
          {stateNames[invitation.state]}
        </span>
      </div>
      <dl className="facts compact">
        <dt>Role</dt>
        <dd>{roleNames[invitation.role]}</dd>
        <dt>Invited by</dt>
        <dd>{invitation.invitedByHandle}</dd>
        <dt>Sent</dt>
        <dd>{formatDate(invitation.createdAt)}</dd>
        {invitation.state === "pending" && (
          <>
            <dt>Expires</dt>
            <dd>{formatDate(invitation.expiresAt)}</dd>
          </>
        )}
      </dl>
      {(invitation.state === "pending" || invitation.state === "expired") && (
        <div className="actions">
          <button
            type="button"
            disabled={action.pending}
            onClick={() =>
              action.run(
                () => api.resendInvitation(workspace.id, invitation.id),
                () => {
                  setResent(true)
                  props.reload()
                },
              )
            }
          >
            Resend
          </button>
          {invitation.state === "pending" && (
            <button
              type="button"
              className="danger"
              disabled={action.pending}
              onClick={() =>
                action.run(
                  () => api.withdrawInvitation(workspace.id, invitation.id),
                  props.reload,
                )
              }
            >
              Withdraw
            </button>
          )}
        </div>
      )}
      {resent && <p role="status">Sent again.</p>}
      {action.error !== undefined && <ErrorMessage error={action.error} />}
    </li>
  )
}
