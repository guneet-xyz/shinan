import { useState } from "react"
import type { FormEvent } from "react"
import { useNavigate } from "react-router"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

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
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="new-workspace-name" className="sr-only">
          New workspace name
        </label>
        <Input
          id="new-workspace-name"
          required
          placeholder="Workspace name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" disabled={create.pending}>
          Create workspace
        </Button>
      </div>
      {create.error !== undefined && <ErrorMessage error={create.error} />}
    </form>
  )
}
