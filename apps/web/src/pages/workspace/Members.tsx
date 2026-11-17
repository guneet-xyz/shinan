import { useState } from "react"

import type { Member, Role } from "@shinan/api-client"

import { Button } from "@/components/ui/button"

import { useAccount } from "../../account"
import { useAction } from "../../action"
import { useApi, useResource } from "../../api"
import { Actions, Confirm, Facts, Rows, Section } from "../../components/page"
import { ErrorMessage, Loading } from "../../components/status"
import { formatDate, roleNames } from "../../format"
import { useWorkspace } from "./context"

/**
 * Members and roles (human experience, Workspace settings), with each
 * member's agents. Linked git host accounts and last activity join each row
 * when they exist (M3).
 */
export function Members() {
  const api = useApi()
  const { workspace } = useWorkspace()
  const members = useResource(`members:${workspace.id}`, () =>
    api.members(workspace.id),
  )

  return (
    <Section
      title="Members"
      description={
        workspace.role === "owner" &&
        "Every member can read and change everything in this workspace."
      }
    >
      {members.data ? (
        <MemberList members={members.data} reload={members.reload} />
      ) : members.error ? (
        <ErrorMessage error={members.error} />
      ) : (
        <Loading />
      )}
    </Section>
  )
}

function MemberList(props: { members: Member[]; reload: () => void }) {
  const owners = props.members.filter((m) => m.role === "owner").length
  return (
    <Rows>
      {props.members.map((member) => (
        <MemberRow
          key={member.id}
          member={member}
          onlyOwner={member.role === "owner" && owners === 1}
          reload={props.reload}
        />
      ))}
    </Rows>
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
    <li>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <strong className="font-medium">{member.name}</strong>{" "}
        <span className="text-sm text-muted-foreground">
          {member.handle}
          {you && " (you)"}
        </span>
      </div>
      <Facts>
        <dt>Role</dt>
        <dd>{roleNames[member.role]}</dd>
        <dt>Joined</dt>
        <dd>{formatDate(member.joinedAt)}</dd>
        <dt>Invited by</dt>
        <dd>{member.invitedByHandle ?? "Nobody (created the workspace)"}</dd>
        <dt>Agents</dt>
        <dd>
          {member.agents.length === 0
            ? "None"
            : member.agents
                .map((a) => (a.enabled ? a.name : `${a.name} (disabled)`))
                .join(", ")}
        </dd>
      </Facts>
      {manage && props.onlyOwner && (
        <p className="text-sm text-muted-foreground">
          The last workspace owner cannot be removed or made a contributor.
        </p>
      )}
      {manage && !props.onlyOwner && !confirmingRemoval && (
        <Actions>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={action.pending}
            onClick={() => changeRole(nextRole)}
          >
            Make {roleNames[nextRole].toLowerCase()}
          </Button>
          {!you && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={action.pending}
              onClick={() => setConfirmingRemoval(true)}
            >
              Remove…
            </Button>
          )}
        </Actions>
      )}
      {confirmingRemoval && (
        <Confirm>
          <p className="font-medium">Before you remove {member.name}:</p>
          <ul className="ml-5 list-disc space-y-1">
            <li>They lose access to this workspace on their next request.</li>
            {member.agents.some((a) => a.enabled) && (
              <li>
                Their agents here are disabled and their tokens stop working:{" "}
                {member.agents
                  .filter((a) => a.enabled)
                  .map((a) => a.name)
                  .join(", ")}
                .
              </li>
            )}
            <li>Their past activity stays credited to them.</li>
            <li>
              Removing them here does not remove their access on GitHub or
              Forgejo. They have already seen everything in this workspace, so
              change anything it pointed to that they should no longer use.
            </li>
          </ul>
          <Actions>
            <Button
              type="button"
              variant="destructive"
              disabled={action.pending}
              onClick={remove}
            >
              Remove {member.name}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setConfirmingRemoval(false)
                action.clear()
              }}
            >
              Cancel
            </Button>
          </Actions>
        </Confirm>
      )}
      {action.error !== undefined && <ErrorMessage error={action.error} />}
    </li>
  )
}
