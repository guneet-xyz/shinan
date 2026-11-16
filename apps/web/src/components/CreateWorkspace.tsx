import { useState } from "react"
import type { FormEvent } from "react"
import { useNavigate } from "react-router"

import { useAccount } from "../account"
import { useAction } from "../action"
import { useApi } from "../api"
import { ErrorMessage } from "./status"

/**
 * Creates a workspace; any person may, and becomes its first workspace
 * owner (identity §4). Only a name for now: the task ID prefix comes with
 * tasks.
 */
export function CreateWorkspace() {
  const api = useApi()
  const navigate = useNavigate()
  const { reload } = useAccount()
  const [name, setName] = useState("")
  const create = useAction()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const workspaceName = name.trim()
    let createdId: string | undefined
    create.run(
      async () => {
        createdId = (await api.createWorkspace(workspaceName)).id
      },
      () => {
        reload()
        void navigate(`/w/${createdId}`)
      },
    )
  }

  return (
    <form onSubmit={submit} className="inline">
      <label htmlFor="new-workspace-name" className="visually-hidden">
        New workspace name
      </label>
      <input
        id="new-workspace-name"
        required
        placeholder="Workspace name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <button type="submit" disabled={create.pending}>
        Create workspace
      </button>
      {create.error !== undefined && <ErrorMessage error={create.error} />}
    </form>
  )
}
