import { useState } from "react"

import type { Member, Role } from "@shinan/api-client"

import { useAccount } from "../../account"
import { useAction } from "../../action"
import { useApi, useResource } from "../../api"
import { ErrorMessage, Loading } from "../../components/status"
import { formatDate, roleNames } from "../../format"
import { useWorkspace } from "./context"

/**
 * Members and roles (human experience, Workspace settings). Linked git host
 * accounts, agents and last activity join each row when they exist (M2, M3).
 */
export function Members() {
  const api = useApi()
  const { workspace } = useWorkspace()
  const members = useResource(`members:${workspace.id}`, () =>
    api.members(workspace.id),
  )

  return (
    <section aria-labelledby="members-heading">
      <h2 id="members-heading">Members</h2>
      {workspace.role === "owner" && (
        <p className="muted">
          Every member can read and change everything in this workspace.
        </p>
      )}
      {members.data ? (
        <MemberList members={members.data} reload={members.reload} />
      ) : members.error ? (
        <ErrorMessage error={members.error} />
      ) : (
        <Loading />
      )}
    </section>
  )
}

function MemberList(props: { members: Member[]; reload: () => void }) {
  const owners = props.members.filter((m) => m.role === "owner").length
  return (
    <ul className="cards">
      {props.members.map((member) => (
        <MemberRow
          key={member.id}
          member={member}
          onlyOwner={member.role === "owner" && owners === 1}
          reload={props.reload}
        />
      ))}
    </ul>
  )
}

function MemberRow(props: {
  member: Member
  onlyOwner: boolean
  reload: () => void
}) {
  const api = useApi()
  const { workspace, reload: reloadWorkspace } = useWorkspace()
  const { account } = useAccount()
  const { member } = props
  const you = member.personId === account.person.id
  const manage = workspace.role === "owner"
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)
  const action = useAction()

  const changeRole = (role: Role) =>
    action.run(
      () => api.changeRole(workspace.id, member.id, role),
      () => {
        props.reload()
        // Lowering your own role changes what this page offers you.
        if (you) reloadWorkspace()
      },
    )
  const remove = () =>
    action.run(() => api.removeMember(workspace.id, member.id), props.reload)

  const nextRole: Role = member.role === "owner" ? "contributor" : "owner"

  return (
    <li className="card member">
      <div className="member-who">
        <strong>{member.name}</strong>{" "}
        <span className="muted">
          {member.handle}
          {you && " (you)"}
        </span>
      </div>
      <dl className="facts compact">
        <dt>Role</dt>
        <dd>{roleNames[member.role]}</dd>
        <dt>Joined</dt>
        <dd>{formatDate(member.joinedAt)}</dd>
        <dt>Invited by</dt>
        <dd>{member.invitedByHandle ?? "Nobody (created the workspace)"}</dd>
      </dl>
      {manage && props.onlyOwner && (
        <p className="muted">
          The last workspace owner cannot be removed or made a contributor.
        </p>
      )}
      {manage && !props.onlyOwner && !confirmingRemoval && (
        <div className="actions">
          <button
            type="button"
            disabled={action.pending}
            onClick={() => changeRole(nextRole)}
          >
            Make {roleNames[nextRole].toLowerCase()}
          </button>
          {!you && (
            <button
              type="button"
              className="danger"
              disabled={action.pending}
              onClick={() => setConfirmingRemoval(true)}
            >
              Remove…
            </button>
          )}
        </div>
      )}
      {confirmingRemoval && (
        <div className="confirm">
          <p>Before you remove {member.name}:</p>
          <ul>
            <li>They lose access to this workspace on their next request.</li>
            <li>Their past activity stays credited to them.</li>
            <li>
              Removing them here does not remove their access on GitHub or
              Forgejo. They have already seen everything in this workspace, so
              change anything it pointed to that they should no longer use.
            </li>
          </ul>
          <div className="actions">
            <button
              type="button"
              className="danger"
              disabled={action.pending}
              onClick={remove}
            >
              Remove {member.name}
            </button>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setConfirmingRemoval(false)
                action.clear()
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {action.error !== undefined && <ErrorMessage error={action.error} />}
    </li>
  )
}
