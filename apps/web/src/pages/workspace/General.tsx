import { useState } from "react"
import type { FormEvent } from "react"
import { useNavigate } from "react-router"

import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import { useAccount } from "../../account"
import { useAction } from "../../action"
import { useApi, useResource } from "../../api"
import { Actions, Confirm, Facts, Section } from "../../components/page"
import { ErrorMessage, Notice } from "../../components/status"
import { formatDate, roleNames } from "../../format"
import { useWorkspace } from "./context"

export function General() {
  const api = useApi()
  const { workspace } = useWorkspace()
  const members = useResource(`members:${workspace.id}`, () =>
    api.members(workspace.id),
  )
  const owners = members.data?.filter((m) => m.role === "owner")

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Section title="General">
        {workspace.role === "owner" ? (
          <RenameForm />
        ) : (
          <Facts>
            <dt>Name</dt>
            <dd>{workspace.name}</dd>
          </Facts>
        )}
        <Facts>
          <dt>Created</dt>
          <dd>{formatDate(workspace.createdAt)}</dd>
          <dt>Your role</dt>
          <dd>{roleNames[workspace.role]}</dd>
          <dt>Workspace owners</dt>
          <dd>
            {owners
              ? owners.map((m) => `${m.name} (${m.handle})`).join(", ")
              : "…"}
          </dd>
        </Facts>
      </Section>
      {owners && (
        <LeaveWorkspace
          onlyOwner={workspace.role === "owner" && owners.length === 1}
        />
      )}
    </div>
  )
}

function RenameForm() {
  const api = useApi()
  const { workspace, reload } = useWorkspace()
  const account = useAccount()
  const [name, setName] = useState(workspace.name)
  const [saved, setSaved] = useState(false)
  const rename = useAction()

  const save = (event: FormEvent) => {
    event.preventDefault()
    setSaved(false)
    rename.run(
      () => api.renameWorkspace(workspace.id, name),
      () => {
        setSaved(true)
        reload()
        account.reload()
      },
    )
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor="workspace-name">Name</FieldLabel>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="workspace-name"
            value={name}
            required
            onChange={(event) => {
              setName(event.target.value)
              setSaved(false)
            }}
          />
          <Button
            type="submit"
            disabled={rename.pending || name.trim() === workspace.name}
          >
            Rename
          </Button>
        </div>
      </Field>
      {saved && <Notice>Saved.</Notice>}
      {rename.error !== undefined && <ErrorMessage error={rename.error} />}
    </form>
  )
}

/**
 * Any member may leave (identity §5.3), except the last workspace owner
 * (identity §4), who is told why instead of being offered the action.
 */
function LeaveWorkspace(props: { onlyOwner: boolean }) {
  const api = useApi()
  const navigate = useNavigate()
  const account = useAccount()
  const { workspace } = useWorkspace()
  const [confirming, setConfirming] = useState(false)
  const leave = useAction()

  const confirm = () =>
    leave.run(
      () => api.leaveWorkspace(workspace.id),
      () => {
        account.reload()
        void navigate("/account", {
          replace: true,
          state: { notice: `You left ${workspace.name}.` },
        })
      },
    )

  return (
    <Section title="Leave this workspace">
      {props.onlyOwner ? (
        <p className="text-sm text-muted-foreground">
          You are the only workspace owner, and a workspace always has at least
          one. Make another member a workspace owner before you leave.
        </p>
      ) : confirming ? (
        <Confirm>
          <p>
            You will lose access to {workspace.name} at once. Your past activity
            stays credited to you. To come back you need a new invitation.
          </p>
          <Actions>
            <Button
              type="button"
              variant="destructive"
              disabled={leave.pending}
              onClick={confirm}
            >
              Leave {workspace.name}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setConfirming(false)
                leave.clear()
              }}
            >
              Cancel
            </Button>
          </Actions>
        </Confirm>
      ) : (
        <Actions>
          <Button
            type="button"
            variant="destructive"
            onClick={() => setConfirming(true)}
          >
            Leave workspace…
          </Button>
        </Actions>
      )}
      {leave.error !== undefined && <ErrorMessage error={leave.error} />}
    </Section>
  )
}
