import { useState } from "react"
import type { FormEvent } from "react"
import { useNavigate } from "react-router"

import { useAccount } from "../../account"
import { useAction } from "../../action"
import { useApi, useResource } from "../../api"
import { ErrorMessage } from "../../components/status"
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
    <>
      <section aria-labelledby="general-heading">
        <h2 id="general-heading">General</h2>
        {workspace.role === "owner" ? (
          <RenameForm />
        ) : (
          <dl className="facts">
            <dt>Name</dt>
            <dd>{workspace.name}</dd>
          </dl>
        )}
        <dl className="facts">
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
        </dl>
      </section>
      <LeaveWorkspace />
    </>
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
    <form onSubmit={save} className="stack">
      <label htmlFor="workspace-name">Name</label>
      <div className="inline">
        <input
          id="workspace-name"
          value={name}
          required
          onChange={(event) => {
            setName(event.target.value)
            setSaved(false)
          }}
        />
        <button
          type="submit"
          disabled={rename.pending || name.trim() === workspace.name}
        >
          Rename
        </button>
      </div>
      {saved && <p role="status">Saved.</p>}
      {rename.error !== undefined && <ErrorMessage error={rename.error} />}
    </form>
  )
}

/** Any member may leave (identity §5.3). */
function LeaveWorkspace() {
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
    <section aria-labelledby="leave-heading" className="danger-zone">
      <h2 id="leave-heading">Leave this workspace</h2>
      {confirming ? (
        <div className="confirm">
          <p>
            You will lose access to {workspace.name} at once. Your past activity
            stays credited to you. To come back you need a new invitation.
          </p>
          <div className="actions">
            <button
              type="button"
              className="danger"
              disabled={leave.pending}
              onClick={confirm}
            >
              Leave {workspace.name}
            </button>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setConfirming(false)
                leave.clear()
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="danger"
          onClick={() => setConfirming(true)}
        >
          Leave workspace…
        </button>
      )}
      {leave.error !== undefined && <ErrorMessage error={leave.error} />}
    </section>
  )
}
