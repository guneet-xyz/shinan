import { useState } from "react"
import type { FormEvent } from "react"

import { roles } from "@shinan/api-client"
import type { Invitation, InvitationState, Role } from "@shinan/api-client"

import { Badge } from "@/components/ui/badge"
import type { badgeVariants } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"

import { useAction } from "../../action"
import { useApi, useResource } from "../../api"
import { Actions, Facts, Rows, Section } from "../../components/page"
import { ErrorMessage, Loading, Notice } from "../../components/status"
import { formatDate, roleNames } from "../../format"
import { useWorkspace } from "./context"

const stateNames: Record<InvitationState, string> = {
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  withdrawn: "Withdrawn",
}

const stateBadges: Record<
  InvitationState,
  NonNullable<Parameters<typeof badgeVariants>[0]>["variant"]
> = {
  pending: "default",
  accepted: "secondary",
  declined: "outline",
  expired: "outline",
  withdrawn: "outline",
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
    <Section title="Invitations">
      <p className="text-sm text-muted-foreground">
        Only workspace owners invite people and manage invitations.
      </p>
    </Section>
  )
}

function ManageInvitations() {
  const api = useApi()
  const { workspace } = useWorkspace()
  const invitations = useResource(`invitations:${workspace.id}`, () =>
    api.invitations(workspace.id),
  )

  return (
    <section
      aria-labelledby="invitations-heading"
      className="flex max-w-3xl flex-col gap-6"
    >
      <h2 id="invitations-heading" className="text-lg font-semibold">
        Invitations
      </h2>
      <InviteForm onInvited={invitations.reload} />
      <Section level={3} title="Sent invitations">
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
      </Section>
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
    <Section
      level={3}
      title="Invite someone"
      description="Every member can read and change everything in this workspace, including infrastructure details and work from private repositories. The address must be on this installation's email allowlist; an installation operator adds it."
    >
      <form onSubmit={send}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="invite-email">Email address</FieldLabel>
            <Input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="invite-role">Role</FieldLabel>
            <NativeSelect
              id="invite-role"
              className="w-full sm:w-64"
              value={role}
              onChange={(event) => setRole(event.target.value as Role)}
            >
              {roles.map((r) => (
                <NativeSelectOption key={r} value={r}>
                  {roleNames[r]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <div>
            <Button type="submit" disabled={invite.pending}>
              Send invitation
            </Button>
          </div>
          {sentTo && <Notice>Invitation sent to {sentTo}.</Notice>}
          {invite.error !== undefined && <ErrorMessage error={invite.error} />}
        </FieldGroup>
      </form>
    </Section>
  )
}

function InvitationList(props: {
  invitations: Invitation[]
  reload: () => void
}) {
  if (props.invitations.length === 0) {
    return <p className="text-sm text-muted-foreground">No invitations yet.</p>
  }
  // Pending invitations first: they are the ones that can still change.
  const sorted = [...props.invitations].sort(
    (a, b) =>
      Number(b.state === "pending") - Number(a.state === "pending") ||
      b.createdAt.localeCompare(a.createdAt),
  )
  return (
    <Rows>
      {sorted.map((invitation) => (
        <InvitationRow
          key={invitation.id}
          invitation={invitation}
          reload={props.reload}
        />
      ))}
    </Rows>
  )
}

function InvitationRow(props: { invitation: Invitation; reload: () => void }) {
  const api = useApi()
  const { workspace } = useWorkspace()
  const { invitation } = props
  const action = useAction()
  const [resent, setResent] = useState(false)

  return (
    <li>
      <div className="flex flex-wrap items-center gap-2">
        <strong className="font-medium break-all">{invitation.email}</strong>{" "}
        <Badge variant={stateBadges[invitation.state]}>
          {stateNames[invitation.state]}
        </Badge>
      </div>
      <Facts>
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
      </Facts>
      {(invitation.state === "pending" || invitation.state === "expired") && (
        <Actions>
          <Button
            type="button"
            variant="outline"
            size="sm"
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
          </Button>
          {invitation.state === "pending" && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={action.pending}
              onClick={() =>
                action.run(
                  () => api.withdrawInvitation(workspace.id, invitation.id),
                  props.reload,
                )
              }
            >
              Withdraw
            </Button>
          )}
        </Actions>
      )}
      {resent && <Notice>Sent again.</Notice>}
      {action.error !== undefined && <ErrorMessage error={action.error} />}
    </li>
  )
}
